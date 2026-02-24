const express = require('express')
const fs = require('fs')
const pino = require('pino')
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { delay } = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const router = express.Router()
const { makeid } = require("./id");
const { upload } = require("./upload");

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false
        fs.rmSync(FilePath, { recursive: true, force: true })
        return true
    } catch (e) {
        console.error('Error removing file:', e)
        return false
    }
}

const id = makeid();


router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    const dirs = `./qr_sessions/session_${sessionId}`
    if (!fs.existsSync('./qr_sessions')) fs.mkdirSync('./qr_sessions', { recursive: true })

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true })
        const { state, saveCreds } = await useMultiFileAuthState(dirs)
        try {
            const { version } = await fetchLatestBaileysVersion()
            let qrGenerated = false
            let responseSent = false

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return
                qrGenerated = true
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    })
                    if (!responseSent) {
                        responseSent = true
                        await res.send({
                            qr: qrDataURL,
                            message: 'QR Code Generated! Scan it with your WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        })
                    }
                } catch {
                    if (!responseSent) {
                        responseSent = true
                        res.status(500).send({ code: 'Failed to generate QR code' })
                    }
                }
            }

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            }

            let sock = makeWASocket(socketConfig)
            let reconnectAttempts = 0
            const maxReconnectAttempts = 3

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update
                if (qr && !qrGenerated) await handleQRCode(qr)
                if (connection === 'open') {
                    reconnectAttempts = 0
                    try {
                        const sessionIris = fs.readFileSync(dirs + '/creds.json')
                        const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                            ? jidNormalizedUser(sock.authState.creds.me.id)
                            : null
                        const sessionFilePath = dirs + "/creds.json";

                        if (userJid) {
                        	
                        const link = await upload(`${id}.json`, sessionFilePath);
                        const code = link.split('/')[4] ?? link;

                            console.log(link);
              
                            await sock.sendMessage(userJid, { document: sessionIris, mimetype: 'application/json', fileName: 'creds.json' });
                            
                            await sock.sendMessage(userJid, { text: code });
                            console.log(code);
                        }
                    } catch {}
                    setTimeout(() => removeFile(dirs), 15000)
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode
                    if (statusCode === 401) removeFile(dirs)
                    else if (statusCode === 515 || statusCode === 503) {
                        reconnectAttempts++
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            setTimeout(() => {
                                try {
                                    sock = makeWASocket(socketConfig)
                                    sock.ev.on('connection.update', handleConnectionUpdate)
                                    sock.ev.on('creds.update', saveCreds)
                                } catch {}
                            }, 2000)
                        } else if (!responseSent) {
                            responseSent = true
                            res.status(503).send({ code: 'Connection failed after multiple attempts' })
                        }
                    }
                }
            }

            sock.ev.on('connection.update', handleConnectionUpdate)
            sock.ev.on('creds.update', saveCreds)

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true
                    res.status(408).send({ code: 'QR generation timeout' })
                    removeFile(dirs)
                }
            }, 30000)
        } catch {
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' })
            removeFile(dirs)
        }
    }

    await initiateSession()
})

process.on('uncaughtException', (err) => {
    let e = String(err)
    if (["conflict","not-authorized","Socket connection timeout","rate-overlimit","Connection Closed","Timed Out","Value not found","Stream Errored","Stream Errored (restart required)","statusCode: 515","statusCode: 503"].some(s => e.includes(s))) return
    console.log('Caught exception: ', err)
})

module.exports = router
