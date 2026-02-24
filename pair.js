const express = require("express");
const fs = require("fs")
const pino = require("pino");
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pn = require("awesome-phonenumber");
const { upload } = require("./upload");
const { makeid } = require("./id");
const router = express.Router()

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false
        fs.rmSync(FilePath, { recursive: true, force: true })
    } catch (e) {
        console.error("Error removing file:", e)
    }
}

const id = makeid();

router.get("/", async (req, res) => {
    let num = req.query.number
    let dirs = "./" + (num || `session`)
    await removeFile(dirs)
    num = num.replace(/[^0-9]/g, "")
    const phone = pn("+" + num)
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: "Invalid phone number. Please enter your full international number without + or spaces." })
        }
        return
    }
    num = phone.getNumber("e164").replace("+", "")

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs)
        try {
            const { version } = await fetchLatestBaileysVersion()
            let IrisBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            })

            IrisBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update
                if (connection === "open") {
                    try {
                        const sessionIris = fs.readFileSync(dirs + "/creds.json")
                        const userJid = jidNormalizedUser(num + "@s.whatsapp.net")

                        const sessionFilePath = dirs + "/creds.json";
                        
                        const link = await upload(`${id}.json`, sessionFilePath);
                        const code = link.split('/')[4] ?? link;
              
              
                        await IrisBot.sendMessage(userJid, { document: sessionIris, mimetype: "application/json", fileName: "creds.json" });
                        
                        await IrisBot.sendMessage(userJid, { text: code });
                        

                        await delay(1000)
                        removeFile(dirs)
                    } catch (error) {
                        removeFile(dirs)
                    }
                }
                if (isNewLogin) {}
                if (isOnline) {}
                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode
                    if (statusCode === 401) {
                        console.log("Logged out. Need new pair code.")
                    } else {
                        initiateSession()
                    }
                }
            })

            if (!IrisBot.authState.creds.registered) {
                await delay(3000)
                num = num.replace(/[^\d+]/g, "")
                if (num.startsWith("+")) num = num.substring(1)
                try {
                    let code = await IrisBot.requestPairingCode(num)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    if (!res.headersSent) {
                        await res.send({ code })
                    }
                } catch (error) {
                    if (!res.headersSent) {
                        res.status(503).send({ code: "Failed to get pairing code. Please check your phone number and try again." })
                    }
                }
            }
            IrisBot.ev.on("creds.update", saveCreds)
        } catch (err) {
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" })
            }
        }
    }

    await initiateSession()
})

process.on("uncaughtException", (err) => {
    let e = String(err)
    if (["conflict","not-authorized","Socket connection timeout","rate-overlimit","Connection Closed","Timed Out","Value not found","Stream Errored","Stream Errored (restart required)","statusCode: 515","statusCode: 503"].some(s => e.includes(s))) return
    console.log("Caught exception: ", err)
})

module.exports = router
