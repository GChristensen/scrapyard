# Architectural patterns of the capture engine (`addon/capture/`)

*This document names the design patterns the capture engine is built from. For each pattern it says where the
pattern lives in the code, what problem it solves, and which rule keeps it intact. Read `addon/capture/README.md`
for the file map. `CAPTURE_ENGINE_DIRECTIVE.md` has the specification and `CAPTURE.md` describes the old engine
this one replaced.*

---

## 0. The shape in one picture

```
                    host (Scrapyard)                                    engine (addon/capture)
 ┌────────────────────────────────────────────┐        ┌──────────────────────────────────────────────────────┐
 │ bookmarking.js      runPageCapture()       │        │ background/service.js   captureTab()   ◄── Facade     │
 │ capture_options.js  savepage-settings ─►   │──────► │   port_server  frame_relay  fallback_loader           │
 │                     CaptureOptions         │        │   referer_policy  file_writer ──► FileWriter (port)   │
 │ FileWriter impl ─► Archive.saveFile()      │ ◄───── │                                                       │
 └────────────────────────────────────────────┘        │        ▲  capture port (request/reply)                │
                                                       │        ▼                                              │
                                                       │ content/capture.js   PageCapture.run()  ◄── Pipeline  │
                                                       │   walker ── visitors: discover_styles │ discover_     │
                                                       │                       resources │ serialize           │
                                                       │   rules/index.js (ordered rule list)                  │
                                                       │   sinks: PackedSink │ UnpackedSink      ◄── Strategy  │
                                                       │   core/: css tokenizer, fonts, ResourceStore, Tag     │
                                                       │ shared/: types, constants (MARK), options, url, bytes │
                                                       └──────────────────────────────────────────────────────┘
```

---

## 1. Structural patterns

### 1.1 Layered architecture with an enforced dependency rule

**Where:** `shared/`, `content/core/`, the rest of `content/`, and `background/`.
`tests/capture/node/layering.test.mjs` enforces the rule.

**What:** four layers, and a module imports only from its own layer or a lower one.
- `shared/` and `content/core/` are DOM-free.
- `content/` may use the DOM and `browser.runtime`.
- `background/` never imports `content/`.

**Why:** the lower layers carry the logic that is easiest to get subtly wrong: the CSS tokenizer, the font policy,
URL rules, base64 and SHA-256, the resource table and the tag builder. Because they are DOM-free they run in Node
with no mocks. The rule also keeps one definition of the types, the option defaults and the mixed-content rule for
both runtime contexts.

**Kept intact by:** the layering test. It checks import direction, that there are no cycles, that specifiers are
relative with a `.js` extension, the 500-line file cap, and that the manifest `web_accessible_resources` entries
cover every module directory.

### 1.2 Ports and adapters (hexagonal boundary)

**Where:**
- **Inbound port:** `captureTab(tabId, request)` in `background/service.js`, and `PageCapture.run()` on the content side.
- **Outbound port:** the `FileWriter` interface, with the single method `write({path, bytes, mime})`.
- **Host adapters:** `addon/capture_options.js` for options, and `runPageCapture` / `storeCapturedPage` in `bookmarking.js`.

**What:** the engine knows nothing about bookmarks, `Archive`, `settings.js`, storage backends or jQuery. The host
passes plain options in and receives a plain `CaptureResult`. For unpacked archives the host supplies a writer, and
Scrapyard's implementation calls `Archive.saveFile()`.

**Why:** the engine can be tested in isolation, reused by other callers (`packPage`, the crawler, automation), and
swapped. For example, an adapter for the old engine could implement the same `captureTab` contract.

### 1.3 Anti-corruption layer for configuration

**Where:** `capture_options.js`: `mapCaptureSettings()` and `buildCaptureOptions()`.
`shared/options.js`: `normalizeOptions()`.

**What:** the legacy storage object `savepage-settings`, with keys like `options-savecssfontsall` and
`options-crossorigin`, is translated once, at the host boundary, into the engine's own vocabulary. For example,
`fonts: "used"|"woff"|"all"` or `referer: "strict"|"origin"|"origin-path"`. The engine normalizes again on entry
(defaults, enum validation, numeric clamping). A malformed message therefore cannot put an out-of-range value into
the pipeline.

