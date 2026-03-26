<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { BookBookmark, BookHighlight } from '$lib/db/schema';
	import * as pdfjsLib from 'pdfjs-dist';
	import { TextLayer } from 'pdfjs-dist';
	import {
		ArrowLeft, Maximize, Minimize, ChevronLeft, ChevronRight, Loader2
	} from 'lucide-svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';

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

	// ── Core state ─────────────────────────────────────────────────
	let pdfDoc = $state<pdfjsLib.PDFDocumentProxy | null>(null);
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

	// ── Internal refs & tracking ───────────────────────────────────
	let viewportEl = $state<HTMLDivElement | null>(null);
	let pageWrappers: HTMLDivElement[] = [];
	let canvasRefs: (HTMLCanvasElement | null)[] = [];
	let textLayerRefs: (HTMLDivElement | null)[] = [];
	let renderedPages = new SvelteSet<number>();
	let renderingPages = new SvelteSet<number>();
	let activeRenderTasks = new SvelteMap<number, pdfjsLib.RenderTask>();
	let pageViewports: pdfjsLib.PageViewport[] = [];
	let observer: IntersectionObserver | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;
	let renderQueue: number[] = [];
	let isProcessingQueue = false;
	const MAX_CONCURRENT_RENDERS = 3;
	const BUFFER_PAGES = 3;

	// ── Derived ────────────────────────────────────────────────────
	let progress = $derived(numPages > 0 ? currentPage / numPages : 0);
	let progressPercent = $derived(Math.round(progress * 100));

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
		const wrapper = pageWrappers[page - 1];
		if (wrapper) {
			wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	// ── Toolbar auto-hide ──────────────────────────────────────────
	function resetHideTimer() {
		showToolbar = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => { showToolbar = false; }, 4000);
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
				goToPage(currentPage + 1);
				break;
			case 'ArrowUp':
			case 'PageUp':
				e.preventDefault();
				goToPage(currentPage - 1);
				break;
			case 'Home':
				e.preventDefault();
				goToPage(1);
				break;
			case 'End':
				e.preventDefault();
				goToPage(numPages);
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

	// ── Page rendering ─────────────────────────────────────────────
	async function renderPage(pageNum: number) {
		if (!pdfDoc || renderedPages.has(pageNum) || renderingPages.has(pageNum)) return;

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
			const renderTask = page.render({ canvasContext: ctx, viewport });
			activeRenderTasks.set(pageNum, renderTask);

			await renderTask.promise;
			activeRenderTasks.delete(pageNum);

			// Render text layer
			clearTextLayer(textDiv);
			const textContent = await page.getTextContent();
			const textLayer = new TextLayer({
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
	async function calculateFitWidthScale(doc: pdfjsLib.PDFDocumentProxy): Promise<number> {
		const firstPage = await doc.getPage(1);
		const vp = firstPage.getViewport({ scale: 1 });
		const containerWidth = viewportEl?.clientWidth ?? 800;
		return (containerWidth - 80) / vp.width;
	}

	// ── Initialize page viewports (at scale=1 for placeholder sizing) ──
	async function initPageViewports(doc: pdfjsLib.PDFDocumentProxy) {
		pageViewports = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			pageViewports.push(page.getViewport({ scale: 1 }));
		}
	}

	// ── Initialize PDF ─────────────────────────────────────────────
	async function initPdf() {
		if (!browser) return;

		try {
			loading = true;
			loadError = null;

			pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

			const loadingTask = pdfjsLib.getDocument(fileUrl);
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

			// Calculate fit-width scale
			scale = await calculateFitWidthScale(doc);

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
						const pageNum = parseInt(
							(entry.target as HTMLElement).dataset.page ?? '0',
							10
						);
						if (pageNum > 0) {
							enqueueRender(pageNum);
						}
					}
				}
			},
			{
				root: viewportEl,
				rootMargin: '400px'
			}
		);

		for (const wrapper of pageWrappers) {
			if (wrapper) observer.observe(wrapper);
		}
	}

	// Svelte tick helper
	async function tick() {
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}

	// ── Fullscreen listener ────────────────────────────────────────
	$effect(() => {
		if (!browser) return;
		const handleFs = () => { isFullscreen = !!document.fullscreenElement; };
		document.addEventListener('fullscreenchange', handleFs);
		return () => document.removeEventListener('fullscreenchange', handleFs);
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="pdf-reader"
	onmousemove={resetHideTimer}
	role="presentation"
>
	<!-- ── Top Toolbar ─────────────────────────────────────────── -->
	<div
		class="toolbar-top"
		class:toolbar-hidden={!showToolbar}
	>
		<button onclick={closeReader} class="toolbar-btn" title="Back (Esc)">
			<ArrowLeft size={20} strokeWidth={1.5} />
		</button>

		<div class="toolbar-title">
			<div class="title-text">{book.title}</div>
			{#if numPages > 0}
				<div class="title-sub">Page {currentPage} of {numPages}</div>
			{/if}
		</div>

		<div class="toolbar-actions">
			<button onclick={toggleFullscreen} class="toolbar-btn" title="Fullscreen (F)">
				{#if isFullscreen}
					<Minimize size={18} strokeWidth={1.5} />
				{:else}
					<Maximize size={18} strokeWidth={1.5} />
				{/if}
			</button>
		</div>
	</div>

	<!-- ── Main Viewport ──────────────────────────────────────── -->
	<div
		class="viewport"
		bind:this={viewportEl}
		onscroll={handleScroll}
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
			<div class="pages-container">
				{#each Array(numPages) as _, i (i)}
					{@const dims = getPageDims(i)}
					<div
						class="page-wrapper"
						data-page={i + 1}
						style="width: {dims.width}px; height: {dims.height}px;"
						bind:this={pageWrappers[i]}
					>
						<canvas bind:this={canvasRefs[i]}></canvas>
						<div class="text-layer" bind:this={textLayerRefs[i]}></div>
						{#if !renderedPages.has(i + 1)}
							<div class="page-placeholder">
								<span class="page-placeholder-num">{i + 1}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ── Bottom Bar ─────────────────────────────────────────── -->
	{#if !loading && !loadError && numPages > 0}
		<div
			class="toolbar-bottom"
			class:toolbar-hidden={!showToolbar}
		>
			<button
				class="nav-btn"
				disabled={currentPage <= 1}
				onclick={() => goToPage(currentPage - 1)}
				title="Previous page"
			>
				<ChevronLeft size={16} strokeWidth={2} />
			</button>

			<div class="progress-section">
				<div class="progress-bar-track">
					<div class="progress-bar-fill" style="width: {progressPercent}%"></div>
				</div>
				<span class="progress-label">{currentPage} / {numPages} ({progressPercent}%)</span>
			</div>

			<button
				class="nav-btn"
				disabled={currentPage >= numPages}
				onclick={() => goToPage(currentPage + 1)}
				title="Next page"
			>
				<ChevronRight size={16} strokeWidth={2} />
			</button>
		</div>
	{/if}
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

	/* ── Top toolbar ────────────────────────────────────── */
	.toolbar-top {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: rgba(13, 11, 10, 0.85);
		backdrop-filter: blur(20px) saturate(1.3);
		transition: opacity 0.3s, transform 0.3s;
	}

	.toolbar-hidden {
		opacity: 0;
		pointer-events: none;
		transform: translateY(-100%);
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.toolbar-btn:hover {
		background: rgba(240, 235, 227, 0.06);
		color: var(--color-cream);
	}

	.toolbar-title {
		flex: 1;
		min-width: 0;
	}

	.title-text {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-sub {
		font-size: 0.75rem;
		color: var(--color-faint);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	/* ── Main viewport ──────────────────────────────────── */
	.viewport {
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

	/* ── Page wrapper ───────────────────────────────────── */
	.page-wrapper {
		position: relative;
		background: #faf8f5;
		box-shadow: 0 4px 32px rgba(0, 0, 0, 0.5);
		border-radius: 2px;
		overflow: hidden;
		flex-shrink: 0;
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

	/* ── Bottom toolbar ─────────────────────────────────── */
	.toolbar-bottom {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		background: rgba(13, 11, 10, 0.85);
		backdrop-filter: blur(20px) saturate(1.3);
		transition: opacity 0.3s, transform 0.3s;
	}

	.toolbar-bottom.toolbar-hidden {
		opacity: 0;
		pointer-events: none;
		transform: translateY(100%);
	}

	.nav-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.nav-btn:hover:not(:disabled) {
		background: rgba(240, 235, 227, 0.06);
		color: var(--color-cream);
	}

	.nav-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.progress-section {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.progress-bar-track {
		width: 100%;
		height: 3px;
		border-radius: 2px;
		background: var(--color-surface);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: 2px;
		background: var(--color-accent);
		transition: width 0.15s ease;
	}

	.progress-label {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--color-faint);
		user-select: none;
	}
</style>
