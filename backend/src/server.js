import { createServer } from 'http';

import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

const app = express();
const port = Number(process.env.PORT || 8080);
const GROUP_ROOM_TTL_MS = Number(process.env.GROUP_ROOM_TTL_MS || 60 * 60 * 1000);
const P2P_ROOM_TTL_MS = Number(process.env.P2P_ROOM_TTL_MS || 15 * 60 * 1000);

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

const rooms = new Map();

const normalizeOrigin = (origin) => {
  const value = (origin || '').trim();
  if (!value) return null;
  if (value === '*') return '*';
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://${value}`;
};

const getCorsOrigins = () => {
  const rawOrigins = (process.env.CORS_ORIGIN || '*').trim();
  if (rawOrigins === '*') return true;

  const origins = rawOrigins
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  if (origins.includes('*')) return true;
  return origins.length > 0 ? origins : true;
};

const getIceServers = () => {
  const rawValue = process.env.ICE_SERVERS_JSON;
  if (!rawValue) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.warn('Invalid ICE_SERVERS_JSON. Falling back to default servers.', error);
  }

  return DEFAULT_ICE_SERVERS;
};

const toRoomChannel = (roomId) => `room:${roomId}`;

const isValidRoomId = (roomId) => (
  typeof roomId === 'string' && roomId.trim().length >= 8 && roomId.trim().length <= 128
);

const isValidPeerId = (peerId) => (
  typeof peerId === 'string' && peerId.trim().length >= 8 && peerId.trim().length <= 128
);

const clearRoomTimer = (room) => {
  if (room?.expiryTimer) {
    clearTimeout(room.expiryTimer);
    room.expiryTimer = null;
  }
};

const closeRoom = (io, roomId, reason = 'closed') => {
  const room = rooms.get(roomId);
  if (!room) return false;

  clearRoomTimer(room);

  const hostSocket = io.sockets.sockets.get(room.hostSocketId);
  if (hostSocket) {
    hostSocket.data.hostedRoomId = null;
    hostSocket.leave(toRoomChannel(roomId));
  }

  for (const peer of room.peers.values()) {
    const peerSocket = io.sockets.sockets.get(peer.socketId);
    if (peerSocket) {
      peerSocket.data.joinedRoomId = null;
      peerSocket.data.peerId = null;
      peerSocket.leave(toRoomChannel(roomId));
      peerSocket.emit('room:closed', { roomId, reason });
    }
  }

  rooms.delete(roomId);
  return true;
};

const scheduleRoomExpiry = (io, room) => {
  clearRoomTimer(room);

  const ttlMs = room.mode === 'group' ? GROUP_ROOM_TTL_MS : P2P_ROOM_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;

  room.expiryTimer = setTimeout(() => {
    closeRoom(io, room.id, 'expired');
  }, ttlMs);

  if (typeof room.expiryTimer.unref === 'function') {
    room.expiryTimer.unref();
  }
};

const removePeerFromRoom = (io, room, peerId, reason = 'left') => {
  const peer = room.peers.get(peerId);
  if (!peer) return false;

  room.peers.delete(peerId);

  const peerSocket = io.sockets.sockets.get(peer.socketId);
  if (peerSocket) {
    peerSocket.data.joinedRoomId = null;
    peerSocket.data.peerId = null;
    peerSocket.leave(toRoomChannel(room.id));
  }

  const hostSocket = io.sockets.sockets.get(room.hostSocketId);
  if (hostSocket) {
    hostSocket.emit('room:peer-left', {
      roomId: room.id,
      peerId,
      reason
    });
  }

  return true;
};

const corsOrigins = getCorsOrigins();

