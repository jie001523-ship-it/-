import { extractFontNames } from "/fontText.browser.js";

const state = {
  results: [],
  searching: false,
  activeFilter: null
};

const els = {
  fontInput: document.querySelector("#fontInput"),
  imageInput: document.querySelector("#imageInput"),
  searchBtn: document.querySelector("#searchBtn"),
  ocrStatus: document.querySelector("#ocrStatus"),
  resultsSection: document.querySelector("#resultsSection"),
  resultsHeader: document.querySelector("#resultsHeader"),
  resultCount: document.querySelector("#resultCount"),
  fontFilters: document.querySelector("#fontFilters"),
  resultList: document.querySelector("#resultList")
};

/* ── Image upload ── */
els.imageInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) processImage(file);
});

/* ── Clipboard paste ── */
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) processImage(file);
      return;
    }
  }
});

/* ── Search on Enter ── */
els.fontInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    searchFonts();
  }
});

/* ── Search button ── */
els.searchBtn.addEventListener("click", searchFonts);

/* ── OCR ── */

async function processImage(file) {
  els.ocrStatus.textContent = "正在识别，首次加载 OCR 引擎…";

  try {
    const worker = await loadTesseract();
    const { data } = await worker.recognize(file);
    await worker.terminate();

    const names = extractFontNames(data.text);

    els.fontInput.value = names.join("、");

    els.ocrStatus.textContent = names.length
      ? `识别到 ${names.length} 个候选字体名`
      : "未识别到字体名，可手动输入";

    // Auto-trigger search if font names were found
    if (names.length) {
      searchFonts();
    }
  } catch (err) {
    els.ocrStatus.textContent = `OCR 加载失败: ${err?.message || "网络超时"}`;
  }

  els.imageInput.value = "";
}

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract.createWorker("chi_sim+eng");

  const cdns = [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js"
  ];

  let lastError;
  for (const url of cdns) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`CDN 加载失败`));
        setTimeout(() => reject(new Error("加载超时")), 15000);
        document.head.appendChild(script);
      });
      return window.Tesseract.createWorker("chi_sim+eng");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("无法加载 OCR 引擎");
}

/* ── Search ── */

async function searchFonts() {
  const fontNames = extractFontNames(els.fontInput.value);
  els.fontInput.value = fontNames.join("、");

  if (!fontNames.length || state.searching) return;

  state.searching = true;
  state.activeFilter = null;
  els.searchBtn.disabled = true;
  els.searchBtn.style.opacity = "0.5";
  els.resultsSection.hidden = false;
  els.resultList.innerHTML = `<div class="loading-row">正在搜索 ${fontNames.length} 个字体…</div>`;

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fontNames })
    });
    const data = await response.json();
    state.results = data.results || [];
    renderResults();
  } catch {
    els.resultList.innerHTML = `<div class="loading-row">搜索失败，请确认服务仍在运行</div>`;
  } finally {
    state.searching = false;
    els.searchBtn.disabled = false;
    els.searchBtn.style.opacity = "";
  }
}

/* ── Render ── */

function renderResults() {
  els.resultList.innerHTML = "";

  if (!state.results.length) {
    els.resultsSection.hidden = true;
    return;
  }

  // Build header
  updateHeader();

  // Filter results
  const filtered = state.activeFilter
    ? state.results.filter(r => r.fontName === state.activeFilter)
    : state.results;

  let totalDirect = 0;

  for (const result of filtered) {
    for (const item of result.results) {
      const card = document.createElement("div");
      card.className = "result-card";

      const isDirect = item.kind === "direct";

      card.innerHTML = `
        <div class="result-info">
          <div class="result-font-name">${escapeHtml(result.fontName)}</div>
          <div class="result-source">
            <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
          </div>
        </div>
        ${isDirect ? `<button class="capsule-btn download-single" data-url="${escapeAttribute(item.url)}" data-font="${escapeAttribute(result.fontName)}">下载</button>` : ""}
      `;

      els.resultList.appendChild(card);

      if (isDirect) {
        totalDirect++;
        card.querySelector(".download-single")?.addEventListener("click", (e) => {
          const btn = e.currentTarget;
          downloadSingle(btn.dataset.font, btn.dataset.url, btn);
        });
      }
    }
  }
}

function updateHeader() {
  // Count
  const totalCards = state.results.reduce((sum, r) => sum + r.results.length, 0);
  els.resultCount.textContent = `${totalCards} 个结果`;

  // Font filters - only show if multiple fonts
  const fontNames = [...new Set(state.results.map(r => r.fontName))];
  els.fontFilters.innerHTML = "";

  if (fontNames.length <= 1) return;

  // "全部" chip
  const allChip = createChip("全部", null, state.activeFilter === null);
  els.fontFilters.appendChild(allChip);

  for (const name of fontNames) {
    const chip = createChip(name, name, state.activeFilter === name);
    els.fontFilters.appendChild(chip);
  }
}

function createChip(label, filterValue, isActive) {
  const chip = document.createElement("button");
  chip.className = "filter-chip" + (isActive ? " active" : "");
  chip.textContent = label;
  chip.addEventListener("click", () => {
    state.activeFilter = filterValue;
    // Update active states
    els.fontFilters.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    renderResults();
  });
  return chip;
}

/* ── Download ── */

async function downloadSingle(fontName, url, btn) {
  btn.disabled = true;
  btn.textContent = "下载中";

  try {
    const response = await fetch("/api/download-zip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ fontName, url }] })
    });
    const blob = await response.blob();
    triggerDownload(blob, `${fontName}.zip`);
  } catch {
    btn.textContent = "失败";
  } finally {
    btn.disabled = false;
    btn.textContent = "下载";
  }
}

function triggerDownload(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ── Utilities ── */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
