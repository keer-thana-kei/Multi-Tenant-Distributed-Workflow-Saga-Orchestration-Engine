'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const mongoose = require('mongoose');
const logger = require('../logger');

// Config from environment
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_WS_ORIGINS || '*';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW === '*' ? null : ALLOWED_ORIGINS_RAW.split(',').map((s) => s.trim());
const WS_MAX_CLIENTS = parseInt(process.env.WS_MAX_CLIENTS || '100', 10);
const WS_HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || '30000', 10);
const WS_HEARTBEAT_TIMEOUT_MS = parseInt(process.env.WS_HEARTBEAT_TIMEOUT_MS || '10000', 10);
const WS_MAX_MESSAGE_BYTES = 512;

const clients = new Set();

/**
 * Safely serialize and send a message to one client.
 */
function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      logger.error('WS send error', { error: err.message });
    }
  }
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(message) {
  for (const ws of clients) {
    sendToClient(ws, message);
  }
}

/**
 * Start heartbeat loop: ping all clients every interval, terminate those that don't pong.
 */
function startHeartbeat() {
  setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        logger.warn('WS client timed out, terminating');
        clients.delete(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
}

/**
 * Start a MongoDB change stream to broadcast real-time workflow mutations.
 */
function startChangeStream() {
  if (mongoose.connection.readyState !== 1) {
    logger.warn('WS Hub: MongoDB not connected, skipping change stream setup');
    return;
  }

  try {
    const Workflow = mongoose.model('Workflow');
    const changeStream = Workflow.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', (change) => {
      const doc = change.fullDocument;
      const event = {
        type: 'WORKFLOW_EVENT',
        ts: Date.now(),
        data: {
          operationType: change.operationType,
          workflowId: change.documentKey?._id,
          companyId: doc?.companyId,
          workflowName: doc?.workflowName,
          status: doc?.status,
          updatedAt: doc?.updatedAt,
        },
      };
      broadcast(event);
    });

    changeStream.on('error', (err) => {
      logger.error('WS Hub: change stream error', { error: err.message });
    });

    logger.info('WS Hub: MongoDB change stream active');
  } catch (err) {
    logger.warn('WS Hub: could not start change stream', { error: err.message });
  }
}

/**
 * Create and attach a WebSocket server to the provided HTTP server.
 * @param {http.Server} httpServer
 * @returns {Function} broadcast
 */
function createWebSocketHub(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  startHeartbeat();

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || '';
    const ip = req.socket.remoteAddress;

    // Origin validation
    if (ALLOWED_ORIGINS && !ALLOWED_ORIGINS.includes(origin)) {
      logger.warn('WS Hub: rejected connection from disallowed origin', { origin, ip });
      ws.close(4001, 'Origin not allowed');
      return;
    }

    // Max clients limit
    if (clients.size >= WS_MAX_CLIENTS) {
      logger.warn('WS Hub: max clients reached, rejecting connection', { max: WS_MAX_CLIENTS });
      ws.close(4002, 'Max connections reached');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    clients.add(ws);
    logger.info('WS Hub: client connected', { ip, total: clients.size });

    // Send a welcome message immediately
    sendToClient(ws, { type: 'CONNECTED', ts: Date.now(), message: 'Monitoring WebSocket connected' });

    ws.on('message', (data) => {
      // WS is a read-only feed; ignore incoming messages but guard payload size
      if (data && data.length > WS_MAX_MESSAGE_BYTES) {
        logger.warn('WS Hub: oversized incoming message ignored', { bytes: data.length });
      }
      // No-op — no incoming commands processed
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WS Hub: client disconnected', { remaining: clients.size });
    });

    ws.on('error', (err) => {
      logger.error('WS Hub: client error', { error: err.message });
      clients.delete(ws);
    });
  });

  // Set up change streams once MongoDB is connected
  mongoose.connection.on('connected', () => {
    startChangeStream();
  });

  // If already connected at hub creation time, start immediately
  if (mongoose.connection.readyState === 1) {
    startChangeStream();
  }

  logger.info('WS Hub: WebSocket hub initialised', {
    maxClients: WS_MAX_CLIENTS,
    heartbeatIntervalMs: WS_HEARTBEAT_INTERVAL_MS,
    allowedOrigins: ALLOWED_ORIGINS_RAW,
  });

  return broadcast;
}

module.exports = { createWebSocketHub, broadcast };

