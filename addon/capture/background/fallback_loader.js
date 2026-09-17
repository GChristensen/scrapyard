// The background fallback for resources the content script could not fetch (CORS, credentials):
// mixed-content check, referer control, fetch with credentials, optional write to the archive.

import {isSafeContent, isLoadAllowed, parseContentType} from "../shared/http.js";
import {toBase64} from "../shared/bytes.js";
import {log} from "../shared/log.js";
import {applyRefererPolicy} from "./referer_policy.js";

/**
 * @param {object} request        the capture.load payload
 * @param {string} request.url
 * @param {string} request.referrer
 * @param {"strict"|"origin"|"origin-path"} request.referer
 * @param {boolean} request.passive
 * @param {string} request.pageScheme
 * @param {number} request.maxSize      MB
 * @param {number} request.maxTime      seconds
 * @param {boolean} [request.write]
 * @param {object} env
 * @param {boolean} env.incognito
 * @param {boolean} env.allowPassiveMixedContent
 * @param {import("./file_writer.js").ArchiveWriter|null} env.writer
 * @param {AbortSignal} [env.signal]
 * @returns {Promise<object>} {ok:true, mime, charset, size, data?} | {ok:true, mime, charset, size, hash, path} | {ok:false, reason}
 */
export async function loadResource(request, env) {
    const url = request.url;
    const referrer = request.referrer || "";

    if (!isLoadAllowed({url, referrer, passive: request.passive}, request.pageScheme, env.allowPassiveMixedContent))
        return {ok: false, reason: "mixed"};

    const refererValue = refererFor(request, referrer, env.incognito);
    const policy = await applyRefererPolicy(url, refererValue, null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (request.maxTime || 30) * 1000);
    const onAbort = () => controller.abort();
    env.signal?.addEventListener("abort", onAbort, {once: true});

    try {
        const init = {method: "GET", cache: "no-cache", credentials: "include", signal: controller.signal, headers: policy.headers};

        if (!refererValue)
            init.referrerPolicy = "no-referrer";

        const response = await fetch(url, init);

        log("debug", "background fetch", response.status, url);

        if (response.status !== 200)
            return {ok: false, reason: "load:" + response.status};

        const maxSize = (request.maxSize || 50) * 1024 * 1024;
        const contentLength = +(response.headers.get("Content-Length") || 0);

        if (contentLength > maxSize)
            return {ok: false, reason: "maxsize"};

        const {mime, charset} = parseContentType(response.headers.get("Content-Type"));
        const bytes = new Uint8Array(await response.arrayBuffer());

        if (bytes.length > maxSize)
            return {ok: false, reason: "maxsize"};

        if (request.write && env.writer) {
            const {hash, path} = await env.writer.writeResource({bytes, mime, url});
            return {ok: true, mime, charset, size: bytes.length, hash, path};
        }

        return {ok: true, mime, charset, size: bytes.length, data: toBase64(bytes)};
    }
    catch (e) {
        if (e?.name === "AbortError")
            return {ok: false, reason: env.signal?.aborted? "aborted": "maxtime"};

        log("debug", "background fetch failed", url, e?.message);
        return {ok: false, reason: e instanceof TypeError? "network": "send"};
    }
    finally {
        clearTimeout(timer);
        env.signal?.removeEventListener("abort", onAbort);
        await policy.dispose();
    }
}

/**
 * The Referer value to send: none unless the load is safe content and the referrer is http(s), then by option.
 * @param {object} request
 * @param {string} referrer
 * @param {boolean} incognito
 * @returns {string|null}
 */
export function refererFor(request, referrer, incognito) {
    if (!isSafeContent(request.url, referrer, request.pageScheme))
        return null;

    if (referrer.startsWith("file:") || referrer.startsWith("data:") || referrer === "")
        return null;

    let parsed;

    try {
        parsed = new URL(referrer);
    }
    catch (e) {
        return null;
    }

    switch (request.referer) {
        case "origin":
            return parsed.origin;
        case "origin-path":
            return incognito? parsed.origin: parsed.origin + parsed.pathname;
        default:
            return null;
    }
}
