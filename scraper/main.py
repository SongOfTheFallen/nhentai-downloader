#!/usr/bin/env python3

"""
nhentai_scraper.py

Scrapes nhentai.net asynchronously.

Author: Urpagin
Date: 2025-07-05
"""
import asyncio
import logging
from nhentai_scraper import Scraper
import setup_logging

log: logging.Logger = setup_logging.init()


from pathlib import Path


def callback(path: Path | None) -> None:
    print(f"Hey! Callback received: {path}")


async def main() -> None:
    log.debug("nhentai scraper started!")

    async with Scraper(
        "/mnt/nfs_minipc/nfs_shared/nhentai-downloader/manga/",
        max_coroutines=1000,
        max_reqs_per_second=10,
        batch_size=80,
    ) as s:
        # res = await s.scrape_single(583003)
        # log.info(f"Downloaded single doujin, response is: {res}")

        # await s.scrape_multiple(range(55, 58 + 1))
        # await s.scrape_multiple([1])

        # await s.scrape_all()
        await s.scrape_random(-1, callback=callback)


if __name__ == "__main__":
    asyncio.run(main())
