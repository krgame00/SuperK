# 01: Electron Shell Bootstrap & Dev Launch

**What to build:** A translator can run `electron .` from the project root and see a dedicated desktop application window appear — no browser needed. Inside the window, the Next.js translation workspace loads over loopback. The Electron main process keeps the window alive independently of any browser session, and closing the window exits cleanly without leaving orphaned processes.

**Blocked by:** None (can start immediately)

**Status:** complete

- [x] An `electron/` directory exists with a minimal `main.js` that creates a `BrowserWindow` loading `http://127.0.0.1:3000`.
- [x] Running `electron .` while `npm run dev` is running in parallel opens the desktop window with the full translation workspace visible and functional.
- [x] The window title reads "SuperK — Manga Translator".
- [x] Window minimum size is enforced at 1024×700; default size is 1440×900.
- [x] Closing the window calls `app.quit()` and exits the Electron process without error.
- [x] `electron` and `electron-builder` are added to `devDependencies` in `package.json` with a `"desktop:dev"` script that runs `electron .`.
