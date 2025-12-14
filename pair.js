const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { upload } = require("./upload");
const { makeid } = require('./id');
const { useMultiFileAuthState, makeWASocket, DisconnectReason, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('baileys');

const router = express.Router();

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

const delay = ms => new Promise(res => setTimeout(res, ms));

router.get('/', async (req, res) => {
  const id = makeid();
  let num = req.query.number;

  async function getPaire() {
    const stateDir = path.join(__dirname, 'temp', id);

    try {

  const { state, saveCreds } = await useMultiFileAuthState(stateDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino().child({ level: 'fatal', stream: 'store' })
      )
    },
    version,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Edge'),
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true
  });

      if (!sock.authState.creds.registered) {
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
          if (!res.headersSent) res.status(500).send({ code: 'Pairing request failed', error: String(err) });
          await removeFile(stateDir);
          try { sock?.ws?.close(); } catch (e) {}
          return;
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          await delay(3000);
          const credsPath = path.join(stateDir, 'creds.json');

          if (fs.existsSync(credsPath)) {
            try {
              const link = await upload(`${id}.json`, credsPath);
              const code = link.split('/')[4] ?? link;

              try { await sock.sendMessage(sock.user.id, { text: `${code}` }); } catch (e) {}

              await delay(2000);
              try { await sock.ws.close(); } catch (e) {}
              await removeFile(stateDir);
            } catch (uErr) {}
          }
        } else if (connection === 'close' && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output?.statusCode !== 401) {
          await delay(12000);
          getPaire();
        } else if (connection === 'close') {
          await removeFile(stateDir);
        }
      });

    } catch (err) {
      await removeFile(path.join(__dirname, 'temp', id));
      if (!res.headersSent) {
        res.status(503).send({ code: 'Service Unavailable', error: String(err) });
      }
    }
  }

  getPaire();
});

module.exports = router;
