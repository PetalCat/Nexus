# Codex Finding Review Checklist

Use this when Claude reviews a Codex finding before acting on it.

## Quick Checks

- Is the question specific and relevant to the current task?
- Does the finding clearly separate local repo evidence from outside-world evidence?
- If external claims are made, are there named sources with links?
- Does it separate sourced facts from inference?
- Does it call out uncertainty or undocumented gaps honestly?
- Does it explain why the result matters for Nexus?
- Is it advisory rather than a rigid implementation mandate?

## Warning Signs

Be more cautious if a finding:

- makes outside-world claims without sources
- treats issue text as authoritative without checking code or commits
- turns a research note into a file-by-file command list
- mixes speculation and evidence without labeling which is which
- sounds more certain than the sources justify

## Practical Standard

A good Codex finding should help Claude think faster and more accurately.

It should not try to replace Claude’s judgment.
