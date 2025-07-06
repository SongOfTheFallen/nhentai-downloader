"""
logging.py

Author: Urpagin
Date: 2025-07-05
"""

import logging
import colorlog


def init() -> logging.Logger:
    # Create a colored formatter
    formatter = colorlog.ColoredFormatter(
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
    # Setup logging handler
    handler = colorlog.StreamHandler()
    handler.setFormatter(formatter)

    # Get or create a logger
    logger = logging.getLogger(
        "scraper"
    )  # or use a specific name like logging.getLogger('myapp')
    logger.setLevel(logging.DEBUG)
    logger.addHandler(handler)

    # Prevent adding duplicate handlers if function is called multiple times
    logger.propagate = False

    return logger
