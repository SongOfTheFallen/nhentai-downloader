import json

from enum import Enum
from datetime import date, datetime, timezone

from os import initgroups
from typing import Any, Generator, Iterator, Never
from pprint import pprint
import time
from bs4 import BeautifulSoup, Tag
from pathlib import Path

# import requests
from bs4.element import PageElement
import httpx
from itertools import cycle
from dataclasses import dataclass
import logging


logger: logging.Logger = logging.getLogger("scraper")


def parse_tags(content: bytes, url: str) -> dict[str, Any]:
    """
    Parses the tags from the HTML of the presentation page for a doujin.
    Tags into a dictionary.
    """

    # Current time at which the doujin was scraped.
    current_datetime = datetime.now(timezone.utc).isoformat()
    tags = {"pages": None, "url": url, "datetime_scraped_at": current_datetime}

    soup = BeautifulSoup(content, "html.parser")
    tags_section = soup.find("section", id="tags")

    if tags_section is None:
        return tags

    # Iterate over all tag containers
    for container in tags_section.find_all("div", class_="tag-container"):
        field_text = container.get_text(strip=True)
        field_name = field_text.split(":")[0].lower() if ":" in field_text else ""

        if not field_name:
            logging.debug(
                f"Failed to parse tag field name (empty) for field text: {field_text}"
            )
            continue

        for tag in container.find_all("span", class_="tags"):
            names = tag.find_all("span", class_="name")
            count = tag.find_all("span", class_="count")
            time = tag.find("time")
            name_texts = [name.text.strip() for name in names]
            count_texts = [count.text.strip() for count in count]

            # If the tag has both attributes 'name' and 'count'.
            if name_texts and count_texts:
                tags[field_name] = [
                    {"name": n, "count": c} for n, c in zip(name_texts, count_texts)
                ]
            elif name_texts and not count_texts:
                # Add non-regular tags like page count.
                for name in name_texts:
                    if field_name == "pages":
                        tags[field_name] = int(name)
                    else:
                        tags[field_name] = name

            if time:
                datetime_value = time.get("datetime")  # ISO 8601 time
                display_text = time.text.strip()  # "11 years ago"
                tags["datetime_iso8601"] = datetime_value
                tags["time_relative"] = display_text

    return tags


def parse_image_direct_link(content: bytes) -> str | None:
    """
    Returns the direct download link to the image.
    Content typically fetched from a URL such as:
    https://nhentai.net/g/{doujinshi_id}/{page_number}/
    """
    soup = BeautifulSoup(content, "html.parser")
    img = soup.select_one("#image-container img")

    if img and (src := img.get("src")):
        return str(src)
