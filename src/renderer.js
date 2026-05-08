const appName = window.appInfo?.name ?? "Electron";
document.title = appName;

const serverIndicator = document.querySelector("[data-server-indicator]");
const gameIndicator = document.querySelector("[data-game-indicator]");
const bgLayers = [document.getElementById("bg-1"), document.getElementById("bg-2")];
const mapOptions = document.querySelectorAll(".map-option");
const continueBtn = document.querySelector(".continue-button");
const quickJoinCheckbox = document.getElementById("quick-join");

document.getElementById("minimize")?.addEventListener("click", () => {
  window.appInfo?.minimize();
});

document.getElementById("close")?.addEventListener("click", () => {
  window.appInfo?.close();
});

let activeLayerIndex = 0;
let isServerRunningLocal = false;

const mapBackgrounds = {
  chernarus: 'images/chernarus.png',
  livonia: 'images/livonia.png',
  sakhal: 'images/sakhal.png',
};

async function updateStorageStatus(map) {
  if (!continueBtn) return;
  
  const hasStorage = await window.appInfo?.checkMapStorage?.(map);
  continueBtn.disabled = !hasStorage;
}

function setBackground(map) {
  const imageUrl = mapBackgrounds[map];
  if (!imageUrl) return;

  const nextLayerIndex = 1 - activeLayerIndex;
  const currentLayer = bgLayers[activeLayerIndex];
  const nextLayer = bgLayers[nextLayerIndex];  
  
  nextLayer.style.backgroundImage = `url('${imageUrl}')`;
  nextLayer.classList.add("active");
  currentLayer.classList.remove("active");

  activeLayerIndex = nextLayerIndex;
  mapOptions.forEach(opt => {
    opt.classList.toggle("active", opt.dataset.map === map);
  });
  
  
  window.appInfo?.saveSetting?.("selectedMap", map);
  
  
  updateStorageStatus(map);
}

mapOptions.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("locked")) return;
    setBackground(btn.dataset.map);
  });
});

quickJoinCheckbox?.addEventListener("change", () => {
  window.appInfo?.saveSetting?.("quickJoin", quickJoinCheckbox.checked);
});


(async () => {
  const savedMap = await window.appInfo?.getSetting?.("selectedMap") || "chernarus";
  const quickJoin = await window.appInfo?.getSetting?.("quickJoin") || false;
  
  if (quickJoinCheckbox) quickJoinCheckbox.checked = quickJoin;

  mapOptions.forEach(opt => {
    opt.classList.toggle("active", opt.dataset.map === savedMap);
  });
  
  const savedIndex = savedMap === "chernarus" ? 0 : 1;
  bgLayers.forEach((layer, i) => {
    if (i === savedIndex) {
      layer.classList.add("active");
      layer.style.backgroundImage = `url('${mapBackgrounds[savedMap]}')`;
    } else {
      layer.classList.remove("active");
    }
  });
  activeLayerIndex = savedIndex;
  
  
  updateStorageStatus(savedMap);
})();

function setStatusIndicator(indicator, state, label) {
  if (!indicator) return;
  indicator.dataset.state = state;
  indicator.setAttribute("aria-label", label);
}

function updateServerStatus(result) {
  const state = result.found ? "online" : "offline";
  const label = result.found ? "DayZ Server found" : "DayZ Server not found";
  setStatusIndicator(serverIndicator, state, label);
}

function updateGameStatus(result) {
  const state = result.found ? "online" : "offline";
  const label = result.found ? "DayZ found" : "DayZ not found";
  setStatusIndicator(gameIndicator, state, label);

  
  const sakhalBtn = document.querySelector('[data-map="sakhal"]');
  const lockIcon = sakhalBtn?.querySelector(".lock-icon");

  if (sakhalBtn) {
    sakhalBtn.classList.remove("locked");
    if (lockIcon) lockIcon.classList.add("hidden");
  }
}

const modsList = document.getElementById("mods-list");

