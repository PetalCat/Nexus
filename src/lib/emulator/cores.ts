// ---------------------------------------------------------------------------
// EmulatorJS core mapping — maps RomM platformSlug to EmulatorJS core/system
// ---------------------------------------------------------------------------

export interface EmulatorCoreConfig {
	core: string;
	system: string;
}

const PLATFORM_CORE_MAP: Record<string, EmulatorCoreConfig> = {
	// Nintendo
	nes: { core: 'nes', system: 'nes' },
	famicom: { core: 'nes', system: 'nes' },
	snes: { core: 'snes', system: 'snes' },
	'super-famicom': { core: 'snes', system: 'snes' },
	n64: { core: 'n64', system: 'n64' },
	gb: { core: 'gb', system: 'gb' },
	gbc: { core: 'gb', system: 'gbc' },
	gba: { core: 'gba', system: 'gba' },
	nds: { core: 'nds', system: 'nds' },
	vb: { core: 'vb', system: 'vb' },

	// Sega
	'genesis-slash-megadrive': { core: 'segaMD', system: 'segaMD' },
	genesis: { core: 'segaMD', system: 'segaMD' },
	megadrive: { core: 'segaMD', system: 'segaMD' },
	sms: { core: 'segaMS', system: 'segaMS' },
	'master-system-slash-mark-iii': { core: 'segaMS', system: 'segaMS' },
	'game-gear': { core: 'segaGG', system: 'segaGG' },
	gamegear: { core: 'segaGG', system: 'segaGG' },
	saturn: { core: 'segaSaturn', system: 'segaSaturn' },
	'sega-32x': { core: 'sega32x', system: 'sega32x' },
	'32x': { core: 'sega32x', system: 'sega32x' },
	'sega-cd': { core: 'segaCD', system: 'segaCD' },

	// Sony
	ps: { core: 'psx', system: 'psx' },
	psx: { core: 'psx', system: 'psx' },
	ps1: { core: 'psx', system: 'psx' },
	psp: { core: 'psp', system: 'psp' },

	// Atari
	atari2600: { core: 'atari2600', system: 'atari2600' },
	'atari-2600': { core: 'atari2600', system: 'atari2600' },
	atari7800: { core: 'atari7800', system: 'atari7800' },
	'atari-7800': { core: 'atari7800', system: 'atari7800' },
	jaguar: { core: 'jaguar', system: 'jaguar' },
	lynx: { core: 'lynx', system: 'lynx' },

	// NEC
	'turbografx-16-slash-pc-engine': { core: 'pce', system: 'pce' },
	'pc-engine': { core: 'pce', system: 'pce' },
	tg16: { core: 'pce', system: 'pce' },
	pcfx: { core: 'pcfx', system: 'pcfx' },

	// SNK
	'neo-geo': { core: 'arcade', system: 'arcade' },
	neogeo: { core: 'arcade', system: 'arcade' },
	'neo-geo-pocket': { core: 'ngp', system: 'ngp' },
	'neo-geo-pocket-color': { core: 'ngp', system: 'ngp' },

	// Other
	arcade: { core: 'arcade', system: 'arcade' },
	mame: { core: 'mame2003', system: 'mame2003' },
	'3do': { core: '3do', system: '3do' },
	wonderswan: { core: 'ws', system: 'ws' },
	'wonderswan-color': { core: 'ws', system: 'ws' },
	colecovision: { core: 'coleco', system: 'coleco' },
	vectrex: { core: 'vectrex', system: 'vectrex' }
};

export function isPlayableInBrowser(platformSlug?: string): boolean {
	if (!platformSlug) return false;
	return platformSlug.toLowerCase() in PLATFORM_CORE_MAP;
}

export function getCoreConfig(platformSlug: string): EmulatorCoreConfig | null {
	return PLATFORM_CORE_MAP[platformSlug.toLowerCase()] ?? null;
}

export interface EmulatorJSConfig {
	core: string;
	system: string;
	gameUrl: string;
	pathtodata: string;
	color: string;
}

export function getEmulatorJSConfig(
	platformSlug: string,
	romUrl: string,
	opts?: { color?: string }
): EmulatorJSConfig | null {
	const config = getCoreConfig(platformSlug);
	if (!config) return null;

	return {
		core: config.core,
		system: config.system,
		gameUrl: romUrl,
		pathtodata: 'https://cdn.emulatorjs.org/stable/data/',
		color: opts?.color ?? '#6d28d9'
	};
}
