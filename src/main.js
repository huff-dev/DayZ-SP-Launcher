const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
  const { exec, execSync } = require("child_process");
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

let dayzSavesWatcher = null;
let dayzSavesWatchTimer = null;
let dayzUserSavesWatcher = null;
let dayzUserSavesWatchTimer = null;

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

  setupSavesWatcher();
  setupUserSavesWatcher();
  getSettings().then(settings => {
    const currentMap = settings.selectedMap || "chernarus";
    scanSaves(currentMap).then(saves => broadcastUpdate("dayz:saves-updated", saves));
  });
}

const MISSION_FOLDERS = {
  chernarus: "dayzOffline.chernarusplus",
  livonia: "dayzOffline.enoch",
  sakhal: "dayzOffline.sakhal",
};

async function resolveMissionFolder(map) {
  if (MISSION_FOLDERS[map]) return MISSION_FOLDERS[map];

  const settings = await getSettings();
  const envPath = settings.selectedMapEnv;
  if (envPath) return path.basename(envPath);

  return null;
}

function savesUserPath(missionFolder) {
  return path.join(app.getPath("userData"), "Saves", missionFolder);
}

async function scanSaves(map, missionFolder) {
  if (!missionFolder) {
    missionFolder = await resolveMissionFolder(map);
  }
  if (!missionFolder) return [];

  const savesPath = savesUserPath(missionFolder);
  if (!(await pathExists(savesPath))) {
    await fsp.mkdir(savesPath, { recursive: true });
  }

  const _settings = await getSettings();
  if (!_settings._migratedOldSaves && dayzServerWatchPath) {
    const mpmBasePath = path.join(dayzServerWatchPath, "mpmissions");
    if (await pathExists(mpmBasePath)) {
      const mpmFolders = await fsp.readdir(mpmBasePath, { withFileTypes: true });
      const knownMaps = new Set(Object.values(MISSION_FOLDERS));
      for (const mpmFolder of mpmFolders) {
        if (!mpmFolder.isDirectory) continue;
        const folderName = mpmFolder.name;
        if (folderName.startsWith("Backup")) continue;
        if (!knownMaps.has(folderName)) {
          const hasMapXml = await pathExists(path.join(mpmBasePath, folderName, "cfgenvironment.xml"));
          if (!hasMapXml) continue;
        }
        const mpmPath = path.join(mpmBasePath, folderName);
        const destSavesPath = savesUserPath(folderName);
        if (!(await pathExists(destSavesPath))) await fsp.mkdir(destSavesPath, { recursive: true });
        try {
          const entries = await fsp.readdir(mpmPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!entry.name.startsWith("storage_")) continue;
            const storagePath = path.join(mpmPath, entry.name);
            const destDir = path.join(destSavesPath, "Old");
            if (await pathExists(destDir)) {
              await fsp.rm(destDir, { recursive: true, force: true });
            }
            await fsp.mkdir(destDir, { recursive: true });
            const storageContents = await fsp.readdir(storagePath, { withFileTypes: true });
            for (const item of storageContents) {
              await fsp.rename(path.join(storagePath, item.name), path.join(destDir, item.name));
            }
            await fsp.rm(storagePath, { recursive: true, force: true });
            console.log(`Migrated contents of ${folderName}/${entry.name} -> Old`);
          }
        } catch (e) {
          console.error(`Failed to migrate ${folderName}:`, e.message);
        }
      }
    }
    _settings._migratedOldSaves = true;
    await saveSettings();
    console.log("Migration complete");
  }

  try {
    const entries = await fsp.readdir(savesPath, { withFileTypes: true });
    const saves = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const stat = await fsp.stat(path.join(savesPath, entry.name));
        saves.push({
          name: entry.name,
          date: stat.mtimeMs,
          path: path.join(savesPath, entry.name)
        });
      } catch {}
    }
    saves.sort((a, b) => b.date - a.date);
    return saves;
  } catch {
    return [];
  }
}

function setupSavesWatcher() {
  if (dayzSavesWatcher) dayzSavesWatcher.close();
  dayzSavesWatcher = null;

  if (!dayzServerWatchPath) return;

  const mpmissionsPath = path.join(dayzServerWatchPath, "mpmissions");
  if (!fs.existsSync(mpmissionsPath)) return;

  dayzSavesWatcher = fs.watch(mpmissionsPath, { recursive: true }, () => {
    clearTimeout(dayzSavesWatchTimer);
    dayzSavesWatchTimer = setTimeout(async () => {
      const settings = await getSettings();
      const currentMap = settings.selectedMap || "chernarus";
      const missionFolder = await resolveMissionFolder(currentMap);
      const savesDir = savesUserPath(missionFolder);
      if (!fs.existsSync(savesDir)) return;

      const files = fs.readdirSync(savesDir);
      if (files.some(f => f.startsWith("storage_1"))) {
        const saves = await scanSaves(currentMap);
        broadcastUpdate("dayz:saves-updated", saves);
      }
    }, 300);
  });
}

