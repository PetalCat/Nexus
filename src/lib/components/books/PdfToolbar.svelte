<script lang="ts">
	import {
		ArrowLeft, PanelLeft, ZoomIn, ZoomOut, Sun, Moon, Search,
		ChevronUp, ChevronDown, Bookmark, Keyboard, Maximize,
		BookOpen, File, Settings
	} from 'lucide-svelte';

	interface Props {
		visible: boolean;
		bookTitle: string;
		bookAuthor?: string;
		currentPage: number;
		totalPages: number;
		scale: number;
		fitMode: 'width' | 'page' | 'custom';
		spreadMode: 'single' | 'dual';
		darkMode: 'light' | 'dark' | 'sepia';
		showSidebar: boolean;
		searchQuery?: string;
		searchResultCount?: number;
		searchIndex?: number;
		isBookmarked?: boolean;
		onBack: () => void;
		onToggleSidebar: () => void;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onFitMode: (mode: 'width' | 'page') => void;
		onSpreadMode: (mode: 'single' | 'dual') => void;
		onDarkMode: (mode: 'light' | 'dark' | 'sepia') => void;
		onSearch: (query: string) => void;
		onSearchNext: () => void;
		onSearchPrev: () => void;
		onBookmark: () => void;
		onToggleShortcuts: () => void;
		onFullscreen: () => void;
		onSettings: () => void;
	}

	let {
		visible,
		bookTitle,
		bookAuthor,
		currentPage,
		totalPages,
		scale,
		fitMode,
		spreadMode,
		darkMode,
		showSidebar,
		searchQuery = '',
		searchResultCount = 0,
		searchIndex = 0,
		isBookmarked = false,
		onBack,
		onToggleSidebar,
		onZoomIn,
		onZoomOut,
		onFitMode,
		onSpreadMode,
		onDarkMode,
		onSearch,
		onSearchNext,
		onSearchPrev,
		onBookmark,
		onToggleShortcuts,
		onFullscreen,
		onSettings
	}: Props = $props();

	let localSearchValue = $state('');
	let scaleDisplay = $derived(`${Math.round(scale * 100)}%`);

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				onSearchPrev();
			} else {
				onSearch(localSearchValue);
			}
		}
	}
</script>

<div
	class="toolbar"
	class:toolbar-hidden={!visible}
	role="toolbar"
	aria-label="PDF reader toolbar"
