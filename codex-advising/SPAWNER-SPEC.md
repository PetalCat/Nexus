# Codex Advising Spawner Spec

This file describes the intended behavior for a future Claude-built spawner.

It is not implemented here. It is an implementation brief for Claude.

## Goal

Allow Claude to trigger Codex advising or research with a near one-command flow such as:

```bash
cdx-research my-topic.md
```

The ideal outcome:

1. Claude creates or selects a request file
2. the spawner launches Codex research against that request
3. Codex writes findings into `codex-advising/findings/`
4. Claude can see the result and continue working

## Intended User Experience

Claude should be able to invoke a command with minimal friction and get:

- a structured request file in `codex-advising/requests/`
- a matching finding file in `codex-advising/findings/`
- a status update indicating whether research is pending, running, or complete

## Minimum Viable Behavior

### Command

Preferred command:

```bash
cdx-research <filename.md>
```

Example:

```bash
cdx-research seerr-parity.md
```

### Command responsibilities

- ensure the request file exists in `codex-advising/requests/`
- seed it from `codex-advising/REQUEST-TEMPLATE.md` if it does not exist
- mark status as pending/running in a shared status file
- invoke Codex using whatever runtime/tooling is available in the actual environment
- write or update a corresponding file in `codex-advising/findings/`
- mark the request complete when finished

## Repo-Level Files to Use

- `codex-advising/REQUEST-TEMPLATE.md`
- `codex-advising/requests/`
- `codex-advising/findings/`
- optional: `codex-advising/STATUS.md`

## Open Implementation Questions for Claude

Claude should answer these before implementing the spawner:

1. What runtime actually launches Codex from Claude’s environment?
2. Is there a Codex CLI, API wrapper, or local agent runner available?
3. Can Claude invoke shell scripts that in turn call Codex?
4. How should the spawner wait for completion:
   - blocking foreground call
   - background job with polling
   - file-based completion signal
5. How should failures be reported back into the repo?

## Recommended Output Conventions

### Request file

- location: `codex-advising/requests/<filename.md>`

### Findings file

- location: `codex-advising/findings/<filename.md>`

### Status tracking

Optional but recommended:

- `codex-advising/STATUS.md`

Suggested states:

- pending
- running
- complete
- failed

## Recommended Implementation Approach for Claude

The cleanest likely path is:

1. build a small shell script or node script named `cdx-research`
2. have it create/check the request file
3. invoke Codex through the real available runtime
4. write findings into the findings folder
5. update a simple status file

That keeps the workflow repo-native and inspectable.

## Constraints

- Do not assume automatic cross-agent invocation exists unless the environment supports it
- Do not fake completion if Codex was not actually run
- Keep the handoff file format simple and transparent

## Success Criteria

The spawner is good enough if Claude can:

- run one command
- get Codex research started
- find the result in a predictable location
- continue work without manually rebuilding the handoff structure every time
