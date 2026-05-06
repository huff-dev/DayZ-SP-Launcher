const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

const DAYZ_SERVER_APP_ID = "223350";
const DAYZ_SERVER_NAMES = ["DayZ Server", "DayZ Dedicated Server"];
let dayzServerWatcher = null;
let dayzServerWatchPath = null;
let dayzServerWatchTimer = null;

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

async function findServerBatchFiles(installPath) {
  try {
    const entries = await fsp.readdir(installPath, { withFileTypes: true });

    const batchFilePaths = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".bat"))
      .map((entry) => path.join(installPath, entry.name));

    const batchFiles = await Promise.all(batchFilePaths.map(parseServerBatchFile));

    return batchFiles.sort((first, second) => second.modifiedAtMs - first.modifiedAtMs);
  } catch {
    return [];
  }
}

function stripBatchQuotes(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseSetLine(line) {
  const quotedMatch = line.match(/^set\s+"([^=]+)=(.*)"\s*$/i);

  if (quotedMatch) {
    return {
      name: quotedMatch[1].trim(),
      value: quotedMatch[2].trim()
    };
  }

  const match = line.match(/^set\s+([^=\s]+)\s*=\s*(.*)$/i);

  if (!match) {
    return null;
  }

  return {
    name: match[1].trim(),
    value: match[2].trim()
  };
}

function resolveBatchVariables(value, variables, depth = 0) {
  if (!value || depth > 8) {
    return value || "";
  }

  return value.replace(/%([^%]+)%/g, (_match, variableName) => {
    const key = variableName.toLowerCase();

    if (!variables.has(key)) {
      return "";
    }

    return resolveBatchVariables(variables.get(key), variables, depth + 1);
  });
}

function getBatchArgument(commandText, name, variables) {
  const match = commandText.match(new RegExp(`(?:^|\\s)-${name}=("[^"]+"|\\S+)`, "i"));

  if (!match) {
    return "";
  }

  return stripBatchQuotes(resolveBatchVariables(match[1], variables));
}

function splitMods(value) {
  return stripBatchQuotes(value)
    .split(";")
    .map((modName) => modName.trim())
    .filter(Boolean);
}

async function parseServerBatchFile(filePath) {
  const fileName = path.basename(filePath);
  const stats = await fsp.stat(filePath);
  const modifiedAtMs = stats.mtimeMs;
  const modifiedAt = stats.mtime.toISOString();

  try {
    const content = await fsp.readFile(filePath, "utf8");
    const variables = new Map();
    let title = "";

    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("::") || /^rem\s/i.test(trimmedLine)) {
        continue;
      }

      const titleMatch = trimmedLine.match(/^title\s+(.+)$/i);

      if (titleMatch && !title) {
        title = stripBatchQuotes(titleMatch[1]);
      }

      const setEntry = parseSetLine(trimmedLine);

      if (setEntry) {
        variables.set(setEntry.name.toLowerCase(), stripBatchQuotes(setEntry.value));
      }
    }

    const commandText = content.replace(/\^\s*\r?\n\s*/g, " ");
    const serverName =
      resolveBatchVariables(variables.get("servername"), variables) || title || fileName;
    const port =
      resolveBatchVariables(variables.get("server_port"), variables) ||
      getBatchArgument(commandText, "port", variables) ||
      "";
    const configFile =
      resolveBatchVariables(variables.get("config_file"), variables) ||
      getBatchArgument(commandText, "config", variables) ||
      "";
    const modValues = [
      resolveBatchVariables(variables.get("mod_list"), variables),
      getBatchArgument(commandText, "mod", variables),
      getBatchArgument(commandText, "servermod", variables)
    ];
    const normalizedMods = new Set();

    for (const modValue of modValues) {
      for (const modName of splitMods(modValue || "")) {
        normalizedMods.add(modName.toLowerCase());
      }
    }

    return {
      fileName,
      filePath,
      serverName,
      title,
      port,
      configFile,
      modCount: normalizedMods.size,
      modifiedAt,
      modifiedAtMs
    };
  } catch {
    return {
      fileName,
      filePath,
      serverName: fileName,
      title: "",
      port: "",
      configFile: "",
      modCount: 0,
      modifiedAt,
      modifiedAtMs
    };
  }
}