function renderMods(mods) {
  modsList.innerHTML = "";
  
  if (mods.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="2" style="text-align: center; color: rgba(237, 234, 225, 0.4); padding: 20px;">No mods found in Steam workshop</td>`;
    modsList.appendChild(row);
    return;
  }

  mods.forEach(mod => {
    const row = document.createElement("tr");
    
    const enabledCell = document.createElement("td");
    enabledCell.className = "col-enabled";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = mod.enabled;
    checkbox.addEventListener("change", () => {
      window.appInfo.toggleMod({ name: mod.name, folderName: mod.folderName }, checkbox.checked);
    });
    enabledCell.appendChild(checkbox);
    
    const nameCell = document.createElement("td");
    nameCell.className = "col-name";
    const displayName = mod.name.startsWith("@") ? mod.name.slice(1) : mod.name;
    nameCell.textContent = displayName;
    
    
    if (mod.updated) {
      row.title = "Recently updated";
    }
    
    row.appendChild(enabledCell);
    row.appendChild(nameCell);
    modsList.appendChild(row);
  });
}

async function scanForInstallations() {
  try {
    const serverResult = await window.appInfo.scanForDayzServer();
    updateServerStatus(serverResult);
    
    const gameResult = await window.appInfo.scanForDayzGame();
    updateGameStatus(gameResult);

    if (gameResult.found) {
      console.log("DayZ Game found, waiting a moment before scanning mods...");
      
      setTimeout(async () => {
        const mods = await window.appInfo.scanForDayzMods();
        console.log(`Renderer received ${mods.length} mods`);
        renderMods(mods);
      }, 1000);
    } else {
      console.warn("DayZ Game not found, skipping mod scan");
      renderMods([]);
    }
  } catch (error) {
    console.error("Installation scan failed:", error);
  }
}

scanForInstallations();
window.appInfo.onDayzServerUpdated(updateServerStatus);
window.appInfo.onDayzGameUpdated(updateGameStatus);
window.appInfo.onDayzModsUpdated(renderMods);

document.getElementById("workshop-btn").addEventListener("click", () => {
  window.location.href = 'steam://openurl/https://steamcommunity.com/app/221100/workshop/';
});

document.getElementById("launcher-btn").addEventListener("click", () => {
  window.appInfo.launchDayZLauncher();
});

const confirmContainer = document.getElementById("new-game-confirm");
const confirmProceedBtn = document.getElementById("confirm-proceed");
const confirmCancelBtn = document.getElementById("confirm-cancel");

async function handleLaunch(isNewGame = false, forceDelete = false) {
  const activeMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";
  const button = document.querySelector(".action-button");
  const statusText = document.getElementById("launch-status");

  if (isNewGame && confirmContainer?.classList.contains("hidden")) {
    
    if (continueBtn && !continueBtn.disabled) {
      confirmContainer.classList.remove("hidden");
      
      button.disabled = true;
      continueBtn.disabled = true;
      return;
    } else {
      
      forceDelete = true;
    }
  }

  confirmContainer?.classList.add("hidden");

  
  if (isNewGame || forceDelete) {
    statusText.textContent = "Wiping previous save...";
    await window.appInfo.deleteMapStorage(activeMap);
  }

  const serverResult = await window.appInfo.scanForDayzServer();
  if (!serverResult.found) {
    alert("DayZ Server not found. Please install DayZ Server first.");
    
    updateButtonsState(isServerRunningLocal);
    return;
  }
  
  const spinner = document.getElementById("loading-spinner");
  
  button.disabled = true;
  if (continueBtn) continueBtn.disabled = true;
  button.textContent = "Launching...";
   
  spinner.classList.remove("hidden");
  statusText.textContent = "Preparing server...";
  
  const result = await window.appInfo.launchDayZ(serverResult.installPath, activeMap);
   
  button.disabled = isServerRunningLocal;
  
  updateStorageStatus(activeMap);
  
  button.textContent = "New Game";
  spinner.classList.add("hidden");
  
  if (!isServerRunningLocal) {
    statusText.textContent = result.message;
    setTimeout(() => {
      if (!isServerRunningLocal) {
        statusText.textContent = "";
      } else {
        statusText.textContent = "DayZ server is running";
      }
    }, 3000);
  }
}

document.querySelector(".action-button").addEventListener("click", () => handleLaunch(true));
continueBtn?.addEventListener("click", () => handleLaunch(false));

confirmProceedBtn?.addEventListener("click", () => handleLaunch(false, true));
confirmCancelBtn?.addEventListener("click", () => {
  confirmContainer?.classList.add("hidden");
  
  updateButtonsState(isServerRunningLocal);
});

function updateButtonsState(isServerRunning) {
  isServerRunningLocal = isServerRunning;
  const newGameBtn = document.querySelector(".action-button");
  const statusText = document.getElementById("launch-status");

  if (isServerRunning) {
    newGameBtn.disabled = true;
    if (continueBtn) continueBtn.disabled = true;
    statusText.textContent = "DayZ server is running";
  } else {
    newGameBtn.disabled = false;
    
    const activeMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";
    updateStorageStatus(activeMap);
    if (statusText.textContent === "DayZ server is running") {
      statusText.textContent = "";
    }
  }
}

window.appInfo.onProcessStatusUpdated((status) => {
  updateButtonsState(status.running);
});


(async () => {
  const running = await window.appInfo.isServerRunning();
  updateButtonsState(running);
})();
