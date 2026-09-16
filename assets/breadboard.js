/* breadboard.js — step-by-step breadboard pictures from Fritzing part drawings.
 *
 * Load after a bundle made by fritzing.mjs (window.BREADBOARD_BUNDLE). Geometry is read from the
 * drawings in the browser, so any Fritzing part or breadboard works without hand-entered pin
 * positions. Units: 1 = one hole pitch (0.1 in). See REFERENCE.md for the full spec format.
 *
 *   const bb = BB.board("half", { rows: "ABCDEFGHIJ", rails: { top: ["+", "-"], bottom: ["-", "+"] } });
 *   bb.figure(host, { old: [...], now: [...], view: { cols: [15, 30] } });
 *
 * MIT licence. The drawings it places are CC BY-SA 3.0 — see BB.credit().
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const U = 10;                                   // internal units per hole pitch
  const BUNDLE = () => window.BREADBOARD_BUNDLE || { boards: {}, parts: {} };

  const WIRE = { red: "#D1231B", black: "#2B2B2B", blue: "#1F5FC4", green: "#2E9A48", orange: "#EE7A12",
                 yellow: "#EBC316", white: "#EDEDED", purple: "#8A3FC2", grey: "#8C8C8C", brown: "#7A4A21" };
  const BAND = { black: "#1A1A1A", brown: "#8A3D06", red: "#C40808", orange: "#F07A12", yellow: "#F2D21B",
                 green: "#2E9A48", blue: "#1F5FC4", violet: "#8A3FC2", grey: "#8C8C8C", white: "#F5F5F5",
                 gold: "#AD9F4E", silver: "#C0C0C0" };
  const DIGIT = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];
  const LEG = "#8C8C8C";

  /* ------------------------------------------------------------------ small DOM helpers */
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const deg = r => r * 180 / Math.PI;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

  let measureRoot = null;
  function measurer() {
    if (!measureRoot) {
      measureRoot = el("svg", { width: 10, height: 10, style: "position:absolute;left:-9999px;top:0;visibility:hidden" });
      document.body.appendChild(measureRoot);
    }
    return measureRoot;
  }

  // physical width of an SVG in inches, Fritzing's rules (px = 90 dpi unless Illustrator made it)
  function inches(svgText, value) {
    const m = /^\s*([\d.]+)\s*([a-z%]*)\s*$/i.exec(value || "");
    if (!m) return null;
    const n = +m[1], unit = m[2].toLowerCase();
    if (unit === "in") return n;
    if (unit === "mm") return n / 25.4;
    if (unit === "cm") return n / 2.54;
    if (unit === "pt") return n / 72;
    if (unit === "px" || unit === "") return n / (/Illustrator/i.test(svgText) ? 72 : 90);
    return null;
  }

  /* ------------------------------------------------------------------ loading a drawing
   * Returns { g, pts, layer }: g is a detached <g> holding the drawing in internal units, pts maps
   * a svg element id to { c: centre, bb: box, line: [start, end] for <line> legs }.
   */
  let uid = 0;
  function loadDrawing(entry, wantIds, scaleHint, withText) {
    const doc = new DOMParser().parseFromString(entry.svg, "image/svg+xml");
    const src = doc.documentElement;
    if (src.nodeName !== "svg") throw new Error(`${entry.title}: drawing did not parse`);
    const vb = (src.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    const wAttr = src.getAttribute("width");
    const vbW = vb.length === 4 ? vb[2] : parseFloat(wAttr);
    const vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;

    // unique ids + classes so several copies can live in one page
    const pfx = `bb${++uid}-`;
    for (const n of src.querySelectorAll("*")) {
      if (n.hasAttribute("id")) n.setAttribute("id", pfx + n.getAttribute("id"));
      for (const a of ["fill", "stroke", "filter", "clip-path", "mask", "style", "marker-start", "marker-end"]) {
        const v = n.getAttribute(a);
        if (v && v.includes("url(")) n.setAttribute(a, v.replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g, `url(#${pfx}$1)`));
      }
      for (const a of ["href", "xlink:href"]) {
        const v = n.getAttribute(a);
        if (v && v.startsWith("#")) n.setAttribute(a, `#${pfx}${v.slice(1)}`);
      }
      const cls = n.getAttribute("class");
      if (cls) n.setAttribute("class", cls.split(/\s+/).map(c => c && pfx + c).join(" "));
      if (n.nodeName === "style") n.textContent = n.textContent
        .replace(/\.([A-Za-z_][\w-]*)/g, `.${pfx}$1`).replace(/#([A-Za-z_][\w-]*)(?=[^;{}]*\{)/g, `#${pfx}$1`)
        .replace(/url\(\s*#([^)]+)\)/g, `url(#${pfx}$1)`);
    }

    const root = el("g", {}, measurer());
    for (const c of [...src.childNodes]) root.appendChild(document.importNode(c, true));
    const find = id => root.querySelector(`[id="${pfx}${id}"]`);

    const inv = root.getCTM().inverse();
    const local = (node, x, y) => {
      const m = inv.multiply(node.getCTM());
      const p = new DOMPoint(x, y).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    const pts = {};
    for (const id of wantIds) {
      const n = find(id);
      if (!n) continue;
      if (n.nodeName === "line") {
        const g = k => +n.getAttribute(k);
        pts[id] = { line: [local(n, g("x1"), g("y1")), local(n, g("x2"), g("y2"))] };
        pts[id].c = pts[id].line[1];
      } else {
        const b = n.getBBox();
        pts[id] = { c: local(n, b.x + b.width / 2, b.y + b.height / 2) };
      }
    }

    // printed labels (single letters and numbers), used to name a board's rows and columns
    const texts = [];
    if (withText) for (const n of root.querySelectorAll("text")) {
      const t = n.textContent.trim();
      if (!/^(\d{1,3}|[A-Za-z])$/.test(t)) continue;
      const b = n.getBBox();
      texts.push({ t, c: local(n, b.x + b.width / 2, b.y + b.height / 2) });
    }

    // scale: from the physical width, or from a hint (the board measures its own pitch)
    let s = scaleHint ? scaleHint(pts) : null;
    if (!s) {
      const w = inches(entry.svg, wAttr);
      if (!w || !vbW) throw new Error(`${entry.title}: drawing has no physical size`);
      s = (w * 10 * U) / vbW;                    // 1 in = 10 pitches
    }
    const T = p => ({ x: (p.x - vx) * s, y: (p.y - vy) * s });
    for (const k in pts) {
      pts[k].c = T(pts[k].c);
      if (pts[k].line) pts[k].line = pts[k].line.map(T);
    }
    for (const t of texts) t.c = T(t.c);

    // what gets displayed: the breadboard layer if the file has one, with its own transform
    const layerNode = (entry.layer && find(entry.layer)) || root;
    const layerM = inv.multiply(layerNode.getCTM());
    const shown = layerNode === root ? root : layerNode;
    const g = el("g", { transform: `scale(${s}) translate(${-vx},${-vy})` });
    if (shown !== root) {
      const wrap = el("g", { transform: `matrix(${layerM.a},${layerM.b},${layerM.c},${layerM.d},${layerM.e},${layerM.f})` }, g);
      // keep root-level <defs>/<style> that the layer may reference
      for (const c of [...root.children]) if (/^(defs|style)$/.test(c.nodeName)) g.insertBefore(c, wrap);
      shown.removeAttribute("transform");
      wrap.appendChild(shown);
    } else {
      for (const c of [...root.childNodes]) g.appendChild(c);
    }
    root.remove();
    return { g, pts, texts, find: id => g.querySelector(`[id="${pfx}${id}"]`), scale: s };
  }

  /* ------------------------------------------------------------------ the board */
  function board(key, opts = {}) {
    const entry = BUNDLE().boards[key];
    if (!entry) throw new Error(`board "${key}" is not in the bundle`);
    const ids = entry.connectors.map(c => c.svgId);
    const probe = loadDrawing(entry, ids, pts => {
      // one pitch = the most common distance between neighbouring holes
      const cs = Object.values(pts).map(p => p.c);
      const ds = [];
      for (let i = 0; i < Math.min(cs.length, 200); i++) {
        let best = Infinity;
        for (let j = 0; j < cs.length; j++) if (i !== j) best = Math.min(best, dist(cs[i], cs[j]));
        ds.push(best);
      }
      return U / median(ds);
    }, true);
    const at = {};
    for (const c of entry.connectors) if (probe.pts[c.svgId]) at[c.id] = probe.pts[c.svgId].c;

    // classify buses: short vertical ones are the terminal strips, long horizontal ones are rails
    const strips = [], rails = [];
    for (const bus of entry.buses) {
      const ps = bus.map(id => at[id]).filter(Boolean);
      if (ps.length < 2) continue;
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      if (w < U / 2) strips.push({ x: median(xs), holes: bus.filter(id => at[id]) });
      else if (h < U / 2) rails.push({ y: median(ys), holes: bus.filter(id => at[id]) });
    }
    if (!strips.length) throw new Error(`board "${key}": no terminal strips found`);

    const uniq = vs => vs.sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > U / 2);
    const colXs = uniq(strips.map(s => s.x));
    const rowYs = uniq(strips.flatMap(s => s.holes.map(id => at[id].y)));
    const colIdx = x => colXs.findIndex(v => Math.abs(v - x) < U / 2);
    const rowIdx = y => rowYs.findIndex(v => Math.abs(v - y) < U / 2);

    // column numbers: as printed on the board (the most common printed-number offset), else from 1
    let offset = opts.firstColumn ? opts.firstColumn : null;
    if (offset === null) {
      const votes = {};
      for (const t of probe.texts) if (/^\d+$/.test(t.t)) {
        const i = colXs.findIndex(v => Math.abs(v - t.c.x) < U * 0.35);
        if (i >= 0) votes[+t.t - i] = (votes[+t.t - i] || 0) + 1;
      }
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      offset = best ? +best[0] : 1;
    } else offset = offset - 0;
    const colNum = i => i + offset;
    const cols = colXs.map((_, i) => colNum(i)).filter(n => n >= 1);

    // row letters: given, else as printed on the board, else A.. from the top
    let letters = opts.rows ? opts.rows.split("") : null;
    if (!letters) {
      const printed = rowYs.map(y => (probe.texts.find(t => /^[A-Za-z]$/.test(t.t) && Math.abs(t.c.y - y) < U * 0.35) || {}).t);
      letters = printed.every(Boolean) ? printed.map(l => l.toUpperCase()) : "ABCDEFGHIJKLMNOP".split("");
    }
    if (letters.length < rowYs.length) throw new Error(`board "${key}" has ${rowYs.length} rows; give that many letters`);

    const holes = {};                                   // name -> {x, y}
    for (const s of strips) for (const id of s.holes) {
      const p = at[id];
      const n = colNum(colIdx(p.x));
      if (n >= 1) holes[`${letters[rowIdx(p.y)]}${n}`] = p;
    }
    const fieldTop = rowYs[0], fieldBottom = rowYs[rowYs.length - 1];
    const railYs = [...new Set(rails.map(r => Math.round(r.y)))].sort((a, b) => a - b);
    const firstRow = rowYs[0];
    const top = railYs.filter(y => y < fieldTop).sort((a, b) => a - b);          // outer first
    const bottom = railYs.filter(y => y > fieldBottom).sort((a, b) => b - a);    // outer first
    const railSpec = Object.assign({ top: ["+", "-"], bottom: ["+", "-"] }, opts.rails || {});
    const railName = {};                                // y -> "T+" etc
    top.forEach((y, i) => { if (railSpec.top[i]) railName[y] = "T" + railSpec.top[i]; });
    bottom.forEach((y, i) => { if (railSpec.bottom[i]) railName[y] = "B" + railSpec.bottom[i]; });
    for (const r of rails) {
      const nm = railName[Math.round(r.y)];
      if (!nm) continue;
      for (const id of r.holes) {
        const p = at[id];
        const c = colIdx(p.x);
        if (c >= 0 && colNum(c) >= 1) holes[`${nm}${colNum(c)}`] = p;
      }
    }

    const wrap = el("g", {}, measurer());
    wrap.appendChild(probe.g);
    const b = wrap.getBBox();
    const size = { x: b.x, y: b.y, w: b.width, h: b.height };
    wrap.remove();
    const drawn = probe.g;
    const byPos = Object.entries(holes);

    const api = {
      key, cols: Math.max(...cols), firstCol: Math.min(...cols), rows: letters.slice(0, rowYs.length), holes, size, entry,
      firstRowY: firstRow,
      hole(name) {
        const p = holes[name];
        if (!p) throw new Error(`no hole "${name}" on board "${key}"` +
          (/^[TB][+-]\d+$/.test(name) ? " (rails have gaps; try a neighbouring column)" : ""));
        return p;
      },
      colX: c => colXs[c - offset],
      holeAt(x, y) {
        const hit = byPos.find(([, p]) => Math.abs(p.x - x) < U / 3 && Math.abs(p.y - y) < U / 3);
        return hit ? hit[0] : null;
      },
      stripes: opts.stripes !== false,
      railYs: { top, bottom, names: railName },
      figure: (host, spec) => figure(api, drawn, host, spec),
    };
    return api;
  }

  /* ------------------------------------------------------------------ part instances */
  const cache = {};
  function partTemplate(key) {
    if (cache[key]) return cache[key];
    const entry = BUNDLE().parts[key];
    if (!entry) throw new Error(`part "${key}" is not in the bundle`);
    const ids = entry.connectors.flatMap(c => [c.svgId, c.legId]).filter(Boolean);
    const probe = loadDrawing(entry, ids);
    return (cache[key] = { entry, probe });
  }
  function instance(key) {
    const t = partTemplate(key);
    // fresh copy with fresh ids each time
    const copy = loadDrawing(t.entry, []);
    return { entry: t.entry, pts: t.probe.pts, g: copy.g, find: copy.find };
  }
  function connectorOf(entry, ref) {
    const c = entry.connectors.find(c => c.id === ref) ||
              entry.connectors.find(c => c.name === ref) ||
              entry.connectors.find(c => c.name.toLowerCase() === String(ref).toLowerCase());
    if (!c) throw new Error(`${entry.title}: no connector "${ref}" (have: ${entry.connectors.map(c => `${c.id}/${c.name}`).join(", ")})`);
    return c;
  }

  function resistorBands(ohms, bands = 4) {
    const v = typeof ohms === "number" ? ohms : parseValue(ohms);
    const digits = bands === 5 ? 3 : 2;
    let exp = Math.floor(Math.log10(v)) - (digits - 1);
    let sig = Math.round(v / Math.pow(10, exp));
    if (sig >= Math.pow(10, digits)) { sig /= 10; exp += 1; }
    const ds = String(sig).padStart(digits, "0").split("").map(d => DIGIT[+d]);
    const mult = exp >= 0 ? DIGIT[exp] : exp === -1 ? "gold" : "silver";
    return [...ds, mult];
  }
  function parseValue(s) {
    const m = /^\s*([\d.]+)\s*([rkmR]?)\s*([\d]*)\s*(?:Ω|ohm)?\s*$/i.exec(String(s).replace(",", "."));
    if (!m) throw new Error(`can't read resistor value "${s}"`);
    const mul = { "": 1, r: 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()];
    return parseFloat(m[1] + (m[3] ? "." + m[3] : "")) * mul;
  }

  function place(bb, layer, p, warn) {
    const inst = instance(p.part);
    const { entry } = inst;
    const map = Object.entries(p.at || {}).map(([ref, hole]) => {
      const c = connectorOf(entry, ref);
      return { c, hole: bb.hole(hole), holeName: hole };
    });
    if (!map.length) throw new Error(`${entry.title}: "at" names no connectors`);

    // anchor in the drawing: leg start for bendable legs, pin centre otherwise
    const anchor = c => {
      const leg = c.legId && inst.pts[c.legId];
      if (leg) return leg.line[0];
      const pin = inst.pts[c.svgId];
      if (!pin) throw new Error(`${entry.title}: connector ${c.id} has no drawing element ${c.svgId}`);
      return pin.c;
    };
    const bendable = map.every(m => m.c.legId && inst.pts[m.c.legId]);

    // recolour and relabel before placing
    if (p.bands || entry.props.bands) recolourResistor(inst, p);
    for (const [id, colour] of Object.entries(p.fill || {})) inst.find(id)?.setAttribute("fill", colour);
    if (p.text) for (const t of inst.g.querySelectorAll("text"))
      for (const [from, to] of Object.entries(p.text)) if (t.textContent.trim() === from) t.textContent = to;
    // hide Fritzing's own legs; we draw legs from the part to the hole ourselves
    for (const c of entry.connectors) if (c.legId) inst.find(c.legId)?.setAttribute("display", "none");

    const g = el("g", {}, layer);
    const legs = el("g", {}, g);
    const body = el("g", {}, g);

    const a0 = anchor(map[0].c), h0 = map[0].hole;
    let rot, pos, mirror = !!p.flip;
    if (map.length >= 2) {
      const a1 = anchor(map[map.length - 1].c), h1 = map[map.length - 1].hole;
      const partLen = dist(a0, a1), holeLen = dist(h0, h1);
      rot = ang(h0, h1) - ang(a0, a1) * (mirror ? -1 : 1);
      if (bendable) {
        // body centred between the holes, lifted sideways (in pitches) if asked or if it can't lie flat
        // lift: pitches sideways, negative = up (or left when the holes are one above the other)
        const lift = p.lift ?? (partLen > holeLen + U / 2 ? -1.5 : 0);
        const m = mid(h0, h1), th = ang(h0, h1);
        let nx = -Math.sin(th), ny = Math.cos(th);
        if (ny < -1e-6 || (Math.abs(ny) <= 1e-6 && nx < 0)) { nx = -nx; ny = -ny; }
        const shift = p.shift || [0, 0];
        pos = { x: m.x + nx * lift * U + shift[0] * U, y: m.y + ny * lift * U + shift[1] * U };
        const am = mid(a0, a1);
        placeBody(body, inst.g, am, rot, pos, mirror);
      } else {
        if (Math.abs(partLen - holeLen) > U * 0.3)
          warn(`${p.label || entry.title}: its pins are ${(partLen / U).toFixed(1)} holes apart but ` +
               `${map[0].holeName}–${map[map.length - 1].holeName} are ${(holeLen / U).toFixed(1)} apart`);
        placeBody(body, inst.g, a0, rot, h0, mirror);
      }
    } else {
      rot = (p.rotate || 0) * Math.PI / 180;
      const off = p.offset || [0, 0];
      pos = { x: h0.x + off[0] * U, y: h0.y + off[1] * U };
      placeBody(body, inst.g, a0, rot, pos, mirror);
      if (!bendable && (off[0] || off[1])) warn(`${entry.title}: offset only makes sense with bendable legs`);
    }

    // legs (bendable) and pin dots
    const M = body.firstChild.transform.baseVal.consolidate().matrix;
    const world = q => { const r = new DOMPoint(q.x, q.y).matrixTransform(M); return { x: r.x, y: r.y }; };
    for (const m of map) {
      if (m.c.legId && inst.pts[m.c.legId]) {
        const s = world(anchor(m.c));
        el("line", { x1: s.x, y1: s.y, x2: m.hole.x, y2: m.hole.y, stroke: LEG, "stroke-width": 2.1,
                     "stroke-linecap": "round" }, legs);
      }
      el("circle", { cx: m.hole.x, cy: m.hole.y, r: 1.7, fill: "#6E6E6E" }, legs);
    }
    // a rigid part's other pins go wherever the drawing puts them: they take those holes too
    const holes = map.map(m => m.holeName);
    if (!bendable) for (const c of entry.connectors) {
      if (map.some(m => m.c === c) || !inst.pts[c.svgId]) continue;
      const w = world(inst.pts[c.svgId].c), h = bb.holeAt(w.x, w.y);
      if (h) holes.push(h);
    }
    return { g, holes, anchor: world(mid(a0, anchor(map[map.length - 1].c))) };
  }
  function placeBody(parent, drawing, anchor, rot, pos, mirror) {
    el("g", { transform: `translate(${pos.x},${pos.y}) rotate(${deg(rot)})` + (mirror ? " scale(1,-1)" : "") +
                         ` translate(${-anchor.x},${-anchor.y})` }, parent).appendChild(drawing);
  }
  function recolourResistor(inst, p) {
    // bands = digit colours then the multiplier colour; 5-band drawings take three digits
    const five = +(inst.entry.props.bands || 4) === 5;
    const bands = Array.isArray(p.bands) ? p.bands
      : resistorBands(p.bands || p.value || inst.entry.props.resistance, five ? 5 : 4);
    const ids = five ? ["band_1_st", "band_2_nd", "band_3_rd", "band_rd_multiplier"]
                     : ["band_1_st", "band_2_nd", "band_rd_multiplier"];
    ids.forEach((id, i) => {
      const n = inst.find(id);
      if (n && bands[i]) n.setAttribute("fill", BAND[bands[i]] || bands[i]);
    });
  }

  /* ------------------------------------------------------------------ generated parts */
  // a DIP chip in Fritzing's style: pin 1 bottom-left, numbering anticlockwise, straddling the channel
  function dip(bb, layer, p) {
    const n = p.pins || 8, per = n / 2;
    const row = p.width === 600 ? 6 : 3;             // pitches between the pin rows
    const p1 = bb.hole(p.pin1);
    const x0 = p1.x - 0.5 * U, x1 = p1.x + (per - 1) * U + 0.5 * U;
    const yB = p1.y, yT = p1.y - row * U;
    const g = el("g", {}, layer);
    for (let i = 0; i < per; i++) {
      const x = p1.x + i * U;
      for (const [y, dy] of [[yB, -1], [yT, 1]]) {
        el("rect", { x: x - 1.5, y: dy < 0 ? y - 3.4 : y - 1, width: 3, height: 4.4, fill: "#8C8C8C" }, g);
        el("circle", { cx: x, cy: y, r: 1.7, fill: "#6E6E6E" }, g);
      }
    }
    const top = yT + 2.3, bot = yB - 2.3;
    el("rect", { x: x0, y: top, width: x1 - x0, height: bot - top, fill: "#303030" }, g);
    el("rect", { x: x0, y: top, width: x1 - x0, height: (bot - top) * 0.28, fill: "#3D3D3D" }, g);
    el("path", { d: `M${x0},${(top + bot) / 2 - 3.2} a3.2,3.2 0 0 1 0,6.4 z`, fill: "#1C1C1C" }, g);
    el("circle", { cx: x0 + 2.6, cy: bot - 2.6, r: 1.3, fill: "#1F1F1F" }, g);
    el("text", { x: (x0 + x1) / 2, y: (top + bot) / 2 + 2.2, fill: "#E3DBDB", "font-size": 6.2,
                 "font-family": "Consolas, 'OCR A', monospace", "text-anchor": "middle" }, g, p.text || "");
    const holes = [];
    for (let i = 0; i < per; i++) {
      const x = p1.x + i * U;
      holes.push(bb.holeAt(x, yB), bb.holeAt(x, yT));
      if (p.numbers) {
        const nb = i + 1, nt = n - i;
        for (const [y, t] of [[yB + 4.6, nb], [yT - 3.2, nt]])
          el("text", { x, y, fill: "#1B1F1C", "font-size": 3.6, "font-weight": 700, "font-family": "Segoe UI, sans-serif",
                       "text-anchor": "middle", stroke: "#FFF8DB", "stroke-width": 1.2, "paint-order": "stroke" }, g, t);
      }
    }
    if (holes.some(h => !h)) throw new Error(`chip at ${p.pin1}: some pins don't land in holes (${row} rows apart)`);
    return { g, holes, anchor: { x: (x0 + x1) / 2, y: top } };
  }

  // an insulated wire with bare tips; route: [dx1, dy1, dx2, dy2] in pitches, handles from each end
  function wire(bb, layer, p) {
    const a = typeof p.from === "string" ? bb.hole(p.from) : xyPitch(bb, p.from);
    const b = typeof p.to === "string" ? bb.hole(p.to) : xyPitch(bb, p.to);
    const col = WIRE[p.color] || p.color || WIRE.grey;
    let d, labelAt;
    if (p.route) {
      const [dx1, dy1, dx2, dy2] = p.route.map(v => v * U);
      const c1 = { x: a.x + dx1, y: a.y + dy1 }, c2 = { x: b.x + dx2, y: b.y + dy2 };
      d = `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
      labelAt = { x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
                  y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y };
    } else {
      const bow = (p.bow || 0) * U, m = mid(a, b), th = ang(a, b);
      const c = { x: m.x - Math.sin(th) * bow, y: m.y + Math.cos(th) * bow };
      d = `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
      labelAt = mid(m, c);
    }
    const g = el("g", {}, layer);
    el("path", { d, fill: "none", stroke: "rgba(0,0,0,.25)", "stroke-width": 4.2, "stroke-linecap": "round",
                 transform: "translate(0.7,1)" }, g);
    el("path", { d, fill: "none", stroke: shade(col, -0.35), "stroke-width": 3.6, "stroke-linecap": "round" }, g);
    el("path", { d, fill: "none", stroke: col, "stroke-width": 2.6, "stroke-linecap": "round" }, g);
    for (const q of [a, b])
      el("circle", { cx: q.x, cy: q.y, r: 1.9, fill: "#A5A5A5", stroke: "#5E5E5E", "stroke-width": 0.5 }, g);
    const holes = [p.from, p.to].filter(h => typeof h === "string");
    return { g, holes, anchor: labelAt };
  }
  function xyPitch(bb, v) {       // {hole, dx, dy} or [x, y] in pitches from column 1 / row 1
    if (Array.isArray(v)) return { x: bb.colX(bb.firstCol) + v[0] * U, y: bb.firstRowY + v[1] * U };
    const h = bb.hole(v.hole);
    return { x: h.x + (v.dx || 0) * U, y: h.y + (v.dy || 0) * U };
  }
  function shade(hex, f) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16);
    const ch = k => Math.max(0, Math.min(255, Math.round(((n >> k) & 255) * (1 + f))));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // a part off the board, connected by wires: { part, near: {hole, dx, dy}, rotate, wires: {conn: {to, color, route}} }
  function offboard(bb, layer, p, warn) {
    const inst = instance(p.part);
    const g = el("g", {}, layer);
    const anchorRef = connectorOf(inst.entry, p.anchor || inst.entry.connectors[0].id);
    const a = (inst.pts[anchorRef.svgId] || {}).c;
    if (!a) throw new Error(`${inst.entry.title}: cannot find connector ${anchorRef.id}`);
    const pos = xyPitch(bb, p.near);
    for (const c of inst.entry.connectors) if (c.legId) inst.find(c.legId)?.setAttribute("display", "none");
    if (p.text) for (const t of inst.g.querySelectorAll("text"))
      for (const [from, to] of Object.entries(p.text)) if (t.textContent.trim() === from) t.textContent = to;
    const wires = el("g", {}, g);
    const body = el("g", {}, g);
    placeBody(body, inst.g, a, (p.rotate || 0) * Math.PI / 180, pos, !!p.flip);
    const M = body.firstChild.transform.baseVal.consolidate().matrix;
    const holes = [];
    for (const [ref, w] of Object.entries(p.wires || {})) {
      const c = connectorOf(inst.entry, ref);
      const src = inst.pts[c.legId]?.line?.[1] || inst.pts[c.svgId]?.c;
      if (!src) { warn(`${inst.entry.title}: connector ${ref} not found in drawing`); continue; }
      const r = new DOMPoint(src.x, src.y).matrixTransform(M);
      const start = { x: r.x, y: r.y };
      wireFromPoint(bb, wires, start, w);
      holes.push(w.to);
    }
    return { g, holes, anchor: pos };
  }
  function wireFromPoint(bb, layer, start, w) {
    const b = bb.hole(w.to);
    const col = WIRE[w.color] || w.color || WIRE.grey;
    const [dx1, dy1, dx2, dy2] = (w.route || [0, 2, 0, -2]).map(v => v * U);
    const d = `M${start.x},${start.y} C${start.x + dx1},${start.y + dy1} ${b.x + dx2},${b.y + dy2} ${b.x},${b.y}`;
    el("path", { d, fill: "none", stroke: "rgba(0,0,0,.25)", "stroke-width": 4.2, "stroke-linecap": "round",
                 transform: "translate(0.7,1)" }, layer);
    el("path", { d, fill: "none", stroke: shade(col, -0.35), "stroke-width": 3.6, "stroke-linecap": "round" }, layer);
    el("path", { d, fill: "none", stroke: col, "stroke-width": 2.6, "stroke-linecap": "round" }, layer);
    el("circle", { cx: b.x, cy: b.y, r: 1.9, fill: "#A5A5A5", stroke: "#5E5E5E", "stroke-width": 0.5 }, layer);
  }

  function draw(bb, layer, p, warn) {
    if (p.part === "@wire") return wire(bb, layer, p);
    if (p.part === "@dip") return dip(bb, layer, p);
    if (p.near) return offboard(bb, layer, p, warn);
    return place(bb, layer, p, warn);
  }

  /* ------------------------------------------------------------------ labels */
  const TAG = { bg: "#FFF8DB", ink: "#1B1F1C", edge: "#1B1F1C" };
  const PART = { bg: "#2C6C63", ink: "#FFFFFF", edge: "#2C6C63" };
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
                 "up-left": [-1, -1], "up-right": [1, -1], "down-left": [-1, 1], "down-right": [1, 1] };

  function pill(parent, x, y, text, k, style) {
    const fs = 15 / k, padX = 6 / k, padY = 3.5 / k;
    const w = text.length * fs * 0.58 + 2 * padX, h = fs + 2 * padY;
    el("rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: h / 2, fill: style.bg,
                 stroke: style.edge, "stroke-width": 1 / k }, parent);
    el("text", { x, y: y + fs * 0.35, "font-size": fs, "font-weight": 700, fill: style.ink,
                 "font-family": "Segoe UI, system-ui, sans-serif", "text-anchor": "middle" }, parent, text);
  }
  function holeLabel(name) {
    const m = /^([TB])([+-])(\d+)$/.exec(name);
    if (!m) return name;
    return `${m[1] === "T" ? "top" : "bottom"} ${m[2] === "+" ? "+ rail" : "− rail"}`;
  }
  function holeTag(bb, parent, name, dir, k) {
    const h = bb.hole(name);
    const [dx, dy] = DIRS[dir] || dir || DIRS.up;
    const len = Math.hypot(dx, dy) || 1;
    el("circle", { cx: h.x, cy: h.y, r: 4.3, fill: "none", stroke: "#F2B705", "stroke-width": 1.6 }, parent);
    const off = 26 / k;
    const tx = h.x + dx / len * off * 1.5, ty = h.y + dy / len * off;
    el("line", { x1: h.x + dx / len * 4.3, y1: h.y + dy / len * 4.3, x2: tx, y2: ty, stroke: "#1B1F1C",
                 "stroke-width": 1.2 / k }, parent);
    pill(parent, tx, ty, holeLabel(name), k, TAG);
  }

  /* ------------------------------------------------------------------ figure */
  const FIGURES = [];
  function figure(bb, boardDrawing, host, spec) {
    const warnings = [];
    const warn = m => { warnings.push(m); console.warn("[breadboard] " + m); };
    const pxWide = spec.width || 860;

    const svg = el("svg", { role: "img", "aria-label": spec.alt || "breadboard", class: "bb-figure" }, host);
    const fid = "bbf" + (++uid);
    const defs = el("defs", {}, svg);
    const grey = el("filter", { id: fid + "g", "color-interpolation-filters": "sRGB" }, defs);
    el("feColorMatrix", { type: "saturate", values: 0.08 }, grey);
    const clip = el("clipPath", { id: fid + "c" }, defs);
    const clipRect = el("rect", {}, clip);
    const root = el("g", { "clip-path": `url(#${fid}c)` }, svg);

    const boardG = el("g", {}, root);
    boardG.appendChild(boardDrawing.cloneNode(true));
    if (bb.stripes) {
      const x0 = bb.colX(bb.firstCol), x1 = bb.colX(bb.cols);
      const colourOf = nm => nm && nm[1] === "+" ? "#D1231B" : "#1F5FC4";
      for (const [y, nm] of Object.entries(bb.railYs.names)) {
        const outer = nm[0] === "T" ? +y === bb.railYs.top[0] : +y === bb.railYs.bottom[0];
        const sy = +y + (nm[0] === "T" ? (outer ? -1 : 1) : (outer ? 1 : -1)) * 0.62 * U;
        el("rect", { x: x0 - 0.5 * U, y: sy - 0.5, width: x1 - x0 + U, height: 1.1, fill: colourOf(nm) }, boardG);
        el("text", { x: x0 - 1.4 * U, y: +y + 2.2, fill: colourOf(nm), "font-size": 7, "font-weight": 700,
                     "font-family": "Arial, sans-serif", "text-anchor": "middle" }, boardG, nm[1] === "+" ? "+" : "−");
      }
    }

    const occupied = {};
    const claim = (holes, who) => holes.forEach(h => {
      if (!h) return;
      if (occupied[h] && !/^[TB][+-]/.test(h)) warn(`hole ${h} is used twice: ${occupied[h]} and ${who}`);
      occupied[h] = occupied[h] || who;
    });

    const oldG = el("g", { filter: `url(#${fid}g)`, opacity: 0.4 }, root);
    for (const p of spec.old || []) {
      try { const r = draw(bb, oldG, p, warn); claim(r.holes, p.label || p.part); }
      catch (e) { warn(e.message); }
    }
    const nowG = el("g", {}, root);
    const placed = [];
    for (const p of spec.now || []) {
      try { const r = draw(bb, nowG, p, warn); claim(r.holes, p.label || p.part); placed.push({ p, r }); }
      catch (e) { warn(e.message); }
    }

    // view: whole board, or a column range; always grown to include the new parts
    let vx, vy, vw, vh;
    const v = spec.view || "full";
    if (v === "full") { vx = bb.size.x; vy = bb.size.y; vw = bb.size.w; vh = bb.size.h; }
    else if (Array.isArray(v)) {
      const o = xyPitch(bb, [v[0], v[1]]);
      vx = o.x; vy = o.y; vw = v[2] * U; vh = v[3] * U;
    }
    else {
      const [c0, c1] = v.cols || [bb.firstCol, bb.cols];
      vx = bb.colX(c0) - 1.6 * U; vw = bb.colX(c1) - bb.colX(c0) + 3.2 * U;
      vy = bb.size.y; vh = bb.size.h;
    }
    if (v === "full" || !Array.isArray(v)) {
      const nb = nowG.getBBox(), ob = oldG.getBBox();
      const boxes = [nb].concat(v === "full" ? [ob] : []).filter(b => b.width || b.height);
      for (const b of boxes) {
        const pad = 0.6 * U;
        const nx0 = Math.min(vx, b.x - pad), ny0 = Math.min(vy, b.y - pad);
        const nx1 = Math.max(vx + vw, b.x + b.width + pad), ny1 = Math.max(vy + vh, b.y + b.height + pad);
        if (v === "full") { vx = nx0; vw = nx1 - nx0; }
        vy = ny0; vh = ny1 - ny0;
      }
      vy -= 1.2 * U; vh += 2.4 * U;              // room for labels
    }
    const k = pxWide / vw;
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    svg.setAttribute("width", pxWide);
    svg.setAttribute("height", Math.round(vh * k));
    Object.entries({ x: vx, y: vy, width: vw, height: vh }).forEach(([a, n]) => clipRect.setAttribute(a, n));

    const labels = el("g", {}, root);
    for (const { p, r } of placed) {
      const auto = p.part === "@dip" ? [p.pin1] : r.holes;     // a chip: name pin 1 only
      const tags = p.tags || (spec.tagHoles === false ? {} : Object.fromEntries(auto.map(h => [h, "down"])));
      for (const [h, dir] of Object.entries(tags)) {
        try { holeTag(bb, labels, h, dir, k); } catch (e) { warn(e.message); }
      }
      if (p.label) {
        const [dx, dy] = p.labelAt || [0, -2];
        const lx = r.anchor.x + dx * U, ly = r.anchor.y + dy * U;
        el("line", { x1: r.anchor.x, y1: r.anchor.y, x2: lx, y2: ly, stroke: PART.bg, "stroke-width": 1.4 / k }, labels);
        pill(labels, lx, ly, p.label, k, PART);
      }
    }
    for (const n of spec.notes || []) {
      const at = xyPitch(bb, n.at);
      el("text", { x: at.x, y: at.y, "font-size": 13 / k, fill: "#55605A", "font-style": "italic",
                   "font-family": "Segoe UI, system-ui, sans-serif", "text-anchor": n.anchor || "start" }, labels, n.text);
    }

    if (warnings.length) {
      const pre = document.createElement("pre");
      pre.className = "bb-warnings";
      pre.style.cssText = "white-space:pre-wrap;color:#9B1C1C;background:#FDECEC;border:1px solid #E5A3A3;padding:8px;font-size:13px";
      pre.textContent = "Breadboard picture problems:\n• " + warnings.join("\n• ");
      host.appendChild(pre);
    }
    FIGURES.push(host);
    return { svg, warnings };
  }

  /* ------------------------------------------------------------------ credits + screenshot isolation */
  function credit() {
    const b = BUNDLE();
    const s = b.source || {};
    const authors = [...new Set(Object.values({ ...b.boards, ...b.parts }).map(e => e.author).filter(Boolean))];
    return `Breadboard and part drawings: ${s.library || "Fritzing parts library"} (${s.repo || ""}), ` +
           `by ${authors.join(", ") || "the Fritzing contributors"}; ${s.license || "CC BY-SA 3.0"} ` +
           `(${s.licenseUrl || ""}). Arranged and recoloured for this page.`;
  }
  // #bb-only=N shows figure N alone (for screenshots)
  window.addEventListener("load", () => {
    const m = /bb-only=(\d+)/.exec(location.hash);
    if (!m) return;
    const host = FIGURES[+m[1]];
    if (!host) return;
    document.body.replaceChildren(host);
    document.body.style.cssText = "margin:0;padding:8px;background:#fff";
  });

  window.BB = { board, credit, resistorBands, figures: FIGURES, U };
})();
