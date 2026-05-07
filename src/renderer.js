const appName = window.appInfo?.name ?? "Electron";
document.title = appName;

const serverIndicator = document.querySelector("[data-server-indicator]");
const gameIndicator = document.querySelector("[data-game-indicator]");
const bgLayers = [document.getElementById("bg-1"), document.getElementById("bg-2")];
const mapOptions = document.querySelectorAll(".map-option");

let activeLayerIndex = 0;

const mapBackgrounds = {
  chernarus: 'images/chernarus.png',
  livonia: 'images/livonia.png',
  sakhal: 'images/sakhal.png',
};

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
}


setBackground("chernarus");

mapOptions.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("locked")) return;
    setBackground(btn.dataset.map);
  });
});

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
    if (result.hasFrostline) {
      
      sakhalBtn.classList.remove("locked");
      if (lockIcon) lockIcon.classList.add("hidden");
    } else {
      
      sakhalBtn.classList.add("locked");
      if (lockIcon) lockIcon.classList.remove("hidden");

      
      if (sakhalBtn.classList.contains("active")) {
        setBackground("chernarus");
      }
    }
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
      window.appInfo.toggleMod(mod.name, checkbox.checked);
    });
    enabledCell.appendChild(checkbox);
    
    const nameCell = document.createElement("td");
    nameCell.className = "col-name";
    const displayName = mod.name.startsWith("@") ? mod.name.slice(1) : mod.name;
    nameCell.textContent = displayName + (mod.updated ? " (updated)" : "");
    
    
    if (mod.updated) {
      row.style.backgroundColor = "rgba(204, 74, 74, 0.15)";
      row.title = "Recently updated";
    }
    
    row.appendChild(enabledCell);
    row.appendChild(nameCell);
    modsList.appendChild(row);
  });
}

const spinner = document.getElementById("loading-spinner");
const statusText = document.getElementById("launch-status");

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
      }, 500);
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

document.querySelector(".action-button").addEventListener("click", async () => {
  const serverResult = await window.appInfo.scanForDayzServer();
  if (!serverResult.found) {
    alert("DayZ Server not found. Please install DayZ Server first.");
    return;
  }
  
  const button = document.querySelector(".action-button");
  const spinner = document.getElementById("loading-spinner");
  const statusText = document.getElementById("launch-status");
  
  button.disabled = true;
  button.textContent = "Copying mods...";
  
  spinner.classList.remove("hidden");
  statusText.textContent = "Copying mods...";
  
  const result = await window.appInfo.launchDayZ(serverResult.installPath);
  
  button.disabled = false;
  button.textContent = "Launch DayZ";
  spinner.classList.add("hidden");
  statusText.textContent = result.message;
  
  
  setTimeout(() => {
    statusText.textContent = "";
  }, 3000);
});
