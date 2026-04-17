/**
 * Player-component type contract additions.
 *
 * See docs/superpowers/specs/2026-04-17-player-alignment-plan.md §1 for
 * the full prop-contract rationale.
 */

/** An item to queue up after the current one ends (issue #19). */
export interface NextItem {
	/** sourceId (not UnifiedMedia.id — that's an internal derived key). */
	id: string;
	serviceId: string;
	title: string;
	/** e.g. "S02E03 · The Pilot" */
	subtitle?: string;
	poster?: string;
	/** seconds */
	duration?: number;
	/** 0..1; 0 if unwatched */
	progress?: number;
}

/** Intro / credits / recap marker for skip-button rendering (issue #19). */
export interface SkipMarker {
	kind: 'intro' | 'credits' | 'recap';
	startSec: number;
	endSec: number;
	/** Override label; e.g. "Skip Recap". Otherwise derived from kind. */
	label?: string;
}

/** SponsorBlock segment (issue #20). action narrowed to what we honor. */
export interface SponsorSegment {
	/** 'sponsor' | 'selfpromo' | 'interaction' | ... */
	category: string;
	/** 'skip' is the only action wired this cycle. Others pass through
	 *  but the player ignores them; settings UI only exposes 'skip'. */
	action: 'skip' | 'mute' | 'show';
	startSec: number;
	endSec: number;
	/** SponsorBlock segment UUID (optional, for voting later). */
	uuid?: string;
}

/** Mode for a subtitle change callback.
 *  - 'native'  — activate the browser <track>/HLS text track in-place
 *  - 'burn-in' — caller should renegotiate with `burnSubIndex`
 *  - 'off'     — turn everything off
 */
export type SubtitleMode = 'native' | 'burn-in' | 'off';
