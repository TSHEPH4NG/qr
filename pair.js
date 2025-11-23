const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const { upload } = require("./upload");
const { makeid } = require('./id');
const { useMultiFileAuthState, makeWASocket, DisconnectReason , Browsers , makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const router = express.Router();

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

const delay = ms => new Promise(res => setTimeout(res, ms));

router.get('/', async (req, res) => {
  const id = makeid();
  let num = req.query.number;

  // spawn pairing routine
  async function getPaire() {
    // create temp dir for state
    const stateDir = path.join(__dirname, 'temp', id);
    try {
      // useMultiFileAuthState creates state + saveCreds callback
      const { state, saveCreds } = await useMultiFileAuthState(stateDir);

      // create socket
      const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "silent" })
                )
            },
            browser: Browsers.ubuntu("Chrome"),
            logger: Pino({ level: "silent" }),
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
      });

      // if not registered, request pairing code via phone number
      if (!sock.authState?.creds?.registered) {
        // sanitize number
        if (!num) {
          if (!res.headersSent) res.status(400).send({ error: 'number query required' });
          await removeFile(stateDir);
          return;
        }
        num = String(num).replace(/[^0-9]/g, '');
        try {
          const pairing = await sock.requestPairingCode(num);
          if (!res.headersSent) res.send({ code: pairing });
        } catch (err) {
          // requestPairingCode can fail depending on version/WhatsApp state
          console.error('requestPairingCode error:', err?.message ?? err);
          if (!res.headersSent) res.status(500).send({ code: 'Pairing request failed', error: String(err) });
          await removeFile(stateDir);
          try { sock?.ws?.close(); } catch (e) {}
          return;
        }
      }

      // save credentials on update
      sock.ev.on('creds.update', saveCreds);

      // connection updates
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          // give creds time to flush
          await delay(3000);
          const credsPath = path.join(stateDir, 'creds.json');
          if (fs.existsSync(credsPath)) {
            try {
              const link = await upload(`${id}.json`, credsPath);
              const code = link.split('/')[4] ?? link;
              // send the code to the account itself (optional)
              try { await sock.sendMessage(sock.user.id, { text: `${code}` }); } catch (e) {}
              // close socket neatly and cleanup
              await delay(2000);
              try { await sock.ws.close(); } catch (e) {}
              await removeFile(stateDir);
            } catch (uErr) {
              console.error('upload failed', uErr);
            }
          } else {
            console.warn('creds.json not found after open');
          }
        } else if (connection === 'close' && lastDisconnect && lastDisconnect.error &&
                   lastDisconnect.error.output?.statusCode !== 401) {
          // transient error -> retry
          await delay(12000);
          // restart pairing flow
          getPaire();
        } else if (connection === 'close') {
          // if 401 or other auth issue, cleanup
          await removeFile(stateDir);
        }
      });

    } catch (err) {
      console.error('service restarted / error in pairing flow:', err?.message ?? err);
      await removeFile(path.join(__dirname, 'temp', id));
      if (!res.headersSent) {
        res.status(503).send({ code: 'Service Unavailable', error: String(err) });
      }
    }
  }

  getPaire();
});

module.exports = router;
