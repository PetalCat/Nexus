# Nexus Public Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static public-facing website for Nexus — a product/landing site with poster rain hero, feature showcase, integrations page, install guide, and about page.

**Architecture:** SvelteKit static site (adapter-static) in a new standalone repo. No backend. Tailwind CSS v4 + scoped Svelte styles. Public domain artwork for the poster rain hero animation.

**Tech Stack:** SvelteKit, @sveltejs/adapter-static, Tailwind CSS v4, DM Sans (Google Fonts), TypeScript

**Design Spec:** `docs/superpowers/specs/2026-04-10-nexus-website-design.md` in the Nexus repo

---

## File Structure

```
nexus-website/
  package.json
  svelte.config.js
  vite.config.ts
  tsconfig.json
  src/
    app.html
    app.css                         # CSS custom properties, base styles, Tailwind import, grain, gradients, buttons, scroll reveal
    lib/
      actions/
        reveal.ts                   # IntersectionObserver scroll reveal action
      components/
        Nav.svelte                  # Fixed nav, blur-on-scroll, mobile hamburger
        Footer.svelte               # 4-column footer grid
        SectionHeading.svelte       # Reusable label + title + description pattern
        FeatureCard.svelte          # Icon + title + description card with hover glow
        ServiceCard.svelte          # Service icon + name + category + description
        TerminalCard.svelte         # Styled terminal with syntax-colored code
        HeroRain.svelte             # Poster rain animation (CSS columns, alternating drift)
        StepCard.svelte             # Numbered step card for "How It Works"
    routes/
      +layout.svelte                # Skip link, Nav, main, Footer
      +layout.ts                    # export const prerender = true
      +page.svelte                  # Home page
      +error.svelte                 # Error page
      features/
        +page.svelte                # Features deep dive
      integrations/
        +page.svelte                # Service grid + disclaimer
      install/
        +page.svelte                # Docker/source install guide
      about/
        +page.svelte                # About, community, legal
  static/
    favicon.svg                     # Nexus star icon
    posters/                        # Public domain artwork (added in Task 10)
```

---

### Task 1: Scaffold the SvelteKit project

**Files:**
- Create: `nexus-website/package.json`
- Create: `nexus-website/svelte.config.js`
- Create: `nexus-website/vite.config.ts`
- Create: `nexus-website/tsconfig.json`
- Create: `nexus-website/src/app.html`

- [ ] **Step 1: Create the repo directory and initialize**

```bash
mkdir -p /Users/parker/Developer/nexus-website
cd /Users/parker/Developer/nexus-website
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add -D @sveltejs/kit @sveltejs/adapter-static @sveltejs/vite-plugin-svelte svelte vite typescript @tailwindcss/vite tailwindcss
```

- [ ] **Step 3: Create svelte.config.js**

```js
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		paths: {
			relative: false
		},
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '404.html',
			precompress: false,
			strict: true
		})
	}
};

export default config;
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()]
});
```

- [ ] **Step 5: Create tsconfig.json**

```json
{
	"extends": "./.svelte-kit/tsconfig.json",
	"compilerOptions": {
		"allowJs": true,
		"checkJs": true,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"sourceMap": true,
		"strict": true,
		"moduleResolution": "bundler"
	}
}
```

- [ ] **Step 6: Create src/app.html**

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" href="%sveltekit.assets%/favicon.svg" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

- [ ] **Step 7: Create a minimal favicon**

Create `static/favicon.svg` — reuse the Nexus star SVG from the main repo (`/Users/parker/Developer/Nexus/static/favicon.svg`). Copy it over.

- [ ] **Step 8: Initialize git and commit**

```bash
cd /Users/parker/Developer/nexus-website
git init
echo "node_modules\n.svelte-kit\nbuild\n.DS_Store" > .gitignore
git add .
git commit -m "chore: scaffold SvelteKit static site"
```

---

### Task 2: Global styles and CSS custom properties

**Files:**
- Create: `src/app.css`

- [ ] **Step 1: Create src/app.css with Tailwind import, custom properties, base styles, utility classes, and button styles**

```css
@import 'tailwindcss';

/* ---- Custom Properties ---- */
:root {
	--bg: #050507;
	--bg-surface: #0e0d12;
	--text: #f0ebe3;
	--text-muted: #807870;
	--accent: #c9a76a;
	--accent-light: #e0cca8;
	--accent-dark: #a88648;
	--border: rgba(200, 170, 130, 0.08);
	--border-hover: rgba(200, 170, 130, 0.25);
	--font-display: 'DM Sans', system-ui, sans-serif;
	--font-body: 'DM Sans', system-ui, sans-serif;
	--font-mono: 'JetBrains Mono', monospace;
}

/* ---- Base ---- */
*,
*::before,
*::after {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

html {
	scroll-behavior: smooth;
	background: var(--bg);
	color: var(--text);
	font-family: var(--font-body);
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

body {
	background: var(--bg);
	overflow-x: hidden;
}

h1, h2, h3, h4, h5, h6 {
	font-family: var(--font-display);
	font-weight: 700;
	line-height: 1.1;
	letter-spacing: -0.02em;
}

/* ---- Grain Overlay ---- */
body::after {
	content: '';
	position: fixed;
	inset: 0;
	pointer-events: none;
	z-index: 9999;
	background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
	background-size: 128px;
	opacity: 0.4;
}

/* ---- Gradient Text ---- */
.gradient-text {
	background: linear-gradient(135deg, #e0cca8 0%, #c9a76a 100%);
	-webkit-background-clip: text;
	-webkit-text-fill-color: transparent;
	background-clip: text;
}

/* ---- Scroll Reveal ---- */
.reveal {
	opacity: 0;
	transform: translateY(30px);
	transition:
		opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1),
		transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.reveal.visible {
	opacity: 1;
	transform: translateY(0);
}

/* ---- Buttons ---- */
.btn-primary {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 1.75rem;
	background: linear-gradient(135deg, var(--accent), var(--accent-dark));
	color: var(--bg);
	font-family: var(--font-display);
	font-weight: 700;
	font-size: 0.9rem;
	border: none;
	border-radius: 12px;
	cursor: pointer;
	text-decoration: none;
	transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	box-shadow: 0 0 24px rgba(200, 167, 106, 0.2);
}

.btn-primary:hover {
	transform: translateY(-2px);
	box-shadow: 0 0 36px rgba(200, 167, 106, 0.35), 0 8px 32px rgba(200, 167, 106, 0.15);
}

.btn-secondary {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 1.75rem;
	background: transparent;
	color: var(--accent);
	font-family: var(--font-display);
	font-weight: 600;
	font-size: 0.9rem;
	border: 1px solid rgba(200, 170, 130, 0.2);
	border-radius: 12px;
	cursor: pointer;
	text-decoration: none;
	transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-secondary:hover {
	border-color: var(--accent);
	color: var(--text);
	transform: translateY(-2px);
	box-shadow: 0 0 20px rgba(200, 167, 106, 0.15);
}

/* ---- Focus ---- */
:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}

/* ---- Selection ---- */
::selection {
	background: rgba(200, 167, 106, 0.3);
	color: #fff;
}

/* ---- Scrollbar ---- */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: rgba(200, 170, 130, 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); }

/* ---- Reduced Motion ---- */
@media (prefers-reduced-motion: reduce) {
	*, *::before, *::after {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
		scroll-behavior: auto !important;
	}
	.reveal { opacity: 1 !important; transform: none !important; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app.css
git commit -m "feat: add global styles, custom properties, and utility classes"
```

