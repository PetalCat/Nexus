<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { MediaType } from '$lib/adapters/types';

	interface Props {
		streamUrl: string;
		type: MediaType;
		title?: string;
		subtitle?: string;
		poster?: string;
		progress?: number;
		duration?: number;
		autoplay?: boolean;
		serviceId?: string;
		itemId?: string;
		onclose?: () => void;
	}

	let {
		streamUrl,
		type,
		title = '',
		subtitle = '',
		poster,
		progress = 0,
		duration = 0,
		autoplay = false,
		serviceId = '',
		itemId = '',
		onclose
	}: Props = $props();

	/* ── Refs ── */
	let videoEl: HTMLVideoElement | undefined = $state();
	let audioEl: HTMLAudioElement | undefined = $state();
	let theaterEl: HTMLDivElement | undefined = $state();
	let scrubEl: HTMLDivElement | undefined = $state();
	let volSliderEl: HTMLDivElement | undefined = $state();
	let hls: any = $state(null);

	/* ── Playback State ── */
	let playing = $state(false);
	let currentTime = $state(0);
	let totalDuration = $state(0);
	let buffered = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let showControls = $state(true);
	let hasStarted = $state(false);
	let isLoading = $state(true);
	let errorMsg = $state('');
	let controlsTimeout: ReturnType<typeof setTimeout> | undefined;
	let progressInterval: ReturnType<typeof setInterval> | undefined;

	/* ── Jellyfin session tracking ── */
	let sessionStarted = false;
	let lastReportedTicks = 0;

	/* ── Scrub dragging ── */
	let isScrubbing = $state(false);
	let scrubPreview = $state(0);

	/* ── Volume dragging ── */
	let isVolDragging = $state(false);

	/* ── HLS Tracks ── */
	let qualityLevels: { index: number; height: number; bitrate: number }[] = $state([]);
	let currentQuality = $state(-1);
	let audioTracks: { id: number; name: string; lang: string }[] = $state([]);
	let currentAudioTrack = $state(0);
	let subtitleTracks: { id: number; name: string; lang: string; source?: 'hls' | 'external'; vttUrl?: string }[] = $state([]);
	let currentSubtitleTrack = $state(-1);

	/* ── Settings / Panels ── */
	type Panel = 'none' | 'quality' | 'audio' | 'subtitles' | 'speed';
	let activePanel: Panel = $state('none');
	let playbackRate = $state(1);
	const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

	/* ── PiP ── */
	let pipActive = $state(false);

	/* ── Scrub hover tooltip ── */
	let scrubHover = $state(false);
	let scrubHoverFrac = $state(0);

	/* ── Derived ── */
	const isAudio = $derived(type === 'music' || type === 'album');
	const isVideo = $derived(!isAudio);
	const theaterActive = $derived(isVideo && hasStarted);
	const hlsUrl = $derived(streamUrl + '/master.m3u8');
	const directUrl = $derived(streamUrl + '/stream');
	const audioUrl = $derived(streamUrl.replace(/\/([^/]+)$/, '/audio/$1') + '/universal');

	const progressPct = $derived(totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0);
	const bufferedPct = $derived(totalDuration > 0 ? (buffered / totalDuration) * 100 : 0);
	const scrubPct = $derived(isScrubbing ? scrubPreview * 100 : progressPct);
	const currentQualityLabel = $derived(
		currentQuality === -1
			? 'Auto'
			: (qualityLevels.find((q) => q.index === currentQuality)?.height ?? 0) + 'p'
	);

	/* ═══════════════════════════════════════════════
	   Formatting
	   ═══════════════════════════════════════════════ */
	function fmt(secs: number): string {
		if (!secs || !isFinite(secs)) return '0:00';
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		const s = Math.floor(secs % 60);
		return h > 0
			? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
			: m + ':' + String(s).padStart(2, '0');
	}

	function fmtBitrate(bps: number): string {
		return bps > 1_000_000
			? (bps / 1_000_000).toFixed(1) + ' Mbps'
			: Math.round(bps / 1000) + ' Kbps';
	}

	/* ═══════════════════════════════════════════════
	   Controls
	   ═══════════════════════════════════════════════ */
	function activeEl() { return isAudio ? audioEl : videoEl; }

	function togglePlay() {
		const e = activeEl();
		if (!e) return;
		if (!hasStarted) { hasStarted = true; startPlayback(); return; }
		e.paused ? e.play() : e.pause();
	}

	function skipBy(secs: number) {
		const e = activeEl();
		if (e) e.currentTime = Math.max(0, Math.min(e.currentTime + secs, totalDuration));
	}

	function setVol(v: number) {
		volume = Math.max(0, Math.min(1, v));
		const e = activeEl();
		if (e) { e.volume = volume; e.muted = false; muted = false; }
	}

	function toggleMute() {
		const e = activeEl();
		if (!e) return;
		muted = !muted;
		e.muted = muted;
	}

	function seekTo(frac: number) {
		const e = activeEl();
		if (e) e.currentTime = frac * totalDuration;
	}

	function setRate(r: number) {
		playbackRate = r;
		const e = activeEl();
		if (e) e.playbackRate = r;
		activePanel = 'none';
	}

	/* ── Scrub bar interactions ── */
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

	/* ── Volume slider drag ── */
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

	/* ── Panel toggling ── */
	function togglePanel(p: Panel) {
		activePanel = activePanel === p ? 'none' : p;
	}

	/* ── Track selection ── */
	function setQuality(index: number) {
		if (hls) { hls.currentLevel = index; currentQuality = index; }
		activePanel = 'none';
	}

	function setAudioTrackId(id: number) {
		if (hls) { hls.audioTrack = id; currentAudioTrack = id; }
		activePanel = 'none';
	}

	function setSubtitleTrackId(id: number) {
		currentSubtitleTrack = id;
		activePanel = 'none';

		if (id === -1) {
			if (hls) hls.subtitleTrack = -1;
			if (videoEl) {
				for (let i = 0; i < videoEl.textTracks.length; i++) {
					videoEl.textTracks[i].mode = 'hidden';
				}
			}
			return;
		}

		const track = subtitleTracks.find((t) => t.id === id);
		if (track?.source === 'external') {
			// Disable HLS subtitle, show the injected <track> element by label
			if (hls) hls.subtitleTrack = -1;
			if (videoEl) {
				for (let i = 0; i < videoEl.textTracks.length; i++) {
					const tt = videoEl.textTracks[i];
					tt.mode = (tt.label === track.name) ? 'showing' : 'hidden';
				}
			}
		} else {
			// HLS track
			if (hls) hls.subtitleTrack = id;
			if (videoEl) {
				for (let i = 0; i < videoEl.textTracks.length; i++) {
					videoEl.textTracks[i].mode = (i === id) ? 'showing' : 'hidden';
				}
			}
		}
	}

	/** Fetch external subtitle streams (SRT/ASS) not included in the HLS manifest. */
	async function fetchExternalSubtitles() {
		try {
			const res = await fetch(`/api/stream/${serviceId}/subtitles?itemId=${itemId}`);
			if (!res.ok) return;
			const data: { id: number; name: string; lang: string; isExternal: boolean; vttUrl: string }[] =
				await res.json();
			if (!data.length || !videoEl) return;

			// De-duplicate: skip tracks whose name already appears in HLS subtitle tracks
			const hlsNames = new Set(subtitleTracks.filter((t) => t.source === 'hls').map((t) => t.name));
			const nextId = 1000;
			const newExternal = data
				.filter((t) => !hlsNames.has(t.name))
				.map((t, i) => ({
					id: nextId + i,
					name: t.name,
					lang: t.lang,
					source: 'external' as const,
					vttUrl: t.vttUrl
				}));

			if (!newExternal.length) return;

			// Inject <track> elements so the browser can load VTT data
			newExternal.forEach((t) => {
				const el = document.createElement('track');
				el.kind = 'subtitles';
				el.label = t.name;
				el.srclang = t.lang;
				el.src = t.vttUrl;
				videoEl!.appendChild(el);
			});

			subtitleTracks = [...subtitleTracks.filter((t) => t.source !== 'external'), ...newExternal];
		} catch (e) {
			console.warn('[Player] Failed to fetch external subtitles:', e);
		}
	}

	/* ── Controls visibility ── */
	function resetControlsTimer() {
		showControls = true;
		if (controlsTimeout) clearTimeout(controlsTimeout);
		if (playing && isVideo) {
			controlsTimeout = setTimeout(() => { showControls = false; activePanel = 'none'; }, 3500);
		}
	}

	/* ── Theater / Close ── */
	function closeTheater() {
		reportStop();
		const e = activeEl();
		if (e) e.pause();
		if (hls) { hls.destroy(); hls = null; }
		hasStarted = false;
		playing = false;
		sessionStarted = false;
		document.body.style.overflow = '';
		onclose?.();
	}

	let isFullscreen = $state(false);

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

	function togglePiP() {
		if (!videoEl) return;
		if (document.pictureInPictureElement) {
			document.exitPictureInPicture().catch(() => {});
		} else {
			videoEl.requestPictureInPicture?.().catch(() => {});
		}
	}

	/* ═══════════════════════════════════════════════
	   Keyboard Shortcuts
	   ═══════════════════════════════════════════════ */
	function handleKeydown(e: KeyboardEvent) {
		if (!hasStarted) return;
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		switch (e.key) {
			case ' ': case 'k': e.preventDefault(); togglePlay(); break;
			case 'ArrowLeft': case 'j': e.preventDefault(); skipBy(-10); break;
			case 'ArrowRight': case 'l': e.preventDefault(); skipBy(10); break;
			case 'ArrowUp': e.preventDefault(); setVol(volume + 0.1); break;
			case 'ArrowDown': e.preventDefault(); setVol(volume - 0.1); break;
			case 'f': e.preventDefault(); toggleFullscreen(); break;
			case 'p': if (isVideo) { e.preventDefault(); togglePiP(); } break;
			case 'm': e.preventDefault(); toggleMute(); break;
			case 'c': e.preventDefault(); togglePanel('subtitles'); break;
			case ',': if (e.shiftKey) { e.preventDefault(); skipBy(-1 / 30); } break;
			case '.': if (e.shiftKey) { e.preventDefault(); skipBy(1 / 30); } break;
			case 'Escape':
				e.preventDefault();
				if (activePanel !== 'none') activePanel = 'none';
				else if (isFullscreen) document.exitFullscreen();
				else closeTheater();
				break;
		}
		resetControlsTimer();
	}

	/* ═══════════════════════════════════════════════
	   Progress Reporting to Jellyfin
	   ═══════════════════════════════════════════════ */

	function reportStart() {
		if (!serviceId || !itemId || sessionStarted) return;
		sessionStarted = true;
		const e = activeEl();
		const ticks = e ? Math.round(e.currentTime * 10_000_000) : 0;
		fetch('/api/stream/' + serviceId + '/progress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				itemId,
				positionTicks: ticks,
				isPaused: false,
				isStopped: false,
				isStart: true,
				isMuted: muted,
				volumeLevel: Math.round(volume * 100)
			})
		}).catch(() => {});
	}

	function reportProgress() {
		if (!serviceId || !itemId || !sessionStarted) return;
		const e = activeEl();
		if (!e || e.paused) return;
		const ticks = Math.round(e.currentTime * 10_000_000);
		if (ticks === lastReportedTicks) return;
		lastReportedTicks = ticks;
		fetch('/api/stream/' + serviceId + '/progress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				itemId,
				positionTicks: ticks,
				isPaused: false,
				isStopped: false,
				isMuted: muted,
				volumeLevel: Math.round(volume * 100)
			})
		}).catch(() => {});
	}

	function reportStop() {
		if (!serviceId || !itemId || !sessionStarted) return;
		sessionStarted = false;
		const e = activeEl();
		const ticks = e ? Math.round(e.currentTime * 10_000_000) : lastReportedTicks;
		const body = JSON.stringify({
			itemId,
			positionTicks: ticks,
			isPaused: true,
			isStopped: true,
			isMuted: muted,
			volumeLevel: Math.round(volume * 100)
		});
		if (navigator.sendBeacon) {
			navigator.sendBeacon(
				'/api/stream/' + serviceId + '/progress',
				new Blob([body], { type: 'application/json' })
			);
		} else {
			fetch('/api/stream/' + serviceId + '/progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				keepalive: true
			}).catch(() => {});
		}
	}

	function reportPause() {
		if (!serviceId || !itemId || !sessionStarted) return;
		const e = activeEl();
		const ticks = e ? Math.round(e.currentTime * 10_000_000) : lastReportedTicks;
		fetch('/api/stream/' + serviceId + '/progress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				itemId,
				positionTicks: ticks,
				isPaused: true,
				isStopped: false,
				isMuted: muted,
				volumeLevel: Math.round(volume * 100)
			})
		}).catch(() => {});
	}

	function handleBeforeUnload() {
		reportStop();
	}

	/* ═══════════════════════════════════════════════
	   HLS / Playback Init
	   ═══════════════════════════════════════════════ */
	async function startPlayback() {
		isLoading = true;
		errorMsg = '';
		if (isAudio) initAudio();
		else await initVideo();
	}

	async function initVideo() {
		if (!videoEl) return;
		try {
			const Hls = (await import('hls.js')).default;
			if (Hls.isSupported()) {
				hls = new Hls({
					maxBufferLength: 60,
					maxMaxBufferLength: 120,
					startLevel: -1,
					enableWorker: true,
					lowLatencyMode: false,
					debug: false,
					renderTextTracksNatively: true
				});
				hls.loadSource(hlsUrl);
				hls.attachMedia(videoEl);

				hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
					qualityLevels = (data.levels ?? []).map((l: any, i: number) => ({
						index: i,
						height: l.height ?? 0,
						bitrate: l.bitrate ?? 0
					}));
					if (progress > 0 && totalDuration > 0) videoEl!.currentTime = progress * totalDuration;
					else if (progress > 0 && duration > 0) videoEl!.currentTime = progress * duration;
					videoEl!.play().catch(() => {});
					isLoading = false;
					// Fetch external subtitle tracks (SRT/ASS files not in HLS manifest)
					if (serviceId && itemId) fetchExternalSubtitles();
				});

				hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_: any, data: any) => {
					audioTracks = (data.audioTracks ?? []).map((t: any) => ({
						id: t.id,
						name: t.name ?? 'Track ' + (t.id + 1),
						lang: t.lang ?? ''
					}));
				});

				hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_: any, data: any) => {
					const hlsTracks = (data.subtitleTracks ?? []).map((t: any) => ({
						id: t.id,
						name: t.name ?? 'Subtitle ' + (t.id + 1),
						lang: t.lang ?? '',
						source: 'hls' as const
					}));
					// Preserve any external tracks already fetched
					const existing = subtitleTracks.filter((t) => t.source === 'external');
					subtitleTracks = [...hlsTracks, ...existing];
				});

				hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
					currentQuality = hls.autoLevelEnabled ? -1 : data.level;
				});

				hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_: any, data: any) => {
					currentSubtitleTrack = data.id ?? -1;
				});

				hls.on(Hls.Events.ERROR, (_: any, data: any) => {
					if (data.fatal) {
						console.warn('[Player] HLS fatal error, falling back to direct stream', data);
						hls.destroy(); hls = null;
						tryDirectStream();
					}
				});
			} else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
				videoEl.src = hlsUrl;
				videoEl.addEventListener('loadedmetadata', () => {
					if (progress > 0 && totalDuration > 0) videoEl!.currentTime = progress * totalDuration;
					else if (progress > 0 && duration > 0) videoEl!.currentTime = progress * duration;
					videoEl!.play().catch(() => {});
					isLoading = false;
				}, { once: true });
			} else {
				tryDirectStream();
			}
		} catch {
			tryDirectStream();
		}
	}

	function tryDirectStream() {
		if (!videoEl) return;
		videoEl.src = directUrl;
		videoEl.addEventListener('canplay', () => {
			if (progress > 0 && totalDuration > 0) videoEl!.currentTime = progress * totalDuration;
			else if (progress > 0 && duration > 0) videoEl!.currentTime = progress * duration;
			videoEl!.play().catch(() => {});
			isLoading = false;
		}, { once: true });
		videoEl.addEventListener('error', () => {
			isLoading = false;
			errorMsg = 'Unable to play this content. The format may be unsupported by your browser.';
		}, { once: true });
	}

	function initAudio() {
		if (!audioEl) return;
		audioEl.src = audioUrl;
		audioEl.addEventListener('loadedmetadata', () => {
			if (progress > 0 && totalDuration > 0) audioEl!.currentTime = progress * totalDuration;
			else if (progress > 0 && duration > 0) audioEl!.currentTime = progress * duration;
			audioEl!.play().catch(() => {});
			isLoading = false;
		}, { once: true });
		audioEl.addEventListener('error', () => {
			isLoading = false;
			errorMsg = 'Unable to play audio.';
		}, { once: true });
	}

	/* ── Media event bindings ── */
	function bindEvents(el: HTMLMediaElement) {
		el.addEventListener('play', () => {
			playing = true;
			resetControlsTimer();
			if (!sessionStarted) reportStart();
			else reportProgress();
		});
		el.addEventListener('pause', () => {
			playing = false;
			showControls = true;
			reportPause();
		});
		el.addEventListener('timeupdate', () => {
			if (!isScrubbing) currentTime = el.currentTime;
		});
		el.addEventListener('durationchange', () => {
			if (el.duration && isFinite(el.duration)) totalDuration = el.duration;
		});
		el.addEventListener('progress', () => {
			if (el.buffered.length > 0) buffered = el.buffered.end(el.buffered.length - 1);
		});
		el.addEventListener('waiting', () => { isLoading = true; });
		el.addEventListener('canplay', () => { isLoading = false; });
		el.addEventListener('ended', () => {
			playing = false;
			showControls = true;
			reportStop();
		});
		el.addEventListener('enterpictureinpicture', () => { pipActive = true; });
		el.addEventListener('leavepictureinpicture', () => { pipActive = false; });
		el.addEventListener('seeked', () => {
			if (sessionStarted) reportProgress();
		});
	}

	/* ═══════════════════════════════════════════════
	   Lifecycle
	   ═══════════════════════════════════════════════ */
	/* ── Portal: move theater to <body> so no ancestor clips it ── */
	let portalParent: Node | null = null;
	let portalSibling: Node | null = null;

	$effect(() => {
		if (!theaterEl || !isVideo) return;
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

	onMount(() => {
		if (duration) totalDuration = duration;
		if (videoEl) bindEvents(videoEl);
		if (audioEl) bindEvents(audioEl);
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		window.addEventListener('beforeunload', handleBeforeUnload);
		progressInterval = setInterval(reportProgress, 5_000);
		if (autoplay) { hasStarted = true; startPlayback(); }
	});

	onDestroy(() => {
		reportStop();
		if (hls) { hls.destroy(); hls = null; }
		if (controlsTimeout) clearTimeout(controlsTimeout);
		if (progressInterval) clearInterval(progressInterval);
		document.removeEventListener('keydown', handleKeydown);
		document.removeEventListener('fullscreenchange', handleFullscreenChange);
		window.removeEventListener('beforeunload', handleBeforeUnload);
		// Restore theater to original position if still on body
		if (theaterEl && theaterEl.parentNode === document.body) {
			if (portalParent) {
				if (portalSibling && portalSibling.parentNode === portalParent) {
					portalParent.insertBefore(theaterEl, portalSibling);
				} else {
					(portalParent as Element).appendChild(theaterEl);
				}
			}
		}
		document.body.style.overflow = '';
	});
</script>

{#if isVideo}
	<div
		bind:this={theaterEl}
		class="theater"
		class:theater--active={theaterActive}
		class:cursor-none={!showControls && playing}
		onmousemove={resetControlsTimer}
		onclick={(e) => { if ((e.target as HTMLElement).closest('.ctrl-panel, .ctrl-bar')) return; }}
		role="region"
		aria-label="Video player"
	>
		<video
			bind:this={videoEl}
			class="theater__video"
			crossorigin="anonymous"
			playsinline
			preload="none"
			poster={poster}
		></video>

		{#if !hasStarted}
			<button class="preplay__back" onclick={closeTheater} aria-label="Go back">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
			</button>
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

		{#if isLoading && hasStarted}
			<div class="overlay"><div class="spinner"></div></div>
		{/if}

		{#if errorMsg}
			<div class="overlay overlay--solid">
				<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-nova)" stroke-width="1.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" stroke-linecap="round" /></svg>
				<p class="overlay__msg">{errorMsg}</p>
				<button class="overlay__btn" onclick={closeTheater}>Close</button>
			</div>
		{/if}

		{#if hasStarted && !errorMsg}
			<button class="click-area" onclick={togglePlay} ondblclick={toggleFullscreen} aria-label={playing ? 'Pause' : 'Play'}></button>
		{/if}

		{#if hasStarted && !errorMsg}
			<div class="ctrl" class:ctrl--hidden={!showControls}>
				<!-- Top bar: back + media info -->
				<div class="ctrl__top">
					<button class="cb ctrl__back" onclick={closeTheater} aria-label="Go back">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
					</button>
					<div class="ctrl__meta">
						{#if title}<span class="ctrl__title">{title}</span>{/if}
						{#if subtitle}<span class="ctrl__sub">{subtitle}</span>{/if}
					</div>
					{#if qualityLevels.length > 0}
						<span class="qual-pill">{currentQualityLabel}</span>
					{/if}
				</div>

				<div class="ctrl__bot">
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
						aria-valuemax={totalDuration}
						aria-valuenow={currentTime}
						tabindex={0}
					>
						<div class="scrub__rail">
							<div class="scrub__buf" style="width:{bufferedPct}%"></div>
							<div class="scrub__fill" style="width:{scrubPct}%"></div>
						</div>
						<div class="scrub__thumb" style="left:{scrubPct}%"></div>
						{#if scrubHover && !isScrubbing}
							<div class="scrub__tip" style="left:{scrubHoverFrac * 100}%">{fmt(scrubHoverFrac * totalDuration)}</div>
						{/if}
						{#if isScrubbing}
							<div class="scrub__tip scrub__tip--active" style="left:{scrubPreview * 100}%">{fmt(scrubPreview * totalDuration)}</div>
						{/if}
					</div>

					<div class="ctrl-bar">
						<!-- Skip back -->
						<button class="cb cb--sm" onclick={() => skipBy(-10)} aria-label="Back 10s">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5V3m0 0L9 6m3-3 3 3"/><path d="M12 5a7 7 0 1 0 7 7" /><text x="12" y="16" font-size="6.5" fill="white" stroke="none" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>
						</button>

						<!-- Play / Pause -->
						<button class="cb cb--play" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
							{#if playing}
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
							<button class="cb cb--sm" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
								{#if muted || volume === 0}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>
								{:else if volume < 0.5}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
								{:else}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
								{/if}
							</button>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="vol-slider" bind:this={volSliderEl} onmousedown={onVolDown} role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={1} aria-valuenow={volume} tabindex={0}>
								<div class="vol-slider__track"></div>
								<div class="vol-slider__fill" style="width:{(muted ? 0 : volume) * 100}%"></div>
								<div class="vol-slider__thumb" style="left:{(muted ? 0 : volume) * 100}%"></div>
							</div>
						</div>

						<!-- Time -->
						<span class="time-label">{fmt(currentTime)} <span class="time-sep">/</span> {fmt(totalDuration)}</span>

						<!-- Spacer -->
						<div class="ctrl-bar__gap"></div>

						<!-- Subtitles -->
						{#if subtitleTracks.length > 0}
							<div class="ctrl-panel-wrap">
								<button class="cb cb--sm" class:cb--lit={currentSubtitleTrack !== -1} onclick={() => togglePanel('subtitles')} aria-label="Subtitles">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2" /><path d="M7 12h4M13 12h4M7 16h10" /></svg>
								</button>
								{#if activePanel === 'subtitles'}
									<div class="panel">
										<div class="panel__head">Subtitles</div>
										<button class="panel__item" class:panel__item--on={currentSubtitleTrack === -1} onclick={() => setSubtitleTrackId(-1)}>Off {#if currentSubtitleTrack === -1}<span class="panel__ck">&#10003;</span>{/if}</button>
										{#each subtitleTracks as t}
											<button class="panel__item" class:panel__item--on={currentSubtitleTrack === t.id} onclick={() => setSubtitleTrackId(t.id)}>
												{t.name}{t.lang ? ' (' + t.lang + ')' : ''} {#if currentSubtitleTrack === t.id}<span class="panel__ck">&#10003;</span>{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/if}

						<!-- Audio -->
						{#if audioTracks.length > 1}
							<div class="ctrl-panel-wrap">
								<button class="cb cb--sm" onclick={() => togglePanel('audio')} aria-label="Audio">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" fill="currentColor" /><circle cx="18" cy="16" r="3" fill="currentColor" /></svg>
								</button>
								{#if activePanel === 'audio'}
									<div class="panel">
										<div class="panel__head">Audio</div>
										{#each audioTracks as t}
											<button class="panel__item" class:panel__item--on={currentAudioTrack === t.id} onclick={() => setAudioTrackId(t.id)}>
												{t.name}{t.lang ? ' (' + t.lang + ')' : ''} {#if currentAudioTrack === t.id}<span class="panel__ck">&#10003;</span>{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/if}

						<!-- Quality -->
						{#if qualityLevels.length >= 1}
							<div class="ctrl-panel-wrap">
								<button class="cb cb--sm" onclick={() => togglePanel('quality')} aria-label="Quality">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
								</button>
								{#if activePanel === 'quality'}
									<div class="panel">
										<div class="panel__head">Quality</div>
										<button class="panel__item" class:panel__item--on={currentQuality === -1} onclick={() => setQuality(-1)}>Auto {#if currentQuality === -1}<span class="panel__ck">&#10003;</span>{/if}</button>
										{#each qualityLevels.toSorted((a, b) => b.height - a.height) as lv}
											<button class="panel__item" class:panel__item--on={currentQuality === lv.index} onclick={() => setQuality(lv.index)}>
												{lv.height}p <span class="panel__meta">{fmtBitrate(lv.bitrate)}</span>
												{#if currentQuality === lv.index}<span class="panel__ck">&#10003;</span>{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/if}

						<!-- Speed -->
						<div class="ctrl-panel-wrap">
							<button class="cb cb--sm" class:cb--lit={playbackRate !== 1} onclick={() => togglePanel('speed')} aria-label="Speed">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
							</button>
							{#if activePanel === 'speed'}
								<div class="panel panel--narrow">
									<div class="panel__head">Speed</div>
									{#each speeds as s}
										<button class="panel__item" class:panel__item--on={playbackRate === s} onclick={() => setRate(s)}>
											{s}x {#if playbackRate === s}<span class="panel__ck">&#10003;</span>{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<!-- PiP -->
						{#if typeof document !== 'undefined' && document.pictureInPictureEnabled}
							<button class="cb cb--sm" class:cb--lit={pipActive} onclick={togglePiP} aria-label="Picture-in-picture">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><rect x="11" y="9" width="9" height="7" rx="1" fill="currentColor" opacity="0.3" /></svg>
							</button>
						{/if}

						<!-- Fullscreen -->
						<button class="cb cb--sm" onclick={toggleFullscreen} aria-label="Fullscreen">
							{#if isFullscreen}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>

{:else}
	<div class="ap">
		<audio bind:this={audioEl} preload="none"></audio>

		<button class="ap__art" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
			{#if poster}
				<img src={poster} alt="" class="ap__art-img" />
				<div class="ap__art-dim">
					{#if playing}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
					{:else}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5.14v14l11-7-11-7z" /></svg>
					{/if}
				</div>
			{:else if playing}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="var(--color-nebula)"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
			{:else}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="var(--color-nebula)"><path d="M8 5.14v14l11-7-11-7z" /></svg>
			{/if}
		</button>

		<div class="ap__body">
			{#if title}<p class="ap__title">{title}</p>{/if}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="ap__bar" bind:this={scrubEl} onmousedown={onScrubDown} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={totalDuration} aria-valuenow={currentTime} tabindex={0}>
				<div class="ap__bar-fill" style="width:{scrubPct}%"></div>
			</div>
			<div class="ap__time"><span>{fmt(currentTime)}</span><span>{fmt(totalDuration)}</span></div>
		</div>

		{#if isLoading}
			<div class="ap__spin"></div>
		{/if}
	</div>
{/if}

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
	.theater__video {
		width: 100%; height: 100%; object-fit: contain;
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
		background: rgba(124,108,248,0.2);
		backdrop-filter: blur(20px);
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
	.preplay__resume-fill { height: 100%; background: var(--color-nebula); border-radius: 99px; }

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
		pointer-events: none;
		transition: opacity 0.4s ease;
	}
	.ctrl--hidden { opacity: 0; pointer-events: none; }
	.ctrl__top, .ctrl__bot { pointer-events: auto; }

	.ctrl__top {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%);
	}
	.ctrl__back {
		flex-shrink: 0;
	}
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
	.cb--lit { color: var(--color-nebula); }

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
		background: white;
		transition: width 0.05s linear;
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
	.scrub__tip--active { background: var(--color-nebula); border-color: transparent; font-weight: 600; }

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
	.panel {
		position: absolute; bottom: calc(100% + 0.6rem); right: 0;
		min-width: 13rem; max-height: 22rem;
		background: rgba(12,12,18,0.96); border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px; backdrop-filter: blur(24px);
		overflow-y: auto; overscroll-behavior: contain;
		display: flex; flex-direction: column;
		animation: panelIn 0.18s cubic-bezier(0.16,1,0.3,1);
		scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
	}
	.panel--narrow { min-width: 9rem; }
	.panel__head {
		padding: 0.55rem 0.85rem; font-size: 0.68rem; font-weight: 600;
		color: rgba(255,255,255,0.35); text-transform: uppercase;
		letter-spacing: 0.1em; border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.panel__item {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.55rem 0.85rem; background: none; border: none;
		color: rgba(255,255,255,0.75); font-size: 0.78rem;
		cursor: pointer; text-align: left; width: 100%;
		transition: background 0.12s;
	}
	.panel__item:hover { background: rgba(255,255,255,0.06); }
	.panel__item--on { color: var(--color-nebula); }
	.panel__ck { color: var(--color-nebula); font-weight: 700; margin-left: 0.5rem; }
	.panel__meta { font-size: 0.62rem; color: rgba(255,255,255,0.3); margin-left: 0.5rem; }

	.ap {
		display: flex; align-items: center; gap: 0.875rem;
		padding: 0.875rem 1rem; border-radius: 10px;
		border: 1px solid var(--color-border); background: var(--color-surface);
	}
	.ap__art {
		position: relative; width: 3.25rem; height: 3.25rem;
		border-radius: 8px; overflow: hidden; background: var(--color-raised);
		flex-shrink: 0; cursor: pointer; border: none;
		display: flex; align-items: center; justify-content: center;
		transition: transform 0.2s;
	}
	.ap__art:hover { transform: scale(1.06); }
	.ap__art-img { width: 100%; height: 100%; object-fit: cover; }
	.ap__art-dim {
		position: absolute; inset: 0;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0,0,0,0.35);
	}
	.ap__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.ap__title {
		font-size: 0.82rem; font-weight: 500; color: var(--color-text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.ap__bar {
		height: 4px; border-radius: 99px; background: var(--color-raised);
		cursor: pointer; overflow: hidden; transition: height 0.15s;
		touch-action: none;
	}
	.ap__bar:hover { height: 6px; }
	.ap__bar-fill { height: 100%; border-radius: 99px; background: var(--color-nebula); transition: width 0.1s; }
	.ap__time {
		display: flex; justify-content: space-between;
		font-size: 0.6rem; font-family: var(--font-mono); color: var(--color-muted);
	}
	.ap__spin {
		width: 1.15rem; height: 1.15rem; border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--color-nebula) 20%, transparent);
		border-top-color: var(--color-nebula);
		animation: spin 0.75s linear infinite;
	}

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
