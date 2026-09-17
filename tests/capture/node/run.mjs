// Minimal test runner: imports every *.test.mjs next to this file and runs the exported tests.
// Usage: node tests/capture/node/run.mjs [filter]      (Node >= 22.12)

import {readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const files = readdirSync(here).filter(f => f.endsWith(".test.mjs") && f.includes(filter)).sort();

let passed = 0;
let failed = 0;

for (const file of files) {
    const module = await import(pathToFileURL(join(here, file)).href);
    const tests = module.tests || {};

    for (const [name, fn] of Object.entries(tests)) {
        try {
            await fn();
            passed++;
        }
        catch (e) {
            failed++;
            console.error(`FAIL ${file} :: ${name}\n    ${(e && e.stack || e).toString().split("\n").slice(0, 6).join("\n    ")}`);
        }
    }
}

console.log(`${passed} passed, ${failed} failed (${files.length} files)`);
process.exit(failed? 1: 0);
