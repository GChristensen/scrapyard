# Capture engine: manual verification checklist

Automated coverage stops at the DOM-free layers (`node tests/capture/node/run.mjs`). Everything below runs in a
browser with the extension loaded from `addon/` (`just test`, `just test-chrome`).

## Fixture server

```
python tests/capture/fixtures/serve.py            # http://localhost:8080 and http://localhost:8081 (second origin)
```

The server synthesizes what cannot be checked in as text: PNG/GIF images, a WAV clip, a TTF font (copied from the
system), a cookie-gated image (`/gated/logo.png`, needs the cookie set by `/cookie.html`), the `csp.html` response
header, and the second origin for cross-origin frames.

## Harness (content side without the extension)

`http://localhost:8080/harness.html?page=<fixture>` runs `PageCapture` (prepare, frames, passes 1-3, sinks) on a
fixture loaded into a same-origin iframe, with a mock port: same-origin frames only, no background fallback loads,
unpacked writes kept in memory. Parameters: `pretty`, `shadow`, `scripts`, `lazy=scroll|shrink`, `mode=unpacked`,
`selection=<css selector>`, `dump=<css selector>`, `wait=<ms>`, `debug`. The status line, the resource list and the
serialized document (data URIs shortened) are printed into the page, so it also works headless:

```
chrome --headless=new --virtual-time-budget=15000 --dump-dom "http://localhost:8080/harness.html?page=frames.html"
```

Closed shadow roots, cross-origin frames, the background fallback and the port need the real extension.

## Phase checks (directive §16)

Phase 2 (injection): on Firefox MV2, Firefox MV3 and Chrome MV3
- [ ] capturing `css.html` and `images.html` with `debug` on lists the expected resources in the console
      (`[scrapyard capture]` lines: fetch status per URL, frames count)
- [ ] `executeScript` of the stub resolves only after the engine is loaded: `captureTab` never reports
      "no response from the content script" on a cold tab
- [ ] `csp.html` (served with `Content-Security-Policy: script-src 'none'`) captures
- [ ] a `file:` page captures (Chrome; Firefox blocks file: capture in the host)
- [ ] a deliberately broken import (rename a module) makes the capture fail with an error naming the module

Phase 3 (loading): Firefox MV2 and Chrome MV3
- [ ] `css.html`, `mixed.html`, `cookie.html`: every resource ends in `success` or the documented failure reason
      (`mixed`, `corsfail`, `mime`, `load:404`) in the console failure list / `archive.json`
- [ ] Chrome: `chrome.declarativeNetRequest.getSessionRules()` is empty after a capture that used the fallback

Phase 4 (packed serialization): both browsers
- [ ] every fixture renders equivalently to the live page when opened from Scrapyard
- [ ] `saved.html` re-captures without duplicating the provenance metas
- [ ] pretty print (`options-formathtml` in `savepage-settings`) produces a well-formed page that renders the same

Phase 5 (unpacked): Firefox with the helper application, "Save unpacked archives" on
- [ ] `frames.html` and `css.html` produce `index.html`, `frames/<key>.html`, `resources/<hash>.<ext>`, `archive.json`
- [ ] opening through the helper renders equivalently; full-text search finds words of the page and of the frames
- [ ] `archive.json` lists every resource with status, refs and path

Phase 6 (host switch-over)
- [ ] `just build` and `just build-chrome` succeed
- [ ] selection capture (select text, then archive) keeps `<head>` and replaces the body
- [ ] site capture: the options dialog offers "all links" (collectTabLinks), the crawl follows them
- [ ] automation (`scrapyardAddArchive` with `pack: true`) and "archive bookmark" (packPage) still work
- [ ] the lock overlay disappears after the archive is stored, and after a failure

## Fixtures and what a correct capture contains

| Page | Must contain |
|---|---|
| images.html | data URIs for the visible images, `data-scrapyard-srcset` with empty `srcset`, the hidden image as `<!--scrapyard-img-remove-->`, the `opacity:0` image without src but with pinned width/height, `body background` inlined |
| css.html | `<style data-scrapyard-href>` for the linked sheet, `/*scrapyard-import-url=...*/` for each import (cycle handled once), `@font-face` with `/*scrapyard-font-display=swap*/` and a data URI, URLs in strings/comments untouched, the `\26` escaped URL resolved |
| frames.html | nested same-origin frames as `srcdoc` with `data-scrapyard-sameorigin`, the cross-origin frame (port 8081) with `data-scrapyard-crossorigin`, the srcdoc frame, the frameset page with `data:text/html` src, the frame beyond the depth cap with an empty src |
| forms.html | typed text in `value`, checked boxes, the selected option, empty password value |
| canvas_blob.html | the canvas as `/*scrapyard-canvas-image*/ background-image`, the blob image as a PNG data URI |
| shadow.html | (shadow DOM option on) `<template data-scrapyard-shadowroot>` for open and closed roots, the loader script, nested roots rebuilt when opened |
| svg.html | `<use>` followed by `<!--scrapyard-symbol-insert--><symbol ...>`, inline `<svg>` without `<link>`, `<image href>` as a data URI |
| media.html | the WAV as a data URI (only the current `<source>`), `<track>` as a `text/vtt` data URI, the poster inlined, the blob video with a PNG poster |
| scripts.html | (scripts off) `type="text/plain"` and `data-scrapyard-src` on external scripts; (scripts on) data URIs |
| cssinjs.html | the rules inserted with `insertRule` present in the captured `<style>` (from `data-scrapyard-sheetrules`) |
| lazy.html | (scroll or shrink method) the images far below the fold are loaded and inlined |
| csp.html | captures; the meta CSP is emptied with `data-scrapyard-content` |
| mixed.html | (served on https or with an https referrer) the http image fails with `mixed` unless passive mixed content is allowed |
| cookie.html | the gated image loads through the background fallback (`credentials: include`) |
| selection.html | with a selection: the body is only the selection, the `<head>` styles are intact |
| saved.html | the old `savepage-*` metas are dropped, new `scrapyard-*` metas are written, the data URIs pass through |

Plus five live sites of the maintainer's choice including one heavy CSS-in-JS site and reddit.
