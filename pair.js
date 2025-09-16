const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const pino = require("pino");
const path = require('path');
const { 
  default: WASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require("baileys");

let router = express.Router();

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();
  let num = req.query.number;

  async function getPaire() {
    const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
    const { version } = await fetchLatestBaileysVersion();

    try {
      let session = WASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys, 
            pino({ level: "fatal" }).child({ level: "fatal" })
          ),
        },
        printQRInTerminal: false,
        version,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Desktop"),
      });

      // Generate pairing code if not registered
      if (!session.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, '');
        const code = await session.requestPairingCode(num);
        if (!res.headersSent) {
          return res.send({ code });
        }
      }

      session.ev.on('creds.update', saveCreds);

      session.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          // Wait a bit to ensure creds saved
          await delay(3000);

          // Send creds.json file directly
          const filePath = path.join(__dirname, `temp/${id}/creds.json`);
          await session.sendMessage(session.user.id, {
            document: { url: filePath },
            mimetype: "application/json",
            fileName: `${id}.json`
          });

          await delay(1000);
          await session.ws.close();
          return removeFile(`./temp/${id}`);
        } else if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode != 401
        ) {
          await delay(12000);
          getPaire();
        }
      });

    } catch (err) {
      console.log("service restarted");
      removeFile('./temp/' + id);
      if (!res.headersSent) {
        res.send({ code: "Service Unavailable" });
      }
    }
  }

  getPaire();
});

module.exports = router;
