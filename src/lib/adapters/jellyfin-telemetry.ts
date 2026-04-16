import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackMode } from './playback';

function authHeaders(token: string) {
	return {
		'Content-Type': 'application/json',
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
		'X-Emby-Token': token,
	};
}

function playMethodFromMode(mode: PlaybackMode): string {
	switch (mode) {
		case 'direct-play': return 'DirectPlay';
		case 'remux': return 'DirectStream';
		case 'direct-stream': return 'DirectStream';
		case 'transcode': return 'Transcode';
	}
}

export async function reportPlaybackStart(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		mode: PlaybackMode;
		positionTicks?: number;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PlayMethod: playMethodFromMode(params.mode),
			PositionTicks: params.positionTicks ?? 0,
			CanSeek: true,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function reportPlaybackProgress(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		mode: PlaybackMode;
		positionTicks: number;
		isPaused: boolean;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Progress`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PlayMethod: playMethodFromMode(params.mode),
			PositionTicks: params.positionTicks,
			IsPaused: params.isPaused,
			CanSeek: true,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function reportPlaybackStopped(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		positionTicks: number;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Stopped`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PositionTicks: params.positionTicks,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function pingTranscodeSession(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	playSessionId: string
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Ping`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ PlaySessionId: playSessionId }),
		signal: AbortSignal.timeout(3000),
	}).catch(() => {});
}
