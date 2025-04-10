const { upload } = require("./upload");
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const path = require('path');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {    
    if (!fs.existsSync(FilePath)) return false;    
    fs.rmSync(FilePath, { recursive: true, force: true });
};

const { readFile } = require("node:fs/promises");

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    let retry = true;  // Flag to control retry attempts

    async function getPaire() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        
        try {
            let session = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!session.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await session.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            session.ev.on('creds.update', saveCreds);

            session.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open" && retry) {
                    retry = false;
                    await delay(10000);
                    let link = await upload(`${id}.json`, __dirname + `/temp/${id}/creds.json`);
                    let code = link.split("/")[4];
                    await session.sendMessage(session.user.id, { text: `${code}` });
                    await delay(100);
                    await session.ws.close();
                    return await removeFile('./temp/' + id);
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    retry = true;
                    await delay(10000);
                    getPaire();
                }
            });

        } catch (err) {
            console.log("service restarted");
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await getPaire();
});

module.exports = router;
