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
  launchDayZ: (serverPath, map) => ipcRenderer.invoke("dayz:launch", serverPath, map),
  checkMapStorage: (map) => ipcRenderer.invoke("dayz:check-storage", map),
  checkCFWarning: (map) => ipcRenderer.invoke("dayz:check-cf-warning", map),
  deleteMapStorage: (map) => ipcRenderer.invoke("dayz:delete-storage", map),
  getSetting: (key) => ipcRenderer.invoke("dayz:get-setting", key),
  getAllSettings: () => ipcRenderer.invoke("dayz:get-all-settings"),
  saveSetting: (key, value) => ipcRenderer.invoke("dayz:save-setting", key, value),
  launchDayZLauncher: () => ipcRenderer.invoke("dayz:launch-launcher"),
  minimize: () => ipcRenderer.send("app:minimize"),
  close: () => ipcRenderer.send("app:close"),
  isServerRunning: () => ipcRenderer.invoke("dayz:is-server-running"),
  onProcessStatusUpdated: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("dayz:process-status", listener);
    return () => ipcRenderer.removeListener("dayz:process-status", listener);
  },
  scanPresets: () => ipcRenderer.invoke("dayz:scan-presets"),
  applyPreset: (filename) => ipcRenderer.invoke("dayz:apply-preset", filename),
  createPreset: (name) => ipcRenderer.invoke("dayz:create-preset", name),
  savePreset: (filename) => ipcRenderer.invoke("dayz:save-preset", filename),
  deletePreset: (filename) => ipcRenderer.invoke("dayz:delete-preset", filename),
  checkPresetDirty: (filename) => ipcRenderer.invoke("dayz:check-preset-dirty", filename),
  getVersion: () => ipcRenderer.invoke("dayz:get-version"),
  checkUpdate: () => ipcRenderer.invoke("dayz:check-update"),
  openExternal: (url) => ipcRenderer.invoke("dayz:open-external", url),
  openFolder: (folderPath) => ipcRenderer.invoke("dayz:open-folder", folderPath),
  openPresetsFolder: () => ipcRenderer.invoke("dayz:open-presets-folder"),
  pickFolder: () => ipcRenderer.invoke("dayz:pick-folder"),
  importLocalMod: (sourcePath) => ipcRenderer.invoke("dayz:import-local-mod", sourcePath),
  addLocalModPath: (modPath) => ipcRenderer.invoke("dayz:add-local-mod-path", modPath),
  removeLocalModPath: (sourcePath) => ipcRenderer.invoke("dayz:remove-local-mod-path", sourcePath),
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("dayz:update-available", listener);
    return () => ipcRenderer.removeListener("dayz:update-available", listener);
  },
  onPresetsUpdated: (callback) => {
    const listener = (_event, presets) => callback(presets);
    ipcRenderer.on("dayz:presets-updated", listener);
    return () => ipcRenderer.removeListener("dayz:presets-updated", listener);
  }
});
