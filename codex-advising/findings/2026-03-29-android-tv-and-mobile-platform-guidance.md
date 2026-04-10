# Codex Research Findings

## Question

What do official platform sources and strong ecosystem references say about Android TV navigation/focus expectations, and how should that inform the split between TV-mode work and mobile-app work?

## Local Evidence

- Nexus tracks Android TV support in `#25`
- Nexus tracks a mobile app separately in `#51`
- `codex-advising/mobile-tv-strategy.md` already argues these should be treated as separate product tracks

## External Sources

- Android TV focus system: https://developer.android.com/design/ui/tv/guides/styles/focus-system
- Android TV navigation on TV: https://developer.android.com/design/ui/tv/guides/foundations/navigation-on-tv
- Android TV get started / navigation: https://developer.android.com/training/tv/get-started/navigation
- Android TV layouts: https://developer.android.com/design/ui/tv/guides/styles/layouts

## Key Facts

- Android’s official TV guidance treats D-pad navigation as the primary interaction model.
- Android’s TV docs repeatedly emphasize visible focus, predictable movement between focusable elements, and a clear path to every visible control.
- Android explicitly recommends avoiding unnecessary navigation complexity and avoiding controls that are hard to reach with the D-pad.
- Android’s TV guidance says the back button should remain simple and predictable, and specifically warns against gating exit behind confirmation loops.
- Android’s TV layout guidance assumes a 16:9 screen, large-screen presentation, horizontal/vertical axis planning, and overscan-safe margins.

## Facts Vs Inference

### Sourced facts

- TV navigation is not touch-first; it is D-pad-first.
- Focus state is fundamental to usability on TV.
- Clear directional paths matter more on TV than on touch devices.
- TV back-button behavior should be simple and consistent.
- Large-screen layout assumptions are part of the platform guidance, not just aesthetic preference.

### Inference

- TV mode should not be scoped as “mobile, but bigger.”
- Android TV and phone/tablet work should remain separate issues because they optimize for different inputs, navigation models, and layout constraints.
- Shared groundwork may exist, but the interaction design for TV is distinct enough that it deserves its own product and implementation pass.

## Relevance To Nexus

This matters most for:

- issue `#25`
- issue `#51`
- future TV-mode planning
- any decision about whether one responsive UI can credibly cover both TV and mobile from day one

## Advisory Takeaway

The platform guidance strongly supports keeping TV and mobile separate in planning:

- TV work should center on focus, remote navigation, back behavior, and large-screen browsing/player flows
- mobile work should center on touch-first dashboard, request, and management flows
- shared responsive cleanup can help both, but it should not erase the product distinction between them

## Open Questions

- Should Nexus aim for a dedicated TV route/shell first, or a TV-optimized variant within the existing app structure?
- Is the first mobile deliverable primarily a control/dashboard app, or does it need full playback parity?
- Which shared layout/auth work can be done once without collapsing TV and mobile into one issue?
