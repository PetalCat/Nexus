# Codex Research Findings

## Question

What examples and patterns exist for disclosing AI-assisted development in open-source projects, and what pattern is most credible for Nexus?

## Local Evidence

- Nexus already has AI-use guidance in `CONTRIBUTING.md`
- Nexus does not yet appear to have a short README-level disclosure
- `codex-advising/findings/2026-03-29-ai-development-disclosure.md` already argues for a hybrid pattern

## External Sources

- GitHub docs on contributing guidelines: https://docs.github.com/en/articles/setting-guidelines-for-repository-contributors
- Creative Commons contribution guidelines: https://opensource.creativecommons.org/contributing-code/
- Example README language for AI-assisted tooling/product framing:
  - Xtreme1 docs repo: https://github.com/xtreme1-io/docs
  - StoryCraftr repo: https://github.com/raestrada/storycraftr

## Key Facts

- GitHub explicitly recommends `CONTRIBUTING.md` as the place to communicate contribution guidelines to collaborators.
- Creative Commons provides a concrete example of an explicit AI policy in contribution guidelines, and in that case the policy is prohibition.
- Public open-source repos that mention AI often do so in one of two ways:
  - as a product capability in the README
  - as a policy statement in contribution guidelines
- There still does not appear to be a single universal disclosure norm for “this project was built with heavy AI assistance.”

## Facts Vs Inference

### Sourced facts

- `CONTRIBUTING.md` is the normal place for contribution-policy rules.
- Explicit AI policy in contribution guidelines is a real and accepted pattern.
- README references to AI are common when AI is part of the product or workflow story.

### Inference

- For Nexus, the best pattern is still the hybrid one:
  - short factual README disclosure
  - detailed policy/expectations in `CONTRIBUTING.md`
- The project does not need a long manifesto about AI. It needs clarity and proportionality.
- A README disclosure should acknowledge heavy AI assistance without making AI the product identity.

## Relevance To Nexus

This matters for:

- README trust/transparency
- contributor expectations
- keeping the public message honest without derailing the project’s main product story

## Advisory Takeaway

The most credible pattern for Nexus remains:

- brief README acknowledgement
- contribution standards in `CONTRIBUTING.md`

That matches GitHub’s contribution-guideline model, respects the repo’s existing policy layer, and avoids turning the docs into an oversized AI statement.

## Open Questions

- Should the README disclosure be a one-line note near the intro, or a short note near Contributing?
- Should the project describe itself as “AI-assisted” or simply disclose that AI assistance is part of the development workflow?
- Does the project want a changelog/history note about AI origins, or only a standing documentation note?
