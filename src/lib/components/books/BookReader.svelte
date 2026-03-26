<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { BookBookmark, BookHighlight } from '$lib/db/schema';
	import {
		ArrowLeft, List, Bookmark, BookmarkCheck, Settings, Search, X,
		ChevronLeft, ChevronRight, Maximize, Minimize, Type, Sun, Moon, Sunset,
		ChevronDown
	} from 'lucide-svelte';

	interface Props {
		epubUrl: string;
		book: UnifiedMedia;
		serviceId: string;
		savedPosition?: string;
		initialProgress?: number;
		bookmarks?: BookBookmark[];
		highlights?: BookHighlight[];
		availableFormats?: string[];
	}

	let {
		epubUrl,
		book,
		serviceId,
		savedPosition,
		initialProgress = 0,
		bookmarks: initialBookmarks = [],
		highlights: initialHighlights = [],
		availableFormats = []
	}: Props = $props();

	// Format switching
	let showFormatMenu = $state(false);
	const currentFormatLabel = 'EPUB';
	const otherFormats = $derived(availableFormats.filter(f => f !== 'epub'));

	function switchFormat(fmt: string) {
		showFormatMenu = false;
		goto(`/books/read/${book.sourceId}?service=${serviceId}&format=${fmt}`, { replaceState: true });
	}

	// ── Core state ──
	let container: HTMLElement | undefined = $state();
	let epubBook: any = $state(null);
	let rendition: any = $state(null);
	let ready = $state(false);
	let locationsReady = $state(false);
	let currentCfi = $state('');
	let currentProgress = $state(0);
	let currentChapter = $state('');
	let toc = $state<Array<{ id: string; href: string; label: string; subitems?: any[] }>>([]);
	let bookmarkList = $state<BookBookmark[]>([]);
	let highlightList = $state<BookHighlight[]>([]);
	$effect(() => { currentProgress = initialProgress; });
	$effect(() => { bookmarkList = [...initialBookmarks]; });
	$effect(() => { highlightList = [...initialHighlights]; });

	// UI panels
	let showToolbar = $state(true);
	let showToc = $state(false);
	let showSettings = $state(false);
	let showBookmarks = $state(false);
	let showSearch = $state(false);
	let isFullscreen = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<Array<{ cfi: string; excerpt: string }>>([]);
	let highlightPopup = $state<{ x: number; y: number; cfi: string; text: string } | null>(null);

	// Reader settings (persisted in localStorage)
	let readerTheme = $state<'dark' | 'light' | 'sepia'>('dark');
	let fontFamily = $state<'serif' | 'sans' | 'mono'>('serif');
	let fontSize = $state(18);
	let lineHeight = $state(1.6);
	let flow = $state<'paginated' | 'scrolled-doc'>('paginated');

	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// Check if any panel is open
	const anyPanelOpen = $derived(showToc || showSettings || showBookmarks || showSearch || showFormatMenu);

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
			theme: readerTheme, fontFamily, fontSize, lineHeight, flow
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
				'line-height': `${lineHeight} !important`,
				'padding': '0 !important',
				'margin': '0 !important',
				'word-wrap': 'break-word !important',
				'overflow-wrap': 'break-word !important'
			},
			'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, section, article': {
				color: `${t.text} !important`,
				'max-width': '100% !important'
			},
			'p': {
				'orphans': '2',
				'widows': '2'
			},
			'a': { color: `${t.link} !important` },
			'img': {
				'max-width': '100% !important',
				'max-height': '85vh !important',
				'height': 'auto !important',
				'width': 'auto !important',
				'object-fit': 'contain !important',
				'display': 'block !important',
				'margin': '0 auto !important'
			},
			'svg': {
				'max-width': '100% !important',
				'height': 'auto !important'
			},
			'[class*="cover"] img, [id*="cover"] img, .sgc-toc-level img': {
				'max-height': '80vh !important',
				'width': 'auto !important',
				'margin': '1rem auto !important'
			}
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

	// ── Toolbar auto-hide ──
	function startHideTimer() {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!anyPanelOpen) showToolbar = false;
		}, 3000);
	}

	function handleReaderMouseMove() {
		if (!ready) return;
		showToolbar = true;
		startHideTimer();
	}

	function toggleToolbar() {
		if (showToolbar) {
			if (hideTimer) clearTimeout(hideTimer);
			showToolbar = false;
		} else {
			showToolbar = true;
			startHideTimer();
		}
	}

	// ── Navigation ──
	function prevPage() { rendition?.prev(); }
	function nextPage() { rendition?.next(); }

	function goToChapter(href: string) {
		rendition?.display(href);
		showToc = false;
	}

	// ── Progress ──
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

	function jumpToProgress(e: MouseEvent) {
		if (!epubBook || !locationsReady) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = (e.clientX - rect.left) / rect.width;
		const cfi = epubBook.locations?.cfiFromPercentage(pct);
		if (cfi) rendition?.display(cfi);
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
		highlightPopup = { x: window.innerWidth / 2, y: 80, cfi, text };
	}

	async function addHighlight(color: string) {
		if (!highlightPopup) return;
		const { cfi, text } = highlightPopup;
		rendition.annotations.highlight(cfi, {}, () => {}, '', {
			fill: highlightColors[color], 'fill-opacity': '1', 'mix-blend-mode': 'multiply'
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
				await item.load(epubBook.load.bind(epubBook));
				const found = await item.find(searchQuery);
				for (const f of found) results.push({ cfi: f.cfi, excerpt: f.excerpt });
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
		if (document.fullscreenElement) document.exitFullscreen();
		else document.documentElement.requestFullscreen();
	}

	function closeReader() {
		goto(`/media/book/${book.sourceId}?service=${serviceId}`);
	}

	function closeAllPanels() {
		showToc = false;
		showSettings = false;
		showBookmarks = false;
		showSearch = false;
		showFormatMenu = false;
		highlightPopup = null;
	}

	// ── Keyboard ──
	function handleKeydown(e: KeyboardEvent) {
		if (showSearch && e.key !== 'Escape') return;
		switch (e.key) {
			case 'ArrowLeft': e.preventDefault(); prevPage(); break;
			case 'ArrowRight': e.preventDefault(); nextPage(); break;
			case 'Escape':
				e.preventDefault();
				if (anyPanelOpen || highlightPopup) closeAllPanels();
				else closeReader();
				break;
			case 'f': if (!e.ctrlKey && !e.metaKey) toggleFullscreen(); break;
			case 't': if (!e.ctrlKey && !e.metaKey) { showToc = !showToc; if (showToc) { showSettings = false; showBookmarks = false; showSearch = false; } } break;
			case 's': if (!e.ctrlKey && !e.metaKey) { showSettings = !showSettings; if (showSettings) { showToc = false; showBookmarks = false; showSearch = false; } } break;
			case 'b': if (!e.ctrlKey && !e.metaKey) toggleBookmark(); break;
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

	// ── epub.js init ──
	$effect(() => {
		if (!browser || !container) return;
		let destroyed = false;
		let bookInstance: any = null;

		(async () => {
			const ePub = (await import('epubjs')).default;
			if (destroyed) return;

			const res = await fetch(epubUrl);
			if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
			const arrayBuffer = await res.arrayBuffer();
			if (destroyed) return;

			bookInstance = ePub(arrayBuffer);
			epubBook = bookInstance;

			const rend = bookInstance.renderTo(container!, {
				width: '100%',
				height: '100%',
				spread: 'none',
				flow: flow,
				allowScriptedContent: false,
				manager: 'default'
			});
			rendition = rend;

			// Inject CSS into each epub iframe for things the themes API can't handle
			rend.hooks.content.register((contents: any) => {
				const doc = contents.document;
				if (!doc) return;
				const style = doc.createElement('style');
				style.textContent = `
					/* Fix cover SVGs that use preserveAspectRatio="none" */
					svg[preserveAspectRatio="none"] {
						max-width: 100% !important;
						max-height: 90vh !important;
					}
					/* Ensure images don't overflow columns */
					img {
						max-width: 100% !important;
						box-sizing: border-box !important;
						page-break-inside: avoid !important;
						break-inside: avoid !important;
					}
				`;
				doc.head.appendChild(style);

				// Fix SVG preserveAspectRatio="none" to "xMidYMid meet"
				const svgs = doc.querySelectorAll('svg[preserveAspectRatio="none"]');
				svgs.forEach((svg: Element) => {
					svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
					svg.setAttribute('width', '100%');
					svg.removeAttribute('height');
				});

				// Listen for mousemove inside iframe to show toolbar
				doc.addEventListener('mousemove', () => {
					handleReaderMouseMove();
				});
			});

			applyTheme();

			if (savedPosition) rend.display(savedPosition);
			else rend.display();

			bookInstance.loaded.navigation.then((nav: any) => {
				toc = nav.toc ?? [];
			});

			// Generate locations for progress bar scrubbing
			bookInstance.ready.then(() => {
				if (destroyed) return;
				ready = true;
				// Start toolbar auto-hide now that content is visible
				startHideTimer();

				// Generate locations (async, ~1-2s for large books)
				bookInstance.locations.generate(1024).then(() => {
					if (!destroyed) locationsReady = true;
				});

				// Apply existing highlights
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

			rend.on('relocated', (location: any) => {
				if (destroyed) return;
				currentCfi = location.start.cfi;
				if (locationsReady && bookInstance.locations) {
					currentProgress = bookInstance.locations.percentageFromCfi(location.start.cfi) ?? 0;
				} else {
					currentProgress = location.start.percentage ?? 0;
				}
				currentChapter = getCurrentChapter(location.start.href);
				saveProgress();
			});

			rend.on('selected', (cfiRange: string) => {
				try {
					const range = rend.getRange(cfiRange);
					const text = range?.toString() ?? '';
					if (text.length > 2) showHighlightMenu(cfiRange, text);
				} catch { /* ignore */ }
			});

			// Touch handling
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
					if (dx > 0) prevPage(); else nextPage();
				} else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
					toggleToolbar();
				}
			});

			// Mouse click inside epub iframe for toolbar toggle
			rend.on('click', () => {
				if (!anyPanelOpen) toggleToolbar();
			});

		})();

		return () => {
			destroyed = true;
			bookInstance?.destroy();
			epubBook = null;
			rendition = null;
			ready = false;
			locationsReady = false;
		};
	});

	// Re-apply theme on settings change
	$effect(() => {
		void readerTheme; void fontFamily; void fontSize; void lineHeight;
		if (rendition && ready) applyTheme();
	});

	// Handle flow change
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
	class="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 px-4 py-2.5 transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:-translate-y-full={!showToolbar}
	style="background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 70%, transparent 100%);"
>
	<button onclick={closeReader} class="rounded-lg p-2 text-cream/70 transition-colors hover:text-cream" title="Back (Esc)">
		<ArrowLeft size={20} strokeWidth={1.5} />
	</button>

	<div class="min-w-0 flex-1">
		<div class="truncate text-sm font-medium text-cream/90">{book.title}</div>
		{#if currentChapter}
			<div class="truncate text-xs text-cream/50">{currentChapter}</div>
		{/if}
	</div>

	<div class="flex items-center gap-0.5">
		<button onclick={() => { showSearch = !showSearch; showToc = false; showSettings = false; showBookmarks = false; }} class="rounded-lg p-2 text-cream/60 transition-colors hover:text-cream" class:text-cream={showSearch} title="Search">
			<Search size={18} strokeWidth={1.5} />
		</button>
		<button onclick={() => { showToc = !showToc; showSettings = false; showBookmarks = false; showSearch = false; }} class="rounded-lg p-2 text-cream/60 transition-colors hover:text-cream" class:text-cream={showToc} title="Contents (T)">
			<List size={18} strokeWidth={1.5} />
		</button>
		<button onclick={() => { showBookmarks = !showBookmarks; showToc = false; showSettings = false; showSearch = false; }} class="rounded-lg p-2 text-cream/60 transition-colors hover:text-cream" class:text-cream={showBookmarks} title="Bookmarks (B)">
			{#if isBookmarked}
				<BookmarkCheck size={18} strokeWidth={1.5} />
			{:else}
				<Bookmark size={18} strokeWidth={1.5} />
			{/if}
		</button>
		<button onclick={() => { showSettings = !showSettings; showToc = false; showBookmarks = false; showSearch = false; }} class="rounded-lg p-2 text-cream/60 transition-colors hover:text-cream" class:text-cream={showSettings} title="Settings (S)">
			<Settings size={18} strokeWidth={1.5} />
		</button>

		<!-- Format switcher (always visible if other formats exist) -->
		{#if otherFormats.length > 0}
			<div class="relative ml-1">
				<button
					onclick={() => { showFormatMenu = !showFormatMenu; }}
					class="flex items-center gap-1.5 rounded-lg border border-cream/10 bg-cream/5 px-2.5 py-1.5 text-xs font-medium text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream"
					title="Switch format"
				>
					{currentFormatLabel}
					<ChevronDown size={12} />
				</button>
				{#if showFormatMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-full mt-1.5 min-w-[140px] overflow-hidden rounded-xl border border-cream/10 py-1 shadow-2xl"
						style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
					>
						{#each availableFormats as fmt}
							<button
								class="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors {fmt === 'epub' ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/[0.08]' : 'text-cream/60 hover:bg-cream/[0.04] hover:text-cream'}"
								onclick={() => switchFormat(fmt)}
							>
								{#if fmt === 'epub'}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
								{:else if fmt === 'pdf'}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
								{/if}
								<span>{fmt.toUpperCase()}</span>
								{#if fmt === 'epub'}<span class="text-cream/30">(reader)</span>{/if}
								{#if fmt === 'pdf'}<span class="text-cream/30">(viewer)</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<button onclick={toggleFullscreen} class="hidden rounded-lg p-2 text-cream/60 transition-colors hover:text-cream sm:block" title="Fullscreen (F)">
			{#if isFullscreen}
				<Minimize size={18} strokeWidth={1.5} />
			{:else}
				<Maximize size={18} strokeWidth={1.5} />
			{/if}
		</button>
	</div>
</div>

<!-- Main Reader Area -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative h-full w-full"
	style="background-color: {themes[readerTheme].bg};"
	onmousemove={handleReaderMouseMove}
>
	<!-- epub.js container -->
	<div
		bind:this={container}
		class="absolute overflow-hidden"
		style="top: 48px; bottom: 52px; left: 4%; right: 4%;"
	></div>

	<!-- Page turn click zones (don't overlap toolbar areas) -->
	<button
		class="absolute left-0 top-12 z-10 w-[12%] cursor-w-resize opacity-0 sm:w-[18%]"
		style="bottom: 48px;"
		onclick={prevPage}
		aria-label="Previous page"
	></button>
	<button
		class="absolute right-0 top-12 z-10 w-[12%] cursor-e-resize opacity-0 sm:w-[18%]"
		style="bottom: 48px;"
		onclick={nextPage}
		aria-label="Next page"
	></button>
</div>

<!-- Bottom Progress Bar -->
<div
	class="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 px-4 py-2.5 transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:translate-y-full={!showToolbar}
	style="background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 70%, transparent 100%);"
>
	<button onclick={prevPage} class="rounded p-1 text-cream/50 transition-colors hover:text-cream" aria-label="Previous page">
		<ChevronLeft size={16} strokeWidth={1.5} />
	</button>

	<!-- Progress track -->
	<button
		class="relative h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-cream/10"
		onclick={jumpToProgress}
		aria-label="Jump to position"
	>
		<div
			class="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
			style="width: {progressPercent}%; background: var(--color-accent, #d4a253);"
		></div>
	</button>

	<span class="min-w-[3rem] text-right text-xs tabular-nums text-cream/50">{progressPercent}%</span>

	<button onclick={nextPage} class="rounded p-1 text-cream/50 transition-colors hover:text-cream">
		<ChevronRight size={16} strokeWidth={1.5} />
	</button>
</div>

<!-- TOC Sidebar -->
{#if showToc}
	<div class="fixed inset-0 z-[70] bg-black/40" onclick={() => showToc = false} onkeydown={(e) => { if (e.key === 'Escape') showToc = false; }} role="button" tabindex="-1" aria-label="Close table of contents">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute bottom-0 left-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-r border-cream/[0.06] p-4"
			style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
			onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream/90">Contents</h2>
				<button onclick={() => showToc = false} class="rounded-lg p-1.5 text-cream/50 hover:bg-cream/[0.06] hover:text-cream">
					<X size={16} strokeWidth={1.5} />
				</button>
			</div>
			<nav class="space-y-0.5">
				{#each toc as chapter}
					<button
						class="block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors {currentChapter === chapter.label ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'text-cream/60 hover:bg-cream/[0.04] hover:text-cream'}"
						onclick={() => goToChapter(chapter.href)}
					>
						{chapter.label}
					</button>
					{#if chapter.subitems}
						{#each chapter.subitems as sub}
							<button
								class="block w-full rounded-lg px-3 py-1.5 pl-6 text-left text-xs transition-colors {currentChapter === sub.label ? 'text-[var(--color-accent)]' : 'text-cream/40 hover:text-cream/60'}"
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

<!-- Settings Panel -->
{#if showSettings}
	<div class="fixed inset-0 z-[70] bg-black/40" onclick={() => showSettings = false} onkeydown={(e) => { if (e.key === 'Escape') showSettings = false; }} role="button" tabindex="-1" aria-label="Close settings">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute bottom-0 right-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-l border-cream/[0.06] p-5"
			style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
			onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
		>
			<div class="mb-5 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream/90">Reading Settings</h2>
				<button onclick={() => showSettings = false} class="rounded-lg p-1.5 text-cream/50 hover:bg-cream/[0.06] hover:text-cream">
					<X size={16} strokeWidth={1.5} />
				</button>
			</div>

			<!-- Theme -->
			<div class="mb-5">
				<span class="mb-2 block text-xs font-medium uppercase tracking-wider text-cream/40">Theme</span>
				<div class="flex gap-2">
					{#each [{ key: 'dark', label: 'Dark', Icon: Moon }, { key: 'light', label: 'Light', Icon: Sun }, { key: 'sepia', label: 'Sepia', Icon: Sunset }] as { key, label, Icon }}
						<button
							class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors {readerTheme === key ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50'}"
							onclick={() => readerTheme = key as 'dark' | 'light' | 'sepia'}
						>
							<Icon size={14} /> {label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Font Family -->
			<div class="mb-5">
				<span class="mb-2 block text-xs font-medium uppercase tracking-wider text-cream/40">Font</span>
				<div class="flex gap-2">
					{#each [{ key: 'serif', label: 'Serif', font: 'Georgia, serif' }, { key: 'sans', label: 'Sans', font: "'DM Sans', sans-serif" }, { key: 'mono', label: 'Mono', font: "'JetBrains Mono', monospace" }] as { key, label, font }}
						<button
							class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {fontFamily === key ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50'}"
							style="font-family: {font};"
							onclick={() => fontFamily = key as 'serif' | 'sans' | 'mono'}
						>{label}</button>
					{/each}
				</div>
			</div>

			<!-- Font Size -->
			<div class="mb-5">
				<label for="reader-font-size" class="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-cream/40">
					<span>Font Size</span>
					<span class="normal-case text-cream/60">{fontSize}px</span>
				</label>
				<div class="flex items-center gap-3">
					<Type size={12} class="text-cream/30" />
					<input id="reader-font-size" type="range" min="14" max="28" step="1" bind:value={fontSize} class="flex-1 accent-[var(--color-accent)]" />
					<Type size={20} class="text-cream/30" />
				</div>
			</div>

			<!-- Line Height -->
			<div class="mb-5">
				<label for="reader-line-height" class="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-cream/40">
					<span>Line Height</span>
					<span class="normal-case text-cream/60">{lineHeight.toFixed(1)}</span>
				</label>
				<input id="reader-line-height" type="range" min="1.2" max="2.0" step="0.1" bind:value={lineHeight} class="w-full accent-[var(--color-accent)]" />
			</div>

			<!-- Layout -->
			<div>
				<span class="mb-2 block text-xs font-medium uppercase tracking-wider text-cream/40">Layout</span>
				<div class="flex gap-2">
					<button
						class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {flow === 'paginated' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50'}"
						onclick={() => flow = 'paginated'}
					>Paginated</button>
					<button
						class="flex-1 rounded-lg border px-3 py-2 text-xs transition-colors {flow === 'scrolled-doc' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50'}"
						onclick={() => flow = 'scrolled-doc'}
					>Scrolling</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Bookmarks Panel -->
{#if showBookmarks}
	
	<div class="fixed inset-0 z-[70] bg-black/40" onclick={() => showBookmarks = false} onkeydown={(e) => { if (e.key === 'Escape') showBookmarks = false; }} role="button" tabindex="-1" aria-label="Close bookmarks">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute bottom-0 right-0 top-0 w-80 max-w-[85vw] overflow-y-auto border-l border-cream/[0.06] p-5"
			style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
			onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wide text-cream/90">Bookmarks</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={toggleBookmark}
						class="rounded-lg px-2.5 py-1.5 text-xs transition-colors {isBookmarked ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-cream/[0.04] text-cream/50 hover:text-cream'}"
					>
						{isBookmarked ? 'Remove' : '+ Add here'}
					</button>
					<button onclick={() => showBookmarks = false} class="rounded-lg p-1.5 text-cream/50 hover:bg-cream/[0.06] hover:text-cream">
						<X size={16} strokeWidth={1.5} />
					</button>
				</div>
			</div>
			{#if bookmarkList.length === 0}
				<p class="text-sm text-cream/30">No bookmarks yet. Press <kbd class="rounded bg-cream/10 px-1.5 py-0.5 text-xs">B</kbd> to bookmark.</p>
			{:else}
				<div class="space-y-1">
					{#each bookmarkList as bm}
						<button
							class="w-full rounded-lg px-3 py-2 text-left text-sm text-cream/60 transition-colors hover:bg-cream/[0.04] hover:text-cream"
							onclick={() => { rendition?.display(bm.cfi); showBookmarks = false; }}
						>
							<div class="font-medium">{bm.label || 'Bookmark'}</div>
							<div class="text-xs text-cream/30">{new Date(bm.createdAt).toLocaleDateString()}</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if highlightList.length > 0}
				<div class="mt-6 border-t border-cream/[0.06] pt-4">
					<h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-cream/30">Highlights</h3>
					<div class="space-y-2">
						{#each highlightList as hl}
							<button
								class="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-cream/[0.04]"
								onclick={() => { rendition?.display(hl.cfi); showBookmarks = false; }}
							>
								<div class="mb-1 flex items-center gap-2">
									<span class="h-2 w-2 rounded-full" style="background: {highlightColors[hl.color ?? 'yellow']};"></span>
									<span class="text-xs text-cream/30">{hl.chapter || 'Unknown chapter'}</span>
								</div>
								<div class="line-clamp-2 text-xs text-cream/50">"{hl.text}"</div>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Search Panel -->
{#if showSearch}
	<div class="fixed inset-0 z-[70] bg-black/40" onclick={() => showSearch = false} onkeydown={(e) => { if (e.key === 'Escape') showSearch = false; }} role="button" tabindex="-1" aria-label="Close search">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute inset-x-0 top-0 max-h-[70vh] overflow-y-auto border-b border-cream/[0.06] p-4 pt-16"
			style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
			onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
		>
			<div class="mx-auto max-w-xl">
				<div class="mb-4 flex items-center gap-2">
					<Search size={16} class="text-cream/30" />
ttttt<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search in book..."
						class="flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-cream/30"
						onkeydown={(e) => { if (e.key === 'Enter') doSearch(); }}
						autofocus
					/>
					<button onclick={() => showSearch = false} class="rounded-lg p-1.5 text-cream/50 hover:text-cream">
						<X size={16} strokeWidth={1.5} />
					</button>
				</div>
				{#if searchResults.length > 0}
					<div class="space-y-1">
						{#each searchResults as result}
							<button
								class="w-full rounded-lg px-3 py-2 text-left text-sm text-cream/60 transition-colors hover:bg-cream/[0.04] hover:text-cream"
								onclick={() => goToSearchResult(result.cfi)}
							>
								<span class="line-clamp-2">{@html result.excerpt}</span>
							</button>
						{/each}
					</div>
				{:else if searchQuery}
					<p class="text-center text-sm text-cream/30">Press Enter to search</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Highlight Popup -->
{#if highlightPopup}
	<div class="fixed inset-0 z-[80]" onclick={() => highlightPopup = null} onkeydown={(e) => { if (e.key === 'Escape') highlightPopup = null; }} role="button" tabindex="-1" aria-label="Close highlight menu">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute left-1/2 top-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-cream/10 px-3 py-2 shadow-2xl"
			style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
			onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
		>
			{#each Object.entries(highlightColors) as [color, fill]}
				<button
					class="h-7 w-7 rounded-full border-2 border-transparent transition-transform hover:scale-110"
					style="background: {fill};"
					title="Highlight {color}"
					onclick={() => addHighlight(color)}
				></button>
			{/each}
			<button
				class="ml-1 rounded-lg px-2 py-1 text-xs text-cream/50 transition-colors hover:bg-cream/[0.06] hover:text-cream"
				onclick={() => highlightPopup = null}
			>
				<X size={14} />
			</button>
		</div>
	</div>
{/if}

<!-- Format menu backdrop -->
{#if showFormatMenu}
	<div class="fixed inset-0 z-[59]" onclick={() => showFormatMenu = false} onkeydown={(e) => { if (e.key === 'Escape') showFormatMenu = false; }} role="button" tabindex="-1" aria-label="Close format menu"></div>
{/if}

<!-- Loading state -->
{#if !ready}
	<div class="fixed inset-0 z-[55] flex items-center justify-center" style="background-color: {themes[readerTheme].bg};">
		<div class="text-center">
			<div class="mb-3 mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cream/10 border-t-[var(--color-accent)]"></div>
			<p class="text-sm text-cream/50">Loading book...</p>
		</div>
	</div>
{/if}
