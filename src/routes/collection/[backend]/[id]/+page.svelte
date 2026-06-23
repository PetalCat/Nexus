<script lang="ts">
	import '$lib/styles/paper-ink.css';
	import { goto } from '$app/navigation';
	import { ArrowLeft, Play, ImageIcon, ListVideo } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Child = PageData['children'][number] & {
		posterUrl?: string;
		backdropUrl?: string;
	};
	type Item = NonNullable<PageData['item']> & { posterUrl?: string; backdropUrl?: string };

	let theme = $state<'light' | 'dark'>('dark');
	onMount(() => {
		const saved = localStorage.getItem('petalnet-theme');
		if (saved === 'light' || saved === 'dark') theme = saved;
		else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
	});

	const item = $derived((data.item as Item | null) ?? undefined);
	const children = $derived(data.children as Child[]);

	const TYPE_LABEL: Record<string, string> = {
		movie: 'Movie', episode: 'Episode', series: 'Series', show: 'Series',
		season: 'Season', video: 'Video', album: 'Album', music: 'Track', audio: 'Audio'
	};
	function typeLabel(type?: string) {
		return TYPE_LABEL[type ?? ''] ?? '';
	}

	const PLAYABLE_TYPES = new Set(['movie', 'episode', 'video']);
	function isPlayable(c: { type?: string }) {
		return PLAYABLE_TYPES.has(c.type ?? '');
	}

	function poster(c: Child | Item | undefined) {
		return c?.posterUrl ?? c?.poster ?? c?.thumb ?? c?.backdrop;
	}
	function art(i: Item | undefined) {
		return i?.backdropUrl ?? i?.backdrop ?? i?.posterUrl ?? i?.poster ?? i?.thumb;
	}

	function play(c: Child) {
		if (!isPlayable(c)) return;
		const id = c.sourceId ?? c.id;
		goto(`/test-play/${encodeURIComponent(data.backend)}/${encodeURIComponent(id)}`);
	}

	const playableCount = $derived(children.filter(isPlayable).length);
</script>

<svelte:head><title>{item?.title ?? 'Collection'} · Nexus</title></svelte:head>

