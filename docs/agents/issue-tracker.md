# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per issue at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; never use a single combined issues file
- When an issue needs state, record it as a `Status:` line near the top of the file
- Append comments and conversation history under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

## When a skill says "fetch the relevant issue"

Read the referenced markdown file. The user will normally pass its path or issue number directly.

## Wayfinding operations

- **Map**: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog
- **Child issue**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`; record its kind as `Type: research|prototype|grilling|task` and state as `Status: claimed|resolved`
- **Blocking**: record `Blocked by: NN, NN` near the top; an issue is unblocked when every listed issue is resolved
- **Frontier**: scan the effort's issues for open, unblocked, unclaimed files and select the first by number
- **Claim**: set `Status: claimed` and save before starting work
- **Resolve**: append the result under `## Answer`, set `Status: resolved`, and add a context pointer to the map's Decisions-so-far
