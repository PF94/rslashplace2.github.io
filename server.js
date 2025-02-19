//server
import {WebSocketServer} from 'ws'
import {promises as fs} from 'fs'
import {createServer} from 'https'
let SECURE = false
let BOARD, CHANGES

//TODO: compress changes
const WIDTH = 2000, HEIGHT = 2000, PALETTE_SIZE = 32, COOLDOWN = 10e3 //5mins
try{
	BOARD = await fs.readFile('./place')
	CHANGES = new Uint8Array(WIDTH * HEIGHT).fill(255)
}catch(e){
	BOARD = new Uint8Array(WIDTH * HEIGHT)
	CHANGES = new Uint8Array(WIDTH * HEIGHT).fill(255)
}
let newPos = [], newCols = []
let wss, cooldowns = new Map()
let OVERRIDES = new Set(await fs.readFile('../cooldown_overrides.txt').toString().split('\n'))

function runLengthChanges(){
	//compress CHANGES with run-length encoding
	let i = 0
	let bufs = [Buffer.alloc(256)], blast = 0, bi = 0
	bufs[0][bi++] = 2
	let add = a => {bufs[blast][bi++]=a;bi==256&&(bi=0,bufs.push(Buffer.alloc(256)),blast++)}
	while(true){
		let c = 0
		while(CHANGES[i] == 255)c++,i++
		if(i == CHANGES.length)break
		//c is # of blank cells
		//we will borrow 2 bits to store the blank cell count
		//00 = no gap
		//01 = 1-byte (Gaps up to 255)
		//10 = 2-byte	(Gaps up to 65535)
		//11 = 4-byte (idk probs never used)
		if(c < 256){
			if(!c)add(CHANGES[i++])
			else{
				add(CHANGES[i++] + 64)
				add(c)
			}
		}else if(c < 65536){
			add(CHANGES[i++] + 128)
			add(c >> 8)
			add(c)
		}else{
			add(CHANGES[i++] + 192)
			add(c >> 24)
			add(c >> 16)
			add(c >> 8)
			add(c)
		}
	}
	bufs[blast] = bufs[blast].slice(0,bi)
	return Buffer.concat(bufs)
}
const PORT = 1234
if(SECURE){
	wss = new WebSocketServer({ perMessageDeflate: false, server: createServer({
	cert: await fs.readFile('../a.pem'), //etc/letsencrypt/live/server.rplace.tk/fullchain.pem'),
	key: await fs.readFile('../a.key'), //etc/letsencrypt/live/server.rplace.tk/privkey.pem'),
	perMessageDeflate: false }).listen(PORT) })
}else wss = new WebSocketServer({ port: PORT, perMessageDeflate: false })
let players = 0
let BANS = new Set(await fs.readFile('blacklist.txt').toString().split('\n'))
wss.on('connection', async function(p, {headers}) {
	let IP = /*p._socket.remoteAddress */headers['x-forwarded-for']
	//if(!IP) {
	//	console.log(IP)
	//}
	console.log(IP)
	p.lchat = 0
	let buf = Buffer.alloc(5)
	buf[0] = 1
	buf.writeInt32BE(Math.ceil(cooldowns.get(IP) / 1000) || 1, 1)
	p.send(buf)
	players++
	p.send(runLengthChanges())
  p.on("error", _=>_)
  p.on('message', function(data) {
	  console.log("fuck")
		if(data[0] == 15){
			if(p.lchat + 2500 > NOW || data.length > 400)return
			p.lchat = NOW
			for(let c of wss.clients){
                		c.send(data)
        		}
			return
		}
		if(data.length < 6)return //bad packet
		let i = data.readInt32BE(1), c = data[5]
		if(i >= BOARD.length || c >= PALETTE_SIZE)return //bad packet
    let cd = cooldowns.get(IP)
		if(cd > NOW){
			//reject
			let data = Buffer.alloc(10)
			data[0] = 7
			data.writeInt32BE(Math.ceil(cd / 1000) || 1, 1)
			data.writeInt32BE(i, 5)
			data[9] = CHANGES[i] == 255 ? BOARD[i] : CHANGES[i]
			p.send(data)
			return
		}
		//accept
		CHANGES[i] = c
			cooldowns.set(IP, NOW + (OVERRIDES.has(IP) ? 1000 : COOLDOWN - 1000))
		newPos.push(i)
		newCols.push(c)
  })
	p.on('close', function(){ players-- })
})
let NOW = Date.now()
setInterval(() => {
	NOW = Date.now()
}, 50)

import { exec } from 'child_process'

//let ORIGIN = (''+await fs.readFile("../.git-credentials")).trim()

async function pushImage(){
	//await new Promise((r, t) => exec("git add *;git commit -a -m 'Hourly backup';git push --force "+ORIGIN+"/rslashplace2/rslashplace2.github.io", e => e ? t(e) : r()))
	//serve old changes for 11 more mins just to be 100% safe
	let curr = new Uint8Array(CHANGES)
	setTimeout(() => {
		//after 11 minutes, remove all old changes. Where there is a new change, curr[i] != CHANGES[i] and so it will be kept, but otherwise, remove
		for(let i = curr.length - 1; i >= 0; i--)if(curr[i] == CHANGES[i])CHANGES[i] = 255
	}, 660e3)
}
setInterval(function(){
	if(!newPos.length)return
	let pos
	let buf = Buffer.alloc(1 + newPos.length * 5)
	buf[0] = 6
	let i = 1
	while((pos = newPos.pop()) != undefined){
		buf.writeInt32BE(pos, i)
		i += 4
		buf[i++] = newCols.pop()
	}
	for(let c of wss.clients){
		c.send(buf)
	}
}, 1000)

let I = 0

setInterval(async function(){
	I++
	for(let i = BOARD.length-1; i >= 0; i--)if(CHANGES[i]!=255)BOARD[i] = CHANGES[i]
	await fs.writeFile('place', BOARD)
	let buf = Buffer.of(3, players>>8, players)
	for(let c of wss.clients){
		c.send(buf)
	}
	if(I % 720 == 0){
		try{
                	await pushImage()
                	console.log('['+new Date().toISOString()+'] Successfully saved r/place!')
        	}catch(e){
                	console.log('['+new Date().toISOString()+'] Error pushing image')
        	}
        	for(let [k, t] of cooldowns){
                	if(t > NOW)cooldowns.delete(k)
        	}
	}
}, 5000)

import repl from 'basic-repl'

let a, b, c, test
repl('$',(_)=>eval(_))

function fill(x, y, w, h, b = 27){
	let x1 = x + w, y1 = y + h
	for(;y < y1; y++){
		for(;x < x1; x++){
			CHANGES[x + y * WIDTH] = b
		}
		x = x1 - w
	}
	return "Filled " + w*h + " pixels, reload page to see effects"
}