**Why:** the stored format stays compatible with the options UI and settings import, while the engine's options
stay small and explicit. Host-only fields (`lockIconUrl`, `shadowLoaderSource`, `isFirefox`, `incognito`) are
listed in `HOST_ONLY_OPTIONS` and removed from the manifest by `publicOptions()`.

### 1.4 Facade

**Where:** `background/service.js`, which exports `captureTab`, `unlockTab` and `collectTabLinks`.
`content/capture.js`: `PageCapture`.

**What:** one call hides injection, session registration, the port, the frame relay, fallback loads, writes and
tab-removal and abort handling.

### 1.5 Single source of vocabulary and types

**Where:** `shared/constants.js` (`MARK`, `MESSAGE`, element lists, MIME tables) and `shared/types.js` (JSDoc typedefs only).

**What:** every marker written into a saved page comes from the frozen `MARK` object: `data-scrapyard-*`, CSS and
HTML comments, meta names, element ids. `MARK` also carries the old `savepage` input names and every message type.
No other file spells these strings out.

**Why:** renaming a marker or recognizing an old one is a one-line change, and the input-compatibility list is visible in one place.

---

## 2. Behavioral patterns

### 2.1 Pipeline with explicit stages

**Where:** `PageCapture.run()` in `content/capture.js`.

**What:** a fixed sequence of stages, each one function call:

```
prepare → lazy → frames → styles → load → resources → load → serialize → write → done
```

At every stage boundary, `_enter(stage)` does three things:
- checks the abort signal
- records the elapsed time into `result.timing`
- emits `CaptureProgress`

A single `try/catch` around the whole sequence restores the page on failure: it undoes the shrink, removes the
selection container and the transient attributes, and unlocks.

**Invariant it encodes:** pass 1 including the transitive `@import` closure completes before pass 2, because pass 2
scans loaded stylesheet text. Pass 3 runs only after every substitutable resource has settled. The old engine
expressed this ordering with a shared counter reaching zero, and the stage sequence replaces that counter.

### 2.2 One walker, many visitors

**Where:** `content/walker.js` holds the traversal. The visitors are `passes/discover_styles.js`,
`passes/discover_resources.js` and `passes/serialize.js`.

**What:** `walk(ctx, root, visitor)` owns everything about how to traverse:
- document order
- shadow roots walked before light children, skipping built-in shadow DOM (`audio`, `video`, `use`)
- frame resolution through `frames.js`
- exclusions: the overlay, quirks, `scrapyard-*` UI, leftovers of previous saves
- text and comment nodes

A visitor implements only the hooks it needs: `enter`, `leave`, `frame`, `shadowBegin`/`shadowEnd`, `text` and
`comment`. `enter` steers the walk through its return value:
- `SKIP` ends processing of the element.
- `SKIP_CHILDREN` emits the element but not its children; `leave` still runs.
- An object becomes the children's state, used for pretty-print indentation and white-space preservation.

**Why:** the old engine had three copies of the recursion, with shadow and frame handling copied into each, and
they drifted apart. Here a traversal rule, such as what counts as excluded, changes in exactly one place for all
passes.

### 2.3 Rule registry: ordered, first match wins

**Where:** `content/rules/*.js` hold one element family per file. `rules/index.js` holds the only ordered list, and
`rules/registry.js` provides `ruleFor(el)`.

**What:** each rule is a plain object:

```js
{ name, match(el), discoverStyles?(el, ctx), discover?(el, ctx), serialize?(el, ctx, tag) }
```

The rules are data. No module registers itself on import. The order in `index.js` decides precedence, so specific
rules come before general ones: `link-in-svg` before `link`, and `svg-use` before `svg-href`. `match` tests the
namespace, not `instanceof`, because elements of same-origin subframes belong to another JavaScript realm.

**Why:** a new element behavior is one object in one file. Discovery and serialization of the same element sit
next to each other, so the URL collected in pass 2 and the URL substituted in pass 3 cannot drift apart. This is a
chain-of-responsibility variant resolved by a lookup, not by passing along.

### 2.4 Strategy

The engine uses the Strategy pattern in four places:

