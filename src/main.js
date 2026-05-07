const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

const DAYZ_SERVER_APP_ID = "223350";
const DAYZ_SERVER_NAMES = ["DayZ Server", "DayZ Dedicated Server"];
const DAYZ_GAME_APP_ID = "221100";
const DAYZ_GAME_NAMES = ["DayZ"];

let dayzServerWatcher = null;
let dayzServerWatchPath = null;
let dayzServerWatchTimer = null;

let dayzGameWatcher = null;
let dayzGameWatchPath = null;
let dayzGameWatchTimer = null;

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
  let hasFrostline = false;

  
  if (appInfo.appId === DAYZ_GAME_APP_ID) {
    try {
      
      const libraryPath = path.dirname(path.dirname(appInfo.manifestPath));
      const dlcManifestPath = path.join(libraryPath, "appmanifest_3302480.acf");
      
      if (await pathExists(dlcManifestPath)) {
        hasFrostline = true;
      } else if (appInfo.manifestPath) {
        
        const manifestContent = await fsp.readFile(appInfo.manifestPath, "utf8");
        if (manifestContent.includes("3302480")) {
          hasFrostline = true;
        }
      }
    } catch (error) {
      console.error("Failed to check for Frostline DLC:", error);
    }
  }

  return {
    found: appInfo.installed,
    hasFrostline,
    installPath: appInfo.installPath
  };
}

