# API WhatsApp con Autenticazione Bearer Token

Un'API RESTful per inviare messaggi WhatsApp con autenticazione tramite bearer token usando la libreria whatsapp-web.js.

## Requisiti

- Node.js (v14 o superiore)
- NPM

## Installazione

1. Clona il repository
2. Installa le dipendenze:
   ```
   npm install
   ```
3. Crea un file `.env` con le seguenti variabili:
   ```
   PORT=3000
   API_TOKEN=token_di_esempio
   ```

## Avvio

```
npm start
```

Per lo sviluppo con riavvio automatico:
```
npm run dev
```

Al primo avvio, verrà generato un codice QR nel terminale da scansionare con WhatsApp sul tuo telefono per l'autenticazione.

## Persistenza della Sessione

L'API mantiene automaticamente la sessione WhatsApp anche dopo il riavvio del server:
- La sessione viene salvata nella cartella `.wwebjs_auth`
- Non è necessario scansionare il codice QR ad ogni riavvio
- Per disconnettere manualmente, è disponibile un endpoint apposito (`/api/logout`)

## Sistema Anti-Ban

Per evitare i ban di WhatsApp, l'API implementa un sistema di coda che limita l'invio dei messaggi:

- Massimo un messaggio ogni 30-60 secondi (tempo di attesa casuale)
- I messaggi vengono messi in coda e inviati automaticamente rispettando questi limiti
- Le richieste API restituiscono informazioni sulla coda e sui tempi di attesa

## Endpoints API

### Stato del Servizio
```
GET /api/status
```
Header richiesto:
```
Authorization: Bearer <token-da-env-file>
```
Risposta: Stato del servizio incluse informazioni sulla coda e sulla connessione WhatsApp.

### Invio Messaggio
```
POST /api/send
```
Header richiesto:
```
Authorization: Bearer <token-da-env-file>
Content-Type: application/json
```
Body:
```json
{
  "number": "391234567890", 
  "message": "Ciao, questo è un messaggio di prova",
  "options": {} // Opzioni addizionali (opzionale)
}
```
Nota: 
- Il numero deve essere in formato internazionale senza il '+' o altri caratteri speciali
- Il messaggio verrà messo in coda e inviato rispettando i limiti di tempo
- La risposta includerà informazioni sul tempo di attesa stimato

### Stato della Coda
```
GET /api/queue
```
Header richiesto:
```
Authorization: Bearer <token-da-env-file>
```
Risposta: Informazioni sulla coda di messaggi, inclusi il numero di messaggi in attesa.

### Disconnessione WhatsApp
```
POST /api/logout
```
Header richiesto:
```
Authorization: Bearer <token-da-env-file>
```
Risposta: Conferma della disconnessione da WhatsApp. Sarà necessario scansionare nuovamente il QR code per riconnettersi.

## Esempi di Utilizzo con cURL

### Ottenere lo stato del servizio
```
curl -X GET http://localhost:3000/api/status \
  -H "Authorization: Bearer <token-da-env-file>"
```

### Inviare un messaggio
```
curl -X POST http://localhost:3000/api/send \
  -H "Authorization: Bearer <token-da-env-file>" \
  -H "Content-Type: application/json" \
  -d '{"number":"391234567890","message":"Messaggio di test"}'
```

### Verificare lo stato della coda
```
curl -X GET http://localhost:3000/api/queue \
  -H "Authorization: Bearer <token-da-env-file>"
```

### Disconnettere WhatsApp
```
curl -X POST http://localhost:3000/api/logout \
  -H "Authorization: Bearer <token-da-env-file>"
``` 