| Variation point | Strategies | Selected by |
|---|---|---|
| Output format | `sinks/packed.js`: `PackedSink` (data URIs, `srcdoc`, CSS variables). `sinks/unpacked.js`: `UnpackedSink` (relative paths, frame files, `archive.json`) | `run.mode` |
| Referer control of background loads | Firefox: `webRequest` header rename. Chrome MV3: `declarativeNetRequest` session rule. Otherwise: none | capabilities probed once in `background/referer_policy.js` |
| Lazy loading | scroll, shrink, none (`content/lazy.js`) | `options.lazyLoad` |
| Font file selection | used, woff, all (`core/fonts.js` `selectFontFiles`) | `options.fonts` |

The sink interface is the widest one: `begin`, `beforeSerialize`, `locate`, `locateCssImage`,
`emitLinkedStylesheet`, `emitHeadExtras`, `childDocumentPath`, `emitFrame` and `finish`. Rules and the CSS rewriter
never build data URIs or paths; they ask the sink. That removed the old engine's global
"force `mergeCSSImages` off when unpacked" side effect: CSS variables are simply a property of the packed sink.

### 2.5 Collect, then substitute (two-phase rewriting)

**Where:** passes 1 and 2 discover resources, the loader settles them, and pass 3 rewrites.

**What:** discovery only records URLs in the resource table. Substitution looks up the settled resource and asks
the sink for its location, or falls back to the unsaved form. No element is rewritten while its resource is still
loading.

**Why:** the loads of each phase run concurrently, and serialization stays a pure function of the DOM plus the
settled table. It also yields honest diagnostics: every reference that could not be substituted has a failure
record with a reason.

### 2.6 Builder with emission instructions

**Where:** `content/core/tag.js`, the `Tag` class.

**What:** the serializer does not edit start-tag strings with regexes. `Tag.from(el)` produces an editable,
order-preserving attribute list, and rules call named operations on it.

Attribute operations:
- `set` and `remove`
- `preserve` and `replace`: the original value lands in `data-scrapyard-<attr>`, and `replace` records it only when the value really changes
- `rename`
- `appendStyle` and `prependStyle`

Emission instructions:
- `drop()` emits nothing.
- `unwrap()` emits the children only.
- `text` overrides the raw content.
- `before`, `after`, `beforeEnd` and `afterEnd` inject raw strings around the tags.

The serializer interprets these instructions uniformly.

**Why:** rules state intent, not string surgery. The "keep the original" convention is implemented once, and quoting
and void-element handling cannot be forgotten by an individual rule.

### 2.7 Tokenizer-driven rewriting

**Where:** `content/core/css.js`, with the `MASTER` regex, `tokenize()` and `rewrite()`.
`content/core/stylesheet.js`, with `scanStylesheet()` and `rewriteStylesheet()`.

**What:** a single alternation regex classifies CSS into five tokens: `import`, `fontface`, `url`, `string` and
`comment`. Strings and comments are matched in the same pass so that URLs inside them are never touched. Discovery
iterates the tokens; rewriting is `String.replace` over the same tokens and returns strings and comments unchanged.

**Why:** discovery and rewriting cannot disagree about what counts as a URL, because they share the lexer. Cycles in
`@import` chains are broken by an explicit import stack threaded through both.

---

## 3. State and data patterns

### 3.1 Context object with child contexts

**Where:** `content/context.js`, the `CaptureContext` class.

**What:** one context per walked document: the top document, each same-origin subframe, and each parsed
cross-origin snapshot. A context carries four kinds of state:
- **The document itself:** `doc`, `win`, `frameKey`, `depth`, `crossFrame`, `noSrcFrame`, `loadedFonts`.
- **References to run-wide collaborators:** `options`, `store`, `sink`, `quirks`, the frame table.
- **Per-document output:** `out`, `documentPath`, `firstIcon`, `rootIcon`.
- **Environment-dependent queries:** `displayed()`, `computed()` and `shadowRootOf()` answer differently in cross-frame contexts, where there is no window.

`ctx.child(fields)` derives a subframe context and propagates depth, `crossFrame` and `noSrcFrame`. State shared by
every context of a run, such as the selection root, the shrink state and the frame manifest, lives in one `run`
object that all contexts reference.

**Why:** no module-level mutable state. The old engine had over 60 globals. Two captures can never share state, and
functions take everything they need explicitly.

### 3.2 Identity map / repository for resources

**Where:** `content/core/resource_store.js`, the `ResourceStore` class.

