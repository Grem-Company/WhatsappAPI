const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeGenerator = require('qrcode');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

// Load environment variables
dotenv.config();

// Make sure the session directory exists
const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// Make sure puppeteer temp directory exists and is clean
const puppeteerDir = path.join('/tmp', 'puppeteer_data');
if (fs.existsSync(puppeteerDir)) {
  try {
    fs.rmSync(puppeteerDir, { recursive: true, force: true });
    console.log('Cleaned puppeteer directory');
  } catch (err) {
    console.log('Could not clean puppeteer directory:', err.message);
  }
}
fs.mkdirSync(puppeteerDir, { recursive: true });

// Funzione per pulire i dati vecchi
function cleanOldData() {
  try {
    // Pulisci la cache di Puppeteer
    if (fs.existsSync(puppeteerDir)) {
      const stats = fs.statSync(puppeteerDir);
      const sizeInMB = stats.size / (1024 * 1024);
      if (sizeInMB > 500) { // Se supera 500MB
        fs.rmSync(puppeteerDir, { recursive: true, force: true });
        fs.mkdirSync(puppeteerDir, { recursive: true });
        console.log('Cleaned oversized puppeteer directory');
      }
    }

    // Pulisci i file di sessione se diventano troppo grandi
    const sessionPath = path.join(process.cwd(), '.wwebjs_auth');
    if (fs.existsSync(sessionPath)) {
      const sessionSize = getDirectorySize(sessionPath);
      const sessionSizeMB = sessionSize / (1024 * 1024);
      
      console.log(`Session size: ${sessionSizeMB.toFixed(2)} MB`);
      
      // Se la sessione supera 200MB, pulisci i file più vecchi
      if (sessionSizeMB > 200) {
        console.log('Session size exceeded 200MB, cleaning old files...');
        
        // Pulisci i file di cache dei messaggi
        const defaultPath = path.join(sessionPath, 'Default');
        if (fs.existsSync(defaultPath)) {
          const filesToClean = [
            'IndexedDB',
            'Local Storage',
            'Session Storage',
            'databases',
            'Code Cache',
            'GPUCache'
          ];
          
          filesToClean.forEach(folder => {
            const folderPath = path.join(defaultPath, folder);
            if (fs.existsSync(folderPath)) {
              try {
                fs.rmSync(folderPath, { recursive: true, force: true });
                console.log(`Cleaned ${folder} folder`);
              } catch (err) {
                console.log(`Could not clean ${folder}:`, err.message);
              }
            }
          });
        }
      }
      
      // Pulisci i file di sessione vecchi (mantieni solo gli ultimi 7 giorni)
      const files = fs.readdirSync(sessionPath, { withFileTypes: true });
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      files.forEach(file => {
        const filePath = path.join(sessionPath, file.name);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtime.getTime() < sevenDaysAgo && file.name !== 'Default') {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`Cleaned old session file: ${file.name}`);
          }
        } catch (err) {
          console.log(`Could not clean ${file.name}:`, err.message);
        }
      });
    }

    console.log('Data cleanup completed');
  } catch (error) {
    console.error('Error during data cleanup:', error);
  }
}

// Funzione helper per calcolare la dimensione di una directory
function getDirectorySize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  
  let totalSize = 0;
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      totalSize += getDirectorySize(filePath);
    } else {
      try {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      } catch (err) {
        // Ignora errori di accesso ai file
      }
    }
  });
  
  return totalSize;
}

// Esegui la pulizia ogni 6 ore
setInterval(cleanOldData, 6 * 60 * 60 * 1000);

// Pulizia più frequente solo per la sessione (ogni ora)
setInterval(() => {
  try {
    const sessionPath = path.join(process.cwd(), '.wwebjs_auth');
    if (fs.existsSync(sessionPath)) {
      const sessionSize = getDirectorySize(sessionPath);
      const sessionSizeMB = sessionSize / (1024 * 1024);
      
      console.log(`Hourly session check: ${sessionSizeMB.toFixed(2)} MB`);
      
      // Se supera 150MB, pulisci immediatamente
      if (sessionSizeMB > 150) {
        console.log('Session size exceeded 150MB, cleaning now...');
        cleanOldData();
      }
    }
  } catch (error) {
    console.error('Error in hourly session cleanup:', error);
  }
}, 60 * 60 * 1000); // Ogni ora

// Esegui la pulizia all'avvio
cleanOldData();

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*', // In production, change this to specific origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
const PORT = process.env.PORT || 3001;
const proxyConfig = {
  server: process.env.PROXY_URL,
  username: process.env.PROXY_USERNAME,
  password: process.env.PROXY_PASSWORD
};
// Variable to store the latest QR code
let latestQR = null;
let qrGenTime = null;

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

