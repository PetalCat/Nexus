# Competitor and Positioning Research

## Goal

Give Claude better context for how Nexus should describe itself publicly without collapsing into generic self-hosted-app copy.

This is advisory research, not a marketing script.

## External Sources

- Jellyfin homepage: https://jellyfin.org/
- Seerr repository / README: https://github.com/fallenbagel/jellyseerr
- Calibre-Web repository / README: https://github.com/janeczku/calibre-web
- RomM docs introduction: https://docs.romm.app/latest/
- Invidious homepage: https://invidious.io/

## Core Positioning Observation

Nexus is not best described as just:

- a media server
- a request manager
- a dashboard
- a TV app

It sits across multiple roles:

- unified frontend
- orchestration layer
- aggregation layer
- cross-service UX

That multi-role nature is the main differentiator.

## What Comparable Projects Tend to Be

### Jellyfin

Jellyfin presents itself as a self-hosted media system focused on collecting, managing, and streaming your media from your own server.

Nexus is not trying to replace the underlying server role; it sits above or beside that layer.

### Invidious

Invidious presents itself as an open source alternative front-end with accounts, playlists, subscriptions, and a developer API for one video ecosystem.

Nexus uses/relates to this style of tool as one input among many, not as its whole product identity.

### Jellyseerr / Seerr / Overseerr lineage

Seerr/Jellyseerr present themselves as media request and discovery managers that integrate with media servers and existing automation services such as Sonarr and Radarr.

Nexus overlaps with that area, but also extends into books, games, analytics, unified search, and cross-service aggregation.

### Calibre-Web / RomM / *arr tools

Each of these is domain-specific:

- books
- games
- automation
- requests
- subtitles

Calibre-Web explicitly focuses on browsing, reading, and downloading books from a Calibre database. RomM focuses on scanning, enriching, and browsing a game collection. Nexus’s strongest public pitch is that users do not need to think in those separate silos all the time.

## Best Public Positioning Direction

Nexus should be described less as:

- "an alternative to X"

and more as:

- "a unified self-hosted media frontend for user-configured services"
- "one interface across your connected media tools"
- "an independent orchestration layer across media libraries, requests, activity, and recommendations"

## Why This Positioning Is Stronger

It avoids:

- direct consumer-brand comparison
- overstating what Nexus owns or hosts
- sounding like just another single-purpose tool

It also reflects the actual repo better:

- dashboard
- search
- requests
- books
- games
- video
- music
- analytics
- social

## Advisory Questions for Claude

- Should the public site lead with “unified frontend” or “self-hosted media platform”?
- Which value proposition is strongest for first-time visitors:
  - one interface
  - cross-service intelligence
  - self-hosting convenience
  - media breadth across books/games/video/music?
- Where should integration names live: homepage, compatibility page, or install docs?

## Best Use of This Research

Use it while shaping issue `#50`, README copy, and any future homepage/website text.
