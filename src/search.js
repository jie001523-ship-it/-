const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_FONTS = 20;
const MAX_RESULTS_PER_FONT = 8;
const DOWNLOAD_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2", ".zip", ".rar", ".7z"];
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"];

export async function buildSearchResults(fontNames) {
  const names = [...new Set((fontNames || []).map((name) => String(name).trim()).filter(Boolean))].slice(0, MAX_FONTS);
  const batches = [];
  const concurrency = 4;

  for (let i = 0; i < names.length; i += concurrency) {
    const group = names.slice(i, i + concurrency);
    batches.push(...(await Promise.all(group.map(searchFont))));
  }

  return batches;
}

async function searchFont(fontName) {
  const queries = [
    `${fontName} ttf`,
    `${fontName} otf`,
    `${fontName} 字体 下载`,
    `${fontName} font download`
  ];

  const found = [];
  for (const query of queries) {
    const results = await searchDuckDuckGo(query);
    for (const result of results) {
      if (!found.some((item) => item.url === result.url)) {
        found.push(scoreResult(fontName, result));
      }
    }
    if (found.length >= MAX_RESULTS_PER_FONT) break;
  }

  const enriched = await enrichWithDirectLinks(fontName, found);
  const sorted = enriched.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS_PER_FONT);
  const hasDownloadable = sorted.some((item) => item.downloadable);
  const hasLikely = sorted.some((item) => item.score >= 55);

  return {
    fontName,
    status: hasDownloadable ? "found" : hasLikely ? "possible" : sorted.length ? "manual" : "not_found",
    results: sorted,
    searchedAt: new Date().toISOString()
  };
}

async function enrichWithDirectLinks(fontName, results) {
  const directResults = [...results];
  const pagesToInspect = results
    .filter((item) => item.kind !== "direct" && item.score >= 55)
    .slice(0, 4);

  await Promise.all(
    pagesToInspect.map(async (item) => {
      const links = await findDownloadLinks(item.url);
      for (const link of links.slice(0, 3)) {
        if (directResults.some((existing) => existing.url === link.url)) continue;
        directResults.push({
          title: `${fontName} 下载链接 - ${link.fileName}`,
          url: link.url,
          snippet: `从候选页面 ${item.title} 发现`,
          score: Math.min(100, item.score + 18),
          downloadable: true,
          kind: "direct"
        });
      }
    })
  );

  return directResults;
}

async function findDownloadLinks(pageUrl) {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 FontHunter/0.1",
        "accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return [];

    const html = await response.text();
    const links = [];
    const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
    let match;

    while ((match = hrefPattern.exec(html))) {
      const href = decodeHtml(match[1]);
      const extension = getExtension(href);
      if (!DOWNLOAD_EXTENSIONS.includes(extension)) continue;

      try {
        const url = normalizeDownloadUrl(new URL(href, pageUrl).href);
        links.push({
          url,
          fileName: decodeURIComponent(new URL(url).pathname.split("/").pop() || `font${extension}`)
        });
      } catch {
        continue;
      }
    }

    return [...new Map(links.map((link) => [link.url, link])).values()];
  } catch {
    return [];
  }
}

async function searchDuckDuckGo(query) {
  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 FontHunter/0.1",
        "accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseDuckDuckGo(html);
  } catch {
    return [];
  }
}

function parseDuckDuckGo(html) {
  const results = [];
  const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = linkPattern.exec(html))) {
    const url = decodeDuckDuckGoUrl(decodeHtml(match[1]));
    const title = stripHtml(match[2]);
    const snippet = findSnippet(html, match.index);
    if (url && title) results.push({ title, url, snippet });
  }

  return results;
}

function findSnippet(html, fromIndex) {
  const chunk = html.slice(fromIndex, fromIndex + 2500);
  const snippet = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
  return snippet ? stripHtml(snippet[1] || snippet[2]) : "";
}

function decodeDuckDuckGoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch {
    return "";
  }
}

function scoreResult(fontName, result) {
  const haystack = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
  const normalizedName = fontName.toLowerCase();
  const downloadable = DOWNLOAD_EXTENSIONS.some((ext) => haystack.includes(ext));
  const directFile = DOWNLOAD_EXTENSIONS.some((ext) => result.url.toLowerCase().includes(ext));
  let score = 20;

  if (haystack.includes(normalizedName)) score += 40;
  if (downloadable) score += 25;
  if (directFile) score += 20;
  if (/font|字体|typeface|download|下载/i.test(haystack)) score += 10;
  if (/free|github|google|source|开源|免费/i.test(haystack)) score += 8;
  if (/crack|破解|高速下载|软件园|driver|apk/i.test(haystack)) score -= 35;

  return {
    ...result,
    score: Math.max(0, Math.min(100, score)),
    downloadable: directFile,
    kind: directFile ? "direct" : downloadable ? "candidate" : "page"
  };
}

export async function fetchDownloadCandidate(url) {
  try {
    const target = new URL(normalizeDownloadUrl(url));
    const extension = getExtension(target.pathname);
    if (!DOWNLOAD_EXTENSIONS.includes(extension)) {
      return { ok: false, reason: "不是直链文件" };
    }

    const response = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 FontHunter/0.1" },
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) return { ok: false, reason: `下载失败 HTTP ${response.status}` };

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 80 * 1024 * 1024) return { ok: false, reason: "文件超过 80MB" };

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (!looksLikeFontDownload(data, extension)) return { ok: false, reason: "文件格式不像字体或压缩包" };

    return {
      ok: true,
      data,
      fileName: decodeURIComponent(target.pathname.split("/").pop() || `font${extension}`)
    };
  } catch {
    return { ok: false, reason: "下载请求超时或被拦截" };
  }
}

function normalizeDownloadUrl(url) {
  try {
    const target = new URL(url);
    const githubBlob = target.hostname === "github.com"
      ? target.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
      : null;

    if (githubBlob) {
      const [, owner, repo, branch, filePath] = githubBlob;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    return target.href;
  } catch {
    return url;
  }
}

function looksLikeFontDownload(data, extension) {
  if (FONT_EXTENSIONS.includes(extension)) {
    const signature = data.subarray(0, 4).toString("latin1");
    return signature === "OTTO" || signature === "true" || signature === "ttcf" || data.readUInt32BE(0) === 0x00010000 || extension.startsWith(".woff");
  }

  if (extension === ".zip") return data.subarray(0, 2).toString("latin1") === "PK";
  if (extension === ".rar") return data.subarray(0, 4).toString("latin1") === "Rar!";
  if (extension === ".7z") return data.subarray(0, 6).toString("hex") === "377abcaf271c";
  return false;
}

function getExtension(pathname) {
  const clean = pathname.toLowerCase().split("?")[0].split("#")[0];
  return DOWNLOAD_EXTENSIONS.find((ext) => clean.endsWith(ext)) || "";
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
