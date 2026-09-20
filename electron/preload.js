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
  isDesktop: true,
  pickExportDirectory() {
    return ipcRenderer.invoke("desktop:pick-export-directory");
  },
  saveExportFile(dirPath, filename, buffer) {
    return ipcRenderer.invoke("desktop:save-export-file", { dirPath, filename, buffer });
  },
  openExportDirectory(dirPath) {
    return ipcRenderer.invoke("desktop:open-export-directory", dirPath);
  },
  flushMemory() {
    return ipcRenderer.invoke("desktop:flush-memory");
  },
  getMemoryUsage() {
    return ipcRenderer.invoke("desktop:get-memory-usage");
  },
  getClosePreference() {
    return ipcRenderer.invoke("desktop:get-close-preference");
  },
  setClosePreference(preference) {
    return ipcRenderer.invoke("desktop:set-close-preference", preference);
  },
});