---

### Task 3: Scroll reveal action + layout shell

**Files:**
- Create: `src/lib/actions/reveal.ts`
- Create: `src/routes/+layout.ts`
- Create: `src/routes/+layout.svelte`
- Create: `src/routes/+error.svelte`

- [ ] **Step 1: Create src/lib/actions/reveal.ts**

```ts
export function reveal(node: HTMLElement, options?: { delay?: number; threshold?: number }) {
	const delay = options?.delay ?? 0;
	const threshold = options?.threshold ?? 0.15;

	node.classList.add('reveal');
	if (delay) {
		node.style.transitionDelay = `${delay}ms`;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					node.classList.add('visible');
					observer.unobserve(node);
				}
			});
		},
		{ threshold }
	);

	observer.observe(node);

	return {
		destroy() {
			observer.unobserve(node);
		}
	};
}
```

- [ ] **Step 2: Create src/routes/+layout.ts**

```ts
export const prerender = true;
```

- [ ] **Step 3: Create src/routes/+layout.svelte**

This is a placeholder — Nav and Footer will be added after they're built in later tasks.

```svelte
<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<a href="#main-content" class="skip-link">Skip to content</a>
<main id="main-content">
	{@render children()}
</main>

<style>
	.skip-link {
		position: absolute;
		top: -100px;
		left: 0;
		background: var(--accent);
		color: var(--bg);
		padding: 0.5rem 1rem;
		z-index: 1000;
		font-weight: 700;
		font-size: 0.9rem;
		transition: top 0.2s;
	}
	.skip-link:focus {
		top: 0;
	}
</style>
```

- [ ] **Step 4: Create src/routes/+error.svelte**

```svelte
<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Error — Nexus</title>
</svelte:head>

<section class="error-page">
	<h1>{page.status}</h1>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<a href="/" class="btn-primary">Back to Home</a>
</section>

<style>
	.error-page {
		min-height: 80vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 1rem;
		padding: 2rem;
	}
	h1 {
		font-size: 5rem;
		font-weight: 900;
		color: var(--accent);
	}
	p {
		color: var(--text-muted);
		font-size: 1.1rem;
	}
</style>
```

- [ ] **Step 5: Verify it runs**

```bash
pnpm dev
```

Expected: Dev server starts, blank page loads at localhost:5173 with the dark background and grain overlay visible.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/reveal.ts src/routes/+layout.ts src/routes/+layout.svelte src/routes/+error.svelte
git commit -m "feat: add layout shell, scroll reveal action, error page"
```

---

### Task 4: Nav component

**Files:**
- Create: `src/lib/components/Nav.svelte`
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Create src/lib/components/Nav.svelte**

```svelte
<script lang="ts">
	import { page } from '$app/state';

	let scrolled = $state(false);
	let mobileOpen = $state(false);

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/features', label: 'Features' },
		{ href: '/integrations', label: 'Integrations' },
		{ href: '/install', label: 'Install' },
		{ href: '/about', label: 'About' }
	];

	function handleScroll() {
		scrolled = window.scrollY > 20;
	}

	function closeMobile() {
		mobileOpen = false;
		document.body.style.overflow = '';
	}

	function toggleMobile() {
		mobileOpen = !mobileOpen;
		document.body.style.overflow = mobileOpen ? 'hidden' : '';
	}
</script>

<svelte:window onscroll={handleScroll} />

