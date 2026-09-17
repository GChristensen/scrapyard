import assert from "node:assert/strict";
import {toBase64, fromBase64, hasUtf8Bom, decodeText, cssCharsetOf, sha256hex, sha256hexSync, utf8Encode}
    from "../../../addon/capture/shared/bytes.js";

function roundTrip(bytes) {
    const back = fromBase64(toBase64(bytes));
    assert.equal(back.length, bytes.length);
    for (let i = 0; i < bytes.length; i++)
        if (back[i] !== bytes[i])
            assert.fail(`byte ${i} differs`);
}

export const tests = {
    "base64 round trips: empty and 1..3 byte tails"() {
        roundTrip(new Uint8Array(0));
        roundTrip(new Uint8Array([1]));
        roundTrip(new Uint8Array([1, 2]));
        roundTrip(new Uint8Array([1, 2, 3]));
        roundTrip(new Uint8Array([255, 0, 128, 7]));
        assert.equal(toBase64(new Uint8Array([104, 105])), "aGk=");
    },

    "base64 round trips 5 MB across chunk boundaries"() {
        const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = (i * 31) & 0xFF;
        roundTrip(bytes);
    },

    "BOM detection"() {
        assert.equal(hasUtf8Bom(new Uint8Array([0xEF, 0xBB, 0xBF, 65])), true);
        assert.equal(hasUtf8Bom(new Uint8Array([0xEF, 0xBB])), false);
        assert.equal(hasUtf8Bom(new Uint8Array([65, 66, 67])), false);
    },

    "decodeText: BOM wins and is stripped"() {
        const {text, charset} = decodeText(new Uint8Array([0xEF, 0xBB, 0xBF, 0xC3, 0xA9]), "iso-8859-1");
        assert.equal(text, "é");
        assert.equal(charset, "utf-8");
    },

    "decodeText: malformed utf-8 falls back to iso-8859-1"() {
        const {text, charset} = decodeText(new Uint8Array([0xE9, 0x41]), "utf-8");
        assert.equal(charset, "iso-8859-1");
        assert.equal(text, "éA");
    },

    "decodeText: unknown label falls back to iso-8859-1"() {
        const {charset} = decodeText(new Uint8Array([65]), "x-nonsense-charset");
        assert.equal(charset, "iso-8859-1");
    },

    "decodeText: declared charset is honored"() {
        const {text, charset} = decodeText(new Uint8Array([0xE9]), "windows-1252");
        assert.equal(text, "é");
        assert.equal(charset, "windows-1252");
    },

    "cssCharsetOf"() {
        assert.equal(cssCharsetOf(utf8Encode("@charset \"ISO-8859-15\";\nbody{}")), "iso-8859-15");
        assert.equal(cssCharsetOf(utf8Encode("body{}")), "");
        assert.equal(cssCharsetOf(new Uint8Array(0)), "");
    },

    async "sha256hex known vectors (subtle and pure JS)"() {
        const abc = utf8Encode("abc");
        const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert.equal(await sha256hex(abc), expected);
        assert.equal(sha256hexSync(abc), expected);
        assert.equal(sha256hexSync(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

        const long = utf8Encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq");
        assert.equal(sha256hexSync(long), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

        const big = new Uint8Array(1000000).fill(97);  // one million "a"
        assert.equal(sha256hexSync(big), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
        assert.equal(await sha256hex(big), sha256hexSync(big));
    }
};
