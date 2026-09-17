import {settings} from "./settings.js";
import {getSidebarWindow, isInSidebarWindow} from "./utils_sidebar.js";

export const ACTION_ICONS = {
    16: "icons/logo16.png",
    24: "icons/logo24.png",
    32: "icons/logo32.png",
    96: "icons/logo96.png",
    128: "icons/logo128.png"
};

async function injectCSSFileMV3(tabId, options) {
    return browser.scripting.insertCSS({target: {tabId}, files: [options.file]})
}

export const injectCSSFile = _MANIFEST_V3? injectCSSFileMV3: browser.tabs?.insertCSS;

async function injectScriptFileMV3(tabId, options) {
    const target = {tabId};

    if (options.frameId)
        target.frameIds = [options.frameId];

    if (options.allFrames)
        target.allFrames = options.allFrames;

    let immediately = false;
    if (options.runAt === "document_start")
        immediately = true;

    return browser.scripting.executeScript({target, files: [options.file], injectImmediately: immediately});
}

export const injectScriptFile = _MANIFEST_V3? injectScriptFileMV3: browser.tabs?.executeScript;

async function scriptsAllowedMV3(tabId, frameId = 0) {
    try {
        const scriptResult = await browser.scripting.executeScript({
            target: {tabId, frameIds: [frameId]},
            injectImmediately: true,
            // check if it is a builtin Firefox image page
            func: () => document.head.querySelectorAll("link[href='resource://content-accessible/ImageDocument.css']")?.length,
        });

        let isHTML = true;

        if (scriptResult && scriptResult[0] && scriptResult[0].result > 0)
            isHTML = false;

        return isHTML;
    }
    catch (e) {}

    return false;
}

async function scriptsAllowedMV2(tabId, frameId = 0) {
    try {
        const scriptResult = await browser.tabs.executeScript(tabId, {
            frameId: frameId,
            runAt: "document_start",
            // check if it is a builtin Firefox image page
            code: "document.head.querySelectorAll(\"link[href='resource://content-accessible/ImageDocument.css']\")?.length"
        });

        let isHTML = true;

        if (scriptResult && scriptResult[0] && scriptResult[0] > 0)
            isHTML = false;

        return isHTML;
    } catch (e) {}
}

const scriptsAllowed = _MANIFEST_V3? scriptsAllowedMV3: scriptsAllowedMV2;

export async function isHTMLTab(tab) {
    if (settings.platform.firefox)
        return scriptsAllowed(tab.id);
    else {
        const [{result}] = await browser.scripting.executeScript({target: {tabId: tab.id},
                                                                  func: () => document.contentType});
        return result.toLowerCase() === "text/html";
    }
}

// args.imageUrl requests a picture notification: a real large preview on Chrome (type "image"), or, on Firefox
// (which currently implements only type "basic" - see notifications.TemplateType on MDN), the same picture shown
// small as the icon instead, unless args.iconUrl already asked for something else there.
export function showNotification(args) {
    if (typeof arguments[0] === "string")
        args = {message: arguments[0]};

    const defaultIconUrl = _BACKGROUND_PAGE
        ? "/icons/scrapyard.svg"
        : "/icons/logo128.png";

    const options = {
        type: args.type ? args.type : "basic",
        title: args.title ? args.title : "Scrapyard",
        message: args.message,
        iconUrl: args.iconUrl || defaultIconUrl
    };

    if (args.imageUrl) {
        if (settings.platform.chrome) {
            options.type = "image";
            options.imageUrl = args.imageUrl;
        }
        else if (!args.iconUrl)
            options.iconUrl = args.imageUrl;
    }

    return browser.notifications.create(`sbi-notification-${args.type}`, options);
}

export function makeReferenceURL(uuid) {
    let referenceURL = `ext+scrapyard://${uuid}`;

    if (!_BACKGROUND_PAGE)
        referenceURL = browser.runtime.getURL(`/reference.html#${referenceURL}`);

    return referenceURL;
}

export async function getActiveTab() {
    const tabs = await browser.tabs.query({lastFocusedWindow: true, active: true});
    return tabs && tabs.length ? tabs[0] : null;
}

export async function getActiveTabFromSidebar() {
    if (_SIDEBAR || !await isInSidebarWindow())
        return getActiveTab();
    else {
        const sidebarWindow = await getSidebarWindow();
        const tabs = await browser.tabs.query({active: true, windowType: "normal"});
        return tabs.find(t => t.windowId !== sidebarWindow?.id);
    }
}

export async function openPage(url) {
    return browser.tabs.create({"url": url});
}

export async function updateTabURL(tab, url, preserveHistory) {
    const options = {url};

    if (_BACKGROUND_PAGE)
        options.loadReplace = !preserveHistory;

    return browser.tabs.update(tab.id, options);
}

export async function openContainerTab(url, container) {
    try {
        const options = {"url": url};

        if (container)
            options.cookieStoreId = container;

        return await browser.tabs.create(options);
    } catch (e) {
        if (e.message?.includes("cookieStoreId"))
            showNotification("Invalid bookmark container.");

        return browser.tabs.create({"url": url});
    }
}

export const CONTEXT_BACKGROUND = 0;
export const CONTEXT_FOREGROUND = 1;

export function getContextType() {
    return typeof WorkerGlobalScope !== "undefined" || window.location.pathname === "/background.html"
        ? CONTEXT_BACKGROUND
        : CONTEXT_FOREGROUND;
}

export async function askCSRPermission() {
    if (_MANIFEST_V3)
        return browser.permissions.request({origins: ["<all_urls>"]});

    return true;
}

export async function hasCSRPermission(verbose = true) {
    if (_MANIFEST_V3) {
        const response = await browser.permissions.contains({origins: ["<all_urls>"]});

        if (!response && verbose)
            showNotification("Please, enable optional add-on permissions at the Firefox add-on settings page (about:addons).");

        return response;
    }

    return true;
}

export async function grantPersistenceQuota() {
    const shouldAskForPersistence = typeof navigator.storage.persist === "function";
    return !shouldAskForPersistence || shouldAskForPersistence && await navigator.storage.persist();
}

export async function startupLatch(f) {
    if (_MANIFEST_V3) {
        if (browser.storage.session) {
            let initialized = await browser.storage.session.get("scrapyard-initialized");
            initialized = initialized?.["scrapyard-initialized"];

            if (!initialized) {
                await f();
                await browser.storage.session.set({"scrapyard-initialized": true});
            }
        }
        else {
            // until there is no storage.session API,
            // use an alarm as a flag to call the initialization function only once
            const alarm = await browser.alarms.get("startup-flag-alarm");
            if (!alarm) {
                await f();
                browser.alarms.create("startup-flag-alarm", {delayInMinutes: 525960}); // one year
            }
        }
    }
    else
        await f();
}

export function gettingStarted() {
    return openPage("/ui/options.html#help:start");
}
