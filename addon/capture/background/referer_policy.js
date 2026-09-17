// Referer/Origin header control for the background fallback loader.
//   Firefox (MV2, and MV3 while webRequestBlocking is declared): a blocking webRequest listener renames
//     x-scrapyard-referer/x-scrapyard-origin, registered once at module load.
//   Chrome MV3: a declarativeNetRequest session rule for the one request URL, removed afterwards.
//   Otherwise: no header control; the fetch referrer/referrerPolicy options are the only lever (documented limitation).

import {escapeRegex} from "../shared/url.js";
import {log} from "../shared/log.js";

export const REFERER_HEADER = "x-scrapyard-referer";
export const ORIGIN_HEADER = "x-scrapyard-origin";

const manifest = browser.runtime.getManifest();
const hasBlockingWebRequest = !!(browser.webRequest?.onBeforeSendHeaders && (manifest.permissions || []).includes("webRequestBlocking"));
const hasSessionRules = !hasBlockingWebRequest && !!(browser.declarativeNetRequest?.updateSessionRules);

/** ids of session rules never collide with the static rules of net_rules.json */
let nextRuleId = 10000;

let listenerRegistered = false;

/** Registered on first use, so extension pages that merely import the engine do not install it. */
function registerRenameListener() {
    if (listenerRegistered)
        return;

    listenerRegistered = true;

    try {
        browser.webRequest.onBeforeSendHeaders.addListener(details => {
            let changed = false;

            for (const header of details.requestHeaders) {
                const name = header.name.toLowerCase();

                if (name === REFERER_HEADER) { header.name = "Referer"; changed = true; }
                else if (name === ORIGIN_HEADER) { header.name = "Origin"; changed = true; }
            }

            return changed? {requestHeaders: details.requestHeaders}: {};
        }, {urls: ["<all_urls>"], types: ["xmlhttprequest"]}, ["blocking", "requestHeaders"]);
    }
    catch (e) {
        console.error(e);
    }
}

/**
 * @returns {"webRequest"|"dnr"|"none"} the mechanism available in this browser
 */
export function refererMechanism() {
    return hasBlockingWebRequest? "webRequest": (hasSessionRules? "dnr": "none");
}

/**
 * Prepares header control for one request. Returns the extra fetch headers to send and a disposer.
 * @param {string} url
 * @param {string|null} refererValue
 * @param {string|null} originValue
 * @returns {Promise<{headers: Object<string, string>, dispose: () => Promise<void>}>}
 */
export async function applyRefererPolicy(url, refererValue, originValue) {
    const headers = {};

    if (!refererValue && !originValue)
        return {headers, dispose: async () => {}};

    if (hasBlockingWebRequest) {
        registerRenameListener();

        if (refererValue) headers[REFERER_HEADER] = refererValue;
        if (originValue) headers[ORIGIN_HEADER] = originValue;

        return {headers, dispose: async () => {}};
    }

    if (hasSessionRules) {
        const id = nextRuleId++;
        const requestHeaders = [];

        if (refererValue) requestHeaders.push({header: "referer", operation: "set", value: refererValue});
        if (originValue) requestHeaders.push({header: "origin", operation: "set", value: originValue});

        const rule = {
            id,
            priority: 1,
            action: {type: "modifyHeaders", requestHeaders},
            condition: {regexFilter: "^" + escapeRegex(url) + "$", resourceTypes: ["xmlhttprequest"]}
        };

        try {
            await browser.declarativeNetRequest.updateSessionRules({addRules: [rule]});
        }
        catch (e) {
            log("debug", "session rule rejected (the URL may exceed the regexFilter limit); no referer control", e?.message);
            return {headers, dispose: async () => {}};
        }

        return {
            headers,
            async dispose() {
                try {
                    await browser.declarativeNetRequest.updateSessionRules({removeRuleIds: [id]});
                }
                catch (e) {
                    log("error", "session rule removal failed", e);
                }
            }
        };
    }

    log("debug", "no referer control in this browser; the referer is browser-controlled");

    return {headers, dispose: async () => {}};
}
