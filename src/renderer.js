const appName = window.appInfo?.name ?? "Electron";
document.title = appName;

let currentMap = "chernarus";

const serverIndicator = document.querySelector("[data-server-indicator]");
const gameIndicator = document.querySelector("[data-game-indicator]");
const bgLayers = [document.getElementById("bg-1"), document.getElementById("bg-2")];
const mapOptions = document.querySelectorAll(".map-option");
const continueBtn = document.querySelector(".continue-button");
const quickJoinCheckbox = document.getElementById("quick-join");
const disableBECheckbox = document.getElementById("disable-be");
const offlineModeCheckbox = document.getElementById("offline-mode");
const noZombiesCheckbox = document.getElementById("no-zombies");

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

document.getElementById("open-game-folder")?.addEventListener("click", () => {
  if (gameInstallPath) window.appInfo.openFolder(gameInstallPath);
});
document.getElementById("open-server-folder")?.addEventListener("click", () => {
  if (serverInstallPath) window.appInfo.openFolder(serverInstallPath);
});

document.getElementById("minimize")?.addEventListener("click", () => {
  window.appInfo?.minimize();
});

document.getElementById("close")?.addEventListener("click", () => {
  if (isServerRunningLocal) return;
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
let selectedMapEnv = {};

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
  if (currentMap !== "custom") {
    filtered = filtered.filter(mod => !(mod.mapEnvs?.length > 0));
  }
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

  const activeMapMod = mods.find(m => m.mapEnvs?.length > 0 && m.enabled);

  mods.forEach(mod => {
    const row = document.createElement("tr");
    row.classList.add("mod-row");
    const modKey = (mod.name || "").replace(/^@/, "").toLowerCase();
    if (duplicateFolders.has(modKey) && mod.enabled) {
      row.classList.add("duplicate");
    }
    const isMapMod = mod.mapEnvs?.length > 0;
    const isDisabledMapMod = isMapMod && activeMapMod && mod !== activeMapMod;
    if (isDisabledMapMod) {
      row.classList.add("map-mod-disabled");
    }

    const enabledCell = document.createElement("td");
    enabledCell.className = "col-enabled";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = mod.enabled;
    if (isDisabledMapMod) checkbox.disabled = true;
    checkbox.addEventListener("change", async () => {
      if (mod.mapEnvs?.length > 0 && checkbox.checked) {
        for (const other of allMods) {
          if (other !== mod && other.mapEnvs?.length > 0 && other.enabled) {
            await window.appInfo.toggleMod(other, false);
          }
        }
      }
      if (!checkbox.checked) {
        await window.appInfo.saveSetting("selectedMapEnv", "");
        await window.appInfo.saveSetting("selectedMapEnvFolder", "");
      } else {
        const env = mod.mapEnvs?.[0] || selectedMapEnv[mod.folderName] || "";
        selectedMapEnv[mod.folderName] = env;
        await window.appInfo.saveSetting("selectedMapEnv", env);
        await window.appInfo.saveSetting("selectedMapEnvFolder", mod.folderName);
      }
      await window.appInfo.toggleMod(mod, checkbox.checked);
      refreshSaves();
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
    if (mod.publishedId) {
      nameSpan.style.cursor = "pointer";
      nameSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        window.appInfo.openExternal(`steam://url/CommunityFilePage/${mod.publishedId}`);
      });
    }
    wrap.appendChild(nameSpan);
    if (mod.local) {
      const badge = document.createElement("span");
      badge.className = "local-badge";
      badge.textContent = "local";
      wrap.appendChild(badge);
    }
    if (mod.mapEnvs?.length > 0) {
      const badge = document.createElement("span");
      badge.className = "map-badge";
      badge.textContent = mod.mapEnvs.length > 1 ? "map+" : "map";
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

    if (mod.enabled && mod.mapEnvs && mod.mapEnvs.length > 1) {
      row.classList.add("mod-row-has-envs");
      const envRows = [];
      const activeEnv = selectedMapEnv[mod.folderName];
      for (const envName of mod.mapEnvs) {
        const isActive = envName === activeEnv;
        const envRow = document.createElement("tr");
        envRow.className = "mod-env-row";
        if (activeEnv && !isActive) envRow.classList.add("mod-env-disabled");
        const envEnabledCell = document.createElement("td");
        envEnabledCell.className = "col-enabled";
        envRow.appendChild(envEnabledCell);
        const envNameCell = document.createElement("td");
        envNameCell.className = "col-name";
        const envWrap = document.createElement("div");
        envWrap.className = "col-name-wrap";
        const envCheckbox = document.createElement("input");
        envCheckbox.type = "checkbox";
        envCheckbox.checked = isActive;
        envCheckbox.disabled = !!activeEnv && !isActive;
        envCheckbox.addEventListener("change", async () => {
          if (envCheckbox.checked) {
            selectedMapEnv[mod.folderName] = envName;
            await window.appInfo.saveSetting("selectedMapEnv", envName);
            await window.appInfo.saveSetting("selectedMapEnvFolder", mod.folderName);
            envRows.forEach(r => {
              const cb = r.querySelector("input[type=checkbox]");
              if (cb !== envCheckbox) {
                cb.checked = false;
                cb.disabled = true;
                r.classList.add("mod-env-disabled");
              }
            });
          } else {
            delete selectedMapEnv[mod.folderName];
            await window.appInfo.saveSetting("selectedMapEnv", "");
            await window.appInfo.saveSetting("selectedMapEnvFolder", "");
            envRows.forEach(r => {
              const cb = r.querySelector("input[type=checkbox]");
              cb.disabled = false;
              r.classList.remove("mod-env-disabled");
            });
          }
          if (currentMap === "custom") refreshSaves();
          updateButtonsState(isServerRunningLocal);
        });
        envWrap.appendChild(envCheckbox);
        const envNameSpan = document.createElement("span");
        envNameSpan.className = "col-env-name";
        envNameSpan.textContent = envName.split(/[\\/]/).pop();
        envWrap.appendChild(envNameSpan);
        envNameCell.appendChild(envWrap);
        envRow.appendChild(envNameCell);
        const envFolderCell = document.createElement("td");
        envFolderCell.className = "col-folder-btn";
        envRow.appendChild(envFolderCell);
        modsList.appendChild(envRow);
        envRows.push(envRow);
      }
      if (envRows.length > 0) {
        envRows[envRows.length - 1].classList.add("mod-env-last");
      }
    }
  });

  checkDirty();
  updateButtonsState(isServerRunningLocal);
}

function renderMods(mods) {
  allMods = mods;
  if (searchInput) searchInput.placeholder = `Search ${mods.length} mod${mods.length !== 1 ? "s" : ""}..`;
  filterMods();
}

function getMissionFolder(map) {
  if (map === "chernarus") return "dayzOffline.chernarusplus";
  if (map === "livonia") return "dayzOffline.enoch";
  if (map === "sakhal") return "dayzOffline.sakhal";
  const envEntry = Object.values(selectedMapEnv)[0];
  if (envEntry) return envEntry.split(/[\\/]/).pop();
  return null;
}

function refreshSaves() {
  const mf = getMissionFolder(currentMap);
  window.appInfo.scanSaves(currentMap, mf).then(renderSaves);
}

const mapBackgrounds = {
  chernarus: 'images/chernarus.png',
  livonia: 'images/livonia.png',
  sakhal: 'images/sakhal.png',
  custom: 'images/custom.png',
};

function setBackground(map) {
  currentMap = map;
  const imageUrl = mapBackgrounds[map];

  if (imageUrl) {
    const nextLayerIndex = 1 - activeLayerIndex;
    const currentLayer = bgLayers[activeLayerIndex];
    const nextLayer = bgLayers[nextLayerIndex];  
    
    nextLayer.style.backgroundImage = `url('${imageUrl}')`;
    nextLayer.classList.add("active");
    currentLayer.classList.remove("active");

    activeLayerIndex = nextLayerIndex;
  }

  mapOptions.forEach(opt => {
    opt.classList.toggle("active", opt.dataset.map === map);
  });
  
  window.appInfo?.saveSetting?.("selectedMap", map);
  
  refreshSaves();
  updateButtonsState(isServerRunningLocal);
  filterMods();
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

  noZombiesCheckbox?.addEventListener("change", () => {
    window.appInfo?.saveSetting?.("noZombies", noZombiesCheckbox.checked);
  });

(async () => {
  const settings = await window.appInfo?.getAllSettings?.() || {};
  const savedMap = settings.selectedMap || "chernarus";
  const quickJoin = !!settings.quickJoin;
  const disableBE = !!settings.disableBE;
  const offlineMode = !!settings.offlineMode;
  const noZombies = !!settings.noZombies;

  if (quickJoinCheckbox) quickJoinCheckbox.checked = quickJoin;
  if (disableBECheckbox) disableBECheckbox.checked = disableBE;
  if (offlineModeCheckbox) offlineModeCheckbox.checked = offlineMode;
  if (noZombiesCheckbox) noZombiesCheckbox.checked = noZombies;

  const envName = settings.selectedMapEnv || "";
  const envFolderName = settings.selectedMapEnvFolder || "";
  if (envName && envFolderName) {
    selectedMapEnv[envFolderName] = envName;
  }

  currentMap = savedMap;
  mapOptions.forEach(opt => {
    opt.classList.toggle("active", opt.dataset.map === savedMap);
  });
  
  const savedIndex = savedMap === "chernarus" ? 0 : 1;
  bgLayers.forEach((layer, i) => {
    if (i === savedIndex) {
      layer.classList.add("active");
      const url = mapBackgrounds[savedMap];
      if (url) layer.style.backgroundImage = `url('${url}')`;
    } else {
      layer.classList.remove("active");
    }
  });
  activeLayerIndex = savedIndex;
  
  
  checkSelectedSaveContent();
  filterMods();
})();

function setStatusIndicator(indicator, state, label) {
  if (!indicator) return;
  indicator.dataset.state = state;
  indicator.setAttribute("aria-label", label);
}

let gameInstallPath = null;
let serverInstallPath = null;

function updateServerStatus(result) {
  const state = result.found ? "online" : "offline";
  const label = result.found ? "DayZ Server found" : "DayZ Server not found";
  setStatusIndicator(serverIndicator, state, label);
  if (result.found) {
    serverInstallPath = result.installPath;
    refreshSaves();
  }
}

function updateGameStatus(result) {
  const state = result.found ? "online" : "offline";
  const label = result.found ? "DayZ found" : "DayZ not found";
  setStatusIndicator(gameIndicator, state, label);
  if (result.found) gameInstallPath = result.installPath;

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
    presetDirty = result.dirty;
    updateLabel();
  });
}

async function handleApplyPreset(filename) {
  const result = await window.appInfo.applyPreset(filename);
  if (!result) return;

  Object.keys(selectedMapEnv).forEach(k => delete selectedMapEnv[k]);

  if (result.selectedMapEnv && result.selectedMapEnvFolder) {
    selectedMapEnv[result.selectedMapEnvFolder] = result.selectedMapEnv;
  }

  if (result.mods?.length) {
    renderMods(result.mods);
  }

  if (result.selectedMap) {
    const activeMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";
    if (result.selectedMap !== activeMap) {
      setBackground(result.selectedMap);
    } else {
      currentMap = result.selectedMap;
      filterMods();
      refreshSaves();
      updateButtonsState(isServerRunningLocal);
    }
  }
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
      handleApplyPreset(preset.filename);
    });
    row.appendChild(label);

    if (!preset.isDefault) {
      const folderBtn = document.createElement("button");
      folderBtn.className = "mods-dropdown-folder-btn";
      folderBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      folderBtn.title = "Open presets folder";
      folderBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.appInfo.openPresetsFolder();
      });
      row.appendChild(folderBtn);

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
      handleApplyPreset(match.filename);
    }
    pendingNewPreset = null;
  } else if (!selectedPreset && presets.length > 0) {
    selectPreset(presets[0].name, presets[0].filename, presets[0].isDefault);
    handleApplyPreset(presets[0].filename);
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

const cfConfirmContainer = document.getElementById("cf-confirm");
const cfProceedBtn = document.getElementById("cf-proceed");
const cfCancelBtn = document.getElementById("cf-cancel");

const errorDialog = document.getElementById("error-dialog");
const errorDialogText = document.getElementById("error-dialog-text");
const errorDialogOk = document.getElementById("error-dialog-ok");
const errorDialogCopy = document.getElementById("error-dialog-copy");

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

async function handleLaunch(isNewGame = false, skipCFCheck = true) {
  const activeMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";
  const button = document.querySelector(".action-button");
  const statusText = document.getElementById("launch-status");

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
  
  checkSelectedSaveContent();
  
  button.textContent = "New Game";
  spinner.classList.add("hidden");
  
  if (!isServerRunningLocal) {
    if (result.errors?.length) {
      launchHadErrors = true;
      statusText.textContent = "";
      errorDialogText.textContent = result.errors.join("\n");
      errorDialog.classList.remove("hidden");
    } else {
      launchHadErrors = false;
      statusText.textContent = result.message;
      setTimeout(() => {
        if (!isServerRunningLocal) {
          statusText.textContent = "";
          statusText.style.color = "";
        }
      }, 3000);
    }
  }
  updateButtonsState(isServerRunningLocal);
}

let newGameRowActive = false;
let selectedSaveSlot = null;

async function checkSelectedSaveContent() {
  if (!continueBtn) return;
  if (!selectedSaveSlot) {
    continueBtn.disabled = true;
    continueBtn.textContent = "Continue";
    return;
  }
  const slot = selectedSaveSlot;
  const hasContent = await window.appInfo.checkSaveContent(currentMap, slot);
  if (selectedSaveSlot !== slot) return;
  if (isServerRunningLocal) { continueBtn.disabled = true; return; }
  continueBtn.disabled = false;
  continueBtn.textContent = hasContent ? "Continue" : "Launch";
}

function addNewGameInputRow() {
  if (newGameRowActive) return;
  newGameRowActive = true;

  const container = document.getElementById("saves-list");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "save-input-div";
  row.id = "new-game-input-row";
  row.innerHTML = `
    <div class="save-inline-row">
      <input type="text" class="save-inline-input" placeholder="New save name.." />
      <button class="save-inline-btn save-inline-close">${'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'}</button>
      <button class="save-inline-btn save-inline-confirm">&#10003;</button>
    </div>`;
  container.insertBefore(row, container.firstChild);

  const input = row.querySelector(".save-inline-input");
  const confirmBtn = row.querySelector(".save-inline-confirm");
  confirmBtn.disabled = true;
  input.addEventListener("input", () => {
    confirmBtn.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !confirmBtn.disabled) confirmBtn.click();
  });
  input.focus();
}

