# Reader Paginated Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paginated mode to the PDF reader, bring EPUB to feature parity with shared controls (flow / spread / animation / per-input toggles / RTL direction), and unify the settings surface across both. Includes a small bug fix so the EPUB reader doesn't load for books that have no EPUB format (already committed in spec commit).

**Architecture:** A new `PaginatedViewport.svelte` wraps both readers and owns flow/spread/animation/input handling. A `useReaderInputs.svelte.ts` rune centralizes tap-zone / swipe / keyboard handling. A new `reader-settings.ts` helper owns the shared `ReaderSettings` schema, defaults, and `localStorage` persistence (extending the existing `nexus-reader-settings` key).

**Tech Stack:** SvelteKit 5 (runes), TypeScript, foliate-js (EPUB), pdfjs-dist (PDF), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-19-reader-paginated-mode-design.md`

**Branch:** `feature/reader-paginated-mode` (worktree at `.worktrees/reader-paginated`)

**Closes:** #61

---

## File Map

**Create:**
- `src/lib/components/books/reader-settings.ts` — `ReaderSettings` type, defaults, `loadReaderSettings()`, `persistReaderSettings()`, `resolveSpread()`, theme/font/margin enums.
- `src/lib/components/books/__tests__/reader-settings.test.ts` — vitest covering load/persist/defaults/resolve.
- `src/lib/components/books/useReaderInputs.svelte.ts` — rune that exposes tap-zone / swipe / keyboard handlers, respecting `inputs.*` and `direction`.
- `src/lib/components/books/__tests__/useReaderInputs.test.ts` — vitest covering hit detection, swipe threshold, RTL flip, keyboard mapping, per-input enable/disable.
- `src/lib/components/books/PaginatedViewport.svelte` — wrapper component, owns flow/spread/animation/input wiring, passes `goPrev`/`goNext`/`pageOffset` to children via Svelte snippets and bindable props.
- `src/lib/components/books/ReaderSettingsPanel.svelte` — shared settings UI (theme, font, font-size, line-height, margins, text-align, flow, spread, animation, inputs, direction).

**Modify:**
- `src/lib/components/books/BookReader.svelte` — adopt `reader-settings.ts`, render `<ReaderSettingsPanel>` in its drawer, pass settings to `<PaginatedViewport>`, hook foliate-js renderer to viewport's prev/next/flow/direction.
- `src/lib/components/books/PdfReader.svelte` — adopt `reader-settings.ts`, render `<ReaderSettingsPanel>` in its drawer, wrap with `<PaginatedViewport>`, render only current page(s) when `flow === 'paginated'`, advance via viewport callbacks. Existing single/dual `spreadMode` becomes the `spread` setting.
- `src/lib/components/books/KeyboardShortcuts.svelte` — make format-agnostic (currently EPUB-only); export keymap so PDF reader can adopt the same shortcuts. (If file is too tightly coupled to EPUB, the keyboard half of `useReaderInputs` may obviate this file — in that case Task 9 deletes it.)

**Already committed (in spec commit `050e489`):**
- `src/routes/books/read/[id]/+page.server.ts` — books-read 500 fix + format default fallback.

---

## Task 1: Reader settings module — schema, defaults, persistence

**Files:**
- Create: `src/lib/components/books/reader-settings.ts`
- Create: `src/lib/components/books/__tests__/reader-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/components/books/__tests__/reader-settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
	DEFAULT_READER_SETTINGS,
	loadReaderSettings,
	persistReaderSettings,
	resolveSpread,
	type ReaderSettings
} from '../reader-settings';

