import { getDb, schema } from '../db';

// ---------------------------------------------------------------------------
// Media event ingestion
// ---------------------------------------------------------------------------

export interface MediaEventInput {
	userId: string;
	serviceId: string;
	serviceType: string;
	eventType: string;
	mediaId: string;
	mediaType: string;
	mediaTitle?: string;
	mediaYear?: number;
	mediaGenres?: string[];
	parentId?: string;
	parentTitle?: string;
	positionTicks?: number;
	durationTicks?: number;
	playDurationMs?: number;
	deviceName?: string;
	clientName?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

/**
 * Insert a single media event. Fire-and-forget — never throws.
 */
export function emitMediaEvent(input: MediaEventInput): void {
	try {
		const db = getDb();
		const now = Date.now();
		db.insert(schema.mediaEvents)
			.values({
				userId: input.userId,
				serviceId: input.serviceId,
				serviceType: input.serviceType,
				eventType: input.eventType,
				mediaId: input.mediaId,
				mediaType: input.mediaType,
				mediaTitle: input.mediaTitle ?? null,
				mediaYear: input.mediaYear ?? null,
				mediaGenres: input.mediaGenres ? JSON.stringify(input.mediaGenres) : null,
				parentId: input.parentId ?? null,
				parentTitle: input.parentTitle ?? null,
				positionTicks: input.positionTicks ?? null,
				durationTicks: input.durationTicks ?? null,
				playDurationMs: input.playDurationMs ?? null,
				deviceName: input.deviceName ?? null,
				clientName: input.clientName ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? now,
				ingestedAt: now
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit media event:', e);
	}
}

/**
 * Batch insert media events (for backfills / sync).
 */
export function emitMediaEventsBatch(events: MediaEventInput[]): number {
	if (events.length === 0) return 0;
	try {
		const db = getDb();
		const now = Date.now();
		const rows = events.map((input) => ({
			userId: input.userId,
			serviceId: input.serviceId,
			serviceType: input.serviceType,
			eventType: input.eventType,
			mediaId: input.mediaId,
			mediaType: input.mediaType,
			mediaTitle: input.mediaTitle ?? null,
			mediaYear: input.mediaYear ?? null,
			mediaGenres: input.mediaGenres ? JSON.stringify(input.mediaGenres) : null,
			parentId: input.parentId ?? null,
			parentTitle: input.parentTitle ?? null,
			positionTicks: input.positionTicks ?? null,
			durationTicks: input.durationTicks ?? null,
			playDurationMs: input.playDurationMs ?? null,
			deviceName: input.deviceName ?? null,
			clientName: input.clientName ?? null,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			timestamp: input.timestamp ?? now,
			ingestedAt: now
		}));
		db.insert(schema.mediaEvents).values(rows).run();
		return rows.length;
	} catch (e) {
		console.error('[analytics] Batch insert failed:', e);
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Interaction event ingestion
// ---------------------------------------------------------------------------

export interface InteractionEventInput {
	userId?: string;
	sessionToken?: string;
	eventType: string;
	page?: string;
	target?: string;
	targetTitle?: string;
	referrer?: string;
	searchQuery?: string;
	position?: Record<string, unknown>;
	durationMs?: number;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

/**
 * Insert a single interaction event. Fire-and-forget.
 */
export function emitInteractionEvent(input: InteractionEventInput): void {
	try {
		const db = getDb();
		db.insert(schema.interactionEvents)
			.values({
				userId: input.userId ?? null,
				sessionToken: input.sessionToken ?? null,
				eventType: input.eventType,
				page: input.page ?? null,
				target: input.target ?? null,
				targetTitle: input.targetTitle ?? null,
				referrer: input.referrer ?? null,
				searchQuery: input.searchQuery ?? null,
				position: input.position ? JSON.stringify(input.position) : null,
				durationMs: input.durationMs ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? Date.now()
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit interaction event:', e);
	}
}

/**
 * Batch insert interaction events (from client-side collector flush).
 */
export function emitInteractionEventsBatch(events: InteractionEventInput[]): number {
	if (events.length === 0) return 0;
	try {
		const db = getDb();
		const rows = events.map((input) => ({
			userId: input.userId ?? null,
			sessionToken: input.sessionToken ?? null,
			eventType: input.eventType,
			page: input.page ?? null,
			target: input.target ?? null,
			targetTitle: input.targetTitle ?? null,
			referrer: input.referrer ?? null,
			searchQuery: input.searchQuery ?? null,
			position: input.position ? JSON.stringify(input.position) : null,
			durationMs: input.durationMs ?? null,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			timestamp: input.timestamp ?? Date.now()
		}));
		db.insert(schema.interactionEvents).values(rows).run();
		return rows.length;
	} catch (e) {
		console.error('[analytics] Interaction batch insert failed:', e);
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Query helpers — raw event reads for the stats engine + API
// ---------------------------------------------------------------------------

export interface EventQueryOpts {
	userId: string;
	mediaType?: string;
	eventType?: string;
	from?: number; // unix ms
	to?: number; // unix ms
	limit?: number;
	offset?: number;
}

/**
 * Query raw media events with filters. Returns newest-first.
 */
export function queryMediaEvents(opts: EventQueryOpts) {
	const db = getDb();
	const conditions: string[] = ['user_id = ?'];
	const params: (string | number)[] = [opts.userId];

	if (opts.mediaType) {
		conditions.push('media_type = ?');
		params.push(opts.mediaType);
	}
	if (opts.eventType) {
		conditions.push('event_type = ?');
		params.push(opts.eventType);
	}
	if (opts.from) {
		conditions.push('timestamp >= ?');
		params.push(opts.from);
	}
	if (opts.to) {
		conditions.push('timestamp <= ?');
		params.push(opts.to);
	}

	const where = conditions.join(' AND ');
	const limit = opts.limit ?? 1000;
	const offset = opts.offset ?? 0;

	const sqlQuery = `SELECT * FROM media_events WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
	params.push(limit, offset);

	return db.all(sqlQuery, ...params) as (typeof schema.mediaEvents.$inferSelect)[];
}

/**
 * Count media events matching filters.
 */
export function countMediaEvents(opts: Omit<EventQueryOpts, 'limit' | 'offset'>): number {
	const db = getDb();
	const conditions: string[] = ['user_id = ?'];
	const params: (string | number)[] = [opts.userId];

	if (opts.mediaType) {
		conditions.push('media_type = ?');
		params.push(opts.mediaType);
	}
	if (opts.eventType) {
		conditions.push('event_type = ?');
		params.push(opts.eventType);
	}
	if (opts.from) {
		conditions.push('timestamp >= ?');
		params.push(opts.from);
	}
	if (opts.to) {
		conditions.push('timestamp <= ?');
		params.push(opts.to);
	}

	const where = conditions.join(' AND ');
	const row = db.get(`SELECT COUNT(*) as count FROM media_events WHERE ${where}`, ...params) as { count: number };
	return row.count;
}
