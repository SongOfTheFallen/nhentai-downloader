#!/usr/bin/env python3

"""
A standalone CLI cleaning up utility for the doujinshi directory. Compares JSON pages with pages. No JSON etc.

Terrible code, by the way.
"""

import shutil
from os.path import isdir, isfile
from pathlib import Path
import json
import os
from typing import Any, Iterable
import signal
import sys
import time


def signal_handler(sig, frame):
    print("\nUser aborted program: CTRL+C detected")
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)


class Cleanup:
    def __init__(self, doujin_dir: str, meta_filename: str = "meta.json") -> None:
        """
        Cleans up the doujin directory of stale doujinshis, incomplete ones, other crap.

        :param doujin_dir: Where the doujinshis are stored.
        :param meta_filename: The JSON default name to store doujin information (tags, timestamps, ...).
        """
        self._doujin_dir: Path = Path(doujin_dir).absolute()
        self._doujin_dir.mkdir(parents=True, exist_ok=True)
        self._meta_filename = meta_filename

    def _json_parse_page_count(self, file: Path) -> int | None:
        with file.open("rb") as f:
            try:
                content: dict[str, Any] = json.load(f)
            except Exception as e:
                print(f"Failed to load JSON meta file: {e}")
                return None

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

    def _clean_dir(self, doujin_dir: Path) -> list[tuple[Path, str]]:
        """
        Returns a list of Paths to be deleted with the reason why it should be deleted.
        """
        to_delete: list[tuple[Path, str]] = list()
        meta_file: Path = Path(doujin_dir) / self._meta_filename
        # Delete ourselves if no JSON metadata.
        if not meta_file.exists():
            return [(doujin_dir, f"{self._meta_filename} does not exist.")]

        page_count: int | None = self._json_parse_page_count(meta_file)
        if page_count is None:
            return [(doujin_dir, f"Failed to parse the page count in JSON")]

        # The number of files (so images) inside a doujinshi directory.
        image_count: int = 0
        for entry in doujin_dir.iterdir():
            if entry.is_file() and str(entry.name) != self._meta_filename:
                image_count += 1
                continue

            if str(entry.name) != self._meta_filename:
                # Delete all NON-files
                to_delete.append((entry, f"Not a doujin image file"))

        if image_count != page_count:
            print(f"Page mismatch: {page_count = } expected and got {image_count = }")
            return [
                (doujin_dir, f"Page mismatch: expected {page_count}, got {image_count}")
            ]

        return to_delete

    def _do_delete(self, paths_in: Iterable[tuple[Path, str]]) -> None:
        """
        Prompts user to delete the input paths.
        """
        items = sorted(paths_in, key=lambda item: len(item[0].parts), reverse=True)

        if not ask_delete_dirs(items):
            print("Aborting deletion...")
            return

        count: int = 0
        print("Deleting...")
        for path, _ in items:
            try:
                # Never descend into symlinks
                if path.is_symlink():
                    path.unlink()
                    count += 1
                    print(f"-> {path.name} deleted!")
                elif path.is_dir():
                    shutil.rmtree(path)
                    count += 1
                    print(f"-> {path.name} deleted!")
                else:
                    path.unlink()
                    count += 1
                    print(f"-> {path.name} deleted!")
            except FileNotFoundError:
                print(f"Cannot delete: item not found for path: {path}")

        print(f"\n\nDeleted {count} items!")

    def _do_cleanup(self) -> None:
        """
        Deletes.
        """
        doujinshi_dirs: int = 0
        to_delete: list[tuple[Path, str]] = list()

        for entry in self._doujin_dir.iterdir():
            # We don't want any non-directories
            if not entry.is_dir():
                print(f"-> '{entry.name}' is not a directory; ignoring.")
                continue

            try:
                _ = int(entry.name)
            except ValueError:
                print(
                    f"-> '{entry.name}' is not a directory containing a doujinshi; ignoring."
                )
                continue

            doujinshi_dirs += 1
            to_delete.extend(self._clean_dir(entry))

        self._do_delete(to_delete)

    def cleanup(self) -> None:
        self._do_cleanup()