app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'directdrop-backend',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/runtime-config', (_req, res) => {
  res.status(200).json({
    iceServers: getIceServers()
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    message: 'DirectDrop backend is running.',
    health: '/health',
    runtimeConfig: '/api/runtime-config'
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins === true ? true : corsOrigins,
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  const ackOk = (ack, payload = {}) => {
    if (typeof ack === 'function') {
      ack({ ok: true, ...payload });
    }
  };

  const ackError = (ack, error) => {
    if (typeof ack === 'function') {
      ack({ ok: false, error });
    }
  };

  socket.on('host:create-room', ({ roomId, mode, hasPassword } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    if (!isValidRoomId(normalizedRoomId)) {
      ackError(ack, 'Invalid room ID.');
      return;
    }

    if (rooms.has(normalizedRoomId)) {
      ackError(ack, 'Room already exists.');
      return;
    }

    if (socket.data.hostedRoomId) {
      closeRoom(io, socket.data.hostedRoomId, 'replaced-by-new-room');
    }

    const normalizedMode = mode === 'group' ? 'group' : 'p2p';
    const room = {
      id: normalizedRoomId,
      mode: normalizedMode,
      hasPassword: Boolean(hasPassword),
      hostSocketId: socket.id,
      peers: new Map(),
      createdAt: Date.now(),
      expiryTimer: null
    };

    rooms.set(normalizedRoomId, room);
    scheduleRoomExpiry(io, room);

    socket.data.hostedRoomId = normalizedRoomId;
    socket.join(toRoomChannel(normalizedRoomId));

    ackOk(ack, {
      roomId: normalizedRoomId,
      mode: normalizedMode,
      hasPassword: room.hasPassword
    });
  });

  socket.on('room:get-info', ({ roomId } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    ackOk(ack, {
      roomId: room.id,
      mode: room.mode,
      hasPassword: room.hasPassword
    });
  });

  socket.on('peer:join-room', ({ roomId, peerId, offer } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    if (!isValidRoomId(normalizedRoomId) || !isValidPeerId(normalizedPeerId) || !offer) {
      ackError(ack, 'Invalid peer join payload.');
      return;
    }

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    if (room.mode === 'p2p' && room.peers.size >= 1 && !room.peers.has(normalizedPeerId)) {
      ackError(ack, 'Room already has an active peer.');
      return;
    }

    if (socket.data.joinedRoomId && socket.data.joinedRoomId !== normalizedRoomId) {
      const oldRoom = rooms.get(socket.data.joinedRoomId);
      if (oldRoom && socket.data.peerId) {
        removePeerFromRoom(io, oldRoom, socket.data.peerId, 'switched-room');
      }
    }

    const existingPeer = room.peers.get(normalizedPeerId);
    if (existingPeer && existingPeer.socketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingPeer.socketId);
      if (existingSocket) {
        existingSocket.data.joinedRoomId = null;
        existingSocket.data.peerId = null;
        existingSocket.leave(toRoomChannel(normalizedRoomId));
        existingSocket.emit('room:closed', { roomId: normalizedRoomId, reason: 'peer-reconnected' });
      }
    }

    room.peers.set(normalizedPeerId, {
      socketId: socket.id,
      joinedAt: Date.now()
    });

    socket.data.joinedRoomId = normalizedRoomId;
    socket.data.peerId = normalizedPeerId;
    socket.join(toRoomChannel(normalizedRoomId));

    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (!hostSocket) {
      removePeerFromRoom(io, room, normalizedPeerId, 'host-offline');
      closeRoom(io, normalizedRoomId, 'host-disconnected');
      ackError(ack, 'Host is offline.');
      return;
    }

    scheduleRoomExpiry(io, room);

    hostSocket.emit('room:peer-offer', {
      roomId: normalizedRoomId,
      peerId: normalizedPeerId,
      offer
    });

    ackOk(ack);
  });

  socket.on('peer:ice-candidate', ({ roomId, peerId, candidate } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    const peer = room.peers.get(normalizedPeerId);
    if (!peer || peer.socketId !== socket.id) {
      ackError(ack, 'Peer is not part of the room.');
      return;
    }

    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (!hostSocket) {
      ackError(ack, 'Host is offline.');
      return;
    }

    hostSocket.emit('host:peer-candidate', {
      roomId: normalizedRoomId,
      peerId: normalizedPeerId,
      candidate
    });

    ackOk(ack);
  });

  socket.on('host:ice-candidate', ({ roomId, peerId, candidate } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    if (room.hostSocketId !== socket.id) {
      ackError(ack, 'Only the host can send host ICE candidates.');
      return;
    }

    const peer = room.peers.get(normalizedPeerId);
    if (!peer) {
      ackError(ack, 'Peer does not exist in room.');
      return;
    }

    const peerSocket = io.sockets.sockets.get(peer.socketId);
    if (!peerSocket) {
      removePeerFromRoom(io, room, normalizedPeerId, 'peer-offline');
      ackError(ack, 'Peer is offline.');
      return;
    }

    peerSocket.emit('peer:host-candidate', {
      roomId: normalizedRoomId,
      peerId: normalizedPeerId,
      candidate
    });

    ackOk(ack);
  });

  socket.on('host:answer', ({ roomId, peerId, answer } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    if (room.hostSocketId !== socket.id) {
      ackError(ack, 'Only the host can answer peer offers.');
      return;
    }

    const peer = room.peers.get(normalizedPeerId);
    if (!peer) {
      ackError(ack, 'Peer does not exist in room.');
      return;
    }

    const peerSocket = io.sockets.sockets.get(peer.socketId);
    if (!peerSocket) {
      removePeerFromRoom(io, room, normalizedPeerId, 'peer-offline');
      ackError(ack, 'Peer is offline.');
      return;
    }

    peerSocket.emit('peer:answer', {
      roomId: normalizedRoomId,
      peerId: normalizedPeerId,
      answer
    });

    ackOk(ack);
  });

  socket.on('host:reject-peer', ({ roomId, peerId, reason } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackError(ack, 'Room does not exist.');
      return;
    }

    if (room.hostSocketId !== socket.id) {
      ackError(ack, 'Only the host can reject a peer.');
      return;
    }

    const peer = room.peers.get(normalizedPeerId);
    if (peer) {
      const peerSocket = io.sockets.sockets.get(peer.socketId);
      if (peerSocket) {
        peerSocket.emit('peer:join-error', {
          roomId: normalizedRoomId,
          peerId: normalizedPeerId,
          reason: reason || 'Peer rejected by host.'
        });
      }
      removePeerFromRoom(io, room, normalizedPeerId, 'rejected');
    }

    ackOk(ack);
  });

  socket.on('peer:leave-room', ({ roomId, peerId } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';

    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackOk(ack);
      return;
    }

    const peer = room.peers.get(normalizedPeerId);
    if (!peer || peer.socketId !== socket.id) {
      ackOk(ack);
      return;
    }

    removePeerFromRoom(io, room, normalizedPeerId, 'left');
    ackOk(ack);
  });

  socket.on('host:close-room', ({ roomId, reason } = {}, ack) => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const room = rooms.get(normalizedRoomId);
    if (!room) {
      ackOk(ack);
      return;
    }

    if (room.hostSocketId !== socket.id) {
      ackError(ack, 'Only the host can close this room.');
      return;
    }

    closeRoom(io, normalizedRoomId, reason || 'host-closed-room');
    ackOk(ack);
  });

  socket.on('disconnect', () => {
    const hostedRoomId = socket.data.hostedRoomId;
    if (hostedRoomId) {
      closeRoom(io, hostedRoomId, 'host-disconnected');
    }

    const joinedRoomId = socket.data.joinedRoomId;
    const peerId = socket.data.peerId;
    if (joinedRoomId && peerId) {
      const room = rooms.get(joinedRoomId);
      if (room) {
        const peer = room.peers.get(peerId);
        if (peer && peer.socketId === socket.id) {
          removePeerFromRoom(io, room, peerId, 'peer-disconnected');
        }
      }
    }
  });
});

httpServer.listen(port, () => {
  console.log(`DirectDrop backend listening on port ${port}`);
});
