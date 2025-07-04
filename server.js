/* eslint-disable no-console */
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 8080;
const MANGA_DIR = path.resolve("manga"); // folder with 1/, 2/, …
const AUTH_USER = process.env.AUTH_USER ?? "folly";
const AUTH_PASS = process.env.AUTH_PASS ?? "shenanigans";
const SUPPORTED = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

async function findPage(num, page) {
  for (const ext of SUPPORTED) {
    try {
      const p = path.join(MANGA_DIR, `${num}/${page}.${ext}`);
      await fs.access(p);
      return { path: p, ext };
    } catch {}
  }
  return null;
}


const app = express();

app.use((req, res, next) => {
  const hdr = req.headers.authorization || "";
  if (hdr.startsWith("Basic ")) {
    const b64 = hdr.slice(6);
    const [user, pass] = Buffer.from(b64, "base64").toString().split(":");
    if (user === AUTH_USER && pass === AUTH_PASS) return next();
  }
  res.setHeader("WWW-Authenticate", "Basic realm=\"nhentai\"");
  res.status(401).end("Authentication required");
});

app.use(express.static("public", { maxAge: 0 })); // serve html/css/js without caching
app.use('/assets', express.static('assets'));
app.use("/manga", express.static(MANGA_DIR, { maxAge: "1d" })); // serve images


// -------- In-memory cache ----------------------------------------------------
let mangaCache = [];        // [{ number, pages, tags, … }]
let lastBuild = 0;

async function buildCache() {
  const dirs = await fs.readdir(MANGA_DIR, { withFileTypes: true });
  const numbers = dirs
    .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
    .map(d => +d.name)
    .sort((a, b) => a - b);

  const out = [];
  for (const n of numbers) {
    try {
      const metaRaw = await fs.readFile(path.join(MANGA_DIR, `${n}/meta.json`));
      const meta = JSON.parse(metaRaw);
      if (meta.pages > 0) out.push({ number: n, ...meta });
    } catch {
      /* ignore broken entries */
    }
  }
  mangaCache = out;
  lastBuild = Date.now();
  console.log(`[cache] built ${out.length} manga`);
}

// Build once at start-up
await buildCache();

// Optional: rebuild on demand (lightweight “rescan button”)
app.post("/api/rescan", async (_req, res) => {
  await buildCache();
  res.json({ ok: true, rebuilt: mangaCache.length, ts: lastBuild });
});

// -------- API end-points ------------------------------------------------------
app.get("/api/manga", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(mangaCache);            // whole list (≈50–300 kB for 10k items)
});

app.get("/api/manga/:num", (req, res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if (!entry) return res.status(404).end();
  res.json(entry);
});

app.get("/api/manga/:num/archive", async (req, res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if (!entry) return res.status(404).end();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${num}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { console.error(err); res.end(); });
  archive.pipe(res);
  for (let i = 1; i <= entry.pages; i++) {
    const info = await findPage(num, i);
    if (info) archive.file(info.path, { name: `${i}.${info.ext}` });
  }
  archive.file(path.join(MANGA_DIR, `${num}/meta.json`), { name: 'meta.json' });
  archive.finalize();
});

app.get("/api/manga/:num/pdf", async (req, res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if (!entry) return res.status(404).end();
  try {
    const pdf = await PDFDocument.create();
    for (let i = 1; i <= entry.pages; i++) {
      const info = await findPage(num, i);
      if (!info) continue;
      const data = await fs.readFile(info.path);
      let img;
      if (info.ext === 'jpg' || info.ext === 'jpeg') img = await pdf.embedJpg(data);
      else if (info.ext === 'png') img = await pdf.embedPng(data);
      else continue;
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const bytes = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Serve index.html for direct links like /123/1
app.get("/:num{/:page}", (req, res, next) => {
  if (/^\d+$/.test(req.params.num)) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    next();
  }
});
// Catch-all 404 page
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

// -------- Start --------------------------------------------------------------
app.listen(PORT, () =>
  console.log(`🚀  http://localhost:${PORT}  (cache ${mangaCache.length})`)
);

