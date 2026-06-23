<script lang="ts">
	import '$lib/styles/paper-ink.css';
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';

	let { data }: { data: PageData } = $props();

	let theme = $state<'light' | 'dark'>('light');
	const toggleTheme = () => (theme = theme === 'light' ? 'dark' : 'light');

	const PLAYABLE = new Set(['movie', 'episode', 'video']);
	const COLLECTION = new Set(['show', 'series', 'album']);
	const isPlayable = (i: { type?: string }) => PLAYABLE.has(i.type ?? '');
	const isCollection = (i: { type?: string }) => COLLECTION.has(i.type ?? '');
	const isOpenable = (i: { type?: string }) => isPlayable(i) || isCollection(i);

	type Ref = { serviceType: string; sourceId?: string; id: string; type?: string };
	function hrefFor(item: Ref): string | undefined {
		if (!isOpenable(item)) return undefined;
		const id = item.sourceId ?? item.id;
		const seg = isCollection(item) ? 'collection' : 'test-play';
		return `/${seg}/${encodeURIComponent(item.serviceType)}/${encodeURIComponent(id)}`;
	}
	const isSquare = (i: { type?: string }) => (i.type ?? '') === 'album' || (i.type ?? '') === 'music';
	const isLandscape = (i: { type?: string }) =>
		['episode', 'video', 'live'].includes(i.type ?? '');

	function typeLabel(t?: string): string {
		switch (t) {
			case 'movie':
				return 'Film';
			case 'show':
			case 'series':
				return 'Series';
			case 'episode':
				return 'Episode';
			case 'album':
				return 'Album';
			case 'music':
				return 'Music';
			case 'video':
				return 'Video';
			default:
				return '';
		}
	}
	const callNumber = (item: { year?: number }, i: number) =>
		`PN·${item.year ?? '----'}·${String(i + 1).padStart(3, '0')}`;
	const pct = (p?: number) => Math.max(0, Math.min(100, Math.round((p ?? 0) * 100)));

	const TYPES = [
		{ key: 'movies', label: 'Movies' },
		{ key: 'shows', label: 'Shows' },
		{ key: 'music', label: 'Music' },
		{ key: 'books', label: 'Books' },
		{ key: 'games', label: 'Games' }
	];

	const hero = $derived(data.hero as UnifiedMedia | null);
	const heroBg = $derived(hero?.backdrop ?? hero?.poster ?? '');
	const hideImg = (e: Event) => ((e.currentTarget as HTMLImageElement).style.display = 'none');
</script>

<svelte:head><title>{data.title} · Nexus</title></svelte:head>

