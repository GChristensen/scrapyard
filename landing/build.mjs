// Builds the landing page into the GitHub Pages entry point (the repo-root index.html).
//
//   node build.mjs          aggressive build: one minified index.html with the CSS, the JS and the small
//                           icons inlined. The three large diagrams stay files (they have to be separate
//                           documents to load web fonts and be paused), minified into media/landing/.
//   node build.mjs --plain  no build to speak of, no npm packages needed: a readable index.html whose
//                           assets are still the files in landing/, only the paths are re-based.
//   --out <dir>             write into <dir> instead of the repo root (to preview without touching the site)
//
// Run `npm install` here once for the aggressive build (html-minifier-terser + svgo).
//
// The root index.html has to be *replaced* either way: GitHub Pages serves /index.html and the current one
// is a Jekyll page (front matter + layout). Neither output has front matter, so Jekyll copies it verbatim.

import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const plain = args.includes("--plain");
const outIdx = args.indexOf("--out");
if (outIdx >= 0 && !args[outIdx + 1]) throw new Error("--out needs a directory");
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(here, "..");

const INLINE_LIMIT = 4096;            // inline svg icons up to this many bytes (after minification) as data: URIs
const SVG_DIR = "media/landing";      // where the remaining minified svgs go, relative to the output root

// relative paths only: absolute URLs, root-absolute paths (/images/...) and #anchors are left alone
const isLocal = (url) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
const bytes = (s) => Buffer.byteLength(s, "utf8");
const read = (rel) => readFile(path.join(here, rel), "utf8");

// Rewrites every local src/href/data attribute. fn(url, attr) returns the new value.
const mapUrls = (html, fn) =>
  html.replace(/(\s(src|href|data)=")([^"]+)(")/g,
    (m, pre, attr, url, post) => isLocal(url) ? pre + fn(url, attr) + post : m);

let html = await read("index.html");
let before = bytes(html);
let after;
const log = [];

if (plain) {
  // ---------------------------------------------------------------- plain
  html = mapUrls(html, (url) => "landing/" + url);
  after = bytes(html);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html, "utf8");
  // a custom --out has no landing/ next to it: bring the assets along
  if (path.resolve(outDir, "landing") !== here) {
    for (const f of ["styles.css", "main.js", "img"])
      await cp(path.join(here, f), path.join(outDir, "landing", f), { recursive: true });
    log.push(`  + landing/{styles.css,main.js,img/} copied to ${path.join(outDir, "landing")}`);
  }
} else {
  // ---------------------------------------------------------------- aggressive
  const { minify } = await import("html-minifier-terser");
  const { optimize } = await import("svgo");

  // 1. inline local stylesheets
  const linkRe = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g;
  const styles = new Map();
  for (const [, url] of html.matchAll(linkRe)) {
    if (!isLocal(url) || styles.has(url)) continue;
    const css = await read(url);
    if (/url\(\s*['"]?(?![a-z]+:|#)/i.test(css))
      throw new Error(`${url}: relative url() references are not supported by the inliner`);
    styles.set(url, css);
    before += bytes(css);
    log.push(`  + ${url}`);
  }
  html = html.replace(linkRe, (tag, url) => styles.has(url) ? `<style>${styles.get(url)}</style>` : tag);

  // 2. inline local scripts; a deferred script keeps its meaning by moving to the end of <body>
  const scriptRe = /<script\b([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>\s*/g;
  const deferred = [];
  const scripts = new Map();
  for (const [, , url] of html.matchAll(scriptRe)) {
    if (!isLocal(url) || scripts.has(url)) continue;
    const js = await read(url);
    scripts.set(url, js);
    before += bytes(js);
    log.push(`  + ${url}`);
  }
  html = html.replace(scriptRe, (tag, pre, url, post) => {
    if (!scripts.has(url)) return tag;
    const tagOut = `<script>${scripts.get(url).replace(/<\/script/gi, "<\\/script")}</script>`;
    if (/\bdefer\b/.test(pre + post)) { deferred.push(tagOut); return ""; }
    return tagOut;
  });
  if (deferred.length) html = html.replace("</body>", deferred.join("") + "</body>");

  // 3. svgs: minify them all, inline the small ones that are used as images, write the rest
  // svgo's structural plugins don't understand SMIL: removeHiddenElems deletes elements with a static
  // opacity="0" (how the animation fades things in), and shape/group rewrites detach animated
  // attributes from their targets (the typing cursor stops moving). So SVGs containing <animate*>/<set>
  // get only cosmetic plugins that never restructure elements; verified frame by frame (0 px difference)
  // against the unminified file. Static SVGs get the full default preset.
  const CAREFUL = ["removeDoctype", "removeXMLProcInst", "removeComments", "removeMetadata",
    "removeEditorsNSData", "cleanupAttrs", "removeUnusedNS", "cleanupNumericValues", "convertColors",
    "sortAttrs", "removeEmptyAttrs"];
  const svgOpts = (src) => ({
    multipass: true,
    plugins: /<(animate|set)\b/.test(src)
      ? CAREFUL
      : [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }],
  });
  const svgs = new Map();                   // url -> minified text
  for (const [, , url] of html.matchAll(/(\s(?:src|href|data)=")([^"]+\.svg)"/g)) {
    if (!isLocal(url) || svgs.has(url)) continue;
    const src = await read(url);
    before += bytes(src);
    svgs.set(url, optimize(src, { path: url, ...svgOpts(src) }).data);
  }
  const written = new Set();
  html = mapUrls(html, (url, attr) => {
    const svg = svgs.get(url);
    if (svg === undefined) throw new Error(`unhandled local asset: ${url}`);
    if (attr !== "data" && bytes(svg) <= INLINE_LIMIT)
      return "data:image/svg+xml," + encodeURIComponent(svg).replace(/%20/g, " ").replace(/%3A/g, ":")
        .replace(/%2F/g, "/").replace(/%3D/g, "=").replace(/%2C/g, ",").replace(/%3B/g, ";");
    written.add(url);
    return `${SVG_DIR}/${path.basename(url)}`;
  });

  // 4. minify everything else
  html = await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    collapseBooleanAttributes: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    removeEmptyAttributes: true,
    removeAttributeQuotes: true,
    sortAttributes: true,
    sortClassName: true,
    useShortDoctype: true,
    minifyCSS: { level: 2 },
    minifyJS: { compress: { passes: 2 }, mangle: { toplevel: true } },
  });
  after = bytes(html);

  // 5. write
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html, "utf8");
  const svgOut = path.join(outDir, SVG_DIR);
  await rm(svgOut, { recursive: true, force: true });   // generated directory: drop stale files
  await mkdir(svgOut, { recursive: true });
  for (const url of written) {
    const data = svgs.get(url);
    await writeFile(path.join(svgOut, path.basename(url)), data, "utf8");
    after += bytes(data);
    log.push(`  + ${SVG_DIR}/${path.basename(url)}  ${bytes(await read(url))} -> ${bytes(data)} bytes`);
  }
  log.push(`  ${svgs.size - written.size} small svgs inlined as data: URIs`);
}

console.log(`landing (${plain ? "plain" : "minified"}): ${path.join(here, "index.html")}`);
for (const l of log) console.log(l);
console.log(`  -> ${path.join(outDir, "index.html")}`);
console.log(`  ${before} bytes -> ${after} bytes (${(100 * after / before).toFixed(1)}%)`);
