import { json } from '@sveltejs/kit';
import { emitMediaEvent } from '$lib/server/analytics';
import { getEnabledConfigs } from '$lib/server/services';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const EVENT_MAP: Record<string, string> = {
	PlaybackStart: 'play_start',
	PlaybackStop: 'play_stop',
	PlaybackProgress: 'progress',
	ItemAdded: 'add_to_library',
	UserDataSaved: 'mark_watched',
	ItemRated: 'rate'
};

const JF_TYPE_MAP: Record<string, string> = {
	Movie: 'movie',
	Series: 'show',
	Episode: 'episode',
	Audio: 'music',
	MusicAlbum: 'album'
};

/**
 * POST /api/ingest/webhook/jellyfin
 * Receives Jellyfin Webhook Plugin payloads and converts them to media_events.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { serviceType } = params;

	if (serviceType === 'jellyfin') {
		return handleJellyfinWebhook(request);
	}

	return json({ error: `Unsupported service type: ${serviceType}` }, { status: 400 });
};

async function handleJellyfinWebhook(request: Request) {
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const notificationType = body.NotificationType ?? body.Event;
	const eventType = EVENT_MAP[notificationType];
	if (!eventType) {
		return json({ ok: true, skipped: true });
	}

	const jellyfinUserId = body.UserId ?? body.User?.Id;
	const item = body.Item ?? body;

	if (!jellyfinUserId || !item?.Id) {
		return json({ ok: true, skipped: true });
	}

	// Resolve Nexus userId from Jellyfin external user ID
	const db = getDb();
	const cred = db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.externalUserId, jellyfinUserId))
		.get();

	if (!cred) {
		return json({ ok: true, skipped: true, reason: 'unknown user' });
	}

	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const serviceId = cred.serviceId ?? configs[0]?.id ?? 'unknown';

	const session = body.Session ?? {};
	const playState = session.PlayState ?? {};
	const transcodingInfo = session.TranscodingInfo ?? {};
	const mediaStreams = (item.MediaStreams ?? []) as any[];

	const videoStream = mediaStreams.find((s: any) => s.Type === 'Video');
	const audioStream = mediaStreams.find((s: any) => s.Type === 'Audio');
	const subtitleStream = mediaStreams.find((s: any) => s.Type === 'Subtitle');

	const metadata: Record<string, unknown> = {};
	if (videoStream) {
		metadata.resolution = videoStream.Height >= 2160 ? '4K' : videoStream.Height >= 1080 ? '1080p' : videoStream.Height >= 720 ? '720p' : `${videoStream.Height}p`;
		metadata.videoCodec = videoStream.Codec;
		metadata.hdr = videoStream.VideoRangeType ?? (videoStream.VideoRange === 'HDR' ? 'hdr10' : 'sdr');
	}
	if (audioStream) {
		metadata.audioCodec = audioStream.Codec;
		metadata.audioChannels = audioStream.Channels > 6 ? '7.1' : audioStream.Channels > 2 ? '5.1' : 'stereo';
		metadata.audioTrackLanguage = audioStream.Language;
	}
	if (subtitleStream) {
		metadata.subtitleLanguage = subtitleStream.Language;
		metadata.subtitleFormat = subtitleStream.Codec;
		metadata.closedCaptions = !!subtitleStream.IsForced;
	}
	if (transcodingInfo.IsTranscoding !== undefined) {
		metadata.isTranscoding = transcodingInfo.IsTranscoding;
		metadata.transcodeReason = transcodingInfo.TranscodeReasons?.join(', ');
		metadata.streamType = transcodingInfo.IsTranscoding ? 'transcode' : 'direct-play';
		metadata.bitrate = transcodingInfo.Bitrate;
	}

	metadata.deviceName = session.DeviceName ?? body.DeviceName;
	metadata.clientName = session.Client ?? body.ClientName;

	if (body.Rating != null) metadata.ratingValue = body.Rating;
	if (body.IsFavorite != null) metadata.isFavorite = body.IsFavorite;

	emitMediaEvent({
		userId: cred.userId,
		serviceId,
		serviceType: 'jellyfin',
		eventType,
		mediaId: item.Id,
		mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
		mediaTitle: item.Name,
		mediaYear: item.ProductionYear,
		mediaGenres: item.Genres,
		parentId: item.SeriesId ?? item.ParentId,
		parentTitle: item.SeriesName,
		positionTicks: playState.PositionTicks ?? body.PlaybackPositionTicks,
		durationTicks: item.RunTimeTicks,
		deviceName: session.DeviceName ?? body.DeviceName,
		clientName: session.Client ?? body.ClientName,
		metadata
	});

	return json({ ok: true, event: eventType });
}
