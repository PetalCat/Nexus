<script lang="ts">
	// Page-anchored collaborative annotations ("stickies"), ported from the tasks
	// app — but gated behind an explicit Annotate toggle so it NEVER fights normal
	// app use (Eli's note). OFF by default: pins are visible to read/expand, but
	// nothing captures clicks. Flip the FAB ON → click anywhere to drop a note.
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { StickyNote, X } from 'lucide-svelte';

	type Note = {
		id: number;
		anchor_selector: string;
		anchor_snippet: string;
		anchor_offset_x: number;
		anchor_offset_y: number;
		body: string;
		author: string;
		created_at: number;
	};
	type Composer = {
		x: number; y: number;
		anchor_selector: string; anchor_snippet: string;
		anchor_offset_x: number; anchor_offset_y: number;
		body: string; submitting: boolean;
	};

	let mode = $state(false); // annotate mode — OFF by default
	let comments = $state<Note[]>([]);
	let expandedIds = $state<Set<number>>(new Set());
	let composer = $state<Composer | null>(null);
	let positionTick = $state(0);
	let pageLoaded = false;

	function buildSelector(el: Element): string {
		const parts: string[] = [];
		let cur: Element | null = el;
		while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
			let part = cur.tagName.toLowerCase();
			if (cur.id) { part += `#${cur.id}`; parts.unshift(part); break; }
			const parent: Element | null = cur.parentElement;
			if (parent) {
				const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
				if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
			}
			parts.unshift(part);
			cur = cur.parentElement;
		}
		return parts.join(' > ');
	}
	function snippetFor(el: Element): string {
		const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
		return text.length > 80 ? text.slice(0, 77) + '…' : text;
	}
	function findElement(selector: string): Element | null {
		try { return document.querySelector(selector); } catch { return null; }
	}
	function isOurUI(el: EventTarget | null): boolean {
		let n = el as HTMLElement | null;
		while (n) {
			if (n instanceof HTMLElement && n.dataset.stickyUi === 'true') return true;
			n = n.parentElement;
		}
		return false;
	}
	function skipTarget(t: EventTarget | null): boolean {
		if (!t || isOurUI(t)) return true;
		const tag = (t as HTMLElement).tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	// mode-gated placement: a normal left-click while annotating opens the composer.
	function onClick(ev: MouseEvent) {
		if (!mode || composer) return;
		if (skipTarget(ev.target)) return;
		ev.preventDefault();
		ev.stopPropagation();
		openComposerAt(ev.clientX, ev.clientY, ev.target as Element);
	}

	$effect(() => {
		if (composer) {
			document.body.style.overflow = 'hidden';
			return () => { document.body.style.overflow = ''; };
		}
	});
	function openComposerAt(x: number, y: number, target: Element) {
		const rect = target.getBoundingClientRect();
		const offX = rect.width > 0 ? Math.max(0, Math.min(1, (x - rect.left) / rect.width)) : 0.5;
		const offY = rect.height > 0 ? Math.max(0, Math.min(1, (y - rect.top) / rect.height)) : 0.5;
		composer = {
			x, y,
			anchor_selector: buildSelector(target),
			anchor_snippet: snippetFor(target),
			anchor_offset_x: offX, anchor_offset_y: offY,
			body: '', submitting: false
		};
	}
	function closeComposer() { composer = null; }
	async function submitComposer() {
		if (!composer) return;
		const body = composer.body.trim();
		if (!body) return;
		composer.submitting = true;
		try {
			const res = await fetch('/api/annotations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					page_path: $page.url.pathname,
					anchor_selector: composer.anchor_selector,
					anchor_snippet: composer.anchor_snippet,
					anchor_offset_x: composer.anchor_offset_x,
					anchor_offset_y: composer.anchor_offset_y,
					body
				})
			});
			if (!res.ok) { composer.submitting = false; return; }
			closeComposer();
			await loadComments();
		} catch {
			if (composer) composer.submitting = false;
		}
	}

	async function loadComments() {
		try {
			const res = await fetch(`/api/annotations?page=${encodeURIComponent($page.url.pathname)}`);
			if (!res.ok) return;
			const data = await res.json();
			comments = data.annotations ?? [];
		} catch { /* best-effort */ }
	}
	async function ackComment(id: number) {
		try {
			const res = await fetch(`/api/annotations/${id}`, { method: 'DELETE' });
			if (!res.ok) return;
			comments = comments.filter((c) => c.id !== id);
			expandedIds.delete(id);
			expandedIds = new Set(expandedIds);
		} catch { /* silent */ }
	}
	function toggleExpand(id: number) {
		if (expandedIds.has(id)) expandedIds.delete(id);
		else expandedIds.add(id);
		expandedIds = new Set(expandedIds);
	}

	function stickyPos(c: Note) {
		void positionTick;
		const el = findElement(c.anchor_selector);
		if (!el) return { left: 0, top: 0, visible: false };
		const rect = el.getBoundingClientRect();
		const ox = c.anchor_offset_x ?? 0.5, oy = c.anchor_offset_y ?? 0.5;
		let left = rect.left + rect.width * ox;
		let top = rect.top + rect.height * oy;
		left = Math.max(8, Math.min(window.innerWidth - 300 - 8, left));
		top = Math.max(8, Math.min(window.innerHeight - 60 - 8, top));
		return { left, top, visible: rect.bottom > 0 && rect.top < window.innerHeight };
	}
	function clampComposerPos() {
		if (!composer) return { left: 0, top: 0 };
		const W = 300, H = 184;
		let left = composer.x - W / 2;
		let top = composer.y + 12;
		left = Math.max(8, Math.min(window.innerWidth - W - 8, left));
		if (top + H + 8 > window.innerHeight) top = Math.max(8, composer.y - H - 12);
		return { left, top };
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { if (composer) closeComposer(); else if (mode) mode = false; }
	}

	let scrollHandler: (() => void) | null = null;
	let resizeHandler: (() => void) | null = null;
	onMount(() => {
		pageLoaded = true;
		void loadComments();
		document.addEventListener('click', onClick, { capture: true });
		document.addEventListener('keydown', onKey);
		scrollHandler = () => positionTick++;
		resizeHandler = () => positionTick++;
		document.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
		window.addEventListener('resize', resizeHandler);
	});
	onDestroy(() => {
		if (typeof document === 'undefined') return;
		document.removeEventListener('click', onClick, { capture: true });
		document.removeEventListener('keydown', onKey);
		if (scrollHandler) document.removeEventListener('scroll', scrollHandler, { capture: true });
		if (resizeHandler) window.removeEventListener('resize', resizeHandler);
	});

	let lastPath = $state('');
	$effect(() => {
		const p = $page.url.pathname;
		if (pageLoaded && p !== lastPath) { lastPath = p; void loadComments(); }
	});

	function timeAgo(ts: number | string) {
		const ms = typeof ts === 'number' ? ts : Date.parse(String(ts).replace(' ', 'T') + 'Z');
		const d = Math.round((Date.now() - ms) / 1000);
		if (!Number.isFinite(d)) return '';
		if (d < 60) return `${d}s`;
		if (d < 3600) return `${Math.round(d / 60)}m`;
		if (d < 86400) return `${Math.round(d / 3600)}h`;
		return `${Math.round(d / 86400)}d`;
	}
