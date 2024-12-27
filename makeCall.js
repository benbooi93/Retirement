import 'dotenv/config';
import twilio from 'twilio';

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PHONE_NUMBER_FROM,
  DOMAIN
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

console.log('Creating TwiML response...');

// Create properly formatted TwiML with all required parameters
const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream" parameters="{&quot;mode&quot;:&quot;voice&quot;,&quot;format&quot;:&quot;g711_ulaw&quot;,&quot;timeout&quot;:&quot;3600&quot;,&quot;sample_rate&quot;:&quot;8000&quot;,&quot;channels&quot;:&quot;1&quot;}"/>
  </Connect>
</Response>`;

console.log('Generated TwiML:', twiml);
console.log('WebSocket URL:', `wss://${DOMAIN}/media-stream`);

console.log('Making call with following parameters:');
console.log('From:', PHONE_NUMBER_FROM);
console.log('To: +16133168831');

try {
  const call = await client.calls.create({
    twiml: twiml,
    to: '+16133168831',
    from: PHONE_NUMBER_FROM,
    statusCallback: `https://${DOMAIN}/status-callback`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST'
  });

  console.log(`Outbound call initiated to +16133168831, SID: ${call.sid}`);
} catch (error) {
  console.error('Error making call:', error);
  process.exit(1);
} 