const express = require('express')
const bodyParser = require('body-parser')
const path = require('path')
const pairRouter = require('./pair')
const qrRouter = require('./qr')
const events = require('events')

events.EventEmitter.defaultMaxListeners = 500

const app = express()
const PORT = process.env.PORT || 8000

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static(__dirname))

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'))
})

app.use('/pair', pairRouter)
app.use('/qr', qrRouter)

app.listen(PORT, () => {
    console.log('==============================')
    console.log('      Iris MD - WhatsApp Linker')
    console.log('           ©2026 Tshepang')
    console.log(`Server running on http://localhost:${PORT}`)
    console.log('==============================')
})

module.exports = app
