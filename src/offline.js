const fs = require("fs");
const path = require("path");

const GOLDBERG_DIR = path.join(__dirname, "scripts");
const STEAM_API_DLL = "steam_api64.dll";
const STEAM_API_DLL_32 = "steam_api.dll";
const STEAM_APPID_FILE = "steam_appid.txt";
const STEAM_SETTINGS_DIR = "steam_settings";
const OFFLINE_MARKER = "offline.txt";
const DISABLE_NETWORKING_MARKER = "disable_networking.txt";
const DAYZ_APPID = "221100";

function getBackupPath(basePath, dllName) {
  return path.join(basePath, dllName + ".bak");
}

function applyToPath(basePath, label) {
  const dllName = STEAM_API_DLL;
  const dllSource = path.join(GOLDBERG_DIR, dllName);
  const dllDest = path.join(basePath, dllName);
  const appidDest = path.join(basePath, STEAM_APPID_FILE);
  const settingsDir = path.join(basePath, STEAM_SETTINGS_DIR);

  if (!fs.existsSync(dllSource)) {
    console.error(`Goldberg: ${dllName} not found at ${dllSource}`);
    return false;
  }

  const backupPath = getBackupPath(basePath, dllName);
  if (fs.existsSync(dllDest) && !fs.existsSync(backupPath)) {
    const original = fs.readFileSync(dllDest);
    fs.writeFileSync(backupPath, original);
    console.log(`Goldberg: Backed up original ${dllName} (${label})`);
  }

  fs.copyFileSync(dllSource, dllDest);
  console.log(`Goldberg: Copied ${dllName} to ${label}`);

  fs.writeFileSync(appidDest, DAYZ_APPID);
  console.log(`Goldberg: Created steam_appid.txt (${label})`);

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(settingsDir, OFFLINE_MARKER), "");
  fs.writeFileSync(path.join(settingsDir, DISABLE_NETWORKING_MARKER), "");
  console.log(`Goldberg: Created steam_settings with offline + disable_networking flags (${label})`);

  return true;
}

function restoreFromPath(basePath, label) {
  const dllName = STEAM_API_DLL;
  const dllDest = path.join(basePath, dllName);
  const backupPath = getBackupPath(basePath, dllName);
  const appidDest = path.join(basePath, STEAM_APPID_FILE);
  const settingsDir = path.join(basePath, STEAM_SETTINGS_DIR);
  let restored = false;

  if (fs.existsSync(backupPath)) {
    try {
      if (fs.existsSync(dllDest)) {
        fs.unlinkSync(dllDest);
      }
      fs.copyFileSync(backupPath, dllDest);
      fs.unlinkSync(backupPath);
      console.log(`Goldberg: Restored original ${dllName} (${label})`);
      restored = true;
    } catch (err) {
      console.error(`Goldberg: Could not restore ${dllName} (${label}) - file in use, will retry later: ${err.message}`);
    }
  }

  if (fs.existsSync(appidDest)) {
    try {
      fs.unlinkSync(appidDest);
      console.log(`Goldberg: Removed steam_appid.txt (${label})`);
    } catch {}
  }

  if (fs.existsSync(settingsDir)) {
    try {
      fs.rmSync(settingsDir, { recursive: true, force: true });
      console.log(`Goldberg: Removed steam_settings directory (${label})`);
    } catch {}
  }

  return restored;
}

function hasGoldbergBackup(basePath) {
  return fs.existsSync(getBackupPath(basePath, STEAM_API_DLL));
}

function applyGoldberg(gamePath, serverPath) {
  const results = [];
  if (gamePath && fs.existsSync(gamePath)) {
    results.push(applyToPath(gamePath, "game"));
  }
  if (serverPath && fs.existsSync(serverPath)) {
    results.push(applyToPath(serverPath, "server"));
  }
  return results.some(Boolean);
}

function removeGoldberg(gamePath, serverPath) {
  const results = [];
  if (gamePath && fs.existsSync(gamePath)) {
    results.push(restoreFromPath(gamePath, "game"));
  }
  if (serverPath && fs.existsSync(serverPath)) {
    results.push(restoreFromPath(serverPath, "server"));
  }
  return results.some(Boolean);
}

module.exports = { applyGoldberg, removeGoldberg, hasGoldbergBackup };
