# 01: Desktop Environment Auto-Forwarding

**What to build:** When translators launch the SuperK Windows desktop application, the Electron shell automatically inspects the local directory for `.env.local` or `.env` files and loads all defined variables (notably `GEMINI_API_KEY`) into the child Next.js workspace server process. Users who already have their API keys in their environment files never see "Server missing API Key" errors or need to copy-paste keys into the settings dialog.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Electron workspace server supervisor parses `.env.local` and `.env` from the project root if present
- [ ] Variables defined in `.env.local` take precedence over `.env` and are merged into the child process environment
- [ ] Next.js standalone process receives `GEMINI_API_KEY` and any custom translation base URLs seamlessly on startup
- [ ] Unit test verifies environment extraction and forwarding without spawning actual child processes
