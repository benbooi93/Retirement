import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 5050;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established');

  // Create OpenAI WebSocket connection
  const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime/v1/audio', {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Organization': process.env.OPENAI_ORG_ID
    }
  });

  openaiWs.on('open', () => {
    console.log('Connected to OpenAI WebSocket');
    
    // Send initial session configuration
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad'
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'alloy',
        instructions: 'You are a helpful AI assistant.',
        modalities: ['text', 'audio'],
        temperature: 0.7
      }
    };
    openaiWs.send(JSON.stringify(sessionConfig));
  });

  openaiWs.on('message', (data) => {
    console.log('Received message from OpenAI:', data.toString());
    ws.send(data);
  });

  openaiWs.on('error', (error) => {
    console.error('OpenAI WebSocket error:', error);
  });

  ws.on('message', (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data);
    }
  });

  ws.on('close', () => {
    console.log('Client WebSocket closed');
    openaiWs.close();
  });
});

// Handle incoming calls
app.post('/call', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const streamUrl = `wss://${process.env.DOMAIN}/stream`;
  
  twiml.start().stream({
    url: streamUrl,
    track: 'inbound_track'
  });

  console.log('Generated TwiML:', twiml.toString());
  res.type('text/xml');
  res.send(twiml.toString());
});

// Create HTTP server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
}); 