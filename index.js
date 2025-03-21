const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Carica le variabili d'ambiente
dotenv.config();

// Assicurati che la directory per la sessione esista
const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Middleware per autenticazione bearer token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token di accesso mancante' });
  }

  try {
    // Verifica contro il token fisso nell'env (rimuovendo spazi)
    const envToken = process.env.API_TOKEN.trim();
    const requestToken = token.trim();
    
    console.log('Token richiesto:', requestToken);
    console.log('Token env:', envToken);
    
    if (requestToken === envToken) {
      next();
      return;
    }
    
    return res.status(403).json({ error: 'Token non valido' });
  } catch (error) {
    return res.status(403).json({ error: 'Token non valido' });
  }
};

// Inizializzazione client WhatsApp
const client = new Client({
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  },
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }), // Usa LocalAuth per mantenere la sessione
  qrMaxRetries: 3,
  authTimeoutMs: 0
});

// Sistema di coda per i messaggi
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastMessageTime = 0;
  }

  // Aggiunge un messaggio alla coda
  add(message) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        resolve,
        reject
      });
      
      // Se la coda non è in elaborazione, inizia il processo
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  // Processa la coda di messaggi
  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    
    try {
      // Calcola quanto tempo attendere prima di inviare il prossimo messaggio
      const now = Date.now();
      let waitTime = 0;
      
      if (this.lastMessageTime > 0) {
        // Genera un tempo di attesa casuale tra 30 e 60 secondi
        const randomWait = Math.floor(Math.random() * 30000) + 30000; // 30-60 secondi
        const elapsedTime = now - this.lastMessageTime;
        
        // Se non è ancora trascorso il tempo minimo, attendi
        if (elapsedTime < randomWait) {
          waitTime = randomWait - elapsedTime;
        }
      }
      
      if (waitTime > 0) {
        console.log(`Attendo ${waitTime/1000} secondi prima del prossimo invio...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Invia il messaggio
      const { number, message, options } = item.message;
      const formattedNumber = number.includes('@c.us') ? number : `${number.replace(/[^\d]/g, '')}@c.us`;
      
      // Verifica se il numero è registrato su WhatsApp
      const isRegistered = await client.isRegisteredUser(formattedNumber);
      if (!isRegistered) {
        throw new Error('Numero non registrato su WhatsApp');
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
    
    // Continua a processare la coda
    setTimeout(() => this.processQueue(), 1000);
  }

  // Restituisce lo stato attuale della coda
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      lastMessageSentAt: this.lastMessageTime ? new Date(this.lastMessageTime).toISOString() : null
    };
  }
}

// Istanzia la coda messaggi
const messageQueue = new MessageQueue();

// Gestione eventi WhatsApp
client.on('qr', (qr) => {
  console.log('\n\n=== SCANSIONA QUESTO CODICE QR CON LA TUA APP WHATSAPP ===\n');
  qrcode.generate(qr, { small: true });
  console.log('\n=== Questo QR scadrà dopo alcuni minuti. Scansionalo subito! ===\n\n');
});

client.on('ready', () => {
  console.log('\n🟢 Client WhatsApp pronto e connesso!');
  console.log('🔄 La sessione sarà mantenuta anche dopo il riavvio del server\n');
});

client.on('authenticated', () => {
  console.log('✅ Autenticazione completata e sessione salvata');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Errore autenticazione:', msg);
  console.log('🔄 Riavvia il server e scansiona nuovamente il codice QR');
});

client.on('disconnected', (reason) => {
  console.log('❌ Client WhatsApp disconnesso:', reason);
  console.log('🔄 Tentativo di riconnessione...');
  client.initialize();
});

// Inizializza il client WhatsApp
client.initialize();

// Endpoint di stato
app.get('/api/status', authenticateToken, (req, res) => {
  const isConnected = client.info && client.info.wid ? true : false;
  
  res.json({ 
    status: 'online',
    whatsapp: isConnected ? 'connected' : 'disconnected',
    info: isConnected ? {
      phone: client.info.wid.user,
      name: client.info.pushname || 'Non disponibile'
    } : null,
    queue: messageQueue.getStatus()
  });
});

// Endpoint per inviare messaggi
app.post('/api/send', authenticateToken, async (req, res) => {
  try {
    const { number, message, options } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({ error: 'Numero e messaggio sono obbligatori' });
    }

    // Aggiungi il messaggio alla coda invece di inviarlo direttamente
    const result = await messageQueue.add({ number, message, options });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Errore nell\'invio del messaggio:', error);
    res.status(500).json({ 
      error: 'Errore nell\'invio del messaggio',
      message: error.message 
    });
  }
});

// Endpoint per verificare lo stato della coda
app.get('/api/queue', authenticateToken, (req, res) => {
  res.json(messageQueue.getStatus());
});

// Endpoint per disconnettere manualmente
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    await client.logout();
    res.json({ success: true, message: 'Disconnessione effettuata con successo' });
  } catch (error) {
    console.error('Errore durante la disconnessione:', error);
    res.status(500).json({ 
      error: 'Errore durante la disconnessione',
      message: error.message 
    });
  }
});

// Avvio del server
app.listen(PORT, () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  console.log(`Usa il token Bearer: ${process.env.API_TOKEN}`);
}); 