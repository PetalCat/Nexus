import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';

export default defineConfig({
	// `wasm` lets us import nucleo-matcher-wasm (a wasm-pack "bundler target" that
	// does `import * as wasm from './…wasm'`). Used CLIENT-side only — the home
	// page lazy-imports it in the browser to rank search results with the real
	// fzf-grade matcher, so SSR never touches the wasm.
	plugins: [tailwindcss(), wasm(), sveltekit()],
	// nucleo's wasm glue initialises via top-level await; raise the target so it
	// survives the build instead of pulling in vite-plugin-top-level-await (which
	// drags in a native @swc/core). All target browsers support TLA.
	build: { target: 'esnext' },
	optimizeDeps: {
		exclude: ['pdfjs-dist', 'nucleo-matcher-wasm']
	}
	// Note: we do NOT set manualChunks for pdfjs. The PdfReader uses
	// `pdfjs-dist` from node_modules, while foliate-js's EPUB engine
	// uses its own vendored pdfjs under src/lib/vendor/foliate-js/vendor/pdfjs/.
	// They live in two different chunks (CfNotEve vs vkbVaD7t), but each
	// reader route only loads one of them, so merging them would actually
	// waste bytes on every reader visit. Leave them split.
});
