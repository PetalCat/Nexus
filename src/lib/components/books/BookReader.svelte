<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { BookBookmark, BookHighlight } from '$lib/db/schema';
	import {
		ArrowLeft, List, Bookmark, BookmarkCheck, Settings, Search, X,
		ChevronLeft, ChevronRight, Maximize, Minimize, Type,
		ChevronDown, AlignLeft, AlignJustify
	} from 'lucide-svelte';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import ReaderProgressBar from './ReaderProgressBar.svelte';
	import TimeEstimate from './TimeEstimate.svelte';
	import KeyboardShortcuts from './KeyboardShortcuts.svelte';
	import PaginatedViewport from './PaginatedViewport.svelte';
	import ReaderSettingsPanel from './ReaderSettingsPanel.svelte';
	import { loadReaderSettings, persistReaderSettings, DEFAULT_READER_SETTINGS, type ReaderSettings } from './reader-settings';

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
	let view: any = $state(null);
	let ready = $state(false);
	let loading = $state(true);
	let loadError = $state('');
	let currentCfi = $state('');
	let currentProgress = $state(0);
	let currentChapter = $state('');
	let toc = $state<Array<{ label: string; href: string; subitems?: any[] }>>([]);
	let bookmarkList = $state<BookBookmark[]>([]);
	let highlightList = $state<BookHighlight[]>([]);

	// Props are synced in the initFoliateReader action

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

	// Annotation popup (replaces inline highlight popup)
	let showAnnotationPopup = $state(false);
	let popupX = $state(0);
	let popupY = $state(0);
	let selectedText = $state('');
	let selectedCfi = $state('');

	// Note input
	let showNoteInput = $state(false);
	let noteContent = $state('');

	// Keyboard shortcuts overlay
	let showShortcuts = $state(false);

	// Total pages estimate (used for TimeEstimate / ReaderProgressBar)
	let totalPages = $state(0);
	let currentPage = $derived(Math.max(1, Math.round(currentProgress * totalPages)));
	let remainingPages = $derived(Math.max(0, totalPages - currentPage));

	// Chapter positions for ReaderProgressBar
	let chapterPositions = $state<Array<{ position: number; title: string }>>([]);

	const readerShortcuts = [
		{ label: 'Previous page', key: '\u2190' },
		{ label: 'Next page', key: '\u2192' },
		{ label: 'Close reader', key: 'Esc' },
		{ label: 'Fullscreen', key: 'F' },
		{ label: 'Table of contents', key: 'T' },
		{ label: 'Settings', key: 'S' },
		{ label: 'Toggle bookmark', key: 'B' },
		{ label: 'Search', key: '/' },
		{ label: 'Shortcuts', key: '?' }
	];

	// Reader settings (persisted in localStorage via shared module)
	let settings = $state<ReaderSettings>({ ...DEFAULT_READER_SETTINGS });

	// Derived aliases — keeps existing template references working; all writes
	// go back into `settings` so there is a single source of truth.
	const readerTheme = $derived(settings.theme);
	const fontFamily = $derived(settings.fontFamily);
	const fontSize = $derived(settings.fontSize);
	const lineHeight = $derived(settings.lineHeight);
	const margins = $derived(settings.margins);
	const textAlign = $derived(settings.textAlign);
	const flow = $derived(settings.flow);

	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	const anyPanelOpen = $derived(showToc || showSettings || showBookmarks || showSearch || showFormatMenu);

	const themes: Record<ReaderSettings['theme'], { bg: string; text: string; link: string }> = {
		dark: { bg: '#181514', text: '#f0ebe3', link: '#d4a253' },
		light: { bg: '#faf8f5', text: '#1a1a1a', link: '#b8862e' },
		sepia: { bg: '#f4ecd8', text: '#5b4636', link: '#8b6914' },
		night: { bg: '#000000', text: '#b0b0b0', link: '#d4a253' }
	};

	const fonts: Record<ReaderSettings['fontFamily'], string> = {
		serif: "Georgia, 'Times New Roman', serif",
		sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
		mono: "'JetBrains Mono', 'Fira Code', monospace",
		dyslexic: "'OpenDyslexic', 'Playfair Display', Georgia, serif"
	};

	const marginValues: Record<ReaderSettings['margins'], string> = {
		narrow: '2%',
		normal: '6%',
		wide: '12%'
	};

	const highlightColors: Record<string, string> = {
		yellow: 'rgba(250, 204, 21, 0.35)',
		green: 'rgba(74, 222, 128, 0.3)',
		blue: 'rgba(96, 165, 250, 0.3)',
		pink: 'rgba(251, 113, 133, 0.3)'
	};

	// ── Settings persistence (via shared module) ──
	// Writes are persisted via $effect below; reads happen lazily in
	// initFoliateReader so the reader hydrates with whatever's in localStorage.

	$effect(() => {
		// Persist on every change. `persistReaderSettings` merges into stored state.
		if (!browser) return;
		persistReaderSettings(settings);
	});

	// ── Build CSS for foliate-js renderer ──
	function getReaderCSS(): string {
		const t = themes[readerTheme];
		const m = marginValues[margins];
		return `
			@namespace epub "http://www.idpf.org/2007/ops";
			html {
				color-scheme: ${readerTheme === 'light' || readerTheme === 'sepia' ? 'light' : 'dark'};
			}
			html, body {
				background-color: ${t.bg} !important;
				color: ${t.text} !important;
				font-family: ${fonts[fontFamily]} !important;
				font-size: ${fontSize}px !important;
				padding-left: ${m} !important;
				padding-right: ${m} !important;
			}
			p, li, blockquote, dd {
				line-height: ${lineHeight} !important;
				text-align: ${textAlign} !important;
				-webkit-hyphens: auto;
				hyphens: auto;
				hanging-punctuation: allow-end last;
				widows: 2;
				orphans: 2;
			}
			a:link, a:visited {
				color: ${t.link} !important;
			}
			img, svg {
				max-width: 100% !important;
				height: auto !important;
				object-fit: contain !important;
			}
			pre {
				white-space: pre-wrap !important;
			}
			aside[epub|type~="endnote"],
			aside[epub|type~="footnote"],
			aside[epub|type~="note"],
			aside[epub|type~="rearnote"] {
				display: none;
			}
		`;
	}

	function applyStyles() {
		if (!view?.renderer?.setStyles) return;
		view.renderer.setStyles(getReaderCSS());
	}

	// ── Flatten TOC for display ──
	function flattenToc(items: any[]): Array<{ label: string; href: string; subitems?: any[] }> {
		if (!items) return [];
		return items.map((item: any) => ({
			label: typeof item.label === 'object' ? Object.values(item.label)[0] as string : item.label ?? '',
			href: item.href ?? '',
			subitems: item.subitems?.length ? flattenToc(item.subitems) : undefined
		}));
	}

	// ── Toolbar auto-hide ──
	function startHideTimer() {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!anyPanelOpen) showToolbar = false;
		}, 4000);
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
	function prevPage() { view?.prev(); }
	function nextPage() { view?.next(); }

	function goToChapter(href: string) {
		view?.goTo(href);
		showToc = false;
	}

	// ── Touch/swipe handling ──
	let touchStartX = 0;
	let touchStartY = 0;

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.changedTouches[0].clientX;
		touchStartY = e.changedTouches[0].clientY;
	}

	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		const dy = e.changedTouches[0].clientY - touchStartY;
		if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
			if (dx > 0) prevPage(); else nextPage();
		} else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
			toggleToolbar();
		}
	}

	// ── Progress sync (debounced 3s) ──
	$effect(() => {
		const cfi = currentCfi;
		const progress = currentProgress;
		if (!cfi) return;
		const timer = setTimeout(() => {
			fetch(`/api/books/${book.sourceId}/progress`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ progress, cfi, serviceId })
			}).catch(() => { /* ignore */ });
		}, 3000);
		return () => clearTimeout(timer);
	});

	function jumpToProgress(e: MouseEvent) {
		if (!view) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		view.goToFraction(frac);
	}

	function handleProgressBarSeek(position: number) {
		view?.goToFraction(position);
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

	// ── Text Selection → Annotation Popup ──
	function handleTextSelection(cfi: string, text: string, x: number, y: number) {
		if (!text.trim()) return;
		selectedText = text;
		selectedCfi = cfi;
		popupX = x;
		popupY = y;
		showAnnotationPopup = true;
		showNoteInput = false;
		noteContent = '';
	}

	function dismissAnnotationPopup() {
		showAnnotationPopup = false;
		showNoteInput = false;
		noteContent = '';
		selectedText = '';
		selectedCfi = '';
	}

	async function handleAnnotationHighlight(color: string) {
		if (!selectedCfi || !view) return;
		// Try to add visual annotation to the foliate view
		try {
			view.addAnnotation?.({ value: selectedCfi }, color);
		} catch { /* foliate may not support addAnnotation */ }
		// Persist to server
		const res = await fetch(`/api/books/${book.sourceId}/highlights`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				cfi: selectedCfi,
				text: selectedText,
				color,
				serviceId,
				chapter: currentChapter
			})
		});
		if (res.ok) {
			const h = await res.json();
			highlightList = [...highlightList, h];
		}
		dismissAnnotationPopup();
	}

	function handleAnnotationNote() {
		showNoteInput = true;
	}

	async function submitNote() {
		if (!selectedCfi || !noteContent.trim()) return;
		const res = await fetch(`/api/books/${book.sourceId}/notes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				cfi: selectedCfi,
				chapter: currentChapter,
				content: noteContent.trim(),
				serviceId
			})
		});
		if (res.ok) {
			// Note saved successfully
		}
		dismissAnnotationPopup();
	}

	function handleAnnotationCopy() {
		if (selectedText) {
			navigator.clipboard.writeText(selectedText).catch(() => { /* ignore */ });
		}
		dismissAnnotationPopup();
	}

	function handleAnnotationSearch() {
		if (selectedText) {
			searchQuery = selectedText;
			showSearch = true;
			doSearch();
		}
		dismissAnnotationPopup();
	}

	// Apply existing highlights to the foliate view
	function applyHighlightsToView() {
		if (!view) return;
		for (const h of highlightList) {
			try {
				view.addAnnotation?.({ value: h.cfi }, h.color ?? 'yellow');
			} catch { /* ignore */ }
		}
	}

	// Legacy inline highlight popup (kept for fallback)
	function showHighlightMenu(cfi: string, text: string) {
		highlightPopup = { x: window.innerWidth / 2, y: 80, cfi, text };
	}

	async function addHighlight(color: string) {
		if (!highlightPopup || !view) return;
		const { cfi, text } = highlightPopup;
		try {
			view.addAnnotation?.({ value: cfi }, color);
		} catch { /* ignore */ }
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
	let searching = $state(false);

	async function doSearch() {
		if (!view || !searchQuery.trim()) return;
		searching = true;
		searchResults = [];
		const results: Array<{ cfi: string; excerpt: string }> = [];
		try {
			for await (const result of view.search({ query: searchQuery })) {
				if (result === 'done') break;
				if (result.subitems) {
					for (const item of result.subitems) {
						results.push({ cfi: item.cfi, excerpt: item.excerpt });
						if (results.length >= 50) break;
					}
				} else if (result.cfi) {
					results.push({ cfi: result.cfi, excerpt: result.excerpt });
				}
				if (results.length >= 50) break;
			}
		} catch (err) {
			console.error('Search error:', err);
		}
		searchResults = results;
		searching = false;
	}

	function goToSearchResult(cfi: string) {
		view?.goTo(cfi);
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
		showShortcuts = false;
		highlightPopup = null;
		dismissAnnotationPopup();
	}

	// ── Keyboard ──
	function handleKeydown(e: KeyboardEvent) {
		if (showSearch && e.key !== 'Escape') return;
		if (showNoteInput && e.key !== 'Escape') return;
		switch (e.key) {
			case 'ArrowLeft': e.preventDefault(); prevPage(); break;
			case 'ArrowRight': e.preventDefault(); nextPage(); break;
			case 'Escape':
				e.preventDefault();
				if (showAnnotationPopup) dismissAnnotationPopup();
				else if (showShortcuts) showShortcuts = false;
				else if (anyPanelOpen || highlightPopup) closeAllPanels();
				else closeReader();
				break;
			case 'f': if (!e.ctrlKey && !e.metaKey) toggleFullscreen(); break;
			case 't': if (!e.ctrlKey && !e.metaKey) { showToc = !showToc; if (showToc) { showSettings = false; showBookmarks = false; showSearch = false; } } break;
			case 's': if (!e.ctrlKey && !e.metaKey) { showSettings = !showSettings; if (showSettings) { showToc = false; showBookmarks = false; showSearch = false; } } break;
			case 'b': if (!e.ctrlKey && !e.metaKey) toggleBookmark(); break;
			case '?': showShortcuts = !showShortcuts; break;
			case '/': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); showSearch = !showSearch; showToc = false; showSettings = false; showBookmarks = false; } break;
		}
	}

	// ── Svelte action for foliate-js lifecycle ──
	function initFoliateReader(node: HTMLElement) {
		// Hydrate settings from localStorage before the view opens
		settings = loadReaderSettings();

		// Sync initial prop values
		currentProgress = initialProgress;
		bookmarkList = [...initialBookmarks];
		highlightList = [...initialHighlights];

		const handleFs = () => { isFullscreen = !!document.fullscreenElement; };
		document.addEventListener('fullscreenchange', handleFs);

		let destroyed = false;
		let viewInstance: any = null;

		(async () => {
			try {
				// Import the foliate-view custom element (registers itself)
				await import('$lib/vendor/foliate-js/view.js');

				if (destroyed) return;

				// Create and mount the foliate-view custom element
				viewInstance = document.createElement('foliate-view') as any;
				viewInstance.style.cssText = 'width: 100%; height: 100%;';
				node.appendChild(viewInstance);

				// Open the book from URL (makeBook handles fetch internally)
				await viewInstance.open(epubUrl);

				if (destroyed) return;

				view = viewInstance;

				// Extract TOC
				const bookObj = viewInstance.book;
				if (bookObj?.toc) {
					toc = flattenToc(bookObj.toc);
				}

				// Set flow mode
				viewInstance.renderer.setAttribute('flow', flow);

				// Apply reading styles
				applyStyles();

				// Handle load events (new section loaded)
				viewInstance.addEventListener('load', (e: CustomEvent) => {
					if (destroyed) return;
					const { doc } = e.detail;
					doc.addEventListener('mousemove', () => handleReaderMouseMove());
					doc.addEventListener('keydown', (ke: KeyboardEvent) => handleKeydown(ke));

					// Text selection → annotation popup
					doc.addEventListener('mouseup', () => {
						const sel = doc.getSelection?.() ?? window.getSelection();
						if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
						const text = sel.toString().trim();
						// Try to get CFI from foliate view
						let cfi = '';
						try {
							cfi = viewInstance.getCFI?.(sel.getRangeAt(0)) ?? currentCfi;
						} catch {
							cfi = currentCfi;
						}
						const range = sel.getRangeAt(0);
						const rect = range.getBoundingClientRect();
						// Offset by iframe position if embedded
						const iframes = node.querySelectorAll('iframe');
						let offsetX = 0, offsetY = 0;
						if (iframes.length > 0) {
							const iframeRect = iframes[0].getBoundingClientRect();
							offsetX = iframeRect.left;
							offsetY = iframeRect.top;
						}
						handleTextSelection(
							cfi,
							text,
							rect.left + rect.width / 2 + offsetX,
							rect.bottom + 8 + offsetY
						);
					});
				});

				// Handle relocate events (position changed)
				viewInstance.addEventListener('relocate', (e: CustomEvent) => {
					if (destroyed) return;
					const location = e.detail;
					if (location.cfi) currentCfi = location.cfi;
					if (location.fraction != null) {
						currentProgress = location.fraction;
					}
					if (location.tocItem?.label) {
						currentChapter = typeof location.tocItem.label === 'object'
							? Object.values(location.tocItem.label)[0] as string
							: location.tocItem.label;
					}
					// Estimate total pages from section count or spine
					if (location.total) {
						totalPages = location.total;
					} else if (bookObj?.spine?.length && !totalPages) {
						totalPages = bookObj.spine.length * 15; // rough estimate
					}
				});

				// Navigate to saved position or start
				if (savedPosition) {
					await viewInstance.init({ lastLocation: savedPosition });
				} else {
					await viewInstance.init({ showTextStart: true });
				}

				// Compute chapter positions for progress bar
				if (bookObj?.toc && bookObj?.spine) {
					const spineLength = bookObj.spine.length || 1;
					chapterPositions = flattenToc(bookObj.toc).map((ch, i) => ({
						position: Math.min(1, i / Math.max(1, spineLength)),
						title: ch.label
					}));
				}

				// Apply existing highlights to the view
				applyHighlightsToView();

				ready = true;
				loading = false;
				startHideTimer();

			} catch (err) {
				console.error('Failed to initialize EPUB reader:', err);
				if (!destroyed) {
					loadError = err instanceof Error ? err.message : 'Failed to load book';
					loading = false;
				}
			}
		})();

		return {
			destroy() {
				destroyed = true;
				document.removeEventListener('fullscreenchange', handleFs);
				if (viewInstance) {
					try { viewInstance.close(); } catch { /* ignore */ }
					try { viewInstance.remove(); } catch { /* ignore */ }
				}
				view = null;
				ready = false;
				if (hideTimer) clearTimeout(hideTimer);
			}
		};
	}

	// Re-apply styles on settings change
	$effect(() => {
		void readerTheme; void fontFamily; void fontSize; void lineHeight; void margins; void textAlign;
		if (view && ready) applyStyles();
	});

	// Handle flow + direction changes — drive the foliate renderer directly.
	$effect(() => {
		if (!view?.renderer) return;
		view.renderer.setAttribute('flow', settings.flow);
		view.renderer.setAttribute('dir', settings.direction);
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
		<div class="truncate font-display text-sm font-medium text-cream/90">{book.title}</div>
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

		<!-- Format switcher -->
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
	<!-- foliate-js container, wrapped by PaginatedViewport for shared input/animation behavior -->
	<div class="absolute" style="top: 0; bottom: 0; left: 0; right: 0;">
		<PaginatedViewport
			{settings}
			onPrev={() => view?.prev()}
			onNext={() => view?.next()}
			onToggleUI={() => { showSettings = !showSettings; }}
		>
			{#snippet children(_ctx: { effectiveSpread: 'single' | 'dual'; animationKey: number })}
				<div
					use:initFoliateReader
					class="h-full w-full overflow-hidden"
				></div>
			{/snippet}
		</PaginatedViewport>
	</div>

	<!-- Click zone overlay for navigation (only outside the iframe) -->
	<button
		class="absolute left-0 top-12 z-10 w-[20%] cursor-w-resize opacity-0"
		style="bottom: 52px;"
		onclick={prevPage}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		aria-label="Previous page"
	></button>
	<button
		class="absolute right-0 top-12 z-10 w-[20%] cursor-e-resize opacity-0"
		style="bottom: 52px;"
		onclick={nextPage}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		aria-label="Next page"
	></button>
</div>

<!-- Bottom Progress Bar -->
<div
	class="fixed inset-x-0 bottom-0 z-[60] transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:translate-y-full={!showToolbar}
>
	<div class="flex items-center gap-2 px-4 pb-1 pt-2" style="background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 70%, transparent 100%);">
		<button onclick={prevPage} class="rounded p-1 text-cream/50 transition-colors hover:text-cream" aria-label="Previous page">
			<ChevronLeft size={16} strokeWidth={1.5} />
		</button>

		<div class="flex-1">
			<ReaderProgressBar
				progress={currentProgress}
				chapters={chapterPositions}
				currentPage={currentPage}
				{totalPages}
				onSeek={handleProgressBarSeek}
			/>
		</div>

		<button onclick={nextPage} class="rounded p-1 text-cream/50 transition-colors hover:text-cream">
			<ChevronRight size={16} strokeWidth={1.5} />
		</button>
	</div>

	{#if totalPages > 0 && remainingPages > 0}
		<div class="flex justify-center pb-2" style="background: rgba(0,0,0,0.5);">
			<TimeEstimate {remainingPages} />
		</div>
	{/if}
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
				<span class="settings-label">Theme</span>
				<div class="grid grid-cols-4 gap-2">
					{#each [{ key: 'light', label: 'Light', bg: '#faf8f5', ring: '#ccc' }, { key: 'sepia', label: 'Sepia', bg: '#f4ecd8', ring: '#c4a96a' }, { key: 'dark', label: 'Dark', bg: '#181514', ring: '#555' }, { key: 'night', label: 'OLED', bg: '#000000', ring: '#333' }] as { key, label, bg, ring } (key)}
						<button
							class="flex flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-[10px] transition-all {readerTheme === key ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/40 hover:border-cream/20 hover:text-cream/60'}"
							onclick={() => { settings.theme = key as ReaderSettings['theme']; }}
						>
							<span
								class="h-5 w-5 rounded-full border-2"
								style="background-color: {bg}; border-color: {readerTheme === key ? 'var(--color-accent)' : ring};"
							></span>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Font Family -->
			<div class="mb-5">
				<span class="settings-label">Font</span>
				<div class="grid grid-cols-4 gap-1.5">
					{#each [{ key: 'serif', label: 'Serif', font: 'Georgia, serif' }, { key: 'sans', label: 'Sans', font: 'system-ui, sans-serif' }, { key: 'mono', label: 'Mono', font: "'JetBrains Mono', monospace" }, { key: 'dyslexic', label: 'Display', font: "'Playfair Display', Georgia, serif" }] as { key, label, font } (key)}
						<button
							class="rounded-lg border px-2 py-2 text-xs transition-all {fontFamily === key ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50 hover:border-cream/20 hover:text-cream/70'}"
							style="font-family: {font};"
							onclick={() => { settings.fontFamily = key as ReaderSettings['fontFamily']; }}
						>{label}</button>
					{/each}
				</div>
			</div>

			<!-- Font Size -->
			<div class="mb-5">
				<label for="reader-font-size" class="settings-label flex items-center justify-between">
					<span>Font Size</span>
					<span class="normal-case tracking-normal text-cream/60">{fontSize}px</span>
				</label>
				<div class="flex items-center gap-3">
					<Type size={12} class="shrink-0 text-cream/30" />
					<input id="reader-font-size" type="range" min="12" max="36" step="1" bind:value={settings.fontSize} class="reader-range flex-1" />
					<Type size={20} class="shrink-0 text-cream/30" />
				</div>
			</div>

			<!-- Line Height -->
			<div class="mb-5">
				<label for="reader-line-height" class="settings-label flex items-center justify-between">
					<span>Line Height</span>
					<span class="normal-case tracking-normal text-cream/60">{lineHeight.toFixed(1)}</span>
				</label>
				<input id="reader-line-height" type="range" min="1.0" max="2.0" step="0.1" bind:value={settings.lineHeight} class="reader-range w-full" />
			</div>

			<!-- Margins -->
			<div class="mb-5">
				<span class="settings-label">Margins</span>
				<div class="flex gap-2">
					{#each [{ key: 'narrow', label: 'Narrow' }, { key: 'normal', label: 'Medium' }, { key: 'wide', label: 'Wide' }] as { key, label } (key)}
						<button
							class="flex-1 rounded-lg border px-3 py-2 text-xs transition-all {margins === key ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50 hover:border-cream/20 hover:text-cream/70'}"
							onclick={() => { settings.margins = key as ReaderSettings['margins']; }}
						>{label}</button>
					{/each}
				</div>
			</div>

			<!-- Text Alignment -->
			<div class="mb-5">
				<span class="settings-label">Alignment</span>
				<div class="flex gap-2">
					<button
						class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all {textAlign === 'start' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50 hover:border-cream/20 hover:text-cream/70'}"
						onclick={() => { settings.textAlign = 'start'; }}
					>
						<AlignLeft size={13} strokeWidth={1.5} /> Left
					</button>
					<button
						class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all {textAlign === 'justify' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-cream/[0.08] text-cream/50 hover:border-cream/20 hover:text-cream/70'}"
						onclick={() => { settings.textAlign = 'justify'; }}
					>
						<AlignJustify size={13} strokeWidth={1.5} /> Justified
					</button>
				</div>
			</div>

			<!-- Shared paginated / flow / spread / inputs / direction panel -->
			<ReaderSettingsPanel bind:settings variant="epub" />
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
							onclick={() => { view?.goTo(bm.cfi); showBookmarks = false; }}
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
								onclick={() => { view?.goTo(hl.cfi); showBookmarks = false; }}
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
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search in book..."
						class="flex-1 bg-transparent text-sm text-cream outline-none placeholder:text-cream/30"
						onkeydown={(e) => { if (e.key === 'Enter') doSearch(); }}
						autofocus
					/>
					{#if searching}
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-cream/10 border-t-[var(--color-accent)]"></div>
					{/if}
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
								<span class="line-clamp-2">{result.excerpt}</span>
							</button>
						{/each}
					</div>
				{:else if searchQuery && !searching}
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

<!-- Annotation Popup (text selection) -->
{#if showAnnotationPopup}
	<div class="fixed z-[90]">
		{#if showNoteInput}
			<!-- Note input overlay -->
			<div class="fixed inset-0 z-[90] bg-black/40" onclick={dismissAnnotationPopup} onkeydown={(e) => { if (e.key === 'Escape') dismissAnnotationPopup(); }} role="button" tabindex="-1" aria-label="Close note input">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="absolute left-1/2 top-1/3 w-80 max-w-[90vw] -translate-x-1/2 rounded-xl border border-cream/10 p-4 shadow-2xl"
					style="background: rgba(20, 18, 16, 0.97); backdrop-filter: blur(24px);"
					onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
				>
					<div class="mb-2 text-xs font-medium text-cream/50">Add a note</div>
					<div class="mb-3 line-clamp-2 text-xs italic text-cream/30">"{selectedText}"</div>
					<textarea
						bind:value={noteContent}
						class="mb-3 w-full resize-none rounded-lg border border-cream/10 bg-cream/[0.04] p-2.5 text-sm text-cream outline-none placeholder:text-cream/30 focus:border-[var(--color-accent)]/50"
						rows="3"
						placeholder="Write your note..."
					></textarea>
					<div class="flex justify-end gap-2">
						<button
							onclick={dismissAnnotationPopup}
							class="rounded-lg px-3 py-1.5 text-xs text-cream/50 transition-colors hover:text-cream"
						>Cancel</button>
						<button
							onclick={submitNote}
							class="rounded-lg bg-[var(--color-accent)]/20 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/30"
							disabled={!noteContent.trim()}
						>Save Note</button>
					</div>
				</div>
			</div>
		{:else}
			<AnnotationPopup
				x={popupX}
				y={popupY}
				onHighlight={handleAnnotationHighlight}
				onNote={handleAnnotationNote}
				onCopy={handleAnnotationCopy}
				onSearch={handleAnnotationSearch}
				onDismiss={dismissAnnotationPopup}
			/>
		{/if}
	</div>
{/if}

<!-- Keyboard Shortcuts Overlay -->
<KeyboardShortcuts
	shortcuts={readerShortcuts}
	visible={showShortcuts}
	onClose={() => showShortcuts = false}
/>

<!-- Format menu backdrop -->
{#if showFormatMenu}
	<div class="fixed inset-0 z-[59]" onclick={() => showFormatMenu = false} onkeydown={(e) => { if (e.key === 'Escape') showFormatMenu = false; }} role="button" tabindex="-1" aria-label="Close format menu"></div>
{/if}

<!-- Loading state -->
{#if loading}
	<div class="fixed inset-0 z-[55] flex items-center justify-center" style="background-color: {themes[readerTheme].bg};">
		<div class="text-center">
			<div class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cream/10 border-t-[var(--color-accent)]"></div>
			<p class="text-sm text-cream/50">Loading book...</p>
		</div>
	</div>
{/if}

<!-- Error state -->
{#if loadError}
	<div class="fixed inset-0 z-[55] flex items-center justify-center" style="background-color: {themes[readerTheme].bg};">
		<div class="text-center">
			<div class="mx-auto mb-3 text-4xl">!</div>
			<p class="mb-2 text-sm text-cream/70">Failed to load book</p>
			<p class="mb-4 text-xs text-cream/40">{loadError}</p>
			<button
				onclick={closeReader}
				class="rounded-lg border border-cream/10 px-4 py-2 text-sm text-cream/60 transition-colors hover:bg-cream/[0.04] hover:text-cream"
			>Go back</button>
		</div>
	</div>
{/if}

<style>
	/* Settings panel label style */
	.settings-label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted, rgba(255, 255, 255, 0.4));
	}

	/* Custom range slider */
	.reader-range {
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
		outline: none;
	}
	.reader-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-accent, #d4a253);
		cursor: pointer;
		border: 2px solid rgba(0, 0, 0, 0.3);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
		transition: transform 0.15s ease;
	}
	.reader-range::-webkit-slider-thumb:hover {
		transform: scale(1.15);
	}
	.reader-range::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-accent, #d4a253);
		cursor: pointer;
		border: 2px solid rgba(0, 0, 0, 0.3);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
	.reader-range::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
	}
</style>
