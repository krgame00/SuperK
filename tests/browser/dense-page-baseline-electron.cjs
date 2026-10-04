// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, contentTracing } = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os');
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
app.commandLine.appendSwitch('disable-background-timer-throttling');
// This harness runs a hidden offscreen window. The local Electron GPU process
// may not start on headless/remote Windows sessions, so keep it on software
// raster and record that limitation in the result instead of aborting early.
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  console.log('Loading dense-page fixture');
  const window = new BrowserWindow({ show: false, width: 1800, height: 2600,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.on('console-message', event => console.log('Fixture:', event.message));
  try {
    if (process.env.DENSE_TRACE === '1') await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'blink.user_timing', 'v8', 'disabled-by-default-devtools.timeline'] });
    await window.loadURL(process.argv[2]);
    const result = await window.webContents.executeJavaScript('window.denseBaseline');
    result.hardware = { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramGB: os.totalmem() / 2 ** 30, platform: os.platform(), release: os.release(), versions: process.versions };
    result.gpu = await app.getGPUInfo('basic');
    fs.writeFileSync(process.env.DENSE_OUTPUT, JSON.stringify(result, null, 2));
    if (process.env.DENSE_TRACE === '1') await contentTracing.stopRecording(process.env.DENSE_OUTPUT.replace('.json', '-trace.json'));
    console.log('Baseline:', result.ok, result.rows?.length, 'scenes;', process.env.DENSE_OUTPUT);
    if (!result.ok) console.error(result);
    app.exit(result.ok ? 0 : 1);
  } catch (error) { console.error(error); app.exit(1); }
});
