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


async def main() -> None:
    log.debug("nhentai scraper started!")

    async with Scraper("./manga/", max_coroutines=3) as s:
        # res = await s.scrape_single(56)
        # log.info(f"Downloaded single doujin, response is: {res}")

        await s.scrape_multiple(range(1, 100_000 + 1))
        #await s.scrape_multiple([1])


if __name__ == "__main__":
    asyncio.run(main())
