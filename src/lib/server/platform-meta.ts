import type { RommPlatform } from '../adapters/romm';

export interface PlatformInfo {
	id: number;
	name: string;
	fullName: string;
	slug: string;
	manufacturer: string;
	year: number | null;
	generation: number | null;
	color: string;
	romCount: number;
	logo?: string;
}

interface PlatformMeta {
	fullName: string;
	manufacturer: string;
	year: number | null;
	generation: number | null;
	color: string;
}

// Static enrichment data keyed by common platform slugs
const PLATFORM_DB: Record<string, PlatformMeta> = {
	// Nintendo
	nes: { fullName: 'Nintendo Entertainment System', manufacturer: 'Nintendo', year: 1983, generation: 3, color: '#e60012' },
	snes: { fullName: 'Super Nintendo Entertainment System', manufacturer: 'Nintendo', year: 1990, generation: 4, color: '#7b5ea7' },
	n64: { fullName: 'Nintendo 64', manufacturer: 'Nintendo', year: 1996, generation: 5, color: '#009900' },
	gc: { fullName: 'Nintendo GameCube', manufacturer: 'Nintendo', year: 2001, generation: 6, color: '#6a0dad' },
	gamecube: { fullName: 'Nintendo GameCube', manufacturer: 'Nintendo', year: 2001, generation: 6, color: '#6a0dad' },
	wii: { fullName: 'Nintendo Wii', manufacturer: 'Nintendo', year: 2006, generation: 7, color: '#00a4dc' },
	wiiu: { fullName: 'Nintendo Wii U', manufacturer: 'Nintendo', year: 2012, generation: 8, color: '#009ac7' },
	switch: { fullName: 'Nintendo Switch', manufacturer: 'Nintendo', year: 2017, generation: 8, color: '#e60012' },
	gb: { fullName: 'Game Boy', manufacturer: 'Nintendo', year: 1989, generation: 4, color: '#8b8b73' },
	gbc: { fullName: 'Game Boy Color', manufacturer: 'Nintendo', year: 1998, generation: 5, color: '#6a0dad' },
	gba: { fullName: 'Game Boy Advance', manufacturer: 'Nintendo', year: 2001, generation: 6, color: '#5555ff' },
	nds: { fullName: 'Nintendo DS', manufacturer: 'Nintendo', year: 2004, generation: 7, color: '#ccc' },
	'3ds': { fullName: 'Nintendo 3DS', manufacturer: 'Nintendo', year: 2011, generation: 8, color: '#ce181e' },

	// Sony
	ps: { fullName: 'PlayStation', manufacturer: 'Sony', year: 1994, generation: 5, color: '#003087' },
	ps1: { fullName: 'PlayStation', manufacturer: 'Sony', year: 1994, generation: 5, color: '#003087' },
	psx: { fullName: 'PlayStation', manufacturer: 'Sony', year: 1994, generation: 5, color: '#003087' },
	ps2: { fullName: 'PlayStation 2', manufacturer: 'Sony', year: 2000, generation: 6, color: '#003087' },
	ps3: { fullName: 'PlayStation 3', manufacturer: 'Sony', year: 2006, generation: 7, color: '#003087' },
	ps4: { fullName: 'PlayStation 4', manufacturer: 'Sony', year: 2013, generation: 8, color: '#003087' },
	ps5: { fullName: 'PlayStation 5', manufacturer: 'Sony', year: 2020, generation: 9, color: '#003087' },
	psp: { fullName: 'PlayStation Portable', manufacturer: 'Sony', year: 2004, generation: 7, color: '#003087' },
	vita: { fullName: 'PlayStation Vita', manufacturer: 'Sony', year: 2011, generation: 8, color: '#003087' },

	// Sega
	'master-system': { fullName: 'Sega Master System', manufacturer: 'Sega', year: 1985, generation: 3, color: '#0060a8' },
	genesis: { fullName: 'Sega Genesis', manufacturer: 'Sega', year: 1988, generation: 4, color: '#171717' },
	'mega-drive': { fullName: 'Sega Mega Drive', manufacturer: 'Sega', year: 1988, generation: 4, color: '#171717' },
	saturn: { fullName: 'Sega Saturn', manufacturer: 'Sega', year: 1994, generation: 5, color: '#171717' },
	dreamcast: { fullName: 'Sega Dreamcast', manufacturer: 'Sega', year: 1998, generation: 6, color: '#ff6600' },
	'game-gear': { fullName: 'Sega Game Gear', manufacturer: 'Sega', year: 1990, generation: 4, color: '#171717' },

	// Microsoft
	xbox: { fullName: 'Xbox', manufacturer: 'Microsoft', year: 2001, generation: 6, color: '#107c10' },
	xbox360: { fullName: 'Xbox 360', manufacturer: 'Microsoft', year: 2005, generation: 7, color: '#107c10' },
	xboxone: { fullName: 'Xbox One', manufacturer: 'Microsoft', year: 2013, generation: 8, color: '#107c10' },

	// Atari
	atari2600: { fullName: 'Atari 2600', manufacturer: 'Atari', year: 1977, generation: 2, color: '#c1272d' },
	atari7800: { fullName: 'Atari 7800', manufacturer: 'Atari', year: 1986, generation: 3, color: '#c1272d' },
	jaguar: { fullName: 'Atari Jaguar', manufacturer: 'Atari', year: 1993, generation: 5, color: '#c1272d' },
	lynx: { fullName: 'Atari Lynx', manufacturer: 'Atari', year: 1989, generation: 4, color: '#c1272d' },

	// Other
	'neo-geo': { fullName: 'Neo Geo', manufacturer: 'SNK', year: 1990, generation: 4, color: '#ffd700' },
	'neo-geo-pocket': { fullName: 'Neo Geo Pocket', manufacturer: 'SNK', year: 1998, generation: 5, color: '#ffd700' },
	'turbografx-16': { fullName: 'TurboGrafx-16', manufacturer: 'NEC', year: 1987, generation: 4, color: '#ff6600' },
	'pc-engine': { fullName: 'PC Engine', manufacturer: 'NEC', year: 1987, generation: 4, color: '#ff6600' },
	'3do': { fullName: '3DO Interactive Multiplayer', manufacturer: 'The 3DO Company', year: 1993, generation: 5, color: '#cc0000' },
	arcade: { fullName: 'Arcade', manufacturer: 'Various', year: null, generation: null, color: '#f59e0b' },
	dos: { fullName: 'MS-DOS', manufacturer: 'Microsoft', year: 1981, generation: null, color: '#444' },
	pc: { fullName: 'PC', manufacturer: 'Various', year: null, generation: null, color: '#888' },
};

export function enrichPlatform(platform: RommPlatform): PlatformInfo {
	const slug = platform.slug?.toLowerCase() ?? '';
	const meta = PLATFORM_DB[slug];

	return {
		id: platform.id,
		name: platform.display_name,
		fullName: meta?.fullName ?? platform.display_name,
		slug: platform.slug,
		manufacturer: meta?.manufacturer ?? 'Unknown',
		year: meta?.year ?? null,
		generation: meta?.generation ?? null,
		color: meta?.color ?? '#7c6cf8',
		romCount: platform.rom_count,
		logo: platform.url_logo
	};
}
