'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  GameError,
  createRoom,
  addPlayer,
  authenticate,
  startGame,
  mulligan,
  submitSetup,
  submitOrder,
  quitGame,
  expirePlanning,
  serializeState
} = require('./game');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const BUILD_VERSION = '0.5.0';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function randomRoomCode(rooms) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i += 1) code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new GameError('Could not allocate a room code. Try again.', 503);
}

function localIpv4Addresses() {
  const addresses = [];
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return addresses;
  }
  const isPrivate = (address) => {
    if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
    const match = address.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  };
  for (const records of Object.values(interfaces)) {
    for (const record of records || []) {
      const isIpv4 = record.family === 'IPv4' || record.family === 4;
      if (!isIpv4 || record.internal || !record.address || !isPrivate(record.address)) continue;
      addresses.push(record.address);
    }
  }
  const priority = (address) => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    const match = address.match(/^172\.(\d+)\./);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 2;
    return 3;
  };
  return [...new Set(addresses)].sort((left, right) => priority(left) - priority(right));
}

function localNetworkUrls(port) {
  return localIpv4Addresses().map((address) => `http://${address}:${port}`);
}

function normalizePublicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function hostnameFromRequest(req) {
  try { return new URL(`http://${req.headers.host || 'localhost'}`).hostname; }
  catch { return 'localhost'; }
}

function isPrivateHostname(hostname) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function requestOrigin(req) {
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProtocol || (req.socket.encrypted ? 'https' : 'http');
  return normalizePublicUrl(`${protocol}://${req.headers.host || 'localhost'}`);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...BASE_SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new GameError('Request body is too large.', 413));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return reject(new GameError('Invalid JSON request.'));
      }
    });
    req.on('error', reject);
  });
}

