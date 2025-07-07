"""
nhentai_scraper.py

Scrapes nhentai.net asynchronously.

Author: Urpagin
Date: 2025-07-05
"""

# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.
# TODO: DEDUPLICATE _DOWNLOAD AND _FETCH. USE _FETCH IN _DOWNLOAD.


# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__
# TODO: ADD GLOBAL DELAY TO ALL REQUESTS PASSED IN __INIT__


import random
from typing import Generator, Iterator
from pathlib import Path
from urllib.parse import urlparse, urlunparse


from enum import Enum
import json
from urllib.parse import urljoin
import parsers
from pathlib import Path
import logging
from typing import Any, Callable, Iterable
import asyncio
import aiohttp

log: logging.Logger = logging.getLogger("scraper")


class ImageExtension(Enum):
    """
    Enum representing the different possible image extensions.
    """

    JPG = 1
    PNG = 3
    WEBP = 4
    JPEG = 2
    GIF = 5
    SVG = 6
    ICO = 7
    BMP = 8
    TIFF = 9
    TIF = 10
    AVIF = 11
    HEIC = 12
    HEIF = 13
    RAW = 14

    def __str__(self) -> str:
        return self.name.lower()

    @classmethod
    def from_str(cls, text: str) -> "ImageExtension":
        for member in cls:
            if str(member) == text.lower():
                return member
        raise ValueError(f"No ImageExtension found for '{text}'")

    @classmethod
    def iter_starting_from(cls, ext: "ImageExtension") -> Iterator["ImageExtension"]:
        yield ext
        yield from (m for m in cls if m != ext)


def image_link_generator(previous_image_url: str) -> Generator[str, None, None]:
    """
    Sequentially generates URLs to try for the next image page with different extensions.
    The first extension is always the one of the `previous_image_url` and then cycles through other ones.

    Args:
        previous_image_url: URL of the previous image (e.g., 'https://example.com/gallery/1.jpg')

    Yields:
        str: Possible URLs for the next page with different file extensions

    Raises:
        StopIteration: When page number exceeds page_count or parsing fails
    """

    # Parse the URL properly
    parsed = urlparse(previous_image_url)
    path_parts = parsed.path.split("/")

    # Get filename and split it
    filename = path_parts[-1]
    if "." not in filename:
        log.warning(f"No extension found in URL: {previous_image_url}")
        return

    name, ext_str = filename.rsplit(".", 1)  # rsplit to handle names with dots

    # Parse page number
    try:
        next_page_id = int(name) + 1
    except ValueError:
        log.warning(f"Failed to parse page number from: {name}")
        return

    # Get the extension
    try:
        ext_img = ImageExtension.from_str(ext_str)
    except ValueError:
        log.debug(f"Unknown extension: {ext_str}")
        ext_img = ImageExtension.JPG  # Default fallback

    # Generate URLs with different extensions
    base_path = "/".join(path_parts[:-1])

    for ext in ImageExtension.iter_starting_from(ext_img):
        # Reconstruct the URL
        new_path = f"{base_path}/{next_page_id}.{str(ext)}"
        new_parsed = parsed._replace(path=new_path)
        yield urlunparse(new_parsed)


