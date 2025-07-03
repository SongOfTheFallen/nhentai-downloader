/* eslint-disable no-console */
import express from "express";
import fs from "fs/promises";
import path from "path";

const PORT = process.env.PORT ?? 8080;
const MANGA_DIR = path.resolve("manga"); // folder with 1/, 2/, …
const AUTH_USER = process.env.AUTH_USER ?? "folly";
const AUTH_PASS = process.env.AUTH_PASS ?? "shenanigans";


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

app.use(express.static("public", { maxAge: "1h" })); // serve html/css/js
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

// -------- Start --------------------------------------------------------------
app.listen(PORT, () =>
  console.log(`🚀  http://localhost:${PORT}  (cache ${mangaCache.length})`)
);

