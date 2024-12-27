import 'dotenv/config';
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import formBodyPlugin from '@fastify/formbody';
import WebSocket from 'ws';

// Configuration
const {
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PHONE_NUMBER_FROM,
  DOMAIN,
  PORT = 5050
} = process.env;

// Validate OpenAI API key
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is required');
  process.exit(1);
}

if (!OPENAI_API_KEY.startsWith('sk-org-')) {
  console.error('Error: OpenAI API key must be an organization-scoped key (starts with sk-org-). Project-scoped keys are not supported for the real-time audio API.');
  process.exit(1);
}

const SYSTEM_MESSAGE = `
You are a helpful AI assistant taking orders for a sushi restaurant. 
Guide the customer through placing their order, asking about:
1. Whether they want delivery or pickup
2. What sushi items they'd like to order
3. Any special requests or dietary restrictions
4. Their address if delivery is chosen
Keep responses brief and engaging, and confirm the order details before finishing.
`;

const VOICE = 'alloy';
const LOG_EVENT_TYPES = [
  'error', 'response.content.done', 'rate_limits.updated',
  'response.done', 'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped', 'input_audio_buffer.speech_started',
  'session.created'
];

// Create Fastify instance
const fastify = Fastify({ 
  logger: true,
  trustProxy: true // Add this for proper IP handling behind ngrok
});

// Register plugins
await fastify.register(formBodyPlugin);
await fastify.register(websocketPlugin, {
  options: { 
    clientTracking: true,
    maxPayload: 64 * 1024, // 64KB max payload
    handleProtocols: (protocols) => {
      // Accept any protocol
      return protocols[0];
    },
    verifyClient: (info, callback) => {
      // Accept all connections
      callback(true);
    }
  }
});

