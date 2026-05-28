const appName = window.appInfo?.name ?? "Electron";
document.title = appName;

const serverIndicator = document.querySelector("[data-server-indicator]");
const gameIndicator = document.querySelector("[data-game-indicator]");
const bgLayers = [document.getElementById("bg-1"), document.getElementById("bg-2")];
const mapOptions = document.querySelectorAll(".map-option");
const continueBtn = document.querySelector(".continue-button");
const quickJoinCheckbox = document.getElementById("quick-join");
const disableBECheckbox = document.getElementById("disable-be");
const offlineModeCheckbox = document.getElementById("offline-mode");

const versionSpan = document.getElementById("app-version");
window.appInfo.getVersion().then(v => { versionSpan.textContent = `v${v}`; });

const updateLink = document.getElementById("update-link");
window.appInfo.checkUpdate().then(result => {
  if (result?.available) {
    updateLink.classList.remove("hidden");
    updateLink.dataset.url = result.url;
  }
});
window.appInfo.onUpdateAvailable((info) => {
  if (info?.available) {
    updateLink.classList.remove("hidden");
    updateLink.dataset.url = info.url;
  }
});
updateLink?.addEventListener("click", (e) => {
  e.preventDefault();
  if (updateLink.dataset.url) window.appInfo.openExternal(updateLink.dataset.url);
});

document.getElementById("minimize")?.addEventListener("click", () => {
  window.appInfo?.minimize();
});

document.getElementById("close")?.addEventListener("click", () => {
  window.appInfo?.close();
});

const searchInput = document.getElementById("mods-search-input");

searchInput?.addEventListener("input", filterMods);

const importBtn = document.getElementById("mods-import-btn");
const importMenu = document.getElementById("mods-import-menu");

importBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (importMenu.classList.contains("open")) {
    importMenu.classList.remove("open");
  } else {
    closeAllDropdowns();
    importMenu.classList.add("open");
  }
});

async function renderImportMenu() {
  importMenu.innerHTML = "";
  const row = document.createElement("div");
  row.className = "mods-import-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mods-dropdown-input";
  input.placeholder = "Path...";
  row.appendChild(input);
  const addBtn = document.createElement("button");
  addBtn.className = "mods-import-add-btn";
  addBtn.textContent = "Add";
  addBtn.disabled = true;
  row.appendChild(addBtn);
  const btn = document.createElement("button");
  btn.className = "mods-import-browse-btn";
  btn.textContent = "Browse";
  function flashError() {
    input.classList.add("mods-dropdown-input-error");
    setTimeout(() => input.classList.remove("mods-dropdown-input-error"), 1500);
  }
  async function doImport(path) {
    if (!path) return;
    const result = await window.appInfo.importLocalMod(path);
    if (!result.success) {
      flashError();
      return;
    }
    importMenu.classList.remove("open");
    renderImportMenu();
  }
  function updateAddBtn() {
    addBtn.disabled = !input.value.trim();
  }
  input.addEventListener("input", updateAddBtn);
  addBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await doImport(input.value.trim());
  });
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const folder = await window.appInfo.pickFolder();
    if (folder) {
      await doImport(folder);
    }
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.stopPropagation();
      await doImport(input.value.trim());
    }
  });
  row.appendChild(btn);
  importMenu.appendChild(row);
  const divider = document.createElement("div");
  divider.className = "mods-dropdown-divider";
  importMenu.appendChild(divider);
  const settings = await window.appInfo.getAllSettings();
  const localModPaths = settings.localModPaths || [];
  if (localModPaths.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "mods-import-placeholder";
    placeholder.textContent = "No local mod paths exist";
    importMenu.appendChild(placeholder);
  } else {
    localModPaths.forEach(p => {
      const row = document.createElement("div");
      row.className = "mods-dropdown-item-row";
      const label = document.createElement("span");
      label.className = "mods-dropdown-item-label";
      label.textContent = p;
      label.title = p;
      label.addEventListener("click", (e) => {
        e.stopPropagation();
        importMenu.classList.remove("open");
        window.appInfo.openFolder(p);
      });
      row.appendChild(label);
      const delBtn = document.createElement("button");
      delBtn.className = "mods-dropdown-del-btn";
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await window.appInfo.removeLocalModPath(p);
        renderImportMenu();
      });
      row.appendChild(delBtn);
      importMenu.appendChild(row);
    });
  }
}
renderImportMenu();

