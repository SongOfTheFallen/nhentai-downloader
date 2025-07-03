#!/usr/bin/env python3

import json

from enum import Enum

from typing import Any, Generator, Iterator, Never
from pprint import pprint
import time
from bs4 import BeautifulSoup
from pathlib import Path

# import requests
from bs4.element import PageElement
import httpx
from itertools import cycle


USER_AGENTS_FILENAME: str = "user_agents.txt"
user_agents = set()


def get_user_agent(filename: str) -> Generator[str, Any, Any]:
    """Returns a random user agent from user_agents.txt"""
    while True:
        with open(filename, "r", encoding="utf-8-sig") as f:
            for line in f:
                yield line.encode("ascii", "ignore").decode("ascii").strip()


def parse_tags(url: str, headers: dict) -> dict:
    """
    Parses the HTML to dig out the tags and metadata into a neat dictionnary.
    """
    res = httpx.get(url, headers=headers)
    tags: dict = {"pages": None}

    if (code := res.status_code) != 200:
        print(f"ERROR {code}: failed to fetch tags. URL={url}")
        return tags

    soup = BeautifulSoup(res.text, "lxml")

    tags_section = soup.find("section", id="tags")
    if tags_section is None:
        print("ERROR: failed to find section 'tags' in the HTML soup")
        return tags

    # Iterate over all tag containers
    for container in tags_section.find_all("div", class_="tag-container"):

        field_text = container.get_text(strip=True)
        field_name: str = field_text.split(":")[0].lower() if ":" in field_text else ""
        if not field_name:
            print("ERROR: file_name is empty")
            continue

        buffer = list()
        for tag in container.find_all("span", class_="tags"):

            names = tag.find_all("span", class_="name")
            count = tag.find_all("span", class_="count")
            time = tag.find("time")

            name_texts = [name.text.strip() for name in names]
            count_texts = [count.text.strip() for count in count]

            if name_texts and count_texts:
                tags[field_name] = [
                    {"name": n, "count": c} for n, c in zip(name_texts, count_texts)
                ]
            elif name_texts and not count_texts:
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


def parse_image(url: str, headers: dict) -> str:
    """Returns the direct download link to the image"""
    res = httpx.get(url, headers=headers)
    if (code := res.status_code) != 200:
        print(f"ERROR {code}: failed to fetch pre image page. URL={url}")
        return ""

    soup = BeautifulSoup(res.text, "lxml")

    # Get the img element inside the image-container
    img = soup.select_one("#image-container img")
    if not img:
        print(f"ERROR: failed to parse image direct link. URL={url}")
        return ""

    return str(img["src"])


def download_image(url: str, save_path: Path, page_count: int) -> int:
    """
    :param url: The direct download URL of the image.
    :param save_path: The path including the filename to where save the image to.
    :param pages_count: The total pages.

    Downloads an image and returns the status code. No image downloaded if the status code is unsuccessful.
    """

    # Create the path doesn't already exist.
    save_path.parent.mkdir(parents=True, exist_ok=True)

    # Send GET request.
    res = httpx.get(url, headers=headers)
    code: int = res.status_code
    if not res.is_success:
        print(
            f"WARNING {code}: failed to download the image ({save_path.name}). URL={url}"
        )
        return code

    with save_path.open("wb") as f:
        f.write(res.content)

    print(
        f"INFO: downloaded image ({int(save_path.stem):03}/{page_count:03}) {url} -> {save_path}"
    )

    return code


class ImageExtension(Enum):
    """
    Enum representing the different possible image extensions.
    """

    JPG = 1
    JPEG = 2
    PNG = 3
    WEBP = 4
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


from typing import Generator
from pathlib import Path
from urllib.parse import urlparse, urlunparse


