#!/usr/bin/env python3

"""
A standalone CLI cleaning up utility for the doujinshi directory. Compares JSON pages with pages. No JSON etc.
"""

from pathlib import Path
import json
import os
from typing import Any


class Cleanup:
    def __init__(self, doujin_dir: str, meta_filename: str = "meta.json") -> None:
        """
        Cleans up the doujin directory of stale doujinshis, incomplete ones, other crap.

        :param doujin_dir: Where the doujinshis are stored.
        :param meta_filename: The JSON default name to store doujin information (tags, timestamps, ...).
        """
        self._doujin_dir: Path = Path(doujin_dir)
        self._doujin_dir.mkdir(parents=True, exist_ok=True)
        self._meta_filename = meta_filename


    def _json_parse_page_count(self, file: Path) -> int | None:
        with file.open("rb") as f:
            content: dict[str, Any] = json.load(f)
            page_count = content.get("pages")
            if page_count is None:
                return None
            try:
                pc_int: int = int(page_count)
                if pc_int <= 0:
                    print(f"Page count is less than or equal than zero: {pc_int}")
                    return None
                return pc_int
            except ValueError:
                print("Failed to parse page count into integer.")
                return None


    def _clean_dir(self, doujin_dir: Path) -> list[Path]:
        """
        Returns a list of Paths to be deleted
        """
        to_delete: list[Path] = list()
        meta_file: Path = Path(doujin_dir) / self._meta_filename
        print(meta_file)
        # Delete ourselves if no JSON metadata.
        if not meta_file.exists():
            return [doujin_dir]

        page_count: int | None = self._json_parse_page_count(meta_file)
        if page_count is None:
            return [doujin_dir]

        file_count: int = 0
        for entry in self._doujin_dir.iterdir():
            # Del all NON-files inside a doujin dir
            if not entry.is_file():
                to_delete.append(entry)
                continue
            file_count += 1
            print(entry)

        if file_count != page_count:
            print(f"Page mismatch: {page_count = } expected and got {file_count = }")
            return [doujin_dir]

        return to_delete

    def _do_cleanup(self) -> None:
        to_delete: set[Path] = set()

        for entry in self._doujin_dir.iterdir():
            # We don't want any non-directories
            if not entry.is_dir():
                to_delete.add(entry)
                continue

            try:
                _ = int(entry.name)
            except ValueError:
                print(f"{entry} is not a doujin dir")
                continue

            self._clean_dir(entry)



    def cleanup(self) -> None:
        self._do_cleanup()


def main() -> None:
    print("Started")
    clean: Cleanup = Cleanup("../manga/")
    clean.cleanup()


if __name__ == "__main__":
    main()