// Function to create WhatsApp client
function createWhatsAppClient() {
  return new Client({
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
        '--disk-cache-size=104857600', // Ridotto a 100MB
        '--media-cache-size=52428800', // 50MB per media
        '--max_old_space_size=512', // Limite memoria Node.js a 512MB
        '--aggressive-cache-discard',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-databases', // Disabilita il database locale
        '--disable-local-storage', // Disabilita il local storage
        '--disable-session-storage', // Disabilita il session storage
        `--user-data-dir=${puppeteerDir}`
      ],
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ignoreHTTPSErrors: true,
      timeout: 60000
    },
    authStrategy: new LocalAuth({ 
      dataPath: '.wwebjs_auth',
      clientId: 'whatsapp-api-' + Math.random().toString(36).substring(2, 15)
    }),
    qrMaxRetries: 5,
    authTimeoutMs: 60000,
    restartOnAuthFail: true,
    // Limita il download automatico dei media
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0
  });
}

// Initialize WhatsApp client
let client = createWhatsAppClient();

// Set up client event handlers
function setupClientEvents() {
  // Aggiungi l'autenticazione del proxy prima di inizializzare il client
  client.on('browser', async (browser) => {
    const page = await browser.newPage();
    await page.authenticate({
      username: proxyConfig.username,
      password: proxyConfig.password
    });
  });

  // WhatsApp event handling
  client.on('qr', (qr) => {
    console.log('\n\n=== SCAN THIS QR CODE WITH YOUR WHATSAPP APP ===\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=== This QR will expire after a few minutes. Scan it now! ===\n\n');
    
    // Save the latest QR code
    latestQR = qr;
    qrGenTime = new Date();
  });

  client.on('ready', () => {
    console.log('\n🟢 WhatsApp client ready and connected!');
    console.log('🔄 The session will be maintained even after server restart\n');
    
    // Clear QR code when client is ready
    latestQR = null;
    qrGenTime = null;
  });

  client.on('authenticated', () => {
    console.log('✅ Authentication completed and session saved');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Authentication error:', msg);
    console.log('🔄 Trying to restart the client...');
    restartClient();
  });

  client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp client disconnected:', reason);
    console.log('🔄 Attempting to reconnect...');
    restartClient();
  });
}

// Function to safely restart the client
async function restartClient() {
  try {
    console.log('Cleaning up and restarting WhatsApp client...');
    
    // Clear existing QR code
    latestQR = null;
    qrGenTime = null;
    
    // Try to gracefully destroy the old client
    try {
      await client.destroy();
    } catch (err) {
      console.log('Error while destroying client (this is normal):', err.message);
    }
    
    // Clean puppeteer directory
    try {
      if (fs.existsSync(puppeteerDir)) {
        fs.rmSync(puppeteerDir, { recursive: true, force: true });
      }
      fs.mkdirSync(puppeteerDir, { recursive: true });
    } catch (err) {
      console.log('Could not clean puppeteer directory:', err.message);
    }
    
    // Wait a bit for everything to clean up
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Create and initialize a new client
    client = createWhatsAppClient();
    setupClientEvents();
    client.initialize();
  } catch (error) {
    console.error('Failed to restart client:', error);
  }
}

// Function to verify the connection status and reconnect if needed
async function verifyConnection() {
  try {
    console.log('Verifying WhatsApp connection status...');
    
    let needsRestart = false;
    let state = null;
    
    // Check if client exists and try to get state
    try {
      if (client) {
        state = await client.getState();
        console.log('Current connection state:', state);
      } else {
        console.log('Client object does not exist');
        needsRestart = true;
      }
    } catch (error) {
      console.error('Error getting client state:', error.message);
      needsRestart = true;
    }
    
    // Check if we need to restart based on state
    if (!state || state === 'DISCONNECTED') {
      console.log('Client is disconnected or in invalid state');
      needsRestart = true;
    }
    
    // Check if we have an active session but it's disconnected
    if (!needsRestart && !latestQR) {
      try {
        // Check if we have a valid session but lost connection
        const isAuthenticated = fs.existsSync(path.join(sessionDir, 'Default', 'session'));
        if (isAuthenticated && state !== 'CONNECTED') {
          console.log('Session exists but not connected, trying to reconnect');
          needsRestart = true;
        }
      } catch (error) {
        console.error('Error checking session files:', error.message);
      }
    }
    
    if (needsRestart) {
      console.log('Connection verification indicates restart needed');
      await restartClient();
      return false;
    }
    
    return state === 'CONNECTED';
  } catch (error) {
    console.error('Error in verifyConnection:', error);
    return false;
  }
}

// Set up regular connection verification (every 5 minutes)
setInterval(verifyConnection, 5 * 60 * 1000);

// Set up client event handlers initially
setupClientEvents();

