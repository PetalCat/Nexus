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
