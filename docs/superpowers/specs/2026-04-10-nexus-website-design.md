# Nexus Public Website — Design Spec

## Overview

A public-facing marketing/product website for the Nexus project. Separate repo, static site. Communicates what Nexus is, what it does, and how to install it.

Nexus is a unified self-hosted media frontend — movies, shows, books, games, music — aggregated from user-configured services into one cinematic dashboard.

## Tech Stack

- **SvelteKit** with `@sveltejs/adapter-static` for full static output
- **Tailwind CSS v4** for utility CSS alongside scoped component styles
- **DM Sans** (display/body) via Google Fonts
- No backend, no database — pure static HTML/CSS/JS
- Hosted via GitHub Pages, Cloudflare Pages, or similar static host
- Domain TBD — design around relative paths for now

## Visual Identity

### Differentiation Constraints

The design must be clearly distinct from two other PetalCat projects:

- **Lantern** (fince): warm amber (`#c48608`), Fraunces serif, centered minimal, grain overlay, radial glow — a coming-soon page for Minecraft hosting
- **Point** (GlobalMap): cool blue neon (`#3F51FF`), Outfit sans-serif, animated canvas dots, tech-forward — a location sharing app

### Palette

Warm gold from the Nexus app, but used differently from Lantern:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#050507` | Page background |
| `--bg-surface` | `#0e0d12` | Card/elevated surfaces |
| `--text` | `#f0ebe3` | Primary text |
| `--text-muted` | `#807870` | Secondary text |
| `--accent` | `#c9a76a` | Primary accent (champagne gold) |
| `--accent-light` | `#e0cca8` | Light accent for gradients |
| `--accent-dark` | `#a88648` | Dark accent for gradients |
| `--border` | `rgba(200, 170, 130, 0.08)` | Subtle borders |

The key differentiator from Lantern is not the palette but the layout and content density — Lantern is a minimal centered page; Nexus is content-rich with media imagery, feature sections, and a product showcase.

### Typography

- **Display/headings**: DM Sans, 800 weight, tight letter-spacing (-0.03em)
- **Body**: DM Sans, 400/500 weight
- **Monospace** (terminal card): JetBrains Mono or system monospace
- No serif fonts — this distinguishes from both Lantern (Fraunces) and the Nexus app (Playfair Display)

### Effects

- **Gradient text**: `linear-gradient(135deg, #e0cca8, #c9a76a)` on accent words
- **Film grain**: subtle SVG noise overlay at low opacity (0.015)
- **Glow**: gold box-shadow on primary buttons (`0 0 24px rgba(200,167,106,0.2)`)
- **Scroll reveal**: IntersectionObserver-based fade-up (translateY 30px -> 0, opacity 0 -> 1) with staggered delays
- **Reduced motion**: all animations disabled via `prefers-reduced-motion: reduce`

## Hero — Poster Rain

The hero section is full-viewport height. Behind the centered text content, columns of public domain media artwork drift slowly in alternating vertical directions, angled slightly (-12deg) and vignetted into darkness.

### Poster Sources (Public Domain)

All artwork pre-1929 or explicitly CC0:

- **Film**: Metropolis (1927), Nosferatu (1922), The Cabinet of Dr. Caligari (1920), A Trip to the Moon (1902), The General (1926)
- **Books**: Classic novel covers — Frankenstein, Dracula, The Great Gatsby (1925 first edition), Alice in Wonderland
- **Music**: Classical concert/opera posters, vintage sheet music covers
- **Art**: Paintings used as poster stand-ins — Hokusai's Great Wave, Klimt's The Kiss (public domain in US), Van Gogh's Starry Night
- **Games**: Vintage chess/card game illustrations, early board game art

The poster images should be cropped to 2:3 aspect ratio, color-graded to fit the warm dark palette (desaturated, darkened, warm-shifted). Around 30-40 unique images for visual variety across the grid.

### Hero Content (centered, z-index above posters)

1. Badge pill: "Open Source & Self-Hosted" with status dot
2. Headline: "All your media." / "One home." (gradient text on "One home.")
3. Subtext: "Movies, shows, books, games, music — unified under one dashboard you own."
4. Two CTAs: "Get Started" (gold primary) + "View on GitHub" (ghost outline)

### Vignette

Radial gradient from center outward: transparent center -> 75% opacity at edges -> solid background at borders. This makes the poster grid feel like it fades into infinity while keeping text readable.

## Navigation

Fixed top nav, transparent on initial load, gains blur background + border on scroll (20px threshold).

### Desktop

- Left: Nexus logo (icon + "Nexus" wordmark)
- Center/right: Home, Features, Integrations, Install, About
- Far right: "Get Started" CTA button (gold)

### Mobile (< 768px)

- Hamburger icon toggles fullscreen overlay
- Centered nav links, larger touch targets
- CTA button at bottom of overlay

## Pages

### Home (`/`)

