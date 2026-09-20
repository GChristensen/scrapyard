import {send} from "./proxy.js";
import {Node} from "./storage_entities.js";
import {systemInitialization} from "./bookmarks_init.js";
import {updateTabURL} from "./utils_browser.js";
import {removeFromBookmarksToolbar} from "./bookmarking.js";

async function openReference(tab) {
    await systemInitialization;

    let url = decodeURIComponent(new URL(tab.url).hash.substr(1));

    if (url && url.startsWith("ext+scrapyard:")) {
        let id = /ext\+scrapyard:\/\/([^#/]+)/i.exec(url)[1];

        switch (id) {
            case "advanced":
                return updateTabURL(tab, browser.runtime.getURL("ui/options.html#advanced"), false);
        }

        let [prefix, uuid] = id.includes(":")? id.split(":"): [null, id];
        let node = await Node.getByUUID(uuid);

        if (node) {
            if (!prefix)
                send.browseNode({node: node, tab: tab, closeTab: true});
            else
                switch (prefix) {
                    case "notes":
                        send.browseNotes({uuid: node.uuid, tab: tab, closeTab: true});
                        break;
                    case "gallery":
                        await updateTabURL(tab, browser.runtime.getURL("ui/gallery.html#" + node.uuid), false);
                        break;
                }
        }
        else {
            const notFoundWrapperDiv = document.getElementById("not-found-wrapper");
            notFoundWrapperDiv.style.display = "block";

            if (location.search.includes("toolbar"))
                await removeFromBookmarksToolbar(uuid);
        }
    }
}

browser.tabs.getCurrent().then(openReference);
window.onhashchange = () => browser.tabs.getCurrent().then(openReference);
