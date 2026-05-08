const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

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
let dayzWorkshopWatcher = null;
let dayzWorkshopWatchTimer = null;
let lastModTimes = new Map();

let isServerRunning = false;
let isGameRunning = false;
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
    }
    
    isGameRunning = running;
  });
}


setInterval(checkProcesses, 2000);

ipcMain.handle("dayz:is-server-running", () => isServerRunning);

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
        
        if (!nameMatch) continue;
        
        const modName = nameMatch[1];
        const stat = await fsp.stat(modFolderPath);
        const sourceMtime = stat.mtimeMs;
        
        
        const lastSync = lastSyncTimes[f.name] || 0;
        const wasUpdated = sourceMtime > lastSync;
        
        mods.push({ 
          name: modName,
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
  await saveSettings(settings);
  
  
  if (dayzGameWatchPath) {
    const mods = await scanWorkshopMods(dayzGameWatchPath);
    broadcastUpdate("dayz:mods-updated", mods);
  }
});

ipcMain.handle("dayz:scan-server", scanForDayzServer);
ipcMain.handle("dayz:scan-game", scanForDayzGame);

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
      await fsp.rm(profilesPath, { recursive: true, force: true });
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
  await saveSettings(settings);

  
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
