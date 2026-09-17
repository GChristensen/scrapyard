// Wraps the host's FileWriter: assigns archive paths, maps MIME types to extensions, dedupes writes by path and
// serializes them through a single promise chain. Text is written as UTF-8.

import {sha256hex, utf8Encode} from "../shared/bytes.js";
import {log} from "../shared/log.js";

/** @typedef {import("../shared/types.js").FileWriter} FileWriter */

const HASH_LENGTH = 16;

let mimeTypesPromise = null;

function mimeTypes() {
    if (!mimeTypesPromise)
        mimeTypesPromise = fetch(browser.runtime.getURL("mime_types.json"))
            .then(response => response.json())
            .catch(e => {
                log("error", "mime_types.json", e);
                return {};
            });

    return mimeTypesPromise;
}

/**
 * @param {string} mime
 * @param {string} [url]
 * @returns {Promise<string>} extension without the dot
 */
export async function extensionFor(mime, url) {
    const table = await mimeTypes();
    let extension = table[mime]?.extensions?.[0];

    if (!extension && url) {
        try {
            extension = new URL(url).pathname.match(/\.([\da-z]{1,8})$/i)?.[1];
        }
        catch (e) {
            /* invalid url */
        }
    }

    return (extension || "bin").toLowerCase();
}

/**
 * @typedef {object} ArchiveWriter
 * @property {(file: {bytes?: Uint8Array, text?: string, mime: string, url?: string, hash?: string}) => Promise<{hash: string, path: string}>} writeResource
 * @property {(file: {path: string, data: Uint8Array|string, mime: string}) => Promise<{path: string}>} writeFile
 * @property {() => Promise<void>} flush
 */

/**
 * @param {FileWriter} hostWriter
 * @returns {ArchiveWriter}
 */
export function createArchiveWriter(hostWriter) {
    let chain = Promise.resolve();
    const written = new Set();

    function enqueue(path, bytes, mime) {
        if (written.has(path))
            return chain;

        written.add(path);

        const write = chain.then(() => hostWriter.write({path, bytes, mime}));
        chain = write.catch(() => {});   /* a failed write must not block the following ones */

        return write;
    }

    return {
        async writeResource(file) {
            const bytes = file.bytes || utf8Encode(file.text || "");
            const hash = file.hash || await sha256hex(bytes);
            const extension = await extensionFor(file.mime, file.url);
            const path = "resources/" + hash.slice(0, HASH_LENGTH) + "." + extension;

            await enqueue(path, file.bytes? file.bytes: (file.text ?? ""), file.mime);

            return {hash, path};
        },

        async writeFile(file) {
            await enqueue(file.path, file.data, file.mime);
            return {path: file.path};
        },

        async flush() {
            await chain;
        }
    };
}