function setupUserSavesWatcher() {
  if (dayzUserSavesWatcher) dayzUserSavesWatcher.close();
  dayzUserSavesWatcher = null;

  if (!dayzServerWatchPath) return;

  getSettings().then(settings => {
    const map = settings.selectedMap || "chernarus";
    return resolveMissionFolder(map).then(missionFolder => {
      if (!missionFolder) return;
      const savesPath = savesUserPath(missionFolder);
      if (!fs.existsSync(savesPath)) fs.mkdirSync(savesPath, { recursive: true });

      dayzUserSavesWatcher = fs.watch(savesPath, { recursive: true }, () => {
        clearTimeout(dayzUserSavesWatchTimer);
        dayzUserSavesWatchTimer = setTimeout(async () => {
          const saves = await scanSaves(map);
          broadcastUpdate("dayz:saves-updated", saves);
        }, 300);
      });
    });
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
let dayzLocalWatchTimer = null;
const dayzLocalWatchers = new Map();
let lastModTimes = new Map();

const PRESETS_DIR = path.join(os.homedir(), "AppData", "Local", "DayZ Launcher", "Presets");
let dayzPresetsWatcher = null;
let dayzPresetsWatchTimer = null;

async function scanPresets() {
  try {
    const presetFiles = [];
    presetFiles.push({ name: "DayZ (default)", filename: "__vanilla__", isDefault: true, mtime: 0 });

    if (await pathExists(PRESETS_DIR)) {
      const files = await fsp.readdir(PRESETS_DIR);
      for (const file of files) {
        const fullPath = path.join(PRESETS_DIR, file);
        try {
          const stat = await fsp.stat(fullPath);
          if (!stat.isFile()) continue;

          if (file.endsWith(".preset2")) {
            const name = file.replace(/\.preset2$/, "");
            presetFiles.push({ name, filename: file, mtime: stat.mtimeMs, isDefault: false });
          }
        } catch { }
      }
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

  const notify = async () => {
    clearTimeout(dayzPresetsWatchTimer);
    dayzPresetsWatchTimer = setTimeout(async () => {
      const presets = await scanPresets();
      broadcastUpdate("dayz:presets-updated", presets);
    }, 300);
  };

  if (fs.existsSync(PRESETS_DIR)) {
    dayzPresetsWatcher = fs.watch(PRESETS_DIR, async (eventType, filename) => {
      if (filename && !filename.endsWith(".preset2")) return;
      notify();
    });
  }
}

ipcMain.handle("dayz:scan-presets", async () => {
  return await scanPresets();
});

ipcMain.handle("dayz:open-presets-folder", async () => {
  if (await pathExists(PRESETS_DIR)) {
    shell.openPath(PRESETS_DIR);
  }
});

let isServerRunning = false;
let isGameRunning = false;
let wasPatched = false;
let lastServerExePath = null;
let wasGoldbergApplied = false;
let goldbergGamePath = null;
let goldbergServerPath = null;
let activeSaveSlot = null;
let activeSaveMap = null;
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
      if (isServerRunning && !running && activeSaveSlot) {
        const savedMap = activeSaveMap;
        restoreActiveSave().then(async () => {
          const saves = await scanSaves(savedMap || "chernarus");
          broadcastUpdate("dayz:saves-updated", saves);
        });
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

ipcMain.handle("dayz:scan-saves", async (_event, map, missionFolder) => {
  return await scanSaves(map, missionFolder);
});

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
          updated: wasUpdated,
          mapEnvs: await getMapEnvs(modFolderPath)
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
      fullPath: m.fullPath,
      mtime: m.mtime,
      mapEnvs: m.mapEnvs,
      enabled: enabledMods.some(em => em.folderName === m.folderName),
      updated: m.updated
    }));
  } catch (error) {
    console.error("Failed to scan workshop mods:", error);
    return [];
  }
}

async function isLocalModFolder(folderPath) {
  const folderName = path.basename(folderPath);
  if (await pathExists(path.join(folderPath, "meta.cpp"))) return { hasMeta: true };
  if (!folderName.startsWith("@")) return null;
  const addonsPath = path.join(folderPath, "addons");
  if (!(await pathExists(addonsPath))) return null;
  try {
    const addonFiles = await fsp.readdir(addonsPath);
    if (!addonFiles.some(f => f.endsWith(".pbo"))) return null;
  } catch { return null; }
  return { hasMeta: false, name: folderName };
}

async function getMapEnvs(folderPath) {
  try {
    const results = [];
    await findFiles(folderPath, "cfgenvironment.xml", 5, results);
    return results.map(fullPath => path.relative(folderPath, path.dirname(fullPath)));
  } catch {
    return [];
  }
}

async function findFiles(dir, target, maxDepth, results) {
  if (maxDepth <= 0) return;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        await findFiles(fullPath, target, maxDepth - 1, results);
      } else if (e.isFile() && e.name.toLowerCase() === target.toLowerCase()) {
        results.push(fullPath);
      }
    }
  } catch {}
}

async function scanLocalMods() {
  try {
    const settings = await getSettings();
    const localPaths = settings.localModPaths || [];
    const enabledMods = settings.enabledMods || [];
    const mods = [];
    for (const parentPath of localPaths) {
      if (!(await pathExists(parentPath))) continue;
      const selfCheck = await isLocalModFolder(parentPath);
      if (selfCheck) {
        const stat = await fsp.stat(parentPath);
        let modName = path.basename(parentPath);
        if (selfCheck.hasMeta) {
          try {
            const metaContent = await fsp.readFile(path.join(parentPath, "meta.cpp"), "utf8");
            const nameMatch = metaContent.match(/name\s*=\s*"([^"]+)"/);
            if (nameMatch) modName = nameMatch[1];
          } catch {}
        } else {
          modName = selfCheck.name;
        }
        mods.push({
          name: modName,
          publishedId: null,
          folderName: path.basename(parentPath),
          fullPath: parentPath,
          mtime: stat.mtimeMs,
          updated: false,
          local: true,
          mapEnvs: await getMapEnvs(parentPath)
        });
        continue;
      }
      const files = await fsp.readdir(parentPath, { withFileTypes: true });
      for (const f of files) {
        if (!f.isDirectory()) continue;
        const modFolderPath = path.join(parentPath, f.name);
        const check = await isLocalModFolder(modFolderPath);
        if (!check) continue;
        const stat = await fsp.stat(modFolderPath);
        let modName = f.name;
        if (check.hasMeta) {
          try {
            const metaContent = await fsp.readFile(path.join(modFolderPath, "meta.cpp"), "utf8");
            const nameMatch = metaContent.match(/name\s*=\s*"([^"]+)"/);
            if (nameMatch) modName = nameMatch[1];
          } catch {}
        } else {
          modName = check.name;
        }
        mods.push({
          name: modName,
          publishedId: null,
          folderName: f.name,
          fullPath: modFolderPath,
          mtime: stat.mtimeMs,
          updated: false,
          local: true,
          mapEnvs: await getMapEnvs(modFolderPath)
        });
      }
    }
    return mods.map(m => ({
      ...m,
      enabled: enabledMods.some(em => em.folderName === m.folderName)
    }));
  } catch { return []; }
}

