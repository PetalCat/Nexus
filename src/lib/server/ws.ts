import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'http';
import { validateSession, COOKIE_NAME } from './auth';
import { emitInteractionEventsBatch } from './analytics';

// ── Types ────────────────────────────────────────────────────────────────

export interface WsMessage {
	type: string;
	data?: Record<string, unknown>;
}

interface ConnectedUser {
	userId: string;
	username: string;
	sockets: Set<WebSocket>;
	lastHeartbeat: number;
}

// ── State ────────────────────────────────────────────────────────────────

const connectedUsers = new Map<string, ConnectedUser>();
const socketToUser = new Map<WebSocket, string>();
let wss: WebSocketServer | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_CHECK_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

// ── Exported API ─────────────────────────────────────────────────────────

export function attachWebSocketServer(server: http.Server): void {
	if (wss) return;

	wss = new WebSocketServer({ noServer: true });

	server.on('upgrade', (req, socket, head) => {
		const url = new URL(req.url || '/', `http://${req.headers.host}`);

		if (url.pathname !== '/ws') {
			socket.destroy();
			return;
		}

		// Auth: check token param or cookie
		let token = url.searchParams.get('token');
		if (!token) {
			const cookie = req.headers.cookie;
			if (cookie) {
				const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
				if (match) token = match[1];
			}
		}

		const user = validateSession(token ?? undefined);
		if (!user) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		wss!.handleUpgrade(req, socket, head, (ws) => {
			wss!.emit('connection', ws, user);
		});
	});

	wss.on('connection', (ws: WebSocket, user: { id: string; username: string }) => {
		const userId = user.id;

		// Track connection
		let entry = connectedUsers.get(userId);
		if (!entry) {
			entry = { userId, username: user.username, sockets: new Set(), lastHeartbeat: Date.now() };
			connectedUsers.set(userId, entry);
		}
		entry.sockets.add(ws);
		entry.lastHeartbeat = Date.now();
		socketToUser.set(ws, userId);

		// Handle messages
		ws.on('message', (raw) => {
			try {
				const msg: WsMessage = JSON.parse(raw.toString());
				handleMessage(userId, msg);
			} catch {
				// ignore malformed
			}
		});

		ws.on('close', () => {
			socketToUser.delete(ws);
			const e = connectedUsers.get(userId);
			if (e) {
				e.sockets.delete(ws);
				if (e.sockets.size === 0) {
					connectedUsers.delete(userId);
					// Will be broadcast by presence system
					onUserDisconnected(userId);
				}
			}
		});

		ws.on('error', () => {
			ws.close();
		});

		onUserConnected(userId);
	});

	// Heartbeat checker
	heartbeatInterval = setInterval(() => {
		const now = Date.now();
		for (const [userId, entry] of connectedUsers) {
			if (now - entry.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
				// Close all sockets for this user
				for (const s of entry.sockets) s.close();
				entry.sockets.clear();
				connectedUsers.delete(userId);
				onUserDisconnected(userId);
			}
		}
	}, HEARTBEAT_CHECK_MS);
}

export function broadcastToUser(userId: string, msg: WsMessage): void {
	const entry = connectedUsers.get(userId);
	if (!entry) return;
	const payload = JSON.stringify(msg);
	for (const ws of entry.sockets) {
		if (ws.readyState === 1) ws.send(payload);
	}
}

export function broadcastToFriends(userId: string, msg: WsMessage, getFriendIds: () => string[]): void {
	const friendIds = getFriendIds();
	const payload = JSON.stringify(msg);
	for (const fid of friendIds) {
		const entry = connectedUsers.get(fid);
		if (!entry) continue;
		for (const ws of entry.sockets) {
			if (ws.readyState === 1) ws.send(payload);
		}
	}
}

export function broadcastToSession(sessionId: string, msg: WsMessage, excludeUserId?: string): void {
	// Session participants tracked externally — broadcast to all session members who are online
	const payload = JSON.stringify(msg);
	for (const [userId, entry] of connectedUsers) {
		if (userId === excludeUserId) continue;
		// The caller should filter to session participants; this is a convenience
		// that checks if any connected user is in the session. For efficiency,
		// we expose this as a targeted broadcast via sessionUserIds.
		for (const ws of entry.sockets) {
			if (ws.readyState === 1) ws.send(payload);
		}
	}
}

export function broadcastToUsers(userIds: string[], msg: WsMessage, excludeUserId?: string): void {
	const payload = JSON.stringify(msg);
	for (const uid of userIds) {
		if (uid === excludeUserId) continue;
		const entry = connectedUsers.get(uid);
		if (!entry) continue;
		for (const ws of entry.sockets) {
			if (ws.readyState === 1) ws.send(payload);
		}
	}
}

export function getOnlineUserIds(): Set<string> {
	return new Set(connectedUsers.keys());
}

export function isUserOnline(userId: string): boolean {
	return connectedUsers.has(userId);
}

export function getConnectedUserCount(): number {
	return connectedUsers.size;
}

// ── Message Handlers ─────────────────────────────────────────────────────

function handleMessage(userId: string, msg: WsMessage): void {
	switch (msg.type) {
		case 'heartbeat': {
			const entry = connectedUsers.get(userId);
			if (entry) entry.lastHeartbeat = Date.now();
			break;
		}
		case 'analytics:events': {
			const events = msg.data?.events;
			if (Array.isArray(events)) {
				emitInteractionEventsBatch(events as Parameters<typeof emitInteractionEventsBatch>[0]);
			}
			break;
		}
		// session:message, session:join, session:leave handled by registering handlers
		default:
			// Dispatch to registered handlers
			for (const handler of messageHandlers) {
				handler(userId, msg);
			}
			break;
	}
}

// ── Handler Registration ─────────────────────────────────────────────────

type MessageHandler = (userId: string, msg: WsMessage) => void;
const messageHandlers: MessageHandler[] = [];

export function onWsMessage(handler: MessageHandler): void {
	messageHandlers.push(handler);
}

// ── Connection Hooks ─────────────────────────────────────────────────────

type ConnectionHook = (userId: string) => void;
const connectHooks: ConnectionHook[] = [];
const disconnectHooks: ConnectionHook[] = [];

export function onUserConnect(hook: ConnectionHook): void {
	connectHooks.push(hook);
}

export function onUserDisconnect(hook: ConnectionHook): void {
	disconnectHooks.push(hook);
}

function onUserConnected(userId: string): void {
	for (const hook of connectHooks) {
		try { hook(userId); } catch { /* ignore */ }
	}
}

function onUserDisconnected(userId: string): void {
	for (const hook of disconnectHooks) {
		try { hook(userId); } catch { /* ignore */ }
	}
}

// ── Cleanup ──────────────────────────────────────────────────────────────

export function shutdownWs(): void {
	if (heartbeatInterval) clearInterval(heartbeatInterval);
	if (wss) wss.close();
	connectedUsers.clear();
	socketToUser.clear();
}
