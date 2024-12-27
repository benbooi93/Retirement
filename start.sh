#!/bin/bash

echo "Cleaning up existing processes..."
# Kill any existing Node.js processes and ngrok
pkill -f node || true
pkill -f ngrok || true

# Wait a moment to ensure ports are freed
sleep 2

echo "Starting ngrok..."
# Start ngrok in a new terminal window (this keeps it separate from our script)
osascript -e 'tell app "Terminal" to do script "ngrok http 5050"' &

# Wait for ngrok to initialize and be ready
echo "Waiting for ngrok to initialize..."
sleep 5

# Keep trying to get the ngrok URL until successful
MAX_RETRIES=10
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "Attempting to get ngrok URL (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep -o '[^"]*$' | sed 's/https:\/\///')
    
    if [ ! -z "$NGROK_URL" ]; then
        echo "Successfully got ngrok URL: $NGROK_URL"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    sleep 2
done

if [ -z "$NGROK_URL" ]; then
    echo "Failed to get ngrok URL after $MAX_RETRIES attempts"
    exit 1
fi

# Update the .env file
echo "Updating .env file with new ngrok URL..."
sed -i '' "s/DOMAIN=.*/DOMAIN=$NGROK_URL/" .env

# Display Twilio configuration instructions
echo "=========================================="
echo "Please update your Twilio Voice Configuration with these URLs:"
echo ""
echo "Voice Configuration URL:"
echo "https://$NGROK_URL/incoming-call"
echo ""
echo "Status Callback URL:"
echo "https://$NGROK_URL/status-callback"
echo "=========================================="
echo "Press Enter after updating Twilio to start the server..."
read

echo "Starting Node.js server..."
# Start the Node.js server in the current terminal
node index.js 