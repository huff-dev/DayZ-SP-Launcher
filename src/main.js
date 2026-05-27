const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const https = require("https");
const patcher = require("./scripts/Patcher/patcher");
const goldberg = require("./offline");

const APP_VERSION = app.getVersion();

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function checkForUpdates() {
  return new Promise((resolve) => {
    https.get("https://api.github.com/repos/huff-dev/DayZ-SP-Launcher/releases/latest", {
      headers: { "User-Agent": "DayZ-SP" }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const release = JSON.parse(data);
          const latestTag = (release.tag_name || "").replace(/^v/, "");
          if (!latestTag) return resolve({ available: false });
          const downloadUrl = release.assets?.[0]?.browser_download_url || release.html_url;
          resolve({ available: compareVersions(latestTag, APP_VERSION) > 0, version: latestTag, url: downloadUrl });
        } catch {
          resolve({ available: false });
        }
      });
    }).on("error", () => resolve({ available: false }));
  });
}

const DAYZ_SERVER_APP_ID = "223350";
const DAYZ_SERVER_NAME = "DayZ Server";
const DAYZ_GAME_APP_ID = "221100";
const DAYZ_GAME_NAME = "DayZ";

let dayzServerWatcher = null;
let dayzServerWatchPath = null;
let dayzServerWatchTimer = null;

let dayzGameWatcher = null;
let dayzGameWatchPath = null;
let dayzGameWatchTimer = null;

let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    setupPresetsWatcher();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

function unique(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getSteamCandidates() {
  const home = os.homedir();
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
    path.join(home, "AppData", "Local", "Steam"),
    path.join(home, "AppData", "Roaming", "Steam")
  ];

  return unique(candidates);
}

function getDefaultLibraries(steamPath) {
  return unique([steamPath, path.join(steamPath, "steamapps")]);
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseSteamLibraries(vdfText) {
  const libraries = [];
  const pathMatches = vdfText.matchAll(/"path"\s+"([^"]+)"/g);

  for (const match of pathMatches) {
    libraries.push(match[1].replace(/\\\\/g, "\\"));
  }

  return libraries;
}

function parseAppManifest(manifestText) {
  const appId = manifestText.match(/"appid"\s+"([^"]+)"/)?.[1] || null;
  const name = manifestText.match(/"name"\s+"([^"]+)"/)?.[1] || null;
  const installDir = manifestText.match(/"installdir"\s+"([^"]+)"/)?.[1] || null;

  return { appId, name, installDir };
}

async function findSteamLibraries(steamPath) {
  const libraryFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  const libraries = [steamPath];

  if (await pathExists(libraryFile)) {
    const libraryText = await fsp.readFile(libraryFile, "utf8");
    libraries.push(...parseSteamLibraries(libraryText));
  }

  return unique(libraries);
}

async function findAppInLibrary(libraryPath, appId, defaultName) {
  const steamAppsPath = libraryPath.endsWith("steamapps")
    ? libraryPath
    : path.join(libraryPath, "steamapps");
  const manifestPath = path.join(steamAppsPath, `appmanifest_${appId}.acf`);

  if (!(await pathExists(manifestPath))) {
    return null;
  }

  const manifest = parseAppManifest(await fsp.readFile(manifestPath, "utf8"));
  const installDir = manifest.installDir || defaultName;
  const installPath = path.join(steamAppsPath, "common", installDir);
  const installed = await pathExists(installPath);

  return {
    appId: manifest.appId || appId,
    name: manifest.name || defaultName,
    manifestPath,
    installPath,
    installed
  };
}

function broadcastUpdate(channel, result) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, result);
  }
}

async function buildUpdateResult(appInfo) {
  let hasFrostline = true;

  return {
    found: appInfo.installed,
    hasFrostline,
    installPath: appInfo.installPath
  };
}

