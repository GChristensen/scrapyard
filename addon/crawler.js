import {packPage} from "./bookmarking.js";
import {Bookmark} from "./bookmarks_bookmark.js";
import {NODE_TYPE_ARCHIVE} from "./storage.js";
import {fetchWithTimeout} from "./utils_io.js";
import {send} from "./proxy.js";
import {sleep} from "./utils.js";
import {isHTMLLink} from "./utils_html.js";
import {showNotification} from "./utils_browser.js";
import {markNodePending} from "./storage_pending.js";

class Rules {
    #rules;

    constructor(rules) {
        this.#rules = this.#constructRules(rules);
    }

    match(link) {
        let result = false;
        if (!this.#rules)
            result = true;
        else
            for (const rule of this.#rules) {
                const content = rule.scope === "url"? link.url: link.text;
                let matches = false;

                if (rule.mode === "regex")
                    matches = rule.matcher.test(content);
                else
                    matches = content?.toLowerCase() === rule.matcher.toLowerCase();

                if (matches) {
                    result = true;
                    break;
                }
            }

        return result;
    }

    get empty() {
        return !this.#rules;
    }

    #constructRules(rules) {
        const lines = rules.trim().split("\n");

        if (lines.length) {
            const result = [];

            for (const line of lines) {
                const rule = this.#constructRule(line);
                if (rule)
                    result.push(rule);
            }

            if (result.length)
                return result;
        }
    }

    #constructRule(line) {
        const rule = {scope: "url", mode: "regex"};
        line = line.trim();

        if (line) {
            if (line.startsWith("$text:")) {
                rule.scope = "text";
                line = line.replace(/^\$text:/, "");
            }

            if (!line.startsWith("/"))
                rule.mode = "string";

            if (rule.scope !== "text")
                line = line.split(" ")[0];

            if (rule.mode === "regex") {
                line = line.replace("\\/", "/");
                const matches = line.match(/^\/(.*)\/([a-zA-Z]*)?$/);
                if (matches)
                    rule.matcher = new RegExp(matches[1], matches[2]);
                else {
                    rule.mode = "string";
                    rule.matcher = line;
                }
            }
            else
                rule.matcher = line;

            return rule;
        }
    }
}

class Queue {
    #options;
    #rootURL;
    #rootHost;
    #links = [];
    #visitedURLs;

    constructor(rootURL, options) {
        this.#rootURL = rootURL;
        this.#rootHost = new URL(rootURL).host;
        this.#options = options;

        const normalizedURL = this.#normalizeURL(rootURL);
        this.#visitedURLs = new Set([normalizedURL]);
    }

    #normalizeURL(url) {
        if (this.#options.ignoreHashes)
            url = url.replace(/#.*$/, "");

        return url;
    }

    push(link) {
        const normalizedURL = this.#normalizeURL(link.url);
        if (!this.#visitedURLs.has(normalizedURL)) {
            this.#visitedURLs.add(normalizedURL);
            this.#links.push(link);
        }
    }

    pop() {
        return this.#links.shift();
    }

    get size() {
        return this.#links.length;
    }
}

class Crawler {
    #queue;
    #options;
    #includeRules;
    #excludeRules;
    #siteBookmark;
    #threads = 0;
    #abort = false;
    onFinish = () => null;

    constructor(bookmark) {
        this.#siteBookmark = bookmark;
        this.#options = {...bookmark.__site_capture};
        this.#includeRules = new Rules(this.#options.includeRules);
        this.#excludeRules = new Rules(this.#options.excludeRules);
        this.#queue = new Queue(bookmark.uri, this.#options);
    }

    enqueue(bookmark) {
        const options = bookmark.__site_capture;

        if (options.level < this.#options.depth && options.links) {
            for (const link of options.links) {
                if (this.#isLinkAllowed(link)) {
                    link.level = options.level + 1;
                    this.#queue.push(link);
                }
            }
        }
    }

    abort() {
        this.#abort = true;
    }

    async startThreads() {
        this.#threads = Math.min(this.#options.threads, this.#queue.size);
        for (let i = 0; i < this.#threads; ++i) {
            this.#visitLink(this.#queue.pop());

            if (this.#options.delay)
                await sleep(this.#options.delay * 1000);
        }
    }

    #isLinkAllowed(link) {
        const include = this.#includeRules.match(link);
        const exclude = !this.#excludeRules.empty && this.#excludeRules.match(link);
        return include && !exclude;
    }

    async #visitLink(link) {
        const options = {...this.#options};
        options.level = link.level;

        try {
            const bookmark = await this.#savePage(link, options);

            if (bookmark)
                this.enqueue(bookmark);
        } catch (e) {
            console.error(e);
        }

        this.#crawl();
    }

    async #crawl() {
        if (this.#abort)
            return;

        if (this.#options.delay)
            await sleep(this.#options.delay * 1000);

        const nextLink = this.#queue.pop();

        if (nextLink)
            this.#visitLink(nextLink);
        else {
            this.#threads -= 1;
            if (this.#threads === 0)
                this.onFinish();
        }
    }

    async #savePage(link, options) {
        const bookmark = {
            uri: link.url,
            name: "Site Page",
            __site_capture: options,
            _unlisted: true,
            parent_id: this.#siteBookmark.parent_id
        };

        const node = await Bookmark.idb.add(bookmark, NODE_TYPE_ARCHIVE);
        markNodePending(node);
        const isHTML = await isHTMLLink(link.url);
        let resource;

        if (isHTML === true)
            resource = await this.#captureHTMLPage(node, link);
        else if (isHTML === false)
            resource = await this.#captureNonHTMLPage(node, link);

        if (resource)
            await this.#saveArchive(resource);

        return resource?.bookmark
    }

    #captureHTMLPage(node, link) {
        node.__url_packing = true;
        const resolver = (m, t) => ({bookmark: m.bookmark, content: m.html, title: t.title, icon: t.favIconUrl});
        return packPage(link.url, node, null, resolver);
    }

    async #captureNonHTMLPage(node, link) {
        let response;
        try {
            response = await fetchWithTimeout(link.url);
        } catch (e) {
            console.error(e);
        }
        const result = {bookmark: node, title: link.text};

        if (response?.ok) {
            result.contentType = response.headers.get("content-type");
            result.content = await response.arrayBuffer();
        }

        return result;
    }

    async #saveArchive(result) {
        const node = result.bookmark;
        const content = result.content || "";
        const contentType = result.contentType || "text/html";

        node.name = result.title;
        node._unlisted = undefined;

        if (result.icon) {
            node.icon = result.icon;
            await Bookmark.storeIcon(node);
        }

        return Bookmark.storeArchive(node, content, contentType, node.__index);
    }
}

let crawler;

export function initialize(bookmark) {
    if (crawler) {
        showNotification("Another site capture process is running");
        return false;
    }
    else {
        crawler = new Crawler(bookmark);
        crawler.onFinish = finalize;
        return true;
    }
}

export function crawl(bookmark) {
    if (crawler) {
        crawler.enqueue(bookmark);
        crawler.startThreads();
    }
}

export function abort() {
    if (crawler) {
        crawler.abort();
        setTimeout(finalize, 500);
    }
}

async function finalize() {
    crawler = undefined;
    await send.stopProcessingIndication();
    await send.toggleAbortMenu({show: false});
    await send.nodesUpdated();
}
