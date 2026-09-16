#!/usr/bin/env node
// Finds parts in the Fritzing parts library and bundles their breadboard drawings into one
// JavaScript file that a build page loads next to breadboard.js.
//
//   node fritzing.mjs sync [--update]            clone / refresh the library cache, rebuild the index
//   node fritzing.mjs search <words…> [--all]    find parts (through-hole only unless --all)
//   node fritzing.mjs show <fzp>                 one part: properties, drawing, every connector
//   node fritzing.mjs bundle <out.js> --board <key>=<fzp> --part <key>=<fzp> …
//
// <fzp> is a path inside the library, e.g. core/resistor.fzp.
// The cache lives in $FRITZING_PARTS_DIR, default ~/.cache/fritzing-parts. Needs git.
//
// The drawings are CC BY-SA 3.0 (Fritzing parts library). The bundle records where each one
// came from, its author and the library commit, so the page can credit them.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const REPO = "https://github.com/fritzing/fritzing-parts";
const DIR = process.env.FRITZING_PARTS_DIR || join(homedir(), ".cache", "fritzing-parts");
const INDEX = join(DIR, ".index.json");

function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: opts.cwd ?? DIR, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}
const die = m => { console.error(m); process.exit(1); };

/* ------------------------------------------------------------------ fzp parsing (regex, the files are regular) */
const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const tagText = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].trim()) : ""; };
const attr = (s, a) => { const m = s.match(new RegExp(`\\b${a}\\s*=\\s*"([^"]*)"`)); return m ? decode(m[1]) : undefined; };

function parseFzp(text) {
  const props = {};
  for (const m of text.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
    const n = attr(m[1], "name"); if (n) props[n.toLowerCase()] = decode(m[2].trim());
  }
  const bbView = (text.match(/<breadboardView\b[^>]*>([\s\S]*?)<\/breadboardView>/) || [])[1] || "";
  const image = attr(bbView, "image");
  const layer = attr((bbView.match(/<layer\b[^>]*>/) || [""])[0], "layerId");
  const connectors = [];
  for (const m of text.matchAll(/<connector\b([^>]*)>([\s\S]*?)<\/connector>/g)) {
    const bb = (m[2].match(/<breadboardView>([\s\S]*?)<\/breadboardView>/) || [])[1] || "";
    const p = (bb.match(/<p\b[^>]*>/) || [""])[0];
    connectors.push({ id: attr(m[1], "id"), name: attr(m[1], "name") || "",
                      svgId: attr(p, "svgId"), legId: attr(p, "legId") });
  }
  const buses = [];
  for (const m of text.matchAll(/<bus\b[^>]*>([\s\S]*?)<\/bus>/g))
    buses.push([...m[1].matchAll(/connectorId="([^"]+)"/g)].map(x => x[1]));
  return {
    moduleId: attr(text, "moduleId"), title: tagText(text, "title"), author: tagText(text, "author"),
    description: tagText(text, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160),
    tags: [...text.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map(m => decode(m[1].trim())),
    props, image, layer, connectors, buses,
  };
}

/* ------------------------------------------------------------------ sync + index */
function sync(update) {
  if (!existsSync(join(DIR, ".git"))) {
    mkdirSync(dirname(DIR), { recursive: true });
    console.error(`cloning ${REPO} (part definitions only) into ${DIR} …`);
    git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, DIR], { cwd: dirname(DIR) });
    git(["sparse-checkout", "set", "--no-cone", "/core/*.fzp", "/contrib/*.fzp"]);
  } else if (update) {
    git(["fetch", "--depth", "1", "origin"]);
    git(["reset", "--hard", "FETCH_HEAD"]);
  }
  const files = git(["ls-files", "core", "contrib"]).split("\n").filter(f => f.endsWith(".fzp"));
  const parts = [];
  for (const f of files) {
    const p = join(DIR, f);
    if (!existsSync(p)) continue;
    const z = parseFzp(readFileSync(p, "utf8"));
    parts.push({ file: f, title: z.title, tags: z.tags, props: z.props, image: z.image,
                 pins: z.connectors.length, description: z.description, author: z.author });
  }
  const commit = git(["rev-parse", "HEAD"]).trim();
  writeFileSync(INDEX, JSON.stringify({ commit, parts }));
  console.error(`indexed ${parts.length} parts at ${commit.slice(0, 10)}`);
}

function index() {
  if (!existsSync(INDEX)) sync(false);
  return JSON.parse(readFileSync(INDEX, "utf8"));
}

