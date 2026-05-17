require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG = {
  port: parseInt(process.env.PORT || '3000'),
  serialPort: process.env.SERIAL_PORT || '',
  serialBaud: parseInt(process.env.SERIAL_BAUD || '9600'),
  cameraDevice: process.env.CAMERA_DEVICE || '0',
  numLeds: Math.min(parseInt(process.env.NUM_LEDS || '8'), 8),
};

const ledState = new Array(CONFIG.numLeds).fill(0);
const BOUNDARY = 'mjpeg_frame';
const streamClients = new Map();

app.use(express.static(path.join(__dirname, 'public')));

// --------------- MJPEG streaming ---------------

function buildFfmpegArgs() {
  const dev = CONFIG.cameraDevice;
  const tail = ['-vf', 'scale=640:480', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-'];

  switch (process.platform) {
    case 'darwin':
      // avfoundation: "videoIndex:audioIndex", use "none" to skip audio
      return ['-f', 'avfoundation', '-framerate', '15', '-i', `${dev}:none`, ...tail];
    case 'win32':
      return ['-f', 'dshow', '-i', `video=${dev}`, ...tail];
    default:
      return ['-f', 'v4l2', '-framerate', '15', '-i', dev === '0' ? '/dev/video0' : dev, ...tail];
  }
}

function broadcastFrame(jpeg) {
  const header = Buffer.from(
    `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`
  );
  const data = Buffer.concat([header, jpeg, Buffer.from('\r\n')]);
  streamClients.forEach((res) => { try { res.write(data); } catch (_) {} });
}

function startCamera() {
  const args = buildFfmpegArgs();
  console.log('[camera] ffmpeg', args.join(' '));

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);

  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let from = 0;
    while (true) {
      const soi = buf.indexOf(Buffer.from([0xff, 0xd8]), from);
      if (soi === -1) break;
      const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi === -1) break;
      broadcastFrame(buf.slice(soi, eoi + 2));
      from = eoi + 2;
    }
    buf = from > 0 ? buf.slice(from) : buf;
    if (buf.length > 2 * 1024 * 1024) buf = Buffer.alloc(0); // safety cap
  });

  proc.stderr.on('data', (d) => {
    const msg = d.toString();
    // ffmpeg streams progress to stderr; only surface actual errors
    if (/error|failed|invalid/i.test(msg)) console.error('[ffmpeg]', msg.trim());
  });

  proc.on('close', (code) => {
    console.log(`[camera] ffmpeg exited (${code}), restarting in 3 s`);
    setTimeout(startCamera, 3000);
  });
}

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
  });
  const id = Symbol();
  streamClients.set(id, res);
  req.on('close', () => streamClients.delete(id));
});

// --------------- Arduino serial ---------------

let serial = null;

function connectSerial() {
  if (!CONFIG.serialPort) {
    console.log('[serial] SERIAL_PORT not set — running in demo mode (no Arduino)');
    return;
  }

  const sp = new SerialPort({ path: CONFIG.serialPort, baudRate: CONFIG.serialBaud });
  const parser = sp.pipe(new ReadlineParser({ delimiter: '\n' }));

  sp.on('open', () => {
    console.log(`[serial] connected to ${CONFIG.serialPort}`);
    serial = sp;
    setTimeout(() => sp.write('STATUS\n'), 1000);
  });

  parser.on('data', (raw) => {
    const line = raw.trim();
    if (line.startsWith('STATE:')) {
      line.slice(6).split(',').forEach((v, i) => {
        if (i < CONFIG.numLeds) ledState[i] = parseInt(v) || 0;
      });
      io.emit('state', ledState);
    }
  });

  sp.on('error', (err) => {
    console.error('[serial] error:', err.message);
    serial = null;
    setTimeout(connectSerial, 3000);
  });

  sp.on('close', () => {
    console.log('[serial] disconnected — retrying in 3 s');
    serial = null;
    setTimeout(connectSerial, 3000);
  });
}

function sendLed(index, state) {
  if (serial?.isOpen) {
    serial.write(`LED:${index}:${state}\n`, (err) => {
      if (err) console.error('[serial] write error:', err.message);
    });
  }
}

// --------------- Socket.io ---------------

let viewerCount = 0;

io.on('connection', (socket) => {
  viewerCount++;
  console.log(`[ws] connected ${socket.id} (total: ${viewerCount})`);

  socket.emit('config', { numLeds: CONFIG.numLeds });
  socket.emit('state', ledState);
  io.emit('viewers', viewerCount);

  socket.on('toggle', (index) => {
    if (typeof index !== 'number' || index < 0 || index >= CONFIG.numLeds) return;
    ledState[index] ^= 1;
    sendLed(index, ledState[index]);
    io.emit('state', [...ledState]);
  });

  socket.on('disconnect', () => {
    viewerCount--;
    console.log(`[ws] disconnected ${socket.id} (total: ${viewerCount})`);
    io.emit('viewers', viewerCount);
  });
});

// --------------- Start ---------------

connectSerial();
startCamera();
server.listen(CONFIG.port, () => {
  console.log(`\nLight on the Net → http://localhost:${CONFIG.port}\n`);
});
