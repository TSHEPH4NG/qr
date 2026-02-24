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

function removeFile(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true })
}

const delay = ms => new Promise(r => setTimeout(r, ms))

router.get('/', async (req, res) => {
  const id = makeid()
  const tempDir = path.join(__dirname, 'temp', id)
  let closed = false

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    if (fs.existsSync(sessionDir)) {
      const credsPath = path.join(sessionDir, 'creds.json');
      if (fs.existsSync(credsPath)) {
        try {
          const link = await upload(`${id}.json`, credsPath);
          const code = link.split('/')[4] ?? link;
          res.write(`data: SESSION_EXISTS\n\n`);
          res.write(`data: ${code}\n\n`);
          res.flush();
          await delay(2000);
          closed = true;
          removeFile(tempDir);
          res.end();
          return;
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
        }
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(tempDir)
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
      version,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      getMessage: async (key) => ({ conversation: null })
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr && !closed) {
        const img = await QRCode.toDataURL(qr)
        res.write(`data: ${img}\n\n`)
        res.flush()
      }

      if (connection === 'open' && !closed) {
        await delay(2000)
        const credsPath = path.join(tempDir, 'creds.json')
        if (fs.existsSync(credsPath)) {
          try {
            if (!fs.existsSync(sessionDir)) {
              fs.mkdirSync(sessionDir, { recursive: true });
            }
            
            const files = fs.readdirSync(tempDir);
            files.forEach(file => {
              const srcPath = path.join(tempDir, file);
              const destPath = path.join(sessionDir, file);
              fs.copyFileSync(srcPath, destPath);
            });

            const link = await upload(`${id}.json`, credsPath)
            const code = link.split('/')[4] ?? link
            
            const userJid = jidNormalizedUser(sock.user.id)
            await sock.sendMessage(userJid, { text: `Session saved! Code: ${code}` })
            
            res.write(`data: SUCCESS\n\n`)
            res.write(`data: ${code}\n\n`)
          } catch (error) {
            console.error('Error saving session:', error);
            res.write(`data: ERROR\n\n`)
          }
        }
        closed = true
        await delay(1000)
        try { await sock.logout() } catch {}
        removeFile(tempDir)
        res.end()
      }

      if (connection === 'close' && lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
        closed = true
        removeFile(tempDir)
        res.write(`data: LOGGED_OUT\n\n`)
        res.end()
      }
    })

    req.on('close', () => {
      closed = true
      try { sock.ws.close() } catch {}
      removeFile(tempDir)
    })

  } catch (err) {
    console.error('Session error:', err);
    closed = true
    removeFile(path.join(__dirname, 'temp', id))
    res.write(`data: ERROR\n\n`)
    res.end()
  }
})

module.exports = router
