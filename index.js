const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Make sure the session directory exists
const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Middleware for bearer token authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    // Verify against the fixed token in env (removing spaces)
    const envToken = process.env.API_TOKEN.trim();
    const requestToken = token.trim();
    
    console.log('Requested token:', requestToken);
    console.log('Env token:', envToken);
    
    if (requestToken === envToken) {
      next();
      return;
    }
    
    return res.status(403).json({ error: 'Invalid token' });
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// WhatsApp client initialization
const client = new Client({
  puppeteer: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--mute-audio',
      '--no-default-browser-check',
      '--user-data-dir=/tmp/puppeteer_data'
    ],
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false
  },
  authStrategy: new LocalAuth({ 
    dataPath: '.wwebjs_auth',
    clientId: 'whatsapp-api-' + Math.random().toString(36).substring(2, 15)
  }),
  qrMaxRetries: 3,
  authTimeoutMs: 0
});

// Message queue system
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastMessageTime = 0;
  }

  // Add a message to the queue
  add(message) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        resolve,
        reject
      });
      
      // If the queue is not being processed, start the process
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  // Process the message queue
  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    
    try {
      // Calculate how long to wait before sending the next message
      const now = Date.now();
      let waitTime = 0;
      
      if (this.lastMessageTime > 0) {
        // Generate a random wait time between 30 and 60 seconds
        const randomWait = Math.floor(Math.random() * 30000) + 30000; // 30-60 seconds
        const elapsedTime = now - this.lastMessageTime;
        
        // If the minimum time hasn't passed yet, wait
        if (elapsedTime < randomWait) {
          waitTime = randomWait - elapsedTime;
        }
      }
      
      if (waitTime > 0) {
        console.log(`Waiting ${waitTime/1000} seconds before the next send...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Send the message
      const { number, message, options } = item.message;
      const formattedNumber = number.includes('@c.us') ? number : `${number.replace(/[^\d]/g, '')}@c.us`;
      
      // Check if the number is registered on WhatsApp
      const isRegistered = await client.isRegisteredUser(formattedNumber);
      if (!isRegistered) {
        throw new Error('Number not registered on WhatsApp');
      }
      
      const sentMessage = await client.sendMessage(formattedNumber, message, options);
      this.lastMessageTime = Date.now();
      
      item.resolve({
        success: true,
        messageId: sentMessage.id.id,
        timestamp: sentMessage.timestamp,
        queueInfo: {
          remainingMessages: this.queue.length,
          waitTime: waitTime
        }
      });
    } catch (error) {
      item.reject(error);
    }
    
    // Continue processing the queue
    setTimeout(() => this.processQueue(), 1000);
  }

  // Return the current status of the queue
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      lastMessageSentAt: this.lastMessageTime ? new Date(this.lastMessageTime).toISOString() : null
    };
  }
}

// Instantiate the message queue
const messageQueue = new MessageQueue();

// WhatsApp event handling
client.on('qr', (qr) => {
  console.log('\n\n=== SCAN THIS QR CODE WITH YOUR WHATSAPP APP ===\n');
  qrcode.generate(qr, { small: true });
  console.log('\n=== This QR will expire after a few minutes. Scan it now! ===\n\n');
});

client.on('ready', () => {
  console.log('\n🟢 WhatsApp client ready and connected!');
  console.log('🔄 The session will be maintained even after server restart\n');
});

client.on('authenticated', () => {
  console.log('✅ Authentication completed and session saved');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication error:', msg);
  console.log('🔄 Restart the server and scan the QR code again');
});

client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp client disconnected:', reason);
  console.log('🔄 Attempting to reconnect...');
  client.initialize();
});

// Initialize the WhatsApp client
client.initialize();

// Status endpoint
app.get('/api/status', authenticateToken, (req, res) => {
  const isConnected = client.info && client.info.wid ? true : false;
  
  res.json({ 
    status: 'online',
    whatsapp: isConnected ? 'connected' : 'disconnected',
    info: isConnected ? {
      phone: client.info.wid.user,
      name: client.info.pushname || 'Not available'
    } : null,
    queue: messageQueue.getStatus()
  });
});

// Endpoint for sending messages
app.post('/api/send', authenticateToken, async (req, res) => {
  console.log("api send");
  try {
    const { number, message, options } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({ error: 'Number and message are required' });
    }

    // Add the message to the queue instead of sending it directly
    const result = await messageQueue.add({ number, message, options });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      error: 'Error sending message',
      message: error.message 
    });
  }
});

// Endpoint to check queue status
app.get('/api/queue', authenticateToken, (req, res) => {
  console.log("api queue");
  res.json(messageQueue.getStatus());
});

// Endpoint for manual disconnection
app.post('/api/logout', authenticateToken, async (req, res) => {
  console.log("api logout");
  try {
    await client.logout();
    res.json({ success: true, message: 'Successfully disconnected' });
  } catch (error) {
    console.error('Error during disconnection:', error);
    res.status(500).json({ 
      error: 'Error during disconnection',
      message: error.message 
    });
  }
});

// Server startup
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Use Bearer token: ${process.env.API_TOKEN}`);
}); 