<div class="pi-root lib" data-theme={theme}>
	<div class="grain"></div>
	<div class="app">
		<header class="topbar">
			<button class="icon-btn hamb" aria-label="Menu">☰</button>
			<a class="brand" href="/"><span class="brand-mark"></span><span>Nexus</span></a>
			<div class="search"><span>Search the archive…</span><span class="kbd">⌘K</span></div>
			<button class="icon-btn search-ic" aria-label="Search">⌕</button>
			<button class="icon-btn" aria-label="Theme" onclick={toggleTheme}>◐</button>
			<a class="avatar" href="/outpost.goauthentik.io/sign_out" aria-label="Sign out">P</a>
		</header>

		<div class="body">
			<nav class="rail">
				<div class="rail-group">
					<div class="rail-label">Libraries</div>
					{#each TYPES as t (t.key)}
						<a class="nav" class:active={data.type === t.key} href="/library/{t.key}">{t.label}</a>
					{/each}
				</div>
				<div class="rail-group">
					<div class="rail-label">Feeds</div>
					<a class="nav" class:active={data.type === 'videos'} href="/library/videos"
						>YouTube <span class="feed-dot"></span></a
					>
				</div>
				<div class="rail-group">
					<div class="rail-label">Yours</div>
					<a class="nav" href="/">Home</a>
				</div>
			</nav>

			<main class="main">
				<div class="typestrip">
					{#each TYPES as t (t.key)}
						<a class="tpill" class:on={data.type === t.key} href="/library/{t.key}">{t.label}</a>
					{/each}
					<a class="tpill" class:on={data.type === 'videos'} href="/library/videos">▷ YouTube</a>
				</div>

				<header class="masthead">
					<div class="mast-kicker">{data.title} Collection</div>
					<h1 class="mast-title">{data.title}</h1>
					<div class="mast-meta">
						{#if data.count}{data.count} entries · filed newest first{:else}awaiting catalog{/if}
					</div>
					<div class="mast-rule"></div>
				</header>

				{#if !data.hasBackend}
					<section class="empty">
						<div class="empty-mark">⌾</div>
						<div class="empty-title">No {data.title} library connected yet</div>
						<div class="empty-sub">Once a backend for this type is wired up, your catalog files in here.</div>
					</section>
				{:else if data.count === 0}
					<section class="empty">
						<div class="empty-mark">⌾</div>
						<div class="empty-title">Nothing filed here yet</div>
						<div class="empty-sub">This library is connected but came back empty.</div>
					</section>
				{:else}
					{#if hero}
						<section class="hero">
							<div
								class="hero-art"
								class:no-art={!heroBg}
								style={heroBg ? `background-image:url(${heroBg})` : ''}
							>
								<div class="hero-stamp">Now Showing</div>
								<div class="hero-body">
									<div class="hero-call">{callNumber(hero, 0)}</div>
									<div class="hero-title">{hero.title}</div>
									<div class="hero-sub">
										{typeLabel(hero.type)}{#if hero.year} · {hero.year}{/if}
									</div>
									<div class="hero-actions">
										{#if isPlayable(hero)}
											<a class="pill play-pill" href={hrefFor(hero)}>▶ {hero.progress ? 'Resume' : 'Play'}</a>
										{/if}
										{#if isOpenable(hero)}
											<a class="pill ghost-pill" href={hrefFor(hero)}>Details</a>
										{/if}
									</div>
								</div>
							</div>
						</section>
					{/if}

					{#if data.recentlyFiled.length}
						<section class="sec">
							<div class="sec-head">
								<span class="sec-label">Recently Filed</span>
								<span class="sec-tick"></span>
								<div class="sec-rule"></div>
								<span class="sec-count">last 30 days</span>
							</div>
							<div class="shelf">
								{#each data.recentlyFiled as item, i (item.id)}
									{@render card(item, i)}
								{/each}
							</div>
						</section>
					{/if}

					<section class="sec">
						<div class="sec-head">
							<span class="sec-label">The Catalog</span>
							<span class="sec-tick"></span>
							<div class="sec-rule"></div>
						</div>
						<div class="grid">
							{#each data.catalog as item, i (item.id)}
								{@render card(item, i)}
							{/each}
						</div>
					</section>
				{/if}
			</main>
		</div>

		<nav class="tabbar">
			<a class="tab" href="/"><span class="ic">⌂</span>Home</a>
			<a class="tab on" href="/library/movies"><span class="ic">▦</span>Library</a>
			<a class="tab" href="/"><span class="ic">⌕</span>Search</a>
			<a class="tab" href="/"><span class="ic">◷</span>You</a>
		</nav>
	</div>
</div>

{#snippet card(item: UnifiedMedia, i: number)}
	<a class="card" class:nonplay={!isOpenable(item)} href={hrefFor(item)}>
		<div class="poster" class:r-square={isSquare(item)} class:r-landscape={isLandscape(item)}>
			{#if item.poster}
				<img class="art" src={item.poster} alt={item.title} loading="lazy" decoding="async" onerror={hideImg} />
			{/if}
			<span class="call">{callNumber(item, i)}</span>
			{#if item.year}<span class="badge">{item.year}</span>{/if}
			{#if isPlayable(item)}<div class="play"><span class="pbtn">▶</span></div>{/if}
			{#if item.progress}<div class="progress"><i style="width:{pct(item.progress)}%"></i></div>{/if}
		</div>
		<div class="meta">
			<div class="title">{item.title}</div>
			<div class="cn">{callNumber(item, i)}</div>
		</div>
	</a>
{/snippet}

<style>
	.lib {
		height: 100vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.grain {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 50;
		opacity: 0.5;
		mix-blend-mode: multiply;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E");
	}
	.app {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.topbar {
		height: 56px;
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--s3);
		padding: 0 var(--s4);
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
	}
	.brand-mark {
		width: 18px;
		height: 18px;
		border-radius: 5px;
		background: var(--petal);
		box-shadow: inset 0 0 0 3px var(--bg), 0 0 0 1px var(--petal);
	}
	.search {
		flex: 1;
		max-width: 520px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: var(--s2);
		height: 36px;
		padding: 0 var(--s3);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-pill);
		color: var(--text-mute);
		background: var(--elev);
		font-size: 14px;
	}
	.search .kbd {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		border: 1px solid var(--rule-strong);
		border-radius: 6px;
		padding: 1px 6px;
	}
	.icon-btn {
		width: 34px;
		height: 34px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--rule-strong);
		background: transparent;
		color: var(--text-mute);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.avatar {
		width: 34px;
		height: 34px;
		border-radius: var(--radius-pill);
		background: var(--petal);
		color: var(--on-petal);
		display: grid;
		place-items: center;
		font-weight: 600;
		text-decoration: none;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.rail {
		width: 232px;
		flex: none;
		border-right: 1px solid var(--rule);
		padding: var(--s4) var(--s3);
		overflow-y: auto;
		background: var(--bg);
	}
	.rail-group {
		margin-bottom: var(--s5);
	}
	.rail-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-soft);
		font-weight: 600;
		padding: 0 var(--s3);
		margin-bottom: var(--s2);
	}
	.nav {
		display: flex;
		align-items: center;
		gap: var(--s3);
		height: 38px;
		padding: 0 var(--s3);
		border-radius: var(--radius-sm);
		color: var(--text-mute);
		cursor: pointer;
		font-weight: 500;
		text-decoration: none;
		transition:
			background var(--dur-base) var(--ease-standard),
			color var(--dur-base) var(--ease-standard);
	}
	.nav:hover {
		background: var(--surface);
		color: var(--text);
	}
	.nav.active {
		background: var(--petal-soft);
		color: var(--petal);
		font-weight: 600;
	}
	.feed-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--petal);
		margin-left: auto;
		opacity: 0.7;
	}

	.main {
		flex: 1;
		overflow-y: auto;
		padding: var(--s6) var(--s7) var(--s7);
	}

	.masthead {
		margin-bottom: var(--s5);
		animation: rise 0.5s var(--ease-emph-in) both;
	}
	.mast-kicker {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--petal);
		font-weight: 600;
		margin-bottom: var(--s2);
	}
	.mast-title {
		font-size: clamp(2.6rem, 6vw, 4.6rem);
		font-weight: 680;
		letter-spacing: -0.035em;
		line-height: 0.92;
	}
	.mast-meta {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-mute);
		margin-top: var(--s3);
	}
	.mast-rule {
		height: 2px;
		background: linear-gradient(90deg, var(--petal) 64px, var(--rule) 64px);
		margin-top: var(--s4);
	}

	.hero {
		margin-bottom: var(--s6);
		animation: rise 0.55s var(--ease-emph-in) 0.06s both;
	}
	.hero-art {
		position: relative;
		height: 300px;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1px solid var(--rule);
		display: flex;
		align-items: flex-end;
		background-size: cover;
		background-position: center;
	}
	.hero-art.no-art {
		background-image: linear-gradient(105deg, #7a3b1e, #b9612e 46%, #d68a3f);
	}
	.hero-art::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(75deg, rgba(13, 12, 11, 0.85) 0%, rgba(13, 12, 11, 0.5) 40%, transparent 70%);
	}
	.hero-stamp {
		position: absolute;
		top: var(--s4);
		right: var(--s4);
		z-index: 2;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--on-petal);
		background: var(--petal);
		padding: 6px 12px;
		border-radius: 6px;
		transform: rotate(2.5deg);
		box-shadow: 0 4px 14px -4px rgba(188, 86, 56, 0.7);
	}
	.hero-body {
		position: relative;
		z-index: 2;
		padding: var(--s6);
		max-width: 560px;
		color: #fff;
	}
	.hero-call {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.12em;
		color: #f3c9bd;
		margin-bottom: var(--s2);
	}
	.hero-title {
		font-size: clamp(2rem, 4vw, 3rem);
		font-weight: 660;
		letter-spacing: -0.03em;
		line-height: 1;
		margin-bottom: var(--s2);
	}
	.hero-sub {
		font-family: var(--font-mono);
		font-size: 13px;
		color: #e7e2dc;
		margin-bottom: var(--s4);
	}
	.hero-actions {
		display: flex;
		gap: var(--s2);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		height: 42px;
		padding: 0 var(--s4);
		border-radius: var(--radius-pill);
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		border: 0;
		text-decoration: none;
	}
	.play-pill {
		background: var(--petal);
		color: #fff;
		box-shadow: 0 8px 22px -8px rgba(188, 86, 56, 0.8);
	}
	.ghost-pill {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.35);
		backdrop-filter: blur(6px);
	}

	.sec {
		margin-bottom: var(--s6);
	}
	.sec-head {
		display: flex;
		align-items: center;
		gap: var(--s3);
		margin-bottom: var(--s4);
	}
	.sec-label {
		font-size: 18px;
		font-weight: 620;
		letter-spacing: -0.01em;
		flex: none;
	}
	.sec-tick {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--petal);
		flex: none;
	}
	.sec-rule {
		flex: 1;
		height: 1px;
		background: var(--rule-strong);
	}
	.sec-count {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-mute);
		flex: none;
	}

	.shelf {
		display: flex;
		gap: var(--s3);
		overflow-x: auto;
		padding-bottom: var(--s2);
		scrollbar-width: none;
	}
	.shelf::-webkit-scrollbar {
		display: none;
	}
	.shelf .card {
		flex: none;
		width: 184px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(152px, 1fr));
		gap: var(--s5) var(--s3);
	}
	.card {
		cursor: pointer;
		text-decoration: none;
		color: inherit;
		display: block;
		animation: rise 0.5s var(--ease-standard) both;
	}
	.card.nonplay {
		cursor: default;
	}
	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--rule);
		background: linear-gradient(155deg, var(--surface), var(--elev));
		transition:
			transform var(--dur-base) var(--ease-standard),
			box-shadow var(--dur-base) var(--ease-standard);
	}
	.poster.r-square {
		aspect-ratio: 1 / 1;
	}
	.poster.r-landscape {
		aspect-ratio: 16 / 9;
	}
	.card:hover .poster {
		transform: translateY(-4px);
		box-shadow: 0 14px 30px -14px rgba(0, 0, 0, 0.4);
	}
	.art {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.call {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: #fff;
		background: rgba(13, 12, 11, 0.5);
		padding: 2px 7px;
		border-radius: 5px;
		backdrop-filter: blur(4px);
	}
	.badge {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #fff;
		background: rgba(13, 12, 11, 0.5);
		padding: 2px 6px;
		border-radius: 5px;
		backdrop-filter: blur(4px);
	}
	.play {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-items: center;
		opacity: 0;
		transition: opacity var(--dur-base) var(--ease-standard);
		background: linear-gradient(0deg, rgba(13, 12, 11, 0.5), transparent 60%);
	}
	.card:hover .play {
		opacity: 1;
	}
	.pbtn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--petal);
		color: #fff;
		display: grid;
		place-items: center;
		box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.5);
	}
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 1;
		height: 3px;
		background: rgba(255, 255, 255, 0.28);
	}
	.progress i {
		display: block;
		height: 100%;
		background: var(--petal);
	}
	.meta {
		padding: var(--s2) 2px 0;
	}
	.title {
		font-size: 13.5px;
		font-weight: 560;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cn {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-mute);
		margin-top: 1px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--s2);
		padding: var(--s7) var(--s4);
		color: var(--text-mute);
	}
	.empty-mark {
		font-size: 40px;
		color: var(--petal);
		opacity: 0.8;
	}
	.empty-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--text);
	}
	.empty-sub {
		font-size: 14px;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.typestrip,
	.tabbar,
	.hamb,
	.search-ic {
		display: none;
	}

	@media (max-width: 720px) {
		.topbar {
			padding: 0 var(--s3);
			gap: var(--s2);
		}
		.hamb {
			display: grid;
		}
		.search {
			display: none;
		}
		.search-ic {
			display: grid;
		}
		.rail {
			display: none;
		}
		.main {
			padding: var(--s4) var(--s3) 80px;
		}
		.mast-title {
			font-size: clamp(2.2rem, 11vw, 3rem);
		}
		.hero-art {
			height: 230px;
		}
		.hero-body {
			padding: var(--s4);
		}
		.typestrip {
			display: flex;
			gap: var(--s2);
			overflow-x: auto;
			margin: 0 calc(-1 * var(--s3)) var(--s4);
			padding: 0 var(--s3) var(--s2);
			scrollbar-width: none;
		}
		.typestrip::-webkit-scrollbar {
			display: none;
		}
		.tpill {
			flex: none;
			height: 34px;
			padding: 0 var(--s3);
			border-radius: var(--radius-pill);
			border: 1px solid var(--rule-strong);
			background: transparent;
			color: var(--text-mute);
			font-size: 13px;
			font-weight: 550;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			text-decoration: none;
		}
		.tpill.on {
			background: var(--petal);
			border-color: transparent;
			color: var(--on-petal);
		}
		.grid {
			grid-template-columns: repeat(2, 1fr);
			gap: var(--s4) var(--s2);
		}
		.tabbar {
			display: flex;
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 40;
			height: 62px;
			background: var(--bg);
			border-top: 1px solid var(--rule);
			padding-bottom: env(safe-area-inset-bottom);
		}
		.tab {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			color: var(--text-soft);
			font-size: 11px;
			font-weight: 500;
			text-decoration: none;
		}
		.tab .ic {
			font-size: 18px;
		}
		.tab.on {
			color: var(--petal);
		}
	}
</style>
