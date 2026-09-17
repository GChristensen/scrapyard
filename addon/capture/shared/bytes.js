// Byte helpers: chunked base64 over Uint8Array, text decoding with the engine's charset rules, SHA-256.
// DOM-free; works in content scripts, the background and Node.

const CHUNK = 0x8000;

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64
 */
export function toBase64(bytes) {
    const parts = [];

    for (let i = 0; i < bytes.length; i += CHUNK)
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));

    return btoa(parts.join(""));
}

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);

    return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean} the bytes start with the UTF-8 byte order mark
 */
export function hasUtf8Bom(bytes) {
    return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8Encode(text) {
    return new TextEncoder().encode(text);
}

/**
 * Decodes text bytes the way the engine does: a BOM wins and forces utf-8; utf-8 is decoded strictly and
 * falls back to iso-8859-1 on malformed input; an unknown charset label also falls back to iso-8859-1.
 * @param {Uint8Array} bytes
 * @param {string} charset  lowercase label, "" for the default (utf-8)
 * @returns {{text: string, charset: string}}
 */
export function decodeText(bytes, charset) {
    let label = (charset || "utf-8").toLowerCase();

    if (hasUtf8Bom(bytes)) {
        bytes = bytes.subarray(3);
        label = "utf-8";
    }

    try {
        const decoder = new TextDecoder(label, {fatal: label === "utf-8"});
        return {text: decoder.decode(bytes), charset: label};
    }
    catch (e) {
        return {text: new TextDecoder("iso-8859-1").decode(bytes), charset: "iso-8859-1"};
    }
}

/**
 * The charset declared by an @charset rule at the very start of a stylesheet, or "".
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function cssCharsetOf(bytes) {
    const head = String.fromCharCode.apply(null, bytes.subarray(0, Math.min(bytes.length, 128)));
    const match = head.match(/^@charset "([^"]+)";/i);

    return match? match[1].toLowerCase(): "";
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>} lowercase hex SHA-256
 */
export async function sha256hex(bytes) {
    const subtle = globalThis.crypto?.subtle;

    if (subtle) {
        try {
            const digest = await subtle.digest("SHA-256", bytes);
            return hex(new Uint8Array(digest));
        }
        catch (e) {
            /* insecure context or detached buffer: use the JS implementation */
        }
    }

    return sha256hexSync(bytes);
}

/**
 * Pure JavaScript SHA-256, for contexts without crypto.subtle (content scripts of http: pages).
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex
 */
export function sha256hexSync(bytes) {
    const length = bytes.length;
    const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    padded.set(bytes);
    padded[length] = 0x80;

    const view = new DataView(padded.buffer);
    const bitLength = length * 8;
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(padded.length - 4, bitLength >>> 0);

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = view.getUint32(offset + i * 4);

        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, hh] = h;

        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;

            hh = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }

        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    return h.map(v => v.toString(16).padStart(8, "0")).join("");
}

function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
}

function hex(bytes) {
    let s = "";

    for (let i = 0; i < bytes.length; i++)
        s += bytes[i].toString(16).padStart(2, "0");

    return s;
}

const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
