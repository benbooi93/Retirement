# OpenAI Voice Assistant with Twilio Integration

This project implements a voice assistant using OpenAI's Real-time Audio API and Twilio for phone call handling. The assistant can engage in natural conversations with users over the phone.

## Features

- Real-time voice conversations using OpenAI's Audio API
- Phone call handling with Twilio
- WebSocket-based audio streaming
- Automatic speech-to-text and text-to-speech conversion
- Configurable system messages and voice settings

## Prerequisites

- Node.js (v14 or higher)
- OpenAI API key (organization-scoped key starting with `sk-org-`)
- Twilio account with:
  - Account SID
  - Auth Token
  - Phone number

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/benbooi93/Retirement.git
   cd Retirement
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your credentials:
   ```
   OPENAI_API_KEY=your_openai_key
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   PHONE_NUMBER_FROM=your_twilio_phone_number
   DOMAIN=your_ngrok_domain
   PORT=5050
   ```

## Usage

1. Start the server:
   ```bash
   node index.js
   ```

2. Use ngrok to create a tunnel:
   ```bash
   ngrok http 5050
   ```

3. Update your Twilio webhook URL with the ngrok URL

## License

MIT 