let activeLayerIndex = 0;
let isServerRunningLocal = false;
let allMods = [];
let launchHadErrors = false;
let sortMode = "name";

const sortLabel = document.getElementById("mods-label-wrapper");
const sortMenu = document.getElementById("mods-sort-menu");

const sortOptions = [
  { value: "name", label: "Name" },
  { value: "date", label: "Date added" },
];

window.appInfo.getSetting("sortMode").then(saved => {
  if (saved) sortMode = saved;
  renderSortMenu();
  filterMods();
});

function closeAllDropdowns() {
  sortMenu?.classList.remove("open");
  dropdownMenu?.classList.remove("open");
  importMenu?.classList.remove("open");
}

sortLabel?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (sortMenu.classList.contains("open")) {
    sortMenu.classList.remove("open");
  } else {
    closeAllDropdowns();
    sortMenu.classList.add("open");
  }
});

document.addEventListener("click", (e) => {
  if (sortMenu?.contains(e.target) || sortLabel?.contains(e.target)) return;
  if (importMenu?.contains(e.target) || importBtn?.contains(e.target)) return;
  sortMenu?.classList.remove("open");
  importMenu?.classList.remove("open");
});

function renderSortMenu() {
  sortMenu.innerHTML = "";

  const header = document.createElement("div");
  header.className = "mods-sort-header";
  header.textContent = "Sort by";
  sortMenu.appendChild(header);

  sortOptions.forEach(opt => {
    const item = document.createElement("div");
    item.className = "mods-sort-item" + (opt.value === sortMode ? " active" : "");
    item.textContent = opt.label;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      sortMode = opt.value;
      window.appInfo.saveSetting("sortMode", sortMode);
      sortMenu.classList.remove("open");
      renderSortMenu();
      filterMods();
    });
    sortMenu.appendChild(item);
  });
}

function sortMods(mods) {
  return [...mods].sort((a, b) => {
    if (sortMode === "date") {
      return (b.mtime || 0) - (a.mtime || 0);
    }
    const nameA = (a.name.startsWith("@") ? a.name.slice(1) : a.name).toLowerCase();
    const nameB = (b.name.startsWith("@") ? b.name.slice(1) : b.name).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function filterMods() {
  const query = searchInput?.value.trim().toLowerCase();
  let filtered = !query ? allMods : allMods.filter(mod => {
    const displayName = (mod.name.startsWith("@") ? mod.name.slice(1) : mod.name).toLowerCase();
    return displayName.includes(query);
  });
  filtered = sortMods(filtered);
  renderModsList(filtered);
}

function renderModsList(mods) {
  modsList.innerHTML = "";

  if (mods.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3" style="text-align: center; color: rgba(237, 234, 225, 0.4); padding: 20px;">No mods found</td>`;
    modsList.appendChild(row);
    return;
  }

  const duplicateFolders = new Set();
  const nameCounts = new Map();
  for (const mod of mods) {
    const key = (mod.name || "").replace(/^@/, "").toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of nameCounts) {
    if (count > 1) {
      const enabled = mods.filter(m => {
        const mk = (m.name || "").replace(/^@/, "").toLowerCase();
        return mk === key && m.enabled;
      });
      if (enabled.length > 1) duplicateFolders.add(key);
    }
  }

  mods.forEach(mod => {
    const row = document.createElement("tr");
    row.classList.add("mod-row");
    const modKey = (mod.name || "").replace(/^@/, "").toLowerCase();
    if (duplicateFolders.has(modKey) && mod.enabled) {
      row.classList.add("duplicate");
    }
    if (mod.publishedId) {
      row.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          window.appInfo.openExternal(`steam://url/CommunityFilePage/${mod.publishedId}`);
        }
      });
    }

    const enabledCell = document.createElement("td");
    enabledCell.className = "col-enabled";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = mod.enabled;
    checkbox.addEventListener("change", () => {
      window.appInfo.toggleMod(mod, checkbox.checked);
      if (selectedPreset) {
        presetDirty = true;
        updateLabel();
      }
    });
    enabledCell.appendChild(checkbox);

    const nameCell = document.createElement("td");
    nameCell.className = "col-name";
    const displayName = mod.local && mod.name.startsWith("@") ? mod.name : (mod.name.startsWith("@") ? mod.name.slice(1) : mod.name);
    const wrap = document.createElement("div");
    wrap.className = "col-name-wrap";
    const nameSpan = document.createElement("span");
    nameSpan.className = "col-name-text";
    nameSpan.textContent = displayName;
    wrap.appendChild(nameSpan);
    if (mod.local) {
      const badge = document.createElement("span");
      badge.className = "local-badge";
      badge.textContent = "local";
      wrap.appendChild(badge);
    }
    nameCell.appendChild(wrap);

    row.appendChild(enabledCell);
    row.appendChild(nameCell);

    if (mod.fullPath) {
      const folderCell = document.createElement("td");
      folderCell.className = "col-folder-btn";
      const folderBtn = document.createElement("button");
      folderBtn.className = "mod-folder-btn";
      folderBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      folderBtn.title = "Open mod folder";
      folderBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.appInfo.openFolder(mod.fullPath);
      });
      folderCell.appendChild(folderBtn);
      row.appendChild(folderCell);
    }
    modsList.appendChild(row);
  });

  checkDirty();
}

