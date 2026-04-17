<script lang="ts">
	import type { PageData } from './$types';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';
	import NexusPlayer from '$lib/components/player/NexusPlayer.svelte';
	import { probeBrowserCaps } from '$lib/components/player/browserCaps';
	import { getEstimatedBandwidth, recommendedMaxBitrate } from '$lib/bandwidth-probe';
	import type { PlaybackSession, PlaybackPlan } from '$lib/adapters/playback';
	import ChannelCard from '$lib/components/video/ChannelCard.svelte';
	import VideoComments from '$lib/components/video/VideoComments.svelte';
	import VideoCard from '$lib/components/video/VideoCard.svelte';
	import { formatViews, formatCount, formatDuration as formatVideoDuration, toVideoCardMedia } from '$lib/utils/video-format';
	import HltbDisplay from '$lib/components/games/HltbDisplay.svelte';
	import AchievementProgress from '$lib/components/games/AchievementProgress.svelte';
	import AchievementCard from '$lib/components/games/AchievementCard.svelte';
	import GameNotes from '$lib/components/games/GameNotes.svelte';
	import HeroSection from '$lib/components/HeroSection.svelte';
	import QualityBadge from '$lib/components/QualityBadge.svelte';
	import WatchlistButton from '$lib/components/WatchlistButton.svelte';
	import AddToCollectionModal from '$lib/components/AddToCollectionModal.svelte';
	import { Play, ThumbsUp, ChevronRight, Bookmark, Share2, Check, Loader2, ListVideo, FolderPlus } from 'lucide-svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	let { data }: { data: PageData } = $props();

	const item = $derived(data.item);
	const similar = $derived((data as any).similar ?? []);
	let episodes = $state<any[]>([]);
	let seasons = $state<any[]>([]);
	let selectedSeason: number | null = $state(null);
	let loadingEpisodes = $state(false);

	// Reset when navigating to a different item (different sourceId)
	$effect(() => {
		void data.item.sourceId;
		episodes = (data as any).episodes ?? [];
		seasons = (data as any).seasons ?? [];
		selectedSeason = (data as any).selectedSeason as number | null;
		playbackSession = null;
		videoPlaybackSession = null;
		audioPlaybackSession = null;
		isNegotiating = false;
		isNegotiatingAudio = false;
	});

	const autoplay = $derived($page.url.searchParams.get('play') === '1');
	const inLibrary = $derived(
		data.serviceType === 'jellyfin' ||
			data.serviceType === 'plex' ||
			data.serviceType === 'calibre' ||
			data.serviceType === 'romm'
	);

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

	const isVideo = $derived(item.type === 'video');
	const recommendedVideos = $derived((item.metadata?.recommendedVideos as any[]) ?? []);
	const videoLikeCount = $derived(item.metadata?.likeCount as number | undefined);
	const videoViewCount = $derived(item.metadata?.viewCount as number | undefined);
	const videoPublishedText = $derived((item.metadata?.publishedText as string) ?? '');
	const videoAuthor = $derived((item.metadata?.author as string) ?? '');
	const videoAuthorId = $derived((item.metadata?.authorId as string) ?? '');
	const videoAuthorVerified = $derived(!!item.metadata?.authorVerified);
	const videoSubCountText = $derived((item.metadata?.subCountText as string) ?? '');
	const videoKeywords = $derived((item.metadata?.keywords as string[]) ?? []);
	const videoIsSubscribed = $derived((data as any).isSubscribed ?? false);
	const hasLinkedInvidious = $derived((data as any).hasLinkedInvidious ?? false);
	const videoNotifyEnabled = $derived((data as any).videoNotifyEnabled ?? false);
	const invidiousBaseUrl = $derived((data as any).invidiousBaseUrl as string | undefined);
	let videoDescExpanded = $state(false);
	// NOTE: videoFormats, videoStreamUrl, videoCaptions removed — NexusPlayer negotiates via /api/play/negotiate

	// Watchlist / Collections state
	let inWatchlist = $state(false);
	let watchlistItemId = $state<string | null>(null);
	let showCollectionModal = $state(false);

	// Reset watchlist state on navigation
	$effect(() => {
		void data.item.sourceId;
		inWatchlist = data.inWatchlist ?? false;
		watchlistItemId = data.watchlistItemId ?? null;
	});

	// ── User rating ──────────────────────────────────────────────────
	let userRating = $state<number | null>(null);
	let ratingStats = $state<{ avg: number; count: number } | null>(null);
	let ratingHover = $state(0);
	let ratingCleared = $state(false);

	$effect(() => {
		void data.item.sourceId;
		userRating = data.userRating as number | null;
		ratingStats = data.ratingStats as { avg: number; count: number } | null;
		ratingCleared = false;
	});

	const ratingSource = $derived.by(() => {
		const st = data.serviceType;
		if (st === 'jellyfin') return 'Community';
		if (st === 'plex') return 'Plex';
		if (st === 'overseerr' || st === 'seerr') return 'TMDB';
		if (st === 'radarr') return 'IMDb';
		if (st === 'sonarr') return 'TMDB';
		return 'Rating';
	});

	async function submitRating(value: number) {
		if (value === userRating) {
			const prev = userRating;
			const prevStats = ratingStats;
			userRating = null;
			ratingCleared = true;
			setTimeout(() => (ratingCleared = false), 2000);
			try {
				const res = await fetch(
					`/api/media/${item.sourceId}/ratings?service=${data.serviceId}&serviceType=${data.serviceType}&mediaType=${item.type}`,
					{ method: 'DELETE' }
				);
				const json = await res.json();
				ratingStats = json.stats;
			} catch {
				userRating = prev;
				ratingStats = prevStats;
				toast.error('Failed to update rating');
			}
		} else {
			const prev = userRating;
			const prevStats = ratingStats;
			userRating = value;
			ratingCleared = false;
			try {
				const res = await fetch(`/api/media/${item.sourceId}/ratings`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						service: data.serviceId,
						rating: value,
						mediaType: item.type,
						serviceType: data.serviceType
					})
				});
				const json = await res.json();
				ratingStats = json.stats;
			} catch {
				userRating = prev;
				ratingStats = prevStats;
				toast.error('Failed to update rating');
			}
		}
	}

	// Save / Share state
	let showPlaylistMenu = $state(false);
	let userPlaylists = $state<Array<{playlistId: string; title: string}>>([]);
	let savingTo = $state<string | null>(null);
	let saveSuccess = $state<string | null>(null);
	let shareTooltip = $state(false);

	async function loadPlaylists() {
		try {
			const res = await fetch('/api/video/playlists');
			if (res.ok) {
				const d = await res.json();
				userPlaylists = d.playlists ?? [];
			}
		} catch {
			toast.error('Failed to load playlists');
		}
	}

	async function saveToPlaylist(playlistId: string) {
		savingTo = playlistId;
		try {
			const res = await fetch(`/api/video/playlists/${playlistId}/videos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ videoId: item.sourceId })
			});
			if (res.ok) {
				saveSuccess = playlistId;
				setTimeout(() => { saveSuccess = null; showPlaylistMenu = false; }, 1500);
			}
		} catch {
			toast.error('Failed to save to playlist');
		}
		savingTo = null;
	}

	function shareVideo() {
		navigator.clipboard.writeText(window.location.href);
		shareTooltip = true;
		setTimeout(() => { shareTooltip = false; }, 2000);
	}

	// Infinite-loading recommendations
	let extraRecs = $state<any[]>([]);
	let loadingMoreRecs = $state(false);
	let noMoreRecs = $state(false);
	let seenRecIds = $state(new Set<string>());
	let recSentinel: HTMLElement | undefined = $state();

	const allRecommendedVideos = $derived([...recommendedVideos, ...extraRecs]);

	// Reset extra recs when the main item changes
	$effect(() => {
		// Access item.id to track it
		void item.id;
		extraRecs = [];
		noMoreRecs = false;
		seenRecIds = new Set(recommendedVideos.map((r: any) => r.sourceId ?? r.id));
	});

	async function loadMoreRecs() {
		if (loadingMoreRecs || noMoreRecs) return;
		const lastRec = allRecommendedVideos[allRecommendedVideos.length - 1];
		if (!lastRec) return;

		loadingMoreRecs = true;
		try {
			const lastId = lastRec.sourceId ?? lastRec.id;
			const res = await fetch(`/api/video/recommendations?videoId=${encodeURIComponent(lastId)}&service=${data.serviceId}`);
			if (!res.ok) { noMoreRecs = true; return; }
			const { recommendations } = await res.json();

			const fresh = (recommendations ?? []).filter((r: any) => {
				const rid = r.sourceId ?? r.id;
				return !seenRecIds.has(rid);
			});

			if (fresh.length === 0) { noMoreRecs = true; return; }
			for (const r of fresh) seenRecIds.add(r.sourceId ?? r.id);
			extraRecs = [...extraRecs, ...fresh];
		} catch {
			noMoreRecs = true;
			toast.error('Failed to load more recommendations');
		} finally {
			loadingMoreRecs = false;
		}
	}

	// IntersectionObserver for infinite scroll
	$effect(() => {
		if (!recSentinel || !isVideo) return;
		const observer = new IntersectionObserver(
			(entries) => { if (entries[0]?.isIntersecting) loadMoreRecs(); },
			{ rootMargin: '300px' }
		);
		observer.observe(recSentinel);
		return () => observer.disconnect();
	});

	const isGame = $derived(item.type === 'game');
	const gamePlatform = $derived((item.metadata?.platform as string) ?? '');
	const gameHltb = $derived(item.metadata?.hltb as { main?: number; extra?: number; completionist?: number } | undefined);
	const gameRA = $derived(item.metadata?.retroAchievements as { achievements?: Array<{ title: string; description?: string; badge_url?: string; points?: number }>; completion_percentage?: number } | undefined);
	const gameStatus = $derived((item.metadata?.userStatus as string) ?? '');
	const gameFileSize = $derived(item.metadata?.fileSize as number | undefined);
	const gameRegions = $derived((item.metadata?.regions as string[]) ?? []);
	const gameTags = $derived((item.metadata?.tags as string[]) ?? []);

	// Game detail tabs: saves, states, screenshots
	const gameSaves = $derived((data as any).gameSaves ?? []);
	const gameStates = $derived((data as any).gameStates ?? []);
	const gameScreenshots = $derived((data as any).gameScreenshots ?? []);
	const gameNoteContent = $derived((data as any).gameNoteContent as string ?? '');
	const hasGameExtras = $derived(isGame && (gameSaves.length > 0 || gameStates.length > 0 || gameScreenshots.length > 0));
	const supportsEmulation = $derived(!!(data as any).supportsEmulation);

	// Book-specific derived values
	const isBook = $derived(item.type === 'book');
	const bookAuthor = $derived((item.metadata?.author as string) ?? '');
	const bookSeriesName = $derived((item.metadata?.seriesName as string) ?? '');
	const bookSeriesIndex = $derived((item.metadata?.seriesIndex as number | undefined) ?? undefined);
	const bookFormatsFromApi = $derived((data as any).bookFormats?.formats ?? []);
	const bookRelated = $derived((data as any).bookRelated ?? { sameAuthor: [], sameSeries: [] });
	const bookNotes = $derived((data as any).bookNotes ?? []);
	const bookHighlights = $derived((data as any).bookHighlights ?? []);
	const bookBookmarks = $derived((data as any).bookBookmarks ?? []);
	const bookReadStatus = $derived(!!item.metadata?.readStatus);
	const bookPublisher = $derived((item.metadata?.publisher as string) ?? '');
	const bookLanguage = $derived((item.metadata?.language as string) ?? '');
	// Formats from getCalibreBookFormats (scrapes /book/{id} page)
	const bookFormats = $derived(bookFormatsFromApi.length > 0 ? bookFormatsFromApi : []);
	const hasEpub = $derived(bookFormats.some((f: any) => (f.name ?? f) === 'EPUB'));

	let bookNoteContent = $state('');
	let togglingRead = $state(false);
	let currentReadStatus = $state(false);

	$effect(() => { currentReadStatus = bookReadStatus; });

	async function toggleBookRead() {
		togglingRead = true;
		try {
			const res = await fetch(`/api/books/${item.sourceId}/toggle-read`, { method: 'POST' });
			if (res.ok) currentReadStatus = !currentReadStatus;
		} catch {
			toast.error('Failed to update read status');
		}
		togglingRead = false;
	}

	async function saveBookNote() {
		if (!bookNoteContent.trim()) return;
		try {
			await fetch(`/api/books/${item.sourceId}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: bookNoteContent, serviceId: data.serviceId })
			});
			bookNoteContent = '';
		} catch {
			toast.error('Failed to save note');
		}
	}

	let gameTab = $state<'overview' | 'saves' | 'screenshots' | 'files' | 'notes'>('overview');
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
		} catch {
			toast.error('Failed to update game status');
		}
	}

	async function toggleFavorite() {
		isFavorited = !isFavorited;
		try {
			await fetch(`/api/games/${item.sourceId}/favorite?serviceId=${item.serviceId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ favorite: isFavorited })
			});
		} catch {
			toast.error('Failed to update favorite');
		}
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

	// Save management actions
	let deletingSaveId = $state<number | null>(null);

	function downloadSave(saveId: number) {
		window.open(`/api/games/${item.sourceId}/saves/${saveId}?serviceId=${data.serviceId}`, '_blank');
	}

	function downloadState(stateId: number) {
		window.open(`/api/games/${item.sourceId}/states/${stateId}?serviceId=${data.serviceId}`, '_blank');
	}

	async function deleteSave(saveId: number) {
		if (!confirm('Delete this save file?')) return;
		deletingSaveId = saveId;
		try {
			const res = await fetch(`/api/games/${item.sourceId}/saves/${saveId}?serviceId=${data.serviceId}`, { method: 'DELETE' });
			if (res.ok) window.location.reload();
		} catch {
			toast.error('Failed to delete save file');
		}
		deletingSaveId = null;
	}

	async function deleteState(stateId: number) {
		if (!confirm('Delete this save state?')) return;
		deletingSaveId = stateId;
		try {
			const res = await fetch(`/api/games/${item.sourceId}/states/${stateId}?serviceId=${data.serviceId}`, { method: 'DELETE' });
			if (res.ok) window.location.reload();
		} catch {
			toast.error('Failed to delete save state');
		}
		deletingSaveId = null;
	}

	async function uploadSave(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const form = new FormData();
		form.append('file', file);
		try {
			const res = await fetch(`/api/games/${item.sourceId}/saves?serviceId=${data.serviceId}`, {
				method: 'POST',
				body: form
			});
			if (res.ok) window.location.reload();
		} catch {
			toast.error('Failed to upload save file');
		}
		input.value = '';
	}

	const playableTypes = ['movie', 'episode', 'music', 'album', 'live', 'video'];
	// videoStreamUrl / videoCaptions removed — NexusPlayer negotiates client-side
	const isPlayable = $derived(
		(!!item.streamUrl && playableTypes.includes(item.type)) ||
		(item.type === 'video' && !!item.sourceId && !!data.serviceId)
	);
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
	function openPlayer() { showPlayer = true; }
	function closePlayer() { playbackSession = null; history.back(); }

	// ── NexusPlayer negotiate-based playback ──────────────────────────
	let playbackSession = $state<PlaybackSession | null>(null);
	let isNegotiating = $state(false);
	let videoPlaybackSession = $state<PlaybackSession | null>(null);
	let audioPlaybackSession = $state<PlaybackSession | null>(null);
	let isNegotiatingAudio = $state(false);

	async function negotiatePlayback(serviceId: string, itemId: string, plan: PlaybackPlan = {}): Promise<PlaybackSession> {
		const caps = probeBrowserCaps();
		// If the user hasn't explicitly picked a quality AND we have a recent
		// bandwidth estimate, cap maxBitrate to 80% of measured throughput so
		// Jellyfin transcodes down to something the link can actually sustain.
		// Prevents the "12 Mbps stream over a 5 Mbps pipe" first-play stall.
		const effectivePlan: PlaybackPlan = { ...plan };
		if (effectivePlan.maxBitrate == null && effectivePlan.targetHeight == null) {
			const bps = getEstimatedBandwidth();
			if (bps) effectivePlan.maxBitrate = recommendedMaxBitrate(bps);
		}
		const res = await fetch('/api/play/negotiate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ serviceId, itemId, plan: effectivePlan, caps }),
		});
		if (!res.ok) throw new Error(`Negotiate failed: ${res.status}`);
		return res.json();
	}

	async function beginNegotiation() {
		if (isNegotiating || !data.serviceId) return;
		isNegotiating = true;
		try {
			const id = jellyfinItemId || item?.sourceId || '';
			playbackSession = await negotiatePlayback(data.serviceId, id);
		} catch (e) {
			console.error('[media] negotiate failed:', e);
		} finally {
			isNegotiating = false;
		}
	}

	async function handleQualityChange(plan: PlaybackPlan): Promise<PlaybackSession> {
		const id = jellyfinItemId || item?.sourceId || '';
		return negotiatePlayback(data.serviceId, id, plan);
	}

	// Auto-negotiate when theater player opens
	$effect(() => {
		if ((showPlayer || autoplay) && isPlayable && !isAudioType && !playbackSession && !isNegotiating) {
			beginNegotiation();
		}
	});

	// Auto-negotiate for Invidious videos
	$effect(() => {
		if (item?.type === 'video' && item.sourceId && data.serviceId && !videoPlaybackSession) {
			negotiatePlayback(data.serviceId, item.sourceId)
				.then(s => { videoPlaybackSession = s; })
				.catch(e => console.error('[video] negotiate failed:', e));
		}
	});

	$effect(() => {
		if (isPlayable && isAudioType && item?.sourceId && data.serviceId && !audioPlaybackSession && !isNegotiatingAudio) {
			isNegotiatingAudio = true;
			const id = jellyfinItemId || item.sourceId;
			negotiatePlayback(data.serviceId, id)
				.then(s => { audioPlaybackSession = s; })
				.catch(e => console.error('[audio] negotiate failed:', e))
				.finally(() => { isNegotiatingAudio = false; });
		}
	});

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
	async function selectSeason(seasonNum: number) {
		if (seasonNum === selectedSeason || loadingEpisodes) return;
		const seriesId = item.type === 'show' ? item.sourceId : (item.metadata?.seriesId as string);
		if (!seriesId) return;

		selectedSeason = seasonNum;
		loadingEpisodes = true;

		try {
			const res = await fetch(`/api/media/episodes?service=${data.serviceId}&seriesId=${seriesId}&season=${seasonNum}`);
			if (res.ok) {
				episodes = await res.json();
			}
		} catch {
			toast.error('Failed to load episodes');
		}

		loadingEpisodes = false;

		// Update URL without navigation
		const url = new URL(window.location.href);
		url.searchParams.set('season', String(seasonNum));
		history.replaceState(history.state, '', url.toString());
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

{#if !isVideo}
<div class="detail-page">
	<!-- Breadcrumbs -->
	<nav class="breadcrumbs mx-auto mb-2 flex max-w-[1400px] items-center gap-1 px-8 pt-4 text-sm text-muted">
		<a href="/" class="hover:text-cream transition-colors">Home</a>
		<ChevronRight size={14} class="opacity-40" />
		{#if item.type === 'movie'}
			<a href="/movies" class="hover:text-cream transition-colors">Movies</a>
		{:else if item.type === 'show' || item.type === 'episode'}
			<a href="/shows" class="hover:text-cream transition-colors">Shows</a>
		{:else if item.type === 'game'}
			<a href="/games" class="hover:text-cream transition-colors">Games</a>
		{:else if item.type === 'book'}
			<a href="/books" class="hover:text-cream transition-colors">Books</a>
		{:else if item.type === 'music' || item.type === 'album'}
			<a href="/music" class="hover:text-cream transition-colors">Music</a>
		{:else if item.type === 'live'}
			<a href="/live" class="hover:text-cream transition-colors">Live TV</a>
		{:else}
			<span>{typeLabel[item.type] ?? item.type}</span>
		{/if}
		{#if item.type === 'episode' && item.metadata?.seriesName && item.metadata?.seriesId}
			<ChevronRight size={14} class="opacity-40" />
			<a href="/media/show/{item.metadata.seriesId}?service={data.serviceId}" class="hover:text-cream transition-colors truncate max-w-[200px]">{item.metadata.seriesName}</a>
		{/if}
		<ChevronRight size={14} class="opacity-40" />
		<span class="text-cream/70 truncate max-w-[300px]">{item.title}</span>
	</nav>

	<!-- ═══════════════════════════════════════════
	     PLAYER (Theater Mode) — NexusPlayer
	     ═══════════════════════════════════════════ -->
	{#if isPlayable && !isAudioType && (showPlayer || autoplay) && playbackSession}
		{#key item.id}
		<NexusPlayer
			session={playbackSession}
			title={item.title}
			subtitle={subtitleLine}
			poster={item.backdrop ?? item.poster}
			progress={item.progress}
			duration={item.duration}
			autoplay={true}
			serviceId={data.serviceId}
			itemId={jellyfinItemId}
			onclose={() => { playbackSession = null; closePlayer(); }}
			onqualitychange={handleQualityChange}
		/>
		{/key}
	{:else if isPlayable && !isAudioType && (showPlayer || autoplay) && !playbackSession}
		<div class="flex items-center justify-center h-96 bg-black/80 rounded-xl">
			<div class="text-[var(--color-muted)]">Loading playback...</div>
		</div>
	{/if}

	<!-- ═══════════════════════════════════════════
	     HERO
	     ═══════════════════════════════════════════ -->
	{#if !(isPlayable && !isAudioType && (showPlayer || autoplay))}
		<HeroSection
			mode="detail"
			backdrop={item.backdrop ?? item.poster}
			trailerUrl={data.trailerUrl?.video ?? null}
			trailerAudioUrl={data.trailerUrl?.audio ?? null}
		>
			<!-- Play trigger overlay (playable video only) -->
			{#if isPlayable && !isAudioType}
				<button
					class="hero__play-trigger"
					onclick={openPlayer}
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
						<!-- ZONE A: Identity -->
						<div class="hero-zone-a">
							<!-- Badges -->
							<div class="anim flex flex-wrap items-center gap-2" style="--d:80ms">
								<ServiceBadge type={data.serviceType} />
								<span class="type-label">{typeLabel[item.type] ?? item.type}</span>
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
								<p class="anim series-line" style="--d:120ms">
									{subtitleLine}
									{#if seasonNumber != null && episodeNumber != null}
										<span class="series-code">S{String(seasonNumber).padStart(2, '0')}E{String(episodeNumber).padStart(2, '0')}</span>
									{/if}
								</p>
							{/if}

							<!-- Mobile poster thumbnail -->
							{#if item.poster}
								<img src={item.poster} alt={item.title} class="anim hero__mobile-poster" style="--d:140ms" />
							{/if}

							<!-- Title -->
							<h1 class="anim hero-title nexus-text-glow" style="--d:180ms">{item.title}</h1>

							<!-- Episode sub-title -->
							{#if episodeTitle && item.type === 'episode' && episodeTitle !== item.title}
								<p class="anim ep-sub" style="--d:200ms">{episodeTitle}</p>
							{/if}

							<!-- Meta strip -->
							<div class="anim meta-strip" style="--d:240ms">
								{#if item.year}<span>{item.year}</span>{/if}
								{#if officialRating}
									<span class="dot">·</span>
									<span class="official-rating">{officialRating}</span>
								{/if}
								{#if item.duration}
									<span class="dot">·</span>
									<span>{formatDuration(item.duration)}</span>
								{/if}
								{#if item.rating}
									<span class="dot">·</span>
									<span class="rating-pill">
										<span class="rating-source">{ratingSource}</span>
										{item.rating.toFixed(1)}
									</span>
								{/if}
								{#if ratingStats}
									<span class="dot">·</span>
									<span class="rating-pill rating-pill--nexus">
										<span class="rating-source">Nexus</span>
										★ {ratingStats.avg.toFixed(1)}
										<span class="rating-count">({ratingStats.count})</span>
									</span>
								{/if}
								{#if endTime()}
									<span class="dot">·</span>
									<span class="end-val">Ends at {endTime()}</span>
								{/if}
							</div>

							<!-- Quality badges -->
							{#if item.metadata?.quality}
								<div class="anim" style="--d:250ms">
									<QualityBadge quality={item.metadata.quality} mode="inline" />
								</div>
							{/if}

							<!-- Season / Ep -->
							{#if item.type === 'episode' && seasonNumber != null && episodeNumber != null}
								<div class="anim flex flex-wrap items-center gap-3" style="--d:260ms">
									<span class="se-tag">Season {seasonNumber} · Episode {episodeNumber}</span>
								</div>
							{/if}

							<!-- Tagline -->
							{#if taglines.length > 0}
								<p class="anim tagline" style="--d:280ms">"{taglines[0]}"</p>
							{/if}
						</div>

						<!-- ZONE B: Details -->
						<div class="hero-zone-b">
							<!-- Description -->
							{#if item.description}
								<button
									type="button"
									class="anim desc"
									class:desc--open={descExpanded}
									style="--d:380ms"
									onclick={() => (descExpanded = !descExpanded)}
								>
									{item.description}
								</button>
							{/if}

							<!-- Critic + Genres -->
							{#if criticRating != null || (item.genres && item.genres.length > 0)}
								<div class="anim flex flex-wrap items-center gap-2" style="--d:420ms">
									{#if criticRating != null}
										<span class="critic-tag">Critic {criticRating}%</span>
									{/if}
									{#if item.genres && item.genres.length > 0}
										{#each item.genres as genre}
											<span class="genre-chip">{genre}</span>
										{/each}
									{/if}
								</div>
							{/if}
						</div>

						<!-- ZONE C: Actions -->
						<div class="hero-zone-c">
							<!-- Audio player -->
							{#if isPlayable && isAudioType}
								<div class="anim" style="--d:540ms; max-width: 28rem;">
									{#key item.id}
									{#if audioPlaybackSession}
										<NexusPlayer
											session={audioPlaybackSession}
											title={item.title}
											poster={item.poster}
											progress={item.progress}
											duration={item.duration}
											autoplay={autoplay}
											serviceId={data.serviceId}
											itemId={jellyfinItemId}
											isAudio={true}
											onqualitychange={handleQualityChange}
										/>
									{:else}
										<div class="flex items-center justify-center h-24 rounded-lg" style="background: rgba(255,255,255,0.03)">
											<span class="text-xs text-[var(--color-muted)]">Loading...</span>
										</div>
									{/if}
									{/key}
								</div>
							{/if}

							<!-- Progress bar (when not playing) -->
							{#if !showPlayer && item.progress != null && item.progress > 0 && item.progress < 1 && !isAudioType}
								<div class="anim flex items-center gap-3" style="--d:540ms">
									<div class="progress-bar" style="width:16rem">
										<div class="progress-fill" style="width:{item.progress * 100}%; height:4px"></div>
									</div>
									<span class="text-xs" style="color:var(--color-muted)">{formatDuration(Math.round((item.duration ?? 0) * (1 - item.progress)))} remaining</span>
								</div>
							{/if}

							<!-- Season / Episode count (Overseerr TV) -->
							{#if canRequest && item.type === 'show' && seasonCount}
								<p class="anim text-xs" style="--d:550ms; color: var(--color-muted)">
									{seasonCount} Season{seasonCount !== 1 ? 's' : ''}{#if item.metadata?.episodeCount} · {item.metadata.episodeCount} Episodes{/if}
								</p>
							{/if}

							<!-- Star rating -->
							<div class="anim star-widget" style="--d:555ms">
								<div
									class="star-row"
									onmouseleave={() => (ratingHover = 0)}
									role="group"
									aria-label="Rate this {item.type}"
								>
									{#each [1, 2, 3, 4, 5] as star}
										<button
											class="star-btn"
											class:star-filled={(ratingHover || userRating || 0) >= star}
											onmouseenter={() => (ratingHover = star)}
											onclick={() => submitRating(star)}
											aria-label="{star} star{star !== 1 ? 's' : ''}"
										>
											<svg width="18" height="18" viewBox="0 0 24 24" fill={((ratingHover || userRating || 0) >= star) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5">
												<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
											</svg>
										</button>
									{/each}
								</div>
								{#if ratingStats}
									<span class="star-aggregate">{ratingStats.avg.toFixed(1)} avg ({ratingStats.count})</span>
								{/if}
								{#if ratingCleared}
									<span class="star-cleared">Rating cleared</span>
								{/if}
							</div>

							<!-- Actions -->
							<div class="anim action-row" style="--d:560ms">
								{#if isBook && item.actionUrl}
									<a href={item.actionUrl} class="act-play" style="text-decoration:none">
										<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/></svg>
										Read
									</a>
								{:else if isPlayable && !showPlayer && !isAudioType}
									<button class="act-play" onclick={openPlayer}>
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
								<WatchlistButton
									mediaId={item.sourceId}
									serviceId={data.serviceId}
									mediaType={item.type}
									mediaTitle={item.title}
									mediaPoster={item.poster}
									bind:inWatchlist
									bind:watchlistItemId
								/>
								<button
									class="group/col flex items-center justify-center rounded-xl p-2.5 transition-all duration-300 bg-cream/[0.06] text-muted hover:bg-cream/[0.1] hover:text-cream"
									title="Add to Collection"
									onclick={() => (showCollectionModal = true)}
								>
									<FolderPlus size={18} strokeWidth={1.5} class="transition-all duration-300 group-hover/col:scale-105" />
								</button>
							</div>

							{#if requestError}
								<p class="anim text-xs" style="--d:600ms; color: var(--color-warm)">{requestError}</p>
							{/if}

							<!-- Studios -->
							{#if item.studios && item.studios.length > 0}
								<p class="anim studios-line" style="--d:620ms">{item.studios.join(' · ')}</p>
							{/if}
						</div>
					</div>

				</div>
			</div>
		</HeroSection>
	{/if}

	<!-- ═══════════════════════════════════════════
	     PAGE CONTENT
	     ═══════════════════════════════════════════ -->
	<div class="page-body">

		<!-- ─── SEASON PICKER + EPISODES ─── -->
		{#if item.type === 'show' || item.type === 'episode' || seasons.length > 0 || episodes.length > 0}
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
				{:else if item.type === 'show' || item.type === 'episode'}
					<div class="rounded-2xl border border-[rgba(240,235,227,0.08)] bg-[var(--color-surface)]/70 px-5 py-6 text-sm text-[var(--color-muted)]">
						Episode data is unavailable right now. The title loaded, but season details did not come back from Jellyfin.
					</div>
				{/if}
			</section>
		{/if}

		<!-- ─── CAST ─── -->
		{#if cast.length > 0}
			<div class="nexus-divider"></div>
			<section class="sect">
				<h2 class="sect__title" style="margin-bottom:0.75rem">Cast & Crew</h2>
				<div class="cast-scroll">
					{#each cast.slice(0, 20) as person}
						<div class="cp">
							<div class="cp__card">
								{#if person.imageUrl}
									<img src={person.imageUrl} alt={person.name} class="cp__img" />
								{:else}
									<div class="cp__fallback">
										<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
									</div>
								{/if}
								<div class="cp__overlay">
									<span class="cp__name">{person.name}</span>
									<span class="cp__role">{person.role}</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}


		<!-- ─── SIMILAR ─── -->
		{#if similar.length > 0}
			<div class="nexus-divider"></div>
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
								{#if sim.rating}
									<span class="sim__rating">★ {sim.rating.toFixed(1)}</span>
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
					{#if supportsEmulation}
						<a href="/play/{item.sourceId}?serviceId={data.serviceId}" class="game-play-btn">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
							Play in Browser
						</a>
					{/if}
				</div>
			</section>

			<!-- Game tabs -->
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
				<button class="game-tab" class:game-tab--active={gameTab === 'notes'} onclick={() => (gameTab = 'notes')}>Notes</button>
				<button class="game-tab" class:game-tab--active={gameTab === 'files'} onclick={() => (gameTab = 'files')}>Files</button>
			</div>

			{#if gameTab === 'overview'}
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
						<HltbDisplay hltb={gameHltb} />
					</section>
				{/if}

				<!-- RetroAchievements -->
				{#if gameRA && gameRA.achievements && gameRA.achievements.length > 0}
					<section class="sect">
						<h2 class="sect__title" style="margin-bottom:0.75rem">
							RetroAchievements
							<span class="sect__count">{gameRA.achievements.length} achievements</span>
						</h2>
						<AchievementProgress
							achievements={gameRA.achievements}
							completionPercentage={gameRA.completion_percentage}
						/>
						<div class="ra-grid">
							{#each gameRA.achievements as ach}
								<AchievementCard achievement={ach} />
							{/each}
						</div>
					</section>
				{/if}
			{/if}

			<!-- Saves tab -->
			{#if gameTab === 'saves'}
				<section class="sect">
					<!-- Upload button -->
					<div style="margin-bottom: 1rem;">
						<label class="save-upload-btn">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
							Upload Save
							<input type="file" hidden onchange={uploadSave} />
						</label>
					</div>

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
									<div class="save-actions">
										<button class="save-action-btn" title="Download" onclick={() => downloadState(state.id)}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
										</button>
										<button class="save-action-btn save-action-btn--danger" title="Delete" disabled={deletingSaveId === state.id} onclick={() => deleteState(state.id)}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
										</button>
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
									<div class="save-actions">
										<button class="save-action-btn" title="Download" onclick={() => downloadSave(save.id)}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
										</button>
										<button class="save-action-btn save-action-btn--danger" title="Delete" disabled={deletingSaveId === save.id} onclick={() => deleteSave(save.id)}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
										</button>
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

			<!-- Notes tab -->
			{#if gameTab === 'notes'}
				<section class="sect">
					<GameNotes romId={item.sourceId} serviceId={data.serviceId} initialContent={gameNoteContent} />
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
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-steel)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
										{:else}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
										{/if}
									</button>
								</div>
							</div>
						{/if}
					</div>
					<a
						href="/api/games/{item.sourceId}/download?serviceId={data.serviceId}"
						class="download-rom-btn"
						download
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
						Download ROM
					</a>
				</section>
			{/if}
		{/if}

		<!-- ─── BOOK-SPECIFIC SECTIONS ─── -->
		{#if isBook}
			<!-- Series position navigator -->
			{#if bookSeriesName}
				<section class="sect">
					<div class="book-series-nav">
						{#if bookRelated.prevInSeries}
							<a href="/media/book/{bookRelated.prevInSeries.sourceId}?service={bookRelated.prevInSeries.serviceId}" class="book-series-link">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
								Previous
							</a>
						{:else}
							<span></span>
						{/if}
						<span class="book-series-label">
							{#if bookSeriesIndex}Book {bookSeriesIndex} in{/if} {bookSeriesName}
						</span>
						{#if bookRelated.nextInSeries}
							<a href="/media/book/{bookRelated.nextInSeries.sourceId}?service={bookRelated.nextInSeries.serviceId}" class="book-series-link">
								Next
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
							</a>
						{:else}
							<span></span>
						{/if}
					</div>
				</section>
			{/if}

			<!-- Format pills -->
			{#if bookFormats.length > 0}
				<section class="sect">
					<div class="book-format-pills">
						{#each bookFormats as fmt (fmt.name)}
							{@const fmtUpper = fmt.name.toUpperCase()}
							{@const isReadable = fmtUpper === 'EPUB' || fmtUpper === 'PDF'}
							<a
								href={isReadable ? `/books/read/${item.sourceId}?service=${data.serviceId}&format=${fmt.name.toLowerCase()}` : `/api/books/${item.sourceId}/download/${fmt.name}`}
								class="book-format-pill"
							>
								{#if fmtUpper === 'EPUB'}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
								{:else if fmtUpper === 'PDF'}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
								{/if}
								{fmtUpper}
							</a>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Reading progress -->
			{#if item.progress != null && item.progress > 0 && item.progress < 1}
				<section class="sect">
					<div class="book-progress-track">
						<div class="book-progress-fill" style="width: {item.progress * 100}%"></div>
					</div>
					<div class="book-progress-actions">
						<a href="/books/read/{item.sourceId}?service={data.serviceId}" class="book-continue-btn">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/></svg>
							Continue Reading ({Math.round(item.progress * 100)}%)
						</a>
					</div>
				</section>
			{/if}

			<!-- Book actions -->
			<section class="sect">
				<div class="book-actions">
					<button
						class="book-action-btn"
						class:book-action-btn--read={currentReadStatus}
						onclick={toggleBookRead}
						disabled={togglingRead}
					>
						{#if togglingRead}
							<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill={currentReadStatus ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
						{/if}
						{currentReadStatus ? 'Read' : 'Mark as Read'}
					</button>
				</div>
			</section>

			<!-- Book metadata panel -->
			<section class="sect">
				<h2 class="sect__title" style="margin-bottom:0.75rem">Book Details</h2>
				<div class="book-meta-grid">
					{#if bookAuthor}
						<div class="book-meta-card">
							<span class="book-meta-label">Author</span>
							<span class="book-meta-value">{bookAuthor}</span>
						</div>
					{/if}
					{#if bookPublisher}
						<div class="book-meta-card">
							<span class="book-meta-label">Publisher</span>
							<span class="book-meta-value">{bookPublisher}</span>
						</div>
					{/if}
					{#if bookLanguage}
						<div class="book-meta-card">
							<span class="book-meta-label">Language</span>
							<span class="book-meta-value">{bookLanguage}</span>
						</div>
					{/if}
					{#if item.year}
						<div class="book-meta-card">
							<span class="book-meta-label">Year</span>
							<span class="book-meta-value">{item.year}</span>
						</div>
					{/if}
					{#if bookFormats.length > 0}
						<div class="book-meta-card">
							<span class="book-meta-label">Formats</span>
							<span class="book-meta-value">{bookFormats.map((f: any) => f.name).join(', ')}</span>
						</div>
					{/if}
					{#if item.rating}
						<div class="book-meta-card">
							<span class="book-meta-label">Rating</span>
							<span class="book-meta-value">{'★'.repeat(Math.round(item.rating / 2))}{'☆'.repeat(5 - Math.round(item.rating / 2))}</span>
						</div>
					{/if}
				</div>
			</section>

			<!-- User notes -->
			<section class="sect">
				<h2 class="sect__title" style="margin-bottom:0.75rem">Notes</h2>
				<div class="book-note-form">
					<textarea
						class="book-note-input"
						placeholder="Write a note about this book..."
						bind:value={bookNoteContent}
						rows="3"
					></textarea>
					<button class="book-action-btn book-action-btn--primary" onclick={saveBookNote} disabled={!bookNoteContent.trim()}>
						Save Note
					</button>
				</div>
				{#if bookNotes.length > 0}
					<div class="book-notes-list">
						{#each bookNotes as note (note.id ?? note.updatedAt)}
							<div class="book-note-card">
								<p class="book-note-text">{note.content}</p>
								<span class="book-note-date">{new Date(note.updatedAt).toLocaleDateString()}</span>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Annotations (Highlights + Bookmarks) -->
			{#if bookHighlights.length > 0 || bookBookmarks.length > 0}
				<section class="sect">
					<h2 class="sect__title" style="margin-bottom:0.75rem">
						Your Annotations
						<span class="sect__count">{bookHighlights.length + bookBookmarks.length}</span>
					</h2>
					<div class="book-annotations-list">
						{#each bookHighlights as hl (hl.id)}
							<div class="book-highlight-card" style="border-left-color: {hl.color ?? 'var(--color-accent)'}">
								<div class="book-annotation-meta">
									<span class="book-highlight-dot" style="background: {hl.color ?? 'var(--color-accent)'}"></span>
									{hl.chapter ?? 'Highlight'}
								</div>
								<p class="book-highlight-text">"{hl.text}"</p>
								{#if hl.note}
									<p class="book-highlight-note">{hl.note}</p>
								{/if}
							</div>
						{/each}
						{#each bookBookmarks as b (b.id)}
							<div class="book-bookmark-card">
								<span class="book-bookmark-icon">&#128278;</span>
								<span class="book-bookmark-label">{b.label ?? b.cfi}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- In This Series -->
			{#if bookRelated.sameSeries && bookRelated.sameSeries.length > 0}
				<section class="sect">
					<h2 class="sect__title" style="margin-bottom:0.75rem">
						In This Series
						<span class="sect__count">{bookRelated.sameSeries.length + 1} books</span>
					</h2>
					<div class="book-series-scroll">
						{#each bookRelated.sameSeries as book (book.id)}
							{@const isCurrent = book.sourceId === item.sourceId}
							<a href="/media/book/{book.sourceId}?service={book.serviceId}" class="book-series-item" class:book-series-item--current={isCurrent}>
								<div class="book-series-poster">
									{#if book.poster}
										<img src={book.poster} alt={book.title} loading="lazy" />
									{:else}
										<div class="book-series-empty">
											<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15"><path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/></svg>
										</div>
									{/if}
								</div>
								<p class="book-series-name">{book.title}</p>
								{#if book.metadata?.seriesIndex}
									<p class="book-series-idx">Book {book.metadata.seriesIndex}</p>
								{/if}
							</a>
						{/each}
					</div>
				</section>
			{/if}

			<!-- More by Author -->
			{#if bookRelated.sameAuthor && bookRelated.sameAuthor.length > 0}
				<section class="sect">
					<h2 class="sect__title" style="margin-bottom:0.75rem">
						More by {bookAuthor || 'This Author'}
						<span class="sect__count">{bookRelated.sameAuthor.length} books</span>
					</h2>
					<div class="book-series-scroll">
						{#each bookRelated.sameAuthor as book (book.id)}
							<a href="/media/book/{book.sourceId}?service={book.serviceId}" class="book-series-item">
								<div class="book-series-poster">
									{#if book.poster}
										<img src={book.poster} alt={book.title} loading="lazy" />
									{:else}
										<div class="book-series-empty">
											<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15"><path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/></svg>
										</div>
									{/if}
								</div>
								<p class="book-series-name">{book.title}</p>
								{#if book.year}<p class="book-series-idx">{book.year}</p>{/if}
							</a>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>
{:else}
<!-- ═══════════════════════════════════════════
     VIDEO DETAIL LAYOUT (Invidious)
     ═══════════════════════════════════════════ -->
<div class="video-detail">
	<!-- Breadcrumbs -->
	<nav class="mb-3 flex items-center gap-1 text-sm text-muted">
		<a href="/" class="hover:text-cream transition-colors">Home</a>
		<ChevronRight size={14} class="opacity-40" />
		<a href="/videos" class="hover:text-cream transition-colors">Videos</a>
		{#if videoAuthorId}
			<ChevronRight size={14} class="opacity-40" />
			<a href="/videos/channel/{videoAuthorId}" class="hover:text-cream transition-colors truncate max-w-[200px]">{videoAuthor}</a>
		{/if}
		<ChevronRight size={14} class="opacity-40" />
		<span class="text-cream/70 truncate max-w-[300px]">{item.title}</span>
	</nav>

	<div class="video-grid">
		<!-- Left column -->
		<div class="video-main">
			<!-- Inline Player — NexusPlayer -->
			{#if videoPlaybackSession && item}
				{#key item.sourceId}
				<NexusPlayer
					session={videoPlaybackSession}
					title={item.title}
					poster={item.backdrop ?? item.poster}
					progress={item.progress}
					duration={item.duration}
					autoplay={autoplay}
					inline={true}
					onqualitychange={handleQualityChange}
				/>
				{/key}
			{:else}
				<div class="video-player-placeholder">
					{#if item.backdrop}
						<img src={item.backdrop} alt="" class="h-full w-full object-cover" />
					{:else if item.poster}
						<img src={item.poster} alt="" class="h-full w-full object-cover" />
					{/if}
					<div class="player-overlay">
						{#if item?.type === 'video' && !videoPlaybackSession}
							<div class="text-cream/60 text-sm">Loading player...</div>
						{:else}
							<Play size={48} class="text-cream/60" />
							<p class="mt-2 text-sm text-cream/40">No stream available</p>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Title + meta -->
			<div class="mt-4">
				<h1 class="text-xl font-bold text-cream">{item.title}</h1>
				<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
					{#if videoViewCount}
						<span>{formatViews(videoViewCount)} views</span>
					{/if}
					{#if videoPublishedText}
						<span>· {videoPublishedText}</span>
					{/if}
					{#if videoLikeCount}
						<span class="flex items-center gap-1">· <ThumbsUp size={14} /> {formatCount(videoLikeCount)}</span>
					{/if}
				</div>
			</div>

			<!-- Action buttons -->
			<div class="mt-3 flex items-center gap-2">
				<div class="relative">
					<button
						class="flex items-center gap-1.5 rounded-lg bg-cream/[0.06] px-3 py-2 text-sm text-cream/80 transition-colors hover:bg-cream/[0.1]"
						onclick={() => { if (userPlaylists.length === 0) loadPlaylists(); showPlaylistMenu = !showPlaylistMenu; }}
					>
						<Bookmark size={16} />
						Save
					</button>
					{#if showPlaylistMenu}
						<div class="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-cream/[0.08] bg-surface p-1 shadow-2xl">
							{#if userPlaylists.length === 0}
								<p class="px-3 py-2 text-xs text-muted">No playlists found</p>
							{:else}
								{#each userPlaylists as pl (pl.playlistId)}
									<button
										class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-cream/80 transition-colors hover:bg-raised"
										onclick={() => saveToPlaylist(pl.playlistId)}
										disabled={savingTo === pl.playlistId}
									>
										{#if saveSuccess === pl.playlistId}
											<Check size={14} class="text-green-400" />
										{:else if savingTo === pl.playlistId}
											<Loader2 size={14} class="animate-spin" />
										{:else}
											<ListVideo size={14} class="text-muted" />
										{/if}
										<span class="truncate">{pl.title}</span>
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
				<div class="relative">
					<button
						class="flex items-center gap-1.5 rounded-lg bg-cream/[0.06] px-3 py-2 text-sm text-cream/80 transition-colors hover:bg-cream/[0.1]"
						onclick={shareVideo}
					>
						<Share2 size={16} />
						Share
					</button>
					{#if shareTooltip}
						<span class="absolute -top-8 left-1/2 -translate-x-1/2 rounded bg-void px-2 py-1 text-xs text-cream whitespace-nowrap">Copied!</span>
					{/if}
				</div>
			</div>

			<!-- Channel card -->
			<ChannelCard
				authorId={videoAuthorId}
				author={videoAuthor}
				authorVerified={videoAuthorVerified}
				subCountText={videoSubCountText}
				thumbnail={(() => {
					const thumbs = item.metadata?.authorThumbnails as any[] | undefined;
					if (!thumbs?.length) return '';
					const t = thumbs.find((t: any) => t.width >= 48) ?? thumbs[thumbs.length - 1];
					const url = t?.url ?? '';
					return url.startsWith('//') ? `https:${url}` : url;
				})()}
				isSubscribed={videoIsSubscribed}
				hasLinkedAccount={hasLinkedInvidious}
				serviceId={data.serviceId}
				notifyEnabled={videoNotifyEnabled}
			/>

			<!-- Description (expandable) -->
			{#if item.description}
				<div class="rounded-xl border border-cream/[0.04] bg-cream/[0.02] p-4">
					<p
						class="whitespace-pre-line text-sm leading-relaxed text-cream/80"
						class:line-clamp-4={!videoDescExpanded}
					>
						{item.description}
					</p>
					{#if item.description.length > 300}
						<button
							class="mt-2 text-xs font-medium text-accent hover:underline"
							onclick={() => (videoDescExpanded = !videoDescExpanded)}
						>
							{videoDescExpanded ? 'Show less' : 'Show more'}
						</button>
					{/if}
				</div>
			{/if}

			<!-- Genres as chips -->
			{#if item.genres && item.genres.length > 0}
				<div class="mt-3 flex flex-wrap gap-2">
					{#each item.genres as genre}
						<span class="rounded-full bg-cream/[0.06] px-3 py-1 text-xs text-cream/70">{genre}</span>
					{/each}
				</div>
			{/if}

			<!-- Keywords as tags -->
			{#if videoKeywords.length > 0}
				<div class="mt-4 flex flex-wrap gap-2">
					{#each videoKeywords.slice(0, 15) as keyword}
						<span class="rounded bg-cream/[0.04] px-2 py-0.5 text-[11px] text-muted">{keyword}</span>
					{/each}
				</div>
			{/if}

			<!-- Comments (lazy) -->
			<VideoComments videoId={item.sourceId} />
		</div>

		<!-- Right sidebar -->
		<aside class="video-sidebar">
			{#if allRecommendedVideos.length > 0}
				<h3 class="mb-3 text-sm font-medium text-muted lg:hidden">Recommendations</h3>
				<h3 class="mb-3 text-sm font-medium text-muted hidden lg:block">Up Next</h3>
				<div class="flex flex-col gap-2">
					{#each allRecommendedVideos as rec}
						<VideoCard
							video={toVideoCardMedia(rec)}
							layout="list"
							onclick={() => goto(`/media/video/${rec.sourceId ?? rec.id}?service=${data.serviceId}`)}
							onchannelclick={() => {
								const chId = rec.metadata?.authorId ?? rec.authorId;
								if (chId) goto(`/videos/channel/${chId}`);
							}}
						/>
					{/each}
					{#if loadingMoreRecs}
						<div class="flex items-center justify-center py-4">
							<div class="h-5 w-5 animate-spin rounded-full border-2 border-cream/20 border-t-accent"></div>
						</div>
					{/if}
					{#if !noMoreRecs}
						<div bind:this={recSentinel} class="h-1"></div>
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>
{/if}

<AddToCollectionModal
	bind:open={showCollectionModal}
	mediaId={item.sourceId}
	serviceId={data.serviceId}
	mediaType={item.type}
	mediaTitle={item.title}
	mediaPoster={item.poster}
/>

<style>
	/* ═══════════════════════════════════════
	   ANIMATIONS
	   ═══════════════════════════════════════ */
	@keyframes revealUp {
		from { opacity: 0; transform: translateY(26px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	@keyframes glowPulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(124, 108, 248, 0.35); }
		50%      { box-shadow: 0 0 0 14px rgba(124, 108, 248, 0); }
	}
	@keyframes activeGlow {
		0%, 100% {
			border-color: var(--color-accent);
			box-shadow: 0 0 14px rgba(124,108,248,0.15), inset 0 0 14px rgba(124,108,248,0.06);
		}
		50% {
			border-color: color-mix(in oklch, var(--color-accent) 75%, white);
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
	   HERO (content layer — backdrop & gradients handled by HeroSection)
	   ═══════════════════════════════════════ */

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
		height: 100%; background: var(--color-accent); border-radius: 2px;
	}

	/* Hero content overlay — sits inside HeroSection's .hero-content (relative, z-index:5, height:100%) */
	.hero__content {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: flex-end;
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
			box-shadow: 0 18px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06);
		}
	}
	@media (min-width: 1024px) { .hero__poster { width: 230px; } }

	.hero__info {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column;
	}

	.hero-zone-a {
		display: flex; flex-direction: column; gap: 0.45rem;
	}
	.hero-zone-b {
		display: flex; flex-direction: column; gap: 0.6rem;
		margin-top: 1.25rem;
	}
	.hero-zone-c {
		display: flex; flex-direction: column; gap: 0.55rem;
		margin-top: 1.5rem;
	}

	.hero__mobile-poster {
		width: 48px; height: auto; border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.5);
		flex-shrink: 0;
	}
	@media (min-width: 768px) { .hero__mobile-poster { display: none; } }

	/* Badges */
	.type-label {
		font-size: 0.68rem; font-weight: 500;
		text-transform: uppercase; letter-spacing: 0.08em;
		color: var(--color-muted);
	}
	.official-rating {
		font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em;
		color: var(--color-muted);
		padding: 0.175rem 0.45rem;
		border: 1px solid rgba(240,235,227,0.06); border-radius: 4px;
	}

	/* Series line */
	.series-line {
		font-family: var(--font-display); font-size: 0.9rem; font-weight: 600;
		color: var(--color-muted); letter-spacing: -0.01em;
	}
	.series-code {
		margin-left: 0.35rem;
		font-family: var(--font-mono); font-size: 0.78rem; font-weight: 500;
		color: var(--color-accent); opacity: 0.8;
	}

	/* Title */
	.hero-title {
		font-family: var(--font-display);
		font-weight: 800; line-height: 1.08; letter-spacing: -0.035em;
		color: var(--color-cream);
		font-size: clamp(1.8rem, 5.5vw, 3.6rem);
	}

	.ep-sub { font-size: 0.95rem; color: var(--color-muted); }

	/* Meta */
	.meta-strip {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
		font-size: 0.88rem; color: rgba(240,235,227,0.78);
	}
	.dot { color: var(--color-muted); opacity: 0.45; }
	.star-val { color: var(--color-accent); }

	.rating-pill {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.1rem 0.45rem; border-radius: 4px;
		background: rgba(240,235,227,0.06);
		font-size: 0.78rem; font-weight: 600;
		color: rgba(240,235,227,0.72);
	}
	.rating-source {
		font-size: 0.58rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.05em;
		color: rgba(240,235,227,0.4);
	}
	.rating-pill--nexus {
		background: rgba(212,162,83,0.1);
		color: var(--color-accent);
	}
	.rating-pill--nexus .rating-source {
		color: rgba(212,162,83,0.55);
	}
	.rating-count {
		font-size: 0.6rem; font-weight: 400;
		color: rgba(240,235,227,0.4);
	}
	.end-val { color: var(--color-muted); }

	.se-tag {
		font-size: 0.72rem; font-weight: 600;
		color: var(--color-accent); letter-spacing: 0.015em;
	}
	.critic-tag {
		font-size: 0.68rem; font-weight: 700;
		color: #6bbd45; padding: 0.125rem 0.45rem;
		border-radius: 100px; background: rgba(107,189,69,0.12);
	}

	/* Genres */
	.genre-row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.genre-chip {
		font-size: 0.72rem; font-weight: 500; color: var(--color-muted);
		padding: 0.2rem 0.6rem;
		border: 1px solid rgba(240,235,227,0.06); border-radius: 100px;
		transition: all 0.2s ease;
	}
	.genre-chip:hover {
		border-color: color-mix(in oklch, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
	}

	.tagline { font-family: var(--font-display); font-size: 0.95rem; color: rgba(240,235,227,0.55); }

	/* Description */
	.desc {
		max-width: 38rem; font-size: 0.9rem; line-height: 1.75;
		color: rgba(240,235,227,0.72); cursor: pointer;
		text-align: left; background: none; border: none; padding: 0; font: inherit;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 3; line-clamp: 3; overflow: hidden;
		transition: all 0.3s ease;
	}
	.desc--open { -webkit-line-clamp: unset; line-clamp: unset; }

	.studios-line { font-size: 0.68rem; color: var(--color-muted); letter-spacing: 0.015em; }

	/* Actions */
	.action-row {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem;
		margin-top: 0.375rem;
	}
	.act-play {
		display: inline-flex; align-items: center; gap: 0.45rem;
		padding: 0.55rem 1.4rem; border-radius: 100px;
		background: var(--color-accent); color: white;
		font-family: var(--font-display); font-weight: 700; font-size: 0.85rem;
		letter-spacing: 0.01em; border: none;
		transition: all 0.2s ease;
		box-shadow: 0 0 28px rgba(212,162,83,0.12);
	}
	.act-play:hover {
		background: color-mix(in oklch, var(--color-accent) 82%, white);
		box-shadow: 0 0 44px color-mix(in oklch, var(--color-accent) 30%, transparent);
		transform: translateY(-1px);
	}
	.act-back {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.5rem 1.15rem; border-radius: 100px;
		background: transparent; color: var(--color-cream);
		font-family: var(--font-display); font-weight: 600; font-size: 0.82rem;
		border: 1px solid rgba(240,235,227,0.06); transition: all 0.2s ease;
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

	/* Star Rating Widget */
	.star-widget {
		display: flex; align-items: center; gap: 0.75rem;
		flex-wrap: wrap;
	}
	.star-row {
		display: inline-flex; gap: 0.15rem;
	}
	.star-btn {
		background: none; border: none; cursor: pointer;
		color: rgba(240,235,227,0.25);
		padding: 0.1rem;
		transition: color 0.15s ease, transform 0.15s ease;
	}
	.star-btn:hover { transform: scale(1.15); }
	.star-filled { color: var(--color-accent); }
	.star-aggregate {
		font-size: 0.72rem; color: var(--color-muted);
		font-weight: 500;
	}
	.star-cleared {
		font-size: 0.68rem; color: rgba(240,235,227,0.45);
		font-style: italic;
		animation: fadeInOut 2s ease forwards;
	}
	@keyframes fadeInOut {
		0% { opacity: 0; }
		15% { opacity: 1; }
		75% { opacity: 1; }
		100% { opacity: 0; }
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
		color: var(--color-cream); letter-spacing: -0.02em;
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
		background: transparent; color: var(--color-muted);
		border: none; transition: all 0.15s ease;
	}
	.scroll-arrow:not(:disabled):hover {
		background: var(--color-raised); color: var(--color-cream);
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
		color: var(--color-steel);
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
		border: 1px solid rgba(240,235,227,0.06);
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
		background: var(--color-surface); color: var(--color-muted);
		font-size: 0.78rem; font-weight: 500;
		border: 1px solid rgba(240,235,227,0.06);
		transition: all 0.2s ease; cursor: pointer;
	}
	.season-tab:hover {
		background: var(--color-raised);
		color: var(--color-cream);
		border-color: var(--color-muted);
	}
	.season-tab--active {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}
	.season-tab--active:hover {
		background: color-mix(in oklch, var(--color-accent) 85%, white);
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
		border: 1px solid rgba(240,235,227,0.06);
		transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@media (min-width: 640px)  { .epc { width: 16.5rem; } }
	@media (min-width: 1024px) { .epc { width: 18.5rem; } }

	.epc:hover {
		transform: translateY(-5px);
		border-color: color-mix(in oklch, var(--color-muted) 35%, rgba(240,235,227,0.06));
		box-shadow: 0 14px 44px rgba(0,0,0,0.55);
	}
	.epc:hover .epc__img {
		transform: scale(1.06); filter: brightness(1.12);
	}
	.epc--active {
		border-color: var(--color-accent);
		background: color-mix(in oklch, var(--color-accent) 5%, var(--color-surface));
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
		color: var(--color-steel);
	}

	/* Progress bar */
	.epc__bar {
		position: absolute; bottom: 0; left: 0; right: 0;
		height: 3px; background: rgba(255,255,255,0.08);
	}
	.epc__bar-fill {
		height: 100%; background: var(--color-accent); border-radius: 0 2px 0 0;
	}

	/* Info below thumb */
	.epc__info { padding: 0.55rem 0.7rem; }
	.epc__title {
		display: block;
		font-size: 0.78rem; font-weight: 500;
		color: var(--color-cream); line-height: 1.35;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.epc__desc {
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
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

	.cp { flex-shrink: 0; }

	.cp__card {
		position: relative; width: 5.5rem; height: 7.5rem;
		border-radius: 8px; overflow: hidden;
		border: 1px solid rgba(240,235,227,0.06);
		transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@media (min-width: 640px) { .cp__card { width: 6.5rem; height: 8.75rem; } }

	.cp:hover .cp__card {
		transform: translateY(-4px);
		border-color: rgba(240,235,227,0.15);
		box-shadow: 0 12px 36px rgba(0,0,0,0.5);
	}

	.cp__img {
		width: 100%; height: 100%; object-fit: cover;
	}

	.cp__fallback {
		width: 100%; height: 100%;
		display: flex; align-items: center; justify-content: center;
		background: var(--color-raised);
	}

	.cp__overlay {
		position: absolute; bottom: 0; left: 0; right: 0;
		padding: 0.4rem 0.45rem;
		background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%);
		display: flex; flex-direction: column; gap: 0.1rem;
	}

	.cp__name {
		font-size: 0.62rem; font-weight: 600;
		color: var(--color-cream); line-height: 1.2;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.cp__role {
		font-size: 0.52rem;
		color: rgba(240,235,227,0.55); line-height: 1.2;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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

	.sim { flex-shrink: 0; width: 8rem; }
	@media (min-width: 640px) { .sim { width: 9.5rem; } }

	.sim__poster {
		position: relative;
		overflow: hidden; border-radius: 8px;
		border: 1px solid rgba(240,235,227,0.06);
		transition: all 0.25s ease;
	}
	.sim:hover .sim__poster {
		border-color: color-mix(in oklch, var(--color-accent) 35%, transparent);
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
		color: var(--color-cream);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.sim__year { font-size: 0.62rem; color: var(--color-muted); }

	.sim__rating {
		position: absolute; bottom: 0.35rem; left: 0.35rem;
		padding: 0.1rem 0.35rem; border-radius: 4px;
		background: rgba(0,0,0,0.7); backdrop-filter: blur(6px);
		font-size: 0.58rem; font-weight: 600;
		color: var(--color-accent);
	}

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
		border: 1px solid rgba(240,235,227,0.06);
	}
	.game-info-label {
		font-size: 0.62rem; font-weight: 500;
		color: var(--color-muted); text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.game-info-value {
		font-size: 0.82rem; font-weight: 600;
		color: var(--color-cream);
	}

	.game-status { text-transform: capitalize; }
	.game-status--playing { color: var(--color-accent); }
	.game-status--finished { color: #4dd9c0; }
	.game-status--completed { color: #6bbd45; }
	.game-status--retired { color: #f59e0b; }
	.game-status--wishlist { color: #60a5fa; }

	/* ═══════════════════════════════════════
	   HLTB
	   ═══════════════════════════════════════ */
	.hltb-grid {
		display: flex; gap: 0.75rem; flex-wrap: wrap; /* legacy — unused after HltbDisplay component */
	}
	.hltb-card {
		display: flex; flex-direction: column; align-items: center;
		gap: 0.25rem; padding: 1rem 1.5rem;
		border-radius: 12px; background: var(--color-surface);
		border: 1px solid rgba(240,235,227,0.06);
		min-width: 7rem;
	}
	.hltb-time {
		font-family: var(--font-display);
		font-size: 1.25rem; font-weight: 800;
		color: var(--color-accent);
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
		border: 1px solid rgba(240,235,227,0.06);
	}
	.ra-badge--empty {
		display: flex; align-items: center; justify-content: center;
		background: var(--color-raised);
	}
	.ra-title {
		font-size: 0.65rem; font-weight: 600;
		color: var(--color-cream); line-height: 1.25;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
	}
	.ra-points {
		font-size: 0.55rem; font-weight: 700;
		color: #f59e0b;
	}
	.ra-desc {
		font-size: 0.58rem; color: var(--color-muted);
		line-height: 1.3;
		display: -webkit-box; -webkit-box-orient: vertical;
		-webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
	}
	.ra-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.5rem;
		margin-top: 0.75rem;
		max-height: 24rem;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-raised) transparent;
	}

	/* ═══════════════════════════════════════
	   GAME CONTROLS
	   ═══════════════════════════════════════ */
	.game-platform-badge {
		font-size: 0.68rem; font-weight: 600;
		padding: 0.25rem 0.65rem; border-radius: 100px;
		background: rgba(212,162,83,0.12);
		color: var(--color-accent);
		border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
	}
	.game-status-select {
		font-size: 0.75rem; font-weight: 500;
		padding: 0.3rem 0.6rem; border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-cream);
		border: 1px solid rgba(240,235,227,0.06);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.game-status-select:hover { border-color: var(--color-muted); }
	.game-status-select:focus { border-color: var(--color-accent); outline: none; }

	.game-fav-btn {
		display: flex; align-items: center; justify-content: center;
		width: 2rem; height: 2rem; border-radius: 50%;
		background: var(--color-surface); border: 1px solid rgba(240,235,227,0.06);
		color: var(--color-muted); cursor: pointer;
		transition: all 0.15s;
	}
	.game-fav-btn:hover { color: var(--color-warm); border-color: var(--color-warm); }
	.game-fav-btn--active { color: var(--color-warm); background: color-mix(in oklch, var(--color-warm) 12%, transparent); border-color: var(--color-warm); }

	.game-play-btn {
		display: inline-flex; align-items: center; gap: 0.375rem;
		padding: 0.375rem 0.875rem; border-radius: 8px;
		background: var(--color-accent, #6d28d9); color: #fff;
		font-size: 0.8125rem; font-weight: 600;
		text-decoration: none; cursor: pointer;
		transition: opacity 0.15s;
	}
	.game-play-btn:hover { opacity: 0.85; }

	.game-copy-btn {
		display: flex; align-items: center; justify-content: center;
		padding: 0.25rem; border-radius: 4px; color: var(--color-muted);
		transition: color 0.15s; cursor: pointer;
	}
	.game-copy-btn:hover { color: var(--color-cream); }

	.download-rom-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-cream);
		font-size: 0.78rem;
		font-weight: 500;
		border: 1px solid rgba(240, 235, 227, 0.08);
		text-decoration: none;
		transition: all 0.15s;
	}
	.download-rom-btn:hover {
		background: var(--color-raised);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* ═══════════════════════════════════════
	   GAME TABS
	   ═══════════════════════════════════════ */
	.game-tabs {
		display: flex; gap: 0.25rem;
		margin-bottom: 1rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 10px;
		border: 1px solid rgba(240,235,227,0.06);
	}
	.game-tab {
		flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.35rem;
		padding: 0.45rem 0.75rem; border-radius: 8px;
		font-size: 0.75rem; font-weight: 500;
		color: var(--color-muted); cursor: pointer;
		transition: all 0.15s; white-space: nowrap;
	}
	.game-tab:hover { color: var(--color-cream); }
	.game-tab--active {
		background: var(--color-raised);
		color: var(--color-cream);
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
	}
	.game-tab-count {
		font-size: 0.6rem; font-weight: 600;
		padding: 0.05rem 0.35rem; border-radius: 100px;
		background: rgba(212,162,83,0.12);
		color: var(--color-accent);
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
		border: 1px solid rgba(240,235,227,0.06);
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
		color: var(--color-cream);
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
		background: color-mix(in oklch, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}
	.save-type--sram {
		background: color-mix(in oklch, var(--color-steel) 15%, transparent);
		color: var(--color-steel);
	}

	.save-actions {
		display: flex; gap: 0.25rem;
		padding: 0.25rem 0.65rem 0.5rem;
	}
	.save-action-btn {
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; border-radius: 6px;
		border: 1px solid rgba(240,235,227,0.08);
		background: var(--color-raised); color: var(--color-muted);
		cursor: pointer; transition: all 0.15s;
	}
	.save-action-btn:hover { color: var(--color-cream); border-color: var(--color-muted); }
	.save-action-btn--danger:hover { color: #f87171; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); }
	.save-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.save-upload-btn {
		display: inline-flex; align-items: center; gap: 0.375rem;
		padding: 0.375rem 0.75rem; border-radius: 8px;
		border: 1px dashed rgba(240,235,227,0.15);
		background: transparent; color: var(--color-muted);
		font-size: 0.8125rem; cursor: pointer;
		transition: all 0.15s;
	}
	.save-upload-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

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
		border: 1px solid rgba(240,235,227,0.06);
		transition: border-color 0.2s;
	}
	.screenshot-card:hover { border-color: var(--color-muted); }
	.screenshot-card img {
		width: 100%; height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}
	.screenshot-card:hover img { transform: scale(1.03); }

	/* ═══════════════════════════════════════
	   VIDEO DETAIL LAYOUT
	   ═══════════════════════════════════════ */
	.video-detail {
		padding: 1rem 1.5rem 3rem;
		max-width: 1600px;
		margin: 0 auto;
	}
	.video-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}
	@media (min-width: 1024px) {
		.video-grid {
			grid-template-columns: 1fr 400px;
		}
	}
	.video-main {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.video-player-placeholder {
		aspect-ratio: 16 / 9;
		background: black;
		border-radius: 0.75rem;
		overflow: hidden;
		position: relative;
	}
	.player-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}
	.video-sidebar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	@media (min-width: 1024px) {
		.video-sidebar {
			position: sticky;
			top: 5rem;
			max-height: calc(100vh - 6rem);
			overflow-y: auto;
		}
	}

	/* BOOK STYLES */
	.book-series-nav {
		display: flex; align-items: center; justify-content: space-between; gap: 1rem;
		padding: 0.75rem 1rem; border-radius: 10px;
		background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
	}
	.book-series-label { font-size: 0.8rem; color: var(--color-muted); text-align: center; }
	.book-series-link {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.78rem; font-weight: 500; color: var(--color-accent); text-decoration: none;
		padding: 0.35rem 0.65rem; border-radius: 6px;
		background: rgba(212,162,83,0.06); border: 1px solid rgba(212,162,83,0.1);
		transition: background 0.2s, border-color 0.2s;
	}
	.book-series-link:hover { background: rgba(212,162,83,0.12); border-color: rgba(212,162,83,0.2); }
	.book-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.book-action-btn {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.5rem 1rem; border-radius: 8px;
		font-size: 0.78rem; font-weight: 500; color: var(--color-cream);
		background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
		cursor: pointer; transition: background 0.2s, border-color 0.2s; text-decoration: none;
	}
	.book-action-btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.1); }
	.book-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.book-action-btn--primary { background: rgba(212,162,83,0.12); border-color: rgba(212,162,83,0.2); color: var(--color-accent); }
	.book-action-btn--primary:hover { background: rgba(212,162,83,0.2); border-color: rgba(212,162,83,0.3); }
	.book-action-btn--read { color: var(--color-steel); border-color: rgba(61,143,132,0.2); background: rgba(61,143,132,0.08); }
	/* Format pills */
	.book-format-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.book-format-pill {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.375rem 0.75rem; border-radius: 9999px;
		font-size: 0.75rem; font-weight: 500; text-decoration: none;
		background: var(--color-surface, rgba(255,255,255,0.03));
		border: 1px solid rgba(255,255,255,0.08);
		color: var(--color-muted); transition: all 0.15s ease;
	}
	.book-format-pill:hover {
		border-color: rgba(212,162,83,0.2);
		color: var(--color-cream);
	}
	/* Reading progress */
	.book-progress-track {
		height: 6px; width: 100%; border-radius: 9999px;
		background: var(--color-surface, rgba(255,255,255,0.04));
	}
	.book-progress-fill {
		height: 100%; border-radius: 9999px;
		background: var(--color-accent);
		transition: width 0.3s ease;
	}
	.book-progress-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; }
	.book-continue-btn {
		display: inline-flex; align-items: center; gap: 0.5rem;
		padding: 0.625rem 1.25rem; border-radius: 12px;
		font-size: 0.82rem; font-weight: 500; text-decoration: none;
		background: var(--color-accent); color: var(--color-void, #0a0a12);
		transition: background 0.2s;
	}
	.book-continue-btn:hover { filter: brightness(1.1); }
	.book-meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; }
	.book-meta-card { padding: 0.65rem 0.85rem; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
	.book-meta-label { display: block; font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted); margin-bottom: 0.25rem; }
	.book-meta-value { display: block; font-size: 0.82rem; color: var(--color-cream); }
	.book-note-form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
	.book-note-input {
		width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px;
		background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
		color: var(--color-cream); font-size: 0.82rem; font-family: inherit;
		resize: vertical; min-height: 3.5rem; transition: border-color 0.2s;
	}
	.book-note-input:focus { outline: none; border-color: rgba(212,162,83,0.3); }
	.book-note-input::placeholder { color: var(--color-faint); }
	.book-notes-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.book-note-card { padding: 0.75rem 1rem; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
	.book-note-text { font-size: 0.82rem; color: var(--color-cream); line-height: 1.5; margin: 0; }
	.book-note-date { display: block; margin-top: 0.35rem; font-size: 0.68rem; color: var(--color-faint); }
	.book-annotations-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.book-highlight-card {
		padding: 0.75rem 1rem; border-radius: 8px;
		background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
		border-left: 3px solid var(--color-accent);
	}
	.book-annotation-meta {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.68rem; color: var(--color-faint);
	}
	.book-highlight-dot {
		display: inline-block; width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0;
	}
	.book-highlight-text { font-size: 0.82rem; color: var(--color-cream); line-height: 1.5; font-style: italic; margin: 0.35rem 0 0; }
	.book-highlight-note { margin: 0.35rem 0 0; font-size: 0.75rem; color: var(--color-muted); line-height: 1.4; }
	.book-bookmark-card {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.75rem 1rem; border-radius: 8px;
		background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
		font-size: 0.82rem; color: var(--color-muted);
	}
	.book-bookmark-icon { font-size: 0.9rem; }
	.book-bookmark-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* Series / Author scroll */
	.book-series-scroll {
		display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem;
		scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent;
	}
	.book-series-item {
		flex-shrink: 0; width: 5rem; text-align: center; text-decoration: none;
	}
	.book-series-item--current { opacity: 0.6; pointer-events: none; }
	.book-series-poster {
		aspect-ratio: 2/3; width: 100%; border-radius: 8px; overflow: hidden;
		background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
	}
	.book-series-poster img { width: 100%; height: 100%; object-fit: cover; }
	.book-series-empty { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
	.book-series-item--current .book-series-poster {
		outline: 2px solid var(--color-accent); outline-offset: 2px;
	}
	.book-series-name { margin-top: 0.25rem; font-size: 0.72rem; color: var(--color-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.book-series-idx { font-size: 0.65rem; color: var(--color-faint); margin: 0; }
	.sim--current { opacity: 0.5; pointer-events: none; }
	.sim--current .sim__poster { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: 8px; }
</style>
