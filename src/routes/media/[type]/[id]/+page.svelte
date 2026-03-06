<script lang="ts">
	import type { PageData } from './$types';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';
	import Player from '$lib/components/Player.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	let { data }: { data: PageData } = $props();

	const item = $derived(data.item);
	const similar = $derived((data as any).similar ?? []);
	const episodes = $derived((data as any).episodes ?? []);
	const seasons = $derived((data as any).seasons ?? []);
	const selectedSeason = $derived((data as any).selectedSeason as number | null);
	const autoplay = $derived($page.url.searchParams.get('play') === '1');
	const inLibrary = $derived(data.serviceType === 'jellyfin' || data.serviceType === 'kavita' || data.serviceType === 'romm');

	const typeLabel: Record<string, string> = {
		movie: 'Movie',
		show: 'TV Show',
		episode: 'Episode',
		book: 'Book',
		game: 'Game',
		music: 'Track',
		album: 'Album',
		live: 'Live Channel'
	};

	const isGame = $derived(item.type === 'game');
	const gamePlatform = $derived((item.metadata?.platform as string) ?? '');
	const gameHltb = $derived(item.metadata?.hltb as { main?: number; extra?: number; completionist?: number } | undefined);
	const gameRA = $derived(item.metadata?.retroAchievements as { achievements?: Array<{ title: string; description?: string; badge_url?: string }>; completion_percentage?: number } | undefined);
	const gameStatus = $derived((item.metadata?.userStatus as string) ?? '');
	const gameFileSize = $derived(item.metadata?.fileSize as number | undefined);
	const gameRegions = $derived((item.metadata?.regions as string[]) ?? []);
	const gameTags = $derived((item.metadata?.tags as string[]) ?? []);

	// Game detail tabs: saves, states, screenshots
	const gameSaves = $derived((data as any).gameSaves ?? []);
	const gameStates = $derived((data as any).gameStates ?? []);
	const gameScreenshots = $derived((data as any).gameScreenshots ?? []);
	const hasGameExtras = $derived(isGame && (gameSaves.length > 0 || gameStates.length > 0 || gameScreenshots.length > 0));

	let gameTab = $state<'overview' | 'saves' | 'screenshots' | 'files'>('overview');
	let currentGameStatus = $state('');
	let isFavorited = $state(false);

	$effect(() => {
		currentGameStatus = gameStatus;
		isFavorited = !!(item.metadata?.is_favorited);
	});

	const gameStatusOptions = ['', 'playing', 'finished', 'completed', 'retired', 'wishlist', 'backlog'];

	async function setGameStatus(status: string) {
		currentGameStatus = status;
		try {
			await fetch(`/api/games/${item.sourceId}/status?serviceId=${item.serviceId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: status || null })
			});
		} catch { /* silent */ }
	}

	async function toggleFavorite() {
		isFavorited = !isFavorited;
		try {
			await fetch(`/api/games/${item.sourceId}/favorite?serviceId=${item.serviceId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ favorite: isFavorited })
			});
		} catch { /* silent */ }
	}

	function formatSaveTime(dateStr: string) {
		const d = new Date(dateStr);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	let hashCopied = $state(false);
	function copyHash() {
		const hash = item.metadata?.hash as string;
		if (hash) {
			navigator.clipboard.writeText(hash);
			hashCopied = true;
			setTimeout(() => (hashCopied = false), 2000);
		}
	}

	function formatFileSize(bytes?: number) {
		if (!bytes) return null;
		if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
		if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
		return (bytes / 1024).toFixed(0) + ' KB';
	}

	function formatHltbTime(minutes?: number) {
		if (!minutes) return null;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}` : `${m}m`;
	}

	const playableTypes = ['movie', 'episode', 'music', 'album', 'live'];
	const isPlayable = $derived(!!item.streamUrl && playableTypes.includes(item.type));
	const isAudioType = $derived(item.type === 'music' || item.type === 'album');

	const jellyfinItemId = $derived(
		(item.metadata?.jellyfinId as string) ?? item.sourceId ?? ''
	);

	const subtitleLine = $derived(
		item.type === 'episode' && item.metadata?.seriesName
			? `${item.metadata.seriesName}`
			: ''
	);

	const cast = $derived(
		(item.metadata?.cast as Array<{ name: string; role: string; type: string; imageUrl?: string }>) ?? []
	);

	const officialRating = $derived((item.metadata?.officialRating as string) ?? '');
	const criticRating = $derived((item.metadata?.criticRating as number | undefined) ?? undefined);
	const taglines = $derived((item.metadata?.taglines as string[]) ?? []);
	const episodeTitle = $derived((item.metadata?.episodeTitle as string) ?? '');
	const seasonNumber = $derived((item.metadata?.seasonNumber as number | undefined) ?? undefined);
	const episodeNumber = $derived((item.metadata?.episodeNumber as number | undefined) ?? undefined);

	function formatDuration(secs?: number) {
		if (!secs) return null;
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	const endTime = $derived(() => {
		if (!item.duration) return null;
		const remainingSecs = item.progress
			? item.duration * (1 - item.progress)
			: item.duration;
		const end = new Date(Date.now() + remainingSecs * 1000);
		return end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	});

	let showPlayer = $state(false);
	function startPlayback() { showPlayer = true; }
	function closePlayer() { history.back(); }

	/* ── Episode scroll ── */
	let epScrollEl: HTMLDivElement | undefined = $state();
	let canScrollEpLeft = $state(false);
	let canScrollEpRight = $state(true);

	function scrollEp(dir: -1 | 1) {
		if (!epScrollEl) return;
		epScrollEl.scrollBy({ left: dir * epScrollEl.clientWidth * 0.65, behavior: 'smooth' });
	}

	function updateEpScroll() {
		if (!epScrollEl) return;
		canScrollEpLeft = epScrollEl.scrollLeft > 4;
		canScrollEpRight = epScrollEl.scrollLeft < epScrollEl.scrollWidth - epScrollEl.clientWidth - 4;
	}

	onMount(async () => {
		await tick();
		if (epScrollEl) {
			const card = epScrollEl.querySelector('[data-current="true"]') as HTMLElement | null;
			if (card) {
				const offset = card.offsetLeft - epScrollEl.clientWidth / 2 + card.offsetWidth / 2;
				epScrollEl.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
			}
			updateEpScroll();
		}
	});

	let descExpanded = $state(false);

	/* ── Next episode to watch (for shows) ── */
	const nextEpisode = $derived.by(() => {
		if (item.type !== 'show' || episodes.length === 0) return null;
		// First unwatched/in-progress episode
		const unwatched = episodes.find((ep: any) => !ep.progress || ep.progress < 0.9);
		return unwatched ?? episodes[0]; // fallback to first episode
	});

	/* ── Season switching ── */
	function selectSeason(seasonNum: number) {
		const seriesId = item.type === 'show' ? item.sourceId : (item.metadata?.seriesId as string);
		if (!seriesId) return;
		const svc = data.serviceId;
		goto(`/media/show/${seriesId}?service=${svc}&season=${seasonNum}`, { replaceState: true });
	}

	/* ── Request flow (Overseerr items) ── */
	const canRequest = $derived((data as any).canRequest ?? false);
	const overseerrServiceId = $derived((data as any).overseerrServiceId as string | null);
	const itemStatus = $derived(item.status);
	const isAvailable = $derived(itemStatus === 'available');
	const isRequested = $derived(itemStatus === 'requested' || itemStatus === 'downloading');
	const seasonCount = $derived((item.metadata?.seasonCount as number | undefined) ?? undefined);

	let requesting = $state(false);
	let requested = $state(false);
	let requestError = $state('');

	async function requestItem() {
		if (!overseerrServiceId || requesting) return;
		requesting = true;
		requestError = '';
		try {
			const type = item.type === 'show' ? 'tv' : 'movie';
			const res = await fetch('/api/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: overseerrServiceId, tmdbId: item.sourceId, type })
			});
			const body = await res.json();
			if (body.ok) requested = true;
			else requestError = body.error ?? 'Request failed';
		} catch (e) {
			requestError = 'Network error';
		} finally {
			requesting = false;
		}
	}
</script>

<svelte:head>
	<title>{item.title} — Nexus</title>
</svelte:head>

<div class="detail-page">
	<!-- ═══════════════════════════════════════════
	     PLAYER (Theater Mode)
	     ═══════════════════════════════════════════ -->
	{#if isPlayable && !isAudioType && (showPlayer || autoplay)}
		<Player
			streamUrl={item.streamUrl ?? ''}
			type={item.type}
			title={item.title}
			subtitle={subtitleLine}
			poster={item.backdrop ?? item.poster}
			progress={item.progress}
			duration={item.duration}
			autoplay={true}
			serviceId={data.serviceId}
			itemId={jellyfinItemId}
			onclose={closePlayer}
		/>
	{/if}

	<!-- ═══════════════════════════════════════════
	     HERO
	     ═══════════════════════════════════════════ -->
	{#if !(isPlayable && !isAudioType && (showPlayer || autoplay))}
		<header class="hero">
			<!-- Backdrop -->
			<div class="hero__bg">
				{#if item.backdrop}
					<img src={item.backdrop} alt="" class="hero__bg-img" />
				{:else if item.poster}
					<img src={item.poster} alt="" class="hero__bg-img hero__bg-img--blur" />
				{/if}
				<div class="hero__grad"></div>
			</div>

			<!-- Play trigger overlay (playable video only) -->
			{#if isPlayable && !isAudioType}
				<button
					class="hero__play-trigger"
					onclick={startPlayback}
					aria-label="Play {item.title}"
				>
					<div class="hero__play-icon">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="white">
							<path d="M8 5.14v14l11-7-11-7z" />
						</svg>
					</div>
					{#if item.progress != null && item.progress > 0 && item.progress < 1}
						<div class="hero__resume-pill">
							<div class="hero__resume-bar">
								<div class="hero__resume-fill" style="width:{item.progress * 100}%"></div>
							</div>
							<span>Resume · {Math.round(item.progress * 100)}%</span>
						</div>
					{/if}
				</button>
			{/if}

			<!-- Content overlay -->
			<div class="hero__content">
				<div class="hero__layout">
					<!-- Poster (movies / shows / non-episode) -->
					{#if item.poster && item.type !== 'episode'}
						<div class="hero__poster anim" style="--d:80ms">
							<img src={item.poster} alt={item.title} />
						</div>
					{/if}

					<!-- Info column -->
					<div class="hero__info">
						<!-- Badges -->
						<div class="anim flex flex-wrap items-center gap-2" style="--d:120ms">
							<ServiceBadge type={data.serviceType} />
							<span class="type-label">{typeLabel[item.type] ?? item.type}</span>
							{#if officialRating}
								<span class="official-rating">{officialRating}</span>
							{/if}
							{#if inLibrary}
								<span class="lib-badge lib-badge--owned">
									<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 6l3 3 5-5"/></svg>
									In Library
								</span>
							{:else if canRequest && isAvailable}
								<span class="lib-badge lib-badge--owned">
									<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 6l3 3 5-5"/></svg>
									Available
								</span>
							{:else if canRequest && (isRequested || requested)}
								<span class="lib-badge lib-badge--requested">Requested</span>
							{:else if canRequest}
								<span class="lib-badge lib-badge--missing">Not in Library</span>
							{/if}
						</div>

						<!-- Series line (episodes) -->
						{#if subtitleLine}
							<p class="anim series-line" style="--d:180ms">
								{subtitleLine}
								{#if seasonNumber != null && episodeNumber != null}
									<span class="series-code">S{String(seasonNumber).padStart(2, '0')}E{String(episodeNumber).padStart(2, '0')}</span>
								{/if}
							</p>
						{/if}

						<!-- Title -->
						<h1 class="anim hero-title" style="--d:240ms">{item.title}</h1>

						<!-- Episode sub-title -->
						{#if episodeTitle && item.type === 'episode' && episodeTitle !== item.title}
							<p class="anim ep-sub" style="--d:280ms">{episodeTitle}</p>
						{/if}

						<!-- Meta strip -->
						<div class="anim meta-strip" style="--d:320ms">
							{#if item.year}<span>{item.year}</span>{/if}
							{#if item.duration}
								<span class="dot">·</span>
								<span>{formatDuration(item.duration)}</span>
							{/if}
							{#if item.rating}
								<span class="dot">·</span>
								<span class="star-val">★ {item.rating.toFixed(1)}</span>
							{/if}
							{#if endTime()}
								<span class="dot">·</span>
								<span class="end-val">Ends at {endTime()}</span>
							{/if}
						</div>

						<!-- Season / Ep + Critic -->
						{#if (seasonNumber != null && episodeNumber != null) || criticRating != null}
							<div class="anim flex flex-wrap items-center gap-3" style="--d:360ms">
								{#if item.type === 'episode' && seasonNumber != null && episodeNumber != null}
									<span class="se-tag">Season {seasonNumber} · Episode {episodeNumber}</span>
								{/if}
								{#if criticRating != null}
									<span class="critic-tag">{criticRating}%</span>
								{/if}
							</div>
						{/if}

						<!-- Genres -->
						{#if item.genres && item.genres.length > 0}
							<div class="anim genre-row" style="--d:400ms">
								{#each item.genres as genre}
									<span class="genre-chip">{genre}</span>
								{/each}
							</div>
						{/if}

						<!-- Tagline -->
						{#if taglines.length > 0}
							<p class="anim tagline" style="--d:440ms">"{taglines[0]}"</p>
						{/if}

						<!-- Description -->
						{#if item.description}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<p
								class="anim desc"
								class:desc--open={descExpanded}
								style="--d:480ms"
								onclick={() => (descExpanded = !descExpanded)}
								role="button"
								tabindex="0"
								onkeydown={(e) => { if (e.key === 'Enter') descExpanded = !descExpanded; }}
							>
								{item.description}
							</p>
						{/if}

						<!-- Studios -->
						{#if item.studios && item.studios.length > 0}
							<p class="anim studios-line" style="--d:500ms">{item.studios.join(' · ')}</p>
						{/if}

						<!-- Audio player -->
						{#if isPlayable && isAudioType}
							<div class="anim" style="--d:520ms; max-width: 28rem;">
								<Player
									streamUrl={item.streamUrl ?? ''}
									type={item.type}
									title={item.title}
									poster={item.poster}
									progress={item.progress}
									duration={item.duration}
									autoplay={autoplay}
									serviceId={data.serviceId}
									itemId={jellyfinItemId}
								/>
							</div>
						{/if}

						<!-- Progress bar (when not playing) -->
						{#if !showPlayer && item.progress != null && item.progress > 0 && item.progress < 1 && !isAudioType}
							<div class="anim flex items-center gap-3" style="--d:540ms">
								<div class="progress-bar" style="width:12rem">
									<div class="progress-fill" style="width:{item.progress * 100}%"></div>
								</div>
								<span class="text-xs" style="color:var(--color-muted)">{Math.round(item.progress * 100)}%</span>
							</div>
						{/if}

						<!-- Season / Episode count (Overseerr TV) -->
						{#if canRequest && item.type === 'show' && seasonCount}
							<p class="anim text-xs" style="--d:540ms; color: var(--color-subtle)">
								{seasonCount} Season{seasonCount !== 1 ? 's' : ''}{#if item.metadata?.episodeCount} · {item.metadata.episodeCount} Episodes{/if}
							</p>
						{/if}

						<!-- Actions -->
						<div class="anim action-row" style="--d:580ms">
							{#if isPlayable && !showPlayer && !isAudioType}
								<button class="act-play" onclick={startPlayback}>
									<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
									{item.progress ? 'Resume' : item.actionLabel ?? 'Play'}
								</button>
							{:else if item.type === 'show' && nextEpisode}
								<a
									href="/media/{nextEpisode.type}/{nextEpisode.sourceId}?service={nextEpisode.serviceId}&play=1"
									class="act-play" style="text-decoration:none"
								>
									<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
									{#if nextEpisode.progress && nextEpisode.progress > 0 && nextEpisode.progress < 0.9}
										Resume S{String(nextEpisode.metadata?.seasonNumber ?? selectedSeason ?? '').padStart(2, '0')}E{String(nextEpisode.metadata?.episodeNumber ?? '').padStart(2, '0')}
									{:else}
										Watch S{String(nextEpisode.metadata?.seasonNumber ?? selectedSeason ?? '').padStart(2, '0')}E{String(nextEpisode.metadata?.episodeNumber ?? '').padStart(2, '0')}
									{/if}
								</a>
							{:else if canRequest}
								{#if isAvailable}
									<a href={item.actionUrl ?? '#'} class="act-play" style="text-decoration:none">
										<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3l10 5-10 5V3z"/></svg>
										Available — Watch
									</a>
								{:else if isRequested || requested}
									<div class="act-status act-status--requested">
										<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 6l3 3 5-5"/></svg>
										Requested
									</div>
								{:else}
									<button class="act-play" onclick={requestItem} disabled={requesting}>
										{#if requesting}
											<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
											Requesting…
										{:else}
											<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 1v12M1 7h12"/></svg>
											Request
										{/if}
									</button>
								{/if}
							{/if}
							<button class="act-back" onclick={() => history.back()}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
								Back
							</button>
						</div>

						{#if requestError}
							<p class="anim text-xs" style="--d:600ms; color: var(--color-nova)">{requestError}</p>
						{/if}
					</div>
				</div>
			</div>
		</header>
	{/if}

	<!-- ═══════════════════════════════════════════
	     PAGE CONTENT
	     ═══════════════════════════════════════════ -->
	<div class="page-body">

		<!-- ─── SEASON PICKER + EPISODES ─── -->
		{#if seasons.length > 0 || episodes.length > 0}
			<section class="sect">
				<!-- Season tabs -->
				{#if seasons.length > 1}
					<div class="season-tabs">
						{#each seasons as s}
							<button
								class="season-tab"
								class:season-tab--active={s.seasonNumber === selectedSeason}
								onclick={() => selectSeason(s.seasonNumber)}
							>
								{s.name}
								{#if s.unplayedCount != null && s.unplayedCount > 0 && s.unplayedCount < s.episodeCount}
									<span class="season-unseen">{s.unplayedCount}</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}

				{#if episodes.length > 0}
				<div class="sect__head">
					<h2 class="sect__title">
						{#if selectedSeason != null}Season {selectedSeason}{:else if seasonNumber != null}Season {seasonNumber}{:else}Episodes{/if}
						<span class="sect__count">{episodes.length} episodes</span>
					</h2>
					<div class="scroll-nav">
						<button class="scroll-arrow" disabled={!canScrollEpLeft} onclick={() => scrollEp(-1)} aria-label="Scroll left">
							<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 12L6 8l4-4" stroke-linecap="round" stroke-linejoin="round" /></svg>
						</button>
						<button class="scroll-arrow" disabled={!canScrollEpRight} onclick={() => scrollEp(1)} aria-label="Scroll right">
							<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" /></svg>
						</button>
					</div>
				</div>

				<div class="ep-scroll" bind:this={epScrollEl} onscroll={updateEpScroll}>
					{#each episodes as ep, i}
						{@const epNum = ep.metadata?.episodeNumber as number | undefined}
						{@const epName = (ep.metadata?.episodeTitle as string) ?? ep.title}
						{@const epProg = ep.progress ?? 0}
						{@const isCurrent = ep.sourceId === item.sourceId}
						{@const isWatched = epProg >= 0.9}
						<a
							href="/media/{ep.type}/{ep.sourceId}?service={ep.serviceId}"
							class="epc"
							class:epc--active={isCurrent}
							class:epc--seen={isWatched && !isCurrent}
							data-current={isCurrent}
						>
							<!-- Thumbnail -->
							<div class="epc__thumb">
								{#if ep.thumb || ep.backdrop || ep.poster}
									<img src={ep.thumb ?? ep.backdrop ?? ep.poster} alt="" class="epc__img" loading="lazy" />
								{:else}
									<div class="epc__empty">
										<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15">
											<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M10 9l5 3-5 3V9z" fill="currentColor" opacity="0.3"/>
										</svg>
									</div>
								{/if}

								<!-- Ep number -->
								<div class="epc__num">{epNum ?? i + 1}</div>

								<!-- Duration badge -->
								{#if ep.duration}
									<div class="epc__dur">{formatDuration(ep.duration)}</div>
								{/if}

								<!-- Now-playing overlay -->
								{#if isCurrent}
									<div class="epc__now">
										<div class="epc__now-pill">
											<svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M8 5.14v14l11-7-11-7z" /></svg>
											NOW PLAYING
										</div>
									</div>
								{/if}

								<!-- Watched check -->
								{#if isWatched && !isCurrent}
									<div class="epc__check">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
									</div>
								{/if}

								<!-- Progress -->
								{#if epProg > 0 && epProg < 1}
									<div class="epc__bar">
										<div class="epc__bar-fill" style="width:{epProg * 100}%"></div>
									</div>
								{/if}
							</div>

							<!-- Info -->
							<div class="epc__info">
								<span class="epc__title" title={epName}>{epName}</span>
								{#if ep.description}
									<span class="epc__desc">{ep.description}</span>
								{/if}
							</div>
						</a>
					{/each}
				</div>
				{/if}
			</section>
		{/if}

		<!-- ─── CAST ─── -->
		{#if cast.length > 0}
			<section class="sect">
				<h2 class="sect__title" style="margin-bottom:0.75rem">Cast & Crew</h2>
				<div class="cast-scroll">
					{#each cast.slice(0, 20) as person}
						<div class="cp">
							{#if person.imageUrl}
								<img src={person.imageUrl} alt={person.name} class="cp__img" />
							{:else}
								<div class="cp__fallback">
									<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
								</div>
							{/if}
							<span class="cp__name">{person.name}</span>
							<span class="cp__role">{person.role}</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ─── SIMILAR ─── -->
		{#if similar.length > 0}
			<section class="sect">
				<h2 class="sect__title" style="margin-bottom:0.75rem">More Like This</h2>
				<div class="sim-scroll">
					{#each similar as sim}
						<a href="/media/{sim.type}/{sim.sourceId}?service={sim.serviceId}" class="sim">
							<div class="sim__poster">
								{#if sim.poster}
									<img src={sim.poster} alt={sim.title} loading="lazy" />
								{:else}
									<div class="sim__empty">
										<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
									</div>
								{/if}
							</div>
							<p class="sim__name">{sim.title}</p>
							{#if sim.year}<p class="sim__year">{sim.year}</p>{/if}
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ─── GAME-SPECIFIC SECTIONS ─── -->
		{#if isGame}
			<!-- Game controls: status + favorite -->
			<section class="sect">
				<div class="flex flex-wrap items-center gap-3 mb-4">
					{#if gamePlatform}
						<span class="game-platform-badge">{gamePlatform}</span>
					{/if}
					<select
						class="game-status-select"
						value={currentGameStatus}
						onchange={(e) => setGameStatus((e.target as HTMLSelectElement).value)}
					>
						<option value="">Set status...</option>
						{#each gameStatusOptions.filter(s => s) as s}
							<option value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
						{/each}
					</select>
					<button class="game-fav-btn" class:game-fav-btn--active={isFavorited} onclick={toggleFavorite} title="Toggle favorite">
						<svg width="16" height="16" viewBox="0 0 24 24" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
					</button>
				</div>
			</section>

			<!-- Game tabs -->
			{#if hasGameExtras}
				<div class="game-tabs">
					<button class="game-tab" class:game-tab--active={gameTab === 'overview'} onclick={() => (gameTab = 'overview')}>Overview</button>
					{#if gameSaves.length > 0 || gameStates.length > 0}
						<button class="game-tab" class:game-tab--active={gameTab === 'saves'} onclick={() => (gameTab = 'saves')}>
							Saves
							<span class="game-tab-count">{gameSaves.length + gameStates.length}</span>
						</button>
					{/if}
					{#if gameScreenshots.length > 0}
						<button class="game-tab" class:game-tab--active={gameTab === 'screenshots'} onclick={() => (gameTab = 'screenshots')}>
							Screenshots
							<span class="game-tab-count">{gameScreenshots.length}</span>
						</button>
					{/if}
					<button class="game-tab" class:game-tab--active={gameTab === 'files'} onclick={() => (gameTab = 'files')}>Files</button>
				</div>
			{/if}

			{#if gameTab === 'overview' || !hasGameExtras}
				<!-- Game Info Bar -->
				{#if gamePlatform || gameFileSize || gameRegions.length > 0}
					<section class="sect">
						<h2 class="sect__title" style="margin-bottom:0.75rem">Game Info</h2>
						<div class="game-info-grid">
							{#if gamePlatform}
								<div class="game-info-card">
									<span class="game-info-label">Platform</span>
									<span class="game-info-value">{gamePlatform}</span>
								</div>
							{/if}
							{#if currentGameStatus}
								<div class="game-info-card">
									<span class="game-info-label">Status</span>
									<span class="game-info-value game-status game-status--{currentGameStatus}">{currentGameStatus}</span>
								</div>
							{/if}
							{#if gameFileSize}
								<div class="game-info-card">
									<span class="game-info-label">File Size</span>
									<span class="game-info-value">{formatFileSize(gameFileSize)}</span>
								</div>
							{/if}
							{#if gameRegions.length > 0}
								<div class="game-info-card">
									<span class="game-info-label">Region</span>
									<span class="game-info-value">{gameRegions.join(', ')}</span>
								</div>
							{/if}
							{#if gameTags.length > 0}
								<div class="game-info-card">
									<span class="game-info-label">Tags</span>
									<span class="game-info-value">{gameTags.join(', ')}</span>
								</div>
							{/if}
						</div>
					</section>
				{/if}

				<!-- HLTB -->
				{#if gameHltb && (gameHltb.main || gameHltb.extra || gameHltb.completionist)}
					<section class="sect">
						<h2 class="sect__title" style="margin-bottom:0.75rem">How Long to Beat</h2>
						<div class="hltb-grid">
							{#if gameHltb.main}
								<div class="hltb-card">
									<span class="hltb-time">{formatHltbTime(gameHltb.main)}</span>
									<span class="hltb-label">Main Story</span>
								</div>
							{/if}
							{#if gameHltb.extra}
								<div class="hltb-card">
									<span class="hltb-time">{formatHltbTime(gameHltb.extra)}</span>
									<span class="hltb-label">Main + Extra</span>
								</div>
							{/if}
							{#if gameHltb.completionist}
								<div class="hltb-card">
									<span class="hltb-time">{formatHltbTime(gameHltb.completionist)}</span>
									<span class="hltb-label">Completionist</span>
								</div>
							{/if}
						</div>
					</section>
				{/if}

				<!-- RetroAchievements -->
				{#if gameRA && gameRA.achievements && gameRA.achievements.length > 0}
					<section class="sect">
						<h2 class="sect__title" style="margin-bottom:0.75rem">
							RetroAchievements
							{#if gameRA.completion_percentage != null}
								<span class="ra-completion">{gameRA.completion_percentage}%</span>
							{/if}
							<span class="sect__count">{gameRA.achievements.length} achievements</span>
						</h2>
						<div class="ra-scroll">
							{#each gameRA.achievements as ach}
								<div class="ra-card">
									{#if ach.badge_url}
										<img src={ach.badge_url} alt="" class="ra-badge" />
									{:else}
										<div class="ra-badge ra-badge--empty">
											<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>
										</div>
									{/if}
									<span class="ra-title">{ach.title}</span>
									{#if ach.description}
										<span class="ra-desc">{ach.description}</span>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{/if}
			{/if}

			<!-- Saves tab -->
			{#if gameTab === 'saves'}
				<section class="sect">
					{#if gameStates.length > 0}
						<h2 class="sect__title" style="margin-bottom:0.75rem">Save States</h2>
						<div class="saves-grid">
							{#each gameStates as state}
								<div class="save-card">
									<div class="save-thumb">
										{#if state.screenshot_url}
											<img src={state.screenshot_url} alt="" loading="lazy" />
										{:else}
											<div class="save-thumb-empty">
												<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
											</div>
										{/if}
									</div>
									<div class="save-info">
										<span class="save-name">{state.file_name}</span>
										<div class="save-meta">
											<span class="save-type save-type--state">STATE</span>
											<span>{formatSaveTime(state.updated_at || state.created_at)}</span>
											{#if state.file_size_bytes}
												<span>{formatFileSize(state.file_size_bytes)}</span>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if gameSaves.length > 0}
						<h2 class="sect__title" style="margin-bottom:0.75rem; margin-top: {gameStates.length > 0 ? '1.5rem' : '0'}">Battery Saves (SRAM)</h2>
						<div class="saves-grid">
							{#each gameSaves as save}
								<div class="save-card">
									<div class="save-thumb">
										{#if save.screenshot_url}
											<img src={save.screenshot_url} alt="" loading="lazy" />
										{:else}
											<div class="save-thumb-empty">
												<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01"/></svg>
											</div>
										{/if}
									</div>
									<div class="save-info">
										<span class="save-name">{save.file_name}</span>
										<div class="save-meta">
											<span class="save-type save-type--sram">SRAM</span>
											<span>{formatSaveTime(save.updated_at || save.created_at)}</span>
											{#if save.file_size_bytes}
												<span>{formatFileSize(save.file_size_bytes)}</span>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if gameSaves.length === 0 && gameStates.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="1.5" opacity="0.3"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg>
							<p class="mt-3 text-sm text-[var(--color-muted)]">No saves found</p>
						</div>
					{/if}
				</section>
			{/if}

			<!-- Screenshots tab -->
			{#if gameTab === 'screenshots'}
				<section class="sect">
					<h2 class="sect__title" style="margin-bottom:0.75rem">Screenshots</h2>
					{#if gameScreenshots.length > 0}
						<div class="screenshots-grid">
							{#each gameScreenshots as screenshot}
								<a href={screenshot.url} target="_blank" rel="noopener" class="screenshot-card">
									<img src={screenshot.url} alt={screenshot.file_name} loading="lazy" />
								</a>
							{/each}
						</div>
					{:else}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
							<p class="mt-3 text-sm text-[var(--color-muted)]">No screenshots</p>
						</div>
					{/if}
				</section>
			{/if}

			<!-- Files tab -->
			{#if gameTab === 'files'}
				<section class="sect">
					<h2 class="sect__title" style="margin-bottom:0.75rem">ROM Information</h2>
					<div class="game-info-grid">
						{#if item.metadata?.fileName}
							<div class="game-info-card" style="grid-column: 1 / -1">
								<span class="game-info-label">File Name</span>
								<span class="game-info-value" style="word-break: break-all; font-size: 0.75rem">{item.metadata.fileName}</span>
							</div>
						{/if}
						{#if gameFileSize}
							<div class="game-info-card">
								<span class="game-info-label">File Size</span>
								<span class="game-info-value">{formatFileSize(gameFileSize)}</span>
							</div>
						{/if}
						{#if gameRegions.length > 0}
							<div class="game-info-card">
								<span class="game-info-label">Region</span>
								<span class="game-info-value">{gameRegions.join(', ')}</span>
							</div>
						{/if}
						{#if gamePlatform}
							<div class="game-info-card">
								<span class="game-info-label">Platform</span>
								<span class="game-info-value">{gamePlatform}</span>
							</div>
						{/if}
						{#if item.metadata?.hash}
							<div class="game-info-card" style="grid-column: 1 / -1">
								<span class="game-info-label">MD5 Hash</span>
								<div class="flex items-center gap-2">
									<code class="game-info-value" style="font-size: 0.65rem; font-family: monospace; opacity: 0.7">{(item.metadata.hash as string).slice(0, 32)}</code>
									<button class="game-copy-btn" onclick={copyHash} title="Copy hash">
										{#if hashCopied}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-pulsar)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
										{:else}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
										{/if}
									</button>
								</div>
							</div>
						{/if}
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* ═══════════════════════════════════════
	   ANIMATIONS
	   ═══════════════════════════════════════ */
	@keyframes revealUp {
		from { opacity: 0; transform: translateY(26px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	@keyframes heroIn {
		from { opacity: 0; transform: scale(1.06); }
		to   { opacity: 0.55; transform: scale(1); }
	}
	@keyframes heroInBlur {
		from { opacity: 0; transform: scale(1.1); }
		to   { opacity: 0.3; transform: scale(1.05); }
	}
	@keyframes glowPulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(124, 108, 248, 0.35); }
		50%      { box-shadow: 0 0 0 14px rgba(124, 108, 248, 0); }
	}
	@keyframes activeGlow {
		0%, 100% {
			border-color: var(--color-nebula);
			box-shadow: 0 0 14px rgba(124,108,248,0.15), inset 0 0 14px rgba(124,108,248,0.06);
		}
		50% {
			border-color: color-mix(in oklch, var(--color-nebula) 75%, white);
			box-shadow: 0 0 22px rgba(124,108,248,0.25), inset 0 0 22px rgba(124,108,248,0.1);
		}
	}

	.anim {
		opacity: 0;
		animation: revealUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		animation-delay: var(--d, 0ms);
	}

	/* ═══════════════════════════════════════
	   PAGE SHELL
	   ═══════════════════════════════════════ */
	.detail-page { min-height: 100vh; }

	/* ═══════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════ */
	.hero {
		position: relative;
		min-height: 55vh;
		display: flex;
		align-items: flex-end;
		overflow: hidden;
	}
	@media (min-width: 768px)  { .hero { min-height: 72vh; } }
	@media (min-width: 1024px) { .hero { min-height: 78vh; } }

	/* Backdrop image */
	.hero__bg {
		position: absolute;
		inset: 0;
		z-index: 0;
	}
	.hero__bg-img {
		width: 100%; height: 100%;
		object-fit: cover;
		opacity: 0;
		animation: heroIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
	}
	.hero__bg-img--blur {
		filter: blur(48px) saturate(1.3);
		animation-name: heroInBlur;
	}
	.hero__grad {
		position: absolute; inset: 0;
		background:
			linear-gradient(to top,
				var(--color-void) 0%,
				color-mix(in oklch, var(--color-void) 92%, transparent) 12%,
				color-mix(in oklch, var(--color-void) 55%, transparent) 35%,
				transparent 60%),
			linear-gradient(to right,
				color-mix(in oklch, var(--color-void) 80%, transparent) 0%,
				transparent 55%),
			linear-gradient(to bottom,
				color-mix(in oklch, var(--color-void) 35%, transparent) 0%,
				transparent 18%);
	}

	/* Play trigger */
	.hero__play-trigger {
		position: absolute; inset: 0; z-index: 5;
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem;
		background: none; border: none; cursor: pointer;
		opacity: 0; transition: opacity 0.35s ease;
	}
	.hero__play-trigger:hover { opacity: 1; }
	@media (hover: none) { .hero__play-trigger { opacity: 0.55; } }

	.hero__play-icon {
		width: 64px; height: 64px;
		display: flex; align-items: center; justify-content: center;
		border-radius: 50%;
		background: rgba(124, 108, 248, 0.2);
		backdrop-filter: blur(20px);
		border: 1px solid rgba(124, 108, 248, 0.25);
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		animation: glowPulse 2.8s ease-in-out infinite;
	}
	.hero__play-trigger:hover .hero__play-icon { transform: scale(1.1); }

	.hero__resume-pill {
		display: flex; align-items: center; gap: 0.6rem;
		padding: 0.4rem 0.9rem; border-radius: 100px;
		background: rgba(0,0,0,0.55); backdrop-filter: blur(10px);
		font-size: 0.7rem; font-weight: 500; color: rgba(255,255,255,0.65);
	}
	.hero__resume-bar {
		width: 4rem; height: 3px; border-radius: 2px;
		background: rgba(255,255,255,0.12);
		overflow: hidden;
	}
	.hero__resume-fill {
		height: 100%; background: var(--color-nebula); border-radius: 2px;
	}

	/* Hero content overlay */
	.hero__content {
		position: relative; z-index: 10; width: 100%;
		padding: 1.75rem 1.25rem;
	}
	@media (min-width: 640px) { .hero__content { padding: 2.25rem 1.75rem; } }

	.hero__layout {
		display: flex; gap: 1.75rem; align-items: flex-end;
		max-width: 72rem; margin: 0 auto;
	}

	/* Poster card */
	.hero__poster { display: none; }
	@media (min-width: 768px) {
		.hero__poster {
			display: block; flex-shrink: 0; width: 175px;
		}
		.hero__poster img {
			width: 100%; border-radius: 10px;
			box-shadow: 0 14px 52px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
		}
	}
	@media (min-width: 1024px) { .hero__poster { width: 210px; } }

	.hero__info {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column; gap: 0.55rem;
	}

	/* Badges */
	.type-label {
		font-size: 0.68rem; font-weight: 500;
		text-transform: uppercase; letter-spacing: 0.08em;
		color: var(--color-subtle);
	}
	.official-rating {
		font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em;
		color: var(--color-subtle);
		padding: 0.175rem 0.45rem;
		border: 1px solid var(--color-border); border-radius: 4px;
	}

	/* Series line */
	.series-line {
		font-family: var(--font-display); font-size: 0.9rem; font-weight: 600;
		color: var(--color-subtle); letter-spacing: -0.01em;
	}
	.series-code {
		margin-left: 0.35rem;
		font-family: var(--font-mono); font-size: 0.78rem; font-weight: 500;
		color: var(--color-nebula); opacity: 0.8;
	}

	/* Title */
	.hero-title {
		font-family: var(--font-display);
		font-weight: 800; line-height: 1.08; letter-spacing: -0.035em;
		color: var(--color-bright);
		font-size: clamp(1.6rem, 5vw, 3.2rem);
	}

	.ep-sub { font-size: 0.95rem; color: var(--color-subtle); }

	/* Meta */
	.meta-strip {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
		font-size: 0.82rem; color: var(--color-subtle);
	}
	.dot { color: var(--color-muted); opacity: 0.45; }
	.star-val { color: var(--color-star); }
	.end-val { color: var(--color-muted); }

	.se-tag {
		font-size: 0.72rem; font-weight: 600;
		color: var(--color-nebula); letter-spacing: 0.015em;
	}
	.critic-tag {
		font-size: 0.68rem; font-weight: 700;
		color: #6bbd45; padding: 0.125rem 0.45rem;
		border-radius: 100px; background: rgba(107,189,69,0.12);
	}

	/* Genres */
	.genre-row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.genre-chip {
		font-size: 0.68rem; font-weight: 500; color: var(--color-subtle);
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--color-border); border-radius: 100px;
		transition: all 0.2s ease;
	}
	.genre-chip:hover {
		border-color: color-mix(in oklch, var(--color-nebula) 40%, transparent);
		color: var(--color-nebula);
	}

	.tagline { font-size: 0.82rem; font-style: italic; color: var(--color-muted); }

	/* Description */
	.desc {
		max-width: 38rem; font-size: 0.85rem; line-height: 1.7;
		color: var(--color-subtle); cursor: pointer;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 3; overflow: hidden;
		transition: all 0.3s ease;
	}
	.desc--open { -webkit-line-clamp: unset; }

	.studios-line { font-size: 0.68rem; color: var(--color-muted); letter-spacing: 0.015em; }

	/* Actions */
	.action-row {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem;
		margin-top: 0.375rem;
	}
	.act-play {
		display: inline-flex; align-items: center; gap: 0.45rem;
		padding: 0.55rem 1.4rem; border-radius: 100px;
		background: var(--color-nebula); color: white;
		font-family: var(--font-display); font-weight: 700; font-size: 0.85rem;
		letter-spacing: 0.01em; border: none;
		transition: all 0.2s ease;
		box-shadow: 0 0 28px var(--color-nebula-dim);
	}
	.act-play:hover {
		background: color-mix(in oklch, var(--color-nebula) 82%, white);
		box-shadow: 0 0 44px color-mix(in oklch, var(--color-nebula) 30%, transparent);
		transform: translateY(-1px);
	}
	.act-back {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.5rem 1.15rem; border-radius: 100px;
		background: transparent; color: var(--color-text);
		font-family: var(--font-display); font-weight: 600; font-size: 0.82rem;
		border: 1px solid var(--color-border); transition: all 0.2s ease;
	}
	.act-back:hover {
		background: var(--color-raised); border-color: var(--color-muted);
	}

	.act-status {
		display: inline-flex; align-items: center; gap: 0.45rem;
		padding: 0.55rem 1.4rem; border-radius: 100px;
		font-family: var(--font-display); font-weight: 700; font-size: 0.85rem;
		letter-spacing: 0.01em; border: none;
	}
	.act-status--requested {
		background: rgba(245, 158, 11, 0.15); color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	/* ═══════════════════════════════════════
	   PAGE BODY
	   ═══════════════════════════════════════ */
	.page-body {
		position: relative; z-index: 10;
		max-width: 72rem; margin: 0 auto;
		padding: 0 1.25rem 4rem;
	}
	@media (min-width: 640px) { .page-body { padding: 0 1.75rem 4rem; } }

	.sect { margin-top: 2.25rem; }
	@media (min-width: 640px) { .sect { margin-top: 3rem; } }

	.sect__head {
		display: flex; align-items: center;
		justify-content: space-between; margin-bottom: 0.875rem;
	}
	.sect__title {
		font-family: var(--font-display);
		font-size: 1.1rem; font-weight: 700;
		color: var(--color-text); letter-spacing: -0.02em;
	}
	@media (min-width: 640px) { .sect__title { font-size: 1.2rem; } }

	.sect__count {
		margin-left: 0.5rem;
		font-family: var(--font-body); font-size: 0.72rem; font-weight: 400;
		color: var(--color-muted);
	}

	/* Scroll arrows */
	.scroll-nav { display: flex; gap: 0.2rem; }
	.scroll-arrow {
		display: flex; align-items: center; justify-content: center;
		width: 30px; height: 30px; border-radius: 8px;
		background: transparent; color: var(--color-subtle);
		border: none; transition: all 0.15s ease;
	}
	.scroll-arrow:not(:disabled):hover {
		background: var(--color-raised); color: var(--color-text);
	}
	.scroll-arrow:disabled { opacity: 0.18; pointer-events: none; }

	/* ═══════════════════════════════════════
	   LIBRARY BADGES
	   ═══════════════════════════════════════ */
	.lib-badge {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0.5rem; border-radius: 100px;
		font-size: 0.62rem; font-weight: 600;
		letter-spacing: 0.02em;
	}
	.lib-badge--owned {
		background: rgba(77, 217, 192, 0.12);
		color: var(--color-pulsar);
		border: 1px solid rgba(77, 217, 192, 0.25);
	}
	.lib-badge--requested {
		background: rgba(245, 158, 11, 0.12);
		color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.25);
	}
	.lib-badge--missing {
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-muted);
		border: 1px solid var(--color-border);
	}

	/* ═══════════════════════════════════════
	   SEASON TABS
	   ═══════════════════════════════════════ */
	.season-tabs {
		display: flex; gap: 0.25rem;
		overflow-x: auto; padding-bottom: 0.75rem;
		scrollbar-width: none;
	}
	.season-tabs::-webkit-scrollbar { display: none; }

	.season-tab {
		flex-shrink: 0;
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.4rem 0.9rem; border-radius: 100px;
		background: var(--color-surface); color: var(--color-subtle);
		font-size: 0.78rem; font-weight: 500;
		border: 1px solid var(--color-border);
		transition: all 0.2s ease; cursor: pointer;
	}
	.season-tab:hover {
		background: var(--color-raised);
		color: var(--color-text);
		border-color: var(--color-muted);
	}
	.season-tab--active {
		background: var(--color-nebula);
		color: white;
		border-color: var(--color-nebula);
	}
	.season-tab--active:hover {
		background: color-mix(in oklch, var(--color-nebula) 85%, white);
	}

	.season-unseen {
		display: inline-flex; align-items: center; justify-content: center;
		min-width: 1.15rem; height: 1.15rem;
		padding: 0 0.3rem; border-radius: 100px;
		background: rgba(255,255,255,0.2);
		font-size: 0.62rem; font-weight: 700;
	}

	/* ═══════════════════════════════════════
	   EPISODE CARDS
	   ═══════════════════════════════════════ */
	.ep-scroll {
		display: flex; gap: 0.75rem;
		overflow-x: auto; overflow-y: hidden;
		padding-bottom: 0.75rem;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}
	.ep-scroll::-webkit-scrollbar { display: none; }

	.epc {
		flex-shrink: 0; scroll-snap-align: start;
		width: 13.5rem;
		display: flex; flex-direction: column;
		border-radius: 10px; overflow: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@media (min-width: 640px)  { .epc { width: 16.5rem; } }
	@media (min-width: 1024px) { .epc { width: 18.5rem; } }

	.epc:hover {
		transform: translateY(-5px);
		border-color: color-mix(in oklch, var(--color-subtle) 35%, var(--color-border));
		box-shadow: 0 14px 44px rgba(0,0,0,0.55);
	}
	.epc:hover .epc__img {
		transform: scale(1.06); filter: brightness(1.12);
	}
	.epc--active {
		border-color: var(--color-nebula);
		background: color-mix(in oklch, var(--color-nebula) 5%, var(--color-surface));
		animation: activeGlow 3.2s ease-in-out infinite;
	}
	.epc--seen { opacity: 0.55; }
	.epc--seen:hover { opacity: 1; }

	/* Thumbnail */
	.epc__thumb {
		position: relative; aspect-ratio: 16/9;
		overflow: hidden; background: var(--color-raised);
	}
	.epc__img {
		width: 100%; height: 100%; object-fit: cover;
		transition: all 0.38s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.epc__empty {
		display: flex; align-items: center; justify-content: center;
		width: 100%; height: 100%; background: var(--color-raised);
	}

	.epc__num {
		position: absolute; top: 0.45rem; left: 0.45rem;
		min-width: 1.4rem; height: 1.4rem;
		display: flex; align-items: center; justify-content: center;
		padding: 0 0.3rem; border-radius: 5px;
		background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
		font-family: var(--font-mono); font-size: 0.65rem; font-weight: 600;
		color: white;
	}
	.epc__dur {
		position: absolute; bottom: 0.45rem; right: 0.45rem;
		padding: 0.1rem 0.35rem; border-radius: 4px;
		background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
		font-size: 0.62rem; font-weight: 500; color: rgba(255,255,255,0.75);
	}

	/* Now playing */
	.epc__now {
		position: absolute; inset: 0;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
	}
	.epc__now-pill {
		display: flex; align-items: center; gap: 0.35rem;
		padding: 0.3rem 0.7rem; border-radius: 100px;
		background: rgba(124,108,248,0.28); backdrop-filter: blur(12px);
		border: 1px solid rgba(124,108,248,0.35);
		font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em;
		color: white; text-transform: uppercase;
	}

	/* Watched check */
	.epc__check {
		position: absolute; top: 0.45rem; right: 0.45rem;
		width: 1.35rem; height: 1.35rem;
		display: flex; align-items: center; justify-content: center;
		border-radius: 50%;
		background: rgba(77,217,192,0.18); backdrop-filter: blur(8px);
		color: var(--color-pulsar);
	}

	/* Progress bar */
	.epc__bar {
		position: absolute; bottom: 0; left: 0; right: 0;
		height: 3px; background: rgba(255,255,255,0.08);
	}
	.epc__bar-fill {
		height: 100%; background: var(--color-nebula); border-radius: 0 2px 0 0;
	}

	/* Info below thumb */
	.epc__info { padding: 0.55rem 0.7rem; }
	.epc__title {
		display: block;
		font-size: 0.78rem; font-weight: 500;
		color: var(--color-text); line-height: 1.35;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.epc__desc {
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; overflow: hidden;
		margin-top: 0.2rem;
		font-size: 0.68rem; line-height: 1.45;
		color: var(--color-muted);
	}

	/* ═══════════════════════════════════════
	   CAST
	   ═══════════════════════════════════════ */
	.cast-scroll {
		display: flex; gap: 0.875rem;
		overflow-x: auto; overflow-y: hidden; padding-bottom: 0.5rem;
		scrollbar-width: none; -webkit-overflow-scrolling: touch;
	}
	.cast-scroll::-webkit-scrollbar { display: none; }

	.cp {
		flex-shrink: 0; width: 4.75rem;
		display: flex; flex-direction: column; align-items: center; gap: 0.35rem;
	}
	@media (min-width: 640px) { .cp { width: 5.5rem; } }

	.cp__img {
		width: 3.75rem; height: 3.75rem; border-radius: 50%;
		object-fit: cover; border: 2px solid var(--color-border);
		transition: border-color 0.2s ease;
	}
	.cp:hover .cp__img { border-color: var(--color-muted); }
	@media (min-width: 640px) { .cp__img { width: 4.5rem; height: 4.5rem; } }

	.cp__fallback {
		width: 3.75rem; height: 3.75rem; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		background: var(--color-raised);
	}
	@media (min-width: 640px) { .cp__fallback { width: 4.5rem; height: 4.5rem; } }

	.cp__name {
		text-align: center; font-size: 0.68rem; font-weight: 500;
		color: var(--color-text); line-height: 1.2;
	}
	.cp__role {
		text-align: center; font-size: 0.58rem;
		color: var(--color-muted); line-height: 1.2;
	}

	/* ═══════════════════════════════════════
	   SIMILAR
	   ═══════════════════════════════════════ */
	.sim-scroll {
		display: flex; gap: 0.75rem;
		overflow-x: auto; overflow-y: hidden; padding-bottom: 0.5rem;
		scrollbar-width: none; -webkit-overflow-scrolling: touch;
	}
	.sim-scroll::-webkit-scrollbar { display: none; }

	.sim { flex-shrink: 0; width: 7rem; }
	@media (min-width: 640px) { .sim { width: 8.5rem; } }

	.sim__poster {
		overflow: hidden; border-radius: 8px;
		border: 1px solid var(--color-border);
		transition: all 0.25s ease;
	}
	.sim:hover .sim__poster {
		border-color: color-mix(in oklch, var(--color-nebula) 35%, transparent);
		box-shadow: 0 10px 36px rgba(0,0,0,0.5);
	}
	.sim__poster img {
		aspect-ratio: 2/3; width: 100%; object-fit: cover;
		transition: transform 0.3s ease;
	}
	.sim:hover .sim__poster img { transform: scale(1.05); }

	.sim__empty {
		display: flex; aspect-ratio: 2/3;
		align-items: center; justify-content: center;
		background: var(--color-raised);
	}
	.sim__name {
		margin-top: 0.45rem; font-size: 0.72rem; font-weight: 500;
		color: var(--color-text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.sim__year { font-size: 0.62rem; color: var(--color-muted); }

	/* ═══════════════════════════════════════
	   GAME INFO
	   ═══════════════════════════════════════ */
	.game-info-grid {
		display: flex; flex-wrap: wrap; gap: 0.5rem;
	}
	.game-info-card {
		display: flex; flex-direction: column; gap: 0.15rem;
		padding: 0.6rem 0.9rem; border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}
	.game-info-label {
		font-size: 0.62rem; font-weight: 500;
		color: var(--color-muted); text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.game-info-value {
		font-size: 0.82rem; font-weight: 600;
		color: var(--color-text);
	}

	.game-status { text-transform: capitalize; }
	.game-status--playing { color: #7c6cf8; }
	.game-status--finished { color: #4dd9c0; }
	.game-status--completed { color: #6bbd45; }
	.game-status--retired { color: #f59e0b; }
	.game-status--wishlist { color: #60a5fa; }

	/* ═══════════════════════════════════════
	   HLTB
	   ═══════════════════════════════════════ */
	.hltb-grid {
		display: flex; gap: 0.75rem; flex-wrap: wrap;
	}
	.hltb-card {
		display: flex; flex-direction: column; align-items: center;
		gap: 0.25rem; padding: 1rem 1.5rem;
		border-radius: 12px; background: var(--color-surface);
		border: 1px solid var(--color-border);
		min-width: 7rem;
	}
	.hltb-time {
		font-family: var(--font-display);
		font-size: 1.25rem; font-weight: 800;
		color: var(--color-nebula);
	}
	.hltb-label {
		font-size: 0.68rem; font-weight: 500;
		color: var(--color-muted);
	}

	/* ═══════════════════════════════════════
	   RETROACHIEVEMENTS
	   ═══════════════════════════════════════ */
	.ra-completion {
		margin-left: 0.4rem;
		font-size: 0.78rem; font-weight: 700;
		color: #f59e0b;
	}
	.ra-scroll {
		display: flex; gap: 0.625rem;
		overflow-x: auto; overflow-y: hidden;
		padding-bottom: 0.5rem;
		scrollbar-width: none; -webkit-overflow-scrolling: touch;
	}
	.ra-scroll::-webkit-scrollbar { display: none; }

	.ra-card {
		flex-shrink: 0; width: 6.5rem;
		display: flex; flex-direction: column;
		align-items: center; gap: 0.3rem;
		text-align: center;
	}
	.ra-badge {
		width: 3rem; height: 3rem;
		border-radius: 8px; object-fit: cover;
		border: 1px solid var(--color-border);
	}
	.ra-badge--empty {
		display: flex; align-items: center; justify-content: center;
		background: var(--color-raised);
	}
	.ra-title {
		font-size: 0.65rem; font-weight: 600;
		color: var(--color-text); line-height: 1.25;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; overflow: hidden;
	}
	.ra-desc {
		font-size: 0.58rem; color: var(--color-muted);
		line-height: 1.3;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; overflow: hidden;
	}

	/* ═══════════════════════════════════════
	   GAME CONTROLS
	   ═══════════════════════════════════════ */
	.game-platform-badge {
		font-size: 0.68rem; font-weight: 600;
		padding: 0.25rem 0.65rem; border-radius: 100px;
		background: var(--color-nebula-dim);
		color: var(--color-nebula);
		border: 1px solid color-mix(in oklch, var(--color-nebula) 30%, transparent);
	}
	.game-status-select {
		font-size: 0.75rem; font-weight: 500;
		padding: 0.3rem 0.6rem; border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.game-status-select:hover { border-color: var(--color-muted); }
	.game-status-select:focus { border-color: var(--color-nebula); outline: none; }

	.game-fav-btn {
		display: flex; align-items: center; justify-content: center;
		width: 2rem; height: 2rem; border-radius: 50%;
		background: var(--color-surface); border: 1px solid var(--color-border);
		color: var(--color-muted); cursor: pointer;
		transition: all 0.15s;
	}
	.game-fav-btn:hover { color: var(--color-nova); border-color: var(--color-nova); }
	.game-fav-btn--active { color: var(--color-nova); background: color-mix(in oklch, var(--color-nova) 12%, transparent); border-color: var(--color-nova); }

	.game-copy-btn {
		display: flex; align-items: center; justify-content: center;
		padding: 0.25rem; border-radius: 4px; color: var(--color-muted);
		transition: color 0.15s; cursor: pointer;
	}
	.game-copy-btn:hover { color: var(--color-text); }

	/* ═══════════════════════════════════════
	   GAME TABS
	   ═══════════════════════════════════════ */
	.game-tabs {
		display: flex; gap: 0.25rem;
		margin-bottom: 1rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}
	.game-tab {
		flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.35rem;
		padding: 0.45rem 0.75rem; border-radius: 8px;
		font-size: 0.75rem; font-weight: 500;
		color: var(--color-subtle); cursor: pointer;
		transition: all 0.15s; white-space: nowrap;
	}
	.game-tab:hover { color: var(--color-text); }
	.game-tab--active {
		background: var(--color-raised);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
	}
	.game-tab-count {
		font-size: 0.6rem; font-weight: 600;
		padding: 0.05rem 0.35rem; border-radius: 100px;
		background: var(--color-nebula-dim);
		color: var(--color-nebula);
	}

	/* ═══════════════════════════════════════
	   SAVES
	   ═══════════════════════════════════════ */
	.saves-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}
	.save-card {
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		overflow: hidden;
		transition: border-color 0.2s;
	}
	.save-card:hover { border-color: var(--color-muted); }

	.save-thumb {
		aspect-ratio: 16 / 9;
		background: var(--color-raised);
		overflow: hidden;
	}
	.save-thumb img {
		width: 100%; height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}
	.save-card:hover .save-thumb img { transform: scale(1.05); }
	.save-thumb-empty {
		display: flex; align-items: center; justify-content: center;
		width: 100%; height: 100%;
		background: linear-gradient(135deg, var(--color-raised), var(--color-void));
	}

	.save-info {
		padding: 0.5rem 0.65rem;
	}
	.save-name {
		display: block; font-size: 0.72rem; font-weight: 500;
		color: var(--color-text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.save-meta {
		display: flex; align-items: center; gap: 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.62rem; color: var(--color-muted);
	}
	.save-type {
		font-size: 0.55rem; font-weight: 700;
		padding: 0.1rem 0.35rem; border-radius: 3px;
		text-transform: uppercase;
	}
	.save-type--state {
		background: color-mix(in oklch, var(--color-nebula) 15%, transparent);
		color: var(--color-nebula);
	}
	.save-type--sram {
		background: color-mix(in oklch, var(--color-pulsar) 15%, transparent);
		color: var(--color-pulsar);
	}

	/* ═══════════════════════════════════════
	   SCREENSHOTS
	   ═══════════════════════════════════════ */
	.screenshots-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.5rem;
	}
	.screenshot-card {
		aspect-ratio: 16 / 9;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--color-border);
		transition: border-color 0.2s;
	}
	.screenshot-card:hover { border-color: var(--color-muted); }
	.screenshot-card img {
		width: 100%; height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}
	.screenshot-card:hover img { transform: scale(1.03); }
</style>
