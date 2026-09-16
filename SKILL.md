---
name: breadboard-pictures
description: Draw step-by-step breadboard build pictures with real part drawings from the Fritzing parts library, placed in named holes. Use when someone needs to be shown what to plug where on a breadboard — build guides, wiring steps, "which hole does this go in".
---

A **breadboard picture** shows one physical action: the part being placed in full colour with
its holes circled and named, and everything already on the board greyed out. A build guide is a
sequence of these, one action per picture.

Everything runs locally from this skill's folder (`<skill>` below):

- `scripts/fritzing.mjs`: finds parts in the Fritzing parts library (about 2,100 parts, cached
  in `~/.cache/fritzing-parts`) and bundles their drawings into the project. It needs `git` and
  Node 18 or newer.
- `assets/breadboard.js`: the renderer, which the page loads.
- `scripts/snap.mjs`: screenshots the page with headless Chrome, Edge or Chromium, and reports
  any problems the renderer found.
- `assets/template.html`: a starting page.

Read [REFERENCE.md](REFERENCE.md) before writing part specs. It defines hole names, every part
option, and the generated parts (`@wire`, `@dip`).

## Steps

1. **Pin down the physical board.** Get these from the person, or from a photo:
   - the board size (half 30 columns, full 60–63, mini);
   - which letter is printed on the top row;
   - which rail is + and which is −, top and bottom.

   The Fritzing drawing's lettering can differ from the real board's, so the real board decides,
   through `rows` and `rails` in `BB.board()`.
   *Done when* all three are known, or recorded on the page as "to be checked" with a warning
   box.

2. **Find every part.**
   - Run `node <skill>/scripts/fritzing.mjs search <words>`, then `show <fzp>` for each
     candidate.
   - Pick by **package and drawing**, not by name. A search for "LM393" finds the surface-mount
     chip, and SparkFun's "MOSFET, TO-92" uses a PNP transistor drawing.
   - Prefer `core/` parts with a through-hole package (`THT`, `DIP`, `TO92`, `TO220`).
   - When the library lacks a part, use a drawing of the same package and say so on the page.
     Generic DIP chips aren't in the library; use `@dip`.
   - Note each part's connector names from `show`: they are what `at` refers to.

   *Done when* every part in the build maps to one `fzp` file or a generated part, with its
   connector names noted.

3. **Bundle the drawings into the project.** Run
   `node <skill>/scripts/fritzing.mjs bundle <project>/…/breadboard_bundle.js --board <key>=<fzp> --part <key>=<fzp> …`
   and copy `assets/breadboard.js` next to the bundle. The page must work offline from the
   project, so both files live there.
   *Done when* both files are in the project and the bundle command listed every key.

4. **Lay out the holes before drawing.**
   - Write a table per busy column: which part uses which hole.
   - All five holes of a terminal strip are one connection, so a column holds at most five
     legs or wires, and each leg gets its own hole.
   - Keep new parts clear of holes that later steps need.

   *Done when* every leg and wire end has a named hole and no hole is used twice.

5. **Write the page**, starting from `assets/template.html`.
   - One action per figure. `old` holds everything placed in earlier steps; `now` holds the
     step's part.
   - The step text names the same holes the picture circles, using the same names.
   - Say how to tell the part apart by looking at it (colour bands, stripe, flat face), and
     which leg goes where.

   *Done when* every step has its figure, and every hole named in the text appears in that
   figure's tags.

6. **Look at every figure.** Run
   `node <skill>/scripts/snap.mjs <page> <out.png> --only N` for each figure N, and open the
   PNG. Fix:
   - anything listed under PROBLEMS (holes used twice, pins that don't land on holes, unknown
     connectors);
   - anything that reads badly: labels covering the circled holes, parts hiding the new part,
     wires crossing where they could go around.

   Use `lift`, `shift`, `route`, `labelAt` and the tag directions to fix these. Raise
   `--height` if a figure is cut off.
   *Done when* every figure has been viewed after its last change, and none reports problems.

7. **Credit the drawings.** The page must show `BB.credit()`. Tell the person that the
   drawings are CC BY-SA 3.0: publishing the pictures requires this credit and sharing the
   pictures under the same licence.
   *Done when* the credit renders on the page.

## Keeping the library current

`node <skill>/scripts/fritzing.mjs sync --update` pulls the latest library and rebuilds the
index. Bundles record the library commit they came from; re-run `bundle` to pick up changes.
