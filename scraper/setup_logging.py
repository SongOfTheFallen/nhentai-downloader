import logging
import colorlog
from pathlib import Path


def init(log_filepath: str = "scraper.log") -> logging.Logger:
    # Create colored formatter for console
    console_formatter = colorlog.ColoredFormatter(
        "%(log_color)s%(asctime)s - %(name)s - %(levelname)8s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        log_colors={
            "DEBUG": "cyan",
            "INFO": "green",
            "WARNING": "yellow",
            "ERROR": "red",
            "CRITICAL": "bold_red,bg_white",
        },
    )

    # Create regular formatter for file
    file_formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)8s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    logger = logging.getLogger("scraper")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    # Prevent adding multiple handlers on repeated calls
    if not logger.handlers:
        # Console (colored)
        console_handler = colorlog.StreamHandler()
        console_handler.setFormatter(console_formatter)
        logger.addHandler(console_handler)

        # File
        file_handler = logging.FileHandler(log_filepath, encoding="utf-8")
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)

    return logger
