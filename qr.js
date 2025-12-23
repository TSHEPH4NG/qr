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
  jidNormalizedUser
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
  let responded = false

  async function getQR() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(stateDir)
      const { version } = await fetchLatestBaileysVersion()

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: 'silent' })
          )
        },
        version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Edge'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true
      })

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !responded) {
          responded = true
          res.type('png')
          res.end(await QRCode.toBuffer(qr))
        }

        if (connection === 'open') {
          await delay(3000)

          const credsPath = path.join(stateDir, 'creds.json')
          if (fs.existsSync(credsPath)) {
            try {
              const link = await upload(`${id}.json`, credsPath)
              const code = link.split('/')[4] ?? link
              const userJid = jidNormalizedUser(sock.user.id)

              try {
                await sock.sendMessage(userJid, { text: `${code}` })
              } catch {}

              await delay(2000)
              try { await sock.logout() } catch {}
              removeFile(stateDir)
            } catch {}
          }
        }

        if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output?.statusCode !== 401
        ) {
          await delay(12000)
          getQR()
        }

        if (connection === 'close') {
          removeFile(stateDir)
        }
      })
    } catch (err) {
      removeFile(stateDir)
      if (!responded) {
        responded = true
        res.status(503).send({ code: 'Service Unavailable', error: String(err) })
      }
    }
  }

  getQR()
})

module.exports = router
