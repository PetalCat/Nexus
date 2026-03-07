let _open = $state(false);
let _scope = $state<string | undefined>(undefined);

export const palette = {
	get open() { return _open; },
	get scope() { return _scope; },
};

export function openPalette(scope?: string) {
	_scope = scope;
	_open = true;
}

export function closePalette() {
	_open = false;
}

export function togglePalette(scope?: string) {
	if (_open) {
		closePalette();
	} else {
		openPalette(scope);
	}
}

export function setScope(scope: string | undefined) {
	_scope = scope;
}
