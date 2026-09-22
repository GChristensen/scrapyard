// Byte-identity gate for the capture engine.
//
// Drives the fixture harness headlessly over every fixture and option variant, collects the digest the harness
// prints (document + manifest + index + links + written files) and compares it against a recorded baseline.
// Performance changes that are supposed to preserve the output must not move any digest.
//
// Usage:  node tests/capture/digest.mjs [--write] [filter]      (needs `python tests/capture/fixtures/serve.py`)

import {readdirSync, readFileSync, writeFileSync, existsSync} from "node:fs";
import {execFile} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const BASELINE = join(HERE, "baseline.txt");
const ORIGIN = process.env.CAPTURE_FIXTURE_ORIGIN || "http://localhost:8080";

const CHROME = process.env.CHROME || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find(existsSync);

/* fixtures that cannot produce a stable digest headlessly */
const SKIP = new Set(["harness.html", "big.html"]);

/* the option matrix; every fixture runs "" plus the variants that exercise it */
const VARIANTS = ["", "pretty", "mode=unpacked"];
const EXTRA = {
    "shadow.html": ["shadow", "shadow&pretty"],
    "scripts.html": ["scripts"],
    "selection.html": ["selection=p%3Anth-of-type(2)"],
    // the bounded scroll and the unbounded one; lazy=shrink is deliberately absent, its growth loop iterates a
    // timing-dependent number of times and does not produce a reproducible digest
    "lazy.html": ["lazy=scroll", "lazy=scroll&screens=50"]
};

function fixtures() {
    return readdirSync(FIXTURES).filter(f => f.endsWith(".html") && !SKIP.has(f)).sort();
}

function cases(filter) {
    const result = [];

    for (const page of fixtures()) {
        for (const variant of [...VARIANTS, ...(EXTRA[page] || [])]) {
            const name = variant? `${page}?${variant}`: page;

            if (!filter || name.includes(filter))
                result.push({page, variant, name});
        }
    }

    return result;
}

function dumpDom(url) {
    return new Promise((resolve, reject) => {
        const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=15000",
            "--dump-dom", url];

        execFile(CHROME, args, {maxBuffer: 256 * 1024 * 1024, timeout: 120000}, (error, stdout) => {
            if (error && !stdout)
                reject(error);
            else
                resolve(stdout || "");
        });
    });
}

async function digestFor(test) {
    const query = `page=${test.page}${test.variant? "&" + test.variant: ""}&wait=1500`;
    const dom = await dumpDom(`${ORIGIN}/harness.html?${query}`);
    const match = dom.match(/\bdigest:\s*([0-9a-f]{64})\b/);

    if (match)
        return match[1];

    const failed = dom.match(/^\s*(Error|TypeError|ReferenceError)[^\n]*/m);

    return "FAILED" + (failed? " " + failed[0].trim().slice(0, 120): "");
}

async function main() {
    const argv = process.argv.slice(2);
    const write = argv.includes("--write");
    const filter = argv.find(a => !a.startsWith("--")) || "";

    if (!CHROME) {
        console.error("no Chrome binary found; set CHROME=<path>");
        process.exit(2);
    }

    try {
        await fetch(ORIGIN + "/harness.html");
    }
    catch (e) {
        console.error(`the fixture server is not running at ${ORIGIN}\n  python tests/capture/fixtures/serve.py`);
        process.exit(2);
    }

    const tests = cases(filter);
    const current = new Map();

    for (const test of tests) {
        const digest = await digestFor(test);
        current.set(test.name, digest);
        console.log(`${digest.startsWith("FAILED")? "!!": "  "} ${digest.slice(0, 16).padEnd(16)} ${test.name}`);
    }

    const failed = [...current].filter(([, digest]) => digest.startsWith("FAILED"));

    if (write) {
        if (failed.length) {
            console.error(`\n${failed.length} case(s) produced no digest; not recording a baseline:`);

            for (const [name, digest] of failed)
                console.error(`  ${name}: ${digest}`);

            process.exit(2);
        }

        const lines = [...current].map(([name, digest]) => `${digest} ${name}`).join("\n");
        writeFileSync(BASELINE, lines + "\n");
        console.log(`\nwrote ${current.size} digests to ${BASELINE}`);
        return;
    }

    if (!existsSync(BASELINE)) {
        console.error("\nno baseline; record one with --write on an unchanged tree");
        process.exit(2);
    }

    const baseline = new Map(readFileSync(BASELINE, "utf8").split("\n")
        .filter(Boolean).map(line => {
            const space = line.indexOf(" ");
            return [line.slice(space + 1), line.slice(0, space)];
        }));

    let differences = 0;

    for (const [name, digest] of current) {
        const expected = baseline.get(name);

        if (expected === undefined)
            console.log(`\nNEW      ${name}`);
        else if (expected !== digest) {
            differences++;
            console.log(`\nCHANGED  ${name}\n  expected ${expected}\n  actual   ${digest}`);
        }
    }

    for (const name of baseline.keys())
        if (!current.has(name))
            console.log(`\nMISSING  ${name}`);

    if (failed.length)
        console.log(`\n${failed.length} case(s) produced no digest`);

    console.log(`\n${current.size - differences} of ${current.size} unchanged`);
    process.exit(differences || failed.length? 1: 0);
}

await main();
