// Node 25 ships a native `localStorage` that requires `--localstorage-file=<path>`
// to function. Inside vitest's jsdom environment, that native stub shadows jsdom's
// own Storage — leaving `setItem`/`clear`/etc. undefined. This setup file installs
// a simple Map-backed Storage polyfill so component tests get the DOM behavior
// they expect without CLI flags. Load order: applied once before each test file
// that opts into the jsdom environment.

const backing = new Map<string, string>();

const storage: Storage = {
	get length() {
		return backing.size;
	},
	clear() {
		backing.clear();
	},
	getItem(key: string) {
		return backing.has(key) ? backing.get(key)! : null;
	},
	key(index: number) {
		return Array.from(backing.keys())[index] ?? null;
	},
	removeItem(key: string) {
		backing.delete(key);
	},
	setItem(key: string, value: string) {
		backing.set(key, String(value));
	}
};

Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	writable: true,
	value: storage
});

// Keep window.localStorage and globalThis.localStorage pointing at the same object
// so code that uses either sees the same data.
if (typeof window !== 'undefined') {
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		writable: true,
		value: storage
	});
}
