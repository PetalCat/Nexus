# Research Handoff Structure

This file defines a lightweight handoff format for research-oriented collaboration.

It is meant to help future agents, especially Claude, consume and extend research without turning the folder into a rigid task runner.

## Purpose

Use `codex-advising/` to capture:

- missing context
- risk areas
- local code observations
- issue-to-code mismatches
- source-backed product or platform research

Do not use it as a substitute for implementation planning or code review.

## Folder Roles

### `codex-advising/README.md`

- Index of current research topics
- Short explanation of how to treat the folder

### Topic files

Examples:

- `messaging-positioning.md`
- `seerr-parity-audit.md`
- `bazarr-semantics-audit.md`

Each topic file should stay focused on a single research area.

## Recommended Topic File Shape

Use sections like:

- Goal
- Summary
- Local Findings
- External Signals / Sources
- Advisory Questions
- Best Use of This Research

The point is clarity and context, not a mandatory format.

## When Claude Should Look Here

- before rewriting issue bodies
- before public-copy or website work
- before implementing issue-driven work with ambiguous scope
- before touching cross-service features with identity/matching questions
- before acting on local worktree changes that appear only partially complete

## How to Extend the Research

- Prefer adding to an existing topic file if the topic already exists
- Create a new file if the topic is genuinely distinct
- Keep findings concrete and source-backed where possible
- Separate local code observations from external research

## What Not to Do

- Do not turn research notes into mandatory implementation checklists
- Do not replace issue reading with research-note reading
- Do not copy large amounts of vendor docs into the repo
- Do not bury key findings in giant unstructured dumps

## Optional Request Pattern

If a future agent wants to request more research, it can add a short note in `notes.md` or create a new topic file with:

- what question needs answering
- why it matters
- what repo areas it affects

That is enough. No heavy workflow machinery is required unless the project later wants it.
