/*****************************************************************************
 * CONSTANTS & STATE                                                         *
 *****************************************************************************/
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5173";
const API_KEY = import.meta.env.VITE_API_KEY || "changeme";
const API_LIST   = `${API_BASE}/api/manga`;   // GET  → cached list built by server
const API_RESCAN = `${API_BASE}/api/rescan`;  // POST → optional rebuild trigger
const API_STATS  = `${API_BASE}/api/stats`;
const MANGA_PATH = `${API_BASE}/manga`;       // static folder that contains pages
const supportedFormats = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const PAGE_SIZE = 30;                    // cards per batch
function authHeaders() { return { Authorization: `Bearer ${API_KEY}` }; }
let currentExt = supportedFormats[0];
let loginRequired = false;

const PAGE_CACHE_LIMIT = 10;             // max pages kept in memory
const PREFETCH_AHEAD   = 2;              // pages to prefetch after current
const pageCache = new Map();             // page -> { blob, ext }

let dirSizeBytes = 0;

function fmt(n, d = 0) {
  return Number(n)
    .toLocaleString("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/,/g, " ");
}

function formatSize(bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let n = bytes;
  while (i < units.length - 1 && n >= 1024) {
    n /= 1024;
    i++;
  }
  const d = i === 0 ? 0 : 1;
  return `${fmt(n, d)} ${units[i]}`;
}

function trimPageCache() {
  while (pageCache.size > PAGE_CACHE_LIMIT) {
    const key = pageCache.keys().next().value;
    pageCache.delete(key);
  }
}

async function fetchPageBlob(page) {
  if (pageCache.has(page)) return pageCache.get(page);
  const exts = [currentExt, ...supportedFormats.filter(e => e !== currentExt)];
  for (const ext of exts) {
    try {
      const res = await fetch(
        `${MANGA_PATH}/${currentManga}/${page}.${ext}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const data = { blob, ext };
      pageCache.set(page, data);
      trimPageCache();
      return data;
    } catch {}
  }
  throw new Error("page not found");
}

function prefetchPages(start) {
  for (let i = 0; i < PREFETCH_AHEAD; i++) {
    const p = start + i;
    if (p > maxPage) break;
    if (!pageCache.has(p)) fetchPageBlob(p).catch(() => {});
  }
}

let previewsOn  = true;
let libraryPage = 1;
let scrollAfterGrid = false;
let libraryScrollY = 0;
let mangaData   = [];                    // full list from server
let filteredManga = [];                  // after search/filter
let currentManga = null;
let currentPage  = 1;
let maxPage      = 1;
let libraryLoaded = false;
let pendingRoute = null;

/*****************************************************************************
 * INIT                                                                      *
 *****************************************************************************/
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const resp = await fetch(`${API_BASE}/api/login`);
    const data = await resp.json();
    loginRequired = data.required;
  } catch {}
  if (loginRequired) {
    const authed = document.cookie.split(';').some(c => c.trim() === 'auth=1');
    if (!authed) {
      const dest = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = `/login.html?redirect=${dest}`;
      return;
    }
  }
  const params = new URLSearchParams(location.search);
  const p = parseInt(params.get("p") || "1", 10);
  if (!Number.isNaN(p) && p > 0) libraryPage = p;

  handleRoute();                         // record route before data load
  setupUI();
  await loadLibrary();                   // first load
  libraryLoaded = true;
  handleRoute();                         // apply pending route
  window.addEventListener("popstate", handleRoute);
});

/*****************************************************************************
 * UI SETUP                                                                  *
 *****************************************************************************/
let thumbObserver;

function setupUI() {
  const sb = document.getElementById("searchBar");
  sb.addEventListener("input",  e => filterLibrary(e.target.value.trim()));
  sb.addEventListener("keydown", e => {
    if (e.key === "Escape") { sb.value = ""; filterLibrary(""); }
    if (e.key === "Enter")   filterLibrary(sb.value.trim());
  });

  document.getElementById("mangaGrid")
    .addEventListener(
      "click",
      e => {
        if (!e.target.classList.contains("tag")) return;
        e.stopPropagation();
        const tag  = e.target.textContent.trim();
        const sb   = document.getElementById("searchBar");
        const cur  = sb.value.trim();
        const token = tag.includes(" ") ? `"${tag}"` : tag;
        const parsed = parseWords(cur);
        if (!parsed.includes(tag.toLowerCase()))
          sb.value = cur ? `${cur} ${token}` : token;
        filterLibrary(sb.value.trim());
      },
      true
    );

  document.querySelector(".header h1").addEventListener("click", () => {
    location.href = "/";
  });

  document.getElementById("normalView").onclick  = () => setCompact(false);
  document.getElementById("compactView").onclick = () => setCompact(true);
  document.getElementById("previewToggle").onclick = togglePreviews;
  document.getElementById("randomizeBtn").onclick = randomizeLibrary;
  document.getElementById("randomBtn").onclick = openRandomManga;
  document.getElementById("pageInput")
    .addEventListener("change", e => {
      const n = parseInt(e.target.value, 10);
      if (!Number.isNaN(n)) gotoPage(n);
    });

  document.addEventListener("keydown", e => {
    if (!document.getElementById("readerView").classList.contains("active")) return;
    if (e.key === "ArrowRight")      nextPage();
    else if (e.key === "ArrowLeft")  previousPage();
    else if (e.key.toLowerCase() === "f") { toggleFullscreen(); e.preventDefault(); }
    else if (e.key === "Escape") {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else backToLibrary();
    }
  });

  const rc = document.getElementById("readerContainer");
  rc.addEventListener("click", e => {
    if (!document.getElementById("readerView").classList.contains("active")) return;
    if (e.target.classList?.contains("nav-button") || e.target.closest?.(".top-controls")) return;
    (e.clientX < window.innerWidth / 2 ? previousPage : nextPage)();
  });

  let startX = null;
  rc.addEventListener("touchstart", e => {
    if (e.touches.length === 1) startX = e.touches[0].clientX;
    else startX = null; // ignore multi-touch (pinch)
  });
  rc.addEventListener("touchmove", e => {
    if (e.touches.length > 1) startX = null;
  });
  rc.addEventListener("touchend", e => {
    if (startX === null || e.touches.length > 0) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) {
      dx < 0 ? nextPage() : previousPage();
    }
    startX = null;
  });

  document.querySelector(".top-controls").addEventListener("click", e => e.stopPropagation());
  const backBtn = document.querySelector(".back-button");
  const fsBtn   = document.querySelector(".fullscreen-btn");
  const prevBtn = document.querySelector(".nav-button.prev");
  const nextBtn = document.querySelector(".nav-button.next");
  backBtn.addEventListener("click", e => { e.stopPropagation(); backToLibrary(); });
  fsBtn.addEventListener("click", e => { e.stopPropagation(); toggleFullscreen(); });
  prevBtn.addEventListener("click", e => { e.stopPropagation(); previousPage(); });
  nextBtn.addEventListener("click", e => { e.stopPropagation(); nextPage(); });

  const scrollTopBtn = document.getElementById("scrollTopBtn");
  scrollTopBtn.onclick = () => window.scrollTo({ top : 0, behavior : "smooth" });
  window.addEventListener("scroll", () => {
    document.getElementById("searchContainer")
            .classList.toggle("compact", window.scrollY > 35);
    scrollTopBtn.style.display = window.scrollY > 200 ? "block" : "none";
  });

  thumbObserver = new IntersectionObserver(entries => {
    entries.forEach(ent => {
      if (ent.isIntersecting) { loadThumb(ent.target); thumbObserver.unobserve(ent.target); }
    });
  }, { root: null, rootMargin: "120px" });

  // “Rescan” button asks server to rebuild cache, then reloads JSON
  document.getElementById("rescanBtn").onclick = () => loadLibrary(true);
}

/*****************************************************************************
 * LOAD LIBRARY FROM SERVER                                                  *
 *****************************************************************************/
async function loadLibrary(rescan = false) {
  showLoader(true);
  try {
    if (rescan) await fetch(API_RESCAN, { method: "POST", headers: authHeaders() });        // optional
    const res = await fetch(API_LIST, { cache: "no-store", headers: authHeaders() });
    if (!res.ok) throw new Error(`status ${res.status}`);
    mangaData     = await res.json();
    filteredManga = [...mangaData];

    try {
      const sres = await fetch(API_STATS, { cache: "no-store", headers: authHeaders() });
      if (sres.ok) {
        const stats = await sres.json();
        dirSizeBytes = stats.dirSizeBytes || 0;
      }
    } catch {}

    updateStats();
    updateCounts();
    renderGrid();
  } catch (err) {
    console.error(err);
    alert("Failed to load manga list from server.");
  } finally {
    showLoader(false);
  }
}

function showLoader(on) {
  document.getElementById("loadingLibrary").style.display = on ? "block" : "none";
}

function parseWords(q) {
  const words = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) words.push((m[1] || m[2]).toLowerCase());
  return words;
}

function cmp(val, op, target) {
  switch (op) {
    case '<':  return val < target;
    case '<=': return val <= target;
    case '>':  return val > target;
    case '>=': return val >= target;
    case '=':  return val === target;
    default:   return false;
  }
}

function handleRoute() {
  const match = location.pathname.match(/^\/(\d+)(?:\/(\d+))?$/);

  if (!libraryLoaded) {
    pendingRoute = match;
    return;
  }

  const route = match || pendingRoute;
  pendingRoute = null;

  if (route) {
    const num  = parseInt(route[1], 10);
    const page = route[2] ? parseInt(route[2], 10) : 1;
    openManga(num, page, false);
  } else {
    backToLibrary(false);
    const params = new URLSearchParams(location.search);
    const p = parseInt(params.get("p") || "1", 10);
    libraryPage = !Number.isNaN(p) && p > 0 ? p : 1;
    renderGrid();
  }
}

/*****************************************************************************
 * FILTERING                                                                 *
 *****************************************************************************/
function filterLibrary(q) {
  q = q.trim();

  let sortField = null;
  let sortDir   = 1;

  const tokens  = q ? parseWords(q) : [];
  const words   = [];
  for (const t of tokens) {
    const s = t.match(/^sort:([-]?)(id|pages|age)$/);
    if (s) {
      sortField = s[2];
      sortDir   = s[1] === '-' ? -1 : 1;
    } else {
      words.push(t);
    }
  }

  if (!words.length) filteredManga = [...mangaData];
  else if (words[0] && words[0].startsWith("#") && words.length === 1) {
    const n = words[0].slice(1);
    filteredManga = mangaData.filter(m => String(m.number).includes(n));
  } else {
    filteredManga = mangaData.filter(m => {
      const tagset = [
        ...(m.tags || []),
        ...(m.artists || []),
        ...(m.characters || []),
        ...(m.parodies || []),
        ...(m.groups || []),
        ...(m.languages || []),
        ...(m.categories || []),
      ].map(t => t.name.toLowerCase());

      const time = m.datetime_iso8601 ? new Date(m.datetime_iso8601).getTime() : 0;

      return words.every(w => {
        let m1;
        if ((m1 = w.match(/^([<>]=?|=)(\d+)$/))) {
          const [, op, val] = m1;
          return cmp(m.pages, op, +val);
        }
        if ((m1 = w.match(/^time=([0-9-]+)\.\.([0-9-]+)$/))) {
          const [, from, to] = m1;
          const f = new Date(from).getTime();
          const t = new Date(to).getTime();
          return time >= f && time <= t;
        }
        if ((m1 = w.match(/^time([<>]=?|=)([0-9-]+)$/))) {
          const [, op, date] = m1;
          return cmp(time, op, new Date(date).getTime());
        }
        return tagset.some(t => t.includes(w));
      });
    });
  }
  if (sortField) {
    const getter = {
      id:    m => m.number,
      pages: m => m.pages,
      age:   m => m.datetime_iso8601 ? new Date(m.datetime_iso8601).getTime() : 0,
    }[sortField];
    filteredManga.sort((a, b) => sortDir * (getter(a) - getter(b)));
  }

  libraryPage = 1;
  updateCounts();
  renderGrid();
}

/*****************************************************************************
 * GRID RENDER                                                               *
 *****************************************************************************/
function renderGrid() {
  const grid  = document.getElementById("mangaGrid");
  const empty = document.getElementById("noResults");

  if (!filteredManga.length) {
    grid.innerHTML = "";
    empty.style.display = "block";
    document.getElementById("pagination").innerHTML = "";
    updateLibraryURL();
    return;
  }
  empty.style.display = "none";

  const start = (libraryPage - 1) * PAGE_SIZE;
  const frag = document.createDocumentFragment();
  filteredManga.slice(start, start + PAGE_SIZE).forEach(m => frag.appendChild(createCard(m)));
  grid.innerHTML = "";
  grid.appendChild(frag);

  updatePagination();

  updateLibraryURL();

  updateCounts();

  if (scrollAfterGrid) {
    scrollAfterGrid = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function createCard(m) {
  const card = document.createElement("div");
  card.className = "manga-card";
  card.onclick   = () => openManga(m.number);

  const thumbHTML = `<img class="manga-thumb" data-number="${m.number}" alt="thumb">`;
  const tags = [
    ...(m.artists     || []).map(t => ({...t, tType : "artist"})),
    ...(m.characters  || []).map(t => ({...t, tType : "character"})),
    ...(m.parodies    || []).map(t => ({...t, tType : "parody"})),
    ...(m.categories  || []).map(t => ({...t, tType : "category"})),
    ...(m.languages   || []).map(t => ({...t, tType : "language"})),
    ...(m.groups      || []).map(t => ({...t, tType : "group"})),
    ...(m.tags        || []).map(t => ({...t, tType : "tag"})),
  ];

  card.innerHTML =
    `${thumbHTML}
     <div class="manga-number">#${m.number}</div>
     <div class="manga-info">${m.pages} pages</div>
     <div class="manga-info">${m.time_relative || "–"}</div>
     ${m.artists?.[0] ? `<div class="manga-info">by ${m.artists[0].name}</div>` : ""}
     <div class="manga-tags">
       ${tags.map(t => `<span class="tag ${t.tType}">${t.name}</span>`).join("")}
     </div>`;

  const dlBtn  = document.createElement('button');
  dlBtn.className = 'download-btn';
  dlBtn.textContent = '↓';
  dlBtn.title = 'Download';

  const menu = document.createElement('div');
  menu.className = 'download-menu';
  menu.innerHTML = '<button data-type="archive">Archive</button><button data-type="pdf">PDF</button>';

  dlBtn.onclick = e => {
    e.stopPropagation();
    closeAllMenus();
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  };

  menu.onclick = e => {
    e.stopPropagation();
    const type = e.target.dataset.type;
    if (!type) return;
    downloadManga(m.number, type);
    menu.style.display = 'none';
  };

  card.appendChild(dlBtn);
  card.appendChild(menu);

  if (previewsOn) thumbObserver.observe(card.querySelector(".manga-thumb"));
  return card;
}

async function downloadManga(num, type) {
  try {
    const res = await fetch(`${API_BASE}/api/manga/${num}/${type}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const blob = await res.blob();
    let filename = `doujinshi_${String(num).padStart(5, "0")}.${
      type === "archive" ? "zip" : "pdf"}`;
    const disp = res.headers.get("content-disposition");
    if (disp) {
      const m = /filename="?([^";]+)"?/i.exec(disp);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert("Download failed");
  }
}

function closeAllMenus() {
  document.querySelectorAll('.download-menu').forEach(m => {
    m.style.display = 'none';
  });
}

document.addEventListener('click', closeAllMenus);

function loadThumb(img) {
  if (img.dataset.loaded) return;
  const num = img.dataset.number;
  let idx   = 0;

  const tryNext = async () => {
    if (idx >= supportedFormats.length) {
      img.closest(".manga-card")?.remove();
      updateCounts();
      return;
    }
    const ext = supportedFormats[idx++];
    try {
      const res = await fetch(
        `${MANGA_PATH}/${num}/1.${ext}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        img.dataset.loaded = true;
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        tryNext();
      };
      img.src = url;
    } catch {
      tryNext();
    }
  };

  tryNext();
}

/*****************************************************************************
 * STATS & COUNTS                                                            *
 *****************************************************************************/
function updateStats() {
  const el = document.getElementById("statsDisplay");
  if (!mangaData.length) { el.textContent = "No manga loaded"; return; }
  const pages = mangaData.reduce((s, m) => s + m.pages, 0);
  el.textContent = `${fmt(mangaData.length)} manga • ${fmt(pages)} pages • ${formatSize(dirSizeBytes)}`;
}

function updateCounts() {
  const start = (libraryPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(libraryPage * PAGE_SIZE, filteredManga.length);
  document.getElementById("resultsCount").textContent =
    `${fmt(start)}-${fmt(end)} / ${fmt(filteredManga.length)}`;
}

function updateLibraryURL() {
  if (!libraryLoaded || pendingRoute) return;
  const url = libraryPage > 1 ? `/?p=${libraryPage}` : "/";
  history.replaceState({}, "", url);
}

function updatePagination() {
  const totalPages = Math.ceil(filteredManga.length / PAGE_SIZE);
  const container = document.getElementById("pagination");
  container.innerHTML = "";
  if (totalPages <= 1) return;
  const addBtn = i => {
    const b = document.createElement("button");
    b.textContent = i;
    b.className = "page-btn" + (i === libraryPage ? " active" : "");
    b.onclick = () => {
      libraryPage = i;
      scrollAfterGrid = true;
      renderGrid();
    };
    container.appendChild(b);
  };
  const addDots = () => {
    const s = document.createElement("span");
    s.textContent = "...";
    container.appendChild(s);
  };

  const around = 4; // pages shown around current
  let start = Math.max(2, libraryPage - around);
  let end   = Math.min(totalPages - 1, libraryPage + around);

  if (start === 2) end = Math.min(totalPages - 1, start + around * 2);
  if (end === totalPages - 1) start = Math.max(2, end - around * 2);

  addBtn(1);
  if (start > 2) addDots();
  for (let i = start; i <= end; i++) addBtn(i);
  if (end < totalPages - 1) addDots();
  if (totalPages > 1) addBtn(totalPages);
}

/*****************************************************************************
 * VIEW OPTIONS                                                              *
 *****************************************************************************/
function setCompact(c) {
  document.getElementById("mangaGrid").classList.toggle("compact", c);
  document.getElementById("normalView").classList.toggle("active", !c);
  document.getElementById("compactView").classList.toggle("active",  c);
}

function togglePreviews() {
  previewsOn = !previewsOn;
  document.body.classList.toggle("no-previews", !previewsOn);
  document.getElementById("previewToggle").textContent =
    previewsOn ? "Hide Thumbs" : "Show Thumbs";

  if (previewsOn) {
    document.querySelectorAll(".manga-thumb:not([data-loaded])")
            .forEach(img => thumbObserver.observe(img));
  } else {
    document.querySelectorAll(".manga-thumb")
            .forEach(img => thumbObserver.unobserve(img));
  }
}

function randomizeLibrary() {
  for (let i = filteredManga.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filteredManga[i], filteredManga[j]] = [filteredManga[j], filteredManga[i]];
  }
  libraryPage = 1;
  renderGrid();
}

async function mangaHasFirstPage(num) {
  for (const ext of supportedFormats) {
    try {
      const res = await fetch(
        `${MANGA_PATH}/${num}/1.${ext}`,
        { method: "HEAD", headers: authHeaders() }
      );
      if (res.ok) return true;
    } catch {}
  }
  return false;
}

async function openRandomManga() {
  if (!mangaData.length) return;
  const tried = new Set();
  while (tried.size < mangaData.length) {
    const idx = Math.floor(Math.random() * mangaData.length);
    const entry = mangaData[idx];
    if (tried.has(entry.number)) continue;
    tried.add(entry.number);
    if (await mangaHasFirstPage(entry.number)) {
      openManga(entry.number, 1, true);
      return;
    }
  }
  alert("No valid manga available.");
}

/*****************************************************************************
 * READER                                                                    *
 *****************************************************************************/
function openManga(num, page = 1, pushHistory = true) {
  libraryScrollY = window.scrollY;
  currentManga = num;
  const meta   = mangaData.find(m => m.number === num);
  if (!meta) return;

  maxPage = meta.pages;
  currentPage = Math.min(Math.max(page, 1), maxPage);
  document.getElementById("totalPages").textContent = maxPage;
  document.getElementById("pageInput").value = currentPage;

  document.getElementById("libraryView").style.display = "none";
  document.getElementById("readerView").classList.add("active");

  if (pushHistory) history.pushState({}, "", `/${currentManga}/${currentPage}`);

  currentExt = supportedFormats[0];
  pageCache.clear();
  loadPage();
}

async function loadPage() {
  const img    = document.getElementById("mangaImage");
  const loader = document.getElementById("loading");
  const err    = document.getElementById("error");
  loader.style.display = "block";
  img.classList.remove("active");
  err.style.display = "none";

  try {
    const { blob, ext } = await fetchPageBlob(currentPage);
    currentExt = ext;
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      img.onload = () => { URL.revokeObjectURL(url); resolve(); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
    loader.style.display = "none";
    img.classList.add("active");
    prefetchPages(currentPage + 1);
    return;
  } catch {
    loader.style.display = "none";
    err.style.display = "block";
  }
}

function nextPage() {
  if (!currentManga || currentPage >= maxPage) return;
  currentPage++;
  document.getElementById("pageInput").value = currentPage;
  loadPage();
  history.replaceState({}, "", `/${currentManga}/${currentPage}`);
}

function previousPage() {
  if (!currentManga || currentPage <= 1) return;
  currentPage--;
  document.getElementById("pageInput").value = currentPage;
  loadPage();
  history.replaceState({}, "", `/${currentManga}/${currentPage}`);
}

function gotoPage(n) {
  if (!currentManga || n < 1 || n > maxPage) return;
  currentPage = n;
  loadPage();
  history.replaceState({}, "", `/${currentManga}/${currentPage}`);
}

function backToLibrary(pushHistory = true) {
  document.getElementById("readerView").classList.remove("active");
  document.getElementById("libraryView").style.display = "";
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  currentManga = null;
  currentPage  = 1;
  pageCache.clear();
  window.scrollTo(0, libraryScrollY);
  if (pushHistory) history.pushState({}, "", "/");
}

function toggleFullscreen() {
  const rv = document.getElementById("readerView");
  if (!document.fullscreenElement) rv.requestFullscreen?.();
  else                             document.exitFullscreen?.();
}

