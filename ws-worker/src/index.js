export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    if (url.pathname !== '/ws-peer') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const room = String(url.searchParams.get('room') || '').trim();
    if (!room) {
      return new Response('Missing room parameter', { status: 400 });
    }

    const id = env.ROOMS.idFromName(room);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};

export class RoomRelay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map(); // ws -> { peerId, roomId }
    this.peers = new Map(); // peerId -> ws
    this.connections = new Map(); // connectionId -> { aPeerId, bPeerId }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.sockets.set(server, { peerId: '', roomId: '' });

    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data);
    });

    const onSocketClose = () => {
      this.handleClose(server);
    };

    server.addEventListener('close', onSocketClose);
    server.addEventListener('error', onSocketClose);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  handleMessage(socket, rawData) {
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.type === 'peer-open') {
      this.handlePeerOpen(socket, message);
      return;
    }

    const meta = this.sockets.get(socket);
    if (!meta || !meta.peerId) {
      this.send(socket, {
        type: 'peer-error',
        errorType: 'not-opened',
        message: 'Peer is not opened yet.',
      });
      return;
    }

    if (message.type === 'connect-request') {
      this.handleConnectRequest(socket, message);
      return;
    }

    if (message.type === 'connection-data') {
      this.forwardConnectionData(meta.peerId, message);
      return;
    }

    if (message.type === 'connection-close') {
      this.closeConnection(meta.peerId, String(message.connectionId || ''), true, String(message.closeReason || ''));
    }
  }

  handlePeerOpen(socket, message) {
    const existing = this.sockets.get(socket);
    if (!existing || existing.peerId) return;

    const requested = String(message.requestedPeerId || '').trim();
    let peerId = requested;
    if (!peerId) {
      peerId = this.generatePeerId();
    }

    if (this.peers.has(peerId)) {
      this.send(socket, {
        type: 'peer-error',
        errorType: 'unavailable-id',
        message: 'Requested peer id is already used.',
      });
      return;
    }

    existing.peerId = peerId;
    existing.roomId = String(message.roomId || '');
    this.peers.set(peerId, socket);

    this.send(socket, {
      type: 'peer-opened',
      peerId,
    });
  }

  handleConnectRequest(socket, message) {
    const sourceMeta = this.sockets.get(socket);
    if (!sourceMeta || !sourceMeta.peerId) return;

    const sourcePeerId = sourceMeta.peerId;
    const targetPeerId = String(message.targetPeerId || '').trim();
    const connectionId = String(message.connectionId || '').trim();

    if (!targetPeerId || !connectionId) {
      this.send(socket, {
        type: 'connect-rejected',
        connectionId,
        errorType: 'invalid-connection',
        message: 'Missing target peer or connection id.',
      });
      return;
    }

    const targetSocket = this.peers.get(targetPeerId);
    if (!targetSocket) {
      this.send(socket, {
        type: 'connect-rejected',
        connectionId,
        errorType: 'peer-unavailable',
        message: 'Target peer is unavailable.',
      });
      return;
    }

    this.connections.set(connectionId, {
      aPeerId: sourcePeerId,
      bPeerId: targetPeerId,
    });

    this.send(targetSocket, {
      type: 'incoming-connection',
      connectionId,
      peerId: sourcePeerId,
      metadata: message.metadata || {},
    });

    this.send(socket, {
      type: 'connect-opened',
      connectionId,
      peerId: targetPeerId,
    });
  }

  forwardConnectionData(fromPeerId, message) {
    const connectionId = String(message.connectionId || '').trim();
    if (!connectionId) return;
    const link = this.connections.get(connectionId);
    if (!link) return;

    const targetPeerId = link.aPeerId === fromPeerId ? link.bPeerId : link.bPeerId === fromPeerId ? link.aPeerId : '';
    if (!targetPeerId) return;

    const targetSocket = this.peers.get(targetPeerId);
    if (!targetSocket) {
      this.closeConnection(fromPeerId, connectionId, true);
      return;
    }

    this.send(targetSocket, {
      type: 'connection-data',
      connectionId,
      data: message.data,
    });
  }

  closeConnection(fromPeerId, connectionId, notifyPeer, closeReason = '') {
    if (!connectionId) return;
    const link = this.connections.get(connectionId);
    if (!link) return;

    this.connections.delete(connectionId);

    if (!notifyPeer) return;

    const targetPeerId = link.aPeerId === fromPeerId ? link.bPeerId : link.bPeerId === fromPeerId ? link.aPeerId : '';
    if (!targetPeerId) return;

    const targetSocket = this.peers.get(targetPeerId);
    if (!targetSocket) return;

    this.send(targetSocket, {
      type: 'connection-close',
      connectionId,
      closeReason,
    });
  }

  handleClose(socket) {
    const meta = this.sockets.get(socket);
    if (!meta) return;

    this.sockets.delete(socket);

    if (!meta.peerId) return;

    this.peers.delete(meta.peerId);

    const toRemove = [];
    for (const [connectionId, link] of this.connections.entries()) {
      if (link.aPeerId !== meta.peerId && link.bPeerId !== meta.peerId) continue;
      toRemove.push({ connectionId, link });
    }

    toRemove.forEach(({ connectionId, link }) => {
      this.connections.delete(connectionId);
      const otherPeerId = link.aPeerId === meta.peerId ? link.bPeerId : link.aPeerId;
      const otherSocket = this.peers.get(otherPeerId);
      if (otherSocket) {
        this.send(otherSocket, {
          type: 'connection-close',
          connectionId,
        });
      }
    });
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // no-op
    }
  }

  generatePeerId() {
    return 'p-' + crypto.randomUUID().slice(0, 12);
  }
}
