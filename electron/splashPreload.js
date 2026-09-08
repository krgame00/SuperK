const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onStep(callback) {
    ipcRenderer.on("splash:step", (_event, step) => callback(step));
  },
  onError(callback) {
    ipcRenderer.on("splash:error", (_event, error) => callback(error));
  },
  retry() {
    ipcRenderer.send("splash:retry");
  },
});
