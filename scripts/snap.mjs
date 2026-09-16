#!/usr/bin/env node
// Screenshots a build page with headless Chrome / Edge / Chromium so the pictures can be looked at.
//
//   node snap.mjs <page.html> <out.png> [--only N] [--width 1000] [--height 1400]
//
// --only N shows figure N (0-based, in page order) by itself.
// Also prints any "Breadboard picture problems" the page reported.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const only = opt("--only", null), width = opt("--width", "1000"), height = opt("--height", only !== null ? "1400" : "3000");
const [page, out] = args;
if (!page || !out) { console.error("usage: snap.mjs <page.html> <out.png> [--only N] [--width W] [--height H]"); process.exit(1); }

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
].filter(Boolean);
const browser = candidates.find(p => existsSync(p));
if (!browser) { console.error("no Chrome/Edge/Chromium found; set CHROME_PATH"); process.exit(1); }

const url = pathToFileURL(resolve(page)).href + (only !== null ? `#bb-only=${only}` : "");
const profile = mkdtempSync(join(tmpdir(), "bb-snap-"));
const common = ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`,
                "--allow-file-access-from-files", "--virtual-time-budget=4000"];

const shot = spawnSync(browser, [...common, `--window-size=${width},${height}`, `--screenshot=${resolve(out)}`, url],
                       { encoding: "utf8", timeout: 90000 });
if (!existsSync(resolve(out))) { console.error("screenshot failed\n" + shot.stderr); process.exit(1); }

const dom = spawnSync(browser, [...common, "--dump-dom", url], { encoding: "utf8", timeout: 90000, maxBuffer: 1 << 26 });
const problems = [...(dom.stdout || "").matchAll(/<pre class="bb-warnings"[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1]);
const figures = ((dom.stdout || "").match(/class="bb-figure"/g) || []).length;
console.log(`wrote ${resolve(out)} — ${figures} figure(s) on the page`);
if (problems.length) {
  console.log("PROBLEMS:\n" + problems.join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  process.exitCode = 2;
}