</script>

<!-- Pin layer -->
<div class="sticky-layer" data-sticky-ui="true">
	{#each comments as c (c.id)}
		{@const pos = stickyPos(c)}
		{#if pos.visible}
			{#if expandedIds.has(c.id)}
				<div class="sk-note" style:left="{pos.left}px" style:top="{pos.top}px" data-sticky-ui="true">
					<div class="sk-head">
						<span class="sk-who">{c.author || '?'}</span>
						<span class="sk-when">{timeAgo(c.created_at)}</span>
						<button class="sk-x" onclick={() => toggleExpand(c.id)} title="collapse">−</button>
					</div>
					<div class="sk-body">{c.body}</div>
					{#if c.anchor_snippet}<div class="sk-snip">"{c.anchor_snippet}"</div>{/if}
					<button class="sk-ack" onclick={() => ackComment(c.id)}>ack &amp; remove</button>
				</div>
			{:else}
				<button class="sk-pin" style:left="{pos.left}px" style:top="{pos.top}px" data-sticky-ui="true" title={c.body} onclick={() => toggleExpand(c.id)}>
					{(c.author || '?').charAt(0).toUpperCase()}
				</button>
			{/if}
		{/if}
	{/each}
</div>

<!-- Annotate toggle (FAB) -->
<button class="sk-fab" class:on={mode} data-sticky-ui="true" onclick={() => (mode = !mode)} title={mode ? 'Exit annotate mode (Esc)' : 'Annotate this page'}>
	<StickyNote size={20} strokeWidth={2} />
</button>
{#if mode && !composer}
	<div class="sk-hint" data-sticky-ui="true">Click anywhere to add a note · Esc to exit</div>
{/if}

<!-- Composer -->
{#if composer}
	{@const pos = clampComposerPos()}
	<div class="sk-bd" role="presentation" data-sticky-ui="true" onpointerdown={(e) => { if (e.target === e.currentTarget) closeComposer(); }}></div>
	<div class="sk-composer" style:left="{pos.left}px" style:top="{pos.top}px" data-sticky-ui="true">
		<div class="sk-cm-head">
			<span class="sk-snip">"{composer.anchor_snippet || 'no text'}"</span>
			<button class="sk-x" onclick={closeComposer} title="close"><X size={14} /></button>
		</div>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea bind:value={composer.body} placeholder="leave a note…" rows="3" autofocus data-sticky-ui="true"></textarea>
		<div class="sk-cm-actions">
			<button class="sk-cancel" onclick={closeComposer}>cancel</button>
			<button class="sk-send" onclick={submitComposer} disabled={composer.submitting || !composer.body.trim()}>
				{composer.submitting ? 'sending…' : 'send'}
			</button>
		</div>
	</div>
{/if}

<style>
	/* Self-contained, theme-agnostic (renders above the app's themed root). */
	.sticky-layer { position: fixed; inset: 0; pointer-events: none; z-index: 9000; }
	.sk-pin, .sk-note { position: fixed; pointer-events: auto; }
	.sk-pin {
		width: 28px; height: 28px; border-radius: 50% 50% 50% 2px; border: none; cursor: pointer;
		background: #fde047; color: #422006; font-weight: 700; font-size: 12px;
		box-shadow: 0 3px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;
		transform: translate(-50%, -50%); transition: transform 120ms ease;
	}
	.sk-pin:hover { transform: translate(-50%, -50%) scale(1.12); }
	.sk-note {
		width: 268px; transform: translate(-10px, -10px); background: #fef9c3; color: #422006;
		border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); padding: 12px 13px;
		font-family: ui-sans-serif, system-ui, sans-serif;
	}
	.sk-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
	.sk-who { font-weight: 700; font-size: 12.5px; }
	.sk-when { font-size: 11px; color: #92722a; }
	.sk-x { margin-left: auto; border: none; background: transparent; cursor: pointer; color: #92722a; display: flex; font-size: 16px; line-height: 1; }
	.sk-body { font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
	.sk-snip { font-size: 11.5px; color: #92722a; margin-top: 8px; font-style: italic; }
	.sk-ack { margin-top: 10px; width: 100%; border: none; border-radius: 7px; background: #422006; color: #fef9c3; padding: 6px; font-size: 12px; cursor: pointer; }
	.sk-ack:hover { filter: brightness(1.2); }

	.sk-fab {
		position: fixed; right: 18px; bottom: 18px; z-index: 9100; width: 46px; height: 46px;
		border-radius: 50%; border: none; cursor: pointer; background: #1c1a17; color: #fde047;
		box-shadow: 0 6px 18px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;
		transition: transform 120ms ease, background 120ms ease;
	}
	.sk-fab:hover { transform: scale(1.06); }
	.sk-fab.on { background: #fde047; color: #1c1a17; outline: 3px solid rgba(253,224,71,0.35); }
	.sk-hint {
		position: fixed; right: 74px; bottom: 28px; z-index: 9100; background: #1c1a17; color: #fef9c3;
		font-size: 12.5px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
		font-family: ui-sans-serif, system-ui, sans-serif; white-space: nowrap;
	}

	.sk-bd { position: fixed; inset: 0; z-index: 9200; background: rgba(0,0,0,0.12); }
	.sk-composer {
		position: fixed; z-index: 9300; width: 300px; background: #fef9c3; color: #422006;
		border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,0.45); padding: 12px;
		font-family: ui-sans-serif, system-ui, sans-serif;
	}
	.sk-cm-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
	.sk-composer textarea {
		width: 100%; box-sizing: border-box; border: 1px solid #e3d27a; border-radius: 7px; background: #fffdf0;
		color: #422006; font: inherit; font-size: 14px; padding: 8px; resize: vertical; outline: none;
	}
	.sk-cm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
	.sk-cancel { border: none; background: transparent; color: #92722a; cursor: pointer; font-size: 13px; }
	.sk-send { border: none; border-radius: 7px; background: #422006; color: #fef9c3; padding: 6px 14px; font-size: 13px; cursor: pointer; }
	.sk-send:disabled { opacity: 0.5; cursor: default; }
</style>
