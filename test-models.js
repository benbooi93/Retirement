import 'dotenv/config';
import axios from 'axios';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID;

async function testModels() {
  try {
    // Test models endpoint
    const modelsResponse = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORG_ID
      }
    });
    
    console.log('Available Models:');
    console.log(modelsResponse.data.data.map(model => model.id).join('\n'));

    // Test chat completion
    const chatResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-4",
      messages: [{ role: "user", content: "Say hello!" }]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORG_ID
      }
    });
    
    console.log('\nChat Completion Test:');
    console.log(chatResponse.data.choices[0].message);

    // Test text-to-speech API
    console.log('\nTesting Text-to-Speech API...');
    const ttsResponse = await axios.post('https://api.openai.com/v1/audio/speech', {
      model: "tts-1",
      input: "Hello, this is a test!",
      voice: "alloy"
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORG_ID,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer'
    });
    
    console.log('Text-to-Speech API Test:', ttsResponse.status === 200 ? 'Success!' : 'Failed');

  } catch (error) {
    console.error('Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.response?.data?.error?.message || error.message,
      type: error.response?.data?.error?.type,
    });
  }
}

console.log('Testing OpenAI API access...');
console.log('Organization ID:', OPENAI_ORG_ID);
console.log('API Key type:', OPENAI_API_KEY?.startsWith('sk-org-') ? 'Organization-scoped' : 'Project-scoped');
console.log('-------------------\n');

testModels(); 