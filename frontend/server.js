/* eslint-disable no-console */
import express from "express";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();
const APP_PASSWORD = process.env.APP_PASSWORD;
if(!APP_PASSWORD) {
  console.log("No APP_PASSWORD set. Add it in a .env file to enable login.");
}

const PORT = process.env.PORT ?? 8787;
const PUBLIC_DIR = path.join(__dirname, "public");
const MANGA_DIR = path.resolve("../manga"); // folder with 1/, 2/, …
const SUPPORTED = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const TEMP_DIR = path.join(os.tmpdir(), "nhentai-tmp");
const PROTECT = !!APP_PASSWORD;

async function cleanTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const files = await fs.readdir(TEMP_DIR);
    await Promise.all(
      files.map(f => fs.unlink(path.join(TEMP_DIR, f)).catch(() => {}))
    );
  } catch {}
}

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
if (PROTECT) {
  app.use(express.urlencoded({ extended: false }));
  function parseCookies(c) {
    return Object.fromEntries((c || "").split(/; */).filter(Boolean).map(s => s.split("=").map(decodeURIComponent)));
  }
  app.get("/login", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(PUBLIC_DIR, "login.html"));
  });
  app.post("/login", (req, res) => {
    if (req.body.password === APP_PASSWORD) {
      res.cookie("auth", "1", { httpOnly: true });
      const dest = req.body.redirect || req.query.redirect || "/";
      return res.redirect(dest);
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(PUBLIC_DIR, "login.html"));
  });
  app.use((req, res, next) => {
    if (["/login", "/login.html", "/login.css"].includes(req.path)) return next();
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.auth === "1") return next();
    const dest = encodeURIComponent(req.originalUrl);
    res.redirect(`/login?redirect=${dest}`);
  });
} else {
  console.log("Password protection disabled");
}

app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));
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
await cleanTempDir();

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
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const tmp = path.join(TEMP_DIR, `${num}-${Date.now()}.pdf`);
    const out = createWriteStream(tmp);
    const pdf = new PDFDocument({ autoFirstPage: false });
    pdf.pipe(out);

    for (let i = 1; i <= entry.pages; i++) {
      const info = await findPage(num, i);
      if (!info) continue;
      const img = pdf.openImage(info.path);
      pdf.addPage({ size: [img.width, img.height], margin: 0 });
      pdf.image(img, 0, 0);
    }

    pdf.end();
    out.on('close', () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
      const stream = createReadStream(tmp);
      stream.pipe(res);
      stream.on('close', () => fs.unlink(tmp).catch(() => {}));
    });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Serve index.html for direct links like /123 or /123/1
app.get(/^\/(\d+)(?:\/(\d+))?\/?$/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
// Catch-all 404 page
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
});

// -------- Start --------------------------------------------------------------
function gracefulExit() {
  cleanTempDir().finally(() => process.exit());
}
process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀  http://localhost:${PORT}  (cache ${mangaCache.length})`)
);

