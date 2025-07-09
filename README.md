# nhentai Downloader

A self-hosted solution to build and browse your own doujinshi library.

This repository contains **three independent pieces**:

- **`scraper/`** – an asynchronous Python 3 scraper that downloads doujinshi
  from [nhentai.net](https://nhentai.net) into a local `manga/` folder.
- **`backend/`** – a small Node.js API serving the downloaded files and metadata.
- **`frontend/`** – a single‑page web interface generated with Vite and Vue.

The scraper is completely standalone. Use it to gather the content you want
first, then run the backend and frontend to host the library.

## Frontend Preview

<img width="1202" alt="nhentai-downloader-image-demo-censored" src="https://github.com/user-attachments/assets/d2de2b38-03df-4d3c-a569-0ef76b9b2efa" />

## Features

- Downloads doujinshi from nhentai as individual folders with JSON metadata.
- Browse the collection in a responsive web UI.
- Download any entry as a PDF or zipped archive.
- Docker support for easy deployment.

## Getting Started

### 1. Scrape your manga

Ensure Python 3.11+ is installed. Inside `scraper/`, adjust
`main.py` to choose what to download and run:

```bash
cd scraper
pip install -r requirements.txt
python3 main.py
```

Downloaded files appear under `manga/` (created automatically at the repository
root).

### 2. Install web dependencies

```bash
npm run install:all
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit the `.env` files to set your API key and optional password.

### 3. Start in development

```bash
npm run dev
```

The frontend runs on <http://localhost:8787> and the API on
<http://localhost:5173>. Update the ports inside the `.env` files if needed.
All API requests must include the key defined in `backend/.env` using the
`Authorization` header.

### 4. Build for production

```bash
npm run build
```

Serve the contents of `frontend/dist` on any static host and run the backend
(using `npm run prod` inside `backend/` or the Docker setup below).

## Docker Deployment

Both components have ready‑to‑use `docker-compose.yml` files.
From the repository root run:

```bash
# API
cd backend && docker compose up -d
# Frontend
cd ../frontend && docker compose up -d
```

The containers read the same `.env` files and mount `../manga` to make your
collection available.

## API Summary

- `GET  /api/manga` – list all entries
- `POST /api/rescan` – rebuild the cache after adding files
- `GET  /api/stats` – number of pages and library size
- `GET  /api/manga/:id/archive` – download as ZIP
- `GET  /api/manga/:id/pdf` – download as PDF

Static images are served from `/manga`.

## Compatibility

The scraper targets Python 3.13 but also works on Python 3.11 and 3.12. Earlier
versions are not supported. The Node backend requires Node.js 20 or later.

## License

Released under the terms of the GNU General Public License v3.
