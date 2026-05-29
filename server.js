import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchResults, fetchDownloadCandidate } from "./src/search.js";
import { createZip } from "./src/zip.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = normalize(resolve(publicDir, `.${requestPath}`));

  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const ext = extname(target);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleBatchDownload(req, res) {
  const { items = [] } = await readJson(req);
  const files = [];
  const sourceLines = [
    `字体搜索来源记录`,
    `生成时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    ""
  ];

  for (const item of items.slice(0, 30)) {
    if (!item?.fontName || !item?.url) continue;

    const downloaded = await fetchDownloadCandidate(item.url);
    sourceLines.push(`${item.fontName}`);
    sourceLines.push(`来源: ${item.url}`);
    sourceLines.push(`结果: ${downloaded.ok ? "已打包" : downloaded.reason}`);
    sourceLines.push("");

    if (downloaded.ok) {
      files.push({
        name: `${safeFileName(item.fontName)}-${downloaded.fileName}`,
        data: downloaded.data
      });
    }
  }

  files.push({
    name: "来源说明.txt",
    data: Buffer.from(sourceLines.join("\n"), "utf8")
  });

  const zip = createZip(files);
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="fonts-${Date.now()}.zip"`,
    "content-length": zip.length
  });
  res.end(zip);
}

function safeFileName(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/search") {
      const { fontNames = [] } = await readJson(req);
      const results = await buildSearchResults(fontNames);
      sendJson(res, 200, { results });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/download-zip") {
      await handleBatchDownload(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务处理失败" });
  }
});

server.listen(port, () => {
  console.log(`Font Hunter running at http://localhost:${port}`);
});