**What:** every resource is one record keyed by its resolved, fragment-stripped URL. It is appended in discovery
order with a stable `id`. `remember()` deduplicates and counts references: HTML references, CSS references, and the
set of frames that referenced it from CSS. Queries are `get`, `loaded`, `pending`, `byKind`, `failures` and
`forFrame`. Self-references and non-replaceable URLs are rejected at the door.

**Why:** reference counts drive the packed size policy and the per-frame CSS variables. The same records become
`archive.json`. The old engine kept this as 12 parallel arrays.

### 3.3 Status state machine per resource

**What:** `pending → loading → success | failure(reason)`. Reasons form a closed vocabulary: `mixed`, `maxsize`,
`maxtime`, `corsfail`, `mime`, `network`, `send`, `load:<status>`, `aborted` and `write`. A resource's payload shape
depends on its state and kind:
- `bytes` for binary content
- `text` for decoded text
- `hash` and `path` once written in unpacked mode, with `bytes` dropped to bound memory

### 3.4 Content addressing and a manifest

**Where:** `background/file_writer.js` and `PageCapture._manifest()`.

**What:** unpacked resources are named `resources/<sha256[0..16]>.<ext>`, with the extension derived from the actual
MIME type. Identical bytes referenced from anywhere are therefore stored once. `archive.json` records every
resource: URL, kind, mime, size, hash, path, status, reason and reference counts. It also records the frame tree and
the effective options, and packed mode returns the same object without paths.

**Why:** deduplication falls out of naming, and failures are reported explicitly instead of silently becoming empty
URLs.

### 3.5 Transient annotations on the live DOM

**Where:** `content/snapshot.js` (`annotateLiveState`) and `content/frame_keys.js` (`identifyFrames`).

**What:** state that only the live page can provide is written as temporary attributes before the passes run: frame
keys, CSS-in-JS sheet rules, blob image pixels and canvas pixels. The attributes are removed from the output by the
rules and from the live DOM after the run. `MARK.transient` lists them.

**Why:** the per-frame scripts compute this state once, and a cross-origin frame's serialized snapshot carries it
into the top frame, where the live objects are unreachable.

---

## 4. Communication and concurrency patterns

### 4.1 Request/reply over a long-lived port (correlated RPC)

**Where:** `content/port.js`, which provides `port.request()` and `port.notify()`, and `background/port_server.js`
with `CaptureSession`.

**What:** the top frame opens one `runtime.connect` port per run.
- **Requests** carry an incrementing `id` and resolve on `{id, reply}` or reject on `{id, error}`.
- **Notifications** carry no id: `progress`, `done` and `failed`.
- **Binary data** crosses the port as base64.
- **Pending requests** are rejected on disconnect.

**Why:** a single ordered channel, correlation without global listeners, and in Chrome MV3 the open port keeps the
service worker alive. The old engine needed a promise workaround in its message handler to keep the worker alive.

### 4.2 Session per tab with ownership check

**What:** `openSession(tabId, handlers)` registers the handlers for the three requests: load, write and frame
collection. A port is attached only to the session of its sender's tab. Other extension pages that import the
module receive the connection too, and they ignore it because they own no session. A second capture in the same tab
is refused as busy.

### 4.3 Scatter-gather with a counted quorum and a timeout

**Where:** `background/frame_relay.js` (`collectFrames`) and `content/frame_entry.js`.

**What:** the relay broadcasts `capture.frames.request` to all frames and counts the replies against
`webNavigation.getAllFrames()`. It resolves when all have answered or when `frameReplyTimeout` expires, whichever
comes first. Late or silent frames are simply absent. If the top frame itself is missing, the pipeline computes its
part locally.

**Why:** it replaces the old engine's fixed 200 ms window, which lost slow frames on heavy pages and wasted time on
light ones.

### 4.4 Bounded worker pool that drains to a fixpoint

**Where:** `content/loader.js`: `Loader.loadAll()` and `_pool()`.

**What:** up to `options.concurrency` workers pull from the pending list. Accepting a stylesheet can append new
pending resources, its `@import`s, so `loadAll()` loops until a round finds nothing pending.

**Why:** the transitive import closure loads within pass 1 without a shared in-flight counter, and concurrency stays
bounded.

### 4.5 Serialized single writer with deduplication

**Where:** `background/file_writer.js`: `createArchiveWriter()`.

**What:** every write goes through one promise chain, so writes happen one at a time and in order. A path written
once is never written again in the same run, and a failed write does not block the ones after it.

