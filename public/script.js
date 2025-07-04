/*****************************************************************************
 * CONSTANTS & STATE                                                         *
 *****************************************************************************/
const API_LIST   = "/api/manga";   // GET  → cached list built by server
const API_RESCAN = "/api/rescan";  // POST → optional rebuild trigger
const MANGA_PATH = "/manga";       // static folder that contains pages

const supportedFormats = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const PAGE_SIZE = 250;                   // cards per batch

let previewsOn  = true;
let libraryPage = 1;
let libraryScrollY = 0;
let mangaData   = [];                    // full list from server
let filteredManga = [];                  // after search/filter
let currentManga = null;
let currentPage  = 1;
let maxPage      = 1;
let libraryLoaded = false;

/*****************************************************************************
 * INIT                                                                      *
 *****************************************************************************/
window.addEventListener("DOMContentLoaded", async () => {
  setupUI();
  await loadLibrary();                   // first load
  libraryLoaded = true;
  handleRoute();
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
    location.reload();
  });

  document.getElementById("normalView").onclick  = () => setCompact(false);
  document.getElementById("compactView").onclick = () => setCompact(true);
  document.getElementById("previewToggle").onclick = togglePreviews;
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

  document.querySelector(".top-controls").addEventListener("click", e => e.stopPropagation());
  document.querySelectorAll(".fullscreen-btn, .back-button").forEach(btn =>
    btn.addEventListener("click", e => e.stopPropagation())
  );

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
    if (rescan) await fetch(API_RESCAN, { method : "POST" });        // optional
    const res = await fetch(API_LIST, { cache : "no-store" });
    mangaData     = await res.json();
    filteredManga = [...mangaData];

    libraryPage = 1;
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

function handleRoute() {
  if (!libraryLoaded) return;
  const match = location.pathname.match(/^\/(\d+)(?:\/(\d+))?$/);
  if (match) {
    const num  = parseInt(match[1], 10);
    const page = match[2] ? parseInt(match[2], 10) : 1;
    openManga(num, page, false);
  } else {
    backToLibrary(false);
  }
}

/*****************************************************************************
 * FILTERING                                                                 *
 *****************************************************************************/
function filterLibrary(q) {
  q = q.trim();
  if (!q) filteredManga = [...mangaData];
  else if (q.startsWith("#")) {
    const n = q.slice(1);
    filteredManga = mangaData.filter(m => String(m.number).includes(n));
  } else {
    const words = parseWords(q);
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
      return words.every(w => tagset.some(t => t.includes(w)));
    });
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
    return;
  }
  empty.style.display = "none";

  const start = (libraryPage - 1) * PAGE_SIZE;
  const frag = document.createDocumentFragment();
  filteredManga.slice(start, start + PAGE_SIZE).forEach(m => frag.appendChild(createCard(m)));
  grid.innerHTML = "";
  grid.appendChild(frag);

  updatePagination();

  updateCounts();
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

  if (previewsOn) thumbObserver.observe(card.querySelector(".manga-thumb"));
  return card;
}

function loadThumb(img) {
  if (img.dataset.loaded) return;
  const num = img.dataset.number;
  let idx   = 0;

  const tryNext = () => {
    if (idx >= supportedFormats.length) {
      img.closest(".manga-card")?.remove();
      updateCounts();
      return;
    }
    img.src = `${MANGA_PATH}/${num}/1.${supportedFormats[idx++]}`;
  };

  img.onload  = () => { img.dataset.loaded = true; };
  img.onerror = tryNext;
  tryNext();
}

/*****************************************************************************
 * STATS & COUNTS                                                            *
 *****************************************************************************/
function updateStats() {
  const el = document.getElementById("statsDisplay");
  if (!mangaData.length) { el.textContent = "No manga loaded"; return; }
  const pages = mangaData.reduce((s, m) => s + m.pages, 0);
  el.textContent = `${mangaData.length} manga • ${pages} pages`;
}

function updateCounts() {
  const start = (libraryPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(libraryPage * PAGE_SIZE, filteredManga.length);
  document.getElementById("resultsCount").textContent =
    `${start}-${end} / ${filteredManga.length}`;
}

function updatePagination() {
  const totalPages = Math.ceil(filteredManga.length / PAGE_SIZE);
  const container = document.getElementById("pagination");
  container.innerHTML = "";
  if (totalPages <= 1) return;

  for (let i = 1; i <= Math.min(totalPages, 10); i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = "page-btn" + (i === libraryPage ? " active" : "");
    btn.onclick = () => { libraryPage = i; renderGrid(); };
    container.appendChild(btn);
  }

  if (totalPages > 10) {
    const dots = document.createElement("span");
    dots.textContent = "...";
    container.appendChild(dots);

    const last = document.createElement("button");
    last.textContent = totalPages;
    last.className = "page-btn" + (libraryPage === totalPages ? " active" : "");
    last.onclick = () => { libraryPage = totalPages; renderGrid(); };
    container.appendChild(last);
  }
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

  loadPage();
}

function loadPage() {
  const img    = document.getElementById("mangaImage");
  const loader = document.getElementById("loading");
  const err    = document.getElementById("error");

  let idx = 0;
  const tryNext = () => {
    if (idx >= supportedFormats.length) {
      loader.style.display = "none";
      err.style.display    = "block";
      return;
    }
    img.src = `${MANGA_PATH}/${currentManga}/${currentPage}.${supportedFormats[idx++]}`;
  };

  img.onload  = () => { loader.style.display = "none"; err.style.display = "none"; img.classList.add("active"); };
  img.onerror = () => { img.classList.remove("active"); tryNext(); };

  loader.style.display = "block";
  img.classList.remove("active");
  tryNext();
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
  window.scrollTo(0, libraryScrollY);
  if (pushHistory) history.replaceState({}, "", "/");
}

function toggleFullscreen() {
  const rv = document.getElementById("readerView");
  if (!document.fullscreenElement) rv.requestFullscreen?.();
  else                             document.exitFullscreen?.();
}