<div class="pi-root" data-theme={theme} style="min-height:100vh;">
	<header class="hdr" class:has-art={!!art(item)} style:background-image={art(item) ? `url("${art(item)}")` : undefined}>
		<div class="hdr-scrim"></div>
		<div class="hdr-inner">
			<a class="back" href="/" aria-label="Back to home"><ArrowLeft size={18} strokeWidth={2} /> Home</a>
			<div class="hdr-body">
				<div class="hdr-poster">
					{#if poster(item)}
						<img src={poster(item)} alt={item?.title} onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
					{:else}
						<span class="ph"><ListVideo size={30} strokeWidth={1.8} /></span>
					{/if}
				</div>
				<div class="hdr-text">
					<span class="kind mono">{typeLabel(item?.type) || 'Collection'}{#if item?.year} · {item.year}{/if}</span>
					<h1>{item?.title ?? 'Collection'}</h1>
					<span class="count">{children.length} {children.length === 1 ? 'item' : 'items'}{#if playableCount && playableCount !== children.length} · {playableCount} playable{/if}</span>
					{#if item?.description}<p class="desc">{item.description}</p>{/if}
				</div>
			</div>
		</div>
	</header>

	<main class="body">
		{#if children.length === 0}
			<div class="empty">Nothing in this collection.</div>
		{:else}
			<ol class="list">
				{#each children as c, i (c.id)}
					<li>
						<button class="row" class:nonplay={!isPlayable(c)} onclick={() => play(c)} aria-label={isPlayable(c) ? `Play ${c.title}` : c.title}>
							<span class="idx mono">{i + 1}</span>
							<span class="thumb">
								{#if poster(c)}
									<img src={poster(c)} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
								{:else}
									<ImageIcon size={16} strokeWidth={2} />
								{/if}
								{#if isPlayable(c)}<span class="thumb-play"><Play size={15} strokeWidth={2} fill="var(--on-petal)" /></span>{/if}
							</span>
							<span class="meta">
								<span class="title">{c.title}</span>
								<span class="sub">{typeLabel(c.type)}{#if typeLabel(c.type) && c.year} · {/if}{#if c.year}{c.year}{/if}</span>
							</span>
							{#if isPlayable(c)}<span class="go"><Play size={14} strokeWidth={2} fill="currentColor" /></span>{/if}
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</main>
</div>

<style>
	.hdr {
		position: relative; background: var(--surface); background-size: cover; background-position: center 20%;
		border-bottom: 1px solid var(--rule);
	}
	.hdr.has-art { min-height: 280px; }
	.hdr-scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.35), var(--bg) 96%); }
	.hdr.has-art .hdr-text .kind, .hdr.has-art .hdr-text h1, .hdr.has-art .hdr-text .count { color: #fff; }
	.hdr-inner { position: relative; max-width: 1000px; margin: 0 auto; padding: var(--s4) var(--s5) var(--s5); }
	.back {
		display: inline-flex; align-items: center; gap: 7px; color: var(--text-mute); text-decoration: none;
		font-size: 13px; padding: 7px 11px 7px 8px; border-radius: var(--radius-pill); background: var(--bg);
		transition: var(--t);
	}
	.back:hover { color: var(--text); background: var(--elev); }
	.hdr-body { display: flex; align-items: flex-end; gap: var(--s4); margin-top: var(--s4); }
	.hdr-poster {
		flex: none; width: 132px; aspect-ratio: 2/3; border-radius: var(--radius); overflow: hidden;
		background: var(--elev); box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: var(--text-soft);
	}
	.hdr-poster img { width: 100%; height: 100%; object-fit: cover; }
	.hdr-text { min-width: 0; padding-bottom: 4px; }
	.kind { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--petal); }
	.hdr-text h1 { font-size: clamp(24px, 4vw, 36px); font-weight: 500; letter-spacing: -0.015em; margin: 6px 0 8px; line-height: 1.05; }
	.count { font-size: 13px; color: var(--text-mute); }
	.desc { font-size: 14px; color: var(--text-mute); margin: 12px 0 0; max-width: 60ch; line-height: 1.5; }

	.body { max-width: 1000px; margin: 0 auto; padding: var(--s4) var(--s5) var(--s7); }
	.empty { padding: var(--s6); text-align: center; color: var(--text-soft); }
	.list { list-style: none; margin: 0; padding: 0; }
	.row {
		width: 100%; display: flex; align-items: center; gap: var(--s3); padding: 8px 10px;
		border: none; background: transparent; border-radius: var(--radius); cursor: pointer; text-align: left;
		font-family: inherit; color: var(--text); transition: background var(--dur-fast) ease;
	}
	.row:hover { background: var(--surface); }
	.row.nonplay { cursor: default; }
	.row.nonplay:hover { background: transparent; }
	.idx { flex: none; width: 24px; text-align: right; font-size: 12px; color: var(--text-soft); }
	.thumb {
		flex: none; width: 72px; height: 41px; border-radius: 7px; overflow: hidden; background: var(--surface);
		display: flex; align-items: center; justify-content: center; color: var(--text-soft); position: relative;
	}
	.thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.thumb-play {
		position: absolute; z-index: 1; width: 26px; height: 26px; border-radius: 50%; background: var(--petal);
		display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity var(--dur-fast) ease;
	}
	.row:hover .thumb-play { opacity: 1; }
	.meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sub { font-size: 12.5px; color: var(--text-mute); }
	.go { flex: none; color: var(--text-soft); display: flex; }
	.row:hover .go { color: var(--petal); }

	@media (max-width: 640px) {
		.hdr-inner, .body { padding-left: var(--s3); padding-right: var(--s3); }
		.hdr-poster { width: 96px; }
		.thumb { width: 60px; height: 34px; }
	}
</style>
