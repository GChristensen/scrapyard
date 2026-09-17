// Runs PageCapture on a fixture loaded into a same-origin iframe, with a mock capture port.

import {PageCapture} from "/engine/content/capture.js";
import {normalizeOptions} from "/engine/shared/options.js";
import {MESSAGE} from "/engine/shared/constants.js";
import {setDebug} from "/engine/shared/log.js";
import {frameKeyOf, identifyFrames} from "/engine/content/frame_keys.js";
import {annotateLiveState, loadedFontsOf} from "/engine/content/snapshot.js";
import {indexWords, collectLinks} from "/engine/content/extras.js";

const params = new URLSearchParams(location.search);
const page = params.get("page") || "css.html";
const logElement = document.getElementById("log");
const status = document.getElementById("status");

function log(...args) {
    logElement.textContent += args.map(a => typeof a === "string"? a: JSON.stringify(a)).join(" ") + "\n";
}

/** The part of frame_entry.js that can run without the extension: same-origin frames, reached recursively. */
function collectSameOriginFrames(win, request, acc = []) {
    const doc = win.document;

    identifyFrames(doc);

    if (request.annotate)
        annotateLiveState(doc);

    const reply = {key: frameKeyOf(win), url: doc.baseURI, html: "", fonts: loadedFontsOf(doc)};

    if (request.extras?.index)
        reply.index = indexWords(doc.body);

    if (request.extras?.links)
        reply.links = collectLinks(doc);

    acc.push(reply);

    for (let i = 0; i < win.frames.length; i++) {
        try {
            if (win.frames[i].document)
                collectSameOriginFrames(win.frames[i], request, acc);
        }
        catch (e) {
            /* cross-origin: needs the extension */
        }
    }

    return acc;
}

/** files written in unpacked mode: path -> {mime, size} */
const written = new Map();

function mockWrite(payload) {
    let path = payload.path;

    if (payload.kind === "resource")   /* the background's file_writer.js names resources the same way */
        path = "resources/" + payload.hash.slice(0, 16) + "." + (payload.mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");

    const size = payload.encoding === "base64"? Math.floor(payload.data.length * 3 / 4): payload.data.length;
    written.set(path, {mime: payload.mime, size, text: payload.encoding === "text"? payload.data: null});

    return {path};
}

function mockPort(targetWindow) {
    return {
        connected: true,
        async request(type, payload) {
            switch (type) {
                case MESSAGE.framesCollect: {
                    // frame keys are computed up to window.top; the fixture is a subframe of the harness, so its
                    // own key ("0-0") is rebased to "0" as it would be in a real tab
                    const prefix = frameKeyOf(targetWindow);
                    const frames = collectSameOriginFrames(targetWindow, payload)
                        .map(frame => ({...frame, key: "0" + frame.key.slice(prefix.length)}));
                    return {frames, expected: frames.length};
                }
                case MESSAGE.write:
                    return mockWrite(payload);
                case MESSAGE.load:
                    return {ok: false, reason: "send"};   /* no background in the harness */
                default:
                    throw new Error("harness: unsupported request " + type);
            }
        },
        notify() {},
        on() {},
        onDisconnect() {},
        disconnect() {}
    };
}

async function run() {
    setDebug(params.has("debug"));

    const source = document.getElementById("source");
    await new Promise(resolve => { source.onload = resolve; source.src = page; });
    await new Promise(resolve => setTimeout(resolve, +(params.get("wait") || 1000)));   /* let scripts of the fixture run */

    const targetWindow = source.contentWindow;

    if (params.has("dump"))   /* the live markup of an element of the fixture, before the capture */
        log("dump:", source.contentDocument.querySelector(params.get("dump"))?.outerHTML || "(not found)");

    const options = normalizeOptions({
        version: "harness",
        lockOverlay: false,
        frameReplyTimeout: 100,
        prettyPrint: params.has("pretty"),
        shadowDom: params.has("shadow"),
        scripts: params.has("scripts"),
        lazyLoad: params.get("lazy") || "none",
        shadowLoaderSource: params.has("shadow")? await (await fetch("/engine/page/shadow_loader.js")).text(): ""
    });

    const capture = new PageCapture(source.contentDocument, options, {
        port: mockPort(targetWindow),
        signal: new AbortController().signal,
        onProgress: progress => status.textContent = progress.stage
    });

    const started = performance.now();
    // &selection=<css selector>: capture the outer HTML of the matching element as if it were the user's selection
    const selector = params.get("selection");
    const selection = selector? source.contentDocument.querySelector(selector)?.outerHTML: undefined;

    const mode = params.get("mode") === "unpacked"? "unpacked": "packed";
    const result = await capture.run({mode, selection, extras: {index: true, links: true}});

    window.__capture = {result, html: result.html, manifest: result.manifest, error: null};

    const blob = new Blob([result.html], {type: "text/html"});
    document.getElementById("archive").src = URL.createObjectURL(blob);

    status.textContent = `done in ${Math.round(performance.now() - started)} ms, ${result.html.length} chars`;
    log("failures:", result.failures);
    log("resources:", result.manifest.resources.map(r => `${r.status} ${r.kind} ${r.url} refs=${r.refs.html}/${r.refs.css}`));
    log("frames:", result.manifest.frames);
    log("index words:", (result.index || []).length, "links:", (result.links || []).length);

    if (mode === "unpacked") {
        log("written:", [...written].map(([path, file]) => `${path} ${file.mime} ${file.size}`));

        for (const [path, file] of written)
            if (path.startsWith("frames/"))
                log("---- " + path + "\n" + file.text);
    }

    // the serialized document with data URIs shortened, for reading
    const output = document.createElement("pre");
    output.id = "output";
    output.textContent = result.html.replace(/(data:[^;,"')]*(?:;[^,"')]*)?,)[^"')\s]{40,}/g, (m, head) => head + "…[" + m.length + "]");
    document.body.appendChild(output);
}

run().catch(error => {
    window.__capture = {error: String(error?.stack || error)};
    status.textContent = "failed";
    log(String(error?.stack || error));
});
