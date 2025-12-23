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
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  DisconnectReason
} = require('baileys')

const router = express.Router()

function removeFile(p) {
  if (!fs.existsSync(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

const delay = ms => new Promise(r => setTimeout(r, ms))

router.get('/', async (req, res) => {
  const id = makeid()
  const stateDir = path.join(__dirname, 'temp', id)
  let closed = false

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const { state, saveCreds } = await useMultiFileAuthState(stateDir)
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

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !closed) {
        const img = await QRCode.toDataURL(qr)
        res.write(`data: ${img}\n\n`)
      }

      if (connection === 'open') {
        await delay(3000)

        const credsPath = path.join(stateDir, 'creds.json')
        if (fs.existsSync(credsPath)) {
          try {
            const link = await upload(`${id}.json`, credsPath)
            const code = link.split('/')[4] ?? link
            const userJid = jidNormalizedUser(sock.user.id)
            await sock.sendMessage(userJid, { text: `${code}` })
          } catch {}
        }

        await delay(2000)
        closed = true
        try { await sock.logout() } catch {}
        removeFile(stateDir)
        res.end()
      }

      if (
        connection === 'close' &&
        lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut
      ) {
        closed = true
        removeFile(stateDir)
        res.end()
      }
    })

    req.on('close', () => {
      closed = true
      try { sock.ws.close() } catch {}
      removeFile(stateDir)
    })
  } catch (err) {
    closed = true
    removeFile(stateDir)
    res.write(`data: ERROR\n\n`)
    res.end()
  }
})

module.exports = router
