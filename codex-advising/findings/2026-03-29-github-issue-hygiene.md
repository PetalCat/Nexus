# Codex Advisory Finding

## Topic

GitHub issue hygiene check

## Source

Live issue bodies reviewed on 2026-03-29:

- `#27` https://github.com/PetalCat/Nexus/issues/27
- `#47` https://github.com/PetalCat/Nexus/issues/47
- `#50` https://github.com/PetalCat/Nexus/issues/50
- `#51` https://github.com/PetalCat/Nexus/issues/51
- `#52` https://github.com/PetalCat/Nexus/issues/52
- comment thread on `#25` for the mobile split

## Current Issue Quality

### `#27` Seerr

Still too thin for the amount of work it represents. The title is fine, but the body is only one sentence and does not describe the migration strategy or compatibility surface.

### `#47` Subtitle intelligence

Better than before, but still broad. The body now has a real summary and status line, but it still blends:

- Bazarr-side capabilities
- Nexus implementation status
- future player/user automation goals

into one issue.

### `#50` Public-facing website

Still generic. It reads like a placeholder project-management note, not a real issue description with scope, audience, and deliverables.

### `#51` Mobile app

Still the weakest current issue body. It is basically a copied comment plus "Similar to #25", which is not enough for planning or implementation.

### `#52` Live TV support

Still stale. The body says only that TV currently links out and this issue will implement a frontend. That is much weaker than the apparent shipped reality.

## Advisory Takeaway

If Claude does issue cleanup later, the priority order should be:

1. `#51`
2. `#50`
3. `#27`
4. `#47`
5. `#52`

## Why This Order

- `#51` is barely an issue body at all
- `#50` is too generic to guide the website well
- `#27` has active/complex work but minimal issue text
- `#47` has better text than before, but still needs capability/status structure
- `#52` mostly looks like a stale closure/status problem
