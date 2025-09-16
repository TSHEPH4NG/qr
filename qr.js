const { upload } = require("./upload");
const { makeid } = require('./id');
const QRCode = require('qrcode');
const _ = require('lodash')
const express = require('express');
const path = require('path');
const fs = require('fs');
let router = express.Router()
const pino = require("pino");
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
	fs.rmSync(FilePath, {
		recursive: true,
		force: true
	})
};

const delay = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}




const {
	readFile
} = require("node:fs/promises")
router.get('/', async (req, res) => {
	const id = makeid();
	async function Getqr() {
		const {
			state,
			saveCreds
		} = await useMultiFileAuthStateV2('./temp/' + id)
		/*const { version } = await fetchLatestBaileysVersion();*/
		try {
			let session = makeWASocket({
				auth: state,
				printQRInTerminal: false,
				logger: pino({
					level: "silent"
				}),
			});

			session.ev.on('creds.update', saveCreds)
			session.ev.on("connection.update", async (s) => {
				const {
					connection,
					lastDisconnect,
					qr
				} = s;
				if (qr) await res.end(await QRCode.toBuffer(qr));
				if (connection == "open") {
					 
					 await delay(3000);
					/* let link = await upload(`${id}.json`,__dirname+`/temp/${id}/creds.json`);
	                                 let code = link.split("/")[4]
                                         await session.sendMessage(session.user.id, {text:`${code}`})*/
					await session.sendMessage(session.user.id, {
                    document: { url: __dirname + `/temp/${id}/creds.json` },
                    mimetype: "application/json",
                    fileName: `${id}.json`
                    });
					
                        
     
     			                await delay(3000);
					await session.ws.close();
					return await removeFile("temp/" + id);
				} else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
					await delay(10000);
					Getqr();
				}
			});
		} catch (err) {
			if (!res.headersSent) {
				await res.json({
					code: "Service Unavailable"
				});
			}
			console.log(err);
			await removeFile("temp/" + id);
		}
	}
	return await Getqr()
	//return //'qr.png', { root: "./" });
});
module.exports = router