describe('reader-settings', () => {
	beforeEach(() => {
		// vitest provides a happy-dom localStorage by default
		localStorage.clear();
	});

	it('returns defaults when nothing is stored', () => {
		expect(loadReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
	});

	it('round-trips persisted settings', () => {
		const patch: Partial<ReaderSettings> = {
			flow: 'scrolled',
			spread: 'dual',
			pageAnimation: 'fade',
			direction: 'rtl',
			inputs: { tapZones: false, swipe: true, keyboard: true }
		};
		persistReaderSettings(patch);
		const loaded = loadReaderSettings();
		expect(loaded.flow).toBe('scrolled');
		expect(loaded.spread).toBe('dual');
		expect(loaded.pageAnimation).toBe('fade');
		expect(loaded.direction).toBe('rtl');
		expect(loaded.inputs.tapZones).toBe(false);
	});

	it('preserves unrelated existing fields when persisting a partial patch', () => {
		persistReaderSettings({ fontSize: 22, theme: 'sepia' as ReaderSettings['theme'] });
		persistReaderSettings({ flow: 'scrolled' });
		const loaded = loadReaderSettings();
		expect(loaded.fontSize).toBe(22);
		expect(loaded.theme).toBe('sepia');
		expect(loaded.flow).toBe('scrolled');
	});

	it('falls back to defaults for missing keys in stored JSON', () => {
		localStorage.setItem('nexus-reader-settings', JSON.stringify({ flow: 'scrolled' }));
		const loaded = loadReaderSettings();
		expect(loaded.flow).toBe('scrolled');
		expect(loaded.spread).toBe(DEFAULT_READER_SETTINGS.spread);
		expect(loaded.inputs).toEqual(DEFAULT_READER_SETTINGS.inputs);
	});

	it('coerces invalid stored values back to defaults', () => {
		localStorage.setItem('nexus-reader-settings', JSON.stringify({ flow: 'banana', spread: 42 }));
		const loaded = loadReaderSettings();
		expect(loaded.flow).toBe(DEFAULT_READER_SETTINGS.flow);
		expect(loaded.spread).toBe(DEFAULT_READER_SETTINGS.spread);
	});

	describe('resolveSpread', () => {
		it('returns single below 768px when auto', () => {
			expect(resolveSpread('auto', 600)).toBe('single');
		});
		it('returns dual at or above 768px when auto', () => {
			expect(resolveSpread('auto', 1024)).toBe('dual');
		});
		it('respects explicit single regardless of width', () => {
			expect(resolveSpread('single', 1920)).toBe('single');
		});
		it('respects explicit dual regardless of width', () => {
			expect(resolveSpread('dual', 320)).toBe('dual');
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .worktrees/reader-paginated
pnpm vitest run src/lib/components/books/__tests__/reader-settings.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/components/books/reader-settings.ts
export type ReaderThemeName = 'light' | 'dark' | 'sepia' | 'night';
export type FontFamilyName = 'serif' | 'sans' | 'mono' | 'dyslexic';
export type MarginName = 'narrow' | 'normal' | 'wide';

export interface ReaderSettings {
	theme: ReaderThemeName;
	fontFamily: FontFamilyName;
	fontSize: number;
	lineHeight: number;
	margins: MarginName;
	textAlign: 'start' | 'justify';
	flow: 'paginated' | 'scrolled';
	spread: 'auto' | 'single' | 'dual';
	pageAnimation: 'slide' | 'fade' | 'none';
	inputs: {
		tapZones: boolean;
		swipe: boolean;
		keyboard: boolean;
	};
	direction: 'ltr' | 'rtl';
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
	theme: 'dark',
	fontFamily: 'serif',
	fontSize: 18,
	lineHeight: 1.5,
	margins: 'normal',
	textAlign: 'start',
	flow: 'paginated',
	spread: 'auto',
	pageAnimation: 'slide',
	inputs: { tapZones: true, swipe: true, keyboard: true },
	direction: 'ltr'
};

const STORAGE_KEY = 'nexus-reader-settings';

const FLOW_VALUES = new Set(['paginated', 'scrolled'] as const);
const SPREAD_VALUES = new Set(['auto', 'single', 'dual'] as const);
const ANIM_VALUES = new Set(['slide', 'fade', 'none'] as const);
const DIR_VALUES = new Set(['ltr', 'rtl'] as const);
const ALIGN_VALUES = new Set(['start', 'justify'] as const);
const THEME_VALUES = new Set(['light', 'dark', 'sepia', 'night'] as const);
const FONT_VALUES = new Set(['serif', 'sans', 'mono', 'dyslexic'] as const);
const MARGIN_VALUES = new Set(['narrow', 'normal', 'wide'] as const);

function pick<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
	return typeof value === 'string' && allowed.has(value as T) ? (value as T) : fallback;
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	if (value < min || value > max) return fallback;
	return value;
}

function pickBool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function coerce(raw: unknown): ReaderSettings {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const inputsRaw = (r.inputs && typeof r.inputs === 'object' ? r.inputs : {}) as Record<string, unknown>;
	return {
		theme: pick(r.theme, THEME_VALUES, DEFAULT_READER_SETTINGS.theme),
		fontFamily: pick(r.fontFamily, FONT_VALUES, DEFAULT_READER_SETTINGS.fontFamily),
		fontSize: pickNumber(r.fontSize, DEFAULT_READER_SETTINGS.fontSize, 10, 36),
		lineHeight: pickNumber(r.lineHeight, DEFAULT_READER_SETTINGS.lineHeight, 1.0, 2.5),
		margins: pick(r.margins, MARGIN_VALUES, DEFAULT_READER_SETTINGS.margins),
		textAlign: pick(r.textAlign, ALIGN_VALUES, DEFAULT_READER_SETTINGS.textAlign),
		flow: pick(r.flow, FLOW_VALUES, DEFAULT_READER_SETTINGS.flow),
		spread: pick(r.spread, SPREAD_VALUES, DEFAULT_READER_SETTINGS.spread),
		pageAnimation: pick(r.pageAnimation, ANIM_VALUES, DEFAULT_READER_SETTINGS.pageAnimation),
		inputs: {
			tapZones: pickBool(inputsRaw.tapZones, DEFAULT_READER_SETTINGS.inputs.tapZones),
			swipe: pickBool(inputsRaw.swipe, DEFAULT_READER_SETTINGS.inputs.swipe),
			keyboard: pickBool(inputsRaw.keyboard, DEFAULT_READER_SETTINGS.inputs.keyboard)
		},
		direction: pick(r.direction, DIR_VALUES, DEFAULT_READER_SETTINGS.direction)
	};
}

export function loadReaderSettings(): ReaderSettings {
	if (typeof localStorage === 'undefined') return { ...DEFAULT_READER_SETTINGS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_READER_SETTINGS };
		return coerce(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_READER_SETTINGS };
	}
}

export function persistReaderSettings(patch: Partial<ReaderSettings>): void {
	if (typeof localStorage === 'undefined') return;
	const current = loadReaderSettings();
	const next: ReaderSettings = {
		...current,
		...patch,
		inputs: { ...current.inputs, ...(patch.inputs ?? {}) }
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* quota or privacy mode — ignore */
	}
}

const SPREAD_BREAKPOINT_PX = 768;

export function resolveSpread(spread: ReaderSettings['spread'], viewportWidth: number): 'single' | 'dual' {
	if (spread === 'single' || spread === 'dual') return spread;
	return viewportWidth >= SPREAD_BREAKPOINT_PX ? 'dual' : 'single';
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm vitest run src/lib/components/books/__tests__/reader-settings.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```
Expected: 0 errors (warnings unrelated to this change are OK).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/books/reader-settings.ts \
        src/lib/components/books/__tests__/reader-settings.test.ts
git commit -m "feat(reader): shared ReaderSettings module with localStorage persistence (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: useReaderInputs rune — tap zones, swipe, keyboard

**Files:**
- Create: `src/lib/components/books/useReaderInputs.svelte.ts`
- Create: `src/lib/components/books/__tests__/useReaderInputs.test.ts`

The rune exposes a small object with three things: a `pointerHandlers` set you spread onto the tap-zone overlay, a `touchHandlers` set you spread onto the swipe surface, and a side-effect for keyboard listeners that runs in an `$effect`. RTL mode flips the prev/next mapping for all three.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/components/books/__tests__/useReaderInputs.test.ts
import { describe, it, expect, vi } from 'vitest';
import { hitZone, isHorizontalSwipe, mapKeyToAction } from '../useReaderInputs.svelte';

describe('useReaderInputs helpers', () => {
	describe('hitZone', () => {
		it('maps left third to prev', () => {
			expect(hitZone(50, 1000)).toBe('prev');
		});
		it('maps middle third to toggleUI', () => {
			expect(hitZone(500, 1000)).toBe('toggleUI');
		});
		it('maps right third to next', () => {
			expect(hitZone(900, 1000)).toBe('next');
		});
		it('handles small viewports', () => {
			expect(hitZone(100, 360)).toBe('prev');
			expect(hitZone(180, 360)).toBe('toggleUI');
			expect(hitZone(300, 360)).toBe('next');
		});
	});

	describe('isHorizontalSwipe', () => {
		it('returns prev for rightward swipe past threshold', () => {
			expect(isHorizontalSwipe({ dx: 80, dy: 10 })).toBe('prev');
		});
		it('returns next for leftward swipe past threshold', () => {
			expect(isHorizontalSwipe({ dx: -80, dy: 10 })).toBe('next');
		});
		it('returns null when below threshold', () => {
			expect(isHorizontalSwipe({ dx: 30, dy: 5 })).toBeNull();
		});
		it('returns null when vertical travel dominates', () => {
			expect(isHorizontalSwipe({ dx: 60, dy: 200 })).toBeNull();
		});
	});

	describe('mapKeyToAction', () => {
		it('maps ArrowLeft to prev', () => {
			expect(mapKeyToAction('ArrowLeft')).toBe('prev');
		});
		it('maps ArrowRight to next', () => {
			expect(mapKeyToAction('ArrowRight')).toBe('next');
		});
		it('maps PageUp to prev, PageDown and Space to next', () => {
			expect(mapKeyToAction('PageUp')).toBe('prev');
			expect(mapKeyToAction('PageDown')).toBe('next');
			expect(mapKeyToAction(' ')).toBe('next');
		});
		it('returns null for irrelevant keys', () => {
			expect(mapKeyToAction('a')).toBeNull();
			expect(mapKeyToAction('Enter')).toBeNull();
		});
	});

	describe('flipForRtl', () => {
		it('swaps prev and next when direction is rtl', async () => {
			const { flipForRtl } = await import('../useReaderInputs.svelte');
			expect(flipForRtl('prev', 'rtl')).toBe('next');
			expect(flipForRtl('next', 'rtl')).toBe('prev');
			expect(flipForRtl('toggleUI', 'rtl')).toBe('toggleUI');
		});
		it('passes through when direction is ltr', async () => {
			const { flipForRtl } = await import('../useReaderInputs.svelte');
			expect(flipForRtl('prev', 'ltr')).toBe('prev');
			expect(flipForRtl('next', 'ltr')).toBe('next');
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/lib/components/books/__tests__/useReaderInputs.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the rune + helpers**

```ts
// src/lib/components/books/useReaderInputs.svelte.ts
import type { ReaderSettings } from './reader-settings';

export type ReaderAction = 'prev' | 'next' | 'toggleUI';

const SWIPE_MIN_PX = 50;
const SWIPE_VERTICAL_RATIO = 2; // |dx| must be > 2*|dy|

export function hitZone(x: number, width: number): ReaderAction {
	const third = width / 3;
	if (x < third) return 'prev';
	if (x < 2 * third) return 'toggleUI';
	return 'next';
}

export function isHorizontalSwipe({ dx, dy }: { dx: number; dy: number }): ReaderAction | null {
	if (Math.abs(dx) < SWIPE_MIN_PX) return null;
	if (Math.abs(dx) <= Math.abs(dy) * SWIPE_VERTICAL_RATIO) return null;
	return dx > 0 ? 'prev' : 'next';
}

export function mapKeyToAction(key: string): ReaderAction | null {
	switch (key) {
		case 'ArrowLeft':
		case 'PageUp':
			return 'prev';
		case 'ArrowRight':
		case 'PageDown':
		case ' ':
			return 'next';
		default:
			return null;
	}
}

export function flipForRtl<A extends ReaderAction>(action: A, direction: ReaderSettings['direction']): A {
	if (direction !== 'rtl') return action;
	if (action === 'prev') return 'next' as A;
	if (action === 'next') return 'prev' as A;
	return action;
}

interface UseInputsArgs {
	getSettings: () => Pick<ReaderSettings, 'inputs' | 'direction'>;
	onPrev: () => void;
	onNext: () => void;
	onToggleUI: () => void;
}

export function useReaderInputs(args: UseInputsArgs) {
	const dispatch = (action: ReaderAction) => {
		const { direction } = args.getSettings();
		const final = flipForRtl(action, direction);
		if (final === 'prev') args.onPrev();
		else if (final === 'next') args.onNext();
		else if (final === 'toggleUI') args.onToggleUI();
	};

	// Tap-zone handlers (spread onto an absolutely-positioned overlay div).
	const tapHandlers = {
		onpointerup(e: PointerEvent) {
			if (!args.getSettings().inputs.tapZones) return;
			const target = e.currentTarget as HTMLElement;
			const rect = target.getBoundingClientRect();
			dispatch(hitZone(e.clientX - rect.left, rect.width));
		}
	};

	// Swipe handlers (spread onto the page surface).
	let touchStart: { x: number; y: number } | null = null;
	const swipeHandlers = {
		ontouchstart(e: TouchEvent) {
			if (!args.getSettings().inputs.swipe) return;
			const t = e.changedTouches[0];
			touchStart = { x: t.clientX, y: t.clientY };
		},
		ontouchend(e: TouchEvent) {
			if (!args.getSettings().inputs.swipe || !touchStart) return;
			const t = e.changedTouches[0];
			const dx = t.clientX - touchStart.x;
			const dy = t.clientY - touchStart.y;
			touchStart = null;
			const action = isHorizontalSwipe({ dx, dy });
			if (action) dispatch(action);
		}
	};

	// Keyboard listener — caller wires this in an $effect.
	function attachKeyboard(target: Window | HTMLElement = window): () => void {
		const onKey = (e: KeyboardEvent) => {
			if (!args.getSettings().inputs.keyboard) return;
			const action = mapKeyToAction(e.key);
			if (!action) return;
			e.preventDefault();
			dispatch(action);
		};
		target.addEventListener('keydown', onKey as EventListener);
		return () => target.removeEventListener('keydown', onKey as EventListener);
	}

	return { tapHandlers, swipeHandlers, attachKeyboard };
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm vitest run src/lib/components/books/__tests__/useReaderInputs.test.ts
```
Expected: 13 passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm check
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/books/useReaderInputs.svelte.ts \
        src/lib/components/books/__tests__/useReaderInputs.test.ts
git commit -m "feat(reader): useReaderInputs rune for tap/swipe/keyboard (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PaginatedViewport.svelte — generic wrapper

**Files:**
- Create: `src/lib/components/books/PaginatedViewport.svelte`

The wrapper renders an absolutely-positioned tap-zone overlay above its child snippet, owns the swipe surface, attaches the keyboard listener, and surfaces a small reactive context the child can read for `effectiveSpread` (resolved from `auto`).

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/books/PaginatedViewport.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { ReaderSettings } from './reader-settings';
	import { resolveSpread } from './reader-settings';
	import { useReaderInputs } from './useReaderInputs.svelte';

	interface Props {
		settings: ReaderSettings;
		onPrev: () => void;
		onNext: () => void;
		onToggleUI: () => void;
		/** Child renders the actual reader content. Receives effectiveSpread + animationKey. */
		children: Snippet<[{ effectiveSpread: 'single' | 'dual'; animationKey: number }]>;
	}

	let { settings, onPrev, onNext, onToggleUI, children }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>();
	let viewportWidth = $state<number>(typeof window !== 'undefined' ? window.innerWidth : 1024);
	let animationKey = $state<number>(0); // Bumped on prev/next so children can re-trigger animations.

	const effectiveSpread = $derived(resolveSpread(settings.spread, viewportWidth));

	const inputs = useReaderInputs({
		getSettings: () => settings,
		onPrev: () => { animationKey++; onPrev(); },
		onNext: () => { animationKey++; onNext(); },
		onToggleUI
	});

	onMount(() => {
		const onResize = () => { viewportWidth = window.innerWidth; };
		window.addEventListener('resize', onResize);
		const detach = inputs.attachKeyboard(window);
		return () => {
			window.removeEventListener('resize', onResize);
			detach();
		};
	});

	const animClass = $derived.by(() => {
		if (settings.flow !== 'paginated') return '';
		switch (settings.pageAnimation) {
			case 'slide': return 'reader-anim-slide';
			case 'fade': return 'reader-anim-fade';
			default: return '';
		}
	});
</script>

<div
	bind:this={containerEl}
	class="reader-viewport {animClass}"
	data-flow={settings.flow}
	data-spread={effectiveSpread}
	data-direction={settings.direction}
	{...inputs.swipeHandlers}
>
	{#key animationKey}
		<div class="reader-page-layer">
			{@render children({ effectiveSpread, animationKey })}
		</div>
	{/key}
	<!-- Tap-zone overlay only when paginated + tapZones enabled -->
	{#if settings.flow === 'paginated' && settings.inputs.tapZones}
		<div class="reader-tap-overlay" {...inputs.tapHandlers} aria-hidden="true"></div>
	{/if}
</div>

<style>
	.reader-viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: pan-y; /* allow vertical scroll in scrolled mode, swipe in paginated */
	}
	.reader-viewport[data-flow='scrolled'] {
		overflow-y: auto;
	}
	.reader-page-layer {
		width: 100%;
		height: 100%;
	}
	.reader-tap-overlay {
		position: absolute;
		inset: 0;
		z-index: 5;
		background: transparent;
	}
	.reader-anim-slide .reader-page-layer {
		animation: reader-slide-in 220ms ease-out;
	}
	.reader-anim-fade .reader-page-layer {
		animation: reader-fade-in 150ms ease-out;
	}
	@keyframes reader-slide-in {
		from { transform: translateX(20%); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}
	@keyframes reader-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
</style>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm check
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/books/PaginatedViewport.svelte
git commit -m "feat(reader): PaginatedViewport wrapper component (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ReaderSettingsPanel.svelte — shared settings UI

**Files:**
- Create: `src/lib/components/books/ReaderSettingsPanel.svelte`

A single component rendering all reader settings controls. Used inside both readers' existing right-side drawers. Uses `bindable` so the parent owns the `settings` object and wires `persistReaderSettings()` in an `$effect` once.

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/books/ReaderSettingsPanel.svelte -->
<script lang="ts">
	import type { ReaderSettings } from './reader-settings';

	interface Props {
		settings: ReaderSettings;
		/** Hide PDF-irrelevant controls (theme/font/textAlign) when used in PDF reader. */
		variant?: 'epub' | 'pdf';
	}

	let { settings = $bindable(), variant = 'epub' }: Props = $props();

	const flowOptions: Array<{ value: ReaderSettings['flow']; label: string }> = [
		{ value: 'paginated', label: 'Paginated' },
		{ value: 'scrolled', label: 'Scrolled' }
	];
	const spreadOptions: Array<{ value: ReaderSettings['spread']; label: string }> = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'single', label: 'Single' },
		{ value: 'dual', label: 'Dual' }
	];
	const animOptions: Array<{ value: ReaderSettings['pageAnimation']; label: string }> = [
		{ value: 'slide', label: 'Slide' },
		{ value: 'fade', label: 'Fade' },
		{ value: 'none', label: 'None' }
	];
	const dirOptions: Array<{ value: ReaderSettings['direction']; label: string }> = [
		{ value: 'ltr', label: 'Left → Right' },
		{ value: 'rtl', label: 'Right → Left' }
	];
</script>

<div class="reader-settings space-y-5">
	<section>
		<h3 class="settings-heading">Page flow</h3>
		<div class="settings-row">
			{#each flowOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.flow === opt.value}
					onclick={() => { settings.flow = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="settings-heading">Spread</h3>
		<div class="settings-row">
			{#each spreadOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.spread === opt.value}
					onclick={() => { settings.spread = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
		<p class="settings-hint">Auto picks dual on tablets/desktop, single on phones.</p>
	</section>

	<section>
		<h3 class="settings-heading">Page animation</h3>
		<div class="settings-row">
			{#each animOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.pageAnimation === opt.value}
					onclick={() => { settings.pageAnimation = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="settings-heading">Inputs</h3>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.tapZones} />
			<span>Tap zones (left/middle/right)</span>
		</label>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.swipe} />
			<span>Swipe</span>
		</label>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.keyboard} />
			<span>Keyboard (← → PgUp PgDn Space)</span>
		</label>
	</section>

	<section>
		<h3 class="settings-heading">Direction</h3>
		<div class="settings-row">
			{#each dirOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.direction === opt.value}
					onclick={() => { settings.direction = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	{#if variant === 'epub'}
		<section>
			<h3 class="settings-heading">Font size</h3>
			<input
				type="range" min="12" max="32" step="1"
				bind:value={settings.fontSize}
				class="w-full"
			/>
			<p class="settings-hint">{settings.fontSize}px</p>
		</section>
	{/if}
</div>

<style>
	.settings-heading {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(255 247 230 / 0.45);
		margin-bottom: 0.5rem;
	}
	.settings-row {
		display: flex;
		gap: 0.4rem;
	}
	.settings-pill {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid rgb(255 247 230 / 0.08);
		font-size: 0.75rem;
		color: rgb(255 247 230 / 0.5);
		background: transparent;
		transition: all 120ms ease;
	}
	.settings-pill:hover {
		color: rgb(255 247 230 / 0.7);
		border-color: rgb(255 247 230 / 0.2);
	}
	.settings-pill--active {
		background: var(--color-accent, #d4b483);
		color: #1a1410;
		border-color: var(--color-accent, #d4b483);
	}
	.settings-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: rgb(255 247 230 / 0.7);
		padding: 0.35rem 0;
	}
	.settings-hint {
		font-size: 0.7rem;
		color: rgb(255 247 230 / 0.4);
		margin-top: 0.4rem;
	}
</style>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm check
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/books/ReaderSettingsPanel.svelte
git commit -m "feat(reader): ReaderSettingsPanel shared settings UI (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire BookReader to shared settings + viewport

**Files:**
- Modify: `src/lib/components/books/BookReader.svelte`

The current EPUB reader has `flow`, `theme`, `fontFamily`, etc. as discrete `$state` variables and its own `loadSettings()` / `persistSettings()` using the same `nexus-reader-settings` key. Replace those with `loadReaderSettings()` / `persistReaderSettings()` calls and a single `settings` object. Render `<ReaderSettingsPanel>` inside the existing settings drawer (replacing the bespoke flow toggle at lines ~995-1010 and any duplicated controls). Pass `settings`, `onPrev=() => view.prev()`, `onNext=() => view.next()`, `onToggleUI=...` to `<PaginatedViewport>` wrapping the foliate-js view container.

The foliate-js renderer's `setAttribute('flow', ...)` continues to drive the underlying paginated layout — call it inside an `$effect` whenever `settings.flow` changes (replaces lines 687-691).

- [ ] **Step 1: Read current state**

```bash
grep -n "loadSettings\|persistSettings\|let flow\|let readerTheme\|let fontFamily\|setAttribute('flow'" src/lib/components/books/BookReader.svelte
```

Note the line numbers; you'll be replacing the existing settings state declarations and the existing settings drawer markup.

- [ ] **Step 2: Add imports + replace settings state with single object**

Replace the discrete `let theme = $state(...)` etc. block with:

```ts
import { loadReaderSettings, persistReaderSettings, type ReaderSettings } from './reader-settings';
import PaginatedViewport from './PaginatedViewport.svelte';
import ReaderSettingsPanel from './ReaderSettingsPanel.svelte';

let settings = $state<ReaderSettings>(loadReaderSettings());
$effect(() => { persistReaderSettings(settings); });

// Convenience aliases for existing template bindings — keep until the template is updated.
const readerTheme = $derived(settings.theme);
const fontFamily = $derived(settings.fontFamily);
const fontSize = $derived(settings.fontSize);
const lineHeight = $derived(settings.lineHeight);
const margins = $derived(settings.margins);
const textAlign = $derived(settings.textAlign);
const flow = $derived(settings.flow);
```

Delete the old `loadSettings()` / `persistSettings()` functions (lines ~148-170) and the discrete `$state` declarations.

- [ ] **Step 3: Wrap the foliate-js host in PaginatedViewport**

Locate the `<div>` that hosts the foliate-js view (typically the one bound to `viewEl` or similar). Wrap it:

```svelte
<PaginatedViewport
	{settings}
	onPrev={() => view?.prev()}
	onNext={() => view?.next()}
	onToggleUI={() => { settingsOpen = !settingsOpen; }}
>
	{#snippet children()}
		<div bind:this={viewEl} class="absolute inset-0"></div>
	{/snippet}
</PaginatedViewport>
```

(Field names like `view`, `viewEl`, `settingsOpen` may differ slightly — preserve whatever this file already uses.)

- [ ] **Step 4: Replace the in-drawer settings markup with the shared panel**

Inside the existing right-side settings drawer (`<aside>` around line 1018), replace the bespoke flow buttons + any controls now owned by the shared panel with:

```svelte
<ReaderSettingsPanel bind:settings variant="epub" />
```

Keep theme/font picker UI that's not yet in the shared panel — those remain in BookReader for now (the panel only renders the new + flow controls in v1).

- [ ] **Step 5: Drive foliate flow via effect**

Replace the existing `flow`-change effect (lines ~687-691) with:

```ts
$effect(() => {
	if (!view?.renderer) return;
	view.renderer.setAttribute('flow', settings.flow);
	view.renderer.setAttribute('dir', settings.direction);
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm check
```
Expected: 0 errors.

- [ ] **Step 7: Manual smoke**

```bash
pnpm dev
```

In a browser at the dev URL:
- Open a book; verify it loads in paginated mode with the new shared panel visible
- Toggle Flow → Scrolled, verify behavior changes
- Toggle Direction → RTL, swipe; verify swipe direction inverts
- Reload page; settings persist

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/books/BookReader.svelte
git commit -m "feat(reader): wire BookReader to shared settings + viewport (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add paginated mode to PdfReader

**Files:**
- Modify: `src/lib/components/books/PdfReader.svelte`

PdfReader currently renders pages into a vertically scrolling container with `overflow-y: auto`. To add paginated mode, render only the visible page(s) at fit-to-viewport sizing and let prev/next callbacks change `currentPage`.

- [ ] **Step 1: Adopt shared settings**

Add at top of `<script>`:

```ts
import { loadReaderSettings, persistReaderSettings, resolveSpread, type ReaderSettings } from './reader-settings';
import PaginatedViewport from './PaginatedViewport.svelte';
import ReaderSettingsPanel from './ReaderSettingsPanel.svelte';

let settings = $state<ReaderSettings>(loadReaderSettings());
$effect(() => { persistReaderSettings(settings); });
```

Remove the existing `let spreadMode = $state<'single' | 'dual'>('single');` — replace its usages with `resolveSpread(settings.spread, viewportWidth)` (capture `viewportWidth` from the wrapper or a local `$state` updated on resize).

- [ ] **Step 2: Wrap rendered pages in PaginatedViewport**

Replace the outer scroll container with:

```svelte
<PaginatedViewport
	{settings}
	onPrev={goPrevPage}
	onNext={goNextPage}
	onToggleUI={() => { settingsOpen = !settingsOpen; }}
>
	{#snippet children({ effectiveSpread })}
		<div class="pdf-pages" data-flow={settings.flow} data-spread={effectiveSpread}>
			{#if settings.flow === 'paginated'}
				<!-- Render only currentPage (and currentPage+1 if dual) -->
				<canvas data-page={currentPage} bind:this={canvasRefs[currentPage]}></canvas>
				{#if effectiveSpread === 'dual' && currentPage + 1 <= totalPages}
					<canvas data-page={currentPage + 1} bind:this={canvasRefs[currentPage + 1]}></canvas>
				{/if}
			{:else}
				<!-- Existing scrolled-mode rendering: all pages stacked -->
				{#each Array(totalPages) as _, i}
					<canvas data-page={i + 1} bind:this={canvasRefs[i + 1]}></canvas>
				{/each}
			{/if}
		</div>
	{/snippet}
</PaginatedViewport>
```

(Adapt to the actual canvas-rendering pattern in this file — canvas refs, render queue, etc.)

- [ ] **Step 3: Add prev/next page navigation**

```ts
function goPrevPage() {
	const step = resolveSpread(settings.spread, window.innerWidth) === 'dual' ? 2 : 1;
	currentPage = Math.max(1, currentPage - step);
}
function goNextPage() {
	const step = resolveSpread(settings.spread, window.innerWidth) === 'dual' ? 2 : 1;
	currentPage = Math.min(totalPages, currentPage + step);
}
```

- [ ] **Step 4: Persist current page to play_sessions**

Existing scrolled-mode save loop already writes `currentPage` to `play_sessions.position`. In paginated mode, the same write fires whenever `currentPage` changes — wrap the existing save call in an `$effect` keyed off `currentPage` if it isn't already.

- [ ] **Step 5: Render the shared settings panel in the existing drawer**

Inside the PDF reader's right-side settings drawer, add:

```svelte
<ReaderSettingsPanel bind:settings variant="pdf" />
```

Remove the old single/dual spread toggle (now owned by `settings.spread`).

- [ ] **Step 6: Typecheck**

```bash
pnpm check
```
Expected: 0 errors.

- [ ] **Step 7: Manual smoke**

Open a PDF in dev. Toggle Flow → Paginated, verify only current page(s) render. Click left/right tap zones. Swipe on a touch device or DevTools touch emulation. Toggle Spread → Single/Dual/Auto and verify rendering matches.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/books/PdfReader.svelte
git commit -m "feat(reader): add paginated mode to PDF reader (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Cleanup KeyboardShortcuts (delete or generalize)

**Files:**
- Modify or delete: `src/lib/components/books/KeyboardShortcuts.svelte`

The keyboard half of `useReaderInputs` now centralizes shortcuts. Check whether `KeyboardShortcuts.svelte` is still doing useful work (it may render a help overlay listing shortcuts — keep that part) or whether it's purely a listener (delete and remove its imports).

- [ ] **Step 1: Inspect**

```bash
cat src/lib/components/books/KeyboardShortcuts.svelte
grep -rn 'KeyboardShortcuts' src/lib/components/books/
```

- [ ] **Step 2: Decide**

- If it's purely listener wiring → delete the file, remove imports/usages from BookReader, rely on `useReaderInputs.attachKeyboard()`.
- If it renders a help overlay → keep the overlay markup, delete the listener half, remove duplicate handlers.

- [ ] **Step 3: Typecheck**

```bash
pnpm check
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/books/
git commit -m "refactor(reader): consolidate keyboard handling into useReaderInputs (#61)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Skip this commit if no changes were needed.)

---

## Task 8: Run full test suite + dev-build verification

**Files:** none (verification step)

- [ ] **Step 1: Vitest full run**

```bash
pnpm vitest run
```
Expected: all passing. Investigate any failures before proceeding.

- [ ] **Step 2: Typecheck full**

```bash
pnpm check
```
Expected: 0 errors.

- [ ] **Step 3: Production build**

```bash
pnpm build
```
Expected: build succeeds.

- [ ] **Step 4: Smoke run server build locally**

```bash
PORT=8585 NEXUS_ENCRYPTION_KEY=$(openssl rand -hex 32) node build/index.js &
SERVER_PID=$!
sleep 5
curl -sf http://localhost:8585/api/health && echo OK
kill $SERVER_PID
```

Expected: `OK`. If startup fails, fix before deploy.

- [ ] **Step 5: Commit any fixes from build verification**

```bash
git status
# If any changes from build/smoke fixes:
git add <files>
git commit -m "fix(reader): build verification fixes (#61)"
```

---

## Task 9: Deploy :dev image to jellyfin host

**Files:** none (deployment step)

The jellyfin host (10.10.10.15) currently runs the `ghcr.io/petalcat/nexus:dev` image built earlier from main. Replace it with a fresh image built from this branch.

- [ ] **Step 1: Rsync source to server**

```bash
rsync -a --delete \
  --exclude=node_modules --exclude=.svelte-kit --exclude=build \
  --exclude=.git --exclude=.worktrees --exclude='.claude/worktrees' \
  --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
  --exclude=test-results --exclude=playwright-report \
  --exclude=data --exclude=stream-proxy/target \
  /Users/parker/Developer/Nexus/.worktrees/reader-paginated/ \
  jellyfin@10.10.10.15:/home/jellyfin/docker/nexus-dev/
```

- [ ] **Step 2: Build image on server**

```bash
ssh jellyfin@10.10.10.15 "cd /home/jellyfin/docker/nexus-dev && docker build -t ghcr.io/petalcat/nexus:dev ."
```

- [ ] **Step 3: Recreate container**

```bash
ssh jellyfin@10.10.10.15 "cd /home/jellyfin/docker/nexus && docker compose up -d"
```

- [ ] **Step 4: Verify health + book load**

```bash
ssh jellyfin@10.10.10.15 "until curl -sf http://localhost:8585/api/health >/dev/null; do sleep 2; done && echo READY && docker logs nexus-nexus-1 --tail 20"
```

Expected: `READY` and log shows server listening.

Then ask the user to test `/books/read/<id>` in the browser — verify EPUB loads in paginated mode, settings drawer shows new controls, prev/next works via tap/swipe/keyboard, Flow → Scrolled toggle works.

- [ ] **Step 5: Final user-test sign-off**

After user confirms it works, the next session will:
- Commit any user-reported polish fixes
- Open PR `feature/reader-paginated-mode → main`
- After PR merge, GH Actions builds `ghcr.io/petalcat/nexus:latest`
- Revert `/home/jellyfin/docker/nexus/docker-compose.yml` to `:latest` and `docker compose pull && up -d`

---

## Out of Scope (per spec)

- Page curl animation
- Per-zone tap action remapping
- Two-up cover handling (first page solo)
- Per-book settings overrides