function createGameServer(options = {}) {
  const rooms = new Map();
  const streams = new Map();
  const admissionAttempts = new Map();
  const orderSeconds = Number(options.orderSeconds || process.env.ORDER_SECONDS || 45);
  const firstOrderSeconds = Number(options.firstOrderSeconds || process.env.FIRST_ORDER_SECONDS || 90);
  const maxDays = Number(options.maxDays || process.env.MAX_DAYS || 30);
  const maxRooms = Number(options.maxRooms ?? process.env.MAX_ROOMS ?? 500);
  const roomTtlMs = Number(options.roomTtlMs ?? (Number(process.env.ROOM_TTL_HOURS || 12) * 60 * 60 * 1000));
  const finishedRoomTtlMs = Number(options.finishedRoomTtlMs ?? (Number(process.env.FINISHED_ROOM_TTL_HOURS || 1) * 60 * 60 * 1000));
  const admissionWindowMs = Number(options.admissionWindowMs ?? 10 * 60 * 1000);
  const admissionLimit = Number(options.admissionLimit ?? process.env.ADMISSION_LIMIT ?? 40);
  const configuredPublicUrl = normalizePublicUrl(options.publicUrl || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
  const configuredHosted = options.hosted ?? Boolean(process.env.RENDER || configuredPublicUrl);

  function touchRoom(room, now = Date.now()) {
    room.lastActivityAt = now;
  }

  function removeRoom(code) {
    const clients = streams.get(code);
    for (const client of clients || []) {
      try { client.res.end(); } catch { /* already closed */ }
    }
    streams.delete(code);
    rooms.delete(code);
  }

  function cleanupRooms(now = Date.now()) {
    for (const room of rooms.values()) {
      const lastActivity = room.lastActivityAt || room.createdAt || now;
      const hasLiveStream = (streams.get(room.code)?.size || 0) > 0;
      const ttl = room.phase === 'finished' ? finishedRoomTtlMs : roomTtlMs;
      if (!hasLiveStream && now - lastActivity >= ttl) removeRoom(room.code);
    }
    for (const [key, entry] of admissionAttempts) {
      if (now - entry.startedAt >= admissionWindowMs) admissionAttempts.delete(key);
    }
  }

  function clientAddress(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
  }

  function enforceAdmissionLimit(req, now = Date.now()) {
    const key = clientAddress(req);
    let entry = admissionAttempts.get(key);
    if (!entry || now - entry.startedAt >= admissionWindowMs) {
      entry = { startedAt: now, count: 0 };
      admissionAttempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > admissionLimit) {
      throw new GameError('Too many room requests from this connection. Wait a few minutes and try again.', 429);
    }
  }

  function getRoom(code) {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('Room not found.', 404);
    return room;
  }

  function broadcast(room) {
    const clients = streams.get(room.code);
    if (!clients) return;
    for (const client of [...clients]) {
      try {
        const state = serializeState(room, client.playerId);
        client.res.write(`id: ${room.revision}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
      } catch {
        clients.delete(client);
        try { client.res.end(); } catch { /* already closed */ }
      }
    }
  }

  function authenticated(room, body, url) {
    const playerId = body.playerId || url.searchParams.get('playerId');
    const token = body.token || url.searchParams.get('token');
    return authenticate(room, playerId, token);
  }

  async function handleApi(req, res, url) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const address = server.address();
      const listeningPort = typeof address === 'object' && address ? address.port : PORT;
      const localRequest = isPrivateHostname(hostnameFromRequest(req));
      const hosted = configuredHosted || !localRequest;
      return json(res, 200, {
        ok: true,
        build: BUILD_VERSION,
        mode: hosted ? 'hosted' : 'local',
        rooms: rooms.size,
        now: Date.now(),
        publicUrl: hosted ? (configuredPublicUrl || requestOrigin(req)) : null,
        lanUrls: !hosted && localRequest ? localNetworkUrls(listeningPort) : []
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      enforceAdmissionLimit(req);
      if (rooms.size >= maxRooms) throw new GameError('The command network is at capacity. Try again shortly.', 503);
      const body = await readJson(req);
      const code = randomRoomCode(rooms);
      const { room, player } = createRoom(code, body.name, { orderSeconds, firstOrderSeconds, maxDays });
      touchRoom(room);
      rooms.set(code, room);
      return json(res, 201, {
        session: { roomCode: code, playerId: player.id, token: player.token },
        state: serializeState(room, player.id)
      });
    }

    if (segments[0] !== 'api' || segments[1] !== 'rooms' || !segments[2]) {
      throw new GameError('API endpoint not found.', 404);
    }
    const room = getRoom(segments[2]);
    const action = segments[3];

    if (req.method === 'POST' && action === 'join') {
      enforceAdmissionLimit(req);
      const body = await readJson(req);
      const player = addPlayer(room, body.name);
      touchRoom(room);
      broadcast(room);
      return json(res, 201, {
        session: { roomCode: room.code, playerId: player.id, token: player.token },
        state: serializeState(room, player.id)
      });
    }
    if (req.method === 'GET' && action === 'state') {
      const player = authenticated(room, {}, url);
      touchRoom(room);
      return json(res, 200, { state: serializeState(room, player.id) });
    }
    if (req.method === 'GET' && action === 'events') {
      const player = authenticated(room, {}, url);
      touchRoom(room);
      res.writeHead(200, {
        ...BASE_SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`event: state\ndata: ${JSON.stringify(serializeState(room, player.id))}\n\n`);
      if (!streams.has(room.code)) streams.set(room.code, new Set());
      const client = { res, playerId: player.id };
      streams.get(room.code).add(client);
      player.connected = true;
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        streams.get(room.code)?.delete(client);
        const stillConnected = [...(streams.get(room.code) || [])].some((item) => item.playerId === player.id);
        player.connected = stillConnected;
      });
      return;
    }

    if (req.method !== 'POST') throw new GameError('API endpoint not found.', 404);
    const body = await readJson(req);
    const player = authenticated(room, body, url);
    if (action === 'presence') {
      touchRoom(room);
      return json(res, 200, { ok: true, now: Date.now() });
    }
    if (action === 'start') startGame(room, player.id);
    else if (action === 'mulligan') mulligan(room, player.id, body.troopIds);
    else if (action === 'setup') submitSetup(room, player.id, body.bunkers);
    else if (action === 'order') submitOrder(room, player.id, body.order);
    else if (action === 'quit') {
      const outcome = quitGame(room, player.id);
      touchRoom(room);
      broadcast(room);
      if (outcome.roomEmpty) removeRoom(room.code);
      if (outcome.removed) return json(res, 200, { left: true });
      return json(res, 200, { state: serializeState(room, player.id) });
    }
    else throw new GameError('Unknown room action.', 404);
    touchRoom(room);
    broadcast(room);
    return json(res, 200, { state: serializeState(room, player.id) });
  }

  function serveStatic(req, res, url) {
    let requestPath = decodeURIComponent(url.pathname);
    if (requestPath === '/') requestPath = '/index.html';
    const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) throw new GameError('Not found.', 404);
    let targetPath = filePath;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) targetPath = path.join(PUBLIC_DIR, 'index.html');
    const extension = path.extname(targetPath).toLowerCase();
    const contents = fs.readFileSync(targetPath);
    const htmlSecurity = extension === '.html' ? {
      'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
    } : {};
    res.writeHead(200, {
      ...BASE_SECURITY_HEADERS,
      ...htmlSecurity,
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': contents.length,
      'Cache-Control': 'no-store'
    });
    res.end(contents);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        try { res.end(); } catch { /* ignored */ }
        return;
      }
      const status = error instanceof GameError ? error.status : 500;
      if (!(error instanceof GameError)) console.error(error);
      json(res, status, { error: error.message || 'Unexpected server error.' });
    }
  });

  const timer = setInterval(() => {
    for (const room of rooms.values()) {
      if (expirePlanning(room)) {
        touchRoom(room);
        broadcast(room);
      }
    }
  }, 250);
  const cleanupTimer = setInterval(cleanupRooms, 60_000);
  timer.unref();
  cleanupTimer.unref();
  server.on('close', () => {
    clearInterval(timer);
    clearInterval(cleanupTimer);
  });

  return { server, rooms, broadcast, cleanupRooms };
}

function openLocalBrowser(url) {
  if (process.platform !== 'win32') return;
  const fallback = () => {
    try {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (error) {
      console.error(`Could not open the browser automatically: ${error.message}`);
    }
  };
  try {
    const child = spawn('explorer.exe', [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.once('error', fallback);
    child.unref();
  } catch (error) {
    fallback();
  }
}

if (require.main === module) {
  const { server } = createGameServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Close every older Blacksite Five server window, then launch again.`);
    } else {
      console.error(`Blacksite Five server error: ${error.stack || error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    const lanUrls = localNetworkUrls(PORT);
    const hostedUrl = normalizePublicUrl(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
    if (process.env.RENDER || hostedUrl) {
      console.log(`Blacksite Five ${BUILD_VERSION} is running in hosted mode${hostedUrl ? ` at ${hostedUrl}` : ''}.`);
    } else {
      console.log(`Blacksite Five is running at ${url}`);
      if (lanUrls.length) console.log(`Friends on the same Wi-Fi can join at ${lanUrls[0]}`);
      else console.log('No local-network address was detected. localhost works only on this computer.');
      console.log('Keep this window open while playing.');
      if (process.env.OPEN_BROWSER !== '0') openLocalBrowser(url);
    }
  });
}

module.exports = { createGameServer, localIpv4Addresses, localNetworkUrls, normalizePublicUrl, isPrivateHostname };