async function findDayzServerInLibrary(libraryPath) {
  const steamAppsPath = libraryPath.endsWith("steamapps")
    ? libraryPath
    : path.join(libraryPath, "steamapps");
  const manifestPath = path.join(steamAppsPath, `appmanifest_${DAYZ_SERVER_APP_ID}.acf`);

  if (!(await pathExists(manifestPath))) {
    return null;
  }

  const manifest = parseAppManifest(await fsp.readFile(manifestPath, "utf8"));
  const installDir = manifest.installDir || DAYZ_SERVER_NAMES[0];
  const installPath = path.join(steamAppsPath, "common", installDir);
  const installed = await pathExists(installPath);
  const batchFiles = installed ? await findServerBatchFiles(installPath) : [];

  return {
    appId: manifest.appId || DAYZ_SERVER_APP_ID,
    name: manifest.name || DAYZ_SERVER_NAMES[0],
    manifestPath,
    installPath,
    installed,
    batchFiles,
    hasServerBatchFiles: batchFiles.length > 0
  };
}

function broadcastDayzServerUpdate(result) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("dayz:server-updated", result);
  }
}

async function buildDayzServerUpdate(server) {
  const batchFiles = await findServerBatchFiles(server.installPath);

  return {
    found: server.installed,
    steamFound: true,
    server: {
      ...server,
      batchFiles,
      hasServerBatchFiles: batchFiles.length > 0
    }
  };
}

function stopDayzServerWatcher() {
  if (dayzServerWatcher) {
    dayzServerWatcher.close();
    dayzServerWatcher = null;
  }

  if (dayzServerWatchTimer) {
    clearTimeout(dayzServerWatchTimer);
    dayzServerWatchTimer = null;
  }

  dayzServerWatchPath = null;
}

function watchDayzServerDirectory(server) {
  if (!server?.installed || dayzServerWatchPath === server.installPath) {
    return;
  }

  stopDayzServerWatcher();
  dayzServerWatchPath = server.installPath;

  dayzServerWatcher = fs.watch(server.installPath, (eventType, filename) => {
    if (filename && !filename.toLowerCase().endsWith(".bat")) {
      return;
    }

    clearTimeout(dayzServerWatchTimer);
    dayzServerWatchTimer = setTimeout(async () => {
      broadcastDayzServerUpdate(await buildDayzServerUpdate(server));
    }, 150);
  });

  dayzServerWatcher.on("error", () => {
    stopDayzServerWatcher();
  });
}

async function scanForDayzServer() {
  const steamPaths = getSteamCandidates();
  const checkedSteamPaths = [];
  const checkedLibraries = [];

  for (const steamPath of steamPaths) {
    checkedSteamPaths.push(steamPath);

    if (!(await pathExists(steamPath))) {
      continue;
    }

    const libraries = unique([
      ...getDefaultLibraries(steamPath),
      ...(await findSteamLibraries(steamPath))
    ]);

    for (const libraryPath of libraries) {
      checkedLibraries.push(libraryPath);
      const server = await findDayzServerInLibrary(libraryPath);

      if (server) {
        const result = {
          found: server.installed,
          steamFound: true,
          server,
          checkedSteamPaths,
          checkedLibraries: unique(checkedLibraries)
        };

        watchDayzServerDirectory(server);
        return result;
      }
    }

    return {
      found: false,
      steamFound: true,
      server: null,
      checkedSteamPaths,
      checkedLibraries: unique(checkedLibraries)
    };
  }

  return {
    found: false,
    steamFound: false,
    server: null,
    checkedSteamPaths,
    checkedLibraries: unique(checkedLibraries)
  };
}

ipcMain.handle("dayz:scan-server", scanForDayzServer);

app.on("before-quit", stopDayzServerWatcher);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
    minWidth: 600,
    minHeight: 600,
    maxWidth: 1000,
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