function removeNewGameInputRow() {
  const row = document.getElementById("new-game-input-row");
  if (row) row.remove();
  newGameRowActive = false;
}

errorDialogOk?.addEventListener("click", () => {
  errorDialog.classList.add("hidden");
});

errorDialogCopy?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(errorDialogText.textContent);
  const check = document.getElementById("copy-check");
  const text = document.getElementById("copy-btn-text");
  if (!check || !text) return;
  text.style.display = "none";
  check.style.display = "flex";
  setTimeout(() => {
    check.style.display = "none";
    text.style.display = "";
  }, 1200);
});

document.querySelector(".action-button").addEventListener("click", () => {
  addNewGameInputRow();
});
continueBtn?.addEventListener("click", async () => {
  if (!selectedSaveSlot) return;
  const hasContent = await window.appInfo.checkSaveContent(currentMap, selectedSaveSlot);
  if (!hasContent) {
    await window.appInfo.activateSaveSlot(currentMap, selectedSaveSlot);
    handleLaunch(false, true);
    return;
  }
  const targetMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";
  const needsWarning = await window.appInfo.checkCFWarning(targetMap, selectedSaveSlot);
  if (needsWarning) {
    const newGameBtn = document.querySelector(".action-button");
    newGameBtn.disabled = true;
    if (continueBtn) continueBtn.disabled = true;
    const confirmed = await showConfirmDialog(cfConfirmContainer, cfProceedBtn, cfCancelBtn);
    if (!confirmed) {
      updateButtonsState(isServerRunningLocal);
      return;
    }
  }
  await window.appInfo.activateSaveSlot(currentMap, selectedSaveSlot);
  handleLaunch(false, true);
});

