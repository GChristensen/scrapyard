import {send} from "./proxy.js";
import {backend} from "./backend.js";

async function openReference(tab) {
    let url = decodeURIComponent(new URL(tab.url).hash.substr(1));

    if (url && url.startsWith("ext+scrapyard:")) {
        let id = /ext\+scrapyard:\/\/([^#/]+)/i.exec(url)[1];

        switch (id) {
            case "automation":
            case "advanced":
                browser.tabs.update(tab.id, {"url": browser.runtime.getURL("special/advanced.html"), "loadReplace": true});
                return;
        }

        let [prefix, uuid] = id.includes(":")? id.split(":"): [null, id];
        let node = await backend.getNode(uuid, true);

        if (!prefix)
            send.browseNode({node: node, tab: tab});
        else
            switch (prefix) {
                case "notes":
                    send.browseNotes({uuid: node.uuid, id: node.id, tab: tab});
                    break;
            }
    }
}

browser.tabs.getCurrent().then(openReference);
