import { extractFontNames } from "/fontText.browser.js";

const state = {
  results: [],
  searching: false
};

const els = {
  screenshotInput: document.querySelector("#screenshotInput"),
  ocrStatus: document.querySelector("#ocrStatus"),
  fontInput: document.querySelector("#fontInput"),
  sampleButton: document.querySelector("#sampleButton"),
  extractButton: document.querySelector("#extractButton"),
  searchButton: document.querySelector("#searchButton"),
  downloadButton: document.querySelector("#downloadButton"),
  totalCount: document.querySelector("#totalCount"),
  foundCount: document.querySelector("#foundCount"),
  possibleCount: document.querySelector("#possibleCount"),
  emptyState: document.querySelector("#emptyState"),
  resultList: document.querySelector("#resultList")
};

els.sampleButton.addEventListener("click", () => {
  els.fontInput.value = ["方正兰亭黑", "思源黑体", "Helvetica Neue", "DIN", "苹方"].join("\n");
  normalizeInput();
});

els.extractButton.addEventListener("click", normalizeInput);
els.searchButton.addEventListener("click", searchFonts);
els.downloadButton.addEventListener("click", downloadZip);
els.screenshotInput.addEventListener("change", handleScreenshot);

function normalizeInput() {
  const names = extractFontNames(els.fontInput.value);
  els.fontInput.value = names.join("\n");
  updateCounts(names);
}

async function handleScreenshot(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  els.ocrStatus.textContent = "正在加载 OCR，首次可能需要一点时间";

  try {
    const worker = await loadTesseract();
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const names = extractFontNames(data.text);
    const existing = extractFontNames(els.fontInput.value);
    const merged = [...new Set([...existing, ...names])];
    els.fontInput.value = merged.join("\n");
    updateCounts(merged);
    els.ocrStatus.textContent = names.length ? `识别到 ${names.length} 个候选字体名` : "没有识别到字体名，可以手动粘贴";
  } catch {
    els.ocrStatus.textContent = "OCR 加载失败，请直接粘贴字体名";
  }
}

async function loadTesseract() {
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  return window.Tesseract.createWorker("chi_sim+eng");
}

async function searchFonts() {
  const fontNames = extractFontNames(els.fontInput.value);
  els.fontInput.value = fontNames.join("\n");
  updateCounts(fontNames);

  if (!fontNames.length || state.searching) return;

  state.searching = true;
  els.searchButton.disabled = true;
  els.searchButton.textContent = "搜索中";
  els.emptyState.hidden = true;
  els.resultList.innerHTML = `<div class="loading-row">正在搜索 ${fontNames.length} 个字体，结果会按可下载程度排序。</div>`;

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
    els.resultList.innerHTML = `<div class="loading-row">搜索失败，请确认本地服务仍在运行。</div>`;
  } finally {
    state.searching = false;
    els.searchButton.disabled = false;
    els.searchButton.textContent = "开始搜索";
  }
}

function renderResults() {
  els.resultList.innerHTML = "";
  els.emptyState.hidden = state.results.length > 0;

  for (const result of state.results) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-main">
        <div class="font-name">${escapeHtml(result.fontName)}</div>
        <span class="status ${result.status}">${statusLabel(result.status)}</span>
      </div>
      <div class="source-list">
        ${
          result.results.length
            ? result.results.map((item) => sourceTemplate(item)).join("")
            : `<div class="source-item"><div><strong>没有找到结果</strong><div class="source-meta">可以尝试删掉字体后缀、空格或重新截图。</div></div></div>`
        }
      </div>
    `;
    els.resultList.appendChild(card);
  }

  updateSummaryFromResults();
}

function sourceTemplate(item) {
  return `
    <div class="source-item">
      <div>
        <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
        <div class="source-meta">${escapeHtml(item.url)}</div>
      </div>
      <span class="kind">${kindLabel(item.kind, item.score)}</span>
    </div>
  `;
}

async function downloadZip() {
  const items = state.results
    .map((result) => {
      const direct = result.results.find((item) => item.kind === "direct");
      return direct ? { fontName: result.fontName, url: direct.url } : null;
    })
    .filter(Boolean);

  if (!items.length) return;

  els.downloadButton.disabled = true;
  els.downloadButton.textContent = "打包中";

  try {
    const response = await fetch("/api/download-zip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items })
    });
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `fonts-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  } finally {
    els.downloadButton.textContent = "打包下载";
    updateSummaryFromResults();
  }
}

function updateCounts(names) {
  els.totalCount.textContent = names.length;
}

function updateSummaryFromResults() {
  const found = state.results.filter((item) => item.status === "found").length;
  const possible = state.results.filter((item) => item.status === "possible" || item.status === "manual").length;
  els.totalCount.textContent = state.results.length || extractFontNames(els.fontInput.value).length;
  els.foundCount.textContent = found;
  els.possibleCount.textContent = possible;
  els.downloadButton.disabled = !state.results.some((result) => result.results.some((item) => item.kind === "direct"));
}

function statusLabel(status) {
  return {
    found: "可下载",
    possible: "疑似",
    manual: "需打开确认",
    not_found: "未找到"
  }[status] || "未知";
}

function kindLabel(kind, score) {
  return {
    direct: `直链 ${score}`,
    candidate: `候选 ${score}`,
    page: `页面 ${score}`
  }[kind] || `${score}`;
}

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
