# 01: Restore Windows LaMa Runtime

**What to build:** A Windows translator can use the LaMa cleaning capability from the portable application without installing Python packages or receiving a silent cleaner substitution. The packaged runtime, model, and native dependencies are validated before the release is produced.

**Blocked by:** None (can start immediately)

**Status:** in-review

- [x] The Windows portable runtime build inputs retain PyTorch and all libraries required to load the bundled LaMa model.
- [ ] The packaged model loads through the production LaMa cleaner entry point. *(Blocked: local Next build cannot replace a locked `.next/standalone` file.)*
- [ ] A minimal deterministic inference succeeds using the staged runtime that will be shipped. *(Blocked by the same packaging build lock.)*
- [ ] Packaging fails with a clear diagnostic when the runtime, model, native library, or cleaner route is missing.
- [x] A missing packaged dependency is not silently converted into an AOT or Flat result for the release acceptance path.
- [ ] The existing AnimeLaMa option succeeds when selected from the Windows workspace.
- [ ] A release validation test covers the staged runtime rather than only module imports or source-tree dependencies.