>
	<!-- Back -->
	<button class="tb-btn" onclick={onBack} title="Back (Esc)">
		<ArrowLeft size={18} strokeWidth={1.5} />
	</button>

	<!-- Title area -->
	<div class="title-area">
		<div class="title-text">{bookTitle}</div>
		{#if bookAuthor}
			<div class="title-author">{bookAuthor}</div>
		{:else if totalPages > 0}
			<div class="title-author">Page {currentPage} of {totalPages}</div>
		{/if}
	</div>

	<div class="sep"></div>

	<!-- Sidebar toggle -->
	<button
		class="tb-btn"
		class:tb-active={showSidebar}
		onclick={onToggleSidebar}
		title="Toggle sidebar"
	>
		<PanelLeft size={18} strokeWidth={1.5} />
	</button>

	<div class="sep"></div>

	<!-- Zoom controls -->
	<div class="zoom-group">
		<button class="tb-btn" onclick={onZoomOut} title="Zoom out">
			<ZoomOut size={16} strokeWidth={1.5} />
		</button>
		<span class="scale-display">{scaleDisplay}</span>
		<button class="tb-btn" onclick={onZoomIn} title="Zoom in">
			<ZoomIn size={16} strokeWidth={1.5} />
		</button>
	</div>

	<!-- Fit mode -->
	<div class="fit-group">
		<button
			class="tb-btn tb-text"
			class:tb-active={fitMode === 'width'}
			onclick={() => onFitMode('width')}
			title="Fit width"
		>W</button>
		<button
			class="tb-btn tb-text"
			class:tb-active={fitMode === 'page'}
			onclick={() => onFitMode('page')}
			title="Fit page"
		>P</button>
	</div>

	<div class="sep"></div>

	<!-- Spread mode -->
	<div class="spread-group">
		<button
			class="tb-btn"
			class:tb-active={spreadMode === 'single'}
			onclick={() => onSpreadMode('single')}
			title="Single page"
		>
			<File size={16} strokeWidth={1.5} />
		</button>
		<button
			class="tb-btn"
			class:tb-active={spreadMode === 'dual'}
			onclick={() => onSpreadMode('dual')}
			title="Dual page"
		>
			<BookOpen size={16} strokeWidth={1.5} />
		</button>
	</div>

	<div class="sep"></div>

	<!-- Dark mode toggle -->
	<div class="dark-group">
		<button
			class="tb-btn tb-sm"
			class:tb-active={darkMode === 'light'}
			onclick={() => onDarkMode('light')}
			title="Light mode"
		>
			<Sun size={14} strokeWidth={1.5} />
		</button>
		<button
			class="tb-btn tb-sm"
			class:tb-active={darkMode === 'dark'}
			onclick={() => onDarkMode('dark')}
			title="Dark mode"
		>
			<Moon size={14} strokeWidth={1.5} />
		</button>
		<button
			class="tb-btn tb-sm tb-sepia"
			class:tb-active={darkMode === 'sepia'}
			onclick={() => onDarkMode('sepia')}
			title="Sepia mode"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
				<circle cx="12" cy="12" r="10"/>
				<path d="M12 2a10 10 0 0 0 0 20"/>
			</svg>
		</button>
	</div>

	<div class="sep"></div>

	<!-- Search bar -->
	<div class="search-bar">
		<Search size={14} strokeWidth={1.5} />
		<input
			class="search-input"
			type="text"
			placeholder="Search..."
			bind:value={localSearchValue}
			onkeydown={handleSearchKeydown}
			aria-label="Search in document"
		/>
		{#if searchResultCount > 0}
			<span class="search-count">{searchIndex + 1}/{searchResultCount}</span>
		{/if}
		{#if localSearchValue}
			<button class="tb-btn tb-sm" onclick={onSearchPrev} title="Previous result">
				<ChevronUp size={14} strokeWidth={2} />
			</button>
			<button class="tb-btn tb-sm" onclick={onSearchNext} title="Next result">
				<ChevronDown size={14} strokeWidth={2} />
			</button>
		{/if}
	</div>

	<div class="sep"></div>

	<!-- Bookmark -->
	<button
		class="tb-btn"
		class:tb-bookmarked={isBookmarked}
		onclick={onBookmark}
		title="Bookmark this page"
	>
		<Bookmark size={18} strokeWidth={1.5} fill={isBookmarked ? 'var(--color-warm)' : 'none'} />
	</button>

	<!-- Reader settings -->
	<button class="tb-btn" onclick={onSettings} title="Reader settings">
		<Settings size={18} strokeWidth={1.5} />
	</button>

	<!-- Shortcuts -->
	<button class="tb-btn" onclick={onToggleShortcuts} title="Keyboard shortcuts">
		<Keyboard size={18} strokeWidth={1.5} />
	</button>

	<!-- Fullscreen -->
	<button class="tb-btn" onclick={onFullscreen} title="Fullscreen (F)">
		<Maximize size={18} strokeWidth={1.5} />
	</button>
</div>

<style>
	.toolbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 12px;
		background: linear-gradient(180deg, rgba(13, 11, 10, 0.96), rgba(13, 11, 10, 0.92));
		backdrop-filter: blur(24px) saturate(1.4);
		border-bottom: 1px solid rgba(240, 235, 227, 0.04);
		transition: opacity 0.3s ease, transform 0.3s ease;
		font-family: var(--font-body);
	}

	.toolbar-hidden {
		opacity: 0;
		pointer-events: none;
		transform: translateY(-100%);
	}

	/* ── Buttons ─────────────────────────────────────── */
	.tb-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}

	.tb-btn:hover {
		background: var(--color-surface);
		color: var(--color-cream);
	}

	.tb-btn.tb-active {
		color: var(--color-accent);
		background: rgba(212, 162, 83, 0.1);
	}

	.tb-btn.tb-bookmarked {
		color: var(--color-warm);
	}

	.tb-btn.tb-sm {
		width: 26px;
		height: 26px;
	}

	.tb-btn.tb-text {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		width: 28px;
	}

	/* ── Title area ──────────────────────────────────── */
	.title-area {
		min-width: 0;
		max-width: 200px;
		flex-shrink: 1;
	}

	.title-text {
		font-family: var(--font-display);
		font-size: 14px;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.2;
	}

	.title-author {
		font-size: 11px;
		color: var(--color-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.2;
	}

	/* ── Separators ──────────────────────────────────── */
	.sep {
		width: 1px;
		height: 20px;
		background: rgba(240, 235, 227, 0.06);
		flex-shrink: 0;
		margin: 0 4px;
	}

	/* ── Zoom ────────────────────────────────────────── */
	.zoom-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.scale-display {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-cream);
		background: var(--color-raised);
		border-radius: 4px;
		padding: 3px 8px;
		min-width: 40px;
		text-align: center;
		user-select: none;
	}

	/* ── Fit / Spread / Dark groups ──────────────────── */
	.fit-group,
	.spread-group,
	.dark-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	/* ── Search bar ──────────────────────────────────── */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 8px;
		padding: 0 8px;
		height: 32px;
		color: var(--color-muted);
		min-width: 140px;
		max-width: 240px;
		flex-shrink: 1;
	}

	.search-bar:focus-within {
		border-color: var(--color-accent-dim);
	}

	.search-input {
		background: none;
		border: none;
		outline: none;
		color: var(--color-cream);
		font-family: var(--font-body);
		font-size: 12px;
		width: 100%;
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-faint);
	}

	.search-count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-faint);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
