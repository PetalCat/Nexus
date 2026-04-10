# Codex Research Findings

## Question

How should Nexus be positioned publicly relative to self-hosted media servers, request managers, and domain-specific tools, and what messaging patterns from comparable projects are worth learning from?

## Local Evidence

- `README.md` currently opens with "A unified self-hosted media platform."
- The current README feature list spans:
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
- Issue `#50` is still very generic and mostly lists website chores rather than a product story.

## External Sources

- Jellyfin homepage: https://jellyfin.org/
- Seerr docs: https://docs.seerr.dev/
- Jellyseerr repository / README: https://github.com/fallenbagel/jellyseerr
- Calibre-Web repository / README: https://github.com/janeczku/calibre-web
- RomM docs introduction: https://docs.romm.app/latest/
- Invidious homepage: https://invidious.io/

## Key Facts

- Jellyfin positions itself around owning and streaming media from your own server.
- Seerr/Jellyseerr position themselves around requests, discovery, and integration with existing media-server and automation tooling.
- Calibre-Web positions itself around reading and managing books from a Calibre database.
- RomM positions itself around managing and enriching a retro game collection.
- Invidious positions itself as a front-end for a single video ecosystem.

## Observed Messaging Pattern

Comparable projects usually do one of these:

- lead with one domain
- lead with one operational role
- lead with one specific ecosystem

Nexus is unusual because it spans:

- multiple media domains
- multiple service roles
- multiple interaction types

That means it will usually be undersold if it is described like a single server, single manager, or single frontend.

## Inference

The strongest public positioning for Nexus is probably not:

- "another media server"
- "another request manager"
- "a dashboard"

The stronger lane is:

- one interface across your user-configured media services
- a unified self-hosted media frontend/orchestration layer
- cross-service browsing, requests, activity, and discovery

## Relevance To Nexus

This matters most for:

- issue `#50`
- the future public website
- the README opener
- any homepage/hero copy

Right now, the project reads smaller than it is. The website should fix that without falling into brand-led comparison copy.

## Advisory Takeaway

For the public site, the best homepage pattern is likely:

1. define Nexus as the unifying layer
2. show breadth across media domains
3. show concrete interaction modes such as browsing, reading, playing, requesting, and tracking
4. push integration names down to compatibility/install sections instead of leading with them

## Open Questions

- Should the homepage lead with "one interface" or "cross-service intelligence"?
- How much feature breadth should be shown above the fold before it becomes noisy?
- Should the first public site version stay minimal, or should it include screenshots and a compatibility page immediately?
