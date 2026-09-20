"""Parsing and mutation of the ScrapBook scrapbook.rdf index.

The index used to be manipulated in the browser with DOMParser/XPath, which is unavailable in a
MV3 service worker and required a read-modify-write round trip that could lose concurrent updates.
Here every operation parses, mutates and serializes the file while holding its write lock, so a
mutation can not clobber another one.
"""

import re
import xml.etree.ElementTree as ET
from io import StringIO

from .rwlock import path_lock
from .server_paths import resolve_client_path
from .utils_fs import atomic_write

ITEM_URN_PREFIX = "urn:scrapbook:item"
ROOT_URN = "urn:scrapbook:root"

# ScrapBook stores multiline comments in a single attribute
COMMENT_LINE_BREAK = " __BR__ "

ITEM_ATTRIBUTES = ("id", "type", "title", "chars", "icon", "source", "comment")

SEPARATOR_TYPE = "separator"
FOLDER_TYPE = "folder"

INDENT = "  "


def item_urn(item_id):
    return f"{ITEM_URN_PREFIX}{item_id}"


def _qualify(uri, name):
    return f"{{{uri}}}{name}" if uri else name


def _escape_comment(comment):
    return (comment or "").replace("\n", COMMENT_LINE_BREAK)


def _unescape_comment(comment):
    return (comment or "").replace(COMMENT_LINE_BREAK, "\n")


def _indent(element, level=0):
    """Reproduces the two-space layout ScrapBook itself writes.

    ElementTree.indent is only available since Python 3.9, and the embeddable distribution the
    Windows installer bundles is not guaranteed to be that recent.
    """
    padding = "\n" + level * INDENT

    if len(element):
        if not element.text or not element.text.strip():
            element.text = padding + INDENT

        for child in element:
            _indent(child, level + 1)

        if not element[-1].tail or not element[-1].tail.strip():
            element[-1].tail = padding

    if level and (not element.tail or not element.tail.strip()):
        element.tail = padding


class RDFIndexError(Exception):
    pass