async function scanForApp(appId, defaultName, type) {
  const steamPaths = getSteamCandidates();

  for (const steamPath of steamPaths) {
    if (!(await pathExists(steamPath))) {
      continue;
    }

    const libraries = unique([
      ...getDefaultLibraries(steamPath),
      ...(await findSteamLibraries(steamPath))
    ]);

    for (const libraryPath of libraries) {
      const appInfo = await findAppInLibrary(libraryPath, appId, defaultName);

      if (appInfo && appInfo.installed) {
        const result = await buildUpdateResult(appInfo);
        
        if (type === "server") {
          setupServerWatcher(appInfo);
        } else {
          setupGameWatcher(appInfo);
        }
        
        return result;
      }
    }
  }

  return {
    found: false
  };
}

function setupServerWatcher(appInfo) {
  if (!appInfo?.installed || dayzServerWatchPath === appInfo.installPath) return;
  
  if (dayzServerWatcher) dayzServerWatcher.close();
  dayzServerWatchPath = appInfo.installPath;
  
  dayzServerWatcher = fs.watch(appInfo.installPath, () => {
    clearTimeout(dayzServerWatchTimer);
    dayzServerWatchTimer = setTimeout(async () => {
      broadcastUpdate("dayz:server-updated", await buildUpdateResult(appInfo));
    }, 150);
  });
}

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
let settingsCache = null;
let settingsWriteQueue = Promise.resolve();

async function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    if (await pathExists(SETTINGS_FILE)) {
      const data = await fsp.readFile(SETTINGS_FILE, "utf8");
      settingsCache = JSON.parse(data);
      return settingsCache;
    }
  } catch (error) {
    console.error("Failed to read settings:", error);
  }
  settingsCache = {};
  return settingsCache;
}

function saveSettings() {
  settingsWriteQueue = settingsWriteQueue.then(async () => {
    try {
      await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settingsCache, null, 2));
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  });
  return settingsWriteQueue;
}

let dayzWorkshopWatcher = null;
let dayzWorkshopWatchTimer = null;
let lastModTimes = new Map();

const PRESETS_DIR = path.join(os.homedir(), "AppData", "Local", "DayZ Launcher", "Presets");
let dayzPresetsWatcher = null;
let dayzPresetsWatchTimer = null;

async function scanPresets() {
  try {
    if (!(await pathExists(PRESETS_DIR))) return [];

    const files = await fsp.readdir(PRESETS_DIR);
    const presetFiles = [];

    for (const file of files) {
      const fullPath = path.join(PRESETS_DIR, file);
      try {
        const stat = await fsp.stat(fullPath);
        if (!stat.isFile()) continue;

        let name;
        let isDefault = false;
        if (file.endsWith(".preset2")) {
          name = file.replace(/\.preset2$/, "");
        } else if (file.endsWith(".defaultpreset2")) {
          name = "DayZ (default)";
          isDefault = true;
        } else {
          continue;
        }

        presetFiles.push({ name, filename: file, mtime: stat.mtimeMs, isDefault });
      } catch { }
    }

    presetFiles.sort((a, b) => b.mtime - a.mtime);
    return presetFiles;
  } catch (error) {
    console.error("Failed to scan presets:", error);
    return [];
  }
}

function setupPresetsWatcher() {
  if (dayzPresetsWatcher) dayzPresetsWatcher.close();

  if (fs.existsSync(PRESETS_DIR)) {
    dayzPresetsWatcher = fs.watch(PRESETS_DIR, async (eventType, filename) => {
      if (filename && !filename.endsWith(".preset2")) return;
      clearTimeout(dayzPresetsWatchTimer);
      dayzPresetsWatchTimer = setTimeout(async () => {
        const presets = await scanPresets();
        broadcastUpdate("dayz:presets-updated", presets);
      }, 300);
    });
  }
}

ipcMain.handle("dayz:scan-presets", async () => {
  return await scanPresets();
});

let isServerRunning = false;
let isGameRunning = false;
let wasPatched = false;
let lastServerExePath = null;
let wasGoldbergApplied = false;
let goldbergGamePath = null;
let goldbergServerPath = null;
const SERVER_NAME_ARG = "-serverName=DayZ_SPL";

function killServer() {
  exec(`taskkill /IM DayZServer_x64.exe`, (err) => {
    if (err) {
      console.error("Failed to kill server:", err);
    } else {
      console.log("Server process terminated due to game exit.");
    }
  });
}

