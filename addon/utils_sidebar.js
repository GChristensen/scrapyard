import {settings} from "./settings.js";
import {sleep} from "./utils.js";

const SCRAPYARD_SIDEBAR_URL = browser.runtime.getURL("/ui/sidebar.html");

export async function getSidebarWindow() {
    const popupWindows = await browser.windows.getAll({
        populate: true,
        windowTypes: ["popup"]
    });

    for (const window of popupWindows)
        if (window.tabs.some(t => t.url === SCRAPYARD_SIDEBAR_URL))
            return window;
}

export async function createSidebarWindow(focused = true) {
    const position = await settings.sidebar_window_position() || {};
    const params = {
        url: SCRAPYARD_SIDEBAR_URL,
        type: "popup",
        focused,
        width: position.width || 400,
        top: position.top || 50,
        left: position.left || 50,
    };

    if (position.height)
        params.height = position.height;

    try {
        return await browser.windows.create(params);
    }
    catch (e) {
        console.error(e);

        params.width = 400;
        params.top = 50;
        params.left = 50;
        return browser.windows.create(params);
    }
}

export async function toggleSidebarWindow() {
    const sidebarWindow = await getSidebarWindow();

    if (sidebarWindow)
        await browser.windows.update(sidebarWindow.id, {focused: true});
    else
        await createSidebarWindow();
}

// sidePanel.open requires a user gesture, so it should be called synchronously from
// a command or click handler, without awaiting anything before
export function openSidePanel(windowId = browser.windows.WINDOW_ID_CURRENT) {
    return browser.sidePanel.open({windowId}).catch(e => console.error(e));
}

// true if the current document is the sidebar opened in a popup window, not in a side panel
export async function isInSidebarWindow() {
    return !!(await browser.tabs.getCurrent());
}

async function getSidePanelWindowId() {
    const contexts = await browser.runtime.getContexts({
        contextTypes: ["SIDE_PANEL"],
        documentUrls: [SCRAPYARD_SIDEBAR_URL]
    });

    if (contexts.length) {
        try {
            const lastFocused = await browser.windows.getLastFocused({windowTypes: ["normal"]});
            const context = contexts.find(c => c.windowId === lastFocused?.id);

            if (context)
                return context.windowId;
        }
        catch (e) {
            console.error(e);
        }

        return contexts[0].windowId;
    }
}

// Returns the id of the window with a sidebar document that should handle the messages
// requiring a DOM (on Chrome). Opens the sidebar popup window if there is no open sidebar.
export async function ensureSidebarHost(sleepMs) {
    if (_SIDE_PANEL) {
        const windowId = await getSidePanelWindowId();

        if (windowId !== undefined)
            return windowId;
    }

    const sidebarWindow = await getSidebarWindow();

    if (sidebarWindow)
        return sidebarWindow.id;

    const newWindow = await createSidebarWindow(false);
    await sleep(sleepMs || 700);
    return newWindow?.id;
}