1. **Hero** — Poster Rain (described above)
2. **Media Types** — grid of cards showing what Nexus handles: Movies & Shows, Books, Games, Music, Video, Live TV. Each card has an icon, title, short description. Accent glow on hover.
3. **How It Works** — 3-step visual: "Connect your services" -> "Nexus unifies them" -> "One interface for everything." Horizontal on desktop, vertical on mobile.
4. **Feature Highlights** — 2x3 or 2x4 grid of feature cards (dashboard, unified search, requests, analytics, streaming, recommendations). Icon + title + 1-2 sentence description. Similar to Point's feature grid.
5. **Terminal Card** — Docker install command in a styled terminal mockup:
   ```
   $ docker run -d \
     --name nexus \
     -p 3000:3000 \
     -v nexus-data:/data \
     ghcr.io/petalcat/nexus:latest
   ```
6. **Final CTA** — "Ready to unify your media?" + Get Started / Star on GitHub buttons.

### Features (`/features`)

Deep dive on each major feature area. Alternating left/right layout (text + visual placeholder card) for each feature:

- Dashboard & Home
- Movies & Shows
- Books (Kavita integration)
- Games (RomM integration)
- Music Player
- Video (Invidious integration)
- Unified Search
- Media Requests (Overseerr/Seerr)
- Analytics & Wrapped
- Streaming & Subtitles

Each section: label (colored, uppercase) + title + description paragraph + bullet list of specifics.

### Integrations (`/integrations`)

Grid of supported service cards. Each card: service icon/logo (if available under fair use for compatibility display), name, category tag, short description.

Categories:
- Media Servers: Jellyfin
- Automation: Sonarr, Radarr, Lidarr
- Requests: Overseerr/Seerr
- Books: Kavita
- Games: RomM
- Subtitles: Bazarr
- Search: Prowlarr
- Analytics: StreamyStats
- Video: Invidious

**Non-affiliation disclaimer** at bottom of page:
> "Nexus is an independent open-source project. It is not affiliated with, endorsed by, or officially connected to any of the third-party services listed above. All product names, logos, and brands are property of their respective owners and are used here solely for compatibility identification purposes."

### Install (`/install`)

1. **Quick Start** — Docker command in terminal card (same as homepage)
2. **Docker Compose** — example `docker-compose.yml` in a code block
3. **From Source** — git clone + pnpm install + pnpm build steps
4. **Requirements** — Node.js version, system requirements
5. **First Run** — what to expect on first launch (setup wizard, add services)

### About (`/about`)

- What Nexus is (1-2 paragraphs)
- Open source statement + license
- Community links: GitHub, Issues, Discussions
- Built by PetalCat
- User-responsibility statement: users are responsible for ensuring their use of Nexus and connected services complies with applicable laws and terms of service

## Layout Components

### Section Pattern

Every content section follows the same structure:
- Small uppercase label (accent colored, 0.7-0.8rem, letter-spacing 0.1em)
- Large title (2-3rem, 800 weight) with gradient text on the key phrase
- Description paragraph (muted color, 1-1.1rem)
- Content below (cards, lists, visuals)

### Card Component

- Background: `--bg-surface`
- Border: 1px solid `--border`
- Border radius: 16px
- Padding: 1.5-2rem
- Hover: border brightens toward accent, translateY(-3px), optional accent glow

### Footer

4-column grid (brand + 3 link columns):

- **Brand column**: Nexus icon + name, tagline ("Unified self-hosted media frontend")
- **Product**: Features, Integrations, Install
- **Community**: GitHub, Issues, Discussions
- **Legal**: About, Privacy (if needed later)
- Bottom bar: copyright + "Open source" link

## Accessibility

- Skip-to-content link
- All interactive elements keyboard navigable
- Focus-visible outlines (2px solid accent)
- ARIA labels on icon-only buttons
- Minimum 44px touch targets on mobile
- `prefers-reduced-motion` disables all animations
- Semantic HTML throughout (nav, main, section, footer)
- Color contrast: text on background meets WCAG AA

## Responsive Breakpoints

- Desktop: > 768px (default)
- Mobile: <= 768px (single column, stacked layouts, hamburger nav)
- Small mobile: <= 480px (tighter padding, smaller type scale)

## Repo Structure

```
nexus-website/
  src/
    app.css              # Global styles, CSS custom properties
    app.html             # HTML shell
    lib/
      actions/
        reveal.ts        # Scroll reveal IntersectionObserver action
      components/
        Nav.svelte
        Footer.svelte
        HeroRain.svelte  # Poster rain canvas/DOM animation
        FeatureCard.svelte
        ServiceCard.svelte
        TerminalCard.svelte
        SectionHeading.svelte
    routes/
      +layout.svelte
      +layout.ts          # prerender = true
      +page.svelte        # Home
      features/+page.svelte
      integrations/+page.svelte
      install/+page.svelte
      about/+page.svelte
  static/
    favicon.svg
    posters/             # Public domain artwork (2:3, color-graded)
    services/            # Service icons for integrations page
  svelte.config.js       # adapter-static
  package.json
  vite.config.ts
```

## Out of Scope

- Authentication or any app functionality
- Documentation portal (can be added later)
- Blog
- Analytics/tracking
- CMS or dynamic content
- Domain setup (TBD)
