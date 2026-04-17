import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		exclude: ['pdfjs-dist']
	}
	// Note: we do NOT set manualChunks for pdfjs. The PdfReader uses
	// `pdfjs-dist` from node_modules, while foliate-js's EPUB engine
	// uses its own vendored pdfjs under src/lib/vendor/foliate-js/vendor/pdfjs/.
	// They live in two different chunks (CfNotEve vs vkbVaD7t), but each
	// reader route only loads one of them, so merging them would actually
	// waste bytes on every reader visit. Leave them split.
});