function updateButtonsState(isServerRunning) {
  isServerRunningLocal = isServerRunning;
  const overlay = document.getElementById("server-overlay");
  if (overlay) overlay.classList.toggle("hidden", !isServerRunning);
  const newGameBtn = document.querySelector(".action-button");
  const statusText = document.getElementById("launch-status");
  const closeBtn = document.getElementById("close");
  if (closeBtn) closeBtn.disabled = isServerRunning;

  if (isServerRunning) {
    newGameBtn.disabled = true;
    if (continueBtn) continueBtn.disabled = true;
    if (!launchHadErrors) {
      statusText.textContent = "DayZ server is running";
    }
  } else {
    newGameBtn.disabled = false;
    
    const activeMap = document.querySelector(".map-option.active")?.dataset.map || "chernarus";

    if (currentMap === "custom") {
      const enabledMapMod = allMods.find(m => m.mapEnvs?.length > 0 && m.enabled);
      let canLaunch = false;
      let envName = "";
      if (enabledMapMod) {
        const envRelativePath = enabledMapMod.mapEnvs.length === 1
          ? enabledMapMod.mapEnvs[0]
          : selectedMapEnv[enabledMapMod.folderName];
        canLaunch = !!envRelativePath;
        envName = envRelativePath?.split(/[\\/]/).pop() || "";
      }
      newGameBtn.disabled = !canLaunch;
      if (continueBtn) {
        if (canLaunch) {
          checkSelectedSaveContent();
        } else {
          continueBtn.disabled = true;
        }
      }
    } else {
      checkSelectedSaveContent();
    }

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

function renderSaves(saves) {
  const container = document.getElementById("saves-list");
  if (!container) return;

  const existingInput = document.getElementById("new-game-input-row");
  container.innerHTML = "";

  if (!saves || saves.length === 0) {
    const empty = document.createElement("div");
    empty.className = "saves-empty";
    empty.textContent = "No saves yet";
    container.appendChild(empty);
    selectedSaveSlot = null;
    if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = "Continue"; }
    if (existingInput) container.insertBefore(existingInput, container.firstChild);
    return;
  }

  for (const [i, save] of saves.entries()) {
    const row = document.createElement("div");
    row.className = "save-row save-row-div" + (i === 0 ? " selected" : "");
    row.dataset.slot = save.name;
    row.dataset.path = save.path || "";
    const date = new Date(save.date);
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const defaultTag = save.name === "default" ? '<span class="save-default"> (default)</span>' : "";
    const svgFolder = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    const svgDel = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    const svgInfo = '<svg class="save-info-btn" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
    row.innerHTML = `
      <span class="save-name-wrap"><span class="save-name">${save.name}${defaultTag}</span>${svgInfo}</span>
      <span class="save-date">${dateStr}</span>
      <button class="save-folder-btn" title="Open save folder">${svgFolder}</button>
      <button class="save-del-btn" title="Delete save">${svgDel}</button>`;
    container.appendChild(row);
  }

  if (existingInput) container.insertBefore(existingInput, container.firstChild);

  const firstSelected = container.querySelector(".save-row.selected");
  if (firstSelected) {
    selectedSaveSlot = firstSelected.dataset.slot;
    checkSelectedSaveContent();
  } else {
    selectedSaveSlot = null;
    if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = "Continue"; }
  }
}

