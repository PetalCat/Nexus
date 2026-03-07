<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	const item = $derived(data.item);

	let emulatorFrame: HTMLIFrameElement | undefined = $state();
	let emulatorContainer: HTMLDivElement | undefined = $state();

	// Save/state management
	type CloudEntry = {
		id: number;
		file_name: string;
		created_at: string;
		updated_at: string;
		file_size_bytes: number;
		screenshot_url?: string;
		emulator?: string;
		slot?: string;
	};

	let showModal = $state(false);
	let activeTab: 'states' | 'saves' = $state('states');
	let stateList = $state<CloudEntry[]>(data.states ?? []);
	let saveList = $state<CloudEntry[]>(data.saves ?? []);
	let toastMessage = $state('');
	let toastType: 'success' | 'error' | 'info' | 'undo' = $state('info');
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;
	let syncing = $state(false);
	let loadingId = $state<number | null>(null);
	let deletingId = $state<number | null>(null);
	let confirmDeleteEntry: CloudEntry | null = $state(null);
	let confirmDeleteType: 'state' | 'save' = $state('state');

	// Play time tracking
	let sessionStart = $state(0);
	let playSeconds = $state(0);
	let playTimerInterval: ReturnType<typeof setInterval> | null = null;
	let gameReady = $state(false);

	// Quick resume banner
	let showResumeBanner = $state(false);
	let resumeStateId: number | null = $state(null);

	// Keyboard shortcut hints
	let showShortcuts = $state(false);

	// Thumbnail zoom
	let zoomedUrl: string | null = $state(null);

	// Undo delete
	let undoEntry: { entry: CloudEntry; type: 'state' | 'save' } | null = $state(null);
	let undoTimeout: ReturnType<typeof setTimeout> | null = null;

	let playTimeFormatted = $derived.by(() => {
		const h = Math.floor(playSeconds / 3600);
		const m = Math.floor((playSeconds % 3600) / 60);
		const s = playSeconds % 60;
		if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	// Metadata: labels & pins (stored in Nexus DB)
	type MetaMap = Record<string, { label: string | null; pinned: boolean }>;
	let metaMap = $state<MetaMap>({});
	let renamingEntry: CloudEntry | null = $state(null);
	let renamingType: 'state' | 'save' = $state('state');
	let renameValue = $state('');

	function metaKey(type: 'state' | 'save', id: number) { return `${type}:${id}`; }
	function getMeta(type: 'state' | 'save', id: number) { return metaMap[metaKey(type, id)]; }
	function getLabel(type: 'state' | 'save', entry: CloudEntry) {
		return getMeta(type, entry.id)?.label || null;
	}
	function isPinned(type: 'state' | 'save', id: number) { return getMeta(type, id)?.pinned ?? false; }

	async function fetchMeta() {
		try {
			const res = await fetch(`/api/games/${item.sourceId}/save-meta?serviceId=${data.serviceId}`);
			if (res.ok) metaMap = await res.json();
		} catch { /* silent */ }
	}

	async function updateMeta(entryId: number, entryType: 'state' | 'save', patch: { label?: string | null; pinned?: boolean }) {
		const key = metaKey(entryType, entryId);
		metaMap[key] = { ...metaMap[key], label: metaMap[key]?.label ?? null, pinned: metaMap[key]?.pinned ?? false, ...patch };
		metaMap = { ...metaMap }; // trigger reactivity
		await fetch(`/api/games/${item.sourceId}/save-meta?serviceId=${data.serviceId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ entryId, entryType, ...patch })
		}).catch(() => {});
	}

	function startRename(entry: CloudEntry, type: 'state' | 'save') {
		renamingEntry = entry;
		renamingType = type;
		renameValue = getLabel(type, entry) || entry.file_name.replace(/\.[^.]+$/, '');
	}

	async function submitRename() {
		if (!renamingEntry) return;
		const label = renameValue.trim() || null;
		await updateMeta(renamingEntry.id, renamingType, { label });
		renamingEntry = null;
		showToast(label ? 'Renamed' : 'Label cleared', 'success');
	}

	function cancelRename() { renamingEntry = null; }

	async function togglePin(entry: CloudEntry, type: 'state' | 'save') {
		const current = isPinned(type, entry.id);
		await updateMeta(entry.id, type, { pinned: !current });
		showToast(!current ? 'Pinned' : 'Unpinned', 'info');
	}

	function showToast(msg: string, type: 'success' | 'error' | 'info' | 'undo' = 'info', duration = 3000) {
		toastMessage = msg;
		toastType = type;
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => { toastMessage = ''; undoEntry = null; }, duration);
	}

	function relativeTime(dateStr: string): string {
		try {
			const now = Date.now();
			const then = new Date(dateStr).getTime();
			const diff = now - then;
			const secs = Math.floor(diff / 1000);
			if (secs < 10) return 'just now';
			if (secs < 60) return `${secs}s ago`;
			const mins = Math.floor(secs / 60);
			if (mins < 60) return `${mins}m ago`;
			const hrs = Math.floor(mins / 60);
			if (hrs < 24) return `${hrs}h ago`;
			const days = Math.floor(hrs / 24);
			if (days < 7) return `${days}d ago`;
			if (days < 30) return `${Math.floor(days / 7)}w ago`;
			return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		} catch { return ''; }
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function sortEntries(list: CloudEntry[], type: 'state' | 'save'): CloudEntry[] {
		return [...list].sort((a, b) => {
			// Pinned first
			const pa = isPinned(type, a.id) ? 1 : 0;
			const pb = isPinned(type, b.id) ? 1 : 0;
			if (pa !== pb) return pb - pa;
			// Then newest first
			return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
		});
	}

	let sortedStates = $derived(sortEntries(stateList, 'state'));
	let sortedSaves = $derived(sortEntries(saveList, 'save'));
	let activeList = $derived(activeTab === 'states' ? sortedStates : sortedSaves);

	async function refreshStatesAndSaves() {
		try {
			const [statesRes, savesRes] = await Promise.all([
				fetch(`/api/games/${item.sourceId}/states?serviceId=${data.serviceId}`).catch(() => null),
				fetch(`/api/games/${item.sourceId}/saves?serviceId=${data.serviceId}`).catch(() => null)
			]);
			if (statesRes?.ok) {
				const json = await statesRes.json();
				stateList = Array.isArray(json) ? json : [];
			}
			if (savesRes?.ok) {
				const json = await savesRes.json();
				saveList = Array.isArray(json) ? json : [];
			}
			await fetchMeta();
		} catch { /* silent */ }
	}

	function toUint8(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
		if (data instanceof ArrayBuffer) return new Uint8Array(data);
		if (data instanceof Uint8Array) return data;
		return new Uint8Array(data);
	}

	async function uploadState(stateData: ArrayBuffer | Uint8Array | number[], screenshotData?: ArrayBuffer | Uint8Array | number[] | null) {
		syncing = true;
		try {
			const form = new FormData();
			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `${item.title.replace(/[^a-zA-Z0-9]/g, '_')}_${ts}.state`;
			form.append('file', new Blob([toUint8(stateData)]), fileName);
			if (screenshotData) {
				form.append('screenshot', new Blob([toUint8(screenshotData)], { type: 'image/png' }), `${fileName}.png`);
			}

			const res = await fetch(`/api/games/${item.sourceId}/states?serviceId=${data.serviceId}`, {
				method: 'POST',
				body: form
			});
			if (res.ok) {
				showToast('State saved to cloud', 'success');
				await refreshStatesAndSaves();
			} else {
				showToast('Failed to save state', 'error');
			}
		} catch {
			showToast('Failed to save state', 'error');
		} finally {
			syncing = false;
		}
	}

	async function uploadSave(saveData: ArrayBuffer | Uint8Array | number[], screenshotData?: ArrayBuffer | Uint8Array | number[] | null) {
		syncing = true;
		try {
			const form = new FormData();
			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `${item.title.replace(/[^a-zA-Z0-9]/g, '_')}_${ts}.srm`;
			form.append('file', new Blob([toUint8(saveData)]), fileName);
			if (screenshotData) {
				form.append('screenshot', new Blob([toUint8(screenshotData)], { type: 'image/png' }), `screenshot.png`);
			}

			const res = await fetch(`/api/games/${item.sourceId}/saves?serviceId=${data.serviceId}`, {
				method: 'POST',
				body: form
			});
			if (res.ok) {
				showToast('Save synced to cloud', 'success');
				await refreshStatesAndSaves();
			} else {
				showToast('Failed to sync save', 'error');
			}
		} catch {
			showToast('Failed to sync save', 'error');
		} finally {
			syncing = false;
		}
	}

	async function loadStateFromCloud(stateId: number) {
		loadingId = stateId;
		showModal = false;
		try {
			const res = await fetch(`/api/games/${item.sourceId}/states/${stateId}?serviceId=${data.serviceId}`);
			if (!res.ok) { showToast('Failed to download state', 'error'); return; }
			const buf = await res.arrayBuffer();
			emulatorFrame?.contentWindow?.postMessage({
				type: 'ejs:loadState',
				state: buf
			}, '*', [buf]);
			showToast('State loaded', 'success');
		} catch {
			showToast('Failed to load state', 'error');
		} finally {
			loadingId = null;
		}
	}

	async function loadSaveFromCloud(saveId: number) {
		loadingId = saveId;
		showModal = false;
		try {
			const res = await fetch(`/api/games/${item.sourceId}/saves/${saveId}?serviceId=${data.serviceId}`);
			if (!res.ok) { showToast('Failed to download save', 'error'); return; }
			const buf = await res.arrayBuffer();
			emulatorFrame?.contentWindow?.postMessage({
				type: 'ejs:loadSave',
				save: buf
			}, '*', [buf]);
			showToast('Save loaded', 'success');
		} catch {
			showToast('Failed to load save', 'error');
		} finally {
			loadingId = null;
		}
	}

	function requestDelete(entry: CloudEntry, type: 'state' | 'save') {
		confirmDeleteEntry = entry;
		confirmDeleteType = type;
	}

	function cancelDelete() {
		confirmDeleteEntry = null;
	}

	async function confirmDelete() {
		if (!confirmDeleteEntry) return;
		const entry = confirmDeleteEntry;
		const type = confirmDeleteType;
		confirmDeleteEntry = null;
		deletingId = entry.id;

		// Optimistically remove from UI, keep for undo
		if (type === 'state') {
			stateList = stateList.filter(s => s.id !== entry.id);
		} else {
			saveList = saveList.filter(s => s.id !== entry.id);
		}
		deletingId = null;

		// Show undo toast
		undoEntry = { entry, type };
		showToast(`${type === 'state' ? 'State' : 'Save'} deleted`, 'undo', 5000);

		// Schedule actual deletion after undo window
		if (undoTimeout) clearTimeout(undoTimeout);
		undoTimeout = setTimeout(async () => {
			if (!undoEntry || undoEntry.entry.id !== entry.id) return; // was undone
			try {
				const endpoint = type === 'state'
					? `/api/games/${item.sourceId}/states/${entry.id}?serviceId=${data.serviceId}`
					: `/api/games/${item.sourceId}/saves/${entry.id}?serviceId=${data.serviceId}`;
				await fetch(endpoint, { method: 'DELETE' });
			} catch { /* silent — already removed from UI */ }
			undoEntry = null;
		}, 5000);
	}

	function undoDelete() {
		if (!undoEntry) return;
		const { entry, type } = undoEntry;
		if (type === 'state') {
			stateList = [...stateList, entry];
		} else {
			saveList = [...saveList, entry];
		}
		undoEntry = null;
		if (undoTimeout) clearTimeout(undoTimeout);
		toastMessage = '';
		showToast('Restored', 'success');
	}

	// Request a quick save from the emulator (for keyboard shortcut / auto-save)
	function requestQuickSave() {
		emulatorFrame?.contentWindow?.postMessage({ type: 'ejs:requestSaveState' }, '*');
		showToast('Saving state...', 'info', 1500);
	}

	function requestQuickLoad() {
		const latest = sortEntries(stateList, 'state')[0];
		if (latest) {
			loadStateFromCloud(latest.id);
		} else {
			showToast('No states to load', 'info');
		}
	}

	function openModal() {
		emulatorFrame?.contentWindow?.postMessage({ type: 'ejs:pause' }, '*');
		showModal = true;
		refreshStatesAndSaves();
	}

	function closeModal() {
		showModal = false;
		confirmDeleteEntry = null;
		emulatorFrame?.contentWindow?.postMessage({ type: 'ejs:play' }, '*');
	}

	onMount(() => {
		function handleMessage(e: MessageEvent) {
			if (!e.data?.type) return;
			switch (e.data.type) {
				case 'ejs:saveState':
					uploadState(e.data.state, e.data.screenshot);
					break;
				case 'ejs:requestLoadState':
					openModal();
					break;
				case 'ejs:saveSRAM':
					uploadSave(e.data.save, e.data.screenshot);
					break;
				case 'ejs:gameStarted':
					gameReady = true;
					sessionStart = Date.now();
					playTimerInterval = setInterval(() => {
						playSeconds = Math.floor((Date.now() - sessionStart) / 1000);
					}, 1000);
					// Show resume banner instead of auto-loading silently
					setTimeout(() => {
						const latestState = sortEntries(stateList, 'state')[0];
						if (latestState) {
							resumeStateId = latestState.id;
							showResumeBanner = true;
							// Auto-load SRAM save silently (it's non-disruptive)
							const latestSave = sortEntries(saveList, 'save')[0];
							if (latestSave) loadSaveFromCloud(latestSave.id);
						}
					}, 500);
					break;
			}
		}

		// Keyboard shortcuts (only when modal is closed and not in a text input)
		function handleKeydown(e: KeyboardEvent) {
			if (showModal || renamingEntry || confirmDeleteEntry) return;
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;

			switch (e.key) {
				case 'F2':
					e.preventDefault();
					requestQuickSave();
					break;
				case 'F4':
					e.preventDefault();
					requestQuickLoad();
					break;
				case 'F6':
					e.preventDefault();
					openModal();
					break;
				case 'F11':
					e.preventDefault();
					toggleFullscreen();
					break;
				case 'Escape':
					if (showResumeBanner) {
						showResumeBanner = false;
					}
					break;
				case '?':
					showShortcuts = !showShortcuts;
					break;
			}
		}

		// Auto-save on page exit
		function handleBeforeUnload() {
			if (gameReady) {
				emulatorFrame?.contentWindow?.postMessage({ type: 'ejs:requestSaveState' }, '*');
			}
		}

		window.addEventListener('message', handleMessage);
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.removeEventListener('message', handleMessage);
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			if (toastTimeout) clearTimeout(toastTimeout);
			if (undoTimeout) clearTimeout(undoTimeout);
			if (playTimerInterval) clearInterval(playTimerInterval);
		};
	});

	function exitEmulator() {
		goto(`/media/game/${item.sourceId}?service=${data.serviceId}`);
	}

	function toggleFullscreen() {
		if (!emulatorContainer) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			emulatorContainer.requestFullscreen();
		}
	}

	const emulatorUrl = $derived(
		`/api/games/${item.sourceId}/emulator?serviceId=${data.serviceId}`
	);
</script>

<svelte:head>
	<title>{item.title} - Play | Nexus</title>
</svelte:head>

<div class="play-page">
	<header class="play-header">
		<button class="play-header__back" onclick={exitEmulator} title="Back to game">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
		</button>
		<div class="play-header__info">
			{#if item.poster}
				<img src={item.poster} alt="" class="play-header__cover" />
			{/if}
			<div>
				<h1 class="play-header__title">{item.title}</h1>
				<span class="play-header__platform">{item.metadata?.platform ?? ''}</span>
			</div>
		</div>
		<div class="play-header__actions">
			{#if gameReady}
				<span class="play-timer" title="Session time">{playTimeFormatted}</span>
			{/if}
			<button class="play-btn" onclick={requestQuickSave} title="Quick Save (F2)">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
					<polyline points="17 21 17 13 7 13 7 21"/>
					<polyline points="7 3 7 8 15 8"/>
				</svg>
				{#if syncing}
					<span class="sync-indicator"></span>
				{/if}
			</button>
			<button class="play-btn" onclick={openModal} title="Cloud Storage (F6)">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 16v-8m0 0l-3 3m3-3l3 3"/>
					<path d="M20 16.7A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
				</svg>
			</button>
			<button class="play-btn" onclick={toggleFullscreen} title="Fullscreen (F11)">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
				</svg>
			</button>
			<button class="play-btn" onclick={() => { showShortcuts = !showShortcuts; }} title="Keyboard Shortcuts (?)">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="2" y="6" width="20" height="12" rx="2"/>
					<path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>
				</svg>
			</button>
			<button class="play-btn play-btn--exit" onclick={exitEmulator} title="Exit">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>
	</header>

	<div class="play-emulator" bind:this={emulatorContainer}>
		<iframe
			bind:this={emulatorFrame}
			src={emulatorUrl}
			class="play-emulator__frame"
			allow="autoplay; gamepad"
			title="Game Emulator"
		></iframe>
	</div>
</div>

<!-- Toast -->
{#if toastMessage}
	<div class="toast toast--{toastType}">
		<div class="toast__icon">
			{#if toastType === 'success'}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
			{:else if toastType === 'error'}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
			{:else}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
			{/if}
		</div>
		<span>{toastMessage}</span>
		{#if toastType === 'undo' && undoEntry}
			<button class="toast__undo" onclick={undoDelete}>Undo</button>
		{/if}
	</div>
{/if}

<!-- Resume Banner -->
{#if showResumeBanner && resumeStateId}
	<div class="resume-banner">
		<div class="resume-banner__inner">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M20 16.7A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
				<path d="M12 13V7"/>
				<path d="M12 13l3-2"/>
			</svg>
			<span>Continue where you left off?</span>
			<button class="resume-btn resume-btn--yes" onclick={() => { showResumeBanner = false; if (resumeStateId) loadStateFromCloud(resumeStateId); }}>
				Resume
			</button>
			<button class="resume-btn resume-btn--no" onclick={() => { showResumeBanner = false; }}>
				New Game
			</button>
		</div>
	</div>
{/if}

<!-- Keyboard Shortcuts Overlay -->
{#if showShortcuts}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="shortcuts-backdrop" onclick={() => { showShortcuts = false; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="shortcuts-panel" onclick={(e) => e.stopPropagation()}>
			<h3>Keyboard Shortcuts</h3>
			<div class="shortcut-grid">
				<kbd>F2</kbd><span>Quick Save</span>
				<kbd>F4</kbd><span>Quick Load (latest)</span>
				<kbd>F6</kbd><span>Cloud Storage</span>
				<kbd>F11</kbd><span>Fullscreen</span>
				<kbd>?</kbd><span>Toggle this panel</span>
				<kbd>Esc</kbd><span>Dismiss banners</span>
			</div>
			<p class="shortcuts-note">Emulator controls are configured in the emulator menu</p>
		</div>
	</div>
{/if}

<!-- Thumbnail Zoom -->
{#if zoomedUrl}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="zoom-backdrop" onclick={() => { zoomedUrl = null; }}>
		<img src={zoomedUrl} alt="Screenshot" class="zoom-img" />
	</div>
{/if}

<!-- Save Manager Modal -->
{#if showModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sm-backdrop" onclick={closeModal} onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="sm" onclick={(e) => e.stopPropagation()}>
			<!-- Header -->
			<div class="sm__header">
				<div class="sm__header-left">
					<div class="sm__icon">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M20 16.7A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
							<path d="M8 16l4-4 4 4"/>
							<path d="M12 12v9"/>
						</svg>
					</div>
					<div>
						<h2 class="sm__title">Cloud Storage</h2>
						<p class="sm__subtitle">{stateList.length + saveList.length} files synced</p>
					</div>
				</div>
				<button class="sm__close" onclick={closeModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<!-- Tab Bar -->
			<div class="sm__tabs">
				<button
					class="sm__tab"
					class:sm__tab--active={activeTab === 'states'}
					onclick={() => { activeTab = 'states'; }}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<rect x="3" y="3" width="18" height="18" rx="2"/>
						<path d="M9 3v18"/>
						<path d="M3 9h6"/>
					</svg>
					Save States
					{#if stateList.length > 0}
						<span class="sm__tab-count">{stateList.length}</span>
					{/if}
				</button>
				<button
					class="sm__tab"
					class:sm__tab--active={activeTab === 'saves'}
					onclick={() => { activeTab = 'saves'; }}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
						<polyline points="17 21 17 13 7 13 7 21"/>
						<polyline points="7 3 7 8 15 8"/>
					</svg>
					SRAM Saves
					{#if saveList.length > 0}
						<span class="sm__tab-count">{saveList.length}</span>
					{/if}
				</button>
			</div>

			<!-- Content -->
			<div class="sm__content">
				{#if activeList.length === 0}
					<div class="sm__empty">
						<div class="sm__empty-icon">
							{#if activeTab === 'states'}
								<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
									<rect x="3" y="3" width="18" height="18" rx="2"/>
									<path d="M9 3v18"/>
									<path d="M3 9h6"/>
								</svg>
							{:else}
								<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
									<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
									<polyline points="17 21 17 13 7 13 7 21"/>
									<polyline points="7 3 7 8 15 8"/>
								</svg>
							{/if}
						</div>
						<p class="sm__empty-text">
							{activeTab === 'states'
								? 'No save states yet'
								: 'No SRAM saves yet'}
						</p>
						<p class="sm__empty-hint">
							{activeTab === 'states'
								? 'Use the emulator menu to create a save state'
								: 'In-game saves sync automatically'}
						</p>
					</div>
				{:else}
					<div class="sm__list">
						{#each activeList as entry, i (entry.id)}
							{@const type = activeTab === 'states' ? 'state' as const : 'save' as const}
							{@const pinned = isPinned(type, entry.id)}
							{@const label = getLabel(type, entry)}
							<div
								class="sm__card"
								class:sm__card--deleting={deletingId === entry.id}
								class:sm__card--pinned={pinned}
								style="animation-delay: {i * 40}ms"
							>
								<!-- Thumbnail -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="sm__card-thumb" onclick={() => { if (entry.screenshot_url) zoomedUrl = entry.screenshot_url; }} class:sm__card-thumb--clickable={!!entry.screenshot_url}>
									{#if entry.screenshot_url}
										<img src={entry.screenshot_url} alt="" class="sm__card-img" loading="lazy" />
									{:else}
										<div class="sm__card-placeholder">
											<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
												<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
												<circle cx="8.5" cy="8.5" r="1.5"/>
												<polyline points="21 15 16 10 5 21"/>
											</svg>
										</div>
									{/if}
									{#if pinned}
										<div class="sm__card-pin-badge" title="Pinned">
											<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
												<path d="M16 2l-4 4-6-2-2 10 4 4v6l2-2 2 2v-6l4 4 10-2-2-6-4-4z"/>
											</svg>
										</div>
									{/if}
									{#if loadingId === entry.id}
										<div class="sm__card-loading">
											<div class="sm__spinner"></div>
										</div>
									{/if}
								</div>

								<!-- Info -->
								<div class="sm__card-body">
									<div class="sm__card-top">
										<span class="sm__card-time">{relativeTime(entry.updated_at || entry.created_at)}</span>
										{#if entry.slot}
											<span class="sm__card-slot">Slot {entry.slot}</span>
										{/if}
									</div>
									{#if label}
										<span class="sm__card-label">{label}</span>
									{/if}
									<span class="sm__card-name" class:sm__card-name--sub={!!label} title={entry.file_name}>{entry.file_name}</span>
									<div class="sm__card-meta">
										<span>{formatBytes(entry.file_size_bytes)}</span>
										{#if entry.emulator}
											<span class="sm__card-dot"></span>
											<span>{entry.emulator}</span>
										{/if}
									</div>
								</div>

								<!-- Actions -->
								<div class="sm__card-actions">
									<button
										class="sm__action sm__action--load"
										onclick={() => type === 'state' ? loadStateFromCloud(entry.id) : loadSaveFromCloud(entry.id)}
										disabled={loadingId === entry.id}
										title="Load"
									>
										{#if loadingId === entry.id}
											<div class="sm__spinner sm__spinner--sm"></div>
										{:else}
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<polygon points="5 3 19 12 5 21 5 3"/>
											</svg>
										{/if}
									</button>
									<button
										class="sm__action sm__action--pin"
										class:sm__action--pinned={pinned}
										onclick={() => togglePin(entry, type)}
										title={pinned ? 'Unpin' : 'Pin'}
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
											<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
										</svg>
									</button>
									<button
										class="sm__action sm__action--rename"
										onclick={() => startRename(entry, type)}
										title="Rename"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
											<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
										</svg>
									</button>
									<button
										class="sm__action sm__action--delete"
										onclick={() => requestDelete(entry, type)}
										disabled={deletingId === entry.id}
										title="Delete"
									>
										{#if deletingId === entry.id}
											<div class="sm__spinner sm__spinner--sm"></div>
										{:else}
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<polyline points="3 6 5 6 21 6"/>
												<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
											</svg>
										{/if}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Confirm Delete Dialog -->
			{#if confirmDeleteEntry}
				<div class="sm__confirm">
					<div class="sm__confirm-inner">
						<p class="sm__confirm-text">
							Delete this {confirmDeleteType}?
						</p>
						<p class="sm__confirm-sub">{confirmDeleteEntry.file_name}</p>
						<div class="sm__confirm-actions">
							<button class="sm__confirm-btn sm__confirm-btn--cancel" onclick={cancelDelete}>Cancel</button>
							<button class="sm__confirm-btn sm__confirm-btn--delete" onclick={confirmDelete}>Delete</button>
						</div>
					</div>
				</div>
			{/if}

			<!-- Rename Dialog -->
			{#if renamingEntry}
				<div class="sm__confirm">
					<div class="sm__confirm-inner">
						<p class="sm__confirm-text">Rename</p>
						<input
							class="sm__rename-input"
							type="text"
							bind:value={renameValue}
							onkeydown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') cancelRename(); }}
							autofocus
						/>
						<div class="sm__confirm-actions">
							<button class="sm__confirm-btn sm__confirm-btn--cancel" onclick={cancelRename}>Cancel</button>
							<button class="sm__confirm-btn sm__confirm-btn--save" onclick={submitRename}>Save</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ── Page Shell ── */
	.play-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #000;
		color: var(--color-cream, #f0ebe3);
	}

	.play-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--color-void, #0d0b0a);
		border-bottom: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
		z-index: 10;
		flex-shrink: 0;
	}

	.play-header__back,
	.play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
		background: var(--color-raised, #1f1c1a);
		color: var(--color-muted, #a09890);
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.play-header__back:hover,
	.play-btn:hover {
		background: var(--color-surface, #272321);
		color: var(--color-cream, #f0ebe3);
		border-color: color-mix(in srgb, var(--color-cream, #f0ebe3) 12%, transparent);
	}
	.play-btn--exit:hover {
		background: color-mix(in srgb, var(--color-warm, #c45c5c) 20%, var(--color-raised, #1f1c1a));
		color: var(--color-warm-light, #d87474);
		border-color: color-mix(in srgb, var(--color-warm, #c45c5c) 30%, transparent);
	}

	.play-header__info {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex: 1;
		min-width: 0;
	}

	.play-header__cover {
		width: 30px;
		height: 40px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
	}

	.play-header__title {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		letter-spacing: -0.01em;
	}

	.play-header__platform {
		font-size: 0.6875rem;
		color: var(--color-faint, #605850);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.play-header__actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.sync-indicator {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-accent, #d4a253);
		box-shadow: 0 0 6px var(--color-accent, #d4a253);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.4; transform: scale(0.8); }
	}

	.play-emulator {
		width: 100%;
		height: calc(100vh - 53px);
		overflow: hidden;
		background: #000;
	}

	.play-emulator__frame {
		width: 100%;
		height: 100%;
		border: none;
	}

	/* ── Toast ── */
	.toast {
		position: fixed;
		bottom: 80px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--color-raised, #1f1c1a);
		color: var(--color-cream, #f0ebe3);
		padding: 0.5rem 1rem;
		border-radius: 10px;
		font-size: 0.8125rem;
		font-weight: 500;
		z-index: 10001;
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
		box-shadow: 0 8px 32px rgba(0,0,0,0.5);
		animation: toast-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.toast__icon { display: flex; flex-shrink: 0; }
	.toast--success .toast__icon { color: var(--color-steel, #3d8f84); }
	.toast--error .toast__icon { color: var(--color-warm, #c45c5c); }
	.toast--info .toast__icon { color: var(--color-accent, #d4a253); }

	@keyframes toast-in {
		from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.95); }
		to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
	}

	/* ── Save Manager Modal ── */
	.sm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.75);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(8px);
		animation: fade-in 0.2s ease;
	}
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.sm {
		position: relative;
		background: var(--color-deep, #121010);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
		border-radius: 16px;
		width: 92%;
		max-width: 520px;
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--color-cream, #f0ebe3) 3%, transparent),
			0 24px 80px rgba(0, 0, 0, 0.6),
			0 0 120px -20px color-mix(in srgb, var(--color-accent, #d4a253) 8%, transparent);
		animation: modal-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes modal-in {
		from { opacity: 0; transform: translateY(16px) scale(0.97); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	/* Header */
	.sm__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.125rem 1.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
	}
	.sm__header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.sm__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--color-accent, #d4a253) 12%, var(--color-raised, #1f1c1a));
		color: var(--color-accent, #d4a253);
	}
	.sm__title {
		font-size: 1rem;
		font-weight: 650;
		margin: 0;
		letter-spacing: -0.01em;
		color: var(--color-cream, #f0ebe3);
	}
	.sm__subtitle {
		font-size: 0.6875rem;
		color: var(--color-faint, #605850);
		margin: 0.125rem 0 0;
	}
	.sm__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
		background: var(--color-raised, #1f1c1a);
		color: var(--color-faint, #605850);
		cursor: pointer;
		transition: all 0.15s;
	}
	.sm__close:hover {
		background: var(--color-surface, #272321);
		color: var(--color-cream, #f0ebe3);
	}

	/* Tabs */
	.sm__tabs {
		display: flex;
		padding: 0 1.25rem;
		gap: 0.25rem;
		background: var(--color-deep, #121010);
		border-bottom: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 4%, transparent);
	}
	.sm__tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.75rem 0.875rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-faint, #605850);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
		margin-bottom: -1px;
	}
	.sm__tab:hover {
		color: var(--color-muted, #a09890);
	}
	.sm__tab--active {
		color: var(--color-accent, #d4a253);
		border-bottom-color: var(--color-accent, #d4a253);
	}
	.sm__tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		font-size: 0.6875rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
		color: var(--color-muted, #a09890);
	}
	.sm__tab--active .sm__tab-count {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 15%, transparent);
		color: var(--color-accent, #d4a253);
	}

	/* Content */
	.sm__content {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		scrollbar-width: thin;
		scrollbar-color: var(--color-raised, #1f1c1a) transparent;
	}

	/* Empty State */
	.sm__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		text-align: center;
	}
	.sm__empty-icon {
		color: color-mix(in srgb, var(--color-faint, #605850) 50%, transparent);
		margin-bottom: 1rem;
	}
	.sm__empty-text {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted, #a09890);
		margin: 0 0 0.25rem;
	}
	.sm__empty-hint {
		font-size: 0.75rem;
		color: var(--color-faint, #605850);
		margin: 0;
	}

	/* Card List */
	.sm__list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.sm__card {
		display: flex;
		align-items: stretch;
		gap: 0;
		background: var(--color-base, #181514);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 5%, transparent);
		border-radius: 12px;
		overflow: hidden;
		transition: all 0.2s ease;
		animation: card-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) backwards;
	}
	.sm__card:hover {
		border-color: color-mix(in srgb, var(--color-cream, #f0ebe3) 10%, transparent);
		background: var(--color-raised, #1f1c1a);
	}
	.sm__card--deleting {
		opacity: 0.4;
		transform: scale(0.98);
	}
	@keyframes card-in {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* Card Thumbnail */
	.sm__card-thumb {
		position: relative;
		width: 96px;
		min-height: 64px;
		flex-shrink: 0;
		background: var(--color-void, #0d0b0a);
		overflow: hidden;
	}
	.sm__card-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.sm__card-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: color-mix(in srgb, var(--color-faint, #605850) 40%, transparent);
	}
	.sm__card-loading {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Card Body */
	.sm__card-body {
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.125rem;
	}
	.sm__card-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.sm__card-time {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-accent, #d4a253);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.sm__card-slot {
		font-size: 0.625rem;
		font-weight: 500;
		padding: 1px 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-steel, #3d8f84) 15%, transparent);
		color: var(--color-steel-light, #56a99d);
	}
	.sm__card-name {
		font-size: 0.75rem;
		color: var(--color-cream, #f0ebe3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}
	.sm__card-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.6875rem;
		color: var(--color-faint, #605850);
	}
	.sm__card-dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-faint, #605850);
	}

	/* Card Actions */
	.sm__card-actions {
		display: flex;
		flex-direction: column;
		border-left: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 4%, transparent);
		flex-shrink: 0;
	}
	.sm__action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		flex: 1;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}
	.sm__action:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.sm__action--load {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 8%, var(--color-base, #181514));
		color: var(--color-accent, #d4a253);
	}
	.sm__action--load:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 18%, var(--color-base, #181514));
	}
	.sm__action--delete {
		background: var(--color-base, #181514);
		color: var(--color-faint, #605850);
		border-top: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 4%, transparent);
	}
	.sm__action--delete:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-warm, #c45c5c) 12%, var(--color-base, #181514));
		color: var(--color-warm, #c45c5c);
	}

	/* Spinner */
	.sm__spinner {
		width: 20px;
		height: 20px;
		border: 2px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 10%, transparent);
		border-top-color: var(--color-accent, #d4a253);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	.sm__spinner--sm {
		width: 14px;
		height: 14px;
		border-width: 1.5px;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Confirm Delete Dialog */
	.sm__confirm {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 16px;
		z-index: 2;
		animation: fade-in 0.15s ease;
		backdrop-filter: blur(4px);
	}
	.sm__confirm-inner {
		background: var(--color-raised, #1f1c1a);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
		border-radius: 12px;
		padding: 1.5rem;
		width: 280px;
		text-align: center;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
	}
	.sm__confirm-text {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-cream, #f0ebe3);
		margin: 0 0 0.25rem;
	}
	.sm__confirm-sub {
		font-size: 0.75rem;
		color: var(--color-faint, #605850);
		margin: 0 0 1.25rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sm__confirm-actions {
		display: flex;
		gap: 0.5rem;
	}
	.sm__confirm-btn {
		flex: 1;
		padding: 0.5rem;
		border-radius: 8px;
		border: none;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.sm__confirm-btn--cancel {
		background: var(--color-surface, #272321);
		color: var(--color-muted, #a09890);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
	}
	.sm__confirm-btn--cancel:hover {
		background: var(--color-hover, #302b28);
		color: var(--color-cream, #f0ebe3);
	}
	.sm__confirm-btn--delete {
		background: color-mix(in srgb, var(--color-warm, #c45c5c) 20%, var(--color-raised, #1f1c1a));
		color: var(--color-warm-light, #d87474);
		border: 1px solid color-mix(in srgb, var(--color-warm, #c45c5c) 30%, transparent);
	}
	.sm__confirm-btn--delete:hover {
		background: color-mix(in srgb, var(--color-warm, #c45c5c) 35%, var(--color-raised, #1f1c1a));
	}
	.sm__confirm-btn--save {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 20%, var(--color-raised, #1f1c1a));
		color: var(--color-accent-light, #e8bc6a);
		border: 1px solid color-mix(in srgb, var(--color-accent, #d4a253) 30%, transparent);
	}
	.sm__confirm-btn--save:hover {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 35%, var(--color-raised, #1f1c1a));
	}

	/* Rename Input */
	.sm__rename-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		margin: 0.5rem 0 1rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 12%, transparent);
		background: var(--color-base, #181514);
		color: var(--color-cream, #f0ebe3);
		font-size: 0.8125rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s;
		box-sizing: border-box;
	}
	.sm__rename-input:focus {
		border-color: var(--color-accent, #d4a253);
	}

	/* Pin badge on thumbnail */
	.sm__card-pin-badge {
		position: absolute;
		top: 4px;
		left: 4px;
		width: 18px;
		height: 18px;
		border-radius: 4px;
		background: var(--color-accent, #d4a253);
		color: var(--color-void, #0d0b0a);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}

	/* Pinned card glow */
	.sm__card--pinned {
		border-color: color-mix(in srgb, var(--color-accent, #d4a253) 20%, transparent);
	}

	/* Label display */
	.sm__card-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-cream, #f0ebe3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sm__card-name--sub {
		font-size: 0.6875rem;
		color: var(--color-faint, #605850);
		font-weight: 400;
	}

	/* Pin action button */
	.sm__action--pin {
		background: var(--color-base, #181514);
		color: var(--color-faint, #605850);
		border-top: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 4%, transparent);
	}
	.sm__action--pin:hover {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 10%, var(--color-base, #181514));
		color: var(--color-accent, #d4a253);
	}
	.sm__action--pinned {
		color: var(--color-accent, #d4a253);
	}

	/* Rename action button */
	.sm__action--rename {
		background: var(--color-base, #181514);
		color: var(--color-faint, #605850);
		border-top: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 4%, transparent);
	}
	.sm__action--rename:hover {
		background: color-mix(in srgb, var(--color-steel, #3d8f84) 10%, var(--color-base, #181514));
		color: var(--color-steel-light, #56a99d);
	}

	/* Clickable thumbnail */
	.sm__card-thumb--clickable {
		cursor: zoom-in;
	}
	.sm__card-thumb--clickable:hover .sm__card-img {
		filter: brightness(1.15);
		transition: filter 0.15s;
	}

	/* ── Play Timer ── */
	.play-timer {
		font-size: 0.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-faint, #605850);
		padding: 0 0.375rem;
		letter-spacing: 0.02em;
	}

	/* ── Toast Undo ── */
	.toast__undo {
		margin-left: 0.25rem;
		padding: 0.1875rem 0.625rem;
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--color-accent, #d4a253) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent, #d4a253) 12%, transparent);
		color: var(--color-accent-light, #e8bc6a);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.toast__undo:hover {
		background: color-mix(in srgb, var(--color-accent, #d4a253) 25%, transparent);
	}

	/* ── Resume Banner ── */
	.resume-banner {
		position: fixed;
		top: 70px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10001;
		animation: banner-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.resume-banner__inner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 1rem;
		background: var(--color-raised, #1f1c1a);
		border: 1px solid color-mix(in srgb, var(--color-accent, #d4a253) 25%, transparent);
		border-radius: 12px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 60px -10px color-mix(in srgb, var(--color-accent, #d4a253) 10%, transparent);
		color: var(--color-cream, #f0ebe3);
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
	}
	.resume-banner__inner svg {
		color: var(--color-accent, #d4a253);
		flex-shrink: 0;
	}
	.resume-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: none;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.resume-btn--yes {
		background: var(--color-accent, #d4a253);
		color: var(--color-void, #0d0b0a);
	}
	.resume-btn--yes:hover {
		background: var(--color-accent-light, #e8bc6a);
	}
	.resume-btn--no {
		background: var(--color-surface, #272321);
		color: var(--color-muted, #a09890);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 6%, transparent);
	}
	.resume-btn--no:hover {
		background: var(--color-hover, #302b28);
		color: var(--color-cream, #f0ebe3);
	}
	@keyframes banner-in {
		from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* ── Keyboard Shortcuts Overlay ── */
	.shortcuts-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 10002;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(4px);
		animation: fade-in 0.15s ease;
	}
	.shortcuts-panel {
		background: var(--color-deep, #121010);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 8%, transparent);
		border-radius: 16px;
		padding: 1.5rem 2rem;
		width: 320px;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
	}
	.shortcuts-panel h3 {
		font-size: 0.9375rem;
		font-weight: 650;
		margin: 0 0 1rem;
		color: var(--color-cream, #f0ebe3);
	}
	.shortcut-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem 1rem;
		align-items: center;
	}
	.shortcut-grid kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		padding: 0.1875rem 0.5rem;
		border-radius: 6px;
		background: var(--color-raised, #1f1c1a);
		border: 1px solid color-mix(in srgb, var(--color-cream, #f0ebe3) 10%, transparent);
		color: var(--color-accent, #d4a253);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: inherit;
	}
	.shortcut-grid span {
		font-size: 0.8125rem;
		color: var(--color-muted, #a09890);
	}
	.shortcuts-note {
		font-size: 0.6875rem;
		color: var(--color-faint, #605850);
		margin: 1rem 0 0;
	}

	/* ── Thumbnail Zoom ── */
	.zoom-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		z-index: 10003;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: zoom-out;
		animation: fade-in 0.15s ease;
	}
	.zoom-img {
		max-width: 90vw;
		max-height: 85vh;
		border-radius: 8px;
		box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
		image-rendering: pixelated;
		animation: zoom-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes zoom-in {
		from { transform: scale(0.85); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}
</style>