async function scanForApp(appId, defaultNames, type) {
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
      const appInfo = await findAppInLibrary(libraryPath, appId, defaultNames[0]);

      if (appInfo) {
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
let dayzWorkshopWatcher = null;
let dayzWorkshopWatchTimer = null;
let lastModTimes = new Map();

console.log(`Settings file path: ${SETTINGS_FILE}`);

async function getSettings() {
  try {
    if (await pathExists(SETTINGS_FILE)) {
      const data = await fsp.readFile(SETTINGS_FILE, "utf8");
      const settings = JSON.parse(data);
      console.log("Loaded settings:", settings);
      return settings;
    }
  } catch (error) {
    console.error("Failed to read settings:", error);
  }
  return {};
}

async function saveSettings(settings) {
  try {
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

async function scanWorkshopMods(gamePath) {
  const workshopPath = path.join(gamePath, "!Workshop");
  console.log(`Scanning for mods in: ${workshopPath}`);
  
  if (!(await pathExists(workshopPath))) {
    console.warn(`Workshop directory not found: ${workshopPath}`);
    return [];
  }

  try {
    const files = await fsp.readdir(workshopPath, { withFileTypes: true });
    console.log(`Found ${files.length} items in Workshop directory`);
    
    const mods = [];
    for (const f of files) {
      if (!f.name.startsWith("@")) continue;
      
      let fullPath = path.join(workshopPath, f.name);
      let stat;
      
      if (f.isDirectory()) {
        stat = await fsp.stat(fullPath);
      } else if (f.isSymbolicLink()) {
        stat = await fsp.stat(fullPath);
        if (!stat.isDirectory()) continue;
      } else {
        continue;
      }
      
      const modName = f.name;
      const mtime = stat.mtimeMs;
      const isNew = !lastModTimes.has(modName);
      const wasUpdated = !isNew && lastModTimes.get(modName) !== mtime;
      
      mods.push({ 
        name: modName,
        mtime: mtime,
        updated: wasUpdated
      });
      
      
      lastModTimes.set(modName, mtime);
    }

    console.log(`Identified ${mods.length} mod folders (@...)`);

    const settings = await getSettings();
    const enabledMods = settings.enabledMods || [];

    return mods.map(m => ({
      name: m.name,
      enabled: enabledMods.includes(m.name),
      updated: m.updated
    }));
  } catch (error) {
    console.error("Failed to scan workshop mods:", error);
    return [];
  }
}

function setupWorkshopWatcher(gamePath) {
  const workshopPath = path.join(gamePath, "!Workshop");
  
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
  return scanForApp(DAYZ_SERVER_APP_ID, DAYZ_SERVER_NAMES, "server");
}

async function scanForDayzGame() {
  return scanForApp(DAYZ_GAME_APP_ID, DAYZ_GAME_NAMES, "game");
}

ipcMain.handle("dayz:scan-mods", async () => {
  if (!dayzGameWatchPath) return [];
  return await scanWorkshopMods(dayzGameWatchPath);
});

ipcMain.handle("dayz:toggle-mod", async (_event, modName, enabled) => {
  const settings = await getSettings();
  let enabledMods = settings.enabledMods || [];

  if (enabled) {
    if (!enabledMods.includes(modName)) enabledMods.push(modName);
  } else {
    enabledMods = enabledMods.filter(name => name !== modName);
  }

  settings.enabledMods = enabledMods;
  await saveSettings(settings);
  
  
  if (dayzGameWatchPath) {
    const mods = await scanWorkshopMods(dayzGameWatchPath);
    broadcastUpdate("dayz:mods-updated", mods);
  }
});

ipcMain.handle("dayz:scan-server", scanForDayzServer);
ipcMain.handle("dayz:scan-game", scanForDayzGame);

ipcMain.handle("dayz:browse", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select DayZ Installation Folder",
    buttonLabel: "Select"
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { path: result.filePaths[0] };
  }
  return { path: null };
});

ipcMain.handle("dayz:get-setting", async (_event, key) => {
  const settings = await getSettings();
  return settings[key];
});

ipcMain.handle("dayz:save-setting", async (_event, key, value) => {
  const settings = await getSettings();
  settings[key] = value;
  await saveSettings(settings);
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

ipcMain.handle("dayz:open-external", (_event, url) => {
  console.log("Opening external URL:", url);
  shell.openExternal(url);
});

ipcMain.handle("dayz:launch", async (_event, dayzServerPath) => {
  const settings = await getSettings();
  const enabledMods = settings.enabledMods || [];  
  if (enabledMods.length === 0) {
    return { success: false, message: "No mods selected" };
  }  
  if (!dayzServerPath || !(await pathExists(dayzServerPath))) {
    return { success: false, message: "DayZ Server path not found" };
  }  
  const workshopPath = path.join(dayzGameWatchPath, "!Workshop");
  if (!(await pathExists(workshopPath))) {
    return { success: false, message: "Workshop directory not found" };
  }  
  let copied = 0;
  let skipped = 0;
  let errors = [];  
  for (const modName of enabledMods) {
    
    const fullModName = modName.startsWith("@") ? modName : "@" + modName;
    const sourcePath = path.join(workshopPath, fullModName);
    const destPath = path.join(dayzServerPath, fullModName);    
    if (!(await pathExists(sourcePath))) {
      errors.push(`Mod not found: ${fullModName}`);
      continue;
    }    
    try {
      
      if (await pathExists(destPath)) {
        const sourceStat = await fsp.stat(sourcePath);
        const destStat = await fsp.stat(destPath);
        
        
        if (destStat.mtimeMs >= sourceStat.mtimeMs) {
          console.log(`Skipped (up to date): ${fullModName}`);
          skipped++;
          continue;
        }
        
        
        await fsp.rm(destPath, { recursive: true, force: true });
      }      
      
      await fsp.cp(sourcePath, destPath, { recursive: true });
      copied++;
      console.log(`Copied mod: ${fullModName}`);
      
      
      const sourceKeysPath = path.join(sourcePath, "keys");
      const destKeysPath = path.join(dayzServerPath, "keys");
      if (await pathExists(sourceKeysPath)) {
        try {
          await fsp.cp(sourceKeysPath, destKeysPath, { recursive: true });
          console.log(`Copied keys for: ${fullModName}`);
        } catch (keyError) {
          console.warn(`Failed to copy keys for ${fullModName}: ${keyError.message}`);
        }
      }
    } catch (error) {
      errors.push(`Failed to copy ${fullModName}: ${error.message}`);
    }
  }  
  return {
    success: errors.length ===0,
    message: `Copied ${copied} mod(s), skipped ${skipped} up to date` + (errors.length >0 ? `. Errors: ${errors.join(", ")}` : ""),
    errors
  };
});

app.on("before-quit", () => {
  if (dayzServerWatcher) dayzServerWatcher.close();
  if (dayzGameWatcher) dayzGameWatcher.close();
  if (dayzWorkshopWatcher) dayzWorkshopWatcher.close();
});

function createWindow() {
  const mainWindow = new BrowserWindow({
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
  
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
