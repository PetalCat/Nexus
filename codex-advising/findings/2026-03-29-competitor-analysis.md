# Codex Research Findings

## Question

How should Nexus position itself relative to self-hosted media servers, request managers, and domain-specific tools?

## Sources

- Jellyfin homepage: https://jellyfin.org/
- Seerr repository / README: https://github.com/fallenbagel/jellyseerr
- Calibre-Web repository / README: https://github.com/janeczku/calibre-web
- RomM docs introduction: https://docs.romm.app/latest/
- Invidious homepage: https://invidious.io/

## Key Facts

- Jellyfin presents itself as a self-hosted media system centered on managing and streaming media from your own server.
- Seerr/Jellyseerr present themselves as request and discovery managers that integrate with existing media servers and automation tools.
- Calibre-Web presents itself as a web app for browsing, reading, and downloading ebooks from a Calibre database.
- RomM presents itself as a self-hosted ROM manager for scanning, enriching, and browsing a game collection.
- Invidious presents itself as an open source front-end for a specific video ecosystem, with subscriptions, playlists, and a developer API.

## Inference

Most comparable projects own one domain or one role:

- server and playback
- request/discovery management
- books
- games
- one video frontend

Nexus is most differentiated when described as the layer that connects those kinds of tools and makes them feel like one product.

## Relevance To Nexus

This matters most for README and website messaging. If Nexus is described like a single server, request manager, or branded alternative, it will sound smaller and less distinct than it actually is.

## Advisory Takeaway

The strongest public framing is usually some version of:

- one interface across user-configured media services
- a unified self-hosted media frontend/orchestration layer
- cross-service browsing, requests, activity, and discovery

## Open Questions

- Which single value proposition should lead the homepage: unification, breadth, or cross-service intelligence?
- How much should the public site mention integrations on the homepage versus pushing them to a compatibility page?
