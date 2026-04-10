# Mobile and TV Strategy Research

## Goal

Prevent overlap and confusion between TV mode, Android TV support, native shells, and a mobile app.

## External Sources

- Android TV focus system: https://developer.android.com/design/ui/tv/guides/styles/focus-system
- Android TV navigation guidance: https://developer.android.com/design/ui/tv/guides/foundations/navigation-on-tv
- Android TV get started / navigation: https://developer.android.com/training/tv/get-started/navigation

## Current Issue Split

- `#25` Android TV support
- `#51` Mobile app

## Problem

These can easily blur together unless the project defines what belongs in each bucket.

## Recommended Separation

### TV Mode / Android TV (`#25`)

Scope:

- 10-foot UI
- D-pad/remote navigation
- focus management
- TV-specific home/library/search/player flows
- keyboardless auth and TV-friendly navigation

Official Android TV guidance strongly emphasizes:

- predictable D-pad navigation
- clear focus indicators
- simple back-button behavior
- straightforward paths to all focusable elements

## Official Android Guidance Notes

Key platform expectations from Android’s TV documentation:

- users navigate primarily with the D-pad
- focus must be visually obvious at all times
- the back button should behave predictably and not be trapped behind confirmation loops
- navigation paths should be simple and direct
- TV flows should avoid touch-centric assumptions

References:

- https://developer.android.com/design/ui/tv/guides/styles/focus-system
- https://developer.android.com/training/tv/get-started/navigation
- https://developer.android.com/design/ui/tv/guides/foundations/navigation-on-tv

### Mobile app (`#51`)

Scope:

- phone/tablet dashboard/media-manager experience
- responsive/mobile-first controls
- request/admin/control flows
- possibly native shell later, but not necessarily as the first step

## Mobile-Specific Questions

- Is the first mobile deliverable just a responsive web experience?
- Is native packaging phase 1 or later?
- Is playback a phase-1 goal, or is this primarily a dashboard/control app first?
- Which features matter most on phone: requests, admin tools, search, continue watching, notifications?

## Recommended Strategy

1. Treat TV and mobile as separate product tracks.
2. Do not overload `#25` with phone/mobile requirements.
3. Rewrite `#51` as a real issue body with clear mobile scope.
4. Consider responsive web improvements as shared groundwork, but keep platform-specific issues distinct.

## Inference

The Android guidance is specific enough that TV should not be treated as "just responsive mobile on a big screen." The input model, focus expectations, and navigation constraints are different enough to justify separate issue scope and likely separate UI treatment.

## Shared Foundation Work

The following may benefit both tracks, but should still be tracked separately from platform-specific issues:

- responsive layout cleanup
- focus/state management discipline
- route organization for alternative shells
- auth flows that work outside desktop assumptions

## Practical Planning Note

If Claude touches either issue, it should first define:

- what is shared UI groundwork
- what is TV-only
- what is mobile-only
- whether native packaging is phase 1 or later

## Recommended Issue Hygiene

- keep `#25` focused on TV/10-foot interaction
- keep `#51` focused on phone/tablet use cases
- do not use one issue as a “catch-all native app” bucket