function checkProcesses() {
  
  exec(`wmic process where "name='DayZServer_x64.exe'" get commandline`, (error, stdout) => {
    const running = !error && stdout.includes(SERVER_NAME_ARG);
    if (running !== isServerRunning) {
      if (isServerRunning && !running && wasPatched && lastServerExePath) {
        console.log("Server stopped, restoring original executable...");
        patcher.restoreFile(lastServerExePath);
        wasPatched = false;
      }
      if (isServerRunning && !running && wasGoldbergApplied && goldbergServerPath && goldberg.hasGoldbergBackup(goldbergServerPath)) {
        console.log("Server stopped, restoring original server steam_api64.dll...");
        goldberg.removeGoldberg(null, goldbergServerPath);
      }
      isServerRunning = running;
      broadcastUpdate("dayz:process-status", { running: isServerRunning });
    }
  });

  
  exec(`wmic process where "name='DayZ_x64.exe' or name='DayZ_BE.exe'" get commandline`, (error, stdout) => {
    
    const running = !error && stdout.trim().length > 0 && (stdout.includes("DayZ_x64.exe") || stdout.includes("DayZ_BE.exe"));
    
    if (isGameRunning && !running) {
      
      console.log("DayZ Game exit detected.");
      if (isServerRunning) {
        killServer();
      }
      if (wasGoldbergApplied && goldbergGamePath) {
        console.log("Game exited, removing Goldberg emulator files...");
        goldberg.removeGoldberg(goldbergGamePath, goldbergServerPath);
        wasGoldbergApplied = false;
        goldbergGamePath = null;
        goldbergServerPath = null;
      }
    }
    
    isGameRunning = running;
  });
}


setInterval(checkProcesses, 2000);

ipcMain.handle("dayz:is-server-running", () => isServerRunning);

console.log(`Settings file path: ${SETTINGS_FILE}`);

async function scanWorkshopMods(gamePath) {
  
  
  const workshopPath = path.join(gamePath, "..", "..", "workshop", "content", DAYZ_GAME_APP_ID);
  
  if (!(await pathExists(workshopPath))) {
    console.warn(`Workshop directory not found: ${workshopPath}`);
    return [];
  }

  try {
    const settings = await getSettings();
    const lastSyncTimes = settings.lastSyncTimes || {}; 
    const enabledMods = settings.enabledMods || [];
    
    const files = await fsp.readdir(workshopPath, { withFileTypes: true });
    const mods = [];

    for (const f of files) {
      if (!f.isDirectory() && !f.isSymbolicLink()) continue;
      
      const modFolderPath = path.join(workshopPath, f.name);
      const metaPath = path.join(modFolderPath, "meta.cpp");
      
      if (!(await pathExists(metaPath))) continue;

      try {
        const metaContent = await fsp.readFile(metaPath, "utf8");
        const nameMatch = metaContent.match(/name\s*=\s*"([^"]+)"/);
        const idMatch = metaContent.match(/publishedid\s*=\s*(\d+)/i);
        
        if (!nameMatch) continue;
        
        const modName = nameMatch[1];
        const publishedId = idMatch ? idMatch[1] : null;
        const stat = await fsp.stat(modFolderPath);
        const sourceMtime = stat.mtimeMs;
        
        
        const lastSync = lastSyncTimes[f.name] || 0;
        const wasUpdated = sourceMtime > lastSync;
        
        mods.push({ 
          name: modName,
          publishedId,
          folderName: f.name, 
          fullPath: modFolderPath,
          mtime: sourceMtime,
          updated: wasUpdated
        });
        
        lastModTimes.set(modFolderPath, sourceMtime);
      } catch (e) {
        console.warn(`Failed to process mod in ${f.name}:`, e.message);
      }
    }

    return mods.map(m => ({
      name: m.name,
      publishedId: m.publishedId,
      folderName: m.folderName,
      enabled: enabledMods.some(em => em.folderName === m.folderName),
      updated: m.updated
    }));
  } catch (error) {
    console.error("Failed to scan workshop mods:", error);
    return [];
  }
}

