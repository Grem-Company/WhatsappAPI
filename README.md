# WhatsApp API with Bearer Token Authentication

A RESTful API for sending WhatsApp messages with bearer token authentication using the whatsapp-web.js library.

## Requirements

- Node.js (v14 or higher)
- NPM

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   PORT=3000
   API_TOKEN=your_example_token
   ```

## Startup

```
npm start
```

For development with automatic restart:
```
npm run dev
```

On first launch, a QR code will be generated in the terminal that you'll need to scan with WhatsApp on your phone for authentication.

## Docker Deployment

### Build and run with Docker

1. Build the Docker image:
   ```
   docker build -t whatsapp-api .
   ```

2. Run the container:
   ```
   docker run -p 3000:3000 -e API_TOKEN=your-secure-token --name whatsapp-api -v whatsapp-auth:/app/.wwebjs_auth whatsapp-api
   ```

### Using Docker Compose (Recommended)

1. Customize the environment variables in `docker-compose.yml` if needed
2. Start the services:
   ```
   docker-compose up -d
   ```
3. View logs to scan the QR code when first starting:
   ```
   docker-compose logs -f
   ```

The session data is persisted in a Docker volume, so you won't need to scan the QR code again after restarts.

## Session Persistence

The API automatically maintains the WhatsApp session even after server restart:
- The session is saved in the `.wwebjs_auth` folder
- You don't need to scan the QR code every time you restart the server
- To manually disconnect, a specific endpoint is available (`/api/logout`)

## Anti-Ban System

To avoid WhatsApp bans, the API implements a queue system that limits message sending:

- Maximum one message every 30-60 seconds (random wait time)
- Messages are queued and sent automatically respecting these limits
- API responses include information about the queue and estimated wait times

## API Endpoints

### Service Status
```
GET /api/status
```
Required header:
```
Authorization: Bearer <token-from-env-file>
```
Response: Service status including queue and WhatsApp connection information.

### Send Message
```
POST /api/send
```
Required header:
```
Authorization: Bearer <token-from-env-file>
Content-Type: application/json
```
Body:
```json
{
  "number": "391234567890", 
  "message": "Hi, this is a test message",
  "options": {} // Additional options (optional)
}
```
Note: 
- The number must be in international format without '+' or other special characters
- The message will be queued and sent respecting the time limits
- The response will include information about the estimated wait time

### Queue Status
```
GET /api/queue
```
Required header:
```
Authorization: Bearer <token-from-env-file>
```
Response: Information about the message queue, including the number of messages waiting.

### WhatsApp Disconnection
```
POST /api/logout
```
Required header:
```
Authorization: Bearer <token-from-env-file>
```
Response: Confirmation of disconnection from WhatsApp. You'll need to scan the QR code again to reconnect.

## Usage Examples with cURL

### Get Service Status
```
curl -X GET http://localhost:3000/api/status \
  -H "Authorization: Bearer <token-from-env-file>"
```

### Send a Message
```
curl -X POST http://localhost:3000/api/send \
  -H "Authorization: Bearer <token-from-env-file>" \
  -H "Content-Type: application/json" \
  -d '{"number":"391234567890","message":"Test message"}'
```

### Check Queue Status
```
curl -X GET http://localhost:3000/api/queue \
  -H "Authorization: Bearer <token-from-env-file>"
```

### Disconnect WhatsApp
```
curl -X POST http://localhost:3000/api/logout \
  -H "Authorization: Bearer <token-from-env-file>"
``` 