function renderMods(mods) {
  allMods = mods;
  if (searchInput) searchInput.placeholder = `Search ${mods.length} mod${mods.length !== 1 ? "s" : ""}..`;
  filterMods();
}

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

disableBECheckbox?.addEventListener("change", () => {
  window.appInfo?.saveSetting?.("disableBE", disableBECheckbox.checked);
});

offlineModeCheckbox?.addEventListener("change", () => {
  window.appInfo?.saveSetting?.("offlineMode", offlineModeCheckbox.checked);
});

(async () => {
  const settings = await window.appInfo?.getAllSettings?.() || {};
  const savedMap = settings.selectedMap || "chernarus";
  const quickJoin = !!settings.quickJoin;
  const disableBE = !!settings.disableBE;
  const offlineMode = !!settings.offlineMode;

  if (quickJoinCheckbox) quickJoinCheckbox.checked = quickJoin;
  if (disableBECheckbox) disableBECheckbox.checked = disableBE;
  if (offlineModeCheckbox) offlineModeCheckbox.checked = offlineMode;

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
  if (sakhalBtn) {
    sakhalBtn.classList.remove("locked");
  }
}

const modsList = document.getElementById("mods-list");

const dropdownToggle = document.getElementById("mods-dropdown-toggle");
const dropdownMenu = document.getElementById("mods-dropdown-menu");
const dropdownLabel = document.querySelector(".mods-dropdown-label");

let selectedPreset = null;
let presetDirty = false;
let currentPresetFilename = null;
let currentPresetIsDefault = false;
let pendingNewPreset = null;

function updateSaveBtn() {
  const saveBtn = dropdownMenu?.querySelector(".mods-dropdown-btn:first-child");
  if (saveBtn) saveBtn.disabled = !selectedPreset || currentPresetIsDefault;
}

function updateLabel() {
  if (!dropdownLabel) return;
  if (selectedPreset) {
    dropdownLabel.textContent = (presetDirty ? "*" : "") + selectedPreset;
  } else {
    dropdownLabel.textContent = "presets";
  }
}

function selectPreset(name, filename, isDefault) {
  selectedPreset = name;
  currentPresetFilename = filename;
  currentPresetIsDefault = isDefault || false;
  presetDirty = false;
  updateLabel();
  updateSaveBtn();
  dropdownMenu?.classList.remove("open");
  window.appInfo.saveSetting("selectedPreset", name);
  document.querySelectorAll(".mods-dropdown-item-label").forEach(el => {
    el.classList.toggle("active", el.textContent === name);
  });
}

function checkDirty() {
  if (!currentPresetFilename) return;
  window.appInfo.checkPresetDirty(currentPresetFilename).then(result => {
    if (result.dirty !== presetDirty) {
      presetDirty = result.dirty;
      updateLabel();
    }
  });
}

function renderPresets(presets) {
  dropdownMenu.innerHTML = "";

  const btnRow = document.createElement("div");
  btnRow.className = "mods-dropdown-btn-row";

  const saveBtn = document.createElement("button");
  saveBtn.className = "mods-dropdown-btn";
  saveBtn.textContent = "Save";
  saveBtn.disabled = true;
  saveBtn.addEventListener("click", () => {
    if (currentPresetFilename) {
      window.appInfo.savePreset(currentPresetFilename);
      presetDirty = false;
      updateLabel();
      dropdownMenu?.classList.remove("open");
    }
  });
  btnRow.appendChild(saveBtn);

  const saveNewBtn = document.createElement("button");
  saveNewBtn.className = "mods-dropdown-btn";
  saveNewBtn.textContent = "Save As";
  btnRow.appendChild(saveNewBtn);

  dropdownMenu.appendChild(btnRow);

  const inputContainer = document.createElement("div");
  inputContainer.className = "mods-dropdown-input-container";

  const inputRow = document.createElement("div");
  inputRow.className = "mods-dropdown-input-row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "mods-dropdown-input";
  nameInput.placeholder = "Preset name...";
  inputRow.appendChild(nameInput);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "mods-dropdown-input-btn mods-dropdown-input-btn-cancel";
  cancelBtn.textContent = "✕";
  inputRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "mods-dropdown-input-btn mods-dropdown-input-btn-confirm";
  confirmBtn.textContent = "✓";
  inputRow.appendChild(confirmBtn);

  inputContainer.appendChild(inputRow);

  const inputDivider = document.createElement("div");
  inputDivider.className = "mods-dropdown-divider";
  inputContainer.appendChild(inputDivider);

  dropdownMenu.appendChild(inputContainer);

  function hideInput() {
    inputContainer.classList.remove("open");
    list.classList.remove("disabled");
    setTimeout(() => {
      updateSaveBtn();
      saveNewBtn.disabled = false;
    }, 200);
    nameInput.value = "";
    nameInput.classList.remove("mods-dropdown-input-error");
  }

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideInput();
  });

  confirmBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.classList.add("mods-dropdown-input-error");
      setTimeout(() => nameInput.classList.remove("mods-dropdown-input-error"), 1500);
      return;
    }
    pendingNewPreset = value;
    window.appInfo.createPreset(value);
    hideInput();
  });

  saveNewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    inputContainer.classList.add("open");
    list.classList.add("disabled");
    saveBtn.disabled = true;
    saveNewBtn.disabled = true;
    nameInput.focus();
  });

  const list = document.createElement("div");
  list.className = "mods-dropdown-list";
  dropdownMenu.appendChild(list);

  if (presets.length === 0) {
    const item = document.createElement("div");
    item.className = "mods-dropdown-item";
    item.textContent = "No presets";
    item.style.opacity = "0.4";
    item.style.cursor = "default";
    list.appendChild(item);
    return;
  }

  function appendPresetItem(preset) {
    const row = document.createElement("div");
    row.className = "mods-dropdown-item-row";

    const label = document.createElement("span");
    label.className = "mods-dropdown-item-label" + (preset.name === selectedPreset ? " active" : "");
    label.textContent = preset.name;
    label.addEventListener("click", () => {
      selectPreset(preset.name, preset.filename, preset.isDefault);
      window.appInfo.applyPreset(preset.filename);
    });
    row.appendChild(label);

    if (!preset.isDefault) {
      const delBtn = document.createElement("button");
      delBtn.className = "mods-dropdown-del-btn";
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (preset.filename === currentPresetFilename) {
          selectedPreset = null;
          currentPresetFilename = null;
          presetDirty = false;
          updateLabel();
        }
        window.appInfo.deletePreset(preset.filename);
      });
      row.appendChild(delBtn);
    }

    list.appendChild(row);
  }

  const defaultIdx = presets.findIndex(p => p.isDefault);
  if (defaultIdx !== -1) {
    const defaultPreset = presets[defaultIdx];
    appendPresetItem(defaultPreset);

    const divider = document.createElement("div");
    divider.className = "mods-dropdown-divider";
    list.appendChild(divider);

    const others = presets.filter((_, i) => i !== defaultIdx);
    others.forEach(preset => appendPresetItem(preset));
  } else {
    presets.forEach(preset => appendPresetItem(preset));
  }

  if (pendingNewPreset) {
    const match = presets.find(p => p.name === pendingNewPreset);
    if (match) {
      selectPreset(match.name, match.filename, match.isDefault);
      window.appInfo.applyPreset(match.filename);
    }
    pendingNewPreset = null;
  } else if (!selectedPreset && presets.length > 0) {
    selectPreset(presets[0].name, presets[0].filename, presets[0].isDefault);
    window.appInfo.applyPreset(presets[0].filename);
  } else if (selectedPreset && !currentPresetFilename) {
    const match = presets.find(p => p.name === selectedPreset);
    if (match) {
      currentPresetFilename = match.filename;
      currentPresetIsDefault = match.isDefault || false;
    }
  }

  updateSaveBtn();
}

dropdownToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (dropdownMenu.classList.contains("open")) {
    dropdownMenu.classList.remove("open");
  } else {
    closeAllDropdowns();
    dropdownMenu.classList.add("open");
  }
});

document.addEventListener("click", (e) => {
  if (!dropdownMenu?.contains(e.target)) {
    dropdownMenu?.classList.remove("open");
  }
});

window.appInfo.getSetting("selectedPreset").then(saved => {
  if (saved) {
    selectedPreset = saved;
    updateLabel();
  }
});

window.appInfo.scanPresets().then(renderPresets);
window.appInfo.onPresetsUpdated(renderPresets);

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

const confirmContainer = document.getElementById("new-game-confirm");
const confirmProceedBtn = document.getElementById("confirm-proceed");
const confirmCancelBtn = document.getElementById("confirm-cancel");

const cfConfirmContainer = document.getElementById("cf-confirm");
const cfProceedBtn = document.getElementById("cf-proceed");
const cfCancelBtn = document.getElementById("cf-cancel");

function showConfirmDialog(container, proceedBtn, cancelBtn) {
  return new Promise(resolve => {
    container.classList.remove("hidden");
    proceedBtn.onclick = () => {
      container.classList.add("hidden");
      resolve(true);
    };
    cancelBtn.onclick = () => {
      container.classList.add("hidden");
      resolve(false);
    };
  });
}

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

  
  if (!isNewGame && !forceDelete) {
    const needsWarning = await window.appInfo.checkCFWarning(activeMap);
    if (needsWarning) {
      button.disabled = true;
      if (continueBtn) continueBtn.disabled = true;
      const confirmed = await showConfirmDialog(cfConfirmContainer, cfProceedBtn, cfCancelBtn);
      if (!confirmed) {
        updateButtonsState(isServerRunningLocal);
        return;
      }
    }
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
  statusText.style.color = "";
  launchHadErrors = false;
  
  const result = await window.appInfo.launchDayZ(serverResult.installPath, activeMap);
   
  button.disabled = isServerRunningLocal;
  
  updateStorageStatus(activeMap);
  
  button.textContent = "New Game";
  spinner.classList.add("hidden");
  
  if (!isServerRunningLocal) {
    statusText.textContent = result.message;
    if (result.errors?.length) {
      statusText.style.color = "#e06c75";
      launchHadErrors = true;
    } else {
      launchHadErrors = false;
      setTimeout(() => {
        if (!isServerRunningLocal) {
          statusText.textContent = "";
          statusText.style.color = "";
        }
      }, 3000);
    }
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
    if (!launchHadErrors) {
      statusText.textContent = "DayZ server is running";
    }
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
