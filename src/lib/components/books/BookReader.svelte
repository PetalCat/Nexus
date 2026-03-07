<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { BookBookmark, BookHighlight } from '$lib/db/schema';
	import {
		ArrowLeft, List, Bookmark, BookmarkCheck, Settings, Search, X,
		ChevronLeft, ChevronRight, Maximize, Minimize, Type, Sun, Moon, Sunset
	} from 'lucide-svelte';

	interface Props {
		epubUrl: string;
		book: UnifiedMedia;
		serviceId: string;
		savedPosition?: string;
		initialProgress?: number;
		bookmarks?: BookBookmark[];
		highlights?: BookHighlight[];
	}

	let {
		epubUrl,
		book,
		serviceId,
		savedPosition,
		initialProgress = 0,
		bookmarks: initialBookmarks = [],
		highlights: initialHighlights = []
	}: Props = $props();

	// ── State ──
	let container: HTMLElement | undefined = $state();
	let epubBook: any = $state(null);
	let rendition: any = $state(null);
	let ready = $state(false);
	let currentCfi = $state('');
	let currentProgress = $state(initialProgress);
	let currentChapter = $state('');
	let toc = $state<Array<{ id: string; href: string; label: string; subitems?: any[] }>>([]);
	let bookmarkList = $state<BookBookmark[]>([...initialBookmarks]);
	let highlightList = $state<BookHighlight[]>([...initialHighlights]);

	// UI state
	let showToolbar = $state(true);
	let showToc = $state(false);
	let showSettings = $state(false);
	let showBookmarks = $state(false);
	let showSearch = $state(false);
	let isFullscreen = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<Array<{ cfi: string; excerpt: string }>>([]);

	// Highlight popup
	let highlightPopup = $state<{ x: number; y: number; cfi: string; text: string } | null>(null);

	// Reader settings (persisted in localStorage)
	let readerTheme = $state<'dark' | 'light' | 'sepia'>('dark');
	let fontFamily = $state<'serif' | 'sans' | 'mono'>('serif');
	let fontSize = $state(18);
	let lineHeight = $state(1.6);
	let flow = $state<'paginated' | 'scrolled-doc'>('paginated');

	// Toolbar auto-hide
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// Save progress debounce
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const themes = {
		dark: { bg: '#181514', text: '#f0ebe3', link: '#d4a253' },
		light: { bg: '#faf8f5', text: '#1a1a1a', link: '#b8862e' },
		sepia: { bg: '#f4ecd8', text: '#5b4636', link: '#8b6914' }
	};

	const fonts = {
		serif: "'Playfair Display', Georgia, serif",
		sans: "'DM Sans', system-ui, sans-serif",
		mono: "'JetBrains Mono', monospace"
	};

	const highlightColors: Record<string, string> = {
		yellow: 'rgba(250, 204, 21, 0.35)',
		green: 'rgba(74, 222, 128, 0.3)',
		blue: 'rgba(96, 165, 250, 0.3)',
		pink: 'rgba(251, 113, 133, 0.3)'
	};

	function loadSettings() {
		if (!browser) return;
		try {
			const saved = localStorage.getItem('nexus-reader-settings');
			if (saved) {
				const s = JSON.parse(saved);
				if (s.theme) readerTheme = s.theme;
				if (s.fontFamily) fontFamily = s.fontFamily;
				if (s.fontSize) fontSize = s.fontSize;
				if (s.lineHeight) lineHeight = s.lineHeight;
				if (s.flow) flow = s.flow;
			}
		} catch { /* ignore */ }
	}

	function persistSettings() {
		if (!browser) return;
		localStorage.setItem('nexus-reader-settings', JSON.stringify({
			theme: readerTheme,
			fontFamily,
			fontSize,
			lineHeight,
			flow
		}));
	}

	function applyTheme() {
		if (!rendition) return;
		const t = themes[readerTheme];
		rendition.themes.default({
			body: {
				'background-color': `${t.bg} !important`,
				color: `${t.text} !important`,
				'font-family': fonts[fontFamily],
				'font-size': `${fontSize}px !important`,
				'line-height': `${lineHeight} !important`
			},
			'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption': {
				color: `${t.text} !important`
			},
			'a': { color: `${t.link} !important` },
			'img': { 'max-width': '100% !important', height: 'auto !important' }
		});
		persistSettings();
	}

	function getCurrentChapter(href: string): string {
		if (!toc.length) return '';
		const clean = href.split('#')[0];
		for (const item of toc) {
			const itemHref = item.href.split('#')[0];
			if (clean.endsWith(itemHref) || itemHref.endsWith(clean)) return item.label;
			if (item.subitems) {
				for (const sub of item.subitems) {
					const subHref = sub.href.split('#')[0];
					if (clean.endsWith(subHref) || subHref.endsWith(clean)) return sub.label;
				}
			}
		}
		return '';
	}

	function resetHideTimer() {
		showToolbar = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => { showToolbar = false; }, 4000);
	}

	function toggleToolbar() {
		showToolbar = !showToolbar;
		if (showToolbar) resetHideTimer();
	}

	// ── Navigation ──
	function prevPage() { rendition?.prev(); }
	function nextPage() { rendition?.next(); }

	function goToChapter(href: string) {
		rendition?.display(href);
		showToc = false;
	}

	// ── Progress Saving ──
	async function saveProgress() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await fetch(`/api/books/${book.sourceId}/progress`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ progress: currentProgress, cfi: currentCfi, serviceId })
				});
			} catch { /* ignore */ }
		}, 2000);
	}

	// ── Bookmarks ──
	const isBookmarked = $derived(bookmarkList.some(b => b.cfi === currentCfi));

	async function toggleBookmark() {
		if (isBookmarked) {
			const bm = bookmarkList.find(b => b.cfi === currentCfi);
			if (bm) {
				await fetch(`/api/books/${book.sourceId}/bookmarks/${bm.id}`, { method: 'DELETE' });
				bookmarkList = bookmarkList.filter(b => b.id !== bm.id);
			}
		} else {
			const res = await fetch(`/api/books/${book.sourceId}/bookmarks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cfi: currentCfi, label: currentChapter || 'Bookmark', serviceId })
			});
			if (res.ok) {
				const bm = await res.json();
				bookmarkList = [bm, ...bookmarkList];
			}
		}
	}

	// ── Highlights ──
	function showHighlightMenu(cfi: string, text: string) {
		// Position near center-top of viewport
		highlightPopup = { x: window.innerWidth / 2, y: 80, cfi, text };
	}

	async function addHighlight(color: string) {
		if (!highlightPopup) return;
		const { cfi, text } = highlightPopup;

		rendition.annotations.highlight(cfi, {}, () => {}, '', {
			fill: highlightColors[color],
			'fill-opacity': '1',
			'mix-blend-mode': 'multiply'
		});

		const res = await fetch(`/api/books/${book.sourceId}/highlights`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cfi, text, color, serviceId, chapter: currentChapter })
		});
		if (res.ok) {
			const h = await res.json();
			highlightList = [...highlightList, h];
		}
		highlightPopup = null;
	}

	// ── Search ──
	async function doSearch() {
		if (!epubBook || !searchQuery.trim()) return;
		searchResults = [];
		const spine = epubBook.spine;
		const results: Array<{ cfi: string; excerpt: string }> = [];

		for (let i = 0; i < spine.items.length && results.length < 50; i++) {
			const item = spine.items[i];
			if (!item) continue;
			try {
				const doc = await item.load(epubBook.load.bind(epubBook));
				const found = await item.find(searchQuery);
				for (const f of found) {
					results.push({ cfi: f.cfi, excerpt: f.excerpt });
				}
				item.unload();
			} catch { /* skip */ }
		}
		searchResults = results;
	}

	function goToSearchResult(cfi: string) {
		rendition?.display(cfi);
		showSearch = false;
	}

	// ── Fullscreen ──
	function toggleFullscreen() {
		if (!browser) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			document.documentElement.requestFullscreen();
		}
	}

	function closeReader() {
		goto(`/media/book/${book.sourceId}?service=${serviceId}`);
	}

	// ── Keyboard ──
	function handleKeydown(e: KeyboardEvent) {
		if (showSearch && e.key !== 'Escape') return;

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				prevPage();
				break;
			case 'ArrowRight':
				e.preventDefault();
				nextPage();
				break;
			case 'Escape':
				e.preventDefault();
				if (showToc || showSettings || showBookmarks || showSearch || highlightPopup) {
					showToc = false;
					showSettings = false;
					showBookmarks = false;
					showSearch = false;
					highlightPopup = null;
				} else {
					closeReader();
				}
				break;
			case 'f':
				if (!e.ctrlKey && !e.metaKey) toggleFullscreen();
				break;
			case 't':
				if (!e.ctrlKey && !e.metaKey) showToc = !showToc;
				break;
			case 's':
				if (!e.ctrlKey && !e.metaKey) { showSettings = !showSettings; }
				break;
			case 'b':
				if (!e.ctrlKey && !e.metaKey) toggleBookmark();
				break;
		}
	}

	onMount(() => {
		loadSettings();

		const handleFs = () => { isFullscreen = !!document.fullscreenElement; };
		document.addEventListener('fullscreenchange', handleFs);

		return () => {
			document.removeEventListener('fullscreenchange', handleFs);
			if (hideTimer) clearTimeout(hideTimer);
			if (saveTimer) clearTimeout(saveTimer);
		};
	});

	// epub.js is client-only, so we dynamically import it
	$effect(() => {
		if (!browser || !container) return;

		let destroyed = false;
		let bookInstance: any = null;

		(async () => {
			const ePub = (await import('epubjs')).default;
			if (destroyed) return;

			bookInstance = ePub(epubUrl);
			epubBook = bookInstance;

			const rend = bookInstance.renderTo(container!, {
				width: '100%',
				height: '100%',
				spread: 'none',
				flow: flow,
				allowScriptedContent: false
			});
			rendition = rend;

			// Apply theme
			applyTheme();

			// Navigate to saved position or start
			if (savedPosition) {
				rend.display(savedPosition);
			} else {
				rend.display();
			}

			// Load TOC
			bookInstance.loaded.navigation.then((nav: any) => {
				toc = nav.toc ?? [];
			});

			// Track location changes
			rend.on('relocated', (location: any) => {
				if (destroyed) return;
				currentCfi = location.start.cfi;
				currentProgress = location.start.percentage ?? 0;
				currentChapter = getCurrentChapter(location.start.href);
				saveProgress();
			});

			// Handle text selection for highlights
			rend.on('selected', (cfiRange: string) => {
				try {
					const range = rend.getRange(cfiRange);
					const text = range?.toString() ?? '';
					if (text.length > 2) {
						showHighlightMenu(cfiRange, text);
					}
				} catch { /* ignore */ }
			});

			// Load existing highlights
			bookInstance.ready.then(() => {
				if (destroyed) return;
				ready = true;
				for (const h of initialHighlights) {
					try {
						rend.annotations.highlight(h.cfi, {}, () => {}, '', {
							fill: highlightColors[h.color ?? 'yellow'],
							'fill-opacity': '1',
							'mix-blend-mode': 'multiply'
						});
					} catch { /* skip invalid CFIs */ }
				}
			});

			// Touch handling for page turns
			let touchStartX = 0;
			let touchStartY = 0;
			rend.on('touchstart', (e: TouchEvent) => {
				touchStartX = e.changedTouches[0].clientX;
				touchStartY = e.changedTouches[0].clientY;
			});
			rend.on('touchend', (e: TouchEvent) => {
				const dx = e.changedTouches[0].clientX - touchStartX;
				const dy = e.changedTouches[0].clientY - touchStartY;
				if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
					if (dx > 0) prevPage();
					else nextPage();
				} else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
					toggleToolbar();
				}
			});
		})();

		return () => {
			destroyed = true;
			bookInstance?.destroy();
			epubBook = null;
			rendition = null;
		};
	});

	// Re-apply theme when settings change
	$effect(() => {
		// Touch all reactive values to create dependencies
		void readerTheme;
		void fontFamily;
		void fontSize;
		void lineHeight;
		if (rendition && ready) applyTheme();
	});

	// Handle flow change (requires re-render)
	$effect(() => {
		if (!rendition || !ready) return;
		void flow;
		rendition.flow(flow);
		persistSettings();
	});

	const progressPercent = $derived(Math.round(currentProgress * 100));
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Top Toolbar -->
<div
	class="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 px-4 py-3 transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:-translate-y-full={!showToolbar}
	style="background: rgba(13, 11, 10, 0.85); backdrop-filter: blur(20px) saturate(1.3);"
>
	<button onclick={closeReader} class="rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream" title="Back (Esc)">
		<ArrowLeft size={20} strokeWidth={1.5} />
	</button>

	<div class="min-w-0 flex-1">
		<div class="truncate text-sm font-medium text-cream">{book.title}</div>
		{#if currentChapter}
			<div class="truncate text-xs text-faint">{currentChapter}</div>
		{/if}
	</div>

	<div class="flex items-center gap-1">
		<button onclick={() => { showSearch = !showSearch; showToc = false; showSettings = false; showBookmarks = false; }} class="rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream" class:text-accent={showSearch} title="Search">
			<Search size={18} strokeWidth={1.5} />
		</button>
		<button onclick={() => { showToc = !showToc; showSettings = false; showBookmarks = false; showSearch = false; }} class="rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream" class:text-accent={showToc} title="Table of Contents (T)">
			<List size={18} strokeWidth={1.5} />
		</button>
		<button onclick={() => { showBookmarks = !showBookmarks; showToc = false; showSettings = false; showSearch = false; }} class="rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream" class:text-accent={showBookmarks} title="Bookmarks">
			{#if isBookmarked}
				<BookmarkCheck size={18} strokeWidth={1.5} />
			{:else}
				<Bookmark size={18} strokeWidth={1.5} />
			{/if}
		</button>
		<button onclick={() => { showSettings = !showSettings; showToc = false; showBookmarks = false; showSearch = false; }} class="rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream" class:text-accent={showSettings} title="Settings (S)">
			<Settings size={18} strokeWidth={1.5} />
		</button>
		<button onclick={toggleFullscreen} class="hidden rounded-lg p-2 text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream sm:block" title="Fullscreen (F)">
			{#if isFullscreen}
				<Minimize size={18} strokeWidth={1.5} />
			{:else}
				<Maximize size={18} strokeWidth={1.5} />
			{/if}
		</button>
	</div>
</div>

<!-- Main Reader Area -->
<div class="relative h-full w-full" style="background-color: {themes[readerTheme].bg};">
	<!-- epub.js container -->
	<div
		bind:this={container}
		class="absolute inset-0"
		style="top: 0; bottom: 40px;"
	></div>

	<!-- Page turn click zones -->
	<button
		class="absolute left-0 top-0 z-10 h-full w-[15%] cursor-w-resize opacity-0 sm:w-[20%]"
		style="bottom: 40px;"
		onclick={prevPage}
		aria-label="Previous page"
	></button>
	<button
		class="absolute right-0 top-0 z-10 h-full w-[15%] cursor-e-resize opacity-0 sm:w-[20%]"
		style="bottom: 40px;"
		onclick={nextPage}
		aria-label="Next page"
	></button>

	<!-- Center tap zone for toolbar toggle (mobile) -->
	<button
		class="absolute left-[15%] right-[15%] top-0 z-[5] h-full opacity-0 sm:left-[20%] sm:right-[20%] lg:hidden"
		style="bottom: 40px;"
		onclick={toggleToolbar}
		aria-label="Toggle controls"
	></button>
</div>

<!-- Bottom Progress Bar -->
<div
	class="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 px-4 py-2 transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:translate-y-full={!showToolbar}
	style="background: rgba(13, 11, 10, 0.85); backdrop-filter: blur(20px) saturate(1.3);"
>
	<button onclick={prevPage} class="rounded p-1 text-muted transition-colors hover:text-cream">
		<ChevronLeft size={16} strokeWidth={1.5} />
	</button>

	<!-- Progress track -->
	<button
		class="relative h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-cream/[0.08]"
		onclick={(e) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const pct = (e.clientX - rect.left) / rect.width;
			if (epubBook) {
				const cfi = epubBook.locations?.cfiFromPercentage(pct);
				if (cfi) rendition?.display(cfi);
			}
		}}
	>
		<div
			class="absolute inset-y-0 left-0 rounded-full bg-accent/80 transition-all duration-300"
			style="width: {progressPercent}%;"
		></div>
	</button>

	<span class="min-w-[3rem] text-right text-xs tabular-nums text-muted">{progressPercent}%</span>

	<button onclick={nextPage} class="rounded p-1 text-muted transition-colors hover:text-cream">
		<ChevronRight size={16} strokeWidth={1.5} />
	</button>
</div>

<!-- TOC Sidebar (left) -->
{#if showToc}
	<div class="fixed inset-0 z-[70]" onclick={() => showToc = false}>
		<div
			class="absolute bottom-0 left-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-r border-cream/[0.06] p-4"
			style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream">Contents</h2>
				<button onclick={() => showToc = false} class="rounded-lg p-1.5 text-muted hover:bg-cream/[0.06] hover:text-cream">
					<X size={16} strokeWidth={1.5} />
				</button>
			</div>
			<nav class="space-y-0.5">
				{#each toc as chapter}
					<button
						class="block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors {currentChapter === chapter.label ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-cream/[0.04] hover:text-cream'}"
						onclick={() => goToChapter(chapter.href)}
					>
						{chapter.label}
					</button>
					{#if chapter.subitems}
						{#each chapter.subitems as sub}
							<button
								class="block w-full rounded-lg px-3 py-1.5 pl-6 text-left text-xs transition-colors"
								class:text-accent={currentChapter === sub.label}
								class:text-faint={currentChapter !== sub.label}
								class:hover:text-muted={currentChapter !== sub.label}
								onclick={() => goToChapter(sub.href)}
							>
								{sub.label}
							</button>
						{/each}
					{/if}
				{/each}
			</nav>
		</div>
	</div>
{/if}

<!-- Settings Panel (right) -->
{#if showSettings}
	<div class="fixed inset-0 z-[70]" onclick={() => showSettings = false}>
		<div
			class="absolute bottom-0 right-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-l border-cream/[0.06] p-5"
			style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-5 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream">Reading Settings</h2>
				<button onclick={() => showSettings = false} class="rounded-lg p-1.5 text-muted hover:bg-cream/[0.06] hover:text-cream">
					<X size={16} strokeWidth={1.5} />
				</button>
			</div>

			<!-- Theme -->
			<div class="mb-5">
				<label class="mb-2 block text-xs font-medium uppercase tracking-wider text-faint">Theme</label>
				<div class="flex gap-2">
					{#each [{ key: 'dark', label: 'Dark', Icon: Moon }, { key: 'light', label: 'Light', Icon: Sun }, { key: 'sepia', label: 'Sepia', Icon: Sunset }] as { key, label, Icon }}
						<button
							class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors {readerTheme === key ? 'border-accent bg-accent/10 text-accent' : 'border-cream/[0.08] text-muted'}"
							onclick={() => readerTheme = key as 'dark' | 'light' | 'sepia'}
						>
							<Icon size={14} /> {label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Font Family -->
			<div class="mb-5">
				<label class="mb-2 block text-xs font-medium uppercase tracking-wider text-faint">Font</label>
				<div class="flex gap-2">
					{#each [{ key: 'serif', label: 'Serif', font: 'Georgia, serif' }, { key: 'sans', label: 'Sans', font: "'DM Sans', sans-serif" }, { key: 'mono', label: 'Mono', font: "'JetBrains Mono', monospace" }] as { key, label, font }}
						<button
							class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {fontFamily === key ? 'border-accent bg-accent/10 text-accent' : 'border-cream/[0.08] text-muted'}"
							style="font-family: {font};"
							onclick={() => fontFamily = key as 'serif' | 'sans' | 'mono'}
						>{label}</button>
					{/each}
				</div>
			</div>

			<!-- Font Size -->
			<div class="mb-5">
				<label class="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-faint">
					<span>Font Size</span>
					<span class="normal-case text-muted">{fontSize}px</span>
				</label>
				<div class="flex items-center gap-3">
					<Type size={12} class="text-faint" />
					<input
						type="range"
						min="14"
						max="28"
						step="1"
						bind:value={fontSize}
						class="flex-1 accent-accent"
					/>
					<Type size={20} class="text-faint" />
				</div>
			</div>

			<!-- Line Height -->
			<div class="mb-5">
				<label class="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-faint">
					<span>Line Height</span>
					<span class="normal-case text-muted">{lineHeight.toFixed(1)}</span>
				</label>
				<input
					type="range"
					min="1.2"
					max="2.0"
					step="0.1"
					bind:value={lineHeight}
					class="w-full accent-accent"
				/>
			</div>

			<!-- Layout -->
			<div>
				<label class="mb-2 block text-xs font-medium uppercase tracking-wider text-faint">Layout</label>
				<div class="flex gap-2">
					<button
						class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {flow === 'paginated' ? 'border-accent bg-accent/10 text-accent' : 'border-cream/[0.08] text-muted'}"
						onclick={() => flow = 'paginated'}
					>Paginated</button>
					<button
						class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {flow === 'scrolled-doc' ? 'border-accent bg-accent/10 text-accent' : 'border-cream/[0.08] text-muted'}"
						onclick={() => flow = 'scrolled-doc'}
					>Scrolling</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Bookmarks Panel (right) -->
{#if showBookmarks}
	<div class="fixed inset-0 z-[70]" onclick={() => showBookmarks = false}>
		<div
			class="absolute bottom-0 right-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-l border-cream/[0.06] p-5"
			style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream">Bookmarks</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={toggleBookmark}
						class="rounded-lg px-2.5 py-1.5 text-xs transition-colors"
						class:bg-accent/10={isBookmarked}
						class:text-accent={isBookmarked}
						class:bg-cream/[0.04]={!isBookmarked}
						class:text-muted={!isBookmarked}
						class:hover:text-cream={!isBookmarked}
					>
						{isBookmarked ? 'Remove' : '+ Add here'}
					</button>
					<button onclick={() => showBookmarks = false} class="rounded-lg p-1.5 text-muted hover:bg-cream/[0.06] hover:text-cream">
						<X size={16} strokeWidth={1.5} />
					</button>
				</div>
			</div>
			{#if bookmarkList.length === 0}
				<p class="text-sm text-faint">No bookmarks yet. Press B to bookmark the current page.</p>
			{:else}
				<div class="space-y-1">
					{#each bookmarkList as bm}
						<button
							class="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-cream/[0.04] hover:text-cream"
							onclick={() => { rendition?.display(bm.cfi); showBookmarks = false; }}
						>
							<div class="font-medium">{bm.label || 'Bookmark'}</div>
							<div class="text-xs text-faint">{new Date(bm.createdAt).toLocaleDateString()}</div>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Highlights section -->
			{#if highlightList.length > 0}
				<div class="mt-6 border-t border-cream/[0.06] pt-4">
					<h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Highlights</h3>
					<div class="space-y-2">
						{#each highlightList as hl}
							<button
								class="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-cream/[0.04]"
								onclick={() => { rendition?.display(hl.cfi); showBookmarks = false; }}
							>
								<div class="mb-1 flex items-center gap-2">
									<span class="h-2 w-2 rounded-full" style="background: {highlightColors[hl.color ?? 'yellow']};"></span>
									<span class="text-xs text-faint">{hl.chapter || 'Unknown chapter'}</span>
								</div>
								<div class="line-clamp-2 text-xs text-muted">"{hl.text}"</div>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Search Panel (top overlay) -->
{#if showSearch}
	<div class="fixed inset-0 z-[70]" onclick={() => showSearch = false}>
		<div
			class="absolute inset-x-0 top-0 max-h-[70vh] overflow-y-auto border-b border-cream/[0.06] p-4 pt-16"
			style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mx-auto max-w-xl">
				<div class="mb-4 flex items-center gap-2">
					<Search size={16} class="text-faint" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search in book..."
						class="flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-faint"
						onkeydown={(e) => { if (e.key === 'Enter') doSearch(); }}
						autofocus
					/>
					<button onclick={() => showSearch = false} class="rounded-lg p-1.5 text-muted hover:text-cream">
						<X size={16} strokeWidth={1.5} />
					</button>
				</div>
				{#if searchResults.length > 0}
					<div class="space-y-1">
						{#each searchResults as result}
							<button
								class="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-cream/[0.04] hover:text-cream"
								onclick={() => goToSearchResult(result.cfi)}
							>
								<span class="line-clamp-2">{@html result.excerpt}</span>
							</button>
						{/each}
					</div>
				{:else if searchQuery}
					<p class="text-center text-sm text-faint">Press Enter to search</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Highlight Popup -->
{#if highlightPopup}
	<div class="fixed inset-0 z-[80]" onclick={() => highlightPopup = null}>
		<div
			class="absolute left-1/2 top-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-cream/[0.08] px-3 py-2 shadow-float"
			style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
			onclick={(e) => e.stopPropagation()}
		>
			{#each Object.entries(highlightColors) as [color, fill]}
				<button
					class="h-6 w-6 rounded-full border-2 border-transparent transition-transform hover:scale-110"
					style="background: {fill};"
					title="Highlight {color}"
					onclick={() => addHighlight(color)}
				></button>
			{/each}
			<button
				class="ml-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-cream/[0.06] hover:text-cream"
				onclick={() => highlightPopup = null}
			>
				<X size={14} />
			</button>
		</div>
	</div>
{/if}

<!-- Loading state -->
{#if !ready}
	<div class="fixed inset-0 z-[55] flex items-center justify-center" style="background-color: {themes[readerTheme].bg};">
		<div class="text-center">
			<div class="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-accent/20 border-t-accent mx-auto"></div>
			<p class="text-sm text-muted">Loading book...</p>
		</div>
	</div>
{/if}
