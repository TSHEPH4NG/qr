const { upload } = require('./upload')
const { makeid } = require('./id')
const QRCode = require('qrcode')
const express = require('express')
const path = require('path')
const fs = require('fs')
const pino = require('pino')

const {
  useMultiFileAuthState,
  makeWASocket,
  Browsers,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} = require('baileys')

const router = express.Router()

const delay = ms => new Promise(r => setTimeout(r, ms))

function removeFile(p) {
  if (!fs.existsSync(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

router.get('/', async (req, res) => {
  const id = makeid()
  const basePath = path.join(__dirname, 'temp', id)
  let responded = false

  async function start() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(basePath)
      const { version } = await fetchLatestBaileysVersion()

      const sock = makeWASocket({
        version,
        browser: Browsers.ubuntu('Edge'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        logger: pino({ level: 'silent' }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'silent' })
          )
        }
      })

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
        if (qr && !responded) {
          responded = true
          res.type('png')
          res.end(await QRCode.toBuffer(qr))
        }

        if (connection === 'open') {
          await delay(3000)

          await sock.sendMessage(sock.user.id, {
            document: { url: path.join(basePath, 'creds.json') },
            mimetype: 'application/json',
            fileName: `${id}.json`
          })

          await delay(2000)
          await sock.logout()
          removeFile(basePath)
        }

        if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          await delay(5000)
          start()
        }
      })
    } catch (e) {
      if (!res.headersSent) {
        res.status(503).json({ code: 'Service Unavailable' })
      }
      removeFile(basePath)
    }
  }

  start()
})

module.exports = router
