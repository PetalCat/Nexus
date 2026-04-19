<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { BookBookmark, BookHighlight } from '$lib/db/schema';
	// Type-only imports — pdfjs-dist is a ~400 KB chunk, so we defer the
	// actual module load until initPdf() runs. See the `pdfjs` variable
	// below for the lazily-loaded module handle.
	import type { PDFDocumentProxy, PageViewport, RenderTask } from 'pdfjs-dist';
	import { Loader2 } from 'lucide-svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import PdfToolbar from './PdfToolbar.svelte';
	import PdfSidebar from './PdfSidebar.svelte';
	import ReaderProgressBar from './ReaderProgressBar.svelte';
	import TimeEstimate from './TimeEstimate.svelte';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import ReadingRuler from './ReadingRuler.svelte';
	import KeyboardShortcuts from './KeyboardShortcuts.svelte';
	import PdfMinimap from './PdfMinimap.svelte';
	import MarginNotes from './MarginNotes.svelte';

	// ── Props ──────────────────────────────────────────────────────
	interface Props {
		fileUrl: string;
		book: UnifiedMedia;
		serviceId: string;
		format: string;
		initialProgress?: number;
		savedPosition?: string;
		availableFormats?: string[];
		bookmarks?: BookBookmark[];
		highlights?: BookHighlight[];
	}

	let {
		fileUrl,
		book,
		serviceId,
		format,
		initialProgress = 0,
		savedPosition,
		availableFormats = [],
		bookmarks = [],
		highlights = []
	}: Props = $props();

	// ── Lazy pdfjs-dist handle ─────────────────────────────────────
	// Populated by initPdf() via dynamic import so the ~400 KB pdfjs
	// bundle only loads on this route (not e.g. when opening an EPUB).
	let pdfjs: typeof import('pdfjs-dist') | null = null;

	// ── Core state ─────────────────────────────────────────────────
	let pdfDoc = $state<PDFDocumentProxy | null>(null);
	let numPages = $state(0);
	let currentPage = $state(1);
	let scale = $state(1);
	let fitMode = $state<'width' | 'page' | 'custom'>('width');
	let showToolbar = $state(true);
	let showSidebar = $state(false);
	let spreadMode = $state<'single' | 'dual'>('single');
	let darkMode = $state<'light' | 'dark' | 'sepia'>('light');
	let showRuler = $state(false);
	let showShortcuts = $state(false);
	let isFullscreen = $state(false);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let loadProgress = $state(0);
	let pdfOutline = $state<Array<{ title: string; dest: any; items?: any[] }>>([]);
	let searchQuery = $state('');
	let searchResults = $state<Array<{ page: number; text: string }>>([]);
	let searchResultCount = $derived(searchResults.length);
	let searchIndex = $state(0);
	let prevScale = $state(1);

	// ── Annotation state ──────────────────────────────────────────
	let showAnnotationPopup = $state(false);
	let annotationPopupX = $state(0);
	let annotationPopupY = $state(0);
	let selectedText = $state('');
	let selectedPage = $state(0);
	let showNoteInput = $state(false);
	let noteInputText = $state('');
	let localHighlights = $state<Array<{ page: number; text: string; color: string }>>([]);
	let localBookmarks = new SvelteSet<number>();
	let isBookmarked = $derived(localBookmarks.has(currentPage));
	let highlightedPages = $derived(new Set(localHighlights.map((h) => h.page)));
	let highlightedPagesList = $derived(localHighlights.map((h) => h.page));
	let bookmarkedPagesList = $derived([...localBookmarks]);

	// ── Reading ruler state ──────────────────────────────────────
	let rulerY = $state(0);

	// ── Margin notes data ────────────────────────────────────────
	let marginHighlights = $derived(
		localHighlights.map((h) => ({ page: h.page, text: h.text, color: h.color, createdAt: undefined as number | undefined }))
	);
	let marginNotes = $state<Array<{ page: number; content: string; createdAt?: number }>>([]);

	// ── Keyboard shortcuts list ──────────────────────────────────
	const shortcuts = [
		{ label: 'Next page', key: '\u2192' },
		{ label: 'Previous page', key: '\u2190' },
		{ label: 'Toggle sidebar', key: 'S' },
		{ label: 'Bookmark page', key: 'B' },
		{ label: 'Search', key: '\u2318F' },
		{ label: 'Zoom in', key: '\u2318+' },
		{ label: 'Zoom out', key: '\u2318-' },
		{ label: 'Fullscreen', key: 'F' },
		{ label: 'Dark mode', key: 'D' },
		{ label: 'Reading ruler', key: 'R' },
		{ label: 'Shortcuts', key: '?' }
	];

	// ── Internal refs & tracking ───────────────────────────────────
	let viewportEl = $state<HTMLDivElement | null>(null);
	let pageWrappers: HTMLDivElement[] = [];
	let canvasRefs: (HTMLCanvasElement | null)[] = [];
	let textLayerRefs: (HTMLDivElement | null)[] = [];
	let renderedPages = new SvelteSet<number>();
	let renderingPages = new SvelteSet<number>();
	let activeRenderTasks = new SvelteMap<number, RenderTask>();
	let pageViewports: PageViewport[] = [];
	let observer: IntersectionObserver | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Chrome auto-hide ──
	let chromeVisible = $state(true);
	let lastActivity = $state(Date.now());

	$effect(() => {
		if (!browser) return;
		const interval = setInterval(() => {
			if (Date.now() - lastActivity > 2000 && !showSidebar) {
				chromeVisible = false;
			}
		}, 250);
		return () => clearInterval(interval);
	});

	// Keep chrome forced visible whenever the sidebar is open
	$effect(() => {
		if (showSidebar) chromeVisible = true;
	});

	$effect(() => {
		if (!browser) return;
		function onActivity(e: Event) {
			lastActivity = Date.now();
			chromeVisible = true;
		}
		window.addEventListener('pointermove', onActivity);
		window.addEventListener('pointerdown', onActivity);
		window.addEventListener('wheel', onActivity);
		window.addEventListener('keydown', onActivity);
		return () => {
			window.removeEventListener('pointermove', onActivity);
			window.removeEventListener('pointerdown', onActivity);
			window.removeEventListener('wheel', onActivity);
			window.removeEventListener('keydown', onActivity);
		};
	});
	let renderQueue: number[] = [];
	let isProcessingQueue = false;
	const MAX_CONCURRENT_RENDERS = 3;
	const BUFFER_PAGES = 3;

	// ── Derived ────────────────────────────────────────────────────
	let progress = $derived(numPages > 0 ? currentPage / numPages : 0);
	let progressPercent = $derived(Math.round(progress * 100));
	let remainingPages = $derived(Math.max(0, numPages - currentPage));

	// Page pairs for dual-spread mode: [[1], [2,3], [4,5], ...]
	let pagePairs = $derived.by(() => {
		if (numPages === 0) return [];
		const pairs: number[][] = [];
		// First page solo as cover
		pairs.push([1]);
		for (let i = 2; i <= numPages; i += 2) {
			if (i + 1 <= numPages) {
				pairs.push([i, i + 1]);
			} else {
				pairs.push([i]);
			}
		}
		return pairs;
	});

	// ── Navigation ─────────────────────────────────────────────────
	function closeReader() {
		goto(`/media/book/${book.sourceId}?service=${serviceId}`);
	}

	function toggleFullscreen() {
		if (!browser) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			document.documentElement.requestFullscreen();
		}
	}

	function goToPage(page: number) {
		if (page < 1 || page > numPages || !viewportEl) return;
		if (spreadMode === 'dual') {
			// Find the pair container that contains this page
			const pairIdx = page === 1 ? 0 : Math.ceil((page - 1) / 2);
			const pairEl = viewportEl.querySelector(`[data-pair="${pairIdx}"]`);
			if (pairEl) {
				pairEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		} else {
			const wrapper = pageWrappers[page - 1];
			if (wrapper) {
				wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	/** In dual mode, jump by 2 pages; in single mode, jump by 1 */
	function pageStep(): number {
		return spreadMode === 'dual' ? 2 : 1;
	}

	// ── Zoom functions ────────────────────────────────────────────
	function zoomIn() {
		fitMode = 'custom';
		scale = Math.min(5.0, scale * 1.25);
	}

	function zoomOut() {
		fitMode = 'custom';
		scale = Math.max(0.25, scale * 0.8);
	}

	function fitWidth() {
		if (!pdfDoc || pageViewports.length === 0) return;
		const vp = pageViewports[0];
		const containerWidth = (viewportEl?.clientWidth ?? 800) - 80;
		if (spreadMode === 'dual') {
			// Fit two pages side-by-side with 16px gap
			scale = (containerWidth - 16) / (2 * vp.width);
		} else {
			scale = containerWidth / vp.width;
		}
		fitMode = 'width';
	}

	function fitPage() {
		if (!pdfDoc || pageViewports.length === 0 || !viewportEl) return;
		const vp = pageViewports[0];
		const containerWidth = viewportEl.clientWidth - 80;
		const containerHeight = viewportEl.clientHeight - 80;
		let scaleW: number;
		if (spreadMode === 'dual') {
			scaleW = (containerWidth - 16) / (2 * vp.width);
		} else {
			scaleW = containerWidth / vp.width;
		}
		const scaleH = containerHeight / vp.height;
		scale = Math.min(scaleW, scaleH);
		fitMode = 'page';
	}

	function handleFitMode(mode: 'width' | 'page') {
		if (mode === 'width') fitWidth();
		else fitPage();
	}

	function handleSpreadMode(mode: 'single' | 'dual') {
		spreadMode = mode;
		// Recalculate scale for the new spread mode
		if (fitMode === 'width') fitWidth();
		else if (fitMode === 'page') fitPage();
	}

	function handleDarkMode(mode: 'light' | 'dark' | 'sepia') {
		darkMode = mode;
	}

	async function searchDocument(query: string) {
		if (!pdfDoc || !query.trim()) {
			searchResults = [];
			searchIndex = 0;
			return;
		}
		const results: Array<{ page: number; text: string }> = [];
		for (let i = 1; i <= numPages; i++) {
			const page = await pdfDoc.getPage(i);
			const content = await page.getTextContent();
			const pageText = content.items.map((item: any) => item.str).join(' ');
			const lowerQuery = query.toLowerCase();
			const lowerText = pageText.toLowerCase();
			let idx = lowerText.indexOf(lowerQuery);
			while (idx !== -1) {
				const start = Math.max(0, idx - 40);
				const end = Math.min(pageText.length, idx + query.length + 40);
				results.push({
					page: i,
					text: '...' + pageText.substring(start, end) + '...'
				});
				idx = lowerText.indexOf(lowerQuery, idx + 1);
			}
		}
		searchResults = results;
		searchIndex = results.length > 0 ? 0 : -1;
		if (results.length > 0) {
			goToPage(results[0].page);
		}
	}

	function handleSearch(query: string) {
		searchQuery = query;
		searchDocument(query);
	}

	function handleSearchNext() {
		if (searchResultCount > 0) {
			searchIndex = (searchIndex + 1) % searchResultCount;
			goToPage(searchResults[searchIndex].page);
		}
	}

	function handleSearchPrev() {
		if (searchResultCount > 0) {
			searchIndex = (searchIndex - 1 + searchResultCount) % searchResultCount;
			goToPage(searchResults[searchIndex].page);
		}
	}

	async function handleBookmark() {
		const page = currentPage;
		if (localBookmarks.has(page)) {
			// Remove bookmark
			localBookmarks.delete(page);
			// Find and delete from server
			const existing = bookmarks.find((b) => b.cfi === `pdf:${page}`);
			if (existing) {
				await fetch(`/api/books/${book.sourceId}/bookmarks/${existing.id}`, { method: 'DELETE' });
			}
		} else {
			// Add bookmark
			localBookmarks.add(page);
			try {
				const res = await fetch(`/api/books/${book.sourceId}/bookmarks`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						cfi: `pdf:${page}`,
						label: `Page ${page}`,
						serviceId
					})
				});
				if (res.ok) {
					const created = await res.json();
					bookmarks.push(created);
				}
			} catch (err) {
				console.error('Failed to save bookmark:', err);
			}
		}
	}

	// ── Text selection handler ────────────────────────────────────
	function handleTextSelection() {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.toString().trim()) {
			showAnnotationPopup = false;
			return;
		}
		selectedText = sel.toString().trim();
		const range = sel.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		annotationPopupX = rect.left + rect.width / 2;
		annotationPopupY = rect.top - 10;

		// Find page number from closest ancestor with data-page
		const pageEl = range.startContainer.parentElement?.closest('[data-page]');
		selectedPage = pageEl ? Number((pageEl as HTMLElement).dataset.page) : currentPage;

		showAnnotationPopup = true;
	}

	function dismissAnnotationPopup() {
		showAnnotationPopup = false;
		showNoteInput = false;
		noteInputText = '';
		window.getSelection()?.removeAllRanges();
	}

	// ── Annotation actions ────────────────────────────────────────
	async function handleHighlight(color: string) {
		if (!selectedText) return;
		localHighlights.push({ page: selectedPage, text: selectedText, color });
		dismissAnnotationPopup();

		try {
			await fetch(`/api/books/${book.sourceId}/highlights`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cfi: `pdf:${selectedPage}`,
					text: selectedText,
					color,
					chapter: `Page ${selectedPage}`,
					serviceId
				})
			});
		} catch (err) {
			console.error('Failed to save highlight:', err);
		}
	}

	function handleAnnotationNote() {
		showNoteInput = true;
		showAnnotationPopup = false;
	}

	async function submitNote() {
		if (!noteInputText.trim()) return;
		const content = noteInputText.trim();
		showNoteInput = false;
		noteInputText = '';
		window.getSelection()?.removeAllRanges();

		try {
			await fetch(`/api/books/${book.sourceId}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cfi: `pdf:${selectedPage}`,
					chapter: `Page ${selectedPage}`,
					content,
					serviceId
				})
			});
		} catch (err) {
			console.error('Failed to save note:', err);
		}
	}

	function handleAnnotationCopy() {
		if (selectedText) {
			navigator.clipboard.writeText(selectedText);
		}
		dismissAnnotationPopup();
	}

	function handleAnnotationSearch() {
		if (selectedText) {
			handleSearch(selectedText);
		}
		dismissAnnotationPopup();
	}

	function handleProgressSeek(position: number) {
		const targetPage = Math.max(1, Math.min(numPages, Math.round(position * numPages)));
		goToPage(targetPage);
	}

	// ── Toolbar auto-hide ──────────────────────────────────────────
	function resetHideTimer() {
		showToolbar = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => { showToolbar = false; }, 4000);
	}

	function handleMouseMove(e: MouseEvent) {
		rulerY = e.clientY;
		resetHideTimer();
	}

	// ── Keyboard shortcuts ─────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				closeReader();
				break;
			case 'f':
				if (!e.ctrlKey && !e.metaKey) toggleFullscreen();
				break;
			case 'ArrowDown':
			case 'PageDown':
				e.preventDefault();
				goToPage(currentPage + pageStep());
				break;
			case 'ArrowUp':
			case 'PageUp':
				e.preventDefault();
				goToPage(currentPage - pageStep());
				break;
			case 'Home':
				e.preventDefault();
				goToPage(1);
				break;
			case 'End':
				e.preventDefault();
				goToPage(numPages);
				break;
			case '+':
			case '=':
				if (e.ctrlKey || e.metaKey) {
					e.preventDefault();
					zoomIn();
				}
				break;
			case '-':
				if (e.ctrlKey || e.metaKey) {
					e.preventDefault();
					zoomOut();
				}
				break;
			case 's':
				if (!e.ctrlKey && !e.metaKey) {
					showSidebar = !showSidebar;
				}
				break;
			case 'b':
				if (!e.ctrlKey && !e.metaKey) handleBookmark();
				break;
			case 'd':
				if (!e.ctrlKey && !e.metaKey) {
					const modes: Array<'light' | 'dark' | 'sepia'> = ['light', 'dark', 'sepia'];
					const idx = modes.indexOf(darkMode);
					darkMode = modes[(idx + 1) % modes.length];
				}
				break;
			case 'r':
				if (!e.ctrlKey && !e.metaKey) showRuler = !showRuler;
				break;
			case '?':
				showShortcuts = !showShortcuts;
				break;
		}
	}

	// ── Scroll tracking ────────────────────────────────────────────
	function handleScroll() {
		if (!viewportEl || numPages === 0) return;

		// Debounce scroll tracking
		if (scrollTimer) clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => {
			detectCurrentPage();
			scheduleBufferRender();
		}, 50);
	}

	function detectCurrentPage() {
		if (!viewportEl) return;
		const scrollTop = viewportEl.scrollTop;
		const viewportMid = scrollTop + viewportEl.clientHeight / 3;

		for (let i = 0; i < pageWrappers.length; i++) {
			const wrapper = pageWrappers[i];
			if (!wrapper) continue;
			const top = wrapper.offsetTop;
			const bottom = top + wrapper.offsetHeight;
			if (viewportMid >= top && viewportMid < bottom) {
				currentPage = i + 1;
				return;
			}
		}
	}

	// ── Render queue management ────────────────────────────────────
	function enqueueRender(pageNum: number) {
		if (renderedPages.has(pageNum) || renderingPages.has(pageNum) || renderQueue.includes(pageNum)) return;
		renderQueue.push(pageNum);
		processRenderQueue();
	}

	async function processRenderQueue() {
		if (isProcessingQueue) return;
		isProcessingQueue = true;

		while (renderQueue.length > 0 && renderingPages.size < MAX_CONCURRENT_RENDERS) {
			const pageNum = renderQueue.shift();
			if (!pageNum || renderedPages.has(pageNum) || renderingPages.has(pageNum)) continue;
			renderPage(pageNum);
		}

		isProcessingQueue = false;
	}

	function scheduleBufferRender() {
		const start = Math.max(1, currentPage - BUFFER_PAGES);
		const end = Math.min(numPages, currentPage + BUFFER_PAGES);

		// Clean up pages outside the buffer
		for (const pageNum of renderedPages) {
			if (pageNum < start - 1 || pageNum > end + 1) {
				cleanupPage(pageNum);
			}
		}

		// Enqueue pages in the buffer
		for (let i = start; i <= end; i++) {
			enqueueRender(i);
		}
	}

	function clearTextLayer(el: HTMLDivElement) {
		while (el.firstChild) {
			el.removeChild(el.firstChild);
		}
	}

	function cleanupPage(pageNum: number) {
		const idx = pageNum - 1;
		const canvas = canvasRefs[idx];
		if (canvas) {
			const ctx = canvas.getContext('2d');
			if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
			canvas.width = 0;
			canvas.height = 0;
		}
		const textDiv = textLayerRefs[idx];
		if (textDiv) {
			clearTextLayer(textDiv);
		}

		// Cancel any in-progress render
		const task = activeRenderTasks.get(pageNum);
		if (task) {
			task.cancel();
			activeRenderTasks.delete(pageNum);
		}

		renderedPages.delete(pageNum);
		renderingPages.delete(pageNum);
	}

	// ── Invalidate all rendered pages (for scale change) ──────────
	function invalidateAllPages() {
		for (const pageNum of [...renderedPages]) {
			cleanupPage(pageNum);
		}
		renderQueue = [];
		scheduleBufferRender();
	}

	// ── Page rendering ─────────────────────────────────────────────
	async function renderPage(pageNum: number) {
		if (!pdfDoc || !pdfjs || renderedPages.has(pageNum) || renderingPages.has(pageNum)) return;

		const idx = pageNum - 1;
		const canvas = canvasRefs[idx];
		const textDiv = textLayerRefs[idx];
		if (!canvas || !textDiv) return;

		renderingPages.add(pageNum);

		try {
			const page = await pdfDoc.getPage(pageNum);
			const viewport = page.getViewport({ scale });
			const dpr = window.devicePixelRatio || 1;

			// Size the canvas
			canvas.width = Math.floor(viewport.width * dpr);
			canvas.height = Math.floor(viewport.height * dpr);
			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = `${viewport.height}px`;

			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.scale(dpr, dpr);

			// Render canvas
			const renderTask = page.render({ canvasContext: ctx, viewport, canvas } as any);
			activeRenderTasks.set(pageNum, renderTask);

			await renderTask.promise;
			activeRenderTasks.delete(pageNum);

			// Render text layer
			clearTextLayer(textDiv);
			const textContent = await page.getTextContent();
			const textLayer = new pdfjs.TextLayer({
				container: textDiv,
				textContentSource: textContent,
				viewport: viewport
			});
			await textLayer.render();

			renderedPages.add(pageNum);
		} catch (err: any) {
			if (err?.name === 'RenderingCancelledException') {
				// Expected when scrolling fast
			} else {
				console.error(`Failed to render page ${pageNum}:`, err);
			}
		} finally {
			renderingPages.delete(pageNum);
			activeRenderTasks.delete(pageNum);
			// Process next in queue
			processRenderQueue();
		}
	}

	// ── Calculate fit-width scale ──────────────────────────────────
	async function calculateFitWidthScale(doc: PDFDocumentProxy): Promise<number> {
		const firstPage = await doc.getPage(1);
		const vp = firstPage.getViewport({ scale: 1 });
		const containerWidth = viewportEl?.clientWidth ?? 800;
		return (containerWidth - 80) / vp.width;
	}

	// ── Initialize page viewports (at scale=1 for placeholder sizing) ──
	async function initPageViewports(doc: PDFDocumentProxy) {
		pageViewports = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			pageViewports.push(page.getViewport({ scale: 1 }));
		}
	}

	// ── Load PDF outline ──────────────────────────────────────────
	async function loadOutline(doc: PDFDocumentProxy) {
		try {
			const outline = await doc.getOutline();
			if (outline) {
				pdfOutline = outline.map((item: any) => ({
					title: item.title,
					dest: item.dest,
					items: item.items?.map((child: any) => ({
						title: child.title,
						dest: child.dest,
						items: child.items
					}))
				}));
			}
		} catch {
			// Outline not available
		}
	}

	// ── Initialize PDF ─────────────────────────────────────────────
	async function initPdf() {
		if (!browser) return;

		try {
			loading = true;
			loadError = null;

			// Lazy-load pdfjs-dist (~400 KB) on first reader open so that
			// readers for other formats (EPUB) don't pay the bundle cost.
			if (!pdfjs) {
				try {
					pdfjs = await import('pdfjs-dist');
				} catch (err) {
					console.warn('[PdfReader] failed to load pdfjs-dist', err);
					loadError = 'Failed to load PDF viewer';
					loading = false;
					return;
				}
			}

			pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

			const loadingTask = pdfjs.getDocument(fileUrl);
			loadingTask.onProgress = (data: { loaded: number; total: number }) => {
				if (data.total > 0) {
					loadProgress = data.loaded / data.total;
				}
			};

			const doc = await loadingTask.promise;
			pdfDoc = doc;
			numPages = doc.numPages;

			// Pre-fetch page viewports for sizing
			await initPageViewports(doc);

			// Load outline
			await loadOutline(doc);

			// Calculate fit-width scale
			scale = await calculateFitWidthScale(doc);
			prevScale = scale;

			loading = false;

			// Wait for DOM to update with page placeholders
			await tick();

			// Set up IntersectionObserver for lazy rendering
			setupObserver();

			// Scroll to saved position
			if (savedPosition) {
				const savedPage = parseInt(savedPosition, 10);
				if (savedPage > 0 && savedPage <= numPages) {
					currentPage = savedPage;
					await tick();
					goToPage(savedPage);
				}
			}

			// Trigger initial render of visible pages
			scheduleBufferRender();
		} catch (err: any) {
			console.error('Failed to load PDF:', err);
			loadError = err?.message || 'Failed to load PDF document';
			loading = false;
		}
	}

	function setupObserver() {
		if (!viewportEl) return;

		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target as HTMLElement;
						// Direct page wrapper
						const pageNum = parseInt(el.dataset.page ?? '0', 10);
						if (pageNum > 0) {
							enqueueRender(pageNum);
						}
						// Page pair container — render all pages within
						if (el.dataset.pair !== undefined) {
							const pages = el.querySelectorAll('[data-page]');
							for (const p of pages) {
								const pn = parseInt((p as HTMLElement).dataset.page ?? '0', 10);
								if (pn > 0) enqueueRender(pn);
							}
						}
					}
				}
			},
			{
				root: viewportEl,
				rootMargin: '400px'
			}
		);

		// Observe individual page wrappers
		for (const wrapper of pageWrappers) {
			if (wrapper) observer.observe(wrapper);
		}
		// In dual mode, also observe pair containers
		if (spreadMode === 'dual') {
			const pairs = viewportEl.querySelectorAll('[data-pair]');
			for (const pair of pairs) {
				observer.observe(pair);
			}
		}
	}

	// Svelte tick helper
	async function tick() {
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}

	// ── Initialize annotations from props ─────────────────────────
	$effect(() => {
		if (highlights && highlights.length > 0) {
			for (const h of highlights) {
				const match = h.cfi.match(/^pdf:(\d+)/);
				if (match) {
					const page = +match[1];
					if (!localHighlights.some((lh) => lh.page === page && lh.text === h.text)) {
						localHighlights.push({ page, text: h.text, color: h.color ?? 'yellow' });
					}
				}
			}
		}
		if (bookmarks && bookmarks.length > 0) {
			for (const b of bookmarks) {
				const match = b.cfi.match(/^pdf:(\d+)/);
				if (match) localBookmarks.add(+match[1]);
			}
		}
	});

	// ── Re-render on scale change ─────────────────────────────────
	$effect(() => {
		// Track scale changes — re-render visible pages
		const currentScale = scale;
		if (currentScale !== prevScale && pdfDoc && !loading) {
			// Remember current page before re-render
			const pageToRestore = currentPage;
			prevScale = currentScale;
			invalidateAllPages();
			// After re-render, scroll back to the same page
			requestAnimationFrame(() => {
				goToPage(pageToRestore);
			});
		}
	});

	// ── Re-setup observer on spread mode change ──────────────────
	$effect(() => {
		// Track spreadMode to re-observe when layout changes
		const _mode = spreadMode;
		if (!pdfDoc || loading) return;
		// Wait for DOM to update after spread mode switch
		requestAnimationFrame(() => {
			if (observer) {
				observer.disconnect();
			}
			setupObserver();
			invalidateAllPages();
		});
	});

	// ── Fullscreen listener ────────────────────────────────────────
	$effect(() => {
		if (!browser) return;
		const handleFs = () => { isFullscreen = !!document.fullscreenElement; };
		document.addEventListener('fullscreenchange', handleFs);
		return () => document.removeEventListener('fullscreenchange', handleFs);
	});

	// ── Progress saving (debounced) ───────────────────────────────
	let saveTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const page = currentPage;
		const total = numPages;
		if (!page || !total) return;

		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			fetch(`/api/books/${book.sourceId}/progress`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					progress: page / total,
					page: page,
					serviceId: serviceId
				})
			});
		}, 3000);

		return () => clearTimeout(saveTimer);
	});

	// ── PDF initialization effect ──────────────────────────────────
	$effect(() => {
		if (!browser) return;

		initPdf();

		return () => {
			// Cleanup on unmount
			if (observer) {
				observer.disconnect();
				observer = null;
			}
			for (const [, task] of activeRenderTasks) {
				task.cancel();
			}
			activeRenderTasks.clear();
			if (pdfDoc) {
				pdfDoc.destroy();
			}
			if (hideTimer) clearTimeout(hideTimer);
			if (scrollTimer) clearTimeout(scrollTimer);
		};
	});

	// Helper to get scaled page dimensions
	function getPageDims(pageIdx: number): { width: number; height: number } {
		const vp = pageViewports[pageIdx];
		if (!vp) return { width: 600, height: 800 };
		return {
			width: vp.width * scale,
			height: vp.height * scale
		};
	}

	// Dark mode filter for pages
	let pageFilter = $derived.by(() => {
		switch (darkMode) {
			case 'dark': return 'invert(0.88) hue-rotate(180deg)';
			case 'sepia': return 'sepia(0.3) brightness(0.95)';
			default: return 'none';
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="pdf-reader"
	onmousemove={handleMouseMove}
	role="presentation"
>
	<!-- ── Top Toolbar ─────────────────────────────────────────── -->
	<div class:hidden-chrome={!chromeVisible}>
		<PdfToolbar
			visible={showToolbar}
			bookTitle={book.title}
			bookAuthor={book.metadata?.author as string | undefined}
			{currentPage}
			totalPages={numPages}
			{scale}
			{fitMode}
			{spreadMode}
			{darkMode}
			{showSidebar}
			{searchQuery}
			{searchResultCount}
			{searchIndex}
			{isBookmarked}
			onBack={closeReader}
			onToggleSidebar={() => (showSidebar = !showSidebar)}
			onZoomIn={zoomIn}
			onZoomOut={zoomOut}
			onFitMode={handleFitMode}
			onSpreadMode={handleSpreadMode}
			onDarkMode={handleDarkMode}
			onSearch={handleSearch}
			onSearchNext={handleSearchNext}
			onSearchPrev={handleSearchPrev}
			onBookmark={handleBookmark}
			onToggleShortcuts={() => (showShortcuts = !showShortcuts)}
			onFullscreen={toggleFullscreen}
		/>
	</div>

	<!-- ── Content area (sidebar + viewport) ──────────────────── -->
	<div class="content-area">
		<!-- ── Sidebar ─────────────────────────────────────────── -->
		<PdfSidebar
			visible={showSidebar}
			totalPages={numPages}
			{currentPage}
			outline={pdfOutline}
			onPageClick={goToPage}
		/>

		<!-- ── Main Viewport ──────────────────────────────────── -->
		<div
			class="viewport"
			bind:this={viewportEl}
			onscroll={handleScroll}
			onmouseup={handleTextSelection}
		>
			{#if loading}
				<div class="loading-state">
					<div class="loading-spinner">
						<Loader2 size={32} strokeWidth={1.5} />
					</div>
					<div class="loading-text">Loading PDF...</div>
					{#if loadProgress > 0 && loadProgress < 1}
						<div class="loading-bar-track">
							<div class="loading-bar-fill" style="width: {loadProgress * 100}%"></div>
						</div>
					{/if}
				</div>
			{:else if loadError}
				<div class="error-state">
					<div class="error-icon">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="1.5" stroke-linecap="round">
							<circle cx="12" cy="12" r="10"/>
							<line x1="12" y1="8" x2="12" y2="12"/>
							<line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
					</div>
					<p class="error-title">Failed to load PDF</p>
					<p class="error-detail">{loadError}</p>
					<button onclick={() => initPdf()} class="error-retry">Retry</button>
				</div>
			{:else}
				{#if spreadMode === 'dual'}
					<div class="pages-container spread-dual">
						{#each pagePairs as pair, pairIdx (pairIdx)}
							<div class="page-pair" data-pair={pairIdx}>
								{#each pair as pageNum (pageNum)}
									{@const dims = getPageDims(pageNum - 1)}
									<div
										class="page-wrapper"
										data-page={pageNum}
										style="width: {dims.width}px; height: {dims.height}px; filter: {pageFilter};"
										bind:this={pageWrappers[pageNum - 1]}
									>
										<canvas bind:this={canvasRefs[pageNum - 1]}></canvas>
										<div class="text-layer" bind:this={textLayerRefs[pageNum - 1]}></div>
										{#if !renderedPages.has(pageNum)}
											<div class="page-placeholder">
												<span class="page-placeholder-num">{pageNum}</span>
											</div>
										{/if}
										{#if localBookmarks.has(pageNum)}
											<div class="bookmark-ribbon"></div>
										{/if}
										{#if highlightedPages.has(pageNum)}
											<div class="highlight-indicator"></div>
										{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{:else}
					<div class="pages-container">
						{#each Array(numPages) as _, i (i)}
							{@const dims = getPageDims(i)}
							<div
								class="page-wrapper"
								data-page={i + 1}
								style="width: {dims.width}px; height: {dims.height}px; filter: {pageFilter};"
								bind:this={pageWrappers[i]}
							>
								<canvas bind:this={canvasRefs[i]}></canvas>
								<div class="text-layer" bind:this={textLayerRefs[i]}></div>
								{#if !renderedPages.has(i + 1)}
									<div class="page-placeholder">
										<span class="page-placeholder-num">{i + 1}</span>
									</div>
								{/if}
								{#if localBookmarks.has(i + 1)}
									<div class="bookmark-ribbon"></div>
								{/if}
								{#if highlightedPages.has(i + 1)}
									<div class="highlight-indicator"></div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- ── Reading Ruler ──────────────────────────────────── -->
			<ReadingRuler y={rulerY} visible={showRuler} />

			<!-- ── Minimap ────────────────────────────────────────── -->
			{#if numPages > 0}
				<PdfMinimap
					{numPages}
					{currentPage}
					highlightedPages={highlightedPagesList}
					bookmarkedPages={bookmarkedPagesList}
					onNavigate={goToPage}
				/>
			{/if}
		</div>

		<!-- ── Margin Notes (Tufte sidenotes) ─────────────────── -->
		<MarginNotes
			highlights={marginHighlights}
			notes={marginNotes}
			{currentPage}
		/>
	</div>

	<!-- ── Bottom Bar ─────────────────────────────────────────── -->
	{#if !loading && !loadError && numPages > 0}
		<div
			class="toolbar-bottom"
			class:toolbar-hidden={!showToolbar}
			class:hidden-chrome-bottom={!chromeVisible}
		>
			<ReaderProgressBar
				{progress}
				chapters={[]}
				{currentPage}
				totalPages={numPages}
				onSeek={handleProgressSeek}
			/>
			<div class="bottom-extra">
				<TimeEstimate {remainingPages} />
			</div>
		</div>
	{/if}

	<!-- ── Hairline progress strip (always visible) ─────────── -->
	<div class="hairline" aria-hidden="true">
		<div class="hairline-fill" style="width: {progress * 100}%"></div>
	</div>

	<!-- ── Annotation Popup ───────────────────────────────────── -->
	{#if showAnnotationPopup}
		<AnnotationPopup
			x={annotationPopupX}
			y={annotationPopupY}
			onHighlight={handleHighlight}
			onNote={handleAnnotationNote}
			onCopy={handleAnnotationCopy}
			onSearch={handleAnnotationSearch}
			onDismiss={dismissAnnotationPopup}
		/>
	{/if}

	<!-- ── Note Input Modal ───────────────────────────────────── -->
	{#if showNoteInput}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="note-backdrop" onclick={() => { showNoteInput = false; noteInputText = ''; }} onkeydown={() => {}}></div>
		<div class="note-modal">
			<div class="note-header">Add Note — Page {selectedPage}</div>
			<textarea
				class="note-textarea"
				placeholder="Write your note..."
				bind:value={noteInputText}
				onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNote(); }}
			></textarea>
			<div class="note-actions">
				<button class="note-btn note-cancel" onclick={() => { showNoteInput = false; noteInputText = ''; }}>Cancel</button>
				<button class="note-btn note-save" onclick={submitNote}>Save Note</button>
			</div>
		</div>
	{/if}

	<!-- ── Keyboard Shortcuts Panel ──────────────────────────── -->
	<KeyboardShortcuts
		{shortcuts}
		visible={showShortcuts}
		onClose={() => (showShortcuts = false)}
	/>
</div>

<style>
	/* ── Fullscreen overlay ─────────────────────────────── */
	.pdf-reader {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: var(--color-base);
		font-family: var(--font-body);
	}

	/* ── Content area (sidebar + viewport) ──────────────── */
	.content-area {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	/* ── Main viewport ──────────────────────────────────── */
	.viewport {
		position: relative;
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		background:
			radial-gradient(ellipse at 50% 0%, rgba(212, 162, 83, 0.03) 0%, transparent 60%),
			var(--color-base);
	}

	.pages-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 72px 40px 80px;
	}

	.pages-container.spread-dual {
		gap: 24px;
	}

	.page-pair {
		display: flex;
		justify-content: center;
		gap: 16px;
	}

	/* ── Page wrapper ───────────────────────────────────── */
	.page-wrapper {
		position: relative;
		background: #faf8f5;
		box-shadow: 0 4px 32px rgba(0, 0, 0, 0.5);
		border-radius: 2px;
		overflow: hidden;
		flex-shrink: 0;
		transition: filter 0.3s ease;
	}

	.page-wrapper canvas {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
	}

	/* ── Text layer (invisible text over canvas for selection) ── */
	.text-layer {
		position: absolute;
		left: 0;
		top: 0;
		right: 0;
		bottom: 0;
		overflow: hidden;
		opacity: 0.25;
		line-height: 1;
		z-index: 2;
	}

	.text-layer :global(span) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
	}

	/* ── Page placeholder ───────────────────────────────── */
	.page-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #faf8f5;
		z-index: 1;
	}

	.page-placeholder-num {
		font-family: var(--font-mono);
		font-size: 1.5rem;
		color: #d0ccc6;
		user-select: none;
	}

	/* ── Loading state ──────────────────────────────────── */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 1rem;
		color: var(--color-muted);
	}

	.loading-spinner {
		color: var(--color-accent);
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.loading-text {
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.loading-bar-track {
		width: 200px;
		height: 3px;
		border-radius: 2px;
		background: var(--color-surface);
		overflow: hidden;
	}

	.loading-bar-fill {
		height: 100%;
		border-radius: 2px;
		background: var(--color-accent);
		transition: width 0.2s ease;
	}

	/* ── Error state ────────────────────────────────────── */
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 0.75rem;
	}

	.error-icon {
		margin-bottom: 0.5rem;
	}

	.error-title {
		font-size: 1.125rem;
		font-weight: 500;
		color: var(--color-cream);
	}

	.error-detail {
		font-size: 0.875rem;
		color: var(--color-muted);
		max-width: 400px;
		text-align: center;
	}

	.error-retry {
		margin-top: 0.5rem;
		padding: 0.5rem 1.5rem;
		border: none;
		border-radius: 0.75rem;
		background: var(--color-accent);
		color: var(--color-void);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.error-retry:hover {
		opacity: 0.9;
	}

	/* ── Chrome auto-hide ──────────────────────────────────── */
	.hidden-chrome {
		opacity: 0;
		pointer-events: none;
		transform: translateY(-6px);
		transition: opacity .3s ease, transform .3s ease;
	}
	.hidden-chrome-bottom {
		opacity: 0;
		pointer-events: none;
		transform: translateY(6px);
		transition: opacity .3s ease, transform .3s ease;
	}

	/* ── Hairline progress strip ───────────────────────────── */
	.hairline {
		position: fixed;
		inset: auto 0 0 0;
		height: 2px;
		background: rgba(240, 235, 227, 0.06);
		z-index: 100;
		pointer-events: none;
	}
	.hairline-fill {
		height: 100%;
		background: var(--accent, #d4a253);
		box-shadow: 0 0 6px rgba(212, 162, 83, .5);
		transition: width .3s ease;
	}

	/* ── Bottom toolbar ─────────────────────────────────── */
	.toolbar-bottom {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: linear-gradient(0deg, rgba(13, 11, 10, 0.96), rgba(13, 11, 10, 0.92));
		backdrop-filter: blur(24px) saturate(1.4);
		border-top: 1px solid rgba(240, 235, 227, 0.04);
		transition: opacity 0.3s, transform 0.3s;
	}

	.toolbar-bottom.toolbar-hidden {
		opacity: 0;
		pointer-events: none;
		transform: translateY(100%);
	}

	.bottom-extra {
		display: flex;
		justify-content: center;
		padding: 0 16px 6px;
	}

	/* ── Bookmark ribbon ────────────────────────────────── */
	.bookmark-ribbon {
		position: absolute;
		top: -2px;
		right: 18px;
		width: 22px;
		height: 34px;
		background: var(--color-warm);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
		z-index: 5;
		pointer-events: none;
	}

	/* ── Highlight indicator ───────────────────────────── */
	.highlight-indicator {
		position: absolute;
		top: 8px;
		left: -4px;
		width: 4px;
		height: calc(100% - 16px);
		background: rgba(250, 204, 21, 0.7);
		border-radius: 2px;
		z-index: 5;
		pointer-events: none;
	}

	/* ── Note input modal ──────────────────────────────── */
	.note-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 1000;
	}

	.note-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 1001;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.08);
		border-radius: 12px;
		box-shadow: var(--shadow-float);
		backdrop-filter: blur(20px);
		padding: 20px;
		width: 400px;
		max-width: 90vw;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-family: var(--font-body);
	}

	.note-header {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-cream);
	}

	.note-textarea {
		width: 100%;
		min-height: 100px;
		padding: 10px 12px;
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 8px;
		color: var(--color-cream);
		font-family: var(--font-body);
		font-size: 13px;
		resize: vertical;
		outline: none;
		transition: border-color 0.15s;
	}

	.note-textarea:focus {
		border-color: var(--color-accent-dim);
	}

	.note-textarea::placeholder {
		color: var(--color-faint);
	}

	.note-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.note-btn {
		padding: 6px 16px;
		border: none;
		border-radius: 8px;
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.note-cancel {
		background: var(--color-surface);
		color: var(--color-muted);
	}

	.note-cancel:hover {
		color: var(--color-cream);
	}

	.note-save {
		background: var(--color-accent);
		color: var(--color-void);
	}

	.note-save:hover {
		opacity: 0.9;
	}
</style>
