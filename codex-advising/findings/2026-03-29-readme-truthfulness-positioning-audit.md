# Advisory Findings

## Topic

README truthfulness and positioning audit

## Summary

The current README is mostly truthful, but it is weaker than the actual product in three ways:

1. it undersells breadth and distinctiveness
2. it leaves the architecture model unclear
3. it omits several shipped surfaces that help prove the project is real

This is more an under-positioning problem than an overclaiming problem.

## What Looks Truthful

The current README feature list is broadly supported by the repo:

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

The repo also clearly supports:

- Docker deployment
- source install path
- multiple route groups for media domains

So the README is not obviously making false claims in its core feature bullets.

## Where the README Is Too Weak

### 1. Opener is too generic

Current opener:

- "A unified self-hosted media platform."

This is accurate, but bland.

The repo suggests something stronger:

- multiple content domains
- social layer
- analytics
- requests/discovery
- cross-service aggregation

Advisory conclusion:

- the opener should better communicate that Nexus is a unifying layer across many user-configured media services, not just a generic platform.

### 2. No "How it works" explanation

A new reader still has to infer whether Nexus is:

- a replacement media server
- a dashboard only
- a frontend/proxy
- a metadata aggregator

The codebase strongly suggests:

- Nexus connects to existing services
- aggregates data and functionality across them
- provides unified routes, discovery, playback, social, and analytics layers

Advisory conclusion:

- the README should explicitly say Nexus connects to existing services rather than replacing all of them.

### 3. No visual proof

The README still contains:

- `<!-- TODO: add screenshot -->`

Given the scope of the app, this weakens credibility unnecessarily.

Advisory conclusion:

- a preview/demo section would materially improve trust and comprehension.

### 4. Feature hierarchy is too flat

The current list is accurate, but all bullets read as if they carry equal weight.

That hides the stronger story:

- one interface across multiple media domains and services
- multiple interaction modes: reading, streaming, emulation, requests, social, analytics

Advisory conclusion:

- a "Highlights" or "Why Nexus" section would likely communicate the product better than a flat feature list alone.

### 5. Audience is implied, not stated

The README does not clearly say who it is for.

The repo suggests the audience is roughly:

- self-hosters with multiple media-related services
- users who want one interface instead of many
- users who value discovery/social/analytics across personal media

Advisory conclusion:

- a short "Who is this for?" section would help.

### 6. Maturity signal is weak

The README does not clearly say:

- how mature the project is
- whether it is stable
- whether it is still evolving quickly

Given the breadth of routes and recent commits, the project looks real and substantial, but still actively evolving.

Advisory conclusion:

- add a short status section to calibrate expectations.

## Where the README Is Missing Shipped Breadth

Recent git history suggests the README does not reflect all notable shipped surfaces, including:

- `/calendar`
- `/discover`
- `/collections`
- `/person`
- `/live`
- admin quality dashboard work
- DeArrow video-branding integration

Not every one of these must be in the README, but the current README feels older and smaller than the actual app surface.

## Where the README Should Stay Careful

### 1. Brand-heavy public framing

The README currently includes direct service names.

Some are operationally appropriate, especially in:

- supported services
- compatibility/setup sections

But the project is already trying to reduce consumer-brand-led public framing.

Advisory conclusion:

- keep service names where they clarify compatibility
- avoid turning the whole README into brand-comparison marketing

### 2. Overstating recommendation/social claims

The README says:

- personalized recommendations
- social
- yearly wrapped

These appear to be grounded in the repo, but they are “trust-sensitive” claims.

Advisory conclusion:

- if they remain in the README, it would help to support them with:
  - visuals
  - a short explanation
  - or a clearer “what this currently means” section

## Docker Criticism Is Not Valid Here

Any critique saying the README lacks Docker support is outdated for this repo.

The project already has:

- `Dockerfile`
- `docker-compose.yml`
- Docker-first quick start instructions in the README

## Recommended Distillation

If Claude revises the README, the highest-value improvements are:

1. strengthen the opener
2. add a short "How it works" section
3. add visuals or a preview section
4. add "Who is this for?"
5. add a short status/maturity section
6. clarify the product’s stronger highlights without leaning too hard on direct outside-brand positioning

## Advisory Note

The README is not badly inaccurate.

Its biggest problem is that it makes the project feel smaller, flatter, and more generic than the repo actually is.