// Initialize the WhatsApp client
client.initialize().catch(err => {
  console.error('Error initializing client:', err);
  console.log('Will attempt to restart...');
  setTimeout(restartClient, 5000);
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

// Status endpoint
app.get('/api/status', authenticateToken, async (req, res) => {
  let isConnected = false;
  let connectionInfo = null;
  
  try {
    // Verifica più completa dello stato di connessione
    if (client) {
      // Verifica se il client è stato inizializzato correttamente
      const state = await client.getState();
      console.log('Current WhatsApp state:', state);
      
      // I possibili stati sono: CONNECTED, DISCONNECTED, CONNECTING, SYNCING, RESUMING, o null
      isConnected = state === 'CONNECTED';
      
      // Raccogli informazioni sul client se disponibili
      if (client.info && client.info.wid) {
        connectionInfo = {
          phone: client.info.wid.user,
          name: client.info.pushname || 'Not available',
          state: state
        };
      }
    }
  } catch (error) {
    console.error('Error checking WhatsApp state:', error);
    isConnected = false;
  }
  
  // Raccogli informazioni aggiuntive sul client
  let clientHealth = {
    initialized: !!client,
    hasEvents: client ? client.listenerCount('message') > 0 : false,
    puppeteerConnected: false
  };
  
  // Verifica se Puppeteer è connesso
  try {
    if (client && client.pupPage) {
      clientHealth.puppeteerConnected = true;
    }
  } catch (error) {
    console.error('Error checking Puppeteer connection:', error);
  }
  
  res.json({ 
    status: 'online',
    whatsapp: isConnected ? 'connected' : 'disconnected',
    info: connectionInfo,
    qrAvailable: latestQR !== null,
    qrGeneratedAt: qrGenTime,
    clientHealth: clientHealth,
    queue: messageQueue.getStatus()
  });
});

// QR Code endpoint
app.get('/api/qrcode', authenticateToken, async (req, res) => {
  const format = req.query.format || 'html';
  
  // Se non c'è un QR code disponibile, forzare la generazione automaticamente
  if (!latestQR) {
    console.log("QR code non disponibile, generazione automatica in corso...");
    
    try {
      // Riavvia il client
      await restartClient();
      
      // Attendi che il QR code venga generato (timeout dopo 30 secondi)
      let timeoutCounter = 0;
      while (!latestQR && timeoutCounter < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        timeoutCounter++;
        console.log(`Attesa QR code: ${timeoutCounter} secondi...`);
      }
      
      if (!latestQR) {
        return res.status(500).json({ 
          error: 'Impossibile generare il QR code entro il timeout',
          message: 'Riprova più tardi o controlla i log del server'
        });
      }
    } catch (error) {
      console.error('Errore nella generazione del QR code:', error);
      return res.status(500).json({ 
        error: 'Errore nella generazione del QR code',
        message: error.message 
      });
    }
  }
  
  try {
    switch (format) {
      case 'base64':
        // Generate QR code as data URL
        const dataUrl = await qrcodeGenerator.toDataURL(latestQR);
        res.json({ qr: dataUrl, generatedAt: qrGenTime });
        break;
        
      case 'json':
        // Return raw QR string
        res.json({ qr: latestQR, generatedAt: qrGenTime });
        break;
        
      case 'html':
      default:
        // Generate HTML with QR code
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>WhatsApp QR Code</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body {
                  font-family: Arial, sans-serif;
                  text-align: center;
                  margin: 0;
                  padding: 20px;
                  background-color: #f0f2f5;
                }
                .container {
                  max-width: 500px;
                  margin: 0 auto;
                  background-color: white;
                  padding: 20px;
                  border-radius: 10px;
                  box-shadow: 0px 3px 10px rgba(0,0,0,0.1);
                }
                h1 {
                  color: #128C7E;
                }
                .qr-container {
                  margin: 20px auto;
                  padding: 15px;
                  background: white;
                  border-radius: 5px;
                  display: inline-block;
                }
                .qr-container img {
                  max-width: 100%;
                }
                .info {
                  margin-top: 20px;
                  color: #666;
                }
                .expiry {
                  color: #e53935;
                  font-weight: bold;
                  margin-top: 15px;
                }
                @media (prefers-color-scheme: dark) {
                  body {
                    background-color: #222;
                    color: #eee;
                  }
                  .container {
                    background-color: #333;
                  }
                  .qr-container {
                    background-color: white;
                  }
                  .info {
                    color: #bbb;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>WhatsApp Authentication</h1>
                <div class="qr-container">
                  <img src="${await qrcodeGenerator.toDataURL(latestQR)}" alt="WhatsApp QR Code">
                </div>
                <p class="info">Scan this code with your WhatsApp app to connect</p>
                <p class="info">Generated: ${qrGenTime.toISOString()}</p>
                <p class="expiry">This QR code will expire in a few minutes</p>
              </div>
            </body>
          </html>
        `;
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
        break;
    }
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
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

// Endpoint to force connection verification
app.post('/api/verify-connection', authenticateToken, async (req, res) => {
  console.log("Forcing connection verification");
  try {
    const isConnected = await verifyConnection();
    
    if (isConnected) {
      res.json({ 
        success: true, 
        message: 'WhatsApp is connected', 
        state: 'CONNECTED' 
      });
    } else {
      // Get current state if possible
      let currentState = 'UNKNOWN';
      try {
        if (client) {
          currentState = await client.getState() || 'UNKNOWN';
        }
      } catch (error) {
        console.error('Error getting state during verification:', error);
      }
      
      res.json({ 
        success: false, 
        message: 'WhatsApp is not connected. Restart process initiated.', 
        state: currentState,
        qrAvailable: latestQR !== null
      });
    }
  } catch (error) {
    console.error('Error during connection verification:', error);
    res.status(500).json({ 
      error: 'Error during connection verification',
      message: error.message 
    });
  }
});

// Endpoint to force new QR code generation
app.post('/api/refresh-qr', authenticateToken, async (req, res) => {
  console.log("Forcing new QR code generation");
  try {
    // First try to logout if already connected
    try {
      if (client.info && client.info.wid) {
        await client.logout();
        console.log("Logged out from existing session");
      }
    } catch (logoutError) {
      console.log("No active session to logout from, proceeding with restart");
    }
    
    // Destroy the client and recreate it
    console.log("Destroying and recreating WhatsApp client");
    client.destroy();
    
    // Clear QR code
    latestQR = null;
    qrGenTime = null;
    
    // Wait a short time to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize a new client
    client.initialize();
    
    // Wait for QR code to be generated (timeout after 30 seconds)
    let timeoutCounter = 0;
    while (!latestQR && timeoutCounter < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      timeoutCounter++;
    }
    
    if (latestQR) {
      res.json({ 
        success: true, 
        message: 'New QR code generated successfully',
        qrAvailable: true
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate new QR code in time',
        message: 'Please try again or check server logs'
      });
    }
  } catch (error) {
    console.error('Error refreshing QR code:', error);
    res.status(500).json({ 
      error: 'Error refreshing QR code',
      message: error.message 
    });
  }
});

// Endpoint per verificare la connessione al proxy
app.get('/api/check-proxy', authenticateToken, async (req, res) => {
  try {
    const proxyUrl = proxyConfig.server;
    const proxyHost = proxyUrl.split('://')[1].split(':')[0];
    const proxyPort = proxyUrl.split(':')[2];

    const response = await axios.get('https://api.ipify.org?format=json', {
      proxy: {
        protocol: 'https',
        host: proxyHost,
        port: proxyPort,
        auth: {
          username: proxyConfig.username,
          password: proxyConfig.password
        }
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: true
      })
    });

    res.json({
      success: true,
      ip: response.data.ip,
      proxy: {
        server: proxyUrl,
        username: proxyConfig.username
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      proxy: {
        server: proxyConfig.server,
        username: proxyConfig.username
      }
    });
  }
});

// Endpoint per monitorare l'uso dello storage
app.get('/api/storage-info', authenticateToken, (req, res) => {
  try {
    const getDirectorySize = (dirPath) => {
      if (!fs.existsSync(dirPath)) return 0;
      
      let totalSize = 0;
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      
      files.forEach(file => {
        const filePath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
          totalSize += getDirectorySize(filePath);
        } else {
          try {
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
          } catch (err) {
            // Ignora errori di accesso ai file
          }
        }
      });
      
      return totalSize;
    };

    const sessionSize = getDirectorySize(path.join(process.cwd(), '.wwebjs_auth'));
    const puppeteerSize = getDirectorySize(puppeteerDir);
    const totalSize = sessionSize + puppeteerSize;

    res.json({
      storage: {
        session: {
          size: sessionSize,
          sizeFormatted: `${(sessionSize / (1024 * 1024)).toFixed(2)} MB`
        },
        puppeteer: {
          size: puppeteerSize,
          sizeFormatted: `${(puppeteerSize / (1024 * 1024)).toFixed(2)} MB`
        },
        total: {
          size: totalSize,
          sizeFormatted: `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error getting storage info',
      message: error.message
    });
  }
});

// Endpoint per forzare la pulizia
app.post('/api/clean-storage', authenticateToken, (req, res) => {
  try {
    cleanOldData();
    res.json({
      success: true,
      message: 'Storage cleanup completed'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error cleaning storage',
      message: error.message
    });
  }
});

// Server startup
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Use Bearer token: ${process.env.API_TOKEN}`);
}); 