<nav class="nav" class:scrolled>
	<div class="nav-inner">
		<a href="/" class="logo" onclick={closeMobile}>
			<div class="logo-icon">N</div>
			<span class="logo-text">Nexus</span>
		</a>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="nav-links" class:open={mobileOpen} onclick={(e) => { if (e.target === e.currentTarget) closeMobile(); }}>
			{#each links as link}
				<a
					href={link.href}
					class="nav-link"
					class:active={page.url.pathname === link.href}
					onclick={closeMobile}
				>
					{link.label}
				</a>
			{/each}
			<a href="/install" class="btn-primary nav-cta">Get Started</a>
		</div>

		<button
			class="mobile-toggle"
			onclick={toggleMobile}
			aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
			aria-expanded={mobileOpen}
		>
			<span class="bar" class:open={mobileOpen}></span>
			<span class="bar" class:open={mobileOpen}></span>
			<span class="bar" class:open={mobileOpen}></span>
		</button>
	</div>
</nav>

<style>
	.nav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: 1rem 0;
		transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.nav.scrolled {
		background: rgba(5, 5, 7, 0.8);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-bottom: 1px solid var(--border);
		padding: 0.6rem 0;
	}

	.nav-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
		color: var(--text);
		z-index: 101;
	}

	.logo-icon {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: linear-gradient(135deg, var(--accent), var(--accent-dark));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 900;
		color: var(--bg);
	}

	.logo-text {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.2rem;
		letter-spacing: -0.03em;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.nav-link {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 0.9rem;
		color: var(--text-muted);
		text-decoration: none;
		padding: 0.5rem 0.85rem;
		border-radius: 8px;
		transition: all 0.2s ease;
	}

	.nav-link:hover { color: var(--text); background: rgba(255, 255, 255, 0.04); }
	.nav-link.active { color: var(--text); background: rgba(200, 167, 106, 0.1); }

	.nav-cta {
		margin-left: 0.75rem;
		padding: 0.55rem 1.3rem;
		font-size: 0.82rem;
	}

	.mobile-toggle {
		display: none;
		flex-direction: column;
		gap: 5px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		z-index: 101;
	}

	.bar {
		display: block;
		width: 22px;
		height: 2px;
		background: var(--text);
		border-radius: 2px;
		transition: all 0.3s ease;
	}

	.bar.open:nth-child(1) { transform: translateY(7px) rotate(45deg); }
	.bar.open:nth-child(2) { opacity: 0; }
	.bar.open:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

	@media (max-width: 768px) {
		.mobile-toggle { display: flex; }

		.nav-links {
			position: fixed;
			inset: 0;
			background: rgba(5, 5, 7, 0.95);
			backdrop-filter: blur(20px);
			-webkit-backdrop-filter: blur(20px);
			flex-direction: column;
			justify-content: center;
			gap: 0.5rem;
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.3s ease;
		}

		.nav-links.open { opacity: 1; pointer-events: all; }
		.nav-link { font-size: 1.3rem; padding: 0.75rem 1.5rem; }
		.nav-cta { margin-left: 0; margin-top: 1rem; }
	}
</style>
```

- [ ] **Step 2: Update src/routes/+layout.svelte to include Nav**

Replace the entire file:

```svelte
<script lang="ts">
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';

	let { children } = $props();
</script>

<a href="#main-content" class="skip-link">Skip to content</a>
<Nav />
<main id="main-content">
	{@render children()}
</main>

<style>
	.skip-link {
		position: absolute;
		top: -100px;
		left: 0;
		background: var(--accent);
		color: var(--bg);
		padding: 0.5rem 1rem;
		z-index: 1000;
		font-weight: 700;
		font-size: 0.9rem;
		transition: top 0.2s;
	}
	.skip-link:focus {
		top: 0;
	}
</style>
```

- [ ] **Step 3: Verify nav renders**

Check `localhost:5173` — nav should be visible, links should highlight on active route, scroll blur should work.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Nav.svelte src/routes/+layout.svelte
git commit -m "feat: add responsive nav with blur-on-scroll"
```

---

### Task 5: Footer component

**Files:**
- Create: `src/lib/components/Footer.svelte`
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Create src/lib/components/Footer.svelte**

```svelte
<footer class="footer">
	<div class="footer-glow"></div>
	<div class="footer-inner">
		<div class="footer-grid">
			<div class="footer-brand">
				<div class="footer-logo">
					<div class="footer-icon">N</div>
					<span>Nexus</span>
				</div>
				<p class="footer-tagline">Unified self-hosted media frontend.<br />Your services. One interface.</p>
			</div>

			<div class="footer-col">
				<h4>Product</h4>
				<a href="/features">Features</a>
				<a href="/integrations">Integrations</a>
				<a href="/install">Install</a>
			</div>

			<div class="footer-col">
				<h4>Community</h4>
				<a href="https://github.com/PetalCat/Nexus" target="_blank" rel="noopener">GitHub</a>
				<a href="https://github.com/PetalCat/Nexus/issues" target="_blank" rel="noopener">Issues</a>
				<a href="https://github.com/PetalCat/Nexus/discussions" target="_blank" rel="noopener">Discussions</a>
			</div>

			<div class="footer-col">
				<h4>Legal</h4>
				<a href="/about">About</a>
			</div>
		</div>

		<div class="footer-bottom">
			<p>&copy; {new Date().getFullYear()} Nexus by PetalCat. <a href="https://github.com/PetalCat/Nexus" target="_blank" rel="noopener">Open source.</a></p>
		</div>
	</div>
</footer>

<style>
	.footer {
		position: relative;
		border-top: 1px solid var(--border);
		padding: 4rem 0 2rem;
		margin-top: 6rem;
		overflow: hidden;
	}

	.footer-glow {
		position: absolute;
		top: -100px;
		left: 50%;
		transform: translateX(-50%);
		width: 600px;
		height: 200px;
		background: radial-gradient(ellipse, rgba(200, 167, 106, 0.06) 0%, transparent 70%);
		pointer-events: none;
	}

	.footer-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1.5rem;
		position: relative;
	}

	.footer-grid {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr 1fr;
		gap: 3rem;
	}

	.footer-logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.2rem;
		color: var(--text);
		margin-bottom: 0.75rem;
	}

	.footer-icon {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		background: linear-gradient(135deg, var(--accent), var(--accent-dark));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 900;
		color: var(--bg);
	}

	.footer-tagline {
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.footer-col {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.footer-col h4 {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--text);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 0.5rem;
	}

	.footer-col a {
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.2s ease;
	}

	.footer-col a:hover { color: var(--accent); }

	.footer-bottom {
		margin-top: 3rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
		text-align: center;
	}

	.footer-bottom p { color: var(--text-muted); font-size: 0.8rem; }
	.footer-bottom a { color: inherit; text-decoration: underline; }

	@media (max-width: 768px) {
		.footer-grid { grid-template-columns: 1fr 1fr; gap: 2rem; }
		.footer-brand { grid-column: 1 / -1; }
	}

	@media (max-width: 480px) {
		.footer-grid { grid-template-columns: 1fr; }
	}
</style>
```

- [ ] **Step 2: Update +layout.svelte to include Footer**

```svelte
<script lang="ts">
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children } = $props();
</script>

<a href="#main-content" class="skip-link">Skip to content</a>
<Nav />
<main id="main-content">
	{@render children()}
</main>
<Footer />

<style>
	.skip-link {
		position: absolute;
		top: -100px;
		left: 0;
		background: var(--accent);
		color: var(--bg);
		padding: 0.5rem 1rem;
		z-index: 1000;
		font-weight: 700;
		font-size: 0.9rem;
		transition: top 0.2s;
	}
	.skip-link:focus {
		top: 0;
	}
</style>
```

- [ ] **Step 3: Verify footer renders**

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Footer.svelte src/routes/+layout.svelte
git commit -m "feat: add footer with link columns and glow"
```

---

### Task 6: Shared components — SectionHeading, FeatureCard, TerminalCard, StepCard, ServiceCard

**Files:**
- Create: `src/lib/components/SectionHeading.svelte`
- Create: `src/lib/components/FeatureCard.svelte`
- Create: `src/lib/components/TerminalCard.svelte`
- Create: `src/lib/components/StepCard.svelte`
- Create: `src/lib/components/ServiceCard.svelte`

- [ ] **Step 1: Create SectionHeading.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	let { label, title, description = '', center = false }: {
		label: string;
		title: string;
		description?: string;
		center?: boolean;
	} = $props();
</script>

<div class="section-heading" class:center use:reveal>
	<span class="label">{label}</span>
	<h2 class="title">{@html title}</h2>
	{#if description}
		<p class="desc">{description}</p>
	{/if}
</div>

<style>
	.section-heading { margin-bottom: 2.5rem; }
	.center { text-align: center; }
	.center .desc { margin-left: auto; margin-right: auto; }

	.label {
		font-family: var(--font-display);
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent);
		display: block;
		margin-bottom: 0.75rem;
	}

	.title {
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 800;
		color: var(--text);
		letter-spacing: -0.03em;
		margin-bottom: 0.75rem;
	}

	.desc {
		font-size: 1.05rem;
		color: var(--text-muted);
		line-height: 1.7;
		max-width: 600px;
	}
</style>
```

- [ ] **Step 2: Create FeatureCard.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	let { icon, title, description, delay = 0 }: {
		icon: string;
		title: string;
		description: string;
		delay?: number;
	} = $props();
</script>

<div class="feature-card" use:reveal={{ delay }}>
	<div class="icon">{icon}</div>
	<h4>{title}</h4>
	<p>{description}</p>
	<div class="glow"></div>
</div>

<style>
	.feature-card {
		position: relative;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.75rem;
		overflow: hidden;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.feature-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-3px);
	}

	.feature-card:hover .glow { opacity: 1; }

	.icon { font-size: 1.5rem; margin-bottom: 1rem; }

	h4 {
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 0.5rem;
	}

	p {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.glow {
		position: absolute;
		top: -50%;
		left: -50%;
		width: 200%;
		height: 200%;
		background: radial-gradient(circle at 30% 30%, var(--accent), transparent 60%);
		opacity: 0;
		transition: opacity 0.4s ease;
		pointer-events: none;
		mix-blend-mode: overlay;
		filter: blur(40px);
	}
</style>
```

- [ ] **Step 3: Create TerminalCard.svelte**

```svelte
<script lang="ts">
	let { code, comment = '' }: { code: string; comment?: string } = $props();
</script>

<div class="terminal">
	<div class="terminal-header">
		<div class="dots">
			<span style="background: #FF5F57"></span>
			<span style="background: #FFBD2E"></span>
			<span style="background: #27C93F"></span>
		</div>
		<span class="title">Terminal</span>
	</div>
	<div class="terminal-body">
		<pre><code>{@html code}</code></pre>
		{#if comment}
			<div class="comment">{comment}</div>
		{/if}
	</div>
</div>

<style>
	.terminal {
		max-width: 650px;
		margin: 0 auto;
		background: #08080a;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}

	.terminal-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.015);
		border-bottom: 1px solid var(--border);
	}

	.dots { display: flex; gap: 6px; }
	.dots span { width: 10px; height: 10px; border-radius: 50%; }

	.title {
		font-family: var(--font-display);
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.terminal-body {
		padding: 1.5rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
		line-height: 1.8;
		overflow-x: auto;
	}

	pre { margin: 0; }
	code { white-space: pre; color: var(--text); }

	.comment {
		margin-top: 0.75rem;
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	:global(.t-prompt) { color: var(--accent); }
	:global(.t-flag) { color: #80b0c0; }
	:global(.t-val) { color: var(--accent-light); }
</style>
```

- [ ] **Step 4: Create StepCard.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	let { number, title, description, delay = 0 }: {
		number: number;
		title: string;
		description: string;
		delay?: number;
	} = $props();
</script>

<div class="step" use:reveal={{ delay }}>
	<div class="step-num">{number}</div>
	<h4>{title}</h4>
	<p>{description}</p>
</div>

<style>
	.step {
		text-align: center;
		padding: 1.5rem;
	}

	.step-num {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: rgba(200, 167, 106, 0.08);
		border: 1px solid rgba(200, 167, 106, 0.15);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.1rem;
		color: var(--accent);
		margin: 0 auto 1rem;
	}

	h4 {
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 0.5rem;
	}

	p {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.6;
		max-width: 280px;
		margin: 0 auto;
	}
</style>
```

- [ ] **Step 5: Create ServiceCard.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	let { name, category, description, delay = 0 }: {
		name: string;
		category: string;
		description: string;
		delay?: number;
	} = $props();
</script>

<div class="service-card" use:reveal={{ delay }}>
	<div class="service-header">
		<h4>{name}</h4>
		<span class="category">{category}</span>
	</div>
	<p>{description}</p>
</div>

<style>
	.service-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem;
		transition: all 0.3s ease;
	}

	.service-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-2px);
	}

	.service-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	h4 {
		font-family: var(--font-display);
		font-weight: 700;
		color: var(--text);
		font-size: 1rem;
	}

	.category {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.5rem;
		background: rgba(200, 167, 106, 0.08);
		border: 1px solid rgba(200, 167, 106, 0.12);
		border-radius: 100px;
		color: var(--accent);
	}

	p {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.6;
	}
</style>
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/SectionHeading.svelte src/lib/components/FeatureCard.svelte src/lib/components/TerminalCard.svelte src/lib/components/StepCard.svelte src/lib/components/ServiceCard.svelte
git commit -m "feat: add shared components — SectionHeading, FeatureCard, TerminalCard, StepCard, ServiceCard"
```

---

### Task 7: HeroRain component

**Files:**
- Create: `src/lib/components/HeroRain.svelte`

This is the poster rain animation — CSS-based columns of poster images drifting in alternating directions, rotated and vignetted.

- [ ] **Step 1: Create src/lib/components/HeroRain.svelte**

The component uses CSS animations on poster columns. Images come from `static/posters/`. For now, fall back to gradient placeholders if images aren't loaded yet — the poster sourcing happens in Task 10.

```svelte
<script lang="ts">
	import { onMount } from 'svelte';

	// Poster filenames — populated in Task 10 with real PD artwork
	// For now, generate gradient placeholders
	const COLUMN_COUNT = 10;
	const POSTERS_PER_COL = 4;

	const gradients = [
		['#4a2020', '#2a1010'], ['#203848', '#102028'], ['#484020', '#282010'],
		['#204038', '#102018'], ['#402040', '#201020'], ['#384820', '#182810'],
		['#2a3050', '#151828'], ['#503828', '#281810'], ['#383050', '#1c1828'],
		['#204830', '#102818'], ['#482828', '#281414'], ['#283848', '#141c28'],
		['#484028', '#282014'], ['#3a2848', '#1d1428'], ['#284838', '#142818'],
		['#483828', '#281c14'], ['#304828', '#182814'], ['#482838', '#28141c'],
		['#384028', '#1c2014'], ['#283048', '#141828'], ['#402830', '#201418'],
		['#304030', '#182018'], ['#483048', '#281828'], ['#203040', '#101820'],
		['#284028', '#142014'], ['#402840', '#201420'], ['#384038', '#1c201c'],
		['#482038', '#28101c'], ['#304830', '#182818'], ['#402030', '#201018'],
		['#283848', '#141c28'], ['#484028', '#282014'], ['#204030', '#102018'],
		['#4a2830', '#2a1418'], ['#303850', '#181c28'], ['#483028', '#281814'],
		['#204840', '#102820'], ['#402048', '#201028'], ['#304028', '#182014'],
		['#284040', '#142020']
	];

	let posterFiles: string[] = $state([]);
	let useImages = $derived(posterFiles.length >= 20);

	onMount(async () => {
		try {
			const res = await fetch('/posters/manifest.json');
			if (res.ok) {
				posterFiles = await res.json();
			}
		} catch {
			// No manifest yet — use gradient placeholders
		}
	});

	function getColumns() {
		const cols = [];
		let gi = 0;
		for (let c = 0; c < COLUMN_COUNT; c++) {
			const posters = [];
			// Double the posters for seamless loop
			for (let p = 0; p < POSTERS_PER_COL * 2; p++) {
				if (useImages) {
					const idx = (c * POSTERS_PER_COL + p) % posterFiles.length;
					posters.push({ type: 'image' as const, src: `/posters/${posterFiles[idx]}` });
				} else {
					const [c1, c2] = gradients[gi % gradients.length];
					posters.push({ type: 'gradient' as const, c1, c2 });
					gi++;
				}
			}
			cols.push({
				posters,
				direction: c % 2 === 0 ? 'up' : 'down',
				duration: 20 + (c % 3) * 5
			});
		}
		return cols;
	}

	let columns = $derived(getColumns());
</script>

<div class="hero-rain-container">
	<div class="poster-rain">
		{#each columns as col, ci}
			<div
				class="poster-col"
				class:drift-up={col.direction === 'up'}
				class:drift-down={col.direction === 'down'}
				style="animation-duration: {col.duration}s"
			>
				{#each col.posters as poster}
					{#if poster.type === 'image'}
						<div class="poster">
							<img src={poster.src} alt="" loading="lazy" />
						</div>
					{:else}
						<div class="poster" style="background: linear-gradient(135deg, {poster.c1}, {poster.c2})"></div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>
	<div class="vignette"></div>
</div>

<style>
	.hero-rain-container {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.poster-rain {
		display: flex;
		gap: 6px;
		justify-content: center;
		transform: rotate(-12deg) scale(1.4);
		transform-origin: center 40%;
		position: absolute;
		inset: -20%;
	}

	.poster-col {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100px;
		flex-shrink: 0;
	}

	.drift-up { animation: drift-up linear infinite; }
	.drift-down { animation: drift-down linear infinite; }

	@keyframes drift-up {
		0% { transform: translateY(0); }
		100% { transform: translateY(calc(-50%)); }
	}

	@keyframes drift-down {
		0% { transform: translateY(calc(-50%)); }
		100% { transform: translateY(0); }
	}

	.poster {
		width: 100px;
		height: 150px;
		border-radius: 4px;
		flex-shrink: 0;
		overflow: hidden;
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: brightness(0.5) saturate(0.6) sepia(0.15);
	}

	.vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 65% 60% at 50% 45%,
			rgba(5, 5, 7, 0.3) 0%,
			rgba(5, 5, 7, 0.75) 50%,
			#050507 80%
		);
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.drift-up, .drift-down { animation: none !important; }
	}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/HeroRain.svelte
git commit -m "feat: add HeroRain poster rain animation component"
```

---

### Task 8: Home page

**Files:**
- Create: `src/routes/+page.svelte`

- [ ] **Step 1: Create src/routes/+page.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';
	import HeroRain from '$lib/components/HeroRain.svelte';
	import SectionHeading from '$lib/components/SectionHeading.svelte';
	import FeatureCard from '$lib/components/FeatureCard.svelte';
	import StepCard from '$lib/components/StepCard.svelte';
	import TerminalCard from '$lib/components/TerminalCard.svelte';
</script>

<svelte:head>
	<title>Nexus — All Your Media. One Home.</title>
	<meta name="description" content="A unified self-hosted media frontend. Movies, shows, books, games, music — one cinematic dashboard you control." />
	<meta property="og:title" content="Nexus — All Your Media. One Home." />
	<meta property="og:description" content="A unified self-hosted media frontend for all your services." />
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Hero -->
<section class="hero">
	<HeroRain />
	<div class="hero-content">
		<div class="hero-badge" use:reveal={{ delay: 0 }}>
			<span class="badge-dot"></span>
			Open Source & Self-Hosted
		</div>
		<h1 use:reveal={{ delay: 100 }}>
			All your media.<br />
			<span class="gradient-text">One home.</span>
		</h1>
		<p class="hero-sub" use:reveal={{ delay: 200 }}>
			Movies, shows, books, games, music — unified under one cinematic dashboard you own. Self-hostable. Open source.
		</p>
		<div class="hero-actions" use:reveal={{ delay: 300 }}>
			<a href="/install" class="btn-primary">
				Get Started
			</a>
			<a href="https://github.com/PetalCat/Nexus" class="btn-secondary" target="_blank" rel="noopener">
				View on GitHub
			</a>
		</div>
	</div>
</section>

<!-- Media Types -->
<section class="section">
	<div class="container">
		<SectionHeading
			label="Media"
			title='Every kind of content. <span class="gradient-text">One place.</span>'
			description="Nexus brings together all your media services into a single, beautiful interface."
			center
		/>
		<div class="media-grid">
			{#each [
				{ icon: '🎬', title: 'Movies & Shows', desc: 'Browse, stream, and manage your video library with full Jellyfin integration.' },
				{ icon: '📚', title: 'Books', desc: 'Your entire book collection from Kavita — browse, read, and track progress.' },
				{ icon: '🎮', title: 'Games', desc: 'Game library management through RomM. Browse, organize, and launch.' },
				{ icon: '🎵', title: 'Music', desc: 'A persistent music player that follows you across the app. Queue, playlists, and more.' },
				{ icon: '📺', title: 'Video', desc: 'Privacy-respecting video via Invidious integration. Search, watch, subscribe.' },
				{ icon: '📡', title: 'Live TV', desc: 'IPTV and live streams. Channel guides, EPG, and recording support.' }
			] as media, i}
				<FeatureCard icon={media.icon} title={media.title} description={media.desc} delay={i * 60} />
			{/each}
		</div>
	</div>
</section>

<!-- How It Works -->
<section class="section">
	<div class="container">
		<SectionHeading
			label="How It Works"
			title='Three steps to <span class="gradient-text">unified media.</span>'
			center
		/>
		<div class="steps-grid">
			<StepCard number={1} title="Connect your services" description="Point Nexus at your Jellyfin, Sonarr, Radarr, and other self-hosted services." delay={0} />
			<StepCard number={2} title="Nexus unifies them" description="One dashboard, one search, one interface. All your media, all your services." delay={100} />
			<StepCard number={3} title="Enjoy" description="Browse, stream, request, and track across everything — from any device." delay={200} />
		</div>
	</div>
</section>

<!-- Feature Highlights -->
<section class="section">
	<div class="container">
		<SectionHeading
			label="Features"
			title='Everything you need. <span class="gradient-text">Nothing you don&apos;t.</span>'
			description="Built for people who run their own media stack."
		/>
		<div class="features-grid">
			{#each [
				{ icon: '🏠', title: 'Cinematic Dashboard', desc: 'Continue watching, recently added, trending, and personalized recommendations — all in one view.' },
				{ icon: '🔍', title: 'Unified Search', desc: 'Search across every connected service simultaneously. Movies, shows, books, games, music.' },
				{ icon: '📋', title: 'Media Requests', desc: 'Request new content through Overseerr/Seerr integration. Approve, deny, and track from Nexus.' },
				{ icon: '📊', title: 'Analytics & Wrapped', desc: 'Deep listening/watching stats, history timelines, and Spotify Wrapped-style yearly summaries.' },
				{ icon: '🎬', title: 'Streaming & Subtitles', desc: 'Direct stream from Jellyfin with full subtitle support — HLS, external tracks, and Bazarr enrichment.' },
				{ icon: '💡', title: 'Recommendations', desc: 'Personalized recommendations powered by StreamyStats. Discover what to watch next.' }
			] as feature, i}
				<FeatureCard icon={feature.icon} title={feature.title} description={feature.desc} delay={i * 60} />
			{/each}
		</div>
	</div>
</section>

<!-- Terminal -->
<section class="section" use:reveal>
	<div class="container">
		<TerminalCard
			code='<span class="t-prompt">$</span> docker run <span class="t-flag">-d</span> \
  <span class="t-flag">--name</span> <span class="t-val">nexus</span> \
  <span class="t-flag">-p</span> <span class="t-val">3000:3000</span> \
  <span class="t-flag">-v</span> <span class="t-val">nexus-data:/data</span> \
  ghcr.io/petalcat/nexus:latest'
			comment="# That's it. Your media hub is running."
		/>
		<div style="text-align: center; margin-top: 2rem;">
			<a href="/install" class="btn-secondary">
				Full Install Guide &rarr;
			</a>
		</div>
	</div>
</section>

<!-- Final CTA -->
<section class="section final-cta" use:reveal>
	<div class="container" style="text-align: center;">
		<h3 class="cta-title">Ready to unify<br /><span class="gradient-text">your media?</span></h3>
		<p class="cta-desc">One dashboard for everything you watch, read, play, and listen to.</p>
		<div class="hero-actions" style="justify-content: center; margin-top: 2rem;">
			<a href="/install" class="btn-primary">Get Started</a>
			<a href="https://github.com/PetalCat/Nexus" class="btn-secondary" target="_blank" rel="noopener">Star on GitHub</a>
		</div>
	</div>
</section>

<style>
	/* Hero */
	.hero {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.hero-content {
		position: relative;
		z-index: 10;
		text-align: center;
		padding: 0 1.5rem;
		max-width: 700px;
	}

	.hero-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.85rem 0.3rem 0.65rem;
		background: rgba(200, 167, 106, 0.06);
		border: 1px solid rgba(200, 167, 106, 0.12);
		border-radius: 100px;
		font-family: var(--font-display);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent);
		margin-bottom: 1.5rem;
		letter-spacing: 0.02em;
	}

	.badge-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.5); opacity: 0.5; }
	}

	.hero h1 {
		font-size: clamp(2.8rem, 8vw, 5rem);
		font-weight: 800;
		color: var(--text);
		margin-bottom: 1.25rem;
		line-height: 1.05;
		letter-spacing: -0.03em;
	}

	.hero-sub {
		font-size: clamp(1rem, 2.5vw, 1.15rem);
		color: var(--text-muted);
		line-height: 1.7;
		max-width: 520px;
		margin: 0 auto 2rem;
	}

	.hero-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	/* Sections */
	.section { padding: 6rem 0; }

	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	.media-grid, .features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.25rem;
	}

	.steps-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem;
	}

	/* Final CTA */
	.final-cta { padding-bottom: 2rem; }

	.cta-title {
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 800;
		color: var(--text);
		margin-bottom: 0.75rem;
		letter-spacing: -0.03em;
	}

	.cta-desc {
		color: var(--text-muted);
		font-size: 1.05rem;
		margin: 0 auto;
		max-width: 500px;
	}

	@media (max-width: 768px) {
		.section { padding: 4rem 0; }
	}
</style>
```

- [ ] **Step 2: Verify home page renders**

Check `localhost:5173` — full home page with hero (gradient placeholders for now), media types grid, how it works, features, terminal card, and final CTA. Nav and footer should frame it.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: add home page with hero, media types, features, terminal, CTAs"
```

---

### Task 9: Subpages — Features, Integrations, Install, About

**Files:**
- Create: `src/routes/features/+page.svelte`
- Create: `src/routes/integrations/+page.svelte`
- Create: `src/routes/install/+page.svelte`
- Create: `src/routes/about/+page.svelte`

- [ ] **Step 1: Create src/routes/features/+page.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';
	import SectionHeading from '$lib/components/SectionHeading.svelte';
</script>

<svelte:head>
	<title>Features — Nexus</title>
	<meta name="description" content="Dashboard, unified search, media requests, analytics, streaming, and more. Everything Nexus offers." />
</svelte:head>

<section class="page-hero">
	<div class="container">
		<h1 use:reveal>Built for <span class="gradient-text">your stack.</span></h1>
		<p class="page-hero-sub" use:reveal={{ delay: 100 }}>Every feature designed for people who run their own media services.</p>
	</div>
</section>

<section class="section">
	<div class="container">
		{#each [
			{ label: 'Home', title: 'Cinematic Dashboard', desc: 'Continue watching, recently added, trending, and personalized recommendations. A streaming-service-quality home screen for your own library. StreamyStats powers cross-media recommendations based on your actual watch history.', details: ['Continue watching with progress bars', 'Recently added across all services', 'Personalized recommendations via StreamyStats', 'Live Jellyfin session monitoring'] },
			{ label: 'Library', title: 'Movies & Shows', desc: 'Full Jellyfin integration with per-user credentials. Browse your library, stream directly, manage subtitles, and track watch progress — all through Nexus.', details: ['Direct streaming with HLS', 'Subtitle management (HLS + external + Bazarr)', 'Per-user authentication', 'Resume playback across devices'] },
			{ label: 'Reading', title: 'Books', desc: 'Your Kavita library in Nexus. Browse collections, track reading progress, and discover new titles alongside your other media.', details: ['Kavita library browsing', 'Reading progress sync', 'Collection management', 'Cross-media discovery'] },
			{ label: 'Gaming', title: 'Games', desc: 'RomM integration brings your game collection into the same interface as everything else. Browse, organize, and manage your library.', details: ['RomM game library', 'Platform and genre browsing', 'Cover art and metadata', 'Collection organization'] },
			{ label: 'Audio', title: 'Music Player', desc: 'A persistent music player that stays with you as you navigate. Queue management, playlists, and background playback that continues while you browse other media.', details: ['Persistent playback across pages', 'Queue and playlist management', 'Mini player overlay on other media pages', 'Background play while browsing'] },
			{ label: 'Video', title: 'Video & Live TV', desc: 'Privacy-respecting video through Invidious integration, plus IPTV support for live streams and channel guides.', details: ['Invidious video integration', 'IPTV and M3U support', 'EPG channel guides', 'Privacy-first streaming'] },
			{ label: 'Discovery', title: 'Unified Search', desc: 'One search bar that queries every connected service simultaneously. Find anything across your entire media collection instantly.', details: ['Cross-service search', 'Instant results', 'Filter by media type', 'Request missing content directly'] },
			{ label: 'Requests', title: 'Media Requests', desc: 'Overseerr/Seerr integration lets users request new content. Admins approve or deny from the Nexus dashboard. Multiselect, batch actions, and status tracking.', details: ['Overseerr/Seerr integration', 'Admin approve/deny workflow', 'Multiselect and batch actions', 'Request status tracking'] },
			{ label: 'Insights', title: 'Analytics & Wrapped', desc: 'Deep consumption analytics — what you watch, read, play, and listen to. Timeline views, top content, and Spotify Wrapped-style yearly summaries.', details: ['Watch/read/play/listen history', 'Timeline and top content views', 'Nexus Wrapped yearly summaries', 'Per-user and admin-level stats'] },
			{ label: 'Streaming', title: 'Streaming & Subtitles', desc: 'Direct HLS streaming from Jellyfin with full subtitle support. External tracks, Bazarr enrichment for missing subtitles, and subtitle history tracking.', details: ['HLS direct streaming', 'External subtitle tracks', 'Bazarr subtitle enrichment', 'Subtitle history and status'] }
		] as feature, i}
			<div class="feature-deep" class:reverse={i % 2 === 1} use:reveal>
				<div class="feature-deep-content">
					<span class="feature-label">{feature.label}</span>
					<h3>{feature.title}</h3>
					<p>{feature.desc}</p>
					<ul class="feature-details">
						{#each feature.details as detail}
							<li><span class="check">&#10003;</span> {detail}</li>
						{/each}
					</ul>
				</div>
				<div class="feature-deep-visual">
					<div class="visual-card">
						<div class="visual-rings">
							<div class="v-ring r1"></div>
							<div class="v-ring r2"></div>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.page-hero { padding: 10rem 0 4rem; text-align: center; }
	.page-hero h1 { font-size: clamp(2.5rem, 7vw, 4.5rem); font-weight: 800; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.03em; }
	.page-hero-sub { font-size: 1.1rem; color: var(--text-muted); max-width: 500px; margin: 0 auto; line-height: 1.7; }
	.section { padding: 3rem 0; }
	.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

	.feature-deep { display: flex; align-items: center; gap: 4rem; padding: 4rem 0; border-bottom: 1px solid var(--border); }
	.feature-deep:last-child { border-bottom: none; }
	.feature-deep.reverse { flex-direction: row-reverse; }
	.feature-deep-content { flex: 1; }

	.feature-label { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); display: block; margin-bottom: 0.75rem; }
	.feature-deep-content h3 { font-size: 2rem; font-weight: 800; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.02em; }
	.feature-deep-content p { color: var(--text-muted); line-height: 1.7; margin-bottom: 1.5rem; }

	.feature-details { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
	.feature-details li { display: flex; align-items: center; gap: 0.6rem; color: var(--text); font-size: 0.95rem; }
	.check { color: var(--accent); font-weight: 700; font-size: 0.85rem; }

	.feature-deep-visual { flex: 0 0 260px; }
	.visual-card { position: relative; width: 260px; height: 260px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 24px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.visual-rings { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
	.v-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(200, 167, 106, 0.1); }
	.v-ring.r1 { width: 160px; height: 160px; }
	.v-ring.r2 { width: 220px; height: 220px; }

	@media (max-width: 768px) {
		.feature-deep, .feature-deep.reverse { flex-direction: column; gap: 2rem; }
		.feature-deep-visual { flex: none; width: 100%; display: flex; justify-content: center; }
		.visual-card { width: 180px; height: 180px; }
	}
</style>
```

- [ ] **Step 2: Create src/routes/integrations/+page.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';
	import SectionHeading from '$lib/components/SectionHeading.svelte';
	import ServiceCard from '$lib/components/ServiceCard.svelte';
</script>

<svelte:head>
	<title>Integrations — Nexus</title>
	<meta name="description" content="Nexus integrates with Jellyfin, Sonarr, Radarr, Lidarr, Overseerr, Kavita, RomM, Bazarr, Prowlarr, StreamyStats, and more." />
</svelte:head>

<section class="page-hero">
	<div class="container">
		<h1 use:reveal>Your services. <span class="gradient-text">Connected.</span></h1>
		<p class="page-hero-sub" use:reveal={{ delay: 100 }}>Nexus integrates with the tools you already run.</p>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="service-grid">
			{#each [
				{ name: 'Jellyfin', category: 'Media Server', desc: 'Core media server integration. Library browsing, direct streaming, user authentication, and session monitoring.' },
				{ name: 'Sonarr', category: 'Automation', desc: 'TV show management and automation. Monitor series, manage quality profiles, and track downloads.' },
				{ name: 'Radarr', category: 'Automation', desc: 'Movie management and automation. Search, add, and monitor your movie collection.' },
				{ name: 'Lidarr', category: 'Automation', desc: 'Music management and automation. Track artists, albums, and manage your music library.' },
				{ name: 'Overseerr / Seerr', category: 'Requests', desc: 'Media request management. Users request content, admins approve or deny, with full status tracking.' },
				{ name: 'Kavita', category: 'Books', desc: 'Book and manga library. Browse collections, track reading progress, and manage your library.' },
				{ name: 'RomM', category: 'Games', desc: 'ROM and game collection management. Browse by platform, genre, and organize your game library.' },
				{ name: 'Bazarr', category: 'Subtitles', desc: 'Subtitle management and enrichment. Track missing subtitles, download automatically, and view history.' },
				{ name: 'Prowlarr', category: 'Search', desc: 'Indexer management and unified search across multiple sources.' },
				{ name: 'StreamyStats', category: 'Analytics', desc: 'Viewing analytics and personalized recommendations based on watch history.' },
				{ name: 'Invidious', category: 'Video', desc: 'Privacy-respecting video frontend. Search, watch, and subscribe without tracking.' }
			] as service, i}
				<ServiceCard name={service.name} category={service.category} description={service.desc} delay={i * 50} />
			{/each}
		</div>

		<div class="disclaimer" use:reveal>
			<p>Nexus is an independent open-source project. It is not affiliated with, endorsed by, or officially connected to any of the third-party services listed above. All product names, logos, and brands are property of their respective owners and are used here solely for compatibility identification purposes.</p>
		</div>
	</div>
</section>

<style>
	.page-hero { padding: 10rem 0 4rem; text-align: center; }
	.page-hero h1 { font-size: clamp(2.5rem, 7vw, 4.5rem); font-weight: 800; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.03em; }
	.page-hero-sub { font-size: 1.1rem; color: var(--text-muted); max-width: 500px; margin: 0 auto; line-height: 1.7; }
	.section { padding: 3rem 0; }
	.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

	.service-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.25rem;
	}

	.disclaimer {
		margin-top: 4rem;
		padding: 2rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		text-align: center;
	}

	.disclaimer p {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.7;
		max-width: 700px;
		margin: 0 auto;
	}
</style>
```

- [ ] **Step 3: Create src/routes/install/+page.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';
	import TerminalCard from '$lib/components/TerminalCard.svelte';
</script>

<svelte:head>
	<title>Install — Nexus</title>
	<meta name="description" content="Get Nexus running in minutes with Docker or build from source." />
</svelte:head>

<section class="page-hero">
	<div class="container">
		<h1 use:reveal>Get <span class="gradient-text">started.</span></h1>
		<p class="page-hero-sub" use:reveal={{ delay: 100 }}>Up and running in minutes. Docker or source — your choice.</p>
	</div>
</section>

<section class="section">
	<div class="container">
		<!-- Quick Start -->
		<div class="install-section" use:reveal>
			<h2>Quick Start — Docker</h2>
			<p class="install-desc">The fastest way to run Nexus. One command.</p>
			<TerminalCard
				code='<span class="t-prompt">$</span> docker run <span class="t-flag">-d</span> \
  <span class="t-flag">--name</span> <span class="t-val">nexus</span> \
  <span class="t-flag">-p</span> <span class="t-val">3000:3000</span> \
  <span class="t-flag">-v</span> <span class="t-val">nexus-data:/data</span> \
  ghcr.io/petalcat/nexus:latest'
			/>
		</div>

		<!-- Docker Compose -->
		<div class="install-section" use:reveal>
			<h2>Docker Compose</h2>
			<p class="install-desc">For more control, use a compose file.</p>
			<TerminalCard
				code='<span class="t-prompt">#</span> docker-compose.yml
services:
  nexus:
    image: ghcr.io/petalcat/nexus:latest
    container_name: nexus
    ports:
      - <span class="t-val">3000:3000</span>
    volumes:
      - <span class="t-val">nexus-data:/data</span>
    restart: unless-stopped

volumes:
  nexus-data:'
			/>
		</div>

		<!-- From Source -->
		<div class="install-section" use:reveal>
			<h2>From Source</h2>
			<p class="install-desc">Build and run Nexus from the source code.</p>
			<TerminalCard
				code='<span class="t-prompt">$</span> git clone https://github.com/PetalCat/Nexus.git
<span class="t-prompt">$</span> cd Nexus
<span class="t-prompt">$</span> pnpm install
<span class="t-prompt">$</span> pnpm build
<span class="t-prompt">$</span> node build'
			/>
		</div>

		<!-- Requirements -->
		<div class="requirements" use:reveal>
			<h2>Requirements</h2>
			<div class="req-grid">
				<div class="req-item">
					<h4>Docker</h4>
					<p>Docker 20+ or Podman. That's all you need for the containerized install.</p>
				</div>
				<div class="req-item">
					<h4>From Source</h4>
					<p>Node.js 22+, pnpm. SQLite is bundled — no external database required.</p>
				</div>
				<div class="req-item">
					<h4>First Run</h4>
					<p>Open your browser to port 3000. The setup wizard walks you through adding your first service.</p>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.page-hero { padding: 10rem 0 4rem; text-align: center; }
	.page-hero h1 { font-size: clamp(2.5rem, 7vw, 4.5rem); font-weight: 800; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.03em; }
	.page-hero-sub { font-size: 1.1rem; color: var(--text-muted); max-width: 500px; margin: 0 auto; line-height: 1.7; }
	.section { padding: 3rem 0; }
	.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

	.install-section { margin-bottom: 4rem; }
	.install-section h2 { font-size: 1.5rem; font-weight: 800; color: var(--text); margin-bottom: 0.5rem; letter-spacing: -0.02em; }
	.install-desc { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem; }

	.requirements { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 20px; padding: 2.5rem; }
	.requirements h2 { font-size: 1.3rem; font-weight: 700; color: var(--text); margin-bottom: 1.5rem; }

	.req-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
	.req-item h4 { font-family: var(--font-display); font-weight: 600; color: var(--accent); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
	.req-item p { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }
</style>
```

- [ ] **Step 4: Create src/routes/about/+page.svelte**

```svelte
<script lang="ts">
	import { reveal } from '$lib/actions/reveal';
</script>

<svelte:head>
	<title>About — Nexus</title>
	<meta name="description" content="Nexus is an open-source, self-hosted unified media frontend by PetalCat." />
</svelte:head>

<section class="page-hero">
	<div class="container">
		<h1 use:reveal>About <span class="gradient-text">Nexus.</span></h1>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="about-content" use:reveal>
			<p>Nexus is an open-source, self-hosted media frontend that unifies your existing media services into one cinematic interface. Instead of switching between Jellyfin, Kavita, RomM, Overseerr, and a dozen other tools — you get one dashboard, one search, one experience.</p>
			<p>It doesn't replace your media stack. It sits on top of it, connecting everything through a single interface that works across desktop, tablet, and mobile.</p>

			<h2>Open Source</h2>
			<p>Nexus is free and open source under the MIT license. The source code is available on GitHub. Contributions, bug reports, and feature requests are welcome.</p>

			<h2>Community</h2>
			<div class="link-grid">
				<a href="https://github.com/PetalCat/Nexus" target="_blank" rel="noopener" class="link-card">
					<h4>GitHub</h4>
					<p>Source code, releases, and contribution guide.</p>
				</a>
				<a href="https://github.com/PetalCat/Nexus/issues" target="_blank" rel="noopener" class="link-card">
					<h4>Issues</h4>
					<p>Report bugs and request features.</p>
				</a>
				<a href="https://github.com/PetalCat/Nexus/discussions" target="_blank" rel="noopener" class="link-card">
					<h4>Discussions</h4>
					<p>Ask questions and share ideas.</p>
				</a>
			</div>

			<h2>Built by PetalCat</h2>
			<p>Nexus is built and maintained by PetalCat.</p>

			<div class="responsibility">
				<p>Users are responsible for ensuring their use of Nexus and any connected third-party services complies with applicable laws, regulations, and terms of service. Nexus is a frontend tool — it does not host, store, or distribute media content.</p>
			</div>
		</div>
	</div>
</section>

<style>
	.page-hero { padding: 10rem 0 4rem; text-align: center; }
	.page-hero h1 { font-size: clamp(2.5rem, 7vw, 4.5rem); font-weight: 800; color: var(--text); margin-bottom: 1rem; letter-spacing: -0.03em; }
	.section { padding: 3rem 0; }
	.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

	.about-content { max-width: 700px; margin: 0 auto; }
	.about-content p { color: var(--text-muted); font-size: 1rem; line-height: 1.8; margin-bottom: 1.5rem; }
	.about-content h2 { font-size: 1.5rem; font-weight: 800; color: var(--text); margin-top: 3rem; margin-bottom: 1rem; letter-spacing: -0.02em; }

	.link-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }

	.link-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.25rem;
		text-decoration: none;
		transition: all 0.3s ease;
	}

	.link-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
	.link-card h4 { font-family: var(--font-display); font-weight: 700; color: var(--text); font-size: 1rem; margin-bottom: 0.25rem; }
	.link-card p { color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 0; }

	.responsibility {
		margin-top: 3rem;
		padding: 1.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 16px;
	}

	.responsibility p { font-size: 0.85rem; color: var(--text-muted); line-height: 1.7; margin-bottom: 0; }
</style>
```

- [ ] **Step 5: Verify all pages render and nav links work**

Visit `/features`, `/integrations`, `/install`, `/about` — each should render with content, nav highlights correct link.

- [ ] **Step 6: Commit**

```bash
git add src/routes/features src/routes/integrations src/routes/install src/routes/about
git commit -m "feat: add features, integrations, install, and about pages"
```

---

### Task 10: Source and add public domain poster images

**Files:**
- Create: `static/posters/manifest.json`
- Create: `static/posters/*.webp` (30-40 images)

This task involves research and image sourcing. The implementer should:

- [ ] **Step 1: Research and download public domain poster art**

Search these sources for high-quality public domain artwork published 1930 or earlier:

- **Wikimedia Commons**: Search for film posters, book covers, and paintings. Filter by license (public domain). Good for: Metropolis poster, Nosferatu poster, Caligari poster, Great Wave, Starry Night, The Kiss, etc.
- **Library of Congress Digital Collections** (loc.gov): Vintage posters, sheet music covers, and advertisements.
- **Internet Archive** (archive.org): Scanned book covers, vintage advertisements.
- **The Metropolitan Museum of Art Open Access**: Paintings and artwork marked CC0.
- **Smithsonian Open Access**: Art and artifacts marked CC0.
- **rawpixel.com/public-domain**: Curated public domain art collections.

Target list (aim for 30-40 from these categories):
- Film posters: Metropolis, Nosferatu, Caligari, Trip to the Moon, Phantom of the Opera, Gold Rush, All Quiet on the Western Front, The Blue Angel
- Book covers/title pages: Frankenstein, Dracula, Great Gatsby, Alice in Wonderland, War of the Worlds, Wizard of Oz, Treasure Island, 20000 Leagues
- Paintings: Great Wave (Hokusai), Starry Night (Van Gogh), The Kiss (Klimt), Water Lilies (Monet), Girl with a Pearl Earring (Vermeer), The Scream (Munch)
- Music/Art Nouveau: Mucha posters, vintage sheet music, jazz age posters
- Art Deco/Travel: Vintage travel posters, Art Deco advertisements

- [ ] **Step 2: Process images**

For each image:
1. Crop to 2:3 aspect ratio (portrait orientation)
2. Resize to 400x600px (enough detail for the rain effect, small file size)
3. Convert to WebP format for optimal compression
4. Optionally color-grade: slight desaturation, warm shift, darken slightly

Use ImageMagick or similar:
```bash
# Example for one image
convert input.jpg -resize 400x600^ -gravity center -extent 400x600 \
  -modulate 90,80,100 -fill '#050507' -colorize 10% \
  output.webp
```

- [ ] **Step 3: Create static/posters/manifest.json**

A JSON array of all poster filenames:

```json
[
  "metropolis-1927.webp",
  "nosferatu-1922.webp",
  "caligari-1920.webp",
  "great-wave-hokusai.webp",
  "starry-night-vangogh.webp",
  "the-kiss-klimt.webp"
]
```

(Full list of 30-40 filenames matching the actual downloaded images.)

- [ ] **Step 4: Verify poster rain displays real images**

Restart dev server, check homepage — the HeroRain component should fetch `manifest.json` and display the real PD artwork in the drifting columns.

- [ ] **Step 5: Commit**

```bash
git add static/posters
git commit -m "feat: add public domain poster artwork for hero rain"
```

---

### Task 11: Build verification and polish

**Files:**
- Possibly modify any file for build fixes

- [ ] **Step 1: Run a production build**

```bash
pnpm build
```

Expected: Static site builds to `build/` directory with all pages pre-rendered. No errors.

- [ ] **Step 2: Preview the production build**

```bash
pnpm preview
```

Visit all pages, check:
- Nav works on all pages, highlights correct link
- All scroll reveal animations fire
- Poster rain animates (or shows gracefully with reduced motion)
- Mobile hamburger menu works
- Footer renders on all pages
- No console errors

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build verification and polish"
```

- [ ] **Step 5: Push to GitHub**

```bash
# Create the repo on GitHub first if not done
gh repo create PetalCat/nexus-website --public --source=. --push
```