class RDFIndex:
    def __init__(self, root, namespaces):
        self.root = root
        self.namespaces = namespaces

        self.NS_RDF = namespaces.get("RDF")
        self.NS_NC = namespaces.get("NC")
        # the ScrapBook namespace carries an arbitrary generated prefix (NS1, NS2, ...)
        self.NS_SCRAPBOOK = next(
            (uri for prefix, uri in namespaces.items() if re.fullmatch(r"NS\d+", prefix or "", re.I)), None)

        if not self.NS_RDF or not self.NS_SCRAPBOOK:
            raise RDFIndexError("The RDF file does not declare the expected ScrapBook namespaces.")

        self._description_tag = _qualify(self.NS_RDF, "Description")
        self._separator_tag = _qualify(self.NS_NC, "BookmarkSeparator") if self.NS_NC else None
        self._seq_tag = _qualify(self.NS_RDF, "Seq")
        self._li_tag = _qualify(self.NS_RDF, "li")
        self._about_attr = _qualify(self.NS_RDF, "about")
        self._resource_attr = _qualify(self.NS_RDF, "resource")

    @staticmethod
    def from_string(content):
        namespaces = {}

        try:
            # the prefixes of the source document are preserved, so the file keeps the shape
            # the legacy ScrapBook add-on wrote
            for _, (prefix, uri) in ET.iterparse(StringIO(content), events=("start-ns",)):
                namespaces.setdefault(prefix, uri)

            root = ET.fromstring(content)
        except ET.ParseError as e:
            raise RDFIndexError(f"The RDF file is malformed: {e}")

        return RDFIndex(root, namespaces)

    def _sb(self, name):
        return _qualify(self.NS_SCRAPBOOK, name)

    def _is_leaf(self, element):
        return element.tag == self._description_tag or element.tag == self._separator_tag

    def _leaves(self):
        return {e.get(self._about_attr): e for e in self.root if self._is_leaf(e)}

    def _sequences(self):
        return {e.get(self._about_attr): e for e in self.root if e.tag == self._seq_tag}

    def _sequence_of(self, parent_id):
        urn = item_urn(parent_id) if parent_id else ROOT_URN
        return self._sequences().get(urn)

    def _find_li(self, item_id):
        urn = item_urn(item_id)

        for sequence in self.root:
            if sequence.tag != self._seq_tag:
                continue
            for li in sequence:
                if li.tag == self._li_tag and li.get(self._resource_attr) == urn:
                    return sequence, li

        return None, None

    def _item_attributes(self, element):
        attributes = {"__sb_about": element.get(self._about_attr)}

        for name in ITEM_ATTRIBUTES:
            attributes[f"__sb_{name}"] = element.get(self._sb(name)) or ""

        attributes["__sb_comment"] = _unescape_comment(attributes["__sb_comment"])

        if element.tag == self._separator_tag and not attributes["__sb_type"]:
            attributes["__sb_type"] = SEPARATOR_TYPE

        return attributes

    # the tree the importer walks; the cycle guard keeps a malformed file from recursing forever
    def to_tree(self):
        leaves = self._leaves()
        sequences = self._sequences()

        def traverse(urn, visited):
            children = []
            sequence = sequences.get(urn)

            if sequence is None:
                return children

            for li in sequence:
                if li.tag != self._li_tag:
                    continue

                resource = li.get(self._resource_attr)
                element = leaves.get(resource)

                if element is None:
                    continue

                item = self._item_attributes(element)

                if item["__sb_type"] == FOLDER_TYPE and resource not in visited:
                    item["children"] = traverse(resource, visited | {resource})

                children.append(item)

            return children

        return {"children": traverse(ROOT_URN, frozenset([ROOT_URN]))}

    def create_items(self, items):
        for item in items:
            self._create_item(item)

    def _create_item(self, item):
        item_id = item["id"]
        item_type = item.get("type") or ""
        urn = item_urn(item_id)

        sequence = self._sequence_of(item.get("parent_id"))
        if sequence is None:
            raise RDFIndexError(f"The parent of the item {item_id} is missing from the RDF file.")

        if item_type == SEPARATOR_TYPE and self._separator_tag:
            element = ET.SubElement(self.root, self._separator_tag)
        else:
            element = ET.SubElement(self.root, self._description_tag)

        element.set(self._about_attr, urn)
        element.set(self._sb("id"), item_id)
        element.set(self._sb("type"), item_type)
        element.set(self._sb("title"), item.get("title") or "")
        element.set(self._sb("chars"), item.get("chars") or "")
        element.set(self._sb("icon"), item.get("icon") or "")
        element.set(self._sb("source"), item.get("source") or "")
        element.set(self._sb("comment"), _escape_comment(item.get("comment")))

        # a folder owns the sequence that holds its children
        if item_type == FOLDER_TYPE:
            folder_sequence = ET.SubElement(self.root, self._seq_tag)
            folder_sequence.set(self._about_attr, urn)

        li = ET.SubElement(sequence, self._li_tag)
        li.set(self._resource_attr, urn)

    def update_item(self, item_id, fields):
        element = self._leaves().get(item_urn(item_id))

        if element is None:
            raise RDFIndexError(f"The item {item_id} is missing from the RDF file.")

        for name in ITEM_ATTRIBUTES:
            if name not in fields:
                continue

            value = fields[name] or ""
            element.set(self._sb(name), _escape_comment(value) if name == "comment" else value)

    def delete_items(self, item_ids):
        leaves = self._leaves()
        sequences = self._sequences()

        for item_id in item_ids:
            urn = item_urn(item_id)

            element = leaves.get(urn)
            if element is not None:
                self.root.remove(element)

            sequence = sequences.get(urn)
            if sequence is not None:
                self.root.remove(sequence)

            parent_sequence, li = self._find_li(item_id)
            if li is not None:
                parent_sequence.remove(li)

    def move_items(self, item_ids, dest_id):
        destination = self._sequence_of(dest_id)

        if destination is None:
            raise RDFIndexError("The destination folder is missing from the RDF file.")

        for item_id in item_ids:
            parent_sequence, li = self._find_li(item_id)

            if li is None:
                continue

            parent_sequence.remove(li)
            li.tail = None
            destination.append(li)

    # the items are reordered inside the sequence of the first one, as they always share a parent
    def reorder_items(self, item_ids):
        if not item_ids:
            return

        sequence, _ = self._find_li(item_ids[0])

        if sequence is None:
            return

        by_urn = {}
        for li in list(sequence):
            if li.tag == self._li_tag:
                by_urn[li.get(self._resource_attr)] = li
                sequence.remove(li)

        for item_id in item_ids:
            li = by_urn.pop(item_urn(item_id), None)
            if li is not None:
                li.tail = None
                sequence.append(li)

        # anything the caller did not mention keeps its relative position at the end
        for li in by_urn.values():
            li.tail = None
            sequence.append(li)

    def serialize(self):
        for prefix, uri in self.namespaces.items():
            ET.register_namespace(prefix, uri)

        _indent(self.root)

        xml = ET.tostring(self.root, encoding="unicode")

        # ElementTree writes empty elements as "<tag />" while ScrapBook writes "<tag/>";
        # the sequence can not occur inside a value, as ">" is escaped in attributes and text
        return xml.replace(" />", "/>") + "\n"


def _load(rdf_file):
    with open(rdf_file, "r", encoding="utf-8") as rdf:
        return RDFIndex.from_string(rdf.read())


def read_tree(params):
    rdf_file = resolve_client_path(params["rdf_file"])

    with path_lock(rdf_file).read_locked():
        index = _load(rdf_file)

    return index.to_tree()


def _mutate(params, mutation):
    rdf_file = resolve_client_path(params["rdf_file"], for_write=True)

    # the whole read-modify-write is performed under the lock, so concurrent
    # mutations of the same file can not overwrite each other
    with path_lock(rdf_file).write_locked():
        index = _load(rdf_file)
        mutation(index)
        atomic_write(rdf_file, index.serialize())


def create_items(params):
    _mutate(params, lambda index: index.create_items(params["items"]))


def update_item(params):
    _mutate(params, lambda index: index.update_item(params["id"], params["fields"]))


def delete_items(params):
    _mutate(params, lambda index: index.delete_items(params["ids"]))


def move_items(params):
    _mutate(params, lambda index: index.move_items(params["ids"], params.get("dest_id")))


def reorder_items(params):
    _mutate(params, lambda index: index.reorder_items(params["ids"]))
