import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEARTBEAT_INTERVAL,
  MAX_MESSAGE_BYTES,
  MESSAGE_RATE_LIMIT,
  parseClientMessage,
  RateLimiter,
  type ServerMessage,
} from '@polyball/shared';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { isOriginAllowed, loadConfig } from './config';
import { RoomManager } from './room-manager';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
const roomManager = new RoomManager();

interface Connection {
  limiter: RateLimiter;
  alive: boolean;
}

const connections = new Map<WebSocket, Connection>();

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

/* --------------------------------------------------------------------- http */

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security & CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '8kb' }));

app.get('/health', (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    service: 'polyball',
    version: '0.1.0',
    env: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    clients: connections.size,
    rooms: roomManager.roomCount,
    players: roomManager.totalPlayerCount,
    memory: {
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    },
  });
});

if (config.serveStatic) {
  const candidates = [
    path.resolve(config.clientDir),
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), config.clientDir),
    path.resolve(here, config.clientDir),
    path.resolve(here, '../client/dist'),
    path.resolve(here, '../../client/dist'),
  ];
  const clientDir = candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];

  // Serve hashed assets with long cache headers
  app.use(
    '/assets',
    express.static(path.join(clientDir, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }),
  );

  // Serve remaining static files
  app.use(
    express.static(clientDir, {
      index: 'index.html',
      maxAge: '1h',
    }),
  );

  // Fallback SPA route for client-side routing (e.g. /practice, /join/CODE, /room/CODE)
  app.get('*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const http = createServer(app);

/* ---------------------------------------------------------------- websocket */

http.on('upgrade', (request, socket, head) => {
  if (!isOriginAllowed(request.headers.origin, config.allowedOrigins)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

wss.on('connection', (socket: WebSocket) => {
  connections.set(socket, {
    limiter: new RateLimiter(MESSAGE_RATE_LIMIT, MESSAGE_RATE_LIMIT),
    alive: true,
  });

  socket.on('pong', () => {
    const connection = connections.get(socket);
    if (connection) connection.alive = true;
  });

  socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    const connection = connections.get(socket);
    if (!connection) return;

    if (isBinary) {
      send(socket, { type: 'ERROR', code: 'INVALID_MESSAGE', message: 'Text frames only.' });
      return;
    }
    if (!connection.limiter.tryConsume()) {
      send(socket, { type: 'ERROR', code: 'RATE_LIMITED', message: 'Slow down.' });
      return;
    }

    const parsed = parseClientMessage(raw.toString());
    if (!parsed.ok) {
      send(socket, { type: 'ERROR', code: parsed.code, message: parsed.message });
      return;
    }

    roomManager.handleMessage(socket, parsed.value);
  });

  socket.on('close', () => {
    roomManager.handleSocketDisconnect(socket);
    connections.delete(socket);
  });

  socket.on('error', () => {
    roomManager.handleSocketDisconnect(socket);
    socket.terminate();
    connections.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const [socket, connection] of connections) {
    if (!connection.alive) {
      roomManager.handleSocketDisconnect(socket);
      socket.terminate();
      connections.delete(socket);
      continue;
    }
    connection.alive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL);
heartbeat.unref();

/* ------------------------------------------------------------------ startup */

http.listen(config.port, config.host, () => {
  const where = `${config.host}:${config.port}`;
  console.log(`[polyball] http  listening on http://${where}`);
  console.log(`[polyball] ws    listening on ws://${where}`);
  console.log(`[polyball] env   ${config.nodeEnv}`);
  console.log(
    `[polyball] cors  ${
      config.allowedOrigins.length > 0
        ? config.allowedOrigins.join(', ')
        : 'any origin (development)'
    }`,
  );
});

const shutdown = (signal: string): void => {
  console.log(`[polyball] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  for (const socket of connections.keys()) socket.close(1001, 'Server shutting down');
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
