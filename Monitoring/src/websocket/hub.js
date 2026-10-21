'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const mongoose = require('mongoose');

const clients = new Set();

/**
 * Safely serialize and send a message to one client.
 */
function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('[WS Hub] Send error:', err.message);
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
 * Start a MongoDB change stream to broadcast real-time workflow mutations.
 * This provides tenant-aware live updates whenever a workflow is created,
 * updated, or deleted.
 */
function startChangeStream() {
  // Guard: only start if connected
  if (mongoose.connection.readyState !== 1) {
    console.warn('[WS Hub] MongoDB not connected, skipping change stream setup');
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
      console.error('[WS Hub] Change stream error:', err.message);
      // Do not crash – change streams may not be available on standalone MongoDB
    });

    console.log('[WS Hub] MongoDB change stream active');
  } catch (err) {
    console.warn('[WS Hub] Could not start change stream:', err.message);
  }
}

/**
 * Create and attach a WebSocket server to the provided HTTP server.
 * Returns the broadcast function for use by the monitoring server loop.
 *
 * @param {http.Server} httpServer
 * @returns {Function} broadcast
 */
function createWebSocketHub(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS Hub] Client connected from ${ip}. Total: ${clients.size + 1}`);
    clients.add(ws);

    // Send a welcome/snapshot message immediately
    sendToClient(ws, { type: 'CONNECTED', ts: Date.now(), message: 'Monitoring WebSocket connected' });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS Hub] Client disconnected. Remaining: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS Hub] Client error:', err.message);
      clients.delete(ws);
    });

    // Ignore incoming messages (read-only feed)
  });

  // Set up change streams once MongoDB is connected
  mongoose.connection.on('connected', () => {
    startChangeStream();
  });

  // If already connected at hub creation time, start immediately
  if (mongoose.connection.readyState === 1) {
    startChangeStream();
  }

  console.log('[WS Hub] WebSocket hub initialised');
  return broadcast;
}

module.exports = { createWebSocketHub, broadcast };
