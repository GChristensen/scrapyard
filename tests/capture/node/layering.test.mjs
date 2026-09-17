// Enforces the module layering of addon/capture (README.md, "Layering"):
//   shared/        imports only shared/
//   content/core/  imports shared/ and content/core/
//   content/       imports anything above plus content/
//   background/    imports shared/ and background/
// plus: relative specifiers with .js extensions, no cycles, and the manifest templates list every module directory.

import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../addon");
const captureRoot = join(root, "capture");

function listFiles(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);

        if (statSync(path).isDirectory())
            listFiles(path, acc);
        else if (name.endsWith(".js"))
            acc.push(path);
    }

    return acc;
}

function specifiersOf(file) {
    const source = readFileSync(file, "utf8");
    const regex = /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/g;
    const result = [];
    let m;

    while ((m = regex.exec(source)) != null)
        result.push(m[1]);

    return result;
}

function layerOf(file) {
    const rel = relative(captureRoot, file).split(sep).join("/");

    if (rel.startsWith("shared/")) return 1;
    if (rel.startsWith("content/core/")) return 2;
    if (rel.startsWith("content/")) return 3;
    if (rel.startsWith("background/")) return 4;
    if (rel.startsWith("page/")) return 5;

    throw new Error("unknown layer: " + rel);
}

const CLASSIC = ["content/stub.js", "content/frame_stub.js", "content/fontface.js", "page/shadow_loader.js"];

const files = listFiles(captureRoot);
const graph = new Map();

for (const file of files) {
    const rel = relative(captureRoot, file).split(sep).join("/");

    if (CLASSIC.includes(rel))
        continue;

    graph.set(file, specifiersOf(file).map(spec => ({spec, target: resolve(dirname(file), spec)})));
}

export const tests = {
    "every specifier is relative and carries the .js extension"() {
        for (const [file, imports] of graph)
            for (const {spec} of imports) {
                assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${relative(root, file)}: bare specifier ${spec}`);
                assert.ok(spec.endsWith(".js"), `${relative(root, file)}: no .js extension on ${spec}`);
            }
    },

    "every import target exists inside addon/capture"() {
        for (const [file, imports] of graph)
            for (const {spec, target} of imports) {
                assert.ok(target.startsWith(captureRoot), `${relative(root, file)} imports outside the engine: ${spec}`);
                assert.doesNotThrow(() => statSync(target), `${relative(root, file)}: missing ${spec}`);
            }
    },

    "layering: a module imports only from its own layer or a lower one"() {
        for (const [file, imports] of graph) {
            const layer = layerOf(file);

            for (const {spec, target} of imports) {
                const targetLayer = layerOf(target);
                const ok = layer === 4? (targetLayer === 1 || targetLayer === 4): targetLayer <= layer;
                assert.ok(ok, `${relative(root, file)} (layer ${layer}) imports ${spec} (layer ${targetLayer})`);
            }
        }
    },

    "no import cycles"() {
        const visiting = new Set();
        const done = new Set();

        function visit(file, stack) {
            if (done.has(file))
                return;

            if (visiting.has(file))
                assert.fail("cycle: " + [...stack, file].map(f => relative(captureRoot, f)).join(" -> "));

            visiting.add(file);

            for (const {target} of graph.get(file) || [])
                visit(target, [...stack, file]);

            visiting.delete(file);
            done.add(file);
        }

        for (const file of graph.keys())
            visit(file, []);
    },

    "manifest templates list every content-side module directory"() {
        const dirs = new Set();

        for (const file of files) {
            const rel = relative(captureRoot, file).split(sep).join("/");

            if (rel.startsWith("shared/") || (rel.startsWith("content/") && !CLASSIC.includes(rel)))
                dirs.add("capture/" + rel.slice(0, rel.lastIndexOf("/")) + "/*");
        }

        for (const name of ["manifest.json.mv2", "manifest.json.mv3", "manifest.json.mv3.chrome"]) {
            const text = readFileSync(join(root, name), "utf8").replace("$VERSION$", "0.0").replace("$ID_SUFFIX$", "");
            const manifest = JSON.parse(text);
            const listed = new Set();

            for (const entry of manifest.web_accessible_resources) {
                if (typeof entry === "string")
                    listed.add(entry);
                else
                    for (const resource of entry.resources)
                        listed.add(resource);
            }

            for (const dir of dirs)
                assert.ok(listed.has(dir), `${name} does not list ${dir}`);
        }
    },

    "files stay under the hard cap of 500 lines"() {
        for (const file of files) {
            const lines = readFileSync(file, "utf8").split("\n").length;
            assert.ok(lines <= 500, `${relative(root, file)} has ${lines} lines`);
        }
    }
};
