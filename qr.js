const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require("pino");
const { 
    default: WASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    fetchLatestBaileysVersion
} = require("baileys");

let router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();

    const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
    const { version } = await fetchLatestBaileysVersion();

    try {
        let session = WASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            version,
            browser: Browsers.macOS("Desktop")
        });

        session.ev.on('creds.update', saveCreds);

        let qrSent = false;

        session.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Send QR only once
            if (qr && !qrSent) {
                qrSent = true;
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(await QRCode.toBuffer(qr));
            }

            if (connection === "open") {
                await delay(3000); // ensure creds saved

                // Send JSON file directly to self
                await session.sendMessage(session.user.id, {
                    document: { url: path.join(__dirname, `temp/${id}/creds.json`) },
                    mimetype: "application/json",
                    fileName: `${id}.json`
                });

                await delay(1000);
                await session.ws.close();
                removeFile(path.join(__dirname, "temp", id));
            }

            // Reconnect if unexpected close
            if (connection === "close" && lastDisconnect?.error?.output?.statusCode != 401) {
                await delay(10000);
                router.handle(req, res); // restart QR flow safely
            }
        });
    } catch (err) {
        if (!res.headersSent) {
            res.json({ code: "Service Unavailable" });
        }
        console.log(err);
        removeFile(path.join(__dirname, "temp", id));
    }
});

module.exports = router;
