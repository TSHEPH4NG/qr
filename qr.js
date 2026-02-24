const express = require('express')
const fs = require('fs')
const path = require('path')
const pino = require('pino')
const QRCode = require('qrcode')
const { upload } = require('./upload')
const { makeid } = require('./id')
const {
  useMultiFileAuthState,
  makeWASocket,
  Browsers,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('baileys')

const router = express.Router()
const sessionDir = path.join(__dirname, '../session')

if (!fs.existsSync(sessionDir))
  fs.mkdirSync(sessionDir, { recursive: true })

function removeFile(p) {
  if (fs.existsSync(p))
    fs.rmSync(p, { recursive: true, force: true })
}

const delay = ms => new Promise(r => setTimeout(r, ms))

let currentQR = null

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'your-html-file.html'))
})

router.get('/qr-code', async (req, res) => {

  const id = makeid()
  const tempDir = path.join(__dirname, 'temp', id)
  if (!fs.existsSync(tempDir))
    fs.mkdirSync(tempDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(tempDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    browser: Browsers.macOS('Desktop'),
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

  sock.ev.on('connection.update', async ({ connection, qr }) => {

    if (qr && !currentQR) {
      currentQR = await QRCode.toBuffer(qr)
      res.setHeader('Content-Type', 'image/png')
      res.send(currentQR)
    }

    if (connection === 'open') {
      await delay(2000)

      const credsPath = path.join(tempDir, 'creds.json')

      if (fs.existsSync(credsPath)) {

        fs.readdirSync(tempDir).forEach(file => {
          fs.copyFileSync(
            path.join(tempDir, file),
            path.join(sessionDir, file)
          )
        })

        const link = await upload(`${id}.json`, credsPath)
        const code = link.split('/')[4] ?? link

        const userJid = jidNormalizedUser(sock.user.id)
        try {
          await sock.sendMessage(userJid, {
            text: `Session saved! Code: ${code}`
          })
        } catch {}
      }

      try { await sock.logout() } catch {}
      removeFile(tempDir)
    }

  })

})
