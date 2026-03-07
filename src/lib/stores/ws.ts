import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

// ── Types ────────────────────────────────────────────────────────────────

export interface WsMessage {
	type: string;
	data?: Record<string, unknown>;
}

export interface FriendStatus {
	userId: string;
	username: string;
	displayName: string;
	status: string;
	customStatus: string | null;
	currentActivity: unknown | null;
}

export interface Notification {
	id: string;
	type: string;
	data: Record<string, unknown>;
	timestamp: number;
	read: boolean;
}

// ── Stores ───────────────────────────────────────────────────────────────

export const wsConnected = writable(false);
export const onlineFriends = writable<FriendStatus[]>([]);
export const notifications = writable<Notification[]>([]);
export const unseenShareCount = writable(0);

// Derived
export const onlineFriendCount = derived(onlineFriends, ($f) => $f.filter((f) => f.status !== 'offline').length);

// ── Connection State ─────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000;
const HEARTBEAT_INTERVAL = 30_000;

const messageHandlers = new Map<string, Set<(data: Record<string, unknown>) => void>>();

// ── Public API ───────────────────────────────────────────────────────────

export function connectWs(): void {
	if (!browser) return;
	if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const url = `${protocol}//${window.location.host}/api/ws`;

	ws = new WebSocket(url);

	ws.onopen = () => {
		wsConnected.set(true);
		reconnectAttempts = 0;

		// Start heartbeat
		heartbeatTimer = setInterval(() => {
			sendMessage({ type: 'heartbeat' });
		}, HEARTBEAT_INTERVAL);
	};

	ws.onmessage = (event) => {
		try {
			const msg: WsMessage = JSON.parse(event.data);
			handleIncoming(msg);
		} catch {
			// ignore malformed
		}
	};

	ws.onclose = () => {
		wsConnected.set(false);
		cleanup();
		scheduleReconnect();
	};

	ws.onerror = () => {
		ws?.close();
	};
}

export function disconnectWs(): void {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = null;
	reconnectAttempts = MAX_RECONNECT_DELAY; // Prevent auto-reconnect
	cleanup();
	ws?.close();
	ws = null;
}

export function sendMessage(msg: WsMessage): void {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

export function onMessage(type: string, handler: (data: Record<string, unknown>) => void): () => void {
	if (!messageHandlers.has(type)) messageHandlers.set(type, new Set());
	messageHandlers.get(type)!.add(handler);
	return () => {
		messageHandlers.get(type)?.delete(handler);
	};
}

export function clearNotifications(): void {
	notifications.set([]);
}

export function markNotificationRead(id: string): void {
	notifications.update((n) => n.map((item) => (item.id === id ? { ...item, read: true } : item)));
}

// ── Internal ─────────────────────────────────────────────────────────────

function cleanup(): void {
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	heartbeatTimer = null;
}

function scheduleReconnect(): void {
	if (reconnectTimer) return;
	const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
	reconnectAttempts++;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectWs();
	}, delay);
}

function handleIncoming(msg: WsMessage): void {
	const data = msg.data ?? {};

	// Built-in handlers
	switch (msg.type) {
		case 'presence:friends_status': {
			const friends = (data.friends as FriendStatus[]) ?? [];
			onlineFriends.set(friends);
			break;
		}

		case 'presence:updated': {
			const userId = data.userId as string;
			onlineFriends.update((friends) => {
				const idx = friends.findIndex((f) => f.userId === userId);
				if (idx >= 0) {
					friends[idx] = { ...friends[idx], ...data } as FriendStatus;
					return [...friends];
				}
				return friends;
			});
			break;
		}

		case 'presence:activity_started':
		case 'presence:activity_stopped': {
			const userId = data.userId as string;
			onlineFriends.update((friends) => {
				const idx = friends.findIndex((f) => f.userId === userId);
				if (idx >= 0) {
					friends[idx] = {
						...friends[idx],
						currentActivity: msg.type === 'presence:activity_started' ? data.activity : null
					};
					return [...friends];
				}
				return friends;
			});
			break;
		}

		case 'presence:notification': {
			const notif: Notification = {
				id: crypto.randomUUID(),
				type: (data.notificationType as string) ?? 'generic',
				data,
				timestamp: Date.now(),
				read: false
			};
			notifications.update((n) => [notif, ...n].slice(0, 100));

			if (data.notificationType === 'share_received') {
				unseenShareCount.update((c) => c + 1);
			}
			break;
		}
	}

	// Custom handlers
	const handlers = messageHandlers.get(msg.type);
	if (handlers) {
		for (const handler of handlers) {
			try { handler(data); } catch { /* ignore */ }
		}
	}
}
