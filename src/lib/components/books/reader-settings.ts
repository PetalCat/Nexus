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
