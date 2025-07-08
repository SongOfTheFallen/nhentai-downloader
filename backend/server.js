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
const APP_PASSWORD = process.env.APP_PASSWORD || "changeme";
const PORT = process.env.PORT ?? 5173;
const HOST = process.env.HOST || "0.0.0.0";
const MANGA_DIR = path.resolve("../manga");
const SUPPORTED = ["jpg","jpeg","png","webp","gif","bmp"];
const TEMP_DIR = path.join(os.tmpdir(), "nhentai-tmp");

async function cleanTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const files = await fs.readdir(TEMP_DIR);
    await Promise.all(files.map(f => fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})));
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
app.use((req,res,next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Auth-Token"
  );
  if (req.method === "OPTIONS") return res.end();
  next();
});
app.use((req,res,next) => {
  const header = req.headers["authorization"] || req.headers["x-auth-token"];
  const token  = header ? String(header).replace(/^Bearer\s+/i, "") : null;
  if (APP_PASSWORD && token !== APP_PASSWORD)
    return res.status(401).json({ error: "Unauthorized" });
  next();
});
app.use("/manga", express.static(MANGA_DIR, { maxAge: "1d" }));

let mangaCache = [];
let lastBuild = 0;

async function buildCache() {
  try {
    await fs.mkdir(MANGA_DIR, { recursive: true });
  } catch {}

  let dirs = [];
  try {
    dirs = await fs.readdir(MANGA_DIR, { withFileTypes: true });
  } catch (err) {
    console.error("Failed to read manga directory", err);
  }

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
    } catch (err) {
      console.warn(`Skipping ${n}: ${err.message}`);
    }
  }
  mangaCache = out;
  lastBuild = Date.now();
  console.log(`[cache] built ${out.length} manga`);
}

await buildCache();
await cleanTempDir();

app.post("/api/rescan", async (_req,res) => {
  await buildCache();
  res.json({ ok: true, rebuilt: mangaCache.length, ts: lastBuild });
});

app.get("/api/manga", (_req,res) => {
  res.setHeader("Cache-Control","no-store");
  res.json(mangaCache);
});

app.get("/api/manga/:num", (req,res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if(!entry) return res.status(404).end();
  res.json(entry);
});

app.get("/api/manga/:num/archive", async (req,res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if(!entry) return res.status(404).end();
  res.setHeader("Content-Type","application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${num}.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", err => { console.error(err); res.end(); });
  archive.pipe(res);
  for(let i=1;i<=entry.pages;i++) {
    const info = await findPage(num,i);
    if(info) archive.file(info.path,{ name: `${i}.${info.ext}` });
  }
  archive.file(path.join(MANGA_DIR, `${num}/meta.json`), { name: "meta.json" });
  archive.finalize();
});

app.get("/api/manga/:num/pdf", async (req,res) => {
  const num = +req.params.num;
  const entry = mangaCache.find(m => m.number === num);
  if(!entry) return res.status(404).end();
  try {
    await fs.mkdir(TEMP_DIR,{ recursive:true });
    const tmp = path.join(TEMP_DIR, `${num}-${Date.now()}.pdf`);
    const out = createWriteStream(tmp);
    const pdf = new PDFDocument({ autoFirstPage:false });
    pdf.pipe(out);
    for(let i=1;i<=entry.pages;i++) {
      const info = await findPage(num,i);
      if(!info) continue;
      const img = pdf.openImage(info.path);
      pdf.addPage({ size:[img.width,img.height], margin:0 });
      pdf.image(img,0,0);
    }
    pdf.end();
    out.on("close", () => {
      res.setHeader("Content-Type","application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${num}.pdf"`);
      const stream = createReadStream(tmp);
      stream.pipe(res);
      stream.on("close", () => fs.unlink(tmp).catch(() => {}));
    });
  } catch(err) {
    console.error(err);
    res.status(500).end();
  }
});

function gracefulExit() {
  cleanTempDir().finally(() => process.exit());
}
process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);

app.listen(PORT, HOST, () => {
  console.log(`🚀  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (cache ${mangaCache.length})`);
});
