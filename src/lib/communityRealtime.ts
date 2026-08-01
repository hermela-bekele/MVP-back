import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { verifyAccessToken } from './tokens.js';
import { query } from '../db/pool.js';

type PresenceUser = { userId: string; displayName: string; communityId: string };

let io: Server | null = null;

/** communityId → userId → { displayName, socketCount } */
const presence = new Map<string, Map<string, { displayName: string; sockets: Set<string> }>>();

function roomChannel(channelId: string) {
  return `channel:${channelId}`;
}
function roomThread(threadId: string) {
  return `thread:${threadId}`;
}
function roomCommunity(communityId: string) {
  return `community:${communityId}`;
}
function roomUser(userId: string) {
  return `user:${userId}`;
}

async function loadUser(userId: string) {
  const { rows } = await query(
    `SELECT id, display_name FROM portal_users WHERE id = $1`,
    [userId]
  );
  return rows[0] as { id: string; display_name: string } | undefined;
}

async function isMember(communityId: string, userId: string) {
  const { rows } = await query(
    `SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  );
  return rows.length > 0;
}

function emitPresence(communityId: string) {
  if (!io) return;
  const map = presence.get(communityId);
  const onlineUserIds = map ? [...map.keys()] : [];
  io.to(roomCommunity(communityId)).emit('presence:update', { communityId, onlineUserIds });
}

function joinPresence(communityId: string, user: PresenceUser, socketId: string) {
  let map = presence.get(communityId);
  if (!map) {
    map = new Map();
    presence.set(communityId, map);
  }
  const entry = map.get(user.userId) ?? {
    displayName: user.displayName,
    sockets: new Set<string>(),
  };
  entry.sockets.add(socketId);
  entry.displayName = user.displayName;
  map.set(user.userId, entry);
  emitPresence(communityId);
}

function leavePresence(communityId: string, userId: string, socketId: string) {
  const map = presence.get(communityId);
  if (!map) return;
  const entry = map.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) map.delete(userId);
  if (map.size === 0) presence.delete(communityId);
  emitPresence(communityId);
}

export function initCommunityRealtime(httpServer: HttpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as string | undefined);
      const userId =
        (socket.handshake.auth?.userId as string | undefined) ||
        (socket.handshake.headers['x-user-id'] as string | undefined);

      let resolvedId = userId;
      if (token) {
        const payload = verifyAccessToken(token);
        if (payload?.sub) resolvedId = payload.sub;
      }
      if (!resolvedId) {
        next(new Error('Unauthorized'));
        return;
      }
      const user = await loadUser(resolvedId);
      if (!user) {
        next(new Error('Unauthorized'));
        return;
      }
      socket.data.userId = user.id;
      socket.data.displayName = user.display_name;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    const displayName = socket.data.displayName as string;
    socket.join(roomUser(userId));

    socket.on('community:join', async (payload: { communityId: string }, ack?) => {
      try {
        const communityId = payload?.communityId;
        if (!communityId || !(await isMember(communityId, userId))) {
          ack?.({ ok: false, error: 'Forbidden' });
          return;
        }
        socket.join(roomCommunity(communityId));
        joinPresence(communityId, { userId, displayName, communityId }, socket.id);
        const map = presence.get(communityId);
        ack?.({ ok: true, onlineUserIds: map ? [...map.keys()] : [] });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('community:leave', (payload: { communityId: string }) => {
      const communityId = payload?.communityId;
      if (!communityId) return;
      socket.leave(roomCommunity(communityId));
      leavePresence(communityId, userId, socket.id);
    });

    socket.on('channel:join', async (payload: { channelId: string; communityId: string }, ack?) => {
      try {
        if (!(await isMember(payload.communityId, userId))) {
          ack?.({ ok: false });
          return;
        }
        socket.join(roomChannel(payload.channelId));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('channel:leave', (payload: { channelId: string }) => {
      if (payload?.channelId) socket.leave(roomChannel(payload.channelId));
    });

    socket.on('thread:join', async (payload: { threadId: string; communityId: string }, ack?) => {
      try {
        if (!(await isMember(payload.communityId, userId))) {
          ack?.({ ok: false });
          return;
        }
        socket.join(roomThread(payload.threadId));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('thread:leave', (payload: { threadId: string }) => {
      if (payload?.threadId) socket.leave(roomThread(payload.threadId));
    });

    socket.on(
      'typing:start',
      (payload: { channelId?: string; threadId?: string; communityId: string }) => {
        const data = {
          userId,
          displayName,
          channelId: payload.channelId,
          threadId: payload.threadId,
        };
        if (payload.channelId) {
          socket.to(roomChannel(payload.channelId)).emit('typing:update', data);
        }
        if (payload.threadId) {
          socket.to(roomThread(payload.threadId)).emit('typing:update', data);
        }
      }
    );

    socket.on('disconnect', () => {
      for (const [communityId, map] of presence) {
        if (map.has(userId)) leavePresence(communityId, userId, socket.id);
      }
    });
  });

  console.log('Community Socket.IO attached');
  return io;
}

export function emitChannelMessage(channelId: string, message: unknown) {
  io?.to(roomChannel(channelId)).emit('message:new', { scope: 'channel', channelId, message });
}

export function emitThreadMessage(threadId: string, message: unknown) {
  io?.to(roomThread(threadId)).emit('message:new', { scope: 'thread', threadId, message });
}

export function emitMention(userId: string, payload: unknown) {
  io?.to(roomUser(userId)).emit('mention:new', payload);
}

export function emitReaction(payload: {
  messageId: string;
  channelId?: string | null;
  threadId?: string | null;
}) {
  if (payload.channelId) {
    io?.to(roomChannel(payload.channelId)).emit('reaction:update', payload);
  }
  if (payload.threadId) {
    io?.to(roomThread(payload.threadId)).emit('reaction:update', payload);
  }
}
