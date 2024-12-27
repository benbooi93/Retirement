import 'dotenv/config';
import Fastify from 'fastify';
import WebSocket from 'ws';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import twilio from 'twilio';

// Load environment variables
const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    OPENAI_API_KEY,
    SERVER_URL,
    OPENAI_ORG_ID,
    PROJECT_ID
} = process.env;

// Validate required environment variables
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !OPENAI_API_KEY || !SERVER_URL) {
    console.error('Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const PORT = process.env.PORT || 5050;
const SYSTEM_MESSAGE = 'You are a helpful AI assistant making a phone call. Keep responses brief and engaging.';
const VOICE = 'alloy';

// Detailed error logging function
function logError(context, error) {
    console.error('=== Error Details ===');
    console.error('Context:', context);
    console.error('Timestamp:', new Date().toISOString());
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('==================');
}

// Make the outbound call
async function makeOutboundCall(to) {
    try {
        console.log('Initiating outbound call to:', to);
        
        // Generate TwiML for the call
        const twimlResponse = new twilio.twiml.VoiceResponse();
        
        // Add a brief pause and greeting
        twimlResponse.say({ voice: 'alice' }, 'Please wait while I connect you to the AI assistant.');
        twimlResponse.pause({ length: 1 });
        
        // Add the stream to TwiML
        const connect = twimlResponse.connect();
        connect.stream({
            url: `wss://${SERVER_URL}/media-stream`,
            track: 'inbound_track'
        });
        
        const call = await twilioClient.calls.create({
            twiml: twimlResponse.toString(),
            to,
            from: TWILIO_PHONE_NUMBER,
            statusCallback: `https://${SERVER_URL}/status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });
        
        console.log('Call initiated successfully:', call.sid);
        return { call, twiml: twimlResponse.toString() };
    } catch (error) {
        logError('Outbound Call Creation', error);
        throw error;
    }
}

// WebSocket route for media streaming
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('WebSocket connection established with Twilio');
        
        let streamSid = null;
        let isClosing = false;
        
        // Connect to OpenAI
        console.log('Attempting to connect to OpenAI WebSocket...');
        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            },
            handshakeTimeout: 30000
        });

        openAiWs.on('open', () => {
            console.log('Connected to OpenAI Realtime API');
            
            // Initialize session
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.7
                }
            };
            
            try {
                openAiWs.send(JSON.stringify(sessionUpdate));
                console.log('Sent session configuration to OpenAI');
            } catch (error) {
                console.error('Failed to send session configuration:', error);
            }
        });

        // Handle OpenAI messages
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                console.log('OpenAI event:', response.type);

                switch (response.type) {
                    case 'response.audio.delta':
                        if (response.delta && !isClosing) {
                            const audioDelta = {
                                event: 'media',
                                streamSid: streamSid,
                                media: { payload: response.delta }
                            };
                            if (connection.socket.readyState === WebSocket.OPEN) {
                                connection.socket.send(JSON.stringify(audioDelta));
                                console.log('Sent audio response to Twilio');
                            }
                        }
                        break;
                    case 'error':
                        console.error('OpenAI Error:', JSON.stringify(response, null, 2));
                        break;
                    case 'session.created':
                        console.log('OpenAI session created');
                        break;
                    case 'session.updated':
                        console.log('OpenAI session updated');
                        break;
                    default:
                        console.log(`Received event: ${response.type}`);
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error);
            }
        });

        // Handle Twilio messages
        connection.socket.on('message', (message) => {
            if (isClosing) return;
            
            try {
                const data = JSON.parse(message);
                console.log('Received Twilio event:', data.event);
                
                switch (data.event) {
                    case 'media':
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioMessage = {
                                type: "input_audio_buffer.append",
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioMessage));
                            console.log('Sent audio data to OpenAI');
                        } else {
                            console.error('OpenAI WebSocket not ready for media');
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Media stream started:', streamSid);
                        break;
                    case 'stop':
                        console.log('Media stream stopped:', streamSid);
                        isClosing = true;
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            openAiWs.close(1000, 'Stream ended by Twilio');
                        }
                        break;
                    default:
                        console.log('Received Twilio event:', data.event);
                }
            } catch (error) {
                console.error('Error processing Twilio message:', error);
            }
        });

        // Handle connection close
        connection.socket.on('close', (code, reason) => {
            console.log(`Twilio WebSocket closed with code ${code}:`, reason);
            isClosing = true;
            if (openAiWs.readyState === WebSocket.OPEN) {
                openAiWs.close(1000, 'Twilio connection closed');
            }
        });

        // Handle OpenAI WebSocket errors
        openAiWs.on('error', (error) => {
            console.error('OpenAI WebSocket error:', error);
            if (!isClosing) {
                console.log('WebSocket error occurred, but connection still active');
            }
        });

        // Handle OpenAI WebSocket close
        openAiWs.on('close', (code, reason) => {
            console.log(`OpenAI WebSocket closed with code ${code}:`, reason);
            if (!isClosing && connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.close(1000, 'OpenAI connection closed');
            }
        });
    });
});

// Call endpoint
fastify.post('/call', async (request, reply) => {
    try {
        const { to } = request.body;
        if (!to) {
            return reply.code(400).send({ error: 'Phone number is required' });
        }
        
        const { call, twiml } = await makeOutboundCall(to);
        return { callSid: call.sid, twiml };
    } catch (error) {
        console.error('Failed to initiate outbound call:', error);
        return reply.code(500).send({ error: error.message });
    }
});

// Status webhook
fastify.post('/status', async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    console.log(`Call ${CallSid} status: ${CallStatus}`);
    return { received: true };
});

// Start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        logError('Server Startup', err);
        process.exit(1);
    }
    console.log(`Server running on port ${PORT}`);
}); 