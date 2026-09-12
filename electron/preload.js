const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("superkDesktop", {
  recoverCleaner() {
    return ipcRenderer.invoke("cleaner:recover");
  },
  onCleanerRecoveryStatus(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("cleaner:recovery-status", handler);
    return () => ipcRenderer.removeListener("cleaner:recovery-status", handler);
  },
  notify(payload) {
    ipcRenderer.send("desktop:notify", payload);
  },
});
