# Open Beta Smoke Test (Clean Install)

Run from a wiped DB. Check off each item as you verify it.

## First Run
- [ ] Redirects to `/register` or `/login` on first visit
- [ ] Create admin account — register first user
- [ ] Lands on homepage after registration

## Service Setup (Settings)
- [ ] Add Jellyfin — enter URL + API key, test connection, save
- [ ] Add Overseerr/Seerr — connect, verify auto-link to Jellyfin
- [ ] Add Radarr — connect with API key
- [ ] Add Sonarr — connect with API key
- [ ] Add Lidarr — connect with API key
- [ ] Add Bazarr — connect with API key
- [ ] Add Prowlarr — connect with API key
- [ ] Add Calibre-Web — connect
- [ ] Add RomM — connect
- [ ] Add Invidious — connect
- [ ] Add StreamyStats — connect (auto-links via Jellyfin token)
- [ ] All services show green health after adding

## Account Linking
- [ ] Link Jellyfin credentials — enter user credentials in settings
- [ ] Auto-link fires — Overseerr/StreamyStats link automatically
- [ ] Verify linked status in account settings

## Homepage
- [ ] Continue Watching row appears (after playing something)
- [ ] Recently Added rows load
- [ ] Trending row loads
- [ ] Recommendations rows load (if StreamyStats connected)
- [ ] Upcoming rows load (Radarr/Sonarr calendar)
- [ ] Hero carousel shows items with backdrops

## Browse & Search
- [ ] Search — type a query, get results from all services
- [ ] Search — "Not in your library?" section shows requestable items
- [ ] Discover (`/discover`) — tabs load, genre filtering works, infinite scroll
- [ ] Collections (`/collections`) — page loads, click into a collection
- [ ] Person — click a cast member on detail page, filmography loads
- [ ] Franchise (`/franchise`) — search works, cross-media results

## Media Detail Pages
- [ ] Movie detail — poster, backdrop, cast, similar, metadata all load
- [ ] Show detail — seasons list, episode list, cast
- [ ] Music album — track list, playback
- [ ] Book detail — metadata, read button
- [ ] Game detail — metadata, play button
- [ ] Video detail (Invidious) — metadata, player

## Playback
- [ ] Movie/episode — HLS playback in Player, controls work
- [ ] Subtitles — toggle on/off, switch tracks
- [ ] Music — plays in MusicPill, persists across navigation
- [ ] Book (EPUB) — opens in foliate reader, pages turn
- [ ] Book (PDF) — opens in PDF.js reader, pages render
- [ ] Game (ROM) — opens EmulatorJS, game loads
- [ ] Video (Invidious) — plays, SponsorBlock segments skip
- [ ] ~~Live TV — deferred to post-beta (#56)~~

## Requests
- [ ] Submit request — search for unrequested movie/show, request it
- [ ] View requests (`/requests`) — list loads
- [ ] Approve/deny — admin can approve or deny from request page

## Calendar
- [ ] Calendar (`/calendar`) — week view loads with upcoming releases
- [ ] Toggle to month view
- [ ] Items from Radarr + Sonarr + Lidarr appear

## Stats & Wrapped
- [ ] Wrapped (`/wrapped`) — loads (may be empty on fresh install)
- [ ] Admin stats (`/admin`) — dashboard loads

## Admin
- [ ] Admin dashboard (`/admin`) — sessions panel, health, request queue
- [ ] Service management — edit/delete a service
- [ ] Quality badges — visible on movie detail pages (if Radarr connected)

## Multi-User
- [ ] Create second user — register or invite
- [ ] Second user can log in and link their own credentials
- [ ] Second user sees their own recommendations/continue watching

## Edge Cases
- [ ] Log out — session cleared, redirected to login
- [ ] Log back in — session restored, homepage loads
- [ ] Bad service URL — adding a service with wrong URL shows error, doesn't crash
- [ ] Service goes down — health shows red, other services still work

## Issues Found
<!-- Log any bugs here during testing -->

