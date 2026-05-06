const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "DayZ-SP",
  scanForDayzServer: () => ipcRenderer.invoke("dayz:scan-server"),
  onDayzServerUpdated: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("dayz:server-updated", listener);

    return () => ipcRenderer.removeListener("dayz:server-updated", listener);
  }
});