async function setupLocalModsWatcher() {
  for (const [, w] of dayzLocalWatchers) w.close();
  dayzLocalWatchers.clear();
  const settings = await getSettings();
  const paths = settings.localModPaths || [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const watcher = fs.watch(p, { recursive: false }, () => {
      clearTimeout(dayzLocalWatchTimer);
      dayzLocalWatchTimer = setTimeout(async () => {
        const [workshopMods, localMods] = await Promise.all([
          dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
          scanLocalMods()
        ]);
        broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
      }, 300);
    });
    dayzLocalWatchers.set(p, watcher);
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
        const [workshopMods, localMods] = await Promise.all([
          scanWorkshopMods(gamePath),
          scanLocalMods()
        ]);
        broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
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
  setupLocalModsWatcher();
}

async function scanForDayzServer() {
  return scanForApp(DAYZ_SERVER_APP_ID, DAYZ_SERVER_NAME, "server");
}

async function scanForDayzGame() {
  return scanForApp(DAYZ_GAME_APP_ID, DAYZ_GAME_NAME, "game");
}

ipcMain.handle("dayz:scan-mods", async () => {
  const [workshopMods, localMods] = await Promise.all([
    dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
    scanLocalMods()
  ]);
  return [...workshopMods, ...localMods];
});

ipcMain.handle("dayz:toggle-mod", async (_event, modFolder, enabled) => {
  const settings = await getSettings();
  let enabledMods = settings.enabledMods || []; 

  if (enabled) {
    if (!enabledMods.some(m => m.folderName === modFolder.folderName)) {
      enabledMods.push({ name: modFolder.name, folderName: modFolder.folderName, local: modFolder.local, fullPath: modFolder.fullPath });
    }
  } else {
    enabledMods = enabledMods.filter(m => m.folderName !== modFolder.folderName);
  }

    settings.enabledMods = enabledMods;
    await saveSettings();
    
    const [workshopMods, localMods] = await Promise.all([
      dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
      scanLocalMods()
    ]);
    broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
  });

async function generatePresetContent(enabledMods) {
  const [workshopMods, localMods] = await Promise.all([
    dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
    scanLocalMods()
  ]);

  const enabledFolderNames = new Set(enabledMods.map(m => m.folderName));

    const steamIds = workshopMods
      .filter(m => enabledFolderNames.has(m.folderName) && m.publishedId && m.publishedId !== "0")
      .map(m => m.publishedId);

  const localPaths = localMods
    .filter(m => enabledFolderNames.has(m.folderName))
    .map(m => m.fullPath);

  const now = formatPresetDate(new Date());
  const idXml = [
    ...steamIds.map(id => `    <id>steam:${id}</id>`),
    ...localPaths.map(p => `    <id>local:${p}</id>`)
  ].join("\n");

  const settings = await getSettings();
  const selectedMap = settings.selectedMap || "chernarus";
  const selectedMapEnv = settings.selectedMapEnv || "";
  const selectedMapEnvFolder = settings.selectedMapEnvFolder || "";
  const hasMapSettings = selectedMap === "custom";
  const mapXml = hasMapSettings ? `
  <map-settings>
    <selected-map>${selectedMap}</selected-map>${selectedMapEnv && selectedMapEnvFolder ? `
    <selected-env-folder>${selectedMapEnvFolder}</selected-env-folder>
    <selected-env-name>${selectedMapEnv}</selected-env-name>` : ""}
  </map-settings>` : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<addons-presets>
  <last-update>${now}</last-update>
  <published-ids>
${idXml}
  </published-ids>${mapXml}
</addons-presets>`;
}

ipcMain.handle("dayz:apply-preset", async (_event, filename) => {
  if (filename === "__vanilla__") {
    const settings = await getSettings();
    settings.enabledMods = [];
    delete settings.selectedMapEnv;
    delete settings.selectedMapEnvFolder;
    await saveSettings();
    const [updatedWorkshop, updatedLocal] = await Promise.all([
      dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
      scanLocalMods()
    ]);
    broadcastUpdate("dayz:mods-updated", [...updatedWorkshop, ...updatedLocal]);
    return { selectedMap: "chernarus", selectedMapEnv: "", mods: [] };
  }

  const presetPath = path.join(PRESETS_DIR, filename);
  if (!(await pathExists(presetPath))) return;

  try {
    const content = await fsp.readFile(presetPath, "utf8");
    const steamRegex = /<id>steam:(\d+)<\/id>/g;
    const localRegex = /<id>local:([^<]+)<\/id>/g;
    const presetSteamIds = [];
    const presetLocalPaths = [];
    let match;
    while ((match = steamRegex.exec(content)) !== null) {
      presetSteamIds.push(match[1]);
    }
    while ((match = localRegex.exec(content)) !== null) {
      presetLocalPaths.push(match[1]);
    }

    const mapMatch = content.match(/<selected-map>([^<]+)<\/selected-map>/);
    const envFolderMatch = content.match(/<selected-env-folder>([^<]+)<\/selected-env-folder>/);
    const envNameMatch = content.match(/<selected-env-name>([^<]+)<\/selected-env-name>/);
    const presetSelectedMap = mapMatch ? mapMatch[1] : null;
    const presetEnvFolder = envFolderMatch ? envFolderMatch[1] : null;
    const presetEnvName = envNameMatch ? envNameMatch[1] : null;

    const settings = await getSettings();
    const [workshopMods, localMods] = await Promise.all([
      dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
      scanLocalMods()
    ]);

    const workshopEnabled = workshopMods
      .filter(mod => mod.publishedId && mod.publishedId !== "0" && presetSteamIds.includes(mod.publishedId))
      .map(mod => ({ name: mod.name, folderName: mod.folderName, local: false, fullPath: null }));

    const localEnabled = localMods
      .filter(mod => presetLocalPaths.includes(mod.fullPath))
      .map(mod => ({ name: mod.name, folderName: mod.folderName, local: true, fullPath: mod.fullPath }));

    settings.enabledMods = [...workshopEnabled, ...localEnabled];
    if (presetSelectedMap) settings.selectedMap = presetSelectedMap;
    else delete settings.selectedMap;
    if (presetEnvFolder && presetEnvName) {
      settings.selectedMapEnvFolder = presetEnvFolder;
      settings.selectedMapEnv = presetEnvName;
    } else {
      delete settings.selectedMapEnvFolder;
      delete settings.selectedMapEnv;
    }
    await saveSettings();

    const [updatedWorkshop, updatedLocal] = await Promise.all([
      dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
      scanLocalMods()
    ]);
    broadcastUpdate("dayz:mods-updated", [...updatedWorkshop, ...updatedLocal]);
    return {
      selectedMap: presetSelectedMap || "chernarus",
      selectedMapEnv: presetEnvName || "",
      selectedMapEnvFolder: presetEnvFolder || "",
      mods: [...updatedWorkshop, ...updatedLocal]
    };
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
    const content = await generatePresetContent(settings.enabledMods || []);
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
    const content = await generatePresetContent(settings.enabledMods || []);
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
  if (filename === "__vanilla__") {
    const settings = await getSettings();
    return { dirty: (settings.enabledMods || []).length > 0 };
  }

  const filePath = path.join(PRESETS_DIR, filename);

  try {
    const content = await fsp.readFile(filePath, "utf8");
    const steamRegex = /<id>steam:(\d+)<\/id>/g;
    const localRegex = /<id>local:([^<]+)<\/id>/g;
    const presetSteamIds = [];
    const presetLocalPaths = [];
    let match;
    while ((match = steamRegex.exec(content)) !== null) {
      if (match[1] !== "0") presetSteamIds.push(match[1]);
    }
    while ((match = localRegex.exec(content)) !== null) {
      presetLocalPaths.push(match[1]);
    }

    const settings = await getSettings();
    const enabledMods = settings.enabledMods || [];

    const [workshopMods, localMods] = await Promise.all([
      dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
      scanLocalMods()
    ]);

    const enabledFolderNames = new Set(enabledMods.map(m => m.folderName));

    const currentSteamIds = workshopMods
      .filter(m => enabledFolderNames.has(m.folderName) && m.publishedId && m.publishedId !== "0")
      .map(m => m.publishedId);

    const currentLocalPaths = localMods
      .filter(m => enabledFolderNames.has(m.folderName))
      .map(m => m.fullPath);

    if (presetSteamIds.length !== currentSteamIds.length) return { dirty: true };
    const sortedPreset = [...presetSteamIds].sort();
    const sortedCurrent = [...currentSteamIds].sort();
    if (!sortedPreset.every((id, i) => id === sortedCurrent[i])) return { dirty: true };

    if (presetLocalPaths.length !== currentLocalPaths.length) return { dirty: true };
    const sortedPresetLocal = [...presetLocalPaths].sort();
    const sortedCurrentLocal = [...currentLocalPaths].sort();
    if (!sortedPresetLocal.every((p, i) => p === sortedCurrentLocal[i])) return { dirty: true };

    const mapMatch = content.match(/<selected-map>([^<]+)<\/selected-map>/);
    if (mapMatch) {
      const presetSelectedMap = mapMatch[1];
      if (presetSelectedMap !== (settings.selectedMap || "chernarus")) return { dirty: true };
    }

    return { dirty: false };
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

ipcMain.handle("dayz:pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dayz:open-folder", async (_event, folderPath) => {
  await shell.openPath(folderPath);
});

ipcMain.handle("dayz:import-local-mod", async (_event, sourcePath) => {
  try {
    const check = await isLocalModFolder(sourcePath);
    if (!check) {
      return { success: false, message: "Selected folder is not a valid DayZ mod (no meta.cpp or addons/*.pbo found)" };
    }

    if (dayzGameWatchPath) {
      const workshopContentPath = path.join(dayzGameWatchPath, "..", "..", "workshop", "content", DAYZ_GAME_APP_ID);
      const resolvedSource = path.resolve(sourcePath);
      const resolvedWorkshop = path.resolve(workshopContentPath);
      if (resolvedSource === resolvedWorkshop || resolvedSource.startsWith(resolvedWorkshop + path.sep)) {
        return { success: false, message: "Workshop mods are already loaded automatically" };
      }
    }

    const settings = await getSettings();
    if (!settings.localModPaths) settings.localModPaths = [];
    if (!settings.localModPaths.includes(sourcePath)) {
      settings.localModPaths.push(sourcePath);
      await saveSettings();
      await setupLocalModsWatcher();
      const [workshopMods, localMods] = await Promise.all([
        dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
        scanLocalMods()
      ]);
      broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("dayz:add-local-mod-path", async (_event, modPath) => {
  const settings = await getSettings();
  const paths = settings.localModPaths || [];
  if (!paths.includes(modPath)) {
    paths.push(modPath);
    settings.localModPaths = paths;
    await saveSettings();
  }
  await setupLocalModsWatcher();
  const [workshopMods, localMods] = await Promise.all([
    dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
    scanLocalMods()
  ]);
  broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
});

ipcMain.handle("dayz:remove-local-mod-path", async (_event, modPath) => {
  const settings = await getSettings();
  settings.localModPaths = (settings.localModPaths || []).filter(p => p !== modPath);
  await saveSettings();
  await setupLocalModsWatcher();
  const [workshopMods, localMods] = await Promise.all([
    dayzGameWatchPath ? scanWorkshopMods(dayzGameWatchPath) : [],
    scanLocalMods()
  ]);
  broadcastUpdate("dayz:mods-updated", [...workshopMods, ...localMods]);
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
  if (!relativePath) {
    const customPath = path.join("mpmissions", map, "storage_1");
    const fullPath = path.join(dayzServerWatchPath, customPath);
    return await pathExists(fullPath);
  }

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

ipcMain.handle("dayz:check-cf-warning", async (_event, map, slot) => {
  const settings = await getSettings();
  const enabledMods = settings.enabledMods || [];
  const hasCF = enabledMods.some(mod => {
    const normalized = "@" + mod.name.replace(/\s+/g, '').replace(/^@/, '');
    return normalized === "@CF";
  });
  if (!hasCF) return false;

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const saveDir = path.join(savesUserPath(missionFolder), slot || "Old");
  const paths = [
    path.join(saveDir, "communityframework"),
    path.join(saveDir, "storage_1", "communityframework")
  ];
  for (const p of paths) {
    if (await pathExists(p)) return false;
  }
  return true;
});

ipcMain.handle("dayz:check-save-content", async (_event, map, slot) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const savePath = path.join(savesUserPath(missionFolder), slot);
  try {
    if (!(await pathExists(savePath))) return false;
    const entries = await fsp.readdir(savePath);
    return entries.length > 0;
  } catch {
    return false;
  }
});

ipcMain.handle("dayz:get-save-stats", async (_event, map, slot) => {
  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return null;

  const dbPath = path.join(savesUserPath(missionFolder), slot, "players.db");
  try {
    if (!(await pathExists(dbPath))) return null;

    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readWrite: false });
    const rows = db.prepare("SELECT Data FROM Players").all();
    db.close();
    if (!rows || rows.length === 0) return null;

    const players = [];
    for (const row of rows) {
      const raw = row.Data;
      if (!raw || !(raw instanceof Uint8Array)) continue;
      const buf = Buffer.from(raw);
      let i = 0;

      const readFloat = () => { if (i + 4 > buf.length) return null; const v = buf.readFloatLE(i); i += 4; return v; };
      const readStr = () => {
        if (i >= buf.length) return null;
        const len = buf[i]; i++;
        if (i + len > buf.length) return null;
        const s = buf.toString("utf8", i, i + len).replace(/\0/g, ""); i += len;
        return s;
      };

      while (i < buf.length - 6) {
        const peek = buf[i];
        if (peek > 0 && peek < 60 && i + peek + 5 < buf.length) {
          const s = buf.toString("utf8", i + 1, i + 1 + peek);
          if (/^[a-z_]+$/.test(s) && s.length > 2) break;
        }
        i++;
      }

      const known = ["dist","players_killed","infected_killed","playtime","longest_survivor_hit","survivor_killed","infected_killed_headshot","meters_traveled","feet_traveled","shots_fired","shots_hit","mdf_immunityboost_state","mdf_mask_state","mdf_wetness_state","sfl_objects_searched","mdf_heatbuffer_state","mdf_common_cold_state"];
      const stats = {};

      while (i < buf.length - 6) {
        const key = readStr();
        if (!key || key.length < 2) break;
        const val = readFloat();
        if (val === null) break;
        const name = key.replace(/\0/g, "");
        if (known.includes(name) || /^[a-z_]+$/.test(name)) {
          stats[name] = Math.round(val * 100) / 100;
        }
        if (buf[i] > 60 || buf[i] === 0) break;
      }

      if (Object.keys(stats).length > 0) {
        if (stats.playtime) {
          const h = Math.floor(stats.playtime / 3600);
          const m = Math.floor((stats.playtime % 3600) / 60);
          stats.playtime = h + "h " + m + "m";
        }
        if (stats.dist) stats.dist = Math.round(stats.dist) + "m";

        // Read player model from header
        let model = "";
        for (let j = 0; j < 80; j++) {
          const p = buf[j];
          if (p > 0 && p < 30 && j + p + 4 < buf.length) {
            const s = buf.toString("utf8", j + 1, j + 1 + p).replace(/[^\x20-\x7E]/g, "");
            if (s.includes("Survivor")) { model = s; break; }
          }
        }
        if (model) stats.player_model = model;

        // Read 170-byte health blob
        while (i < buf.length - 174) {
          const size = buf.readInt32LE(i);
          if (size >= 100 && size <= 200 && i + 4 + size <= buf.length) {
            i += 4;
            const block = buf.slice(i, i + size);
            stats.blood = block[33];
            stats.health = block.readInt16LE(106);
            stats.hunger = block.readInt32LE(127);
            stats.hydration = block.readInt32LE(132);
            stats.bleeding = block[153];
            break;
          }
          i++;
        }

        // Read inventory items (best effort - just extract names)
        const items = [];
        const seen = new Set();
        while (i < buf.length - 6) {
          const p = buf[i];
          if (p > 0 && p < 60 && i + p + 6 < buf.length) {
            const s = buf.toString("utf8", i + 1, i + 1 + p).replace(/\0/g, "");
            if (/^[A-Z][a-zA-Z0-9_]+$/.test(s) && s.length > 3 && !seen.has(s)) {
              seen.add(s);
              items.push(s);
              i += 1 + p + 20;
              continue;
            }
          }
          i++;
        }
        if (items.length > 0) stats.inventory = items;

        players.push(stats);
      }
    }
    return players.length > 0 ? players : null;
  } catch {
    return null;
  }
});

let statsWindow = null;

function refreshStatsContent(win, data) {
  let html = "<div style='padding:12px 16px;font-family:Consolas,monospace;font-size:12px;color:#edeae1;background:#0c0c0c;height:100vh;overflow-y:hidden;box-sizing:border-box'>";
  for (const player of data) {
    html += "<div style='background:rgba(255,255,255,0.03);border-radius:6px;padding:10px 12px;margin-bottom:10px'>";
    html += "<div style='font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(180,200,120,0.7);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(180,200,120,0.12)'>Player Stats</div>";
    for (const [k, v] of Object.entries(player)) {
      if (typeof v !== "object") {
        html += "<div style='display:flex;justify-content:space-between;padding:2px 0'><span style='color:rgba(237,234,225,0.4);font-size:11px'>" + k.replace(/_/g, ' ') + "</span><span style='color:rgba(237,234,225,0.85);font-size:11px'>" + v + "</span></div>";
      }
    }
    html += "</div>";
    for (const [k, v] of Object.entries(player)) {
      if (Array.isArray(v) && v.length > 0) {
        html += "<div style='background:rgba(255,255,255,0.03);border-radius:6px;padding:10px 12px;margin-bottom:10px'>";
        html += "<div style='font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(237,234,225,0.45);margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(237,234,225,0.06)'>" + k + " <span style='color:rgba(237,234,225,0.25)'>(" + v.length + ")</span></div>";
        html += "<div style='max-height:200px;overflow-y:auto;scrollbar-width:none'>";
        for (const item of v) {
          const name = typeof item === "string" ? item : (item.name || item.item || "-");
          html += "<div style='padding:1px 0 1px 4px;font-size:11px;color:rgba(237,234,225,0.5)'>" + name + "</div>";
        }
        html += "</div></div>";
      }
    }
  }
  html += "</div>";
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent("<html><body style='margin:0;background:#0c0c0c;overflow:hidden'>" + html + "</body></html>"));
}

ipcMain.handle("dayz:open-stats-window", async (_event, slot, statsJson) => {
  if (statsWindow && !statsWindow.isDestroyed()) {
    const data = JSON.parse(statsJson);
    statsWindow.setTitle(slot + " - Save Stats");
    refreshStatsContent(statsWindow, data);
    return;
  }
  statsWindow = new BrowserWindow({
    width: 400, height: 650, resizable: true,
    autoHideMenuBar: true,
    title: slot + " - Save Stats",
    icon: path.join(__dirname, "images", "icon_rounded.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  statsWindow.on("closed", () => { statsWindow = null; });
  const data = JSON.parse(statsJson);
  refreshStatsContent(statsWindow, data);
  // statsWindow.webContents.openDevTools({ mode: "detach" });
});

ipcMain.handle("dayz:delete-storage", async (_event, map, slot) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const storagePath = path.join(dayzServerWatchPath, "mpmissions", missionFolder, `storage_${slot || "1"}`);
  try {
    if (await pathExists(storagePath)) {
      await fsp.rm(storagePath, { recursive: true, force: true });
      console.log(`Deleted ${storagePath}`);
    }
    return true;
  } catch (error) {
    console.error(`Failed to delete storage for ${map}/${slot}:`, error);
    return false;
  }
});

async function restoreActiveSave() {
  if (!activeSaveSlot || !activeSaveMap || !dayzServerWatchPath) return;
  const missionFolder = await resolveMissionFolder(activeSaveMap);
  if (!missionFolder) return;
  const storage1Mp = path.join(dayzServerWatchPath, "mpmissions", missionFolder, "storage_1");
  try {
    if (await pathExists(storage1Mp)) {
      const stat = await fsp.lstat(storage1Mp);
      if (stat.isSymbolicLink()) {
        await fsp.unlink(storage1Mp);
      } else {
        await fsp.rm(storage1Mp, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.error("Failed to remove server storage symlink:", error);
  }
  activeSaveSlot = null;
  activeSaveMap = null;
}

ipcMain.handle("dayz:activate-save-slot", async (_event, map, slot) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const userSavePath = path.join(savesUserPath(missionFolder), slot);
  const storage1Path = path.join(dayzServerWatchPath, "mpmissions", missionFolder, "storage_1");
  try {
    if (!(await pathExists(userSavePath))) return false;
    if (await pathExists(storage1Path)) {
      const stat = await fsp.lstat(storage1Path);
      if (stat.isSymbolicLink()) {
        await fsp.unlink(storage1Path);
      } else {
        await fsp.rm(storage1Path, { recursive: true, force: true });
      }
    }
    try {
      await fsp.symlink(userSavePath, storage1Path, 'junction');
    } catch (linkErr) {
      console.error("symlink failed, trying mklink:", linkErr.message);
      execSync(`mklink /J "${storage1Path}" "${userSavePath}"`, { shell: "cmd" });
    }
    activeSaveSlot = slot;
    activeSaveMap = map;
    return true;
  } catch (error) {
    console.error("Failed to activate save slot:", error);
    return false;
  }
});

ipcMain.handle("dayz:delete-save-slot", async (_event, map, slot) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const savePath = path.join(savesUserPath(missionFolder), slot);
  try {
    if (await pathExists(savePath)) {
      await fsp.rm(savePath, { recursive: true, force: true });
      broadcastUpdate("dayz:saves-updated", await scanSaves(map));
    }
    return true;
  } catch (error) {
    console.error(`Failed to delete save slot ${slot} for ${map}:`, error);
    return false;
  }
});

ipcMain.handle("dayz:create-save-slot", async (_event, map, slot) => {
  if (!dayzServerWatchPath) {
    const serverResult = await scanForDayzServer();
    if (!serverResult.found) return false;
  }

  const missionFolder = await resolveMissionFolder(map);
  if (!missionFolder) return false;

  const savePath = path.join(savesUserPath(missionFolder), slot);
  try {
    if (await pathExists(savePath)) return "exists";
    await fsp.mkdir(savePath, { recursive: true });
    broadcastUpdate("dayz:saves-updated", await scanSaves(map));
    return "ok";
  } catch (error) {
    console.error(`Failed to create save slot ${slot} for ${map}:`, error);
    return "error";
  }
});

async function generateServerConfig(dayzServerPath, map, envFolder) {
  const userTemplatePath = path.join(getTemplatesUserDir(), "DayzSPL.cfg");
  const srcTemplatePath = path.join(__dirname, "scripts", "DayzSPL.cfg");
  const templatePath = (await pathExists(userTemplatePath)) ? userTemplatePath : srcTemplatePath;
  const destConfigPath = path.join(dayzServerPath, "DayzSPL.cfg");

  try {
    let configContent = await fsp.readFile(templatePath, "utf8");
    
    const missionTemplates = {
      chernarus: "dayzOffline.chernarusplus",
      livonia: "dayzOffline.enoch",
      sakhal: "dayzOffline.sakhal"
    };

    const selectedTemplate = envFolder ? path.basename(envFolder) : (missionTemplates[map] || missionTemplates.chernarus);
    
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
  const userBatchPath = path.join(getTemplatesUserDir(), "!DayzSPL.bat");
  const srcBatchPath = path.join(__dirname, "scripts", "!DayzSPL.bat");
  const templatePath = (await pathExists(userBatchPath)) ? userBatchPath : srcBatchPath;
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
  const userBatchPath = path.join(getTemplatesUserDir(), "!Dayz.bat");
  const srcBatchPath = path.join(__dirname, "scripts", "!Dayz.bat");
  const templatePath = (await pathExists(userBatchPath)) ? userBatchPath : srcBatchPath;
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

async function applyQuickJoin(dayzServerPath, map, value, envFolder, noZombies) {
  const missionFolders = {
    chernarus: "dayzOffline.chernarusplus",
    livonia: "dayzOffline.enoch",
    sakhal: "dayzOffline.sakhal"
  };

  const folderName = envFolder ? path.basename(envFolder) : missionFolders[map];
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

      const zombieValue = noZombies ? "0" : "1000";
      content = content.replace(
        /(<var name="ZombieMaxCount" type="0" value=")\d+("\/>)/,
        `$1${zombieValue}$2`
      );

      await fsp.writeFile(globalsPath, content);
      console.log(`Applied Quick Join (${value}) settings to ${globalsPath}`);
      console.log(`Set ZombieMaxCount to ${zombieValue}`);
    }
  } catch (error) {
    console.error(`Failed to apply Quick Join to ${globalsPath}:`, error);
  }
}

ipcMain.handle("dayz:launch", async (_event, dayzServerPath, map, bypass) => {
  const settings = await getSettings();
  const enabledMods = bypass ? [] : (settings.enabledMods || []);
  const lastSyncTimes = settings.lastSyncTimes || {};
  
  if (!dayzServerPath || !(await pathExists(dayzServerPath))) {
    return { success: false, message: "DayZ Server path not found" };
  }

  if (!dayzGameWatchPath || !(await pathExists(dayzGameWatchPath))) {
    return { success: false, message: "DayZ Game path not found" };
  }

  // Scan all mods once - used for env detection and mod copy
  const workshopPath = path.join(dayzGameWatchPath, "..", "..", "workshop", "content", DAYZ_GAME_APP_ID);
  if (!(await pathExists(workshopPath))) {
    return { success: false, message: "Workshop content directory not found" };
  }
  let modsByFolder = new Map();
  let allWorkshopMods = [], allLocalMods = [];
  if (!bypass) {
    const mods = await Promise.all([
      scanWorkshopMods(dayzGameWatchPath),
      scanLocalMods()
    ]);
    allWorkshopMods = mods[0];
    allLocalMods = mods[1];
    for (const m of [...allWorkshopMods, ...allLocalMods]) {
      modsByFolder.set(m.folderName, m);
    }
  }

  // Determine custom map env folder and source mod
  let customEnvFolder = "";
  let customEnvModFolder = "";
  if (map === "custom" && !bypass) {
    const selectedEnv = settings.selectedMapEnv || "";
    const selectedEnvFolder = settings.selectedMapEnvFolder || "";
    if (selectedEnv && selectedEnvFolder && enabledMods.some(em => em.folderName === selectedEnvFolder)) {
      customEnvFolder = selectedEnv;
      customEnvModFolder = selectedEnvFolder;
    } else {
      // Single-env map mod: find first enabled mod with mapEnvs
      for (const [, m] of modsByFolder) {
        if (m.mapEnvs && m.mapEnvs.length > 0 && enabledMods.some(em => em.folderName === m.folderName)) {
          customEnvFolder = m.mapEnvs[0];
          customEnvModFolder = m.folderName;
          break;
        }
      }
    }
  }


  try {
    const serverBatchPath = path.join(getTemplatesUserDir(), "!DayzSPL.bat");
    const srcBatchPath = path.join(__dirname, "scripts", "!DayzSPL.bat");
    const batchPath = (await pathExists(serverBatchPath)) ? serverBatchPath : srcBatchPath;
    let profilesFolder = "Profiles\\DayzSPL";
    try {
      const batchContent = await fsp.readFile(batchPath, "utf8");
      const match = batchContent.match(/set\s+PROFILES_FOLDER\s*=\s*(.+)/);
      if (match) profilesFolder = match[1].trim();
    } catch {}
    const profilesPath = path.join(dayzServerPath, profilesFolder);
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

    if (bypass) {
      // In bypass mode, just copy templates as-is without any modifications
      const cfgSrc = (await pathExists(path.join(getTemplatesUserDir(), "DayzSPL.cfg")))
        ? path.join(getTemplatesUserDir(), "DayzSPL.cfg")
        : path.join(__dirname, "scripts", "DayzSPL.cfg");
      await fsp.copyFile(cfgSrc, path.join(dayzServerPath, "DayzSPL.cfg"));
      const batSrc = (await pathExists(path.join(getTemplatesUserDir(), "!DayzSPL.bat")))
        ? path.join(getTemplatesUserDir(), "!DayzSPL.bat")
        : path.join(__dirname, "scripts", "!DayzSPL.bat");
      let batContent = await fsp.readFile(batSrc, "utf8");
      batContent = batContent.replace(/"DayZServer_x64\.exe"/g, `"${path.join(dayzServerPath, "DayZServer_x64.exe")}"`);
      await fsp.writeFile(path.join(dayzServerPath, "!DayzSPL.bat"), batContent);
      const gameBatSrc = (await pathExists(path.join(getTemplatesUserDir(), "!Dayz.bat")))
        ? path.join(getTemplatesUserDir(), "!Dayz.bat")
        : path.join(__dirname, "scripts", "!Dayz.bat");
      await fsp.copyFile(gameBatSrc, path.join(dayzGameWatchPath, "!Dayz.bat"));
    } else {
      await generateServerConfig(dayzServerPath, map, customEnvFolder);
      await generateServerBatch(dayzServerPath, enabledMods);
      await generateGameBatch(dayzGameWatchPath, enabledMods);
    }
  } catch (error) {
    return { success: false, message: `Failed to generate launch files: ${error.message}` };
  }

  
  const gameWorkshopDest = dayzGameWatchPath;

  let syncedCount = 0;
  let skipped = 0;
  let errors = [];

  for (const enabledMod of enabledMods) {
    const fullInfo = modsByFolder.get(enabledMod.folderName) || enabledMod;
    const sourcePath = fullInfo.local ? fullInfo.fullPath : path.join(workshopPath, fullInfo.folderName);
    const destFolderName = "@" + fullInfo.name.replace(/\s+/g, '').replace(/^@/, '');
    const destPathServer = path.join(dayzServerPath, destFolderName);
    const destPathGame = path.join(gameWorkshopDest, destFolderName);
    
    if (!(await pathExists(sourcePath))) {
      errors.push(`Mod folder not found: ${fullInfo.folderName} (${fullInfo.name})`);
      continue;
    }    

    try {
      const sourceStat = await fsp.stat(sourcePath);
      const sourceMtime = sourceStat.mtimeMs;
      const lastSync = lastSyncTimes[fullInfo.folderName] || 0;
      
      const ensureLink = async (source, dest) => {
        const exists = await pathExists(dest);
        if (exists) {
          const stat = await fsp.lstat(dest);
          if (stat.isSymbolicLink()) {
            const target = await fsp.readlink(dest);
            if (target === source) return false;
          }
          await fsp.rm(dest, { recursive: true, force: true });
        }
        try {
          await fsp.symlink(source, dest, 'junction');
        } catch {
          execSync(`mklink /J "${dest}" "${source}"`, { shell: "cmd" });
        }
        return true;
      };

      const serverCopied = await ensureLink(sourcePath, destPathServer);
      const gameCopied = await ensureLink(sourcePath, destPathGame);
      
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
          console.log(`Synced keys for: ${fullInfo.name}`);
        }
      }

      if (serverCopied || gameCopied || keysSynced) {
        syncedCount++;
        lastSyncTimes[fullInfo.folderName] = sourceMtime;
      } else {
        skipped++;
      }
    } catch (error) {
      errors.push(`Failed to process ${fullInfo.name}: ${error.message}`);
    }
  }  

  
  if (!bypass) {
    settings.lastSyncTimes = lastSyncTimes;
    await saveSettings();
  }

  // Copy map env folder to mpmissions for custom maps
  if (customEnvFolder && customEnvModFolder) {
    const modInfo = modsByFolder.get(customEnvModFolder);
    if (modInfo) {
      const modSourcePath = modInfo.local ? modInfo.fullPath : path.join(workshopPath, modInfo.folderName);
      const envSourcePath = path.join(modSourcePath, customEnvFolder);
      const envDestName = path.basename(customEnvFolder);
      const envDestPath = path.join(dayzServerPath, "mpmissions", envDestName);
      if (await pathExists(envSourcePath)) {
        if (await pathExists(envDestPath)) {
          await fsp.rm(envDestPath, { recursive: true, force: true });
        }
        await fsp.cp(envSourcePath, envDestPath, { recursive: true });
        console.log(`Copied map env "${envDestName}" to mpmissions`);
      } else {
        errors.push(`Map environment folder not found: ${envSourcePath}`);
      }
    }
  }

  const timerValue = settings.quickJoin ? 0 : 15;
  if (bypass) {
    // Read map from the .cfg file in bypass mode
    const cfgPath = path.join(dayzServerPath, "DayzSPL.cfg");
    let cfgMap = "";
    try {
      const cfgContent = await fsp.readFile(cfgPath, "utf8");
      const match = cfgContent.match(/template\s*=\s*"([^"]+)"/);
      if (match) cfgMap = match[1];
    } catch {}
    await applyQuickJoin(dayzServerPath, "chernarus", timerValue, cfgMap, !!settings.noZombies);
  } else {
    await applyQuickJoin(dayzServerPath, map, timerValue, customEnvFolder, !!settings.noZombies);
  }

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
    const gameBatchPath = path.join(dayzGameWatchPath, "!Dayz.bat");
    shell.openPath(serverBatchPath);
    shell.openPath(gameBatchPath);
  } catch (launchError) {
    errors.push(`Failed to execute batch files: ${launchError.message}`);
  }

  return {
    success: errors.length === 0,
    message: `Processed ${syncedCount} mod(s), ${skipped} already synced.` + (errors.length > 0 ? `. Errors: ${errors.join(", ")}` : ""),
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

const TEMPLATE_NAMES = ["DayzSPL.cfg", "!DayzSPL.bat", "!Dayz.bat"];
function getTemplatesUserDir() {
  return path.join(app.getPath("userData"), "templates");
}
function getTemplatesSrcDir() {
  return path.join(__dirname, "scripts");
}

ipcMain.handle("tpl:init", async () => {
  const userDir = getTemplatesUserDir();
  const srcDir = getTemplatesSrcDir();
  try {
    await fsp.mkdir(userDir, { recursive: true });
    for (const name of TEMPLATE_NAMES) {
      const dest = path.join(userDir, name);
      try {
        await fsp.access(dest);
      } catch {
        await fsp.copyFile(path.join(srcDir, name), dest);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("tpl:read", async (_event, filename) => {
  const userPath = path.join(getTemplatesUserDir(), filename);
  try {
    const content = await fsp.readFile(userPath, "utf8");
    return { success: true, content };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("tpl:save", async (_event, filename, content) => {
  const userPath = path.join(getTemplatesUserDir(), filename);
  try {
    await fsp.writeFile(userPath, content, "utf8");
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("tpl:restore-defaults", async (_event, filename) => {
  const srcDir = getTemplatesSrcDir();
  const userDir = getTemplatesUserDir();
  try {
    await fsp.copyFile(path.join(srcDir, filename), path.join(userDir, filename));
    const content = await fsp.readFile(path.join(userDir, filename), "utf8");
    return { success: true, content };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("tpl:read-original", async (_event, filename) => {
  const srcPath = path.join(getTemplatesSrcDir(), filename);
  try {
    const content = await fsp.readFile(srcPath, "utf8");
    return { success: true, content };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("dayz:read-cfg-map", async (_event, dayzServerPath) => {
  try {
    const cfgPath = path.join(dayzServerPath, "DayzSPL.cfg");
    const content = await fsp.readFile(cfgPath, "utf8");
    const match = content.match(/template\s*=\s*"([^"]+)"/);
    return { success: true, map: match ? match[1] : "" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("dayz:delete-server-storage", async (_event, dayzServerPath, missionFolder) => {
  if (!dayzServerPath || !missionFolder) return false;
  const storagePath = path.join(dayzServerPath, "mpmissions", missionFolder, "storage_1");
  try {
    if (await pathExists(storagePath)) {
      await fsp.rm(storagePath, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
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
  if (activeSaveSlot && dayzServerWatchPath) {
    resolveMissionFolder(activeSaveMap || "chernarus").then(missionFolder => {
      if (!missionFolder) return;
      const storage1Path = path.join(dayzServerWatchPath, "mpmissions", missionFolder, "storage_1");
      try {
        if (fs.existsSync(storage1Path)) {
          const stat = fs.lstatSync(storage1Path);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(storage1Path);
          } else {
            fs.rmSync(storage1Path, { recursive: true, force: true });
          }
        }
      } catch (e) {
        console.error("Failed to remove server storage on quit:", e);
      }
    });
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
    if (statsWindow && !statsWindow.isDestroyed()) statsWindow.close();
    mainWindow = null;
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
