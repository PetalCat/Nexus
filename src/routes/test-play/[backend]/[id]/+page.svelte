<script lang="ts">
	/**
	 * Bare playback test-harness. NO design — throwaway. Proves the full path:
	 * negotiate → attach the right engine (hls/dash/progressive) → render
	 * subtitleTracks as <track> → seek works. Quality + subtitle buttons drive
	 * the gauntlet (re-negotiate on quality change, toggle a <track>).
	 */
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import type { PlaybackSession, BrowserCaps } from '$lib/adapters/playback';
	import type { PlayerEngine } from '$lib/components/player/PlayerEngine';

	let { data }: { data: PageData } = $props();

	let video: HTMLVideoElement;
	let engine: PlayerEngine | null = null;
	let session = $state<PlaybackSession | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let activeSubIndex = $state<number>(-1);

	// Reaping: keep the server-side playback session alive while playing; stop it
	// immediately on tab close. Silence ⇒ the server reaper stops the backend.
	let playbackSessionId: string | null = null;
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

	function startKeepalive(id: string) {
		stopKeepalive();
		playbackSessionId = id;
		keepaliveTimer = setInterval(() => {
			if (!playbackSessionId) return;
			fetch('/api/play/heartbeat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId: playbackSessionId })
			}).catch(() => {});
		}, 10_000);
	}
	function stopKeepalive() {
		if (keepaliveTimer) clearInterval(keepaliveTimer);
		keepaliveTimer = null;
	}
	function beaconStop() {
		if (!playbackSessionId) return;
		const body = JSON.stringify({ sessionId: playbackSessionId });
		// sendBeacon survives pagehide; carries the session cookie.
		navigator.sendBeacon?.('/api/play/stop', new Blob([body], { type: 'application/json' }));
		playbackSessionId = null;
		stopKeepalive();
	}

	// ── Continue-watching: report playback progress into the Nexus play_sessions
	// store (the same table continue-watching reads), and resume from it on load.
	let progressTimer: ReturnType<typeof setInterval> | null = null;
	function reportProgress(isStopped = false) {
		if (!video || !video.duration || Number.isNaN(video.duration)) return;
		const payload = JSON.stringify({
			backend: data.backend,
			itemId: data.id,
			positionSeconds: video.currentTime,
			durationSeconds: video.duration,
			mediaType: 'movie',
			isStopped
		});
		if (isStopped && navigator.sendBeacon) {
			navigator.sendBeacon('/api/play/progress', new Blob([payload], { type: 'application/json' }));
		} else {
			fetch('/api/play/progress', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: payload,
				keepalive: isStopped
			}).catch(() => {});
		}
	}
	function startProgressReporting() {
		if (progressTimer) clearInterval(progressTimer);
		progressTimer = setInterval(() => reportProgress(false), 10_000);
	}
	function stopProgressReporting() {
		if (progressTimer) clearInterval(progressTimer);
		progressTimer = null;
	}
	/** GET the saved resume point and seek there (once, on first load). */
	async function resumeFromSaved() {
		try {
			const r = await fetch(
				`/api/play/progress?backend=${encodeURIComponent(data.backend)}&itemId=${encodeURIComponent(data.id)}`
			);
			if (!r.ok) return;
			const { positionSeconds, completed } = await r.json();
			if (!completed && positionSeconds > 5 && video) {
				const seek = () => {
					try { video.currentTime = positionSeconds; } catch { /* ignore */ }
					video.removeEventListener('loadedmetadata', seek);
				};
				if (video.readyState >= 1) seek();
				else video.addEventListener('loadedmetadata', seek);
			}
		} catch { /* ignore */ }
	}

	// Measured link bandwidth (bits/sec), probed once; null until measured.
	let measuredBandwidthBps: number | null = null;
	// The bandwidth the adapter is currently told to target. Starts at the probed
	// value; the mid-stream watchdog steps it DOWN on sustained rebuffering and
	// cautiously back UP after a long healthy window (never above the probe).
	let effectiveBandwidthBps: number | null = null;
	const MIN_BANDWIDTH_BPS = 600_000; // floor: ~360p-ish, don't degrade below this

	// Adaptation watchdog state (buffer-veto model: throughput proposes, buffer decides).
	let adaptTimer: ReturnType<typeof setInterval> | null = null;
	let lastSwitchAt = 0;
	let lowBufferSince = 0;
	let healthyBufferSince = 0;
	let suppressStepUpUntil = 0;
	let recentStalls: number[] = [];

	function forwardBuffer(): number {
		if (!video || !video.buffered.length) return 0;
		const t = video.currentTime;
		for (let i = 0; i < video.buffered.length; i++) {
			if (t >= video.buffered.start(i) - 0.5 && t <= video.buffered.end(i)) {
				return video.buffered.end(i) - t;
			}
		}
		return 0;
	}

	let adapting = false;

	/** Throughput estimate (bits/sec): prefer the engine's EWMA (free, hls/dash);
	 *  fall back to a fresh probe for native progressive. "Throughput proposes." */
	async function measureThroughput(): Promise<number> {
		const est = engine?.bandwidthEstimate?.() ?? 0;
		if (est > 0) return est;
		return (await probeBandwidth(1_000_000)) ?? effectiveBandwidthBps ?? MIN_BANDWIDTH_BPS;
	}

	/**
	 * Re-target the stream bitrate from a FRESH throughput read (not a blind step
	 * off a stale value — that converges far too slowly when a link suddenly
	 * drops). Down → 70% of measured throughput; up → 85%. Skips the switch if the
	 * new target isn't meaningfully different (avoid churn). Resumes at position.
	 */
	async function adapt(direction: 'down' | 'up') {
		if (adapting || effectiveBandwidthBps == null) return;
		adapting = true;
		try {
			const tp = await measureThroughput();
			const target =
				direction === 'down' ? Math.max(MIN_BANDWIDTH_BPS, tp * 0.7) : tp * 0.85;
			// Only act if it's actually a meaningful move.
			if (direction === 'down' && target >= effectiveBandwidthBps * 0.9) {
				lastSwitchAt = Date.now();
				lowBufferSince = 0;
				return;
			}
			if (direction === 'up' && target <= effectiveBandwidthBps * 1.25) return;
			effectiveBandwidthBps = Math.round(target);
			lastSwitchAt = Date.now();
			lowBufferSince = 0;
			healthyBufferSince = 0;
			if (direction === 'down') suppressStepUpUntil = Date.now() + 60_000;
			console.log(
				`[adapt] ${direction} → ${(target / 1e6).toFixed(1)}Mbps (throughput ${(tp / 1e6).toFixed(1)}Mbps)`
			);
			await negotiate(lastPlan, { resumeAt: video?.currentTime ?? 0, autoplay: true });
		} finally {
			adapting = false;
		}
	}

	function startAdaptWatchdog() {
		stopAdaptWatchdog();
		adaptTimer = setInterval(() => {
			if (!video || recovering || loading || adapting || effectiveBandwidthBps == null) return;
			const now = Date.now();
			const fwd = forwardBuffer();
			const sinceSwitch = now - lastSwitchAt;
			recentStalls = recentStalls.filter((t) => now - t < 10_000);

			// ── STEP DOWN (fast): buffer is the ground truth, throughput sets target ──
			const critical = fwd < 1.5 && video.currentTime > 1 && !video.paused;
			if (fwd < 4) {
				if (!lowBufferSince) lowBufferSince = now;
			} else {
				lowBufferSince = 0;
			}
			const sustainedLow = lowBufferSince && now - lowBufferSince >= 5_000;
			const stalling = recentStalls.length >= 2;
			if (
				(critical || sustainedLow || stalling) &&
				(critical || sinceSwitch >= 30_000) &&
				effectiveBandwidthBps > MIN_BANDWIDTH_BPS
			) {
				recentStalls = [];
				void adapt('down');
				return;
			}

			// ── STEP UP (slow, cautious): only after a long healthy window ──
			if (fwd >= 20) {
				if (!healthyBufferSince) healthyBufferSince = now;
			} else {
				healthyBufferSince = 0;
			}
			if (
				healthyBufferSince &&
				now - healthyBufferSince >= 30_000 &&
				now > suppressStepUpUntil &&
				sinceSwitch >= 30_000
			) {
				void adapt('up');
			}
		}, 1_000);
	}
	function stopAdaptWatchdog() {
		if (adaptTimer) clearInterval(adaptTimer);
		adaptTimer = null;
	}

	/** Download a probe payload and measure real throughput → bits/sec. The
	 *  re-measure path uses a smaller payload so it doesn't starve a thin link. */
	async function probeBandwidth(bytes = 4_000_000): Promise<number | null> {
		try {
			const t0 = performance.now();
			const res = await fetch(`/api/play/probe?bytes=${bytes}`, { cache: 'no-store' });
			if (!res.ok || !res.body) return null;
			const reader = res.body.getReader();
			let received = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				received += value.length;
			}
			const secs = (performance.now() - t0) / 1000;
			if (secs <= 0 || received === 0) return null;
			return Math.round((received * 8) / secs); // bits per second
		} catch {
			return null;
		}
	}

	/** Probe what this browser can actually decode (honest profile). */
	function detectCaps(): BrowserCaps {
		const v = document.createElement('video');
		const probes: Record<string, string> = {
			'avc1.640028': 'video/mp4; codecs="avc1.640028"',
			'hev1.1.6.L93.B0': 'video/mp4; codecs="hev1.1.6.L93.B0"',
			'av01.0.05M.08': 'video/mp4; codecs="av01.0.05M.08"',
			vp9: 'video/webm; codecs="vp9"',
			vp8: 'video/webm; codecs="vp8"'
		};
		const videoCodecs = Object.entries(probes)
			.filter(([, mime]) => v.canPlayType(mime) !== '')
			.map(([c]) => c);
		return {
			videoCodecs: videoCodecs.length ? videoCodecs : ['avc1.640028'],
			audioCodecs: ['mp4a.40.2', 'mp3', 'ac-3', 'opus'],
			containers: ['mp4', 'ts', 'webm']
		};
	}

	async function attachEngine(s: PlaybackSession) {
		if (engine) {
			engine.detach();
			engine = null;
		}
		if (s.engine === 'hls') {
			const { createHlsEngine } = await import('$lib/components/player/engines/hls-engine');
			engine = await createHlsEngine();
		} else if (s.engine === 'dash') {
			const { createDashEngine } = await import('$lib/components/player/engines/dash-engine');
			engine = await createDashEngine();
		} else {
			const { createProgressiveEngine } = await import(
				'$lib/components/player/engines/progressive-engine'
			);
			engine = createProgressiveEngine();
		}
		await engine.attach(video, s);
		// Wire the engine's stall + fatal-error signals into the adaptive watchdog
		// and reactive recovery (re-wired per attach since the engine is recreated).
		engine.onStall?.(() => recentStalls.push(Date.now()));
		engine.onFatalError?.(() => recover('engine fatal error'));
	}

	let lastPlan: Record<string, unknown> = {};
	let recovering = false;
	let recoveryCount = 0;

	/**
	 * Reactive recovery (decision 2): if the stream errors mid-watch — typically a
	 * grant that expired (proxy 403) on a range/segment fetch — re-negotiate a
	 * fresh grant and resume at the same timestamp. Universal: works for
	 * progressive (single long GET) AND HLS/DASH. Bounded to avoid a hot loop.
	 */
	async function recover(reason: string) {
		if (recovering) return;
		if (recoveryCount >= 5) {
			error = `playback failed after ${recoveryCount} recovery attempts (${reason})`;
			return;
		}
		recovering = true;
		recoveryCount++;
		const resumeAt = video?.currentTime ?? 0;
		// Recovery only fires mid-watch (the error already paused the element, so
		// reading video.paused here is unreliable) — always resume playback.
		try {
			await negotiate(lastPlan, { resumeAt, autoplay: true });
		} finally {
			recovering = false;
		}
	}

	async function negotiate(
		plan: Record<string, unknown> = {},
		resume?: { resumeAt: number; autoplay: boolean }
	) {
		lastPlan = plan;
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/play/negotiate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					backend: data.backend,
					itemId: data.id,
					type: 'movie',
					// Fold the CURRENT effective bandwidth into the plan so the adapter
					// picks the right rendition (smart bitrate up front + the watchdog's
					// mid-stream step-down/up adjust this value before re-negotiating).
					plan: effectiveBandwidthBps
						? { ...plan, measuredBandwidthBps: effectiveBandwidthBps }
						: plan,
					caps: detectCaps()
				})
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? `negotiate → ${res.status}`);
			// A re-negotiate (quality change) replaces the prior session — stop the
			// old one so we don't leak a transcode, then keepalive the new one.
			beaconStop();
			session = body as PlaybackSession;
			if (body.playbackSessionId) startKeepalive(body.playbackSessionId);
			await attachEngine(session);
			activeSubIndex = -1;
			// Resume at the prior position after a recovery re-negotiate.
			if (resume && video) {
				const seekAndPlay = () => {
					try {
						if (resume.resumeAt > 0) video.currentTime = resume.resumeAt;
					} catch { /* ignore */ }
					if (resume.autoplay) video.play().catch(() => {});
					video.removeEventListener('loadeddata', seekAndPlay);
				};
				if (video.readyState >= 1) seekAndPlay();
				else video.addEventListener('loadeddata', seekAndPlay);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function pickSubtitle(index: number) {
		if (!video) return;
		const tracks = video.textTracks;
		for (let i = 0; i < tracks.length; i++) {
			tracks[i].mode = Number(tracks[i].id) === index ? 'showing' : 'disabled';
		}
		activeSubIndex = index;
	}

	function disableSubtitles() {
		if (!video) return;
		for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = 'disabled';
		activeSubIndex = -1;
	}

	const QUALITIES = [
		{ label: 'Auto (avoid transcode)', plan: {} },
		{ label: '1080p', plan: { targetHeight: 1080 } },
		{ label: '720p', plan: { targetHeight: 720 } },
		{ label: '480p', plan: { targetHeight: 480 } }
	];

	onMount(() => {
		// Probe the link first so the very first negotiate already has the right
		// bitrate (no rough initial over-shoot). Falls back to no-hint on failure.
		probeBandwidth().then(async (bps) => {
			measuredBandwidthBps = bps;
			effectiveBandwidthBps = bps;
			await negotiate();
			startAdaptWatchdog();
			await resumeFromSaved(); // resume where you left off (continue-watching)
			startProgressReporting();
		});
		// Fast clean-stop on tab close / bfcache. pagehide fires where unload
		// doesn't (mobile/bfcache); visibilitychange→hidden covers tab switches.
		const onHide = () => {
			reportProgress(true); // persist final position for continue-watching
			beaconStop();
		};
		window.addEventListener('pagehide', onHide);
		// Reactive recovery: a progressive range fetch that 403s (expired grant)
		// surfaces as a <video> error → re-negotiate + resume. (HLS/DASH engines
		// would hook their own fatal-error events to call recover() the same way.)
		const onErr = () => recover('video error');
		video?.addEventListener('error', onErr);
		return () => {
			window.removeEventListener('pagehide', onHide);
			video?.removeEventListener('error', onErr);
		};
	});
	onDestroy(() => {
		stopAdaptWatchdog();
		stopProgressReporting();
		reportProgress(true);
		engine?.detach();
		beaconStop();
	});
</script>

<h1>test-play — {data.backend} / {data.id}</h1>

{#if loading}<p>negotiating…</p>{/if}
{#if error}<p style="color:red">ERROR: {error}</p>{/if}

<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={video} controls preload="auto" width="800" style="background:#000">
	{#if session}
		{#each session.subtitleTracks as t (t.id)}
			<track
				kind="subtitles"
				id={String(t.id)}
				src={t.url}
				srclang={t.lang || 'und'}
				label={t.name}
			/>
		{/each}
	{/if}
</video>

{#if session}
	<section>
		<p>
			<b>mode:</b> {session.mode} · <b>engine:</b> {session.engine} ·
			<b>sourceHeight:</b> {session.sourceHeight ?? '?'}
		</p>
		<p><b>url:</b> <code>{session.url}</code></p>

		<div>
			<b>quality:</b>
			{#each QUALITIES as q}
				<button onclick={() => negotiate(q.plan)}>{q.label}</button>
			{/each}
		</div>

		<div>
			<b>subtitles:</b>
			<button onclick={disableSubtitles} disabled={activeSubIndex === -1}>off</button>
			{#each session.subtitleTracks as t (t.id)}
				<button onclick={() => pickSubtitle(t.id)} disabled={activeSubIndex === t.id}>
					{t.name} ({t.lang || 'und'})
				</button>
			{:else}
				<i>none</i>
			{/each}
		</div>

		{#if session.burnableSubtitleTracks.length}
			<p><b>burnable (image) subs:</b> {session.burnableSubtitleTracks.map((t) => t.name).join(', ')}</p>
		{/if}
	</section>
{/if}