document.addEventListener("click", () => {
  document.querySelectorAll(".save-del-confirm").forEach(p => p.remove());
});

document.getElementById("saves-list")?.addEventListener("click", async (e) => {
  const infoBtn = e.target.closest(".save-info-btn");
  if (infoBtn) {
    const row = infoBtn.closest(".save-row");
    if (row) {
      const stats = await window.appInfo.getSaveStats(currentMap, row.dataset.slot);
      if (stats && stats.length > 0) {
        window.appInfo.openStatsWindow(row.dataset.slot, JSON.stringify(stats));
      }
    }
    return;
  }

  const saveRow = e.target.closest(".save-row");
  if (saveRow && !e.target.closest("button") && !e.target.closest(".save-info-btn")) {
    document.querySelectorAll(".save-row.selected").forEach(r => r.classList.remove("selected"));
    saveRow.classList.add("selected");
    selectedSaveSlot = saveRow.dataset.slot;
    checkSelectedSaveContent();
    return;
  }

  const folderBtn = e.target.closest(".save-folder-btn");
  if (folderBtn) {
    const row = folderBtn.closest(".save-row");
    if (row && row.dataset.path) window.appInfo.openFolder(row.dataset.path);
    return;
  }

  const delBtn = e.target.closest(".save-del-btn");
  if (delBtn) {
    e.stopPropagation();
    if (document.querySelector(".save-del-confirm")) {
      document.querySelectorAll(".save-del-confirm").forEach(p => p.remove());
      return;
    }
    const popup = document.createElement("div");
    popup.className = "save-del-confirm";
    popup.textContent = "Delete?";
    popup.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const row = ev.target.closest(".save-row");
      if (row) {
        await window.appInfo.deleteSaveSlot(currentMap, row.dataset.slot);
        refreshSaves();
      }
    });
    delBtn.parentNode.appendChild(popup);
    return;
  }

  const confirmBtn = e.target.closest(".save-inline-confirm");
  if (confirmBtn) {
    if (confirmBtn.disabled) return;
    const row = document.getElementById("new-game-input-row");
    if (!row) return;
    const input = row.querySelector(".save-inline-input");
    const slotName = input.value.trim();
    if (!slotName || slotName.toLowerCase() === "old") {
      input.classList.add("save-inline-input-error");
      setTimeout(() => input.classList.remove("save-inline-input-error"), 1500);
      return;
    }
    const result = await window.appInfo.createSaveSlot(currentMap, slotName);
    if (result === "exists") {
      input.classList.add("save-inline-input-error");
      setTimeout(() => input.classList.remove("save-inline-input-error"), 1500);
      return;
    }
    removeNewGameInputRow();
    refreshSaves();
    return;
  }

  const closeBtn = e.target.closest(".save-inline-close");
  if (closeBtn) {
    removeNewGameInputRow();
  }
});

refreshSaves();
window.appInfo.onSavesUpdated(renderSaves);