// drawings are fetched on demand: add them to the sparse checkout
function svgPath(fzpFile, image) {
  const tree = fzpFile.startsWith("contrib/") ? "contrib" : "core";
  const candidates = [`svg/${tree}/${image}`, `svg/core/${image}`, `svg/contrib/${image}`, `svg/obsolete/${image}`];
  const known = new Set(git(["ls-tree", "-r", "--name-only", "HEAD", "--", ...new Set(candidates)])
    .split("\n").filter(Boolean));
  const hit = candidates.find(c => known.has(c));
  if (!hit) throw new Error(`drawing ${image} for ${fzpFile} is not in the library`);
  return hit;
}
function fetchFiles(paths) {
  const missing = paths.filter(p => !existsSync(join(DIR, p)));
  if (!missing.length) return;
  const esc = p => "/" + p.replace(/([*?[\]\\!# ])/g, "\\$1");
  git(["sparse-checkout", "add", ...missing.map(esc)]);
  for (const p of missing) if (!existsSync(join(DIR, p))) throw new Error(`could not fetch ${p}`);
}

/* ------------------------------------------------------------------ commands */
function search(words, all) {
  const { parts } = index();
  const terms = words.map(w => w.toLowerCase());
  const scored = [];
  for (const p of parts) {
    const title = p.title.toLowerCase();
    const hay = [p.file, p.title, p.tags.join(" "), Object.values(p.props).join(" "), p.description].join(" ").toLowerCase();
    if (!terms.every(t => hay.includes(t))) continue;
    const pkg = (p.props.package || "").toLowerCase();
    const smd = /smd|smt|sot|soic|so\d|qfn|tssop|0402|0603|0805|1206|sod-?123|sma\b|smb\b/.test(pkg + " " + p.file.toLowerCase());
    if (smd && !all) continue;
    let score = terms.reduce((s, t) => s + (title.includes(t) ? 3 : 0) + (p.tags.some(x => x.toLowerCase() === t) ? 2 : 0), 0);
    if (p.file.startsWith("core/")) score += 1;
    if (/tht|dip|to-?92|to-?220|through/.test(pkg)) score += 1;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.title.localeCompare(b.p.title));
  if (!scored.length) return console.log("no match — try fewer or shorter words, or --all for surface-mount parts");
  for (const { p } of scored.slice(0, 40)) {
    const pr = ["family", "package", "type", "pin spacing"].filter(k => p.props[k]).map(k => `${k}=${p.props[k]}`).join(" ");
    console.log(`${p.file}\n    ${p.title} | ${pr} | ${p.pins} connectors | ${p.image || "NO BREADBOARD DRAWING"}`);
  }
  if (scored.length > 40) console.log(`… ${scored.length - 40} more; add words to narrow`);
}

function show(file) {
  const path = join(DIR, file);
  if (!existsSync(path)) { index(); if (!existsSync(path)) die(`no such part: ${file}`); }
  const z = parseFzp(readFileSync(path, "utf8"));
  console.log(`${z.title}  (${file})\nauthor: ${z.author}\n${z.description}`);
  for (const [k, v] of Object.entries(z.props)) console.log(`  ${k}: ${v}`);
  console.log(`breadboard drawing: ${z.image}  layer: ${z.layer}`);
  if (z.image) console.log(`  → ${svgPath(file, z.image)}`);
  console.log(`connectors (${z.connectors.length}):`);
  for (const c of z.connectors.slice(0, 80))
    console.log(`  ${c.id.padEnd(14)} ${c.name.padEnd(18)} svg=${c.svgId}${c.legId ? `  bendable leg=${c.legId}` : ""}`);
  if (z.connectors.length > 80) console.log(`  … ${z.connectors.length - 80} more`);
  if (z.buses.length) console.log(`buses: ${z.buses.length} (holes that are connected inside the part)`);
}

function bundle(out, specs) {
  if (!out || !specs.length) die("usage: bundle <out.js> --board <key>=<fzp> --part <key>=<fzp> …");
  const { commit } = index();
  const result = {
    source: { library: "Fritzing parts library", repo: REPO, commit,
              license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" },
    boards: {}, parts: {},
  };
  const loaded = specs.map(({ kind, key, file }) => {
    const path = join(DIR, file);
    if (!existsSync(path)) die(`no such part: ${file} (run search first)`);
    const z = parseFzp(readFileSync(path, "utf8"));
    if (!z.image) die(`${file} has no breadboard drawing`);
    return { kind, key, file, z, svgFile: svgPath(file, z.image) };
  });
  fetchFiles(loaded.map(l => l.svgFile));
  for (const { kind, key, file, z, svgFile } of loaded) {
    const entry = {
      title: z.title, author: z.author, fzp: file, drawing: svgFile, layer: z.layer, props: z.props,
      svg: readFileSync(join(DIR, svgFile), "utf8").replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, "").trim(),
      connectors: z.connectors.map(({ id, name, svgId, legId }) => legId ? { id, name, svgId, legId } : { id, name, svgId }),
    };
    if (kind === "board") entry.buses = z.buses;
    result[kind === "board" ? "boards" : "parts"][key] = entry;
  }
  const dest = resolve(out);
  mkdirSync(dirname(dest), { recursive: true });
  const credits = loaded.map(l => `//   ${l.key}: "${l.z.title}" by ${l.z.author || "unknown"} — ${l.svgFile}`).join("\n");
  writeFileSync(dest,
`// Breadboard drawings from the Fritzing parts library, ${REPO} (commit ${commit.slice(0, 10)}).
// Licensed CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/
// Unmodified here; breadboard.js recolours and repositions them when drawing.
${credits}
// Generated by the breadboard-pictures skill (fritzing.mjs bundle). Regenerate rather than edit.
window.BREADBOARD_BUNDLE = ${JSON.stringify(result)};
`);
  const kb = Math.round(readFileSync(dest).length / 1024);
  console.log(`wrote ${dest} (${kb} KB): ${loaded.map(l => l.key).join(", ")}`);
}

/* ------------------------------------------------------------------ cli */
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "sync") sync(rest.includes("--update"));
  else if (cmd === "search") search(rest.filter(a => a !== "--all"), rest.includes("--all"));
  else if (cmd === "show") show(rest[0]);
  else if (cmd === "bundle") {
    const specs = [];
    for (let i = 1; i < rest.length; i += 2) {
      const kind = { "--board": "board", "--part": "part" }[rest[i]];
      const m = /^([\w-]+)=(.+)$/.exec(rest[i + 1] || "");
      if (!kind || !m) die(`bad argument near ${rest[i]} — expected --board key=core/x.fzp or --part key=core/x.fzp`);
      specs.push({ kind, key: m[1], file: m[2].replace(/\\/g, "/") });
    }
    bundle(rest[0], specs);
  } else {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
} catch (e) { die(e.message); }