class Scraper:
    def __init__(
        self,
        save_dir: str,
        max_coroutines: int = 10,
        user_agents_filepath: str | None = None,
    ) -> None:
        """
        :param save_dir: Where the downloaded doujinshis be saved.
        :param max_coroutimes: Limits the numbers of asynchronous downloads.
        :param user_agents_filepath: The path pointing to a text file, each line with a user agent.
        """
        try:
            _save_dir: Path = Path(save_dir)
            _save_dir.mkdir(parents=True, exist_ok=True)
            self.save_dir: Path = _save_dir
        except Exception as e:
            log.error(f"Failed to create the save directory '{save_dir}': {e}")

        if max_coroutines < 1:
            max_coroutines = 10
            log.warning(
                f"max_coroutines must be at least 1. Defaulted to {max_coroutines}."
            )

        self._max_coroutines = max_coroutines
        self._semaphore: asyncio.Semaphore = asyncio.Semaphore(max_coroutines)

        self._BASE_URL: str = "https://nhentai.net/g/"
        self._session: None | aiohttp.ClientSession = None

        self._user_agents: list[str] = list()
        self._load_user_agents(user_agents_filepath)

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session:
            await self._session.close()
        else:
            log.error("Session does not exist at __aexit__()!")

    def _build_doujin_url(self, id: int) -> str:
        """
        Returns an URL for a doujinshi given it's ID.
        Example for id=33 -> https://nhentai.net/g/33/
        """
        return str(urljoin(self._BASE_URL, f"{id}/"))

    def _build_doujin_url_first_page(self, id: int) -> str:
        """
        Returns a URL for a doujinshi given its ID.
        Example for id=33 -> https://nhentai.net/g/33/1
        """
        return str(urljoin(self._BASE_URL, f"{id}/1/"))

    def _load_user_agents(self, filename: str | None = None) -> None:
        """
        Not good for the RAM if the file is large.
        Loads all of the user agents file into memory.
        """
        if not filename:
            filename = "./user_agents.txt"

        try:
            with open(filename, "r", encoding="utf-8-sig") as f:
                for line in f:
                    line = line.encode("ascii", "ignore").decode("ascii").strip()
                    self._user_agents.append(line)
        except Exception as e:
            log.warning(f"Failed to load user agents file: {e}")

    def _get_user_agent(self) -> str:

        return random.choice(self._user_agents)

    async def _fetch(self, url: str) -> bytes | None:
        if not self._session:
            log.error(f"Session does not exist; cannot fetch url {url}")
            return

        try:
            async with self._semaphore:
                timeout = aiohttp.ClientTimeout(total=10)
                headers = {"User-Agent": self._get_user_agent()}
                async with self._session.get(
                    url, timeout=timeout, headers=headers
                ) as res:
                    return await res.read()
        except Exception as e:
            log.warning(f"Error while fetching URL {url}: {e}")

    def _save_doujin_json(
        self, doujin_dir: Path, content: dict[Any, Any], filename: str = "meta.json"
    ) -> bool:
        """
        Saves the information about the doujin inside a JSON file to `save_dir`.
        The default JSON filename is "meta.json".
        Returns True if successful, False otherwise.
        """
        if not filename.strip() or not doujin_dir:
            log.warning("Could not save JSON: saving directory or filename empty.")
            return False

        try:
            doujin_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning(f"Could not save JSON: failed to create saving directory: {e}")
            return False

        json_path = doujin_dir / filename
        try:
            with json_path.open("w", encoding="utf-8") as f:
                json.dump(content, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            log.warning(f"Failed to dump JSON to {json_path}: {e}")
            return False

    @staticmethod
    def _is_req_success(status_code: int) -> bool:
        """Check if HTTP status code indicates success (2xx range)."""
        return 200 <= status_code < 300

    async def _download_image(
        self, save_dir: Path, url: str, timeout: int = 30
    ) -> bool:
        """
        Downloads an image from the URL and saves it to `save_dir`.

        Args:
            save_dir: Directory to save the image
            url: URL of the image
            timeout: Request timeout in seconds

        Returns:
            bool: True if successful, False otherwise
        """
        if not self._session:
            log.error("Cannot download image: aiohttp session does not exist")
            return False

        if timeout < 1:
            log.warning("The timeout cannot be less than 1")
            return False

        try:
            # Extract filename from URL if not provided
            filename: str = url.split("/")[-1].split("?")[0]  # Remove query params
            if not filename:
                log.warning(f"No filename found for image at: {url}")
                return False

            timeout_cfg = aiohttp.ClientTimeout(total=timeout)

            headers = {"User-Agent": self._get_user_agent()}
            async with self._session.get(
                url, timeout=timeout_cfg, headers=headers
            ) as response:
                if not self._is_req_success(response.status):
                    log.warning(f"HTTP {response.status} for {url}")
                    return False

                content: bytes = await response.read()

                # Create directory and save file
                file_path: Path = save_dir / filename
                file_path.write_bytes(content)

                log.debug(f"Downloaded {url} -> {file_path}")
                return True

        except asyncio.TimeoutError:
            log.error(f"Timeout downloading {url}")
            return False
        except aiohttp.ClientError as e:
            log.error(f"Network error downloading {url}: {e}")
            return False
        except Exception as e:
            log.error(f"Unexpected error downloading {url}: {e}")
            return False

    async def _download_images(
        self, doujin_dir: Path, start_url: str, page_count: int
    ) -> bool:
        """
        The thick of it. Downloads all the doujin's images into `doujin_dir`.
        :param doujin_dir: Where to save the images
        :param start_url: The URL of the first image to download.
        :param page_count: The threshold at which to trying to download images.

        :returns: A boolean, whether there was any error during the downloads.
        """

        error_happened: bool = False
        downloaded_pages: int = 0

        # Download the initial image
        if not await self._download_image(doujin_dir, start_url):
            error_happened = True

        downloaded_pages += 1
        log.debug(
            f"Downloaded image {downloaded_pages:03}/{page_count:03} for doujin #{doujin_dir.name}"
        )

        # Cycle through all image IDs. Minus the first one.
        for _ in range(page_count - 1):
            for candidate_next in image_link_generator(start_url):
                success: bool = await self._download_image(doujin_dir, candidate_next)
                # Next URL becomes previous URL for the outer loop.
                # In any case we change that.
                start_url = candidate_next
                if success:
                    downloaded_pages += 1
                    break
                else:
                    error_happened = True

            log.debug(
                f"Downloaded image {downloaded_pages:03}/{page_count:03} for doujin #{doujin_dir.name}"
            )

        return True if not error_happened else False

    # TODO: Make a progress bar?
    async def scrape_single(self, id: int) -> Path | None:
        """
        Downloads a doujinshi from its ID (sauce).
        :param id: The sauce.

        :returns: The path of the directory where the doujinshi has been saved, None if error.
        """
        log.info(f"Scraping doujinshi #{id:06}")

        doujin_dir: Path = self.save_dir / str(id)
        if doujin_dir.exists():
            log.warning(f"Doujin directory {doujin_dir} already exists: skipping")
            return

        ###### Req for the tags
        url_cover: str = self._build_doujin_url(id)
        content: bytes | None = await self._fetch(url_cover)
        if not content:
            return

        tags: dict[str, Any] = parsers.parse_tags(content, url_cover)
        # log.debug(f"{tags = }")
        page_count: int | None = tags.get("pages")
        if not page_count:
            log.warning(f"Page count for sauce {id} not found")
            return

        if not self._save_doujin_json(doujin_dir, tags):
            return

        ###### Req for the first image direct link
        url_first_page: str = self._build_doujin_url_first_page(id)
        content: bytes | None = await self._fetch(url_first_page)
        if not content:
            return

        direct_link_first_image: str | None = parsers.parse_image_direct_link(content)
        if not direct_link_first_image:
            log.warning(
                f"Could not parse direct link of first image for url: {url_first_page}"
            )
            return

        log.debug(f"{direct_link_first_image = }")

        ###### Reqs to download the images
        if not await self._download_images(
            doujin_dir, direct_link_first_image, page_count
        ):
            log.warning(
                f"There has been at least one error trying to download #{id:06}"
            )

        return doujin_dir

    async def scrape_multiple(
        self, ids: Iterable[int], callback: Callable[[Path | None], None] | None = None
    ) -> None:
        """
        Downloads multiple doujinshis from their IDs (sauces).

        Args:
            ids: An iterable of doujinshi IDs to download. Examples:
                - List: [11, 100, 45]
                - Range: range(1000, 2001)  # IDs 1000 to 2000 inclusive
                - Tuple: (66, 1984, 234902)
                - Set: {123, 456, 789}

            callback: Optional function called after each download completes.
                Receives the Path to the downloaded doujinshi, or None if
                the download failed. Useful for progress tracking or logging.

                Example:
                    def on_complete(path: Path | None):
                        if path:
                            print(f"Downloaded to: {path}")
                        else:
                            print("Download failed")

                    scraper.scrape_multiple([1, 2, 3], callback=on_complete)

        Returns:
            None

        """

        batch_size: int = self._max_coroutines * 5
        tasks = []

        total = len(ids) if hasattr(ids, "__len__") else None
        completed = 0
        batch_processed: int = 0

        async def process_batch():
            """Process current batch of tasks"""
            nonlocal completed
            nonlocal batch_processed

            for coro in asyncio.as_completed(tasks):
                completed += 1
                if total:
                    log.info(
                        f"Progress: {completed}/{total} ({completed/total*100:.1f}%)"
                    )
                try:
                    result: Path | None = await coro
                    if callback:
                        callback(result)
                except Exception as e:
                    log.error(f"Task failed: {e}")

            batch_processed += 1
            log.debug(f"Processed batch #{batch_processed}")

        for id in ids:
            tasks.append(self.scrape_single(id))

            if len(tasks) >= batch_size:
                await process_batch()
                tasks.clear()

        # Process any remaining tasks
        if tasks:
            await process_batch()

    async def scrape_random(
        self, n: int, start: int = 1, stop: int | None = None
    ) -> None:
        """
        Downloads `n` (n>=1) doujinshis randomly from ID `start` up to and including ID `stop`.
        Default behavior (start and stop not specified):
        Determines the highest ID and selects random doujinshis.

        start >= 1.
        As for stop, TODO.

        Returns: List of IDs that were downloaded.ins the highest ID and and selects random doujinshis
        """
        pass