**Why:** the backend sees an orderly stream. A crashed capture leaves a partial directory that can be diagnosed, and
`archive.json` is written last.

### 4.6 Cooperative cancellation

**What:** one `AbortController` per run.
- Its signal is checked at every stage boundary and in every loader worker.
- It is passed into delays and `fetch`.
- The host aborts through the signal, a port message, tab removal or port disconnect.
- Aborts surface as `AbortError` and take the same cleanup path as any other failure.

---

## 5. Resilience patterns

### 5.1 Graceful degradation chains

Each capability has an ordered list of fallbacks. A capture degrades per resource, never as a whole.

| Capability | Tried in order |
|---|---|
| Loading a resource | in-page `fetch` (CORS, page referrer) → background `fetch` with credentials and referer control → failure with a reason (fonts stop at `corsfail`) |
| Frame content | live same-origin document → parsed cross-origin snapshot → unsaved element |
| Top frame fonts and extras | the frame's own reply → computed locally |
| Blob images and video | snapshot data URI → live canvas draw → unsaved |
| Hashing | `crypto.subtle` → pure JavaScript SHA-256 (http pages have no secure context) |
| Text decoding | declared charset, where a BOM overrides it → strict UTF-8 → ISO-8859-1 |
| Referer control | webRequest rename → DNR session rule (skipped if the rule is rejected) → browser default |
| Injection into frames | per-frame injection with per-frame error tolerance; only the top frame's failure is fatal |

### 5.2 Idempotent, side-effect-light module evaluation

**What:** only the entry modules (`entry.js`, `frame_entry.js`) and the background service modules register
listeners at load time. Everything else is pure, and a realm evaluates a module once, so injecting a stub again
registers nothing twice. The webRequest hook registers lazily on first use, so extension pages that merely import
the engine install nothing. The FontFace interceptor guards against double wrapping.

### 5.3 Stubs as the injection seam

**What:** `stub.js` and `frame_stub.js` are the only files passed to `executeScript`. Each contains one line:
`import(runtime.getURL(...)).then(() => true)`. Because the completion value is a promise, `executeScript` resolves
only after the whole module graph has loaded and the listeners exist. Page CSP does not apply to this import.

**Why:** there is no initialization handshake message and no ordered list of script files to maintain. The module
graph defines its own load order.

### 5.4 Site quirks as a registry

**Where:** `content/quirks.js`.

**What:** site-specific hacks are entries of the form `{match(location), prepare?(doc), exclude?(el)}`, collected
into one object per run. Rules and passes never test hostnames.

---

## 6. Testing patterns

| Level | Mechanism | Covers |
|---|---|---|
| Unit | `tests/capture/node/run.mjs`, a runner of about 40 lines over `*.test.mjs` files using `node:assert` | `shared/` and `content/core/`, exercised directly because they are DOM-free |
| Architecture | `layering.test.mjs` | the dependency rule, cycles, specifiers, file size, manifest coverage |
| Integration in a real browser | `tests/capture/fixtures/harness.html` with a mock port, run headless with `--dump-dom` | the pipeline, walker, rules, both sinks, frames, selection, pretty print |
| Fixtures | one static page per concern, each with a header comment stating what a correct capture contains; `serve.py` synthesizes binary assets and a second origin | expected-output documentation, manual checks |
| Manual | `tests/capture/CHECKLIST.md` | extension-only paths: injection, port, cross-origin frames, closed shadow roots, DNR rules |

The mock port in the harness is itself an application of the port boundary (§1.2, §4.1). The whole content side
runs unchanged when the background is replaced by an in-page object implementing `request()`.

---

## 7. Rules of thumb for extending the engine

- **New element behavior:** add a rule object to the family file in `content/rules/` and place it in `rules/index.js`
  before any more general rule it overlaps. Keep its discover and serialize hooks side by side.
- **New output format:** add a sink implementing the sink interface. Do not branch on the mode inside rules or the
  CSS rewriter.
- **New marker, message or option:** add it to `MARK`, `MESSAGE` or `defaultOptions()` plus `normalizeOptions()`.
  Then map the stored setting in `capture_options.js`.
- **New module directory:** add its pattern to all three manifest templates. The layering test fails until you do.
- **New site hack:** add an entry to `quirks.js`.
- **Anything that needs storage or Scrapyard types:** it belongs in the host adapter, not in `addon/capture/`.
