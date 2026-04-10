# Nexus Project Memory

See @/Users/parker/Developer/Nexus/notes.md for current project notes and @/Users/parker/Developer/Nexus/codex-advising/README.md for Codex advisory and research context.

See @/Users/parker/Developer/Nexus/HANDOFF-INDEX.md for the top-level handoff map and @/Users/parker/Developer/Nexus/WHO-TO-USE.md for the quick chooser.

## System Ownership

- This entire Codex advising and research system is owned by Claude operationally.
- Claude may change, shift, simplify, extend, replace, reorganize, or remove any part of this system as it sees fit.
- Claude should optimize the system for its own workflow, judgment, and efficiency rather than preserving the current structure for its own sake.
- Nothing in this handoff structure should be treated as fixed if Claude sees a better way to run it.

## Codex Advising And Research

- Treat `codex-advising/` as a Codex-maintained advisory workspace for this repo.
- Claude remains the primary agent for planning, implementation, and judgment.
- Codex is here to supplement Claude, not replace Claude.
- Codex’s role is to provide an additional repo-aware perspective when another review, audit, or context pass would be useful.
- Codex is most useful for spotting risks, surfacing gaps, identifying mismatches, filling in missing repo-specific context, and doing source-backed research when needed.
- Review relevant files in `codex-advising/` before issue cleanup, roadmap cleanup, public-copy work, Seerr work, subtitle work, website planning, or cross-service feature planning.
- Do not treat `codex-advising/` as rigid implementation instructions. Use judgment.
- If you want Codex advisory help, use the file-based workflow in `codex-advising/HANDOFF-FILE-WORKFLOW.md`.
- Use `codex-advising/HOW-TO-ASK-CODEX.md` to shape good advisory requests.
- Use `codex-advising/QUALITY-BAR.md` when shaping or reviewing research-heavy Codex outputs.
- If you want a default starting point, check `codex-advising/START-HERE.md`.
- You may change, simplify, extend, or reorganize the Codex handoff system as needed if it will make the workflow more effective.
- Optimize for practical usefulness and low friction rather than preserving the current structure exactly.
- Use `codex-advising/STATUS.md` to track active requests.

## Issue Context

- Before implementing any issue-driven task, read the full GitHub issue body and all issue comments first.
- Do not work from the issue title alone.
- Treat issue comments as part of the task context and scope.

## Advisory Requests

- If you need Codex advising, use the structure in `codex-advising/HANDOFF-STRUCTURE.md`.
- Add or update advisory notes rather than replacing them with step-by-step commands.
- You can create a request in `codex-advising/requests/` using `codex-advising/REQUEST-TEMPLATE.md`.
- Codex findings should be returned to `codex-advising/findings/`.
- If you decide to build a real Codex launcher/spawner, read `codex-advising/SPAWNER-SPEC.md` first.
- Set up an invocation path for Codex advising if you build automation around this system.

## Invocation System

- If you build a launcher/spawner workflow, optimize for low-friction Codex handoff.
- Use the filename convention `YYYY-MM-DD-topic.md` for both requests and findings where possible.
- Do not overuse handoffs when the answer is already obvious from local context.
