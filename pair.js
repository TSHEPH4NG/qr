const { upload } = require("./upload");
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const path = require('path');
const makeWASocket = require('baron-baileys-v2').default;
const {
default:
generateWAMessageFromContent,
getAggregateVotesInPollMessage,
downloadContentFromMessage,
useMultiFileAuthStateV2,
generateWAMessage,
makeInMemoryStore,
DisconnectReason,
areJidsSameUser,
getContentType,
decryptPollVote,
relayMessage,
jidDecode,
Browsers,
proto,
} = require("baron-baileys-v2");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

const { readFile } = require("node:fs/promises");

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function getPaire() {
        const { state, saveCreds } = await useMultiFileAuthStateV2('./temp/' + id);
        /*const { version } = await fetchLatestBaileysVersion();*/
        try {
            let session = WASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            });

            if (!session.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await session.requestPairingCode(num,"TSHEPANG");
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            session.ev.on('creds.update', saveCreds);

            session.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection == "open") {
                	await delay(3000);
                    let link = await upload(`${id}.json`, __dirname + `/temp/${id}/creds.json`);
                    let code = link.split("/")[4];
                    await session.sendMessage(session.user.id, { text: `${code}` });
                    
                     await delay(2000);
                    await session.ws.close();
                    return await removeFile(`./temp/${id}`);
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
            console.log("service restated");
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

   getPaire();
});

module.exports = router;
