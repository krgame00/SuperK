// Electron's test main process uses the CommonJS entry point.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1400, height: 1400,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.on('console-message', event => console.log('Fixture:', event.message));
  window.webContents.on('did-fail-load', (_event, code, description) => console.error('Fixture load:', code, description));
  try {
    console.log('Loading fixture');
    await window.loadURL(process.argv[2]);
    console.log('Fixture loaded');
    const result = await window.webContents.executeJavaScript('window.selectionCheck');
    console.log(JSON.stringify(result));
    app.exit(result?.ok ? 0 : 1);
  } catch (error) { console.error(error); app.exit(1); }
});