function setupWorkshopWatcher(gamePath) {
  const workshopPath = path.join(gamePath, "..", "..", "workshop", "content", DAYZ_GAME_APP_ID);
  
  if (dayzWorkshopWatcher) {
    dayzWorkshopWatcher.close();
  }

  if (fs.existsSync(workshopPath)) {
    dayzWorkshopWatcher = fs.watch(workshopPath, () => {
      clearTimeout(dayzWorkshopWatchTimer);
      dayzWorkshopWatchTimer = setTimeout(async () => {
        const mods = await scanWorkshopMods(gamePath);
        broadcastUpdate("dayz:mods-updated", mods);
      }, 300);
    });
  }
}

function setupGameWatcher(appInfo) {
  if (!appInfo?.installed || dayzGameWatchPath === appInfo.installPath) return;
  
  console.log(`Setting up game watcher for: ${appInfo.installPath}`);
  if (dayzGameWatcher) dayzGameWatcher.close();
  dayzGameWatchPath = appInfo.installPath;
  
  dayzGameWatcher = fs.watch(appInfo.installPath, () => {
    clearTimeout(dayzGameWatchTimer);
    dayzGameWatchTimer = setTimeout(async () => {
      broadcastUpdate("dayz:game-updated", await buildUpdateResult(appInfo));
    }, 150);
  });

  
  setupWorkshopWatcher(appInfo.installPath);
}

async function scanForDayzServer() {
  return scanForApp(DAYZ_SERVER_APP_ID, DAYZ_SERVER_NAME, "server");
}

async function scanForDayzGame() {
  return scanForApp(DAYZ_GAME_APP_ID, DAYZ_GAME_NAME, "game");
}

ipcMain.handle("dayz:scan-mods", async () => {
  if (!dayzGameWatchPath) return [];
  return await scanWorkshopMods(dayzGameWatchPath);
});

ipcMain.handle("dayz:toggle-mod", async (_event, modFolder, enabled) => {
  const settings = await getSettings();
  let enabledMods = settings.enabledMods || []; 

  if (enabled) {
    if (!enabledMods.some(m => m.folderName === modFolder.folderName)) {
      enabledMods.push({ name: modFolder.name, folderName: modFolder.folderName });
    }
  } else {
    enabledMods = enabledMods.filter(m => m.folderName !== modFolder.folderName);
  }

    settings.enabledMods = enabledMods;
    await saveSettings();
    

    
    if (dayzGameWatchPath) {
      const mods = await scanWorkshopMods(dayzGameWatchPath);
      broadcastUpdate("dayz:mods-updated", mods);
    }
  });

ipcMain.handle("dayz:apply-preset", async (_event, filename) => {
  const presetPath = path.join(PRESETS_DIR, filename);
  if (!(await pathExists(presetPath))) return;

  try {
    const content = await fsp.readFile(presetPath, "utf8");
    const idRegex = /<id>steam:(\d+)<\/id>/g;
    const presetIds = [];
    let match;
    while ((match = idRegex.exec(content)) !== null) {
      presetIds.push(match[1]);
    }

    const settings = await getSettings();
    const mods = await scanWorkshopMods(dayzGameWatchPath);

    const newEnabledMods = mods
      .filter(mod => presetIds.includes(mod.publishedId))
      .map(mod => ({ name: mod.name, folderName: mod.folderName }));

    settings.enabledMods = newEnabledMods;
    await saveSettings();

    if (dayzGameWatchPath) {
      const updatedMods = await scanWorkshopMods(dayzGameWatchPath);
      broadcastUpdate("dayz:mods-updated", updatedMods);
    }
  } catch (error) {
    console.error("Failed to apply preset:", error);
  }
});

