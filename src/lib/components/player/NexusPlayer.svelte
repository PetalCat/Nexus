<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlaybackSession, PlaybackPlan } from '$lib/adapters/playback';
	import type { PlayerEngine, Level } from './PlayerEngine';
	import type { NextItem, SkipMarker, SponsorSegment, SubtitleMode } from './types';
	import { createPlayerState } from './PlayerState.svelte';
	import { createNetworkMonitor } from './networkMonitor';
	import { playerErrorMessage } from './errorCopy';
	import ModePill from './ModePill.svelte';
	import QualityMenu from './QualityMenu.svelte';
	import AudioMenu from './AudioMenu.svelte';
	import SubtitleMenu from './SubtitleMenu.svelte';

	interface Props {
		session: PlaybackSession;
		title?: string;
		subtitle?: string;
		poster?: string;
		progress?: number;
		duration?: number;
		autoplay?: boolean;
		serviceId?: string;
		itemId?: string;
		inline?: boolean;
		isAudio?: boolean;
		onclose?: () => void;
		onqualitychange?: (plan: PlaybackPlan) => Promise<PlaybackSession>;

		// Subtitle / audio selection (issue #14).
		onsubtitlechange?: (trackId: number, mode: SubtitleMode) => void;
		onaudiochange?: (trackId: number) => void;
		/** Initial track IDs; if present, used on session attach so UI
		 *  reflects what the user picked last time for this item. */
		initialSubtitleTrack?: number;
		initialAudioTrack?: number;

		// Post-play flow (issue #19). All optional; absence hides the UI.
		nextItem?: NextItem | null;
		onplaynext?: (next: NextItem) => void;
		oncomplete?: () => void;
		skipMarkers?: SkipMarker[];

		// Settings-derived behavior (issue #20).
		playbackRate?: number;
		autoplayNext?: boolean;
		sponsorSegments?: SponsorSegment[];
		onsponsorskip?: (seg: SponsorSegment) => void;
	}

	let {
		session,
		title = '',
		subtitle = '',
		poster,
		progress = 0,
		duration = 0,
		autoplay = false,
		serviceId = '',
		itemId = '',
		inline = false,
		isAudio = false,
		onclose,
		onqualitychange,
		onsubtitlechange,
		onaudiochange,
		initialSubtitleTrack,
		initialAudioTrack,
		nextItem,
		onplaynext,
		oncomplete,
		skipMarkers = [],
		playbackRate = 1,
		autoplayNext = false,
		sponsorSegments = [],
		onsponsorskip
	}: Props = $props();

	/* ── Refs ── */
	let videoEl: HTMLVideoElement | undefined = $state();
	let theaterEl: HTMLDivElement | undefined = $state();
	let scrubEl: HTMLDivElement | undefined = $state();
	let volSliderEl: HTMLDivElement | undefined = $state();

	/* ── State + Monitor ── */
	const ps = createPlayerState();
	const monitor = createNetworkMonitor(ps);

	/* ── Engine lifecycle ── */
	let engine: PlayerEngine | null = $state(null);
	let engineCleanups: (() => void)[] = [];
	let bwInterval: ReturnType<typeof setInterval> | undefined;
	let controlsTimeout: ReturnType<typeof setTimeout> | undefined;
	let hasStarted = $state(false);
	let isFullscreen = $state(false);

	/* ── Scrub / Volume drag ── */
	let isScrubbing = $state(false);
	let scrubPreview = $state(0);
	let scrubHover = $state(false);
	let scrubHoverFrac = $state(0);
	let isVolDragging = $state(false);

	/* ── Derived ── */
	const theaterActive = $derived(hasStarted && !inline && !isAudio);
	const progressPct = $derived(ps.duration > 0 ? (ps.currentTime / ps.duration) * 100 : 0);
	const bufferedPct = $derived(ps.duration > 0 ? (ps.buffered / ps.duration) * 100 : 0);
	const scrubPct = $derived(isScrubbing ? scrubPreview * 100 : progressPct);

	/* ── Subtitle <track> registry. Browsers don't key TextTrack.id from
	   our <track id> attribute, so maintain our own id → element map and
	   activate via the element's `.track.mode` property. ── */
	const subtitleTrackEls = new Map<number, HTMLTrackElement>();

	/* ── Post-play / skip overlays ── */
	let postPlayVisible = $state(false);
	let postPlayCountdown = $state(10);
	let postPlayCountdownTimer: ReturnType<typeof setInterval> | undefined;
	let activeSkipMarker = $state<SkipMarker | null>(null);

	/* ── SponsorBlock skip dedupe — fire onsponsorskip at most once per
	   segment per attach. Reset on session swap. ── */
	const sponsorSkipped = new Set<number>(); // index into sponsorSegments

	const POSTPLAY_WINDOW_SEC = 20;
	const POSTPLAY_COUNTDOWN_SEC = 10;

	/* ── Engine creation ── */
	async function createEngine(type: 'hls' | 'dash' | 'progressive'): Promise<PlayerEngine> {
		switch (type) {
			case 'hls': {
				const { createHlsEngine } = await import('./engines/hls-engine');
				return createHlsEngine();
			}
			case 'dash': {
				const { createDashEngine } = await import('./engines/dash-engine');
				return createDashEngine();
			}
			case 'progressive': {
				const { createProgressiveEngine } = await import('./engines/progressive-engine');
				return createProgressiveEngine();
			}
		}
	}

	async function attachEngine(sess: PlaybackSession, seekTo?: number) {
		if (!videoEl) return;
		detachEngine();

		const eng = await createEngine(sess.engine);
		engine = eng;
		ps.updateFromSession(sess);

		await eng.attach(videoEl, sess);

		// Inject <track> elements for any adapter-supplied subtitle URLs
		// (Invidious WebVTT captions, etc.). HLS in-band subtitles come
		// through the manifest and don't need this.
		subtitleTrackEls.clear();
		for (const t of sess.subtitleTracks) {
			if (!t.url) continue;
			const el = document.createElement('track');
			el.kind = 'subtitles';
			el.label = t.name;
			el.srclang = t.lang || 'en';
			el.src = t.url;
			el.id = String(t.id);
			el.default = initialSubtitleTrack !== undefined && t.id === initialSubtitleTrack;
			videoEl.appendChild(el);
			subtitleTrackEls.set(t.id, el);
		}

		// Apply playback rate on each attach — the native video element
		// resets rate across a new source.
		if (videoEl && playbackRate && playbackRate !== 1) {
			videoEl.playbackRate = playbackRate;
		}

		// Reset SponsorBlock skip dedupe for the new attach.
		sponsorSkipped.clear();

		// Wire callbacks
		const unsubs: (() => void)[] = [];
		unsubs.push(
			eng.onLevelSwitched((lvl: Level) => {
				ps.activeLevel = lvl;
				ps.levels = eng.levels;
				ps.updateQualityLabel(eng.levels, eng.activeLevelIndex);
			})
		);
		unsubs.push(
			eng.onStall((metric) => {
				monitor.recordStall(metric);
				if (monitor.shouldAdapt() && onqualitychange) {
					handleAdaptiveDowngrade();
				}
			})
		);
		unsubs.push(
			eng.onFatalError(() => {
				ps.error = playerErrorMessage('fatal');
			})
		);
		engineCleanups = unsubs;

		// Populate levels immediately if engine has them (HLS after MANIFEST_PARSED),
		// and poll briefly for DASH which populates async after attach.
		ps.levels = eng.levels;
		if (eng.levels.length === 0) {
			const levelPoll = setInterval(() => {
				if (eng.levels.length > 0) {
					ps.levels = eng.levels;
					ps.updateQualityLabel(eng.levels, eng.activeLevelIndex);
					clearInterval(levelPoll);
				}
			}, 500);
			setTimeout(() => clearInterval(levelPoll), 10_000);
		}

		// Bandwidth polling
		bwInterval = setInterval(() => {
			monitor.updateBandwidth(eng.bandwidthEstimate());
		}, 3000);

		// Seek to position
		if (seekTo != null && seekTo > 0) {
			videoEl.currentTime = seekTo;
		} else if (progress > 0) {
			const dur = ps.duration || duration;
			if (dur > 0) videoEl.currentTime = progress * dur;
		}

		videoEl.play().catch(() => {});
		ps.isLoading = false;
	}

	function detachEngine() {
		engineCleanups.forEach((fn) => fn());
		engineCleanups = [];
		if (bwInterval) { clearInterval(bwInterval); bwInterval = undefined; }
		if (engine) { engine.detach(); engine = null; }
		// Remove any <track> elements we previously injected so session swaps
		// don't accumulate stale captions.
		if (videoEl) {
			const existingTracks = videoEl.querySelectorAll('track');
			existingTracks.forEach((t) => t.remove());
		}
	}

	/* ── Session swap on prop change ── */
	let prevSessionUrl = '';
	$effect(() => {
		if (!videoEl || !hasStarted) return;
		const url = session.url;
		if (url && url !== prevSessionUrl) {
			prevSessionUrl = url;
			const savedTime = videoEl.currentTime;
			attachEngine(session, savedTime);
		}
	});

	/* ── Apply playbackRate whenever it or the video element changes. ── */
	$effect(() => {
		if (videoEl && playbackRate && isFinite(playbackRate) && playbackRate > 0) {
			videoEl.playbackRate = playbackRate;
		}
	});

	/* ── Quality change handler ── */
	async function handleQualitySelect(index: number) {
		if (!engine) return;
		ps.activePanel = 'none';

		if (index === -1) {
			// Auto
			engine.setLevel(-1);
			ps.autoQuality = true;
			ps.updateQualityLabel(engine.levels, -1);
			return;
		}

		ps.autoQuality = false;
		const level = engine.levels[index];
		if (!level) return;

		// If we have onqualitychange, request a new session for server-side quality change
		if (onqualitychange) {
			const savedTime = videoEl?.currentTime ?? 0;
			const plan: PlaybackPlan = {
				targetHeight: level.height,
				maxBitrate: level.bitrate,
				startPositionSeconds: savedTime
			};
			try {
				const newSession = await onqualitychange(plan);
				await attachEngine(newSession, savedTime);
			} catch {
				// Fall back to client-side level switch
				engine.setLevel(index);
			}
		} else {
			engine.setLevel(index);
		}
		ps.updateQualityLabel(engine?.levels ?? [], engine?.activeLevelIndex ?? -1);
	}

	/* Force a transcode at a specific height — used for preset quality options
	   that don't match any engine-reported level. Always re-negotiates. */
	async function handleQualityRequest(targetHeight: number) {
		if (!onqualitychange) return;
		ps.activePanel = 'none';
		ps.autoQuality = false;
		const savedTime = videoEl?.currentTime ?? 0;
		try {
			const newSession = await onqualitychange({
				targetHeight,
				startPositionSeconds: savedTime,
			});
			await attachEngine(newSession, savedTime);
		} catch (e) {
			console.warn('[Player] quality request failed:', e);
		}
	}

	/* ── Adaptive downgrade on stalls ── */
	async function handleAdaptiveDowngrade() {
		if (!onqualitychange || !engine || !videoEl) return;
		// Only auto-degrade when the user is in Auto mode. If they picked a
		// specific height, respect it — better to buffer than silently drop
		// them to a lower quality they didn't ask for.
		if (!ps.autoQuality) return;
		monitor.markAdapted();

		const currentHeight = ps.activeLevel?.height ?? 1080;
		const targetHeight = currentHeight > 720 ? 720 : currentHeight > 480 ? 480 : 360;
		const savedTime = videoEl.currentTime;

		try {
			const newSession = await onqualitychange({
				targetHeight,
				startPositionSeconds: savedTime
			});
			await attachEngine(newSession, savedTime);
		} catch {
			// Ignore — keep playing at current quality
		}
	}

	/* ── Audio / Subtitle selection ──
	   Raise dedicated events; the caller decides whether to renegotiate.
	   (Previously audio shoehorned through onqualitychange and Jellyfin
	   dropped the hint; subtitle selection compared videoEl.textTracks[i].id
	   against our String(id) which the browser never keys from <track id>.
	   Both fixed here and in the caller + adapter.) */
	function handleAudioSelect(id: number) {
		ps.currentAudioTrack = id;
		ps.activePanel = 'none';
		onaudiochange?.(id);
	}

	function activateNativeSubtitle(id: number) {
		if (!videoEl) return;
		// First try our own <track id → element> map (populated for adapter-
		// supplied URLs). Browsers don't expose the <track id> attribute back
		// through TextTrack.id, so we must not compare those.
		const el = subtitleTrackEls.get(id);
		if (el) {
			for (const other of subtitleTrackEls.values()) {
				if (other.track) other.track.mode = 'hidden';
			}
			if (el.track) el.track.mode = 'showing';
			// Also turn off any HLS/manifest-supplied tracks we don't own.
			for (let i = 0; i < videoEl.textTracks.length; i++) {
				const tt = videoEl.textTracks[i];
				if (!Array.from(subtitleTrackEls.values()).some((e) => e.track === tt)) {
					tt.mode = 'hidden';
				}
			}
			return;
		}
		// Fallback for HLS in-manifest tracks (no <track> element): match on
		// language + label against the session's declared tracks.
		const declared = session.subtitleTracks.find((t) => t.id === id);
		if (!declared) return;
		for (let i = 0; i < videoEl.textTracks.length; i++) {
			const tt = videoEl.textTracks[i];
			const matches =
				(declared.lang && tt.language === declared.lang) ||
				(declared.name && tt.label === declared.name);
			tt.mode = matches ? 'showing' : 'hidden';
		}
	}

	function handleSubtitleSelect(id: number) {
		ps.currentSubtitleTrack = id;
		ps.isBurnIn = false;
		ps.activePanel = 'none';
		if (id === -1) {
			// Off — deactivate everything and notify caller.
			if (videoEl) {
				for (let i = 0; i < videoEl.textTracks.length; i++) {
					videoEl.textTracks[i].mode = 'hidden';
				}
			}
			onsubtitlechange?.(id, 'off');
			return;
		}
		activateNativeSubtitle(id);
		onsubtitlechange?.(id, 'native');
	}

	function handleBurnInSelect(id: number) {
		ps.currentSubtitleTrack = id;
		ps.isBurnIn = true;
		ps.activePanel = 'none';
		// Burn-in still requires a transcode; caller decides via
		// onsubtitlechange(id, 'burn-in') whether to renegotiate.
		if (onsubtitlechange) {
			onsubtitlechange(id, 'burn-in');
		} else if (onqualitychange && videoEl) {
			// Legacy fallback for callers that haven't wired onsubtitlechange yet.
			const savedTime = videoEl.currentTime;
			onqualitychange({ burnSubIndex: id, startPositionSeconds: savedTime })
				.then((newSession) => attachEngine(newSession, savedTime))
				.catch(() => {});
		}
	}

	/* ── Skip marker / post-play lifecycle ── */
	function updateSkipAndPostPlay(currentTime: number) {
		// Active skip marker
		if (skipMarkers.length > 0) {
			const marker = skipMarkers.find(
				(m) => currentTime >= m.startSec && currentTime < m.endSec
			);
			activeSkipMarker = marker ?? null;
		}

		// SponsorBlock auto-skip (action === 'skip' only)
		for (let i = 0; i < sponsorSegments.length; i++) {
			const seg = sponsorSegments[i];
			if (seg.action !== 'skip') continue;
			if (sponsorSkipped.has(i)) continue;
			if (currentTime >= seg.startSec && currentTime < seg.endSec) {
				sponsorSkipped.add(i);
				if (videoEl) videoEl.currentTime = seg.endSec;
				onsponsorskip?.(seg);
				return; // Only fire one per tick
			}
		}

		// Near-end post-play card
		if (
			nextItem != null &&
			ps.duration > 0 &&
			currentTime >= ps.duration - POSTPLAY_WINDOW_SEC
		) {
			if (!postPlayVisible) {
				postPlayVisible = true;
				postPlayCountdown = POSTPLAY_COUNTDOWN_SEC;
			}
		}
	}

	function onClickSkipMarker(marker: SkipMarker) {
		if (videoEl) videoEl.currentTime = marker.endSec;
	}

	function dismissPostPlay() {
		postPlayVisible = false;
		if (postPlayCountdownTimer) {
			clearInterval(postPlayCountdownTimer);
			postPlayCountdownTimer = undefined;
		}
	}

	function onEnded() {
		ps.playing = false;
		ps.showControls = true;
		if (nextItem && autoplayNext && onplaynext) {
			// Countdown-then-play behavior runs via PostPlayCard so user can
			// cancel. Show it and start the timer if not already running.
			if (!postPlayVisible) {
				postPlayVisible = true;
				postPlayCountdown = POSTPLAY_COUNTDOWN_SEC;
			}
			if (!postPlayCountdownTimer) {
				postPlayCountdownTimer = setInterval(() => {
					postPlayCountdown -= 1;
					if (postPlayCountdown <= 0) {
						clearInterval(postPlayCountdownTimer!);
						postPlayCountdownTimer = undefined;
						if (nextItem) {
							postPlayVisible = false;
							onplaynext?.(nextItem);
						}
					}
				}, 1000);
			}
		} else if (nextItem) {
			// No autoplay — show the card, but no countdown.
			postPlayVisible = true;
			postPlayCountdown = 0;
		} else {
			// No next item — just fire oncomplete so the caller can render
			// its own completion CTA in the page (#19).
			oncomplete?.();
		}
	}

	/* ── Formatting ── */
	function fmt(secs: number): string {
		if (!secs || !isFinite(secs)) return '0:00';
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		const s = Math.floor(secs % 60);
		return h > 0
			? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
			: m + ':' + String(s).padStart(2, '0');
	}

	/* ── Controls ── */
	function togglePlay() {
		if (!videoEl) return;
		if (!hasStarted) {
			hasStarted = true;
			ps.isLoading = true;
			prevSessionUrl = session.url;
			attachEngine(session);
			return;
		}
		videoEl.paused ? videoEl.play().catch(() => {}) : videoEl.pause();
	}

	function skipBy(secs: number) {
		if (videoEl) videoEl.currentTime = Math.max(0, Math.min(videoEl.currentTime + secs, ps.duration));
	}

	function setVol(v: number) {
		ps.volume = Math.max(0, Math.min(1, v));
		if (videoEl) { videoEl.volume = ps.volume; videoEl.muted = false; ps.muted = false; }
	}

	function toggleMute() {
		if (!videoEl) return;
		ps.muted = !ps.muted;
		videoEl.muted = ps.muted;
	}

	function seekTo(frac: number) {
		if (videoEl) videoEl.currentTime = frac * ps.duration;
	}

	function togglePanel(p: 'quality' | 'audio' | 'subtitles') {
		ps.activePanel = ps.activePanel === p ? 'none' : p;
	}

	/* ── Scrub bar ── */
	function scrubFrac(e: MouseEvent | TouchEvent): number {
		if (!scrubEl) return 0;
		const rect = scrubEl.getBoundingClientRect();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	}

	function onScrubDown(e: MouseEvent | TouchEvent) {
		isScrubbing = true;
		scrubPreview = scrubFrac(e);
		const move = (ev: MouseEvent | TouchEvent) => { scrubPreview = scrubFrac(ev); };
		const up = () => {
			seekTo(scrubPreview);
			isScrubbing = false;
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
			window.removeEventListener('touchmove', move);
			window.removeEventListener('touchend', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
		window.addEventListener('touchmove', move, { passive: true });
		window.addEventListener('touchend', up);
	}

	function onScrubHover(e: MouseEvent) {
		scrubHover = true;
		scrubHoverFrac = scrubFrac(e);
	}

	/* ── Volume slider ── */
	function onVolDown(e: MouseEvent) {
		isVolDragging = true;
		setVolFromEvent(e);
		const move = (ev: MouseEvent) => setVolFromEvent(ev);
		const up = () => {
			isVolDragging = false;
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	}

	function setVolFromEvent(e: MouseEvent) {
		if (!volSliderEl) return;
		const rect = volSliderEl.getBoundingClientRect();
		setVol((e.clientX - rect.left) / rect.width);
	}

	/* ── Controls visibility ── */
	function resetControlsTimer() {
		ps.showControls = true;
		if (controlsTimeout) clearTimeout(controlsTimeout);
		if (ps.playing) {
			controlsTimeout = setTimeout(() => { ps.showControls = false; ps.activePanel = 'none'; }, 3500);
		}
	}

	/* ── Theater / Close ── */
	function closeTheater() {
		if (videoEl) videoEl.pause();
		detachEngine();
		hasStarted = false;
		ps.playing = false;
		document.body.style.overflow = '';
		session.close?.();
		onclose?.();
	}

	function toggleFullscreen() {
		if (!theaterEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			theaterEl.requestFullscreen?.();
		}
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	/* ── Keyboard ── */
	function handleKeydown(e: KeyboardEvent) {
		if (!hasStarted) return;
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		switch (e.key) {
			case ' ': case 'k': e.preventDefault(); togglePlay(); break;
			case 'ArrowLeft': case 'j': e.preventDefault(); skipBy(-10); break;
			case 'ArrowRight': case 'l': e.preventDefault(); skipBy(10); break;
			case 'ArrowUp': e.preventDefault(); setVol(ps.volume + 0.1); break;
			case 'ArrowDown': e.preventDefault(); setVol(ps.volume - 0.1); break;
			case 'f': if (!isAudio) { e.preventDefault(); toggleFullscreen(); } break;
			case 'm': e.preventDefault(); toggleMute(); break;
			case 'c': e.preventDefault(); togglePanel('subtitles'); break;
			case 'Escape':
				e.preventDefault();
				if (ps.activePanel !== 'none') ps.activePanel = 'none';
				else if (isFullscreen) document.exitFullscreen();
				else closeTheater();
				break;
		}
		resetControlsTimer();
	}

	/* ── Media event bindings ── */
	function bindVideoEvents(el: HTMLVideoElement) {
		el.addEventListener('play', () => { ps.playing = true; resetControlsTimer(); });
		el.addEventListener('pause', () => { ps.playing = false; ps.showControls = true; });
		el.addEventListener('timeupdate', () => {
			if (!isScrubbing) ps.currentTime = el.currentTime;
			updateSkipAndPostPlay(el.currentTime);
		});
		el.addEventListener('durationchange', () => {
			if (el.duration && isFinite(el.duration)) ps.duration = el.duration;
		});
		el.addEventListener('progress', () => {
			if (el.buffered.length > 0) ps.buffered = el.buffered.end(el.buffered.length - 1);
		});
		el.addEventListener('waiting', () => { ps.isLoading = true; });
		el.addEventListener('canplay', () => { ps.isLoading = false; });
		el.addEventListener('ended', onEnded);
	}

	/* ── Portal for theater mode ── */
	let portalParent: Node | null = null;
	let portalSibling: Node | null = null;

	$effect(() => {
		if (!theaterEl) return;
		if (inline || isAudio) return;
		if (hasStarted) {
			portalParent = theaterEl.parentNode;
			portalSibling = theaterEl.nextSibling;
			document.body.appendChild(theaterEl);
			document.body.style.overflow = 'hidden';
		} else {
			if (portalParent) {
				if (portalSibling && portalSibling.parentNode === portalParent) {
					portalParent.insertBefore(theaterEl, portalSibling);
				} else {
					(portalParent as Element).appendChild(theaterEl);
				}
				portalParent = null;
				portalSibling = null;
			}
			document.body.style.overflow = '';
		}
	});

	/* ── Lifecycle ── */
	onMount(() => {
		if (duration) ps.duration = duration;
		if (videoEl) bindVideoEvents(videoEl);
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		if (autoplay) { hasStarted = true; ps.isLoading = true; prevSessionUrl = session.url; attachEngine(session); }

		return () => {
			detachEngine();
			if (controlsTimeout) clearTimeout(controlsTimeout);
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			if (theaterEl && theaterEl.parentNode === document.body && portalParent) {
				if (portalSibling && portalSibling.parentNode === portalParent) {
					portalParent.insertBefore(theaterEl, portalSibling);
				} else {
					(portalParent as Element).appendChild(theaterEl);
				}
			}
			document.body.style.overflow = '';
			session.close?.();
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div
	bind:this={theaterEl}
	class="theater"
	class:theater--active={theaterActive}
	class:theater--inline={inline}
	class:theater--audio={isAudio}
	class:cursor-none={!ps.showControls && ps.playing && !isAudio}
	onmousemove={resetControlsTimer}
	onclick={(e) => { if ((e.target as HTMLElement).closest('.ctrl-panel-wrap, .ctrl-bar')) return; }}
	role="application"
	aria-label="Video player"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoEl}
		class="theater__video"
		class:hidden={isAudio}
		playsinline
		preload="none"
		{poster}
	></video>

	{#if isAudio && poster}
		<div class="audio-art">
			<img src={poster} alt="" class="audio-art__img" />
			<div class="audio-art__dim"></div>
		</div>
	{/if}

	{#if !hasStarted}
		{#if !inline && !isAudio}
			<button class="preplay__back" onclick={closeTheater} aria-label="Go back">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
			</button>
		{/if}
		<button class="preplay" onclick={togglePlay} aria-label="Play {title}">
			{#if poster}
				<img src={poster} alt="" class="preplay__bg" />
			{/if}
			<div class="preplay__dim"></div>
			<div class="preplay__center">
				<div class="preplay__btn">
					<svg width="38" height="38" viewBox="0 0 24 24" fill="white"><path d="M8 5.14v14l11-7-11-7z" /></svg>
				</div>
				{#if title}<p class="preplay__title">{title}</p>{/if}
				{#if subtitle}<p class="preplay__sub">{subtitle}</p>{/if}
				{#if progress != null && progress > 0 && progress < 1}
					<div class="preplay__resume">
						<div class="preplay__resume-track"><div class="preplay__resume-fill" style="width:{progress * 100}%"></div></div>
						<span>Resume from {Math.round(progress * 100)}%</span>
					</div>
				{/if}
			</div>
		</button>
	{/if}

	{#if ps.isLoading && hasStarted}
		<div class="overlay"><div class="spinner"></div></div>
	{/if}

	{#if ps.error}
		<div class="overlay overlay--solid">
			<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-warm)" stroke-width="1.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" stroke-linecap="round" /></svg>
			<p class="overlay__msg">{ps.error}</p>
			<button class="overlay__btn" onclick={closeTheater}>Close</button>
		</div>
	{/if}

	{#if hasStarted && !ps.error}
		<button class="click-area" onclick={togglePlay} ondblclick={isAudio ? undefined : toggleFullscreen} aria-label={ps.playing ? 'Pause' : 'Play'}></button>
	{/if}

	{#if hasStarted && !ps.error}
		<div class="ctrl" class:ctrl--hidden={!ps.showControls}>
			<!-- Top bar -->
			<div class="ctrl__top" class:ctrl__top--audio={isAudio}>
				{#if !isAudio && (!inline || isFullscreen)}
					<button class="cb ctrl__back" onclick={() => { if (inline && isFullscreen) document.exitFullscreen(); else closeTheater(); }} aria-label="Go back">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
					</button>
				{/if}
				<div class="ctrl__meta">
					{#if title}<span class="ctrl__title">{title}</span>{/if}
					{#if subtitle}<span class="ctrl__sub">{subtitle}</span>{/if}
				</div>
				<ModePill mode={session.mode} isBurnIn={ps.isBurnIn} />
				<span class="qual-pill">{ps.qualityLabel}</span>
				{#if ps.measuredBandwidth > 0}
					<span class="bw-pill" title="Measured network throughput">
						{(ps.measuredBandwidth / 1_000_000).toFixed(1)} Mbps
					</span>
				{/if}
			</div>

			<div class="ctrl__bot">
				<!-- Scrub bar -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					bind:this={scrubEl}
					class="scrub"
					class:scrub--active={isScrubbing}
					onmousedown={onScrubDown}
					ontouchstart={onScrubDown}
					onmousemove={onScrubHover}
					onmouseleave={() => (scrubHover = false)}
					role="slider"
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={ps.duration}
					aria-valuenow={ps.currentTime}
					tabindex={0}
				>
					<div class="scrub__rail">
						<div class="scrub__buf" style="width:{bufferedPct}%"></div>
						<div class="scrub__fill" style="width:{scrubPct}%"></div>
					</div>
					<div class="scrub__thumb" style="left:{scrubPct}%"></div>
					{#if scrubHover && !isScrubbing}
						<div class="scrub__tip" style="left:{scrubHoverFrac * 100}%">{fmt(scrubHoverFrac * ps.duration)}</div>
					{/if}
					{#if isScrubbing}
						<div class="scrub__tip scrub__tip--active" style="left:{scrubPreview * 100}%">{fmt(scrubPreview * ps.duration)}</div>
					{/if}
				</div>

				<div class="ctrl-bar">
					<!-- Skip back -->
					<button class="cb cb--sm" onclick={() => skipBy(-10)} aria-label="Back 10s">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5V3m0 0L9 6m3-3 3 3"/><path d="M12 5a7 7 0 1 0 7 7" /><text x="12" y="16" font-size="6.5" fill="white" stroke="none" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>
					</button>

					<!-- Play / Pause -->
					<button class="cb cb--play" onclick={togglePlay} aria-label={ps.playing ? 'Pause' : 'Play'}>
						{#if ps.playing}
							<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" rx="1.5" /><rect x="14" y="4" width="4" height="16" rx="1.5" /></svg>
						{:else}
							<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M7 4.5v15l12-7.5-12-7.5z" /></svg>
						{/if}
					</button>

					<!-- Skip forward -->
					<button class="cb cb--sm" onclick={() => skipBy(10)} aria-label="Forward 10s">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5V3m0 0 3 3m-3-3L9 6"/><path d="M12 5a7 7 0 1 1-7 7" /><text x="12" y="16" font-size="6.5" fill="white" stroke="none" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>
					</button>

					<!-- Volume -->
					<div class="vol-wrap">
						<button class="cb cb--sm" onclick={toggleMute} aria-label={ps.muted ? 'Unmute' : 'Mute'}>
							{#if ps.muted || ps.volume === 0}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>
							{:else if ps.volume < 0.5}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
							{/if}
						</button>
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="vol-slider" bind:this={volSliderEl} onmousedown={onVolDown} role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={1} aria-valuenow={ps.volume} tabindex={0}>
							<div class="vol-slider__track"></div>
							<div class="vol-slider__fill" style="width:{(ps.muted ? 0 : ps.volume) * 100}%"></div>
							<div class="vol-slider__thumb" style="left:{(ps.muted ? 0 : ps.volume) * 100}%"></div>
						</div>
					</div>

					<!-- Time -->
					<span class="time-label">{fmt(ps.currentTime)} <span class="time-sep">/</span> {fmt(ps.duration)}</span>

					<!-- Spacer -->
					<div class="ctrl-bar__gap"></div>

					<!-- Subtitles -->
					{#if ps.subtitleTracks.length > 0 || ps.burnableSubtitleTracks.length > 0}
						<div class="ctrl-panel-wrap">
							<button class="cb cb--sm" class:cb--lit={ps.currentSubtitleTrack !== -1} onclick={() => togglePanel('subtitles')} aria-label="Subtitles">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2" /><path d="M7 12h4M13 12h4M7 16h10" /></svg>
							</button>
							{#if ps.activePanel === 'subtitles'}
								<SubtitleMenu
									tracks={ps.subtitleTracks}
									burnableTracks={ps.burnableSubtitleTracks}
									currentTrack={ps.currentSubtitleTrack}
									isBurnIn={ps.isBurnIn}
									onselect={handleSubtitleSelect}
									onburnin={handleBurnInSelect}
								/>
							{/if}
						</div>
					{/if}

					<!-- Audio -->
					{#if ps.audioTracks.length > 1}
						<div class="ctrl-panel-wrap">
							<button class="cb cb--sm" onclick={() => togglePanel('audio')} aria-label="Audio">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" fill="currentColor" /><circle cx="18" cy="16" r="3" fill="currentColor" /></svg>
							</button>
							{#if ps.activePanel === 'audio'}
								<AudioMenu
									tracks={ps.audioTracks}
									currentTrack={ps.currentAudioTrack}
									onselect={handleAudioSelect}
								/>
							{/if}
						</div>
					{/if}

					<!-- Quality: always show when negotiation is available, even
					     with no engine-reported levels (user can force a transcode
					     preset via onrequest). -->
					{#if ps.levels.length > 0 || onqualitychange}
						<div class="ctrl-panel-wrap">
							<button class="cb cb--sm" onclick={() => togglePanel('quality')} aria-label="Quality">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
							</button>
							{#if ps.activePanel === 'quality'}
								<QualityMenu
									levels={ps.levels}
									activeLevel={ps.activeLevel}
									autoQuality={ps.autoQuality}
									qualityLabel={ps.qualityLabel}
									sourceHeight={ps.sourceHeight}
									onselect={handleQualitySelect}
									onrequest={onqualitychange ? handleQualityRequest : undefined}
								/>
							{/if}
						</div>
					{/if}

					<!-- Fullscreen -->
					{#if !isAudio}
						<button class="cb cb--sm" onclick={toggleFullscreen} aria-label="Fullscreen">
							{#if isFullscreen}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Post-play / skip overlays rendered in commit 3 (issue #19). -->
</div>

<style>
	.theater {
		position: relative; overflow: hidden;
		border-radius: 0.75rem; background: #000;
		aspect-ratio: 16/9; max-height: 80vh;
	}
	.theater--active {
		position: fixed; inset: 0; z-index: 99999;
		border-radius: 0; aspect-ratio: unset; max-height: unset;
	}
	.theater--inline { max-height: unset; }
	.theater--inline.theater--active {
		position: fixed; inset: 0; z-index: 99999; border-radius: 0;
	}
	.theater--audio {
		aspect-ratio: unset; max-height: unset;
	}
	.theater__video { width: 100%; height: 100%; object-fit: contain; }
	.theater__video.hidden { display: none; }

	.audio-art {
		position: relative; width: 100%; aspect-ratio: 1;
		overflow: hidden; border-radius: 0.75rem 0.75rem 0 0;
	}
	.audio-art__img {
		width: 100%; height: 100%; object-fit: cover;
	}
	.audio-art__dim {
		position: absolute; inset: 0;
		background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 40%);
	}

	.preplay__back {
		position: absolute; top: 1rem; left: 1rem; z-index: 10;
		width: 2.75rem; height: 2.75rem; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0,0,0,0.45); backdrop-filter: blur(12px);
		border: 1px solid rgba(255,255,255,0.1);
		color: white; cursor: pointer;
		transition: background 0.15s, transform 0.15s;
	}
	.preplay__back:hover { background: rgba(255,255,255,0.15); transform: scale(1.08); }

	.preplay {
		position: absolute; inset: 0; display: flex;
		align-items: center; justify-content: center;
		cursor: pointer; border: none; background: #000;
	}
	.preplay__bg {
		position: absolute; inset: 0; width: 100%; height: 100%;
		object-fit: cover; opacity: 0.5;
		transition: opacity 0.5s, transform 0.5s;
	}
	.preplay:hover .preplay__bg { opacity: 0.62; transform: scale(1.02); }
	.preplay__dim {
		position: absolute; inset: 0;
		background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.35) 100%);
	}
	.preplay__center {
		position: relative; z-index: 2;
		display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
	}
	.preplay__btn {
		width: 5rem; height: 5rem;
		display: flex; align-items: center; justify-content: center;
		border-radius: 50%;
		background: rgba(124,108,248,0.2); backdrop-filter: blur(20px);
		border: 1px solid rgba(124,108,248,0.25);
		transition: transform 0.35s cubic-bezier(0.16,1,0.3,1), background 0.3s;
		animation: glowPulse 2.8s ease-in-out infinite;
	}
	.preplay:hover .preplay__btn { transform: scale(1.12); background: rgba(124,108,248,0.3); }
	.preplay__title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; color: white; text-shadow: 0 2px 12px rgba(0,0,0,0.7); }
	.preplay__sub { font-size: 0.85rem; color: rgba(255,255,255,0.55); }
	.preplay__resume {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0.75rem; border-radius: 100px;
		background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
		font-size: 0.7rem; font-weight: 500; color: rgba(255,255,255,0.65);
	}
	.preplay__resume-track { width: 4rem; height: 3px; border-radius: 99px; background: rgba(255,255,255,0.15); overflow: hidden; }
	.preplay__resume-fill { height: 100%; background: var(--color-accent); border-radius: 99px; }

	.overlay {
		position: absolute; inset: 0; z-index: 20;
		display: flex; flex-direction: column; align-items: center; justify-content: center;
	}
	.overlay--solid { background: rgba(0,0,0,0.8); }
	.overlay__msg { margin-top: 0.75rem; max-width: 22rem; text-align: center; font-size: 0.85rem; color: rgba(255,255,255,0.65); line-height: 1.5; }
	.overlay__btn {
		margin-top: 1rem; padding: 0.5rem 1.25rem; border-radius: 8px;
		background: rgba(255,255,255,0.1); border: none; color: white;
		font-size: 0.82rem; cursor: pointer; transition: background 0.15s;
	}
	.overlay__btn:hover { background: rgba(255,255,255,0.18); }

	.spinner {
		width: 2.25rem; height: 2.25rem; border-radius: 50%;
		border: 2.5px solid rgba(255,255,255,0.1); border-top-color: white;
		animation: spin 0.75s linear infinite;
	}
	.click-area {
		position: absolute; inset: 0; z-index: 5;
		cursor: pointer; border: none; background: transparent;
	}

	.ctrl {
		position: absolute; inset: 0; z-index: 30;
		display: flex; flex-direction: column; justify-content: space-between;
		pointer-events: none; transition: opacity 0.4s ease;
	}
	.ctrl--hidden { opacity: 0; pointer-events: none; }
	.ctrl__top, .ctrl__bot { pointer-events: auto; }

	.ctrl__top {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%);
	}
	.ctrl__top--audio { background: transparent; padding: 0.5rem 0.75rem; }
	.ctrl__back { flex-shrink: 0; }
	.ctrl__meta {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column; gap: 0.1rem;
	}
	.ctrl__title {
		font-size: 0.95rem; font-weight: 600; color: white;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		letter-spacing: 0.01em;
	}
	.ctrl__sub {
		font-size: 0.72rem; color: rgba(255,255,255,0.5);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	.ctrl__bot {
		display: flex; flex-direction: column; gap: 0.25rem;
		padding: 3rem 1.35rem 1.25rem;
		background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.38) 55%, transparent 100%);
	}
	.qual-pill {
		flex-shrink: 0;
		padding: 0.15rem 0.5rem; border-radius: 4px;
		background: rgba(124,108,248,0.15); border: 1px solid rgba(124,108,248,0.25);
		font-family: var(--font-mono); font-size: 0.62rem; font-weight: 600;
		color: rgba(124,108,248,0.9); letter-spacing: 0.03em;
	}

	.bw-pill {
		flex-shrink: 0;
		padding: 0.15rem 0.5rem; border-radius: 4px;
		background: rgba(110, 231, 183, 0.12); border: 1px solid rgba(110, 231, 183, 0.2);
		font-family: var(--font-mono); font-size: 0.62rem; font-weight: 600;
		color: rgba(110, 231, 183, 0.9); letter-spacing: 0.03em;
	}

	.cb {
		display: flex; align-items: center; justify-content: center;
		width: 2.4rem; height: 2.4rem; border-radius: 50%;
		color: rgba(255,255,255,0.85); border: none; background: transparent;
		cursor: pointer; transition: background 0.15s, color 0.15s;
		flex-shrink: 0;
	}
	.cb:hover { background: rgba(255,255,255,0.12); color: white; }
	.cb--sm { width: 2.1rem; height: 2.1rem; }
	.cb--play { width: 2.75rem; height: 2.75rem; }
	.cb--lit { color: var(--color-accent); }

	.ctrl-bar {
		display: flex; align-items: center; gap: 0.15rem;
		padding: 0 0.1rem;
	}
	.ctrl-bar__gap { flex: 1; }

	.time-label {
		font-family: var(--font-mono); font-size: 0.7rem;
		color: rgba(255,255,255,0.6); white-space: nowrap; margin-left: 0.35rem;
	}
	.time-sep { opacity: 0.35; }

	.scrub { position: relative; cursor: pointer; padding: 0.75rem 0; touch-action: none; }
	.scrub__rail {
		position: relative; height: 3px; border-radius: 99px;
		background: rgba(255,255,255,0.18); overflow: visible;
		transition: height 0.2s cubic-bezier(0.16,1,0.3,1);
	}
	.scrub:hover .scrub__rail, .scrub--active .scrub__rail { height: 5px; }
	.scrub__buf {
		position: absolute; inset: 0; border-radius: 99px;
		background: rgba(255,255,255,0.15);
	}
	.scrub__fill {
		position: absolute; top: 0; left: 0; bottom: 0; border-radius: 99px;
		background: white; transition: width 0.05s linear;
	}
	.scrub--active .scrub__fill { transition: none; }
	.scrub__thumb {
		position: absolute; top: 50%; width: 13px; height: 13px;
		border-radius: 50%; background: white;
		box-shadow: 0 1px 6px rgba(0,0,0,0.5);
		transform: translate(-50%, -50%);
		opacity: 0; transition: opacity 0.15s;
	}
	.scrub:hover .scrub__thumb, .scrub--active .scrub__thumb { opacity: 1; }
	.scrub__tip {
		position: absolute; bottom: calc(100% + 0.5rem);
		transform: translateX(-50%); pointer-events: none;
		background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.08);
		color: white; font-family: var(--font-mono); font-size: 0.68rem;
		padding: 0.2rem 0.5rem; border-radius: 5px; white-space: nowrap;
	}
	.scrub__tip--active { background: var(--color-accent); border-color: transparent; font-weight: 600; }

	.vol-wrap { display: flex; align-items: center; gap: 0.1rem; }
	.vol-slider {
		width: 5rem; height: 18px;
		cursor: pointer; position: relative;
		display: flex; align-items: center;
		opacity: 0; transition: opacity 0.2s, width 0.25s cubic-bezier(0.16,1,0.3,1);
		overflow: visible; touch-action: none;
	}
	.vol-wrap:hover .vol-slider, .vol-slider:focus-visible { opacity: 1; }
	.vol-slider__track {
		position: absolute; left: 0; right: 0; height: 3px;
		border-radius: 99px; background: rgba(255,255,255,0.2);
	}
	.vol-slider__fill {
		position: absolute; left: 0; height: 3px;
		border-radius: 99px; background: white;
	}
	.vol-slider__thumb {
		position: absolute; top: 50%; width: 11px; height: 11px;
		border-radius: 50%; background: white;
		box-shadow: 0 1px 4px rgba(0,0,0,0.4);
		transform: translate(-50%, -50%);
		opacity: 0; transition: opacity 0.15s;
	}
	.vol-wrap:hover .vol-slider__thumb { opacity: 1; }

	.ctrl-panel-wrap { position: relative; }

	@keyframes spin { to { transform: rotate(360deg); } }
	@keyframes glowPulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(124, 108, 248, 0.35); }
		50%      { box-shadow: 0 0 0 14px rgba(124, 108, 248, 0); }
	}
	@keyframes panelIn {
		from { opacity: 0; transform: translateY(6px) scale(0.97); }
		to   { opacity: 1; transform: translateY(0) scale(1); }
	}
</style>
