<script lang="ts">
	// Nexus Home — paper+ink reimplementation (DEV demo route).
	// Ports the imported "Nexus Home.dc.html" mock onto the canonical PetalNet
	// design system (homelab-docs/DESIGN.md): paper/ink themes, burnt-sienna --petal,
	// Geist, 8pt grid, borders-banned, lucide-only, spec-correct weight/tracking.
	// Self-contained for review; promoted into proper components once approved.
	import '$lib/styles/paper-ink.css';
	import {
		Menu, Search, Sun, Moon, House, Film, Tv, BookOpen, Gamepad2, Rss,
		Sparkles, Clock, Heart, BarChart3, Play
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	type IconType = typeof House;

	let railOpen = $state(true);
	let theme = $state<'light' | 'dark'>('dark');
	let activeNav = $state(0);

	onMount(() => {
		const saved = localStorage.getItem('petalnet-theme');
		if (saved === 'light' || saved === 'dark') theme = saved;
		else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
	});

	function toggleTheme() {
		// §7 — flash-free instant cut: suspend transitions, flip, reflow, resume.
		const root = document.documentElement;
		root.classList.add('no-theme-transition');
		theme = theme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('petalnet-theme', theme);
		void root.offsetWidth;
		requestAnimationFrame(() => root.classList.remove('no-theme-transition'));
	}

	const dateline = $derived.by(() => {
		const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const now = new Date();
		const h = now.getHours();
		const ap = h < 12 ? 'AM' : 'PM';
		const h12 = ((h + 11) % 12) + 1;
		return `${days[now.getDay()]} · ${h12}:${String(now.getMinutes()).padStart(2, '0')} ${ap}`;
	});

	const nav: { icon: IconType; label: string }[] = [
		{ icon: House, label: 'Home' }, { icon: Film, label: 'Movies' }, { icon: Tv, label: 'Shows' },
		{ icon: BookOpen, label: 'Books' }, { icon: Gamepad2, label: 'Games' }, { icon: Rss, label: 'Subs' }
	];
	const explore: { icon: IconType; label: string }[] = [
		{ icon: Sparkles, label: 'New tonight' }, { icon: Clock, label: 'History' },
		{ icon: Heart, label: 'Favorites' }, { icon: BarChart3, label: 'Stats' }
	];
	const channels = [
		{ initial: 'W', name: 'Workbench', color: '#7A3B2E', fresh: true },
		{ initial: 'A', name: 'Aperture', color: '#2E4756', fresh: true },
		{ initial: 'F', name: 'Foundry', color: '#3A4A38', fresh: false },
		{ initial: 'D', name: 'Drift', color: '#4A3A5C', fresh: true },
		{ initial: 'S', name: 'Solo Ascent', color: '#6B5536', fresh: false }
	];
	const services = [
		{ name: 'Jellyfin', dot: 'var(--success)' }, { name: 'Plex', dot: 'var(--success)' },
		{ name: 'Audiobookshelf', dot: 'var(--success)' }, { name: 'Invidious', dot: 'var(--warning)' }
	];
	const A = ['#2E4756', '#7A3B2E', '#3A4A38', '#4A3A5C', '#2C3E50', '#6B5536', '#1F4D45', '#5C3A3A', '#37415C', '#46523A', '#5A2E3E', '#264653'];

	// §8: no em dashes in UI strings — the mock's hero desc used one; swapped to a colon.
	const hero = {
		source: 'Invidious', kind: 'Subscription · Workbench',
		title: 'Restoring a 1970s film projector',
		desc: 'Part three: re-spooling the take-up reel and first power-on after the rebuild.',
		left: '8 min left', progress: '80%', art: A[0]
	};
	const resumeRail: { title: string; meta: string; progress: string; source: string; art: string; icon: IconType }[] = [
		{ title: 'Dracula', meta: 'Jellyfin · 22 min left', progress: '68%', source: 'Jellyfin', art: A[1], icon: Film },
		{ title: 'Pioneer One', meta: 'Plex · S1:E1 · 38 min', progress: '15%', source: 'Plex', art: A[2], icon: Tv },
		{ title: 'The Pragmatic Lab', meta: 'Audiobookshelf · ch. 6', progress: '52%', source: 'ABS', art: A[5], icon: BookOpen },
		{ title: 'The science of slow film', meta: 'Invidious · 12 min left', progress: '30%', source: 'Invidious', art: A[4], icon: Play },
		{ title: 'Sahara', meta: 'Jellyfin · 41 min left', progress: '47%', source: 'Jellyfin', art: A[7], icon: Film }
	];
	const recommend: { title: string; meta: string; source: string; art: string; icon: IconType }[] = [
		{ title: 'King Lear', meta: 'Jellyfin · 1953', source: 'Jellyfin', icon: Film, art: A[8] },
		{ title: 'One mountain, no edits', meta: 'Solo Ascent · 28 min', source: 'Invidious', icon: Play, art: A[9] },
		{ title: 'Sintel', meta: 'Plex · 2010', source: 'Plex', icon: Tv, art: A[10] },
		{ title: '48 hours in the quietest town', meta: 'Far Field · 24 min', source: 'Invidious', icon: Play, art: A[11] },
		{ title: 'Night of the Living Dead', meta: 'Jellyfin · 1968', source: 'Jellyfin', icon: Film, art: A[0] },
		{ title: 'Deep Work', meta: 'Audiobookshelf · 7h', source: 'ABS', icon: BookOpen, art: A[3] },
		{ title: 'A slow morning in Kyoto', meta: 'Drift · 45 min', source: 'Invidious', icon: Play, art: A[2] },
		{ title: 'Big Buck Bunny', meta: 'Plex · 2008', source: 'Plex', icon: Tv, art: A[6] }
	];
</script>

<svelte:head><title>Nexus · Tonight</title></svelte:head>

<div class="pi-root" data-theme={theme} style="height:100vh; overflow:hidden; display:flex; flex-direction:column;">
	<!-- TOP BAR -->
	<header class="topbar">
		<button class="icon-btn" aria-label="Toggle menu" onclick={() => (railOpen = !railOpen)}>
			<Menu size={22} strokeWidth={1.8} />
		</button>
		<div class="brand">
			<span class="brand-mark"></span>
			<span class="brand-name">Nexus</span>
		</div>
		<div class="search-wrap">
			<label class="search">
				<Search size={18} strokeWidth={1.8} />
				<input placeholder="Search your whole library and feeds" />
				<span class="kbd mono">⌘K</span>
			</label>
		</div>
		<button class="icon-btn outlined" aria-label="Toggle theme" onclick={toggleTheme}>
			{#if theme === 'dark'}<Sun size={18} strokeWidth={1.8} />{:else}<Moon size={18} strokeWidth={1.8} />{/if}
		</button>
		<div class="avatar">P</div>
	</header>

	<div style="display:flex; flex:1; min-height:0;">
		<!-- LEFT RAIL -->
		<nav class="rail" class:closed={!railOpen} style="width:{railOpen ? '232px' : '72px'};">
			{#each nav as item, i}
				{@const Icon = item.icon}
				<button class="rail-item" class:active={i === activeNav} onclick={() => (activeNav = i)}>
					<span class="rail-icon"><Icon size={22} strokeWidth={2} /></span>
					{#if railOpen}<span class="rail-label">{item.label}</span>{/if}
				</button>
			{/each}

			<div class="rail-sep"></div>
			{#if railOpen}<div class="rail-section">Discover</div>{/if}
			{#each explore as item}
				{@const Icon = item.icon}
				<button class="rail-item">
					<span class="rail-icon muted"><Icon size={21} strokeWidth={2} /></span>
					{#if railOpen}<span class="rail-label">{item.label}</span>{/if}
				</button>
			{/each}

			<div class="rail-sep"></div>
			{#if railOpen}<div class="rail-section">Subscriptions</div>{/if}
			{#each channels as ch}
				<button class="rail-item channel">
					<span class="ch-avatar" style="background:{ch.color};">
						{ch.initial}
						{#if ch.fresh && !railOpen}<span class="fresh-badge"></span>{/if}
					</span>
					{#if railOpen}<span class="rail-label ch-name">{ch.name}</span>{/if}
					{#if railOpen && ch.fresh}<span class="fresh-dot"></span>{/if}
				</button>
			{/each}

			{#if railOpen}
				<div class="rail-sep"></div>
				<div class="rail-section">Services</div>
				{#each services as s}
					<div class="rail-service">
						<span class="svc-dot" style="background:{s.dot};"></span>
						<span class="svc-name">{s.name}</span>
					</div>
				{/each}
			{/if}
		</nav>

		<!-- MAIN — Tonight -->
		<main class="main">
			<div class="main-inner">
				<div class="eyebrow-row">
					<h1 class="eyebrow mono">Tonight</h1>
					<span class="dateline">{dateline}</span>
				</div>
				<p class="lede">One thread through everything you're hosting, newest and nearest to done first.</p>

				<!-- HERO -->
				<button class="hero pi-settle" style="--art:{hero.art};">
					<div class="hero-scrim"></div>
					<div class="hero-body">
						<div class="hero-tags">
							<span class="hero-source mono"><span class="live-dot"></span>{hero.source}</span>
							<span class="hero-kind mono">{hero.kind}</span>
						</div>
						<h2 class="hero-title">{hero.title}</h2>
						<p class="hero-desc">{hero.desc}</p>
						<div class="hero-actions">
							<span class="btn-play"><Play size={16} strokeWidth={2} fill="currentColor" /> Resume · {hero.left}</span>
							<div class="hero-prog">
								<div class="prog-track"><div class="prog-fill" style="width:{hero.progress};"></div></div>
								<span class="prog-label mono">{hero.progress} watched</span>
							</div>
						</div>
					</div>
				</button>

				<!-- CONTINUE -->
				<div class="row-head"><h3>Continue</h3><span class="row-sub">all services, one queue</span></div>
				<div class="hrail">
					{#each resumeRail as c}
						{@const Icon = c.icon}
						<button class="vcard pi-settle wide">
							<div class="art" style="background:{c.art};">
								<span class="art-icon"><Icon size={30} strokeWidth={2} /></span>
								<span class="art-source mono">{c.source}</span>
								<span class="art-play"><Play size={18} strokeWidth={2} fill="var(--on-petal)" /></span>
								<div class="art-prog"><div class="art-prog-fill" style="width:{c.progress};"></div></div>
							</div>
							<div class="vc-title">{c.title}</div>
							<div class="vc-meta">{c.meta}</div>
						</button>
					{/each}
				</div>

				<!-- PICKS -->
				<div class="row-head"><h3>Picked for tonight</h3><span class="row-sub">library + subscriptions, blended</span></div>
				<div class="grid">
					{#each recommend as c}
						{@const Icon = c.icon}
						<button class="vcard pi-settle">
							<div class="art" style="background:{c.art};">
								<span class="art-icon"><Icon size={28} strokeWidth={2} /></span>
								<span class="art-source mono">{c.source}</span>
								<span class="art-play"><Play size={17} strokeWidth={2} fill="var(--on-petal)" /></span>
							</div>
							<div class="vc-title">{c.title}</div>
							<div class="vc-meta">{c.meta}</div>
						</button>
					{/each}
				</div>
			</div>
		</main>
	</div>
</div>

<style>
	/* ── Top bar ── */
	.topbar {
		height: 56px; flex: none; display: flex; align-items: center; gap: var(--s3);
		padding: 0 18px; border-bottom: 1px solid var(--rule); background: var(--bg); z-index: 30;
	}
	.icon-btn {
		width: 40px; height: 40px; flex: none; border: none; border-radius: var(--radius-sm);
		background: transparent; color: var(--text); cursor: pointer;
		display: flex; align-items: center; justify-content: center; transition: var(--t);
	}
	.icon-btn:hover { background: var(--petal-soft); }
	.icon-btn.outlined { color: var(--text-mute); }
	.icon-btn.outlined:hover { color: var(--text); }
	.icon-btn:active { transform: scale(0.94); }
	.brand { display: flex; align-items: center; gap: 9px; }
	.brand-mark {
		width: 24px; height: 24px; border-radius: 7px; background: var(--petal);
		display: flex; align-items: center; justify-content: center; position: relative;
	}
	.brand-mark::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--on-petal); }
	.brand-name { font-size: 18px; font-weight: 500; }
	.search-wrap { flex: 1; display: flex; justify-content: center; }
	.search {
		width: 100%; max-width: 520px; display: flex; align-items: center; gap: 10px;
		height: 42px; padding: 0 14px; border-radius: var(--radius-sm); background: var(--surface);
		color: var(--text-soft); transition: var(--t);
	}
	.search:focus-within { outline: 1.5px solid var(--petal); outline-offset: -1.5px; }
	.search input {
		flex: 1; border: none; outline: none; background: transparent; color: var(--text);
		font-family: inherit; font-size: 14px;
	}
	.search input::placeholder { color: var(--text-soft); }
	.kbd {
		font-size: 11px; font-weight: 500; color: var(--text-soft);
		background: var(--bg); border-radius: var(--radius-xs); padding: 2px 6px;
	}
	.avatar {
		width: 34px; height: 34px; flex: none; border-radius: 50%; background: var(--surface);
		display: flex; align-items: center; justify-content: center;
		font-size: 13px; font-weight: 500; color: var(--text-mute); cursor: pointer;
	}

	/* ── Rail ── */
	.rail {
		flex: none; border-right: 1px solid var(--rule); padding: var(--s2);
		overflow-y: auto; overflow-x: hidden; transition: width var(--dur-base) var(--ease-standard);
	}
	.rail-item {
		width: 100%; height: 40px; display: flex; align-items: center; gap: 18px;
		padding: 0 14px; border: none; border-radius: var(--radius-sm); background: transparent;
		color: var(--text); font-family: inherit; font-size: 14px; font-weight: 400;
		cursor: pointer; margin-bottom: 2px; white-space: nowrap; transition: var(--t);
	}
	.rail.closed .rail-item { height: 46px; justify-content: center; padding: 0; gap: 0; }
	.rail-item:hover { background: var(--petal-soft); }
	.rail-item.active { background: var(--petal-soft); color: var(--petal); font-weight: 500; }
	.rail-icon { flex: none; display: flex; }
	.rail-icon.muted { color: var(--text-mute); }
	.rail-item.active .rail-icon { color: var(--petal); }
	.rail-label { overflow: hidden; text-overflow: ellipsis; }
	.rail-sep { height: 1px; background: var(--rule); margin: var(--s2) var(--s2); }
	.rail-section {
		padding: 6px 14px 8px; font-size: 13px; font-weight: 500; color: var(--text-mute); white-space: nowrap;
	}
	.ch-avatar {
		width: 26px; height: 26px; flex: none; border-radius: 50%; display: flex;
		align-items: center; justify-content: center; font-weight: 500; font-size: 11px;
		color: #fff; position: relative;
	}
	.channel .rail-label { flex: 1; text-align: left; }
	.fresh-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--petal); }
	.fresh-badge {
		position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; border-radius: 50%;
		background: var(--petal); border: 2px solid var(--bg);
	}
	.rail-service { width: 100%; height: 36px; display: flex; align-items: center; gap: 14px; padding: 0 14px; white-space: nowrap; }
	.svc-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; }
	.svc-name { font-size: 13px; color: var(--text-mute); overflow: hidden; text-overflow: ellipsis; }

	/* ── Main ── */
	.main { flex: 1; min-width: 0; overflow-y: auto; }
	.main-inner { max-width: 1120px; margin: 0 auto; padding: var(--s5) var(--s5) var(--s7); }
	.eyebrow-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
	.eyebrow {
		font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
		color: var(--petal); margin: 0;
	}
	.dateline { font-size: 13px; color: var(--text-soft); }
	.lede { font-size: 14px; color: var(--text-mute); margin: 0 0 var(--s4); text-wrap: balance; }

	/* ── Hero (media surface — functional legibility scrim allowed) ── */
	.hero {
		position: relative; width: 100%; border: none; border-radius: var(--radius-lg); overflow: hidden;
		background: var(--art); min-height: 320px; display: flex; align-items: flex-end;
		margin-bottom: var(--s5); cursor: pointer; text-align: left; padding: 0;
	}
	.hero-scrim { position: absolute; inset: 0; background: linear-gradient(110deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.4) 48%, rgba(0,0,0,0) 80%); }
	.hero-body { position: relative; padding: 36px 38px; max-width: 580px; }
	.hero-tags { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; }
	.hero-source {
		display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 500; color: #fff;
		background: rgba(0,0,0,0.45); border-radius: var(--radius-xs); padding: 3px 8px;
	}
	.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--petal); animation: pulse 1.8s ease-in-out infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.82); } }
	.hero-kind { font-size: 10px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(255,255,255,0.75); }
	.hero-title { font-size: clamp(28px, 4vw, 38px); font-weight: 500; letter-spacing: -0.012em; color: #fff; margin: 0 0 8px; line-height: 1.06; text-wrap: balance; }
	.hero-desc { font-size: 14px; color: rgba(255,255,255,0.82); margin: 0 0 20px; line-height: 1.5; }
	.hero-actions { display: flex; align-items: center; gap: 14px; }
	.btn-play {
		display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 24px 0 19px;
		border-radius: var(--radius); background: var(--petal); color: var(--on-petal);
		font-size: 14px; font-weight: 500; transition: var(--t);
	}
	.hero:hover .btn-play { filter: brightness(1.06); }
	.hero-prog { display: flex; flex-direction: column; gap: 5px; flex: 1; max-width: 220px; }
	.prog-track { height: 4px; border-radius: 3px; background: rgba(255,255,255,0.25); }
	.prog-fill { height: 100%; border-radius: 3px; background: #fff; }
	.prog-label { font-size: 10px; color: rgba(255,255,255,0.6); }

	/* ── Rows / cards ── */
	.row-head { display: flex; align-items: baseline; margin-bottom: 14px; }
	.row-head h3 { font-size: 14px; font-weight: 500; margin: 0; }
	.row-sub { margin-left: 10px; font-size: 12px; color: var(--text-soft); }
	.hrail { display: flex; gap: var(--s3); overflow-x: auto; padding-bottom: 10px; margin-bottom: var(--s5); }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 18px 16px; }
	.vcard { border: none; background: transparent; padding: 0; cursor: pointer; text-align: left; font-family: inherit; }
	.vcard.wide { flex: none; width: 264px; }
	.art {
		position: relative; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden;
		display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.3);
		box-shadow: inset 0 -40px 50px -24px rgba(0,0,0,0.5); transition: var(--t);
	}
	.vcard:hover .art { outline: 2px solid var(--petal); outline-offset: 2px; }
	.art-icon { display: flex; }
	.art-source {
		position: absolute; top: 9px; left: 9px; font-size: 10px; font-weight: 500; color: #fff;
		background: rgba(0,0,0,0.5); border-radius: var(--radius-xs); padding: 3px 7px;
	}
	.art-play {
		position: absolute; width: 46px; height: 46px; border-radius: 50%; background: var(--petal);
		display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px rgba(0,0,0,0.45);
		opacity: 0; transform: scale(0.8); transition: opacity var(--dur-fast) ease, transform var(--dur-fast) ease;
	}
	.vcard:hover .art-play { opacity: 1; transform: scale(1); }
	.art-prog { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: rgba(255,255,255,0.25); }
	.art-prog-fill { height: 100%; background: var(--petal); }
	.vc-title {
		margin-top: 9px; font-size: 13.5px; font-weight: 500; line-height: 1.25;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.vc-meta { font-size: 12.5px; color: var(--text-mute); }

	@media (max-width: 640px) {
		.search-wrap { display: none; }
	}
</style>
