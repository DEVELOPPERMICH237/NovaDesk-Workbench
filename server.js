"use strict";
// Workbench server (no npm dependencies).
//  - serves the web app from ./public
//  - GET  /api/health  -> { pdf: boolean }  (is LibreOffice available?)
//  - POST /convert?name=file.docx  (raw body) -> PDF
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // use 0.0.0.0 to accept outside connections
const MAX_MB = Number(process.env.MAX_FILE_MB) || 25;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS) || 120000;
const SOFFICE = process.env.SOFFICE_BIN || "soffice";
const GHOSTSCRIPT = process.env.GS_BIN || (process.platform === "win32" ? "gswin64c" : "gs");

const ALLOWED = new Set([".docx", ".xlsx", ".pptx", ".txt"]);
const ZIP_BASED = new Set([".docx", ".xlsx", ".pptx"]);

const PUBLIC = path.join(__dirname, "public");
const WORK_ROOT = path.join(os.tmpdir(), "workbench");
const LO_PROFILE = path.join(WORK_ROOT, "lo-profile");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- LibreOffice ----------
// One LibreOffice profile can't be shared by two running instances, so jobs run one at a time.
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

let pdfAvailable = false;
function probeLibreOffice() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(false); }, 20000);
    const child = spawn(SOFFICE, ["--version"], { stdio: "ignore" });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

function probeGhostscript() {
  return new Promise((resolve) => {
    const child = spawn(GHOSTSCRIPT, ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(false); }, 10000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

function compressPdf(inputPath, outputPath, preset) {
  const settings = { screen: "/screen", ebook: "/ebook", printer: "/printer" };
  const pdfSetting = settings[preset] || settings.ebook;
  return new Promise((resolve, reject) => {
    const child = spawn(GHOSTSCRIPT, [
      "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", `-dPDFSETTINGS=${pdfSetting}`,
      "-dNOPAUSE", "-dBATCH", "-dSAFER", `-sOutputFile=${outputPath}`, inputPath,
    ], { stdio: "ignore" });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(new HttpError(504, "PDF compression timed out."));
    }, TIMEOUT_MS);
    child.once("error", (error) => finish(new HttpError(503, "PDF compression is unavailable: " + error.message)));
    child.once("close", (code) => code === 0 ? finish() : finish(new HttpError(422, "Ghostscript could not compress this PDF.")));
  });
}

async function handlePdfCompression(req, res, url) {
  const declared = Number(req.headers["content-length"]);
  if (declared > MAX_BYTES) throw new HttpError(413, `File is larger than ${MAX_MB} MB.`);
  if (!(await probeGhostscript())) throw new HttpError(503, "PDF compression is unavailable on this server.");

  await fsp.mkdir(WORK_ROOT, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(WORK_ROOT, "compress-"));
  try {
    const inputPath = path.join(workDir, "input.pdf");
    const outputPath = path.join(workDir, "compressed.pdf");
    await saveBody(req, inputPath);
    const fh = await fsp.open(inputPath, "r");
    const head = Buffer.alloc(5);
    await fh.read(head, 0, head.length, 0);
    await fh.close();
    if (head.toString("ascii") !== "%PDF-") throw new HttpError(415, "This does not look like a PDF file.");

    const preset = url.searchParams.get("preset");
    await enqueue(() => compressPdf(inputPath, outputPath, preset));
    const { size } = await fsp.stat(outputPath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": size,
      "Content-Disposition": "attachment; filename=compressed.pdf",
      "Cache-Control": "no-store",
    });
    await pipeline(fs.createReadStream(outputPath), res);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function convertToPdf(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
      `-env:UserInstallation=${require("url").pathToFileURL(LO_PROFILE).href}`,
      "--convert-to", "pdf", "--outdir", outDir, inputPath,
    ];
    const child = spawn(SOFFICE, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new HttpError(504, "Conversion timed out.")); }, TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(new HttpError(503, "LibreOffice is not available: " + e.message)); });
    child.on("close", async (code) => {
      clearTimeout(timer);
      const pdf = path.join(outDir, path.basename(inputPath, path.extname(inputPath)) + ".pdf");
      try { await fsp.access(pdf); resolve(pdf); }
      catch {
        if (stderr) console.error(stderr);
        reject(new HttpError(422, "LibreOffice could not convert this file." + (code ? ` (exit ${code})` : "")));
      }
    });
  });
}

async function saveBody(req, dest) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(new HttpError(413, `File is larger than ${MAX_MB} MB.`));
      cb(null, chunk);
    },
  });
  await pipeline(req, limiter, fs.createWriteStream(dest));
  if (size === 0) throw new HttpError(400, "The file is empty.");
}

