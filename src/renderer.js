const appName = window.appInfo?.name ?? "Electron";
document.title = appName;

const serverIndicator = document.querySelector("[data-server-indicator]");
const serverMessage = document.querySelector("[data-server-message]");
const serverTableWrap = document.querySelector("[data-server-table-wrap]");
const serverTable = document.querySelector(".server-table");
const serverTableBody = document.querySelector("[data-server-table-body]");
const sortableHeaders = [...document.querySelectorAll("[data-sort-key]")];
const columnResizers = [...document.querySelectorAll("[data-column-index]")];

let currentBatchFiles = [];
let sortState = {
  key: "modifiedAtMs",
  direction: "desc"
};

function setServerStatus(state, label) {
  serverIndicator.dataset.state = state;
  serverIndicator.setAttribute("aria-label", label);
}

function formatModifiedAt(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getServerName(batchFile) {
  return batchFile.serverName || batchFile.title || batchFile.fileName || "";
}

function getSortValue(batchFile, key) {
  if (key === "serverName") {
    return getServerName(batchFile).toLowerCase();
  }

  if (key === "port" || key === "modCount" || key === "modifiedAtMs") {
    return Number(batchFile[key]) || 0;
  }

  return String(batchFile[key] || "").toLowerCase();
}

function getSortedBatchFiles() {
  const direction = sortState.direction === "asc" ? 1 : -1;

  return [...currentBatchFiles].sort((first, second) => {
    const firstValue = getSortValue(first, sortState.key);
    const secondValue = getSortValue(second, sortState.key);

    if (firstValue > secondValue) {
      return direction;
    }

    if (firstValue < secondValue) {
      return -direction;
    }

    return getServerName(first).localeCompare(getServerName(second));
  });
}

function updateSortHeaders() {
  for (const header of sortableHeaders) {
    const isActive = header.dataset.sortKey === sortState.key;
    const button = header.querySelector(".sort-button");

    header.dataset.sortDirection = isActive ? sortState.direction : "";
    header.setAttribute(
      "aria-sort",
      isActive ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"
    );
    button.setAttribute("aria-label", `Sort by ${button.textContent.trim()}`);
  }
}

function renderServerRows() {
  serverTableBody.replaceChildren();

  for (const batchFile of getSortedBatchFiles()) {
    const row = document.createElement("tr");
    row.className = "server-row";
    const values = [
      getServerName(batchFile),
      batchFile.port || "-",
      batchFile.configFile || "-",
      String(batchFile.modCount ?? 0),
      formatModifiedAt(batchFile.modifiedAt)
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }

    const detailRow = document.createElement("tr");
    detailRow.className = "detail-row";
    const detailCell = document.createElement("td");
    detailCell.colSpan = 5;

    const detailPanel = document.createElement("div");
    detailPanel.className = "detail-panel";
    detailPanel.innerHTML = `
      <div class="detail-content">
        <p>Server Details for ${getServerName(batchFile)}</p>
        <div class="detail-actions">
           <button class="action-button">Open Config</button>
           <button class="action-button.primary">Launch Server</button>
        </div>
      </div>
    `;

    detailCell.append(detailPanel);
    detailRow.append(detailCell);

    serverTableBody.append(row, detailRow);
  }

  updateSortHeaders();
}

function renderServerScan(result) {
  const hasServers = Boolean(result.server?.hasServerBatchFiles);
  const batchFiles = result.server?.batchFiles || [];

  setServerStatus(
    result.found ? "online" : "offline",
    result.found ? "DayZ Server found" : "DayZ Server not found"
  );

  currentBatchFiles = batchFiles;
  serverTableBody.replaceChildren();
  serverMessage.hidden = hasServers;
  serverTableWrap.hidden = !hasServers;

  if (!hasServers) {
    serverMessage.textContent = "No servers found";
    return;
  }

  renderServerRows();
}

async function scanForDayzServer() {
  try {
    const result = await window.appInfo.scanForDayzServer();
    renderServerScan(result);
  } catch (error) {
    setServerStatus("error", `DayZ Server scan failed: ${error.message}`);
    serverMessage.textContent = "No servers found";
    serverMessage.hidden = false;
    serverTableWrap.hidden = true;
    serverTableBody.replaceChildren();
  }
}

for (const header of sortableHeaders) {
  header.querySelector(".sort-button").addEventListener("click", () => {
    const key = header.dataset.sortKey;

    sortState = {
      key,
      direction: sortState.key === key && sortState.direction === "asc" ? "desc" : "asc"
    };

    renderServerRows();
  });
}


for (const resizer of columnResizers) {
  resizer.addEventListener("pointerdown", (event) => {
    const columnIndex = Number(resizer.dataset.columnIndex);
    const property = `--server-col-${columnIndex}`;
    const header = resizer.closest("th");
    const startX = event.clientX;
    const configuredWidth = Number.parseFloat(
      getComputedStyle(serverTable).getPropertyValue(property)
    );
    const startWidth = Number.isFinite(configuredWidth)
      ? configuredWidth
      : header.getBoundingClientRect().width;

    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-column");

    const allHeaders = [...serverTable.querySelectorAll("th")];
    const containerWidth = serverTableWrap.clientWidth;

    const getMinWidth = (th) => {
      const button = th.querySelector(".sort-button");
      if (!button) return 40;
      const measure = document.createElement("span");
      measure.style.visibility = "hidden";
      measure.style.position = "absolute";
      measure.style.whiteSpace = "nowrap";
      measure.style.font = getComputedStyle(button).font;
      measure.style.textTransform = getComputedStyle(button).textTransform;
      measure.style.letterSpacing = getComputedStyle(button).letterSpacing;
      measure.textContent = button.textContent;
      document.body.appendChild(measure);
      const width = Math.ceil(measure.getBoundingClientRect().width + 40);
      document.body.removeChild(measure);
      return width;
    };

    const minWidths = allHeaders.map(getMinWidth);
    const currentIndex = columnIndex - 1;
    const minWidth = minWidths[currentIndex];

    allHeaders.forEach((th, i) => {
      th.style.minWidth = `${minWidths[i]}px`;
    });

    const otherWidthsSum = allHeaders.reduce((sum, th, i) => {
      if (i === currentIndex) return sum;
      return sum + th.getBoundingClientRect().width;
    }, 0);

    let maxWidth = containerWidth - otherWidthsSum;
    const currentWidth = header.getBoundingClientRect().width;
    const availableSpace = containerWidth - allHeaders.reduce((sum, th) => sum + th.getBoundingClientRect().width, 0);

    const autoColumnsSpace = allHeaders.reduce((sum, th, i) => {
      if (i === currentIndex) return sum;
      const isAuto = !th.style.width && !getComputedStyle(serverTable).getPropertyValue(`--server-col-${i+1}`).includes('px');
      if (isAuto) {
        return sum + (th.getBoundingClientRect().width - minWidths[i]);
      }
      return sum;
    }, 0);

    maxWidth = currentWidth + autoColumnsSpace + Math.max(0, availableSpace);

    if (columnIndex === 2) {
      maxWidth = Math.min(maxWidth, 100);
    } else if (columnIndex === 4) {
      maxWidth = Math.min(maxWidth, 80);
    }

    function handlePointerMove(moveEvent) {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
      serverTable.style.setProperty(property, `${nextWidth}px`);
    }
    function handlePointerUp(upEvent) {
      resizer.releasePointerCapture(upEvent.pointerId);
      document.body.classList.remove("is-resizing-column");
      resizer.removeEventListener("pointermove", handlePointerMove);
      resizer.removeEventListener("pointerup", handlePointerUp);
      resizer.removeEventListener("pointercancel", handlePointerUp);

      allHeaders.forEach((th) => {
        th.style.minWidth = "";
      });
    }


    resizer.addEventListener("pointermove", handlePointerMove);
    resizer.addEventListener("pointerup", handlePointerUp);
    resizer.addEventListener("pointercancel", handlePointerUp);
  });
}

serverTableBody.addEventListener("click", (event) => {
  const row = event.target.closest(".server-row");
  if (!row) return;

  const alreadySelected = row.classList.contains("is-selected");

  for (const tr of serverTableBody.querySelectorAll(".server-row")) {
    tr.classList.remove("is-selected");
  }

  if (!alreadySelected) {
    row.classList.add("is-selected");
  }
});

scanForDayzServer();
window.appInfo.onDayzServerUpdated(renderServerScan);
