# The capture engine (`addon/capture/`)

Converts the live DOM of a tab into an archive: either one self-contained HTML string (**packed**) or a
directory with `index.html`, `frames/<key>.html`, `resources/<hash>.<ext>` and `archive.json` (**unpacked**).

## What lives where

```
shared/        DOM-free modules used by both the content side and the background
  types.js       JSDoc typedefs of the data model (no runtime code)
  constants.js   MARK (the marker vocabulary), element lists, MIME tables, message names
  options.js     defaultOptions(), normalizeOptions(), publicOptions()
  log.js         log(level, ...args), setDebug()
  url.js         resolve/adjust/unsaved/relativePath helpers
  bytes.js       base64 over Uint8Array, text decoding, SHA-256 (crypto.subtle with a pure JS fallback)
  http.js        Content-Type parsing, the mixed-content rule
content/       modules loaded into the captured tab
  stub.js, frame_stub.js, fontface.js   classic scripts (the only files passed to executeScript)
  entry.js       top frame: capture.start / capture.abort / capture.unlock
  frame_entry.js all frames: capture.frames.request -> keys, live-state snapshot, extras
  capture.js     PageCapture: the pipeline (prepare, lazy, frames, styles, load, resources, load, serialize, write)
  port.js        the capture port (request/reply over runtime.connect)
  loader.js      in-page fetch, background fallback, the accept step
  context.js     CaptureContext, one per walked document
  walker.js      the DOM walk shared by the three passes (shadow roots, frames, exclusions)
  frames.js      frame table and same-/cross-origin resolution;  frame_keys.js, snapshot.js, extras.js
  prepare.js, lazy.js, quirks.js
  core/          content-only but DOM-free: css.js (tokenizer), fonts.js, stylesheet.js (scan/rewrite),
                 resource_store.js, tag.js
  passes/        discover_styles.js (pass 1), discover_resources.js (pass 2), serialize.js (pass 3)
  sinks/         packed.js, unpacked.js
  rules/         one file per element family; index.js holds THE ordered list, registry.js picks the first match
background/    modules imported by the background (core.js)
  service.js     captureTab(), unlockTab(), collectTabLinks(); importing it registers the port server and relay
  inject.js, port_server.js, frame_relay.js, fallback_loader.js, referer_policy.js, file_writer.js
page/
  shadow_loader.js   runtime embedded into saved pages (rebuilds shadow roots), never imported
```

The host adapter is `addon/capture_options.js` (settings mapping) plus `bookmarking.js` (`runPageCapture`,
`storeCapturedPage`, `packPage`). Nothing inside `addon/capture/` knows about bookmarks, storage or jQuery.

## Layering

A module imports only from its own layer or a lower one; `tests/capture/node/layering.test.mjs` enforces it.

1. `shared/` imports only `shared/`; touches neither `document`, `window` nor `browser`.
2. `content/core/` imports `shared/` and `content/core/`; DOM-free like `shared/`.
3. the rest of `content/` imports anything above plus `content/`; may use the DOM and `browser.runtime`.
4. `background/` imports `shared/` and `background/`, never `content/`.

Module evaluation has no side effects except in `entry.js`, `frame_entry.js` (their `runtime.onMessage` listener)
and the `background/` modules that register `onConnect` / `onMessage` / `webRequest` listeners.

## Packaging

The content side is ES modules. A classic stub injected with `executeScript` runs
`import(chrome.runtime.getURL("capture/content/entry.js"))`, so every module directory must be listed in
`web_accessible_resources` of **all three** manifest templates (`manifest.json.mv2`, `.mv3`, `.mv3.chrome`), one
pattern per directory: `capture/shared/*`, `capture/content/*`, `capture/content/core/*`, `capture/content/passes/*`,
`capture/content/sinks/*`, `capture/content/rules/*`. **A new subdirectory needs a new pattern in all three
templates** (the layering test checks this). On Chrome the host injects `lib/browser-polyfill.js` first, because the
listeners return promises.

## Messages

Host to content (`tabs.sendMessage`, top frame): `capture.start {options, mode, selection?, extras?}` answered with
`{accepted}`; `capture.abort`; `capture.unlock`. Host to all frames: `capture.frames.request`, answered by each frame
with `capture.frames.reply` over `runtime.sendMessage`. Everything else runs over the port `scrapyard-capture` opened by
the top frame for the duration of the run: requests `capture.frames.collect`, `capture.load`, `capture.write`
(`{id, type, payload}` answered by `{id, reply}` or `{id, error}`), notifications `capture.progress`, `capture.done`,
`capture.failed`. Binary data crosses the port as base64.

## Tests

`node tests/capture/node/run.mjs` (Node >= 22.12) runs the unit tests of `shared/` and `content/core/` plus the
layering test. Browser checks are manual: `tests/capture/CHECKLIST.md` and the fixture pages in
`tests/capture/fixtures/` (served by `python tests/capture/fixtures/serve.py`).
