# Website Scope Research

## Goal

Define what the public-facing Nexus website should actually be.

## Recommended Scope

The public website should be a product/landing/docs hub, not the app itself.

It should answer:

- What is Nexus?
- Why would someone use it?
- What does it support?
- How do I install it?
- Where do I go for docs, roadmap, and GitHub?

## What the Website Should Not Be

- not the authenticated app UI
- not a dumping ground for every internal roadmap detail
- not a giant compatibility matrix on the homepage
- not copy built around direct comparisons to major consumer brands

## What the Repo Already Supports as Messaging Inputs

From `README.md`, Nexus already has clear product pillars:

- dashboard
- movies and shows
- books
- games
- video
- music
- social
- analytics
- requests
- unified search

That is enough to support a real product site rather than a placeholder page.

## Recommended Site Structure

1. Home / landing page
2. Features page
3. Supported integrations / compatibility page
4. Install / quick start page
5. Docs portal or docs links
6. Screenshots / demo section
7. Roadmap / project status links
8. GitHub / community / contact links

## Suggested Page Responsibilities

### Home

- one-sentence product definition
- key product differentiators
- short feature blocks
- install CTA
- GitHub/docs CTA

### Features

- dashboard
- media browsing
- books/games/video/music
- requests
- analytics
- unified search

### Compatibility

- supported integrations/adapters
- setup expectations
- non-affiliation note

### Install

- Docker-first path
- source install path
- minimum setup expectations

### Docs

- links into repo docs or dedicated docs content

### Screenshots / Demo

- real UI captures or carefully scoped mockups

## Messaging Guidance

- Use neutral product language in marketing sections
- Keep explicit third-party names mostly in compatibility/setup sections
- Include a short non-affiliation statement
- Include a short user-responsibility statement in docs/install/legal areas

## Technical Direction

This repo already uses SvelteKit + adapter-node.

Open question for Claude:

- Should the public site live:
  - in this repo as a route group / separate section, or
  - in a separate site/repo?

Research note:

- Svelte’s official package index shows both `@sveltejs/adapter-node` and `@sveltejs/adapter-static`, so either a server-rendered or static-style marketing site path is viable in the ecosystem.
- Reference:
  - https://svelte.dev/packages

## Delivery Options

### Option A: separate route group inside this repo

Pros:

- easiest shared design system / asset reuse
- same deployment footprint
- easier cross-linking with docs and app

Cons:

- marketing-site concerns mixed into app repo/runtime
- content changes may ride along with app release workflows

### Option B: separate site/repo

Pros:

- cleaner separation of concerns
- easier to optimize for static delivery/SEO
- lower risk of public-site work interfering with app work

Cons:

- duplicated styling/content concerns
- more deployment/config overhead

## Recommended First Decisions

1. Decide whether the public site is inside this repo or separate.
2. Decide whether docs live with the site or remain repo-native.
3. Decide whether the first version is:
   - a minimal landing page + install guide, or
   - a fuller product site with screenshots and roadmap.

## Best Near-Term Use

Use issue `#50` as the umbrella for:

- website scope
- copy direction
- domain decision
- docs/install funnel

## Immediate Research Questions for Claude

- Should screenshots come from the real app or a curated demo environment?
- Should compatibility live in its own page rather than the homepage?
- What minimum disclaimer language belongs on the public site?
- Is the first version intentionally minimal or expected to be launch-grade?
