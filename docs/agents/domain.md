# Domain Docs

How engineering skills consume this repository's domain documentation.

## Before exploring, read these

- Read `CONTEXT.md` at the repository root for the canonical domain vocabulary.
- Read ADRs under `docs/adr/` that relate to the area being changed.
- If a relevant file does not exist, proceed silently. Create domain documentation lazily through the domain-modeling workflow when a term or decision is actually resolved.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

## Use the glossary vocabulary

Use terms as defined in `CONTEXT.md` in issue titles, specifications, tests, hypotheses, and implementation notes. Avoid synonyms that the glossary explicitly rejects.

If a needed domain concept is missing, first reconsider whether new terminology is necessary. If the gap is real, record it through domain modeling.

## Flag ADR conflicts

Surface any proposed behavior that contradicts an accepted ADR. Do not silently override an architectural decision.