// Status callback route for Twilio
fastify.post('/status-callback', async (request, reply) => {
  try {
    const callStatus = request.body;
    console.log('Status Callback received:', {
      timestamp: new Date().toISOString(),
      ...callStatus
    });
    
    // Always return a 200 OK with empty TwiML
    reply.type('application/xml');
    return reply.code(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Error in status callback:', error);
    // Still return 200 OK to prevent Twilio from retrying
    reply.type('application/xml');
    return reply.code(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// Root route
fastify.get('/', async (request, reply) => {
  console.log('Root route hit');
  return { message: 'Twilio Media Stream Server is running!' };
});

// Incoming call route for Twilio
fastify.all('/incoming-call', async (request, reply) => {
  console.log('Incoming call endpoint hit');
  console.log('Request headers:', request.headers);
  
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream">
      <Parameter name="mode" value="voice"/>
      <Parameter name="format" value="g711_ulaw"/>
      <Parameter name="timeout" value="3600"/>
      <Parameter name="sample_rate" value="8000"/>
      <Parameter name="channels" value="1"/>
    </Stream>
  </Connect>
</Response>`;
  
  console.log('Sending TwiML response:', twimlResponse);
  reply.header('Content-Type', 'text/xml');
  return reply.send(twimlResponse);
});

// WebSocket handler
fastify.register(async function (fastify) {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Client connected to WebSocket');
    
    let openaiWs = null;
    let streamSid = null;
    let isClosing = false;

    const initializeOpenAIWebSocket = () => {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }

      let retryCount = 0;
      const maxRetries = 5;
      const baseDelay = 1000;

      const connectWithRetry = () => {
        if (isClosing) return;
        
        console.log(`Attempting to connect to OpenAI WebSocket (Attempt ${retryCount + 1}/${maxRetries})`);
        
        try {
          openaiWs = new WebSocket('wss://api.openai.com/v1/audio/speech', {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "OpenAI-Beta": "realtime=v1"
            },
            handshakeTimeout: 30000, // Increased timeout to 30 seconds
            followRedirects: true,
            maxRedirects: 5,
            perMessageDeflate: false, // Disable compression
            skipUTF8Validation: true
          });

          // Set up error handlers before the connection is established
          openaiWs.onerror = (error) => {
            const errorMessage = error.message || (error.error && error.error.message) || 'Unknown error';
            console.error('OpenAI WebSocket error:', {
              message: errorMessage,
              code: error.code,
              type: error.type,
              target: {
                url: error.target?._url,
                readyState: error.target?._readyState,
                protocol: error.target?._protocol
              }
            });
            
            if (!isClosing && retryCount < maxRetries) {
              const delay = Math.min(baseDelay * Math.pow(2, retryCount), 10000);
              console.log(`Retrying connection in ${delay/1000} seconds...`);
              retryCount++;
              setTimeout(connectWithRetry, delay);
            } else if (retryCount >= maxRetries) {
              console.error('Max retry attempts reached. Please check:');
              console.error('1. Your OpenAI API key is an organization-scoped key (starts with sk-org-)');
              console.error('2. Your network connection and firewall settings');
              console.error('3. OpenAI service status at https://status.openai.com');
              isClosing = true;
              if (connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.close(1011, 'Unable to establish OpenAI connection');
              }
            }
          };

          openaiWs.addEventListener('open', () => {
            console.log('Connected to OpenAI WebSocket');
            retryCount = 0;
            
            const sessionUpdate = {
              type: 'session.update',
              session: {
                turn_detection: { type: 'server_vad' },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: VOICE,
                instructions: SYSTEM_MESSAGE,
                modalities: ["text", "audio"],
                temperature: 0.8,
              }
            };
            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openaiWs.send(JSON.stringify(sessionUpdate));
          });

          openaiWs.addEventListener('message', (event) => {
            if (!event.data || isClosing) return;
            
            try {
              const response = JSON.parse(event.data);
              if (LOG_EVENT_TYPES.includes(response.type)) {
                console.log(`Received event: ${response.type}`, response);
              }
              if (response.type === 'session.updated') {
                console.log('Session updated successfully:', response);
              }
              if (response.type === 'response.audio.delta' && response.delta && connection.socket.readyState === WebSocket.OPEN) {
                const audioDelta = {
                  event: 'media',
                  streamSid: streamSid,
                  media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                };
                connection.socket.send(JSON.stringify(audioDelta));
              }
            } catch (error) {
              console.error('Error processing OpenAI message:', error);
            }
          });

          openaiWs.addEventListener('error', (error) => {
            console.error('OpenAI WebSocket error:', error.message || 'Unknown error');
            
            if (!isClosing && retryCount < maxRetries) {
              const delay = Math.min(baseDelay * Math.pow(2, retryCount), 10000); // Cap at 10 seconds
              console.log(`Retrying connection in ${delay/1000} seconds...`);
              retryCount++;
              setTimeout(connectWithRetry, delay);
            } else if (retryCount >= maxRetries) {
              console.error('Max retry attempts reached. Please check your connection and API key.');
              isClosing = true;
              if (connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.close(1011, 'Unable to establish OpenAI connection');
              }
            }
          });

          openaiWs.addEventListener('close', (event) => {
            console.log(`OpenAI WebSocket closed with code ${event.code}`);
            if (!isClosing && retryCount < maxRetries) {
              const delay = Math.min(baseDelay * Math.pow(2, retryCount), 10000);
              console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
              retryCount++;
              setTimeout(connectWithRetry, delay);
            }
          });
        } catch (error) {
          console.error('Error creating WebSocket:', error);
          if (!isClosing && retryCount < maxRetries) {
            const delay = Math.min(baseDelay * Math.pow(2, retryCount), 10000);
            console.log(`Retrying connection in ${delay/1000} seconds...`);
            retryCount++;
            setTimeout(connectWithRetry, delay);
          }
        }
      };

      connectWithRetry();
    };

    // Initialize OpenAI WebSocket connection
    initializeOpenAIWebSocket();

    // Handle incoming messages from Twilio
    connection.socket.on('message', (message) => {
      if (isClosing) return;
      
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.event) {
          case 'media':
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              };
              openaiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case 'start':
            streamSid = data.start.streamSid;
            console.log('Stream started with SID:', streamSid);
            break;
          case 'stop':
            console.log('Stream stopped');
            isClosing = true;
            if (openaiWs) {
              openaiWs.close();
            }
            break;
          default:
            console.log('Received event:', data.event);
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Handle WebSocket closure
    connection.socket.on('close', () => {
      console.log('Client disconnected');
      isClosing = true;
      if (openaiWs) {
        openaiWs.close();
      }
    });
  });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${PORT}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

start(); 