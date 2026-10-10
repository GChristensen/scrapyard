"""Adds posters to the images saved in gallery shelves before the addon started to create them.

Scans index.jsbk of a Scrapyard backend storage for the archives of gallery items that hold an image, writes the image
reduced to 300px at its longest side beside the archive as a side file (poster.webp, as storeImagePoster in
addon/bookmarking_gallery.js does) and records it in the gallery metadata kept in the item comments. The modification
dates of the updated items are advanced, so the browsers pull the new comments at the next synchronization.

Close the browsers (or at least make sure nothing is captured) while the script runs: the backend does not know that
the index is modified by someone else.

    python scripts/gallery_posters.py <path to index.jsbk> [--dry-run] [--force] [--size 300]

Requires Pillow.
"""

import argparse
import io
import json
import os
import sys
import tempfile
import time

from PIL import Image, ImageOps, features

OBJECT_DIRECTORY = "objects"
ARCHIVE_DIRECTORY = "archive"
NODE_OBJECT_FILE = "item.json"
ARCHIVE_CONTENT_FILE = "archive_content.blob"
COMMENTS_OBJECT_FILE = "comments.json"

POSTER_QUALITY = 85


def atomic_write(path, data):
    directory = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=directory)

    try:
        with os.fdopen(fd, "wb") as temp_file:
            temp_file.write(data.encode("utf-8") if isinstance(data, str) else data)
            temp_file.flush()
            os.fsync(temp_file.fileno())

        os.replace(temp_path, path)
    except BaseException:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def to_json(value):
    # the same compact form JSON.stringify and the backend produce
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def read_index(path):
    with open(path, "r", encoding="utf-8") as index_file:
        header = json.loads(index_file.readline())
        nodes = [json.loads(line) for line in index_file if line.strip()]

    return header, nodes


def write_index(path, header, nodes):
    header["entities"] = len(nodes)
    header["timestamp"] = int(time.time() * 1000)
    header["date"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    atomic_write(path, "\n".join(to_json(e) for e in [header] + nodes))


def read_metadata(object_directory):
    """The gallery metadata stored as JSON in the comments, None if the comments do not hold it."""
    comments_path = os.path.join(object_directory, COMMENTS_OBJECT_FILE)

    if not os.path.exists(comments_path):
        return None

    try:
        with open(comments_path, "r", encoding="utf-8") as comments_file:
            metadata = json.loads(json.load(comments_file).get("content") or "")
    except (ValueError, AttributeError):
        return None

    return metadata if isinstance(metadata, dict) else None


def make_poster(content, size):
    """Returns (bytes, mime type, extension) of the reduced image, or None if the image is small enough as is."""
    with Image.open(io.BytesIO(content)) as image:
        image.seek(0)  # the first frame of an animation
        # browsers apply the EXIF orientation when decoding, so the poster is turned the same way
        image = ImageOps.exif_transpose(image)

        if max(image.width, image.height) <= size:
            return None

        has_alpha = image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail((size, size), Image.Resampling.LANCZOS)

        output = io.BytesIO()

        if features.check("webp"):
            image.save(output, "WEBP", quality=POSTER_QUALITY, method=6)
            return output.getvalue(), "image/webp", "webp"
        else:
            image.save(output, "PNG", optimize=True)
            return output.getvalue(), "image/png", "png"


def process_node(node, object_root, args, now):
    """Adds the poster to a gallery image, returns a short status for the report."""
    object_directory = os.path.join(object_root, node["uuid"])
    content_path = os.path.join(object_directory, ARCHIVE_CONTENT_FILE)

    if os.path.isdir(os.path.join(object_directory, ARCHIVE_DIRECTORY)) or not os.path.exists(content_path):
        return "skipped: no archive content"

    metadata = read_metadata(object_directory)

    if metadata is None:
        return "skipped: no gallery metadata"

    if metadata.get("poster") and not args.force:
        return "skipped: has a poster"

    with open(content_path, "rb") as content_file:
        content = content_file.read()

    try:
        poster = make_poster(content, args.size)
    except Exception as e:
        return f"skipped: can not decode the image ({e})"

    if not poster:
        return "skipped: small enough"

    poster_bytes, poster_type, poster_ext = poster
    poster_file = f"poster.{poster_ext}"

    if args.dry_run:
        return f"would add {poster_file} ({len(poster_bytes)} bytes)"

    # an old poster of another type is not left behind when regenerating
    old_file = (metadata.get("poster") or {}).get("file")
    if old_file and old_file != poster_file and os.path.basename(old_file) == old_file:
        try:
            os.remove(os.path.join(object_directory, old_file))
        except OSError:
            pass

    atomic_write(os.path.join(object_directory, poster_file), poster_bytes)

    metadata["poster"] = {"file": poster_file, "type": poster_type}
    atomic_write(os.path.join(object_directory, COMMENTS_OBJECT_FILE), to_json({"content": to_json(metadata)}))

    # the browsers pull the comments of the items whose content is modified after their last synchronization
    node["date_modified"] = now
    node["content_modified"] = now
    node["has_comments"] = True

    item_path = os.path.join(object_directory, NODE_OBJECT_FILE)
    if os.path.exists(item_path):
        with open(item_path, "r", encoding="utf-8") as item_file:
            item = json.load(item_file)

        item.update(date_modified=now, content_modified=now, has_comments=True)
        atomic_write(item_path, to_json(item))

    return f"added {poster_file} ({len(poster_bytes)} bytes)"


def main():
    parser = argparse.ArgumentParser(description="Adds posters to the images saved in Scrapyard gallery shelves.")
    parser.add_argument("index", help="path to index.jsbk of the storage")
    parser.add_argument("--dry-run", action="store_true", help="only report what would be done")
    parser.add_argument("--force", action="store_true", help="regenerate the existing posters")
    parser.add_argument("--size", type=int, default=300, help="the longest side of a poster (default: 300)")
    args = parser.parse_args()

    index_path = os.path.abspath(args.index)
    object_root = os.path.join(os.path.dirname(index_path), OBJECT_DIRECTORY)

    header, nodes = read_index(index_path)
    galleries = {n["uuid"] for n in nodes if n.get("gallery")}

    # a gallery holds the images directly under a gallery shelf or folder (see addon/gallery.js)
    images = [n for n in nodes
              if n.get("type") == "archive" and n.get("parent") in galleries
              and (n.get("content_type") or "").lower().startswith("image/")]

    now = int(time.time() * 1000)
    updated = 0

    for node in images:
        status = process_node(node, object_root, args, now)
        print(f"{node['uuid']}  {status}  {node.get('title', '')[:60]}")

        if status.startswith(("added", "would add")):
            updated += 1

    if updated and not args.dry_run:
        write_index(index_path, header, nodes)

    verb = "would get" if args.dry_run else "got"
    print(f"\n{len(images)} gallery images found, {updated} {verb} a poster.")


if __name__ == "__main__":
    sys.exit(main())
