import { json } from '@sveltejs/kit';
import {
	emitMediaEvent,
	resolveNexusUserId,
	getWebhookHandler,
	registerWebhookHandler,
	heightToResolution,
	channelsToLabel
} from '$lib/server/analytics';
import { getEnabledConfigs } from '$lib/server/services';
import type { RequestHandler } from './$types';

// ---------------------------------------------------------------------------
// Jellyfin webhook handler — registered as a plugin
// ---------------------------------------------------------------------------

// Playback events (PlaybackStart, PlaybackStop, PlaybackProgress) are handled
// by the session poller with proper session tracking and pause-time subtraction.
// The webhook only handles non-playback events to avoid double-counting.
const JF_EVENT_MAP: Record<string, string> = {
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

registerWebhookHandler('jellyfin', async (request) => {
	let body: any;
	try {
		body = await request.json();
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}

	const notificationType = body.NotificationType ?? body.Event;
	const eventType = JF_EVENT_MAP[notificationType];
	if (!eventType) return { ok: true, skipped: true };

	const jellyfinUserId = body.UserId ?? body.User?.Id;
	const item = body.Item ?? body;
	if (!jellyfinUserId || !item?.Id) return { ok: true, skipped: true };

	const nexusUserId = resolveNexusUserId(jellyfinUserId);
	if (!nexusUserId) return { ok: true, skipped: true };

	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const serviceId = configs[0]?.id ?? 'unknown';

	const session = body.Session ?? {};
	const playState = session.PlayState ?? {};
	const transcodingInfo = session.TranscodingInfo ?? {};
	const mediaStreams = (item.MediaStreams ?? []) as any[];

	const videoStream = mediaStreams.find((s: any) => s.Type === 'Video');
	const audioStream = mediaStreams.find((s: any) => s.Type === 'Audio');
	const subtitleStream = mediaStreams.find((s: any) => s.Type === 'Subtitle');

	const metadata: Record<string, unknown> = {};
	if (videoStream) {
		metadata.resolution = heightToResolution(videoStream.Height);
		metadata.videoCodec = videoStream.Codec;
		metadata.hdr = videoStream.VideoRangeType ?? (videoStream.VideoRange === 'HDR' ? 'hdr10' : 'sdr');
	}
	if (audioStream) {
		metadata.audioCodec = audioStream.Codec;
		metadata.audioChannels = channelsToLabel(audioStream.Channels);
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
		userId: nexusUserId,
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

	return { ok: true, event: eventType };
});

/**
 * POST /api/ingest/webhook/:serviceType
 * Routes to registered webhook handlers. New services just call registerWebhookHandler().
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { serviceType } = params;
	const handler = getWebhookHandler(serviceType);

	if (!handler) {
		return json({ error: `No webhook handler for: ${serviceType}` }, { status: 400 });
	}

	const result = await handler(request);
	if (!result.ok && result.error) {
		return json({ error: result.error }, { status: 400 });
	}
	return json(result);
};
