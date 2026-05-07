const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "DayZ-SP",
  scanForDayzServer: () => ipcRenderer.invoke("dayz:scan-server"),
  scanForDayzGame: () => ipcRenderer.invoke("dayz:scan-game"),
  onDayzServerUpdated: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("dayz:server-updated", listener);
    return () => ipcRenderer.removeListener("dayz:server-updated", listener);
  },
  onDayzGameUpdated: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("dayz:game-updated", listener);
    return () => ipcRenderer.removeListener("dayz:game-updated", listener);
  },
  scanForDayzMods: () => ipcRenderer.invoke("dayz:scan-mods"),
  toggleMod: (modName, enabled) => ipcRenderer.invoke("dayz:toggle-mod", modName, enabled),
  onDayzModsUpdated: (callback) => {
    const listener = (_event, mods) => callback(mods);
    ipcRenderer.on("dayz:mods-updated", listener);
    return () => ipcRenderer.removeListener("dayz:mods-updated", listener);
  },
  launchDayZ: (serverPath) => ipcRenderer.invoke("dayz:launch", serverPath),
  browseForDayZ: () => ipcRenderer.invoke("dayz:browse"),
  getSetting: (key) => ipcRenderer.invoke("dayz:get-setting", key),
  saveSetting: (key, value) => ipcRenderer.invoke("dayz:save-setting", key, value)
});
