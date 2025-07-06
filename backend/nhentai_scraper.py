"""
nhentai_scraper.py

Scrapes nhentai.net asynchronously.

Author: Urpagin
Date: 2025-07-05
"""

from urllib.parse import urljoin
import parsers
from pathlib import Path
import logging
from typing import Any, Callable, Iterable
import asyncio
import aiohttp

log: logging.Logger = logging.getLogger("scraper")



class Scraper:
    def __init__(self, save_dir: str, max_coroutines: int = 10) -> None:
        """
        :param save_dir: Where the downloaded doujinshis be saved.
        :param max_coroutimes: Limits the numbers of asynchronous downloads.
        """
        try:
            save_dir_: Path = Path(save_dir)
            save_dir_.mkdir(parents=True, exist_ok=True)
            self.save_dir: Path = save_dir_
        except Exception as e:
            log.error(f"Failed to create the save directory '{save_dir}': {e}")

        if max_coroutines < 1:
            max_coroutines = 10
            log.warning(
                f"max_coroutines must be at least 1. Defaulted to {max_coroutines}."
            )
        self.semaphore = asyncio.Semaphore(max_coroutines)


        self.BASE_URL: str = "https://nhentai.net/g/"
        self.session: None | aiohttp.ClientSession = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.session:
            await self.session.close()
        else:
            log.error("Session does not exist at __aexit__()!")


    def _build_doujin_url(self, id: int) -> str:
        """
        Returns an URL for a doujinshi given it's ID.
        Example for id=33 -> https://nhentai.net/g/33/
        """
        return str(urljoin(self.BASE_URL, f"{id}/"))

    def _build_doujin_url_first_page(self, id: int) -> str:
        """
        Returns an URL for a doujinshi given it's ID.
        Example for id=33 -> https://nhentai.net/g/33/1
        """
        return str(urljoin(self.BASE_URL, f"{id}/1/"))

    async def _fetch(self, url: str) -> bytes | None:
        if not self.session:
            log.error(f"Session does not exist; cannot fetch url {url}")
            return

        try:
            async with self.semaphore:
                timeout = aiohttp.ClientTimeout(total=10)
                async with self.session.get(url, timeout=timeout) as res:
                    return await res.read()
        except Exception as e:
            log.warning(f"Error while fetching URL {url}: {e}")


    async def scrape_single(self, id: int) -> Path | None:
        """
        Downloads a doujinshi from its ID (sauce).
        :param id: The sauce.

        :returns: The path of the directory where the doujinshi has been saved, None if error.
        """

        ###### Req for the tags
        url_cover: str = self._build_doujin_url(id)
        content: bytes | None = await self._fetch(url_cover)
        if not content:
            return

        tags: dict[str, Any] = parsers.parse_tags(content, url_cover)
        log.debug(f"{tags = }")

        ###### Req for the first image direct link
        url_first_page: str = self._build_doujin_url_first_page(id)
        content: bytes | None = await self._fetch(url_first_page)
        if not content:
            return

        direct_link_first_image: str | None = parsers.parse_image_direct_link(content)
        if not direct_link_first_image:
            log.warning(f"Could not parse direct link of first image for url: {url_first_page}")
            return

        log.debug(f"{direct_link_first_image = }")
        return


        async with aiohttp.ClientSession() as session:
            res: bytes | None = await self._fetch(session, f"{base_url}{id}/")
            if not res:
                return None
            print(str(res))

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
        pass

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