def get_user_input(prompt: str = "") -> str:
    return input(f"\n{prompt} -> ")


def prompt_yes_or_no(prompt: str) -> bool:
    """Defaults to False: (y/N)"""
    usr_in: str = get_user_input(prompt).strip().lower()
    if usr_in in ("y", "yes"):
        return True
    return False


from pathlib import Path


def total_size(paths: list[Path]) -> int:
    return sum(
        f.stat().st_size for path in paths for f in path.rglob("*") if f.is_file()
    )


def get_summary(paths: Iterable[Path]) -> str:
    count: int = 0
    dirs: int = 0
    files: int = 0
    others: int = 0
    for p in paths:
        count += 1
        if p.is_dir():
            dirs += 1
        elif p.is_file():
            files += 1
        else:
            others += 1

    size_mib: float = total_size(list(paths)) / (1024 * 1024)
    show_size: str = f"{size_mib:,.3f} MiB".replace(",", " ")
    return (
        f"Summary of items to delete ({show_size}):\n"
        f"\tTotal items: {count:>5}\n"
        f"\tDirectories: {dirs:>5}\n"
        f"\tFiles:       {files:>5}\n"
        f"\tOthers:      {others:>5}"
    )


def ask_delete_dirs(paths: Iterable[tuple[Path, str]]) -> bool:
    """
    Asks the user if they want to proceed and delete the paths.
    True: delete
    False: do not delete
    """
    print("\n\n\tITEMS TO DELETE\n\n")
    cwd: Path = Path.cwd()
    # The number of chars in the first path + some more
    align_num: int = len(str(next(iter(paths), (cwd, ""))[0])) + 5
    for path, reason in paths:
        print(f"-> {str(path):<{align_num}} (reason: {reason})")
    # Print summary with number of items and their types.
    print(get_summary([p for p, _ in paths]), end="\n\n")

    p1 = "Do you want to delete all of the above? [y/N]"
    p2 = "ARE YOU SURE?! [y/N]"
    if prompt_yes_or_no(p1) and prompt_yes_or_no(p2):
        print("\n\n")
        for i in range(5, -1, -1):
            print(f"DELETING IN {i}s...")
            time.sleep(1)

        time.sleep(0.5)
        return True

    return False


def get_user_confirmation(doujin_dir: Path) -> bool:
    """
    Returns True if the user agreed to clean the input directory.
    """
    abs_p: Path = doujin_dir.absolute()
    print(f"Directory to clean\n-> {str(abs_p)}")
    do_delete: bool = prompt_yes_or_no(
        "Are you sure you want to clean this directory? [y/N]"
    )
    return do_delete


def main() -> None:
    usr_in: str = get_user_input("Doujinshi directory path")
    if not usr_in:
        print("Path error: no path")
        return

    doujin_dir: Path = Path(usr_in).absolute()
    if str(doujin_dir) in ("/", "/home/"):
        print("Path error: path is root or home.")
        return

    if not doujin_dir.exists() or not doujin_dir.is_dir():
        print("Path error: path does not exist or is not a directory.")
        return

    if not get_user_confirmation(doujin_dir):
        print("Aborting cleaning...")
        exit(0)

    print()
    clean: Cleanup = Cleanup(str(doujin_dir))
    clean.cleanup()


def print_notice() -> None:
    notes: str = (
        f"NOTICE: Make sure you DO NOT run this program while doujinshis are being scraped!\n"
        f"NOTICE: This tool is very strict, it will delete a doujinshi if:\n"
        f"\t* only one page of the doujin is missing\n"
        f"\t* there is a file that throws off the page count. e.g., some random .Thumbs or text file\n"
        f"\t* the JSON metadata file is corrupt or non-existant\n"
    )

    print(notes)


if __name__ == "__main__":
    print("[Started cleaning tool]", end="\n\n")
    print_notice()
    main()
    print("\n\n[Ended cleaning tool]")
