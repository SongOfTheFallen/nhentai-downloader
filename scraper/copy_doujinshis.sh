#!/bin/bash

# Made by Claude Opus 4

# Script to copy directories from source to destination if they don't exist
# Using rsync for speed while preserving directory structure

# Check if both arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <source_directory> <destination_directory>"
    echo "Example: $0 /path/to/source /path/to/destination"
    exit 1
fi

SOURCE_DIR="$1"
DEST_DIR="$2"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory '$SOURCE_DIR' does not exist"
    exit 1
fi

# Check if destination directory exists
if [ ! -d "$DEST_DIR" ]; then
    echo "Error: Destination directory '$DEST_DIR' does not exist"
    exit 1
fi

# Check if rsync is installed
if ! command -v rsync &> /dev/null; then
    echo "Error: rsync is not installed. Please install it first."
    exit 1
fi

echo "Starting directory sync process..."
echo "Source: $SOURCE_DIR"
echo "Destination: $DEST_DIR"
echo "----------------------------------------"

# Method 1: Using rsync with proper syntax to copy missing directories
# This preserves the directory structure correctly
rsync -av --ignore-existing "$SOURCE_DIR"/ "$DEST_DIR"/ --include='*/' --exclude='*' --prune-empty-dirs

# Now sync the actual content of directories that were just created
rsync -av --ignore-existing "$SOURCE_DIR"/ "$DEST_DIR"/

echo "----------------------------------------"
echo "Sync process completed!"

# Alternative method: If you want more control and visibility
# copied_count=0
# skipped_count=0
# 
# for dir in "$SOURCE_DIR"/*/; do
#     if [ -d "$dir" ]; then
#         dir_name=$(basename "$dir")
#         
#         if [ ! -d "$DEST_DIR/$dir_name" ]; then
#             echo "Copying directory: $dir_name"
#             rsync -av "$dir" "$DEST_DIR/"
#             ((copied_count++))
#         else
#             echo "Skipping: $dir_name (already exists)"
#             ((skipped_count++))
#         fi
#     fi
# done
# 
# echo "----------------------------------------"
# echo "Directories copied: $copied_count"
# echo "Directories skipped: $skipped_count"cho "Directories skipped: $skipped_count"