function formatPresetDate(date) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const y = date.getFullYear();
  const M = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padEnd(7, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${y}-${M}-${d}T${h}:${m}:${s}.${ms}${sign}${oh}:${om}`;
}

ipcMain.handle("dayz:create-preset", async (_event, presetName) => {
  const filename = `${presetName}.preset2`;
  const filePath = path.join(PRESETS_DIR, filename);
  try {
    const settings = await getSettings();
    const enabledMods = settings.enabledMods || [];

    let mods = [];
    if (dayzGameWatchPath) {
      mods = await scanWorkshopMods(dayzGameWatchPath);
    }

    const enabledFolderNames = new Set(enabledMods.map(m => m.folderName));

    const ids = mods
      .filter(m => enabledFolderNames.has(m.folderName) && m.publishedId)
      .map(m => m.publishedId);

    const now = formatPresetDate(new Date());
    const idXml = ids.map(id => `    <id>steam:${id}</id>`).join("\n");

    const content = `<?xml version="1.0" encoding="utf-8"?>
<addons-presets>
  <last-update>${now}</last-update>
  <published-ids>
${idXml}
  </published-ids>
</addons-presets>`;

    await fsp.writeFile(filePath, content, "utf8");
    return { success: true };
  } catch (error) {
    console.error("Failed to create preset:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dayz:save-preset", async (_event, filename) => {
  const filePath = path.join(PRESETS_DIR, filename);
  try {
    const settings = await getSettings();
    const enabledMods = settings.enabledMods || [];

    let mods = [];
    if (dayzGameWatchPath) {
      mods = await scanWorkshopMods(dayzGameWatchPath);
    }

    const enabledFolderNames = new Set(enabledMods.map(m => m.folderName));

    const ids = mods
      .filter(m => enabledFolderNames.has(m.folderName) && m.publishedId)
      .map(m => m.publishedId);

    const now = formatPresetDate(new Date());
    const idXml = ids.map(id => `    <id>steam:${id}</id>`).join("\n");

    const content = `<?xml version="1.0" encoding="utf-8"?>
<addons-presets>
  <last-update>${now}</last-update>
  <published-ids>
${idXml}
  </published-ids>
</addons-presets>`;

    await fsp.writeFile(filePath, content, "utf8");
    return { success: true };
  } catch (error) {
    console.error("Failed to save preset:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dayz:delete-preset", async (_event, filename) => {
  const filePath = path.join(PRESETS_DIR, filename);
  const deletedPath = filePath.replace(/\.preset2$/, ".deleted");
  try {
    await fsp.rename(filePath, deletedPath);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete preset:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dayz:check-preset-dirty", async (_event, filename) => {
  const filePath = path.join(PRESETS_DIR, filename);
  if (!(await pathExists(filePath))) return { dirty: false };

  try {
    const content = await fsp.readFile(filePath, "utf8");
    const idRegex = /<id>steam:(\d+)<\/id>/g;
    const presetIds = [];
    let match;
    while ((match = idRegex.exec(content)) !== null) {
      presetIds.push(match[1]);
    }

    const settings = await getSettings();
    const enabledMods = settings.enabledMods || [];

    let mods = [];
    if (dayzGameWatchPath) {
      mods = await scanWorkshopMods(dayzGameWatchPath);
    }

    const enabledFolderNames = new Set(enabledMods.map(m => m.folderName));
    const currentIds = mods
      .filter(m => enabledFolderNames.has(m.folderName) && m.publishedId)
      .map(m => m.publishedId);

    if (presetIds.length !== currentIds.length) return { dirty: true };

    const sortedPreset = [...presetIds].sort();
    const sortedCurrent = [...currentIds].sort();
    return { dirty: !sortedPreset.every((id, i) => id === sortedCurrent[i]) };
  } catch {
    return { dirty: false };
  }
});

ipcMain.handle("dayz:get-version", () => APP_VERSION);

ipcMain.handle("dayz:check-update", async () => {
  return await checkForUpdates();
});

ipcMain.handle("dayz:open-external", async (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle("dayz:scan-server", scanForDayzServer);
ipcMain.handle("dayz:scan-game", scanForDayzGame);

ipcMain.handle("dayz:get-setting", async (_event, key) => {
  const settings = await getSettings();
  return settings[key];
});

ipcMain.handle("dayz:get-all-settings", async () => {
  return await getSettings();
});

ipcMain.handle("dayz:save-setting", async (_event, key, value) => {
  const settings = await getSettings();
  settings[key] = value;
  await saveSettings();
});

const MAP_STORAGE_PATHS = {
  chernarus: "mpmissions/dayzOffline.chernarusplus/storage_1",
  livonia: "mpmissions/dayzOffline.enoch/storage_1",
  sakhal: "mpmissions/dayzOffline.sakhal/storage_1",
};

ipcMain.handle("dayz:check-storage", async (_event, map) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const relativePath = MAP_STORAGE_PATHS[map];
  if (!relativePath) return false;

  const fullPath = path.join(dayzServerWatchPath, relativePath);
  return await pathExists(fullPath);
});

ipcMain.handle("dayz:check-cf-folder", async (_event, map) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const relativePath = MAP_STORAGE_PATHS[map];
  if (!relativePath) return false;

  const fullPath = path.join(dayzServerWatchPath, relativePath, "communityframework");
  return await pathExists(fullPath);
});

ipcMain.handle("dayz:check-cf-warning", async (_event, map) => {
  const settings = await getSettings();
  const enabledMods = settings.enabledMods || [];
  const hasCF = enabledMods.some(mod => {
    const normalized = "@" + mod.name.replace(/\s+/g, '').replace(/^@/, '');
    return normalized === "@CF";
  });
  if (!hasCF) return false;

  const relativePath = MAP_STORAGE_PATHS[map];
  if (!relativePath) return false;

  const fullPath = path.join(dayzServerWatchPath, relativePath, "communityframework");
  return !(await pathExists(fullPath));
});

ipcMain.handle("dayz:delete-storage", async (_event, map) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const relativePath = MAP_STORAGE_PATHS[map];
  if (!relativePath) return false;

  const fullPath = path.join(dayzServerWatchPath, relativePath);
  try {
    if (await pathExists(fullPath)) {
      await fsp.rm(fullPath, { recursive: true, force: true });
      console.log(`Deleted storage for ${map} at ${fullPath}`);
    }
    return true;
  } catch (error) {
    console.error(`Failed to delete storage for ${map}:`, error);
    return false;
  }
});

async function generateServerConfig(dayzServerPath, map) {
  const templatePath = path.join(__dirname, "scripts", "DayzSPL.cfg");
  const destConfigPath = path.join(dayzServerPath, "DayzSPL.cfg");

  try {
    let configContent = await fsp.readFile(templatePath, "utf8");
    
    const missionTemplates = {
      chernarus: "dayzOffline.chernarusplus",
      livonia: "dayzOffline.enoch",
      sakhal: "dayzOffline.sakhal"
    };

    const selectedTemplate = missionTemplates[map] || missionTemplates.chernarus;
    
    
    configContent = configContent.replace(
      /template\s*=\s*"[^"]*";/,
      `template="${selectedTemplate}";`
    );

    await fsp.writeFile(destConfigPath, configContent);
    console.log(`Generated server config for ${map} at ${destConfigPath}`);
  } catch (error) {
    console.error("Failed to generate server config:", error);
    throw error;
  }
}

async function generateServerBatch(dayzServerPath, enabledMods) {
  const templatePath = path.join(__dirname, "scripts", "!DayzSPL.bat");
  const destBatchPath = path.join(dayzServerPath, "!DayzSPL.bat");
  const exePath = path.join(dayzServerPath, "DayZServer_x64.exe");

  try {
    let batchContent = await fsp.readFile(templatePath, "utf8");
    
    const formattedMods = enabledMods
      .map(mod => "@" + mod.name.replace(/\s+/g, '').replace(/^@/, ''))
      .join(";");

    
    batchContent = batchContent.replace(
      `set MOD_LIST=`,
      `set MOD_LIST=${formattedMods}`
    );

    
    batchContent = batchContent.replace(
      /"DayZServer_x64\.exe"/g,
      `"${exePath}"`
    );

    await fsp.writeFile(destBatchPath, batchContent);
    console.log(`Generated server batch with ${enabledMods.length} mods at ${destBatchPath}`);
  } catch (error) {
    console.error("Failed to generate server batch:", error);
    throw error;
  }
}

async function generateGameBatch(dayzGamePath, enabledMods) {
  const templatePath = path.join(__dirname, "scripts", "!Dayz.bat");
  const destBatchPath = path.join(dayzGamePath, "!Dayz.bat");

  try {
    let batchContent = await fsp.readFile(templatePath, "utf8");
    
    
    const formattedMods = enabledMods
      .map(mod => "@" + mod.name.replace(/\s+/g, '').replace(/^@/, ''))
      .join(";");

    
    batchContent = batchContent.replace(
      `-mod=`,
      `-mod=${formattedMods}`
    );

    await fsp.writeFile(destBatchPath, batchContent);
    console.log(`Generated game batch with ${enabledMods.length} mods at ${destBatchPath}`);
  } catch (error) {
    console.error("Failed to generate game batch:", error);
    throw error;
  }
}

async function applyQuickJoin(dayzServerPath, map, value) {
  const missionFolders = {
    chernarus: "dayzOffline.chernarusplus",
    livonia: "dayzOffline.enoch",
    sakhal: "dayzOffline.sakhal"
  };

  const folderName = missionFolders[map];
  if (!folderName) return;

  const globalsPath = path.join(dayzServerPath, "mpmissions", folderName, "db", "globals.xml");

  try {
    if (await pathExists(globalsPath)) {
      let content = await fsp.readFile(globalsPath, "utf8");
      
      
      content = content.replace(
        /(<var name="TimeLogin" type="0" value=")\d+("\/>)/,
        `$1${value}$2`
      );
      content = content.replace(
        /(<var name="TimeLogout" type="0" value=")\d+("\/>)/,
        `$1${value}$2`
      );

      await fsp.writeFile(globalsPath, content);
      console.log(`Applied Quick Join (${value}) settings to ${globalsPath}`);
    }
  } catch (error) {
    console.error(`Failed to apply Quick Join to ${globalsPath}:`, error);
  }
}

ipcMain.handle("dayz:launch", async (_event, dayzServerPath, map) => {
  const settings = await getSettings();
  const enabledMods = settings.enabledMods || []; 
  const lastSyncTimes = settings.lastSyncTimes || {};
  
  if (!dayzServerPath || !(await pathExists(dayzServerPath))) {
    return { success: false, message: "DayZ Server path not found" };
  }

  if (!dayzGameWatchPath || !(await pathExists(dayzGameWatchPath))) {
    return { success: false, message: "DayZ Game path not found" };
  }

  try {
    const profilesPath = path.join(dayzServerPath, "Profiles", "DayzSPL");
    if (await pathExists(profilesPath)) {
      const entries = await fsp.readdir(profilesPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(profilesPath, entry.name);
        if (entry.isFile()) {
          await fsp.rm(fullPath, { force: true });
        } else if (entry.isDirectory() && (entry.name === "DataCache" || entry.name === "Users" || entry.name === "BattlEye")) {
          await fsp.rm(fullPath, { recursive: true, force: true });
        }
      }
    }

    await generateServerConfig(dayzServerPath, map);
    await generateServerBatch(dayzServerPath, enabledMods);
    await generateGameBatch(dayzGameWatchPath, enabledMods);

    const timerValue = settings.quickJoin ? 0 : 15;
    await applyQuickJoin(dayzServerPath, map, timerValue);
  } catch (error) {
    return { success: false, message: `Failed to generate launch files: ${error.message}` };
  }

  
  const workshopPath = path.join(dayzGameWatchPath, "..", "..", "workshop", "content", DAYZ_GAME_APP_ID);
  const gameWorkshopDest = dayzGameWatchPath;
  
  if (!(await pathExists(workshopPath))) {
    return { success: false, message: "Workshop content directory not found" };
  }

  let syncedCount = 0;
  let skipped = 0;
  let errors = [];  
  
  for (const mod of enabledMods) {
    const sourcePath = path.join(workshopPath, mod.folderName);
    const destFolderName = "@" + mod.name.replace(/\s+/g, '').replace(/^@/, '');
    const destPathServer = path.join(dayzServerPath, destFolderName);
    const destPathGame = path.join(gameWorkshopDest, destFolderName);
    
    if (!(await pathExists(sourcePath))) {
      errors.push(`Mod folder not found: ${mod.folderName} (${mod.name})`);
      continue;
    }    

    try {
      const sourceStat = await fsp.stat(sourcePath);
      const sourceMtime = sourceStat.mtimeMs;
      const lastSync = lastSyncTimes[mod.folderName] || 0;
      
      const ensureCopy = async (source, dest) => {
        const exists = await pathExists(dest);
        if (!exists || sourceMtime > lastSync) {
          if (exists) {
            await fsp.rm(dest, { recursive: true, force: true });
          }
          await fsp.cp(source, dest, { recursive: true });
          return true;
        }
        return false;
      };

      const serverCopied = await ensureCopy(sourcePath, destPathServer);
      const gameCopied = await ensureCopy(sourcePath, destPathGame);
      
      const sourceKeysPath = path.join(sourcePath, "keys");
      const destKeysPath = path.join(dayzServerPath, "keys");
      let keysSynced = false;

      if (await pathExists(sourceKeysPath)) {
        if (!(await pathExists(destKeysPath))) {
          await fsp.mkdir(destKeysPath, { recursive: true });
        }
        
        if (sourceMtime > lastSync || serverCopied || gameCopied) {
          await fsp.cp(sourceKeysPath, destKeysPath, { recursive: true });
          keysSynced = true;
          console.log(`Synced keys for: ${mod.name}`);
        }
      }

      if (serverCopied || gameCopied || keysSynced) {
        syncedCount++;
        lastSyncTimes[mod.folderName] = sourceMtime;
      } else {
        skipped++;
      }
    } catch (error) {
      errors.push(`Failed to process ${mod.name}: ${error.message}`);
    }
  }  

  
  settings.lastSyncTimes = lastSyncTimes;
  await saveSettings();

  
  const serverExePath = path.join(dayzServerPath, "DayZServer_x64.exe");
  lastServerExePath = serverExePath;
  if (settings.disableBE) {
    console.log("Disable BE requested, patching server...");
    wasPatched = patcher.patchFile(serverExePath);
  } else {
    
    patcher.restoreFile(serverExePath);
    wasPatched = false;
  }

  
  if (settings.offlineMode) {
    console.log("Offline mode requested, applying Goldberg emulator...");
    wasGoldbergApplied = goldberg.applyGoldberg(dayzGameWatchPath, dayzServerPath);
    goldbergGamePath = wasGoldbergApplied ? dayzGameWatchPath : null;
    goldbergServerPath = wasGoldbergApplied ? dayzServerPath : null;
  } else {
    if (wasGoldbergApplied && goldbergGamePath) {
      goldberg.removeGoldberg(goldbergGamePath, goldbergServerPath);
      wasGoldbergApplied = false;
      goldbergGamePath = null;
      goldbergServerPath = null;
    }
  }

  
  try {
    const serverBatchPath = path.join(dayzServerPath, "!DayzSPL.bat");
    shell.openPath(serverBatchPath);
    
    const gameBatchPath = path.join(dayzGameWatchPath, "!Dayz.bat");
    shell.openPath(gameBatchPath);
  } catch (launchError) {
    errors.push(`Failed to execute batch files: ${launchError.message}`);
  }

  return {
    success: errors.length === 0,
    message: `Processed ${syncedCount} mod(s), ${skipped} already synced. Server starting...` + (errors.length > 0 ? `. Errors: ${errors.join(", ")}` : ""),
    errors
  };
});

ipcMain.handle("dayz:launch-launcher", async () => {
  if (!dayzGameWatchPath) {
    const gameResult = await scanForDayzGame();
    if (!gameResult.found) {
      return { success: false, message: "DayZ game not found" };
    }
  }
  const launcherPath = path.join(dayzGameWatchPath, "DayZLauncher.exe");
  if (!(await pathExists(launcherPath))) {
    return { success: false, message: "DayZLauncher.exe not found" };
  }
  exec(`start "" "${launcherPath}"`);
  return { success: true };
});

ipcMain.on("app:minimize", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on("app:close", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

app.on("before-quit", () => {
  if (dayzServerWatcher) dayzServerWatcher.close();
  if (dayzGameWatcher) dayzGameWatcher.close();
  if (dayzWorkshopWatcher) dayzWorkshopWatcher.close();
  if (dayzPresetsWatcher) dayzPresetsWatcher.close();
  if (wasGoldbergApplied && goldbergGamePath) {
    goldberg.removeGoldberg(goldbergGamePath, goldbergServerPath);
    wasGoldbergApplied = false;
    goldbergGamePath = null;
    goldbergServerPath = null;
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
    resizable: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // mainWindow.webContents.openDevTools({ mode: "detach" });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