async function handleConvert(req, res, url) {
  const declared = Number(req.headers["content-length"]);
  if (declared > MAX_BYTES) throw new HttpError(413, `File is larger than ${MAX_MB} MB.`);

  const original = (url.searchParams.get("name") || "document.txt").slice(0, 255);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED.has(ext)) throw new HttpError(415, "Unsupported file type. Use DOCX, XLSX, PPTX or TXT.");

  await fsp.mkdir(WORK_ROOT, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(WORK_ROOT, "job-"));
  res.on("close", () => fsp.rm(workDir, { recursive: true, force: true }).catch(() => {}));

  const inputPath = path.join(workDir, "input" + ext); // the client's filename is never used on disk
  await saveBody(req, inputPath);

  if (ZIP_BASED.has(ext)) {
    const fh = await fsp.open(inputPath, "r");
    const head = Buffer.alloc(2);
    await fh.read(head, 0, 2, 0);
    await fh.close();
    if (head.toString("latin1") !== "PK") throw new HttpError(415, `This does not look like a real ${ext.slice(1).toUpperCase()} file.`);
  }

  const outDir = path.join(workDir, "out");
  await fsp.mkdir(outDir);
  const pdfPath = await enqueue(() => convertToPdf(inputPath, outDir));
  pdfAvailable = true;

  const base = path.basename(original, path.extname(original)).replace(/[\\/:*?"<>|\r\n]/g, "_") || "document";
  const { size } = await fsp.stat(pdfPath);
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.pdf`,
  });
  await pipeline(fs.createReadStream(pdfPath), res);
}

// ---------- static files ----------
async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, "Bad request."); }
  if (rel.includes("\0")) throw new HttpError(400, "Bad request.");
  if (rel === "/") rel = "/index.html";
  const file = path.join(PUBLIC, path.normalize(rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) throw new HttpError(404, "Not found.");
  let st;
  try { st = await fsp.stat(file); } catch { throw new HttpError(404, "Not found."); }
  if (!st.isFile()) throw new HttpError(404, "Not found.");
  let status = 200;
  let contentLength = st.size;
  let streamOptions;
  let contentRange;
  const extension = path.extname(file).toLowerCase();
  const cachePolicy = [".html", ".js", ".css", ".json"].includes(extension) ? "no-cache" : "public, max-age=3600";
  if (path.extname(file).toLowerCase() === ".mp4" && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}`, "Accept-Ranges": "bytes" });
      return res.end();
    }
    let start = match[1] ? Number(match[1]) : Math.max(0, st.size - Number(match[2]));
    let end = match[2] && match[1] ? Number(match[2]) : st.size - 1;
    if (!match[1]) end = st.size - 1;
    if (start >= st.size || end < start) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}`, "Accept-Ranges": "bytes" });
      return res.end();
    }
    end = Math.min(end, st.size - 1);
    status = 206;
    contentLength = end - start + 1;
    contentRange = `bytes ${start}-${end}/${st.size}`;
    streamOptions = { start, end };
  }
  res.writeHead(status, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": contentLength,
    ...(path.extname(file).toLowerCase() === ".mp4" ? { "Accept-Ranges": "bytes" } : {}),
    ...(contentRange ? { "Content-Range": contentRange } : {}),
    "Cache-Control": cachePolicy,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  await pipeline(fs.createReadStream(file, streamOptions), res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      if (!pdfAvailable) pdfAvailable = await probeLibreOffice(); // re-checked until found, so installing it needs no restart
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ pdf: pdfAvailable, pdfCompression: await probeGhostscript(), maxFileMb: MAX_MB }));
    }
    if (req.method === "POST" && url.pathname === "/convert") return await handleConvert(req, res, url);
    if (req.method === "POST" && url.pathname === "/compress-pdf") return await handlePdfCompression(req, res, url);
    if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res, url.pathname);
    throw new HttpError(405, "Method not allowed.");
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify({ error: status === 500 ? "Server error." : err.message }));
    } else res.destroy();
  }
});

server.requestTimeout = 5 * 60 * 1000;
server.listen(PORT, HOST, () => {
  console.log(`Workbench running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  probeLibreOffice().then((ok) => {
    pdfAvailable = ok;
    console.log(ok ? "LibreOffice found: Documents to PDF is enabled." : `LibreOffice not found ("${SOFFICE}"): Documents to PDF is disabled. Install it or set SOFFICE_BIN.`);
  });
});
