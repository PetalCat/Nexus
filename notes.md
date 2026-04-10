# Notes

## TODO for Claude

- This entire Codex advising and research system is up to Claude.
- Claude may shift, change, simplify, extend, replace, reorganize, or remove any part of it to fit its own workflow.
- Do not preserve this system out of inertia if a better structure would be more effective.
- Before implementing any issue-driven task, read the full GitHub issue body and all issue comments first.
- Do not start coding from the title alone or from a partial summary.
- Use the full issue thread to gather scope changes, user feedback, clarifications, edge cases, and completion notes before making a plan.
- Treat issue comments as part of the task specification, not as optional context.
- On next load, review everything in `codex-advising/` before starting roadmap/issue cleanup work.
- Claude does its own advising already; use `codex-advising/` when an additional repo-aware perspective would be useful.
- Use `codex-advising/issue-code-audit.md` before rewriting issue bodies so shipped features are not described as unstarted.
- Treat everything in `codex-advising/` as advisory context and missing repo-specific guidance, not as rigid instructions. Use judgment.
- Use `codex-advising/` for both repo-aware advisory work and source-backed research when an additional pass would help.
- Prefer official or primary sources when external research is involved.
- Ask Codex findings to separate sourced facts from inference and to note uncertainty.
- Claude may change, simplify, extend, or reorganize the Codex advising/research system if that makes the workflow more efficient.
- Use the filename convention `YYYY-MM-DD-topic.md` for both requests and findings where practical.
- Track active handoffs in `codex-advising/STATUS.md`.
- Do not overuse handoffs when the answer is already obvious from local context.
- For Seerr/subtitles/public wording work, also review:
  - `codex-advising/seerr-parity-audit.md`
  - `codex-advising/bazarr-semantics-audit.md`
  - `codex-advising/ui-string-audit.md`
- For website positioning and cross-service feature planning, also review:
  - `codex-advising/competitor-positioning.md`
  - `codex-advising/cross-service-identity.md`
  - `codex-advising/ui-string-audit-deep.md`
- If Claude needs Codex advising, create a handoff request in `codex-advising/requests/` using `codex-advising/REQUEST-TEMPLATE.md`, and look for returned findings in `codex-advising/findings/`.
- Use `codex-advising/QUALITY-BAR.md` when writing or reviewing research prompts and findings.
- If Claude wants an immediate Codex task without choosing one, start with `codex-advising/START-HERE.md`.
- If Claude wants to build a near one-command Codex invocation flow, use `codex-advising/SPAWNER-SPEC.md` as the implementation brief.

## Remaining Work Buckets

### Issue and tracker cleanup

- Rewrite weak or stale issue bodies:
  - `#27` Seerr
  - `#47` Subtitle intelligence
  - `#50` Public-facing website
  - `#51` Mobile app
- Refresh partially shipped issue descriptions so they reflect current `main` status:
  - `#40` Universal Continue
  - `#41` Cross-media franchise pages
  - `#42` Unified calendar
  - `#46` Unified quality dashboard
  - `#48` Nexus Wrapped
- Review shipped-looking issues for closure or final-pass cleanup:
  - `#52` Live TV support
- Keep roadmap, issue bodies, and shipped `main` features synchronized going forward.

### Messaging and website work

- Build the public-facing Nexus website (`#50`).
- Audit README, setup docs, and public-facing copy for neutral integration language.
- Add non-affiliation and user-responsibility language to website/docs/onboarding.
- Keep compatibility/service naming separate from marketing copy where possible.

### Product follow-through that still appears unfinished

- `#27` Seerr compatibility pass:
  - Dual registration
  - Auth-linking parity
  - Search/detail-route parity with Overseerr flows
- `#47` Subtitle-management follow-through:
  - Upload flow
  - Translate semantics
  - Player wiring
- `#41` Franchise pages:
  - Move from building blocks to real cross-media matching logic
- `#42` Unified calendar:
  - Expand beyond current implemented providers
- `#46` Quality dashboard:
  - Add upgrade actions and deeper integrations
- `#48` Nexus Wrapped:
  - Expand and polish full cross-media support

### Larger future product work still open

- `#25` Android TV support
- `#51` Mobile app
- `#49` Unified parental controls
- `#43` Smart auto-requests
- `#44` AI curator
- `#45` Watch parties
- Adapter work:
  - `#24` Plex
  - `#28` Kapowarr
  - `#29` Tdarr
  - `#30` Readarr
  - `#31`-`#39` additional adapter/integration issues
