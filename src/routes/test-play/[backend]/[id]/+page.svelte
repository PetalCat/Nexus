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
	}

	async function negotiate(plan: Record<string, unknown> = {}) {
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
					plan,
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
		negotiate();
		// Fast clean-stop on tab close / bfcache. pagehide fires where unload
		// doesn't (mobile/bfcache); visibilitychange→hidden covers tab switches.
		const onHide = () => beaconStop();
		window.addEventListener('pagehide', onHide);
		return () => window.removeEventListener('pagehide', onHide);
	});
	onDestroy(() => {
		engine?.detach();
		beaconStop();
	});
</script>

<h1>test-play — {data.backend} / {data.id}</h1>

{#if loading}<p>negotiating…</p>{/if}
{#if error}<p style="color:red">ERROR: {error}</p>{/if}

<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={video} controls width="800" style="background:#000">
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
