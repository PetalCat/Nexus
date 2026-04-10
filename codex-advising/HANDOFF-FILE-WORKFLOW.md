# Handoff File Workflow

This is a lightweight file-based way for Claude to hand research or advisory work to Codex.

It is not an automatic runtime integration. It is an operational workflow.

## Overview

1. Claude creates a handoff request file in `codex-advising/requests/`
2. Codex reads the request and performs advisory work, research, or both
3. Codex writes findings to `codex-advising/findings/`
4. Claude reviews the findings and decides what to do

## Folder Structure

- `codex-advising/requests/`
  - incoming advisory requests for Codex
- `codex-advising/findings/`
  - completed research responses from Codex

## Request File Naming

Recommended format:

- `YYYY-MM-DD-short-topic.md`

Example:

- `2026-03-29-seerr-parity.md`

## Request File Contents

Use the template in `codex-advising/REQUEST-TEMPLATE.md`.

At minimum include:

- topic
- question
- why it matters
- local areas to inspect
- whether online research is needed
- desired output

## Finding File Naming

Use the same date/topic where possible, for example:

- `codex-advising/findings/2026-03-29-seerr-parity.md`

## Important Notes

- Claude should still read the full issue and comments before implementation.
- Research files are advisory context, not commands.
- If a topic already exists in `codex-advising/`, Claude can reference or extend that instead of creating a new request.
- Use `codex-advising/QUALITY-BAR.md` when shaping or reviewing research-heavy requests.
- Use `codex-advising/REVIEW-CHECKLIST.md` when deciding whether a finding is strong enough to act on.
