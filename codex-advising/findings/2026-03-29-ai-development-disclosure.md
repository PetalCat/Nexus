# Codex Research Findings

## Question

How should Nexus disclose heavy AI-assisted development without turning the whole project into "an AI project"?

## Local Evidence

- `CONTRIBUTING.md` already allows AI tools.
- `CONTRIBUTING.md` already requires contributors to test AI-generated code and understand what they submit.

## External Sources

- GitHub docs on `CONTRIBUTING.md`: https://docs.github.com/en/articles/setting-guidelines-for-repository-contributors
- Creative Commons contribution policy: https://opensource.creativecommons.org/contributing-code/

## Key Facts

- GitHub explicitly recommends `CONTRIBUTING.md` as the place to communicate contribution guidelines to collaborators.
- Public open-source projects do not appear to follow a single universal standard for AI-use disclosure.
- Some projects choose a strict policy posture. Creative Commons, for example, rejects AI-generated contributions entirely.

## Inference

For Nexus, the cleanest and most credible pattern is a hybrid one:

- a short acknowledgement in `README.md`
- the detailed policy and expectations in `CONTRIBUTING.md`

That matches the repo’s current governance shape better than either hiding AI entirely or making AI the headline identity of the project.

## Relevance To Nexus

Nexus already has the policy layer. What is missing is only the lightweight public disclosure layer.

## Advisory Takeaway

If Claude updates docs later, it should keep the README disclosure short and factual, then rely on `CONTRIBUTING.md` for standards around testing, responsibility, and acceptable use.