def image_link_generator(previous_image_url: str) -> Generator[str, None, None]:
    """
    Generates URLs to try for the next image page with different extensions.

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
        print(f"WARNING: No extension found in URL: {previous_image_url}")
        return

    name, ext_str = filename.rsplit(".", 1)  # rsplit to handle names with dots

    # Parse page number
    try:
        current_page = int(name)
        next_page = current_page + 1

    except ValueError:
        print(f"WARNING: Failed to parse page number from: {name}")
        return

    # Get the extension
    try:
        ext_img = ImageExtension.from_str(ext_str)
    except ValueError:
        print(f"WARNING: Unknown extension: {ext_str}")
        ext_img = ImageExtension.JPG  # Default fallback

    # Generate URLs with different extensions
    base_path = "/".join(path_parts[:-1])

    for ext in ImageExtension.iter_starting_from(ext_img):
        # Reconstruct the URL
        new_path = f"{base_path}/{next_page}.{str(ext)}"
        new_parsed = parsed._replace(path=new_path)
        yield urlunparse(new_parsed)


def get_img_save_path(img_url: str, sauce: int) -> Path | None:
    # Parse the URL properly
    parsed = urlparse(img_url)
    path_parts = parsed.path.split("/")

    # Get filename and split it
    filename = path_parts[-1]
    if "." not in filename:
        print(f"WARNING: No extension found in URL: {img_url}")
        return None

    # Make the path and create it. Even though race conditions later if not checked yarayarayararara
    save_path: Path = Path(f"./sauces/{sauce}/{filename}")
    save_path.parent.mkdir(parents=True, exist_ok=True)

    return save_path


def download_image_cycle(url_img: str, sauce: int, page_count: int) -> tuple[str, int]:
    """
    Downloads an image cycling the extensions.

    Returns a tuple (next image URL, last status code)
    """

    for url in image_link_generator(url_img):
        save_path: Path | None = get_img_save_path(url, sauce)
        if save_path is None:
            raise ValueError("save_path is None")

        code: int = download_image(url, save_path, page_count)
        if 199 < code < 300:
            return url, code

    raise Exception(f"Failed to download image with input URL: {url_img}")


def download_images(
    first_image_url: str, page_count: int, sauce: int, headers: dict
) -> None:
    """
    Tries to download the entirety of a sauce, all pictures.

    :param first_image_url: The URL of the first image in the sauce.
    :param page_count: The total count of pages.
    :param sauce: The ID of the actual manga/doujinshi.
    :param headers: Usually including the user agent to go with the requests.
    """
    url: str = first_image_url
    # download the first
    p: None | Path = get_img_save_path(url, sauce)
    if p is None:
        return
    download_image(url, p, page_count)

    # download the rest
    for i in range(page_count - 1):
        # Cycles down the extensions if the download fails until a suitable one is found.
        url, code = download_image_cycle(url, sauce, page_count)


# def download_images_old(
#     first_image_direct_link: str, page_count: int, sauce: int, headers: dict
# ) -> None:
#     """Downloads all images of the manga/doujinshi."""
#     # Image file extensions ordered from most common to least common on the web
#
#     image_extensions_original: list[str] = [
#         # [0] gets modified.
#         "",
#         "jpg",
#         "jpeg",
#         "png",
#         "gif",
#         "webp",
#         "svg",
#         "ico",
#         "bmp",
#         "tiff",
#         "tif",
#         "avif",
#         "heic",
#         "heif",
#         "raw",
#     ]
#
#     image_extensions: list[str] = [
#         # [0] gets modified.
#         "",
#         "jpg",
#         "jpeg",
#         "png",
#         "gif",
#         "webp",
#         "svg",
#         "ico",
#         "bmp",
#         "tiff",
#         "tif",
#         "avif",
#         "heic",
#         "heif",
#         "raw",
#     ]
#
#     ext: str = ""
#     # Flip to True to cycle the extentions.
#     error_flag: bool = False
#     tries: int = 1
#
#     for i in range(1, page_count + 1):
#         while True:
#             if error_flag:
#                 if tries > len(image_extensions):
#                     print(
#                         f"ERROR: exhausted all image extentions. Dropping download. (try={tries}, {ext=})"
#                     )
#                     error_flag = False
#                     image_extensions = image_extensions_original
#                     tries = 1
#                     break
#
#                 ext = image_extensions[tries - 1]
#                 tries += 1
#
#             # 'jpg', 'png', 'webp', etc.
#             if not error_flag:
#                 ext = first_image_direct_link.split("/")[-1].split(".")[1]
#                 image_extensions.remove(ext)
#                 image_extensions[0] = ext
#
#             filename: str = f"{i}.{ext}"
#
#             url = "/".join(first_image_direct_link.split("/")[:-1]) + f"/{filename}"
#             img_path: Path = Path(f"./sauces/{sauce}/{filename}")
#             img_path.parent.mkdir(parents=True, exist_ok=True)
#
#     save_path: Path = Path(f"./sauces/{sauce}/{filename}")
#             res = httpx.get(url, headers=headers)
#             if (code := res.status_code) != 200:
#                 print(
#                     f"WARNING {code}: failed to download the image ({filename}, #{sauce}, try={tries}). URL={url}"
#                 )
#                 error_flag = True
#                 continue
#
#             with img_path.open("wb") as f:
#                 f.write(res.content)
#
#             print(f"INFO: downloaded image {i:03}/{page_count:03} for #{sauce}")
#             break
#

index: int = 100_000
# Full Example: https://nhentai.net/g/532611/
BASE_URL: str = "https://nhentai.net/g/"

for agent in get_user_agent(USER_AGENTS_FILENAME):
    headers = {"User-Agent": agent}

    tags_url: str = f"{BASE_URL}{index}/"
    print(f"INFO: fetching sauce #{index} with {tags_url}")
    tags: dict = parse_tags(tags_url, headers)

    # Save tags as JSON.
    tags_file = Path(f"./sauces/{index}/meta.json")
    tags_file.parent.mkdir(parents=True, exist_ok=True)
    with tags_file.open("w") as f:
        json.dump(tags, f, indent=2)

    print(f"INFO: downloading sauce #{index} ({tags['pages']} pages)...")

    image_pre_url: str = f"{BASE_URL}{index}/1/"
    image_direct_link: str = parse_image(image_pre_url, headers)
    download_images(image_direct_link, tags["pages"], index, headers)

    index += 1
    # break
