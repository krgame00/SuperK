# Cleanup design review

Status: consolidated design confirmed by the user ("ok"); implementation authorized.

## Settled scope

The user selected unused-code cleanup as the subject of this review. Determine
what to delete, retain, or reconnect, and the evidence required for each choice.
Online deployment and overall product direction are outside this interview's
current scope.

## Existing evidence

- The first cleanup batch removed two unused development dependency declarations
  and two client wrappers with no production callers. See unused-code-cleanup.md.
- The last verification passed 846 tests and TypeScript; this was against the
  existing installation, not a fresh dependency install.
- The disconnected editor components still have tests. Lack of a production
  caller does not establish that their product capabilities should be retired.
- Files in public can be accessed directly or packaged without a source import.
- Model files and job caches have roles distinct from unused application code.

## Decision tree

Scope: unused-code cleanup (settled)

- Q2: Is the disconnected editor a future capability or a retired experiment?
  - Later: choose retention, reconnection, or removal for the affected files.
- Q3: What outcome defines successful cleanup?
  - Later: prioritize source simplification versus distribution/disk size.
- Q4: What verification is required before accepting dependency removals?
  - Later: select an isolated installation/build check and record limitations.

## Settled decisions from round 2

- Q2: Retain the disconnected editor for now. Do not remove its components,
  supporting dependencies, or tests as unused code in this batch.
- Q3: Prioritize maintainability. Disk-size reduction and Cloud preparation are
  not the primary acceptance criteria. Do not claim performance gains merely
  from removing code that was not loaded.
- Q4: Validate dependency cleanup with a fresh install in a separate directory,
  followed by production build, TypeScript, and tests. Preserve the current
  working installation. Record failures and environment limitations explicitly.

## Current frontier

- Q5: Should helpers referenced only by tests be removed with their tests, or
  retained until a product requirement is resolved? Dedicated test utilities,
  benchmark tools and the retained editor must be distinguished from dormant
  production helpers.
- Q6: Is this batch limited to source/dependencies, or should public assets and
  experimental documentation also be reorganized? Moving public files can change
  externally used URLs even when source references are absent.

## Settled decisions from round 3

- Q5: Remove dormant production helpers only after confirming they have no
  remaining responsibility or production callers. Remove their dedicated tests
  with them. Retain dedicated test utilities, benchmarks, and the editor. Defer
  ambiguous candidates rather than treating absence of imports as proof.
- Q6: Limit this batch to application source and dependencies. Do not move or
  delete public assets, documentation, model files, job caches, or saved work.
  Review those separately if requested later.

## Consolidated design and acceptance criteria

1. Re-check references for each candidate, including dynamic imports, framework
   entrypoints, configuration, scripts and callers outside the main page.
2. Record why each proposed removal has no remaining responsibility. Retain any
   candidate with unresolved purpose. Avoid unrelated refactoring or reconnecting
   the editor as part of cleanup.
3. Apply small, reviewable source/manifest/lockfile changes. Preserve unrelated
   uncommitted work and versions of retained dependencies.
4. Validate the earlier dependency removals as well as new changes in a separate
   test directory containing the current source and lockfile, without inheriting
   node_modules or build artifacts. Do not overwrite the working installation or
   copy real credentials. Install using the lockfile, then run production build,
   TypeScript and the test suite.
5. Treat installation/build failures as unresolved validation, distinguishing
   dependency/source failures from missing external access or configuration.
   Passing tests on the existing installation alone is insufficient to close
   dependency cleanup.
6. Report removed and retained items, test results and any unresolved limitations.
   No behavior changes or performance improvements are claimed solely from this
   cleanup. This session does not authorize deployment or unrelated file cleanup.

The interview frontier is empty for this bounded batch. No ADR is needed: these
are reversible cleanup choices, not a costly architectural commitment. No new
domain term was resolved, so CONTEXT.md remains unchanged.

Confirm this consolidated design with the user before additional implementation,
as required by the explicitly invoked grilling workflow.
