# breadboard.js reference

All distances are in **pitches**: 1 = one hole spacing (0.1 in / 2.54 mm).

## Board

```js
const bb = BB.board("half", {
  rows: "ABCDEFGHIJ",                          // letters top→bottom, as printed on the REAL board
  rails: { top: ["+", "-"], bottom: ["+", "-"] }, // outer rail first
  firstColumn: 1,                              // optional; default reads the numbers printed on the drawing
  stripes: true,                               // draw red/blue lines along the rails
});
```

`"half"` is the key given to `--board` when bundling. Useful boards: `core/halfBreadboard.fzp`
(30 columns), `core/Half_breadboard_v2.fzp`, `core/breadboard2.fzp` (full), `core/miniBreadboard.fzp`.

The renderer finds the terminal strips and rails from the part file's buses. It names columns
from the numbers printed on the drawing and rows from `rows`, falling back to the printed
letters. Holes outside the numbered range, such as the two unnumbered columns on
`halfBreadboard`, get no name.

### Hole names

| Name | Hole |
|---|---|
| `B23` | row B, column 23 |
| `T+21` | top + rail, above column 21 |
| `T-21` | top − rail |
| `B+21`, `B-21` | bottom rails |

Rails skip some columns: every 6th on the half board. A missing rail hole is reported, with
advice to use a neighbouring column. Tags render rail holes as "top + rail" and so on.

## Figure

```js
bb.figure(hostElement, {
  old:  [ …parts from earlier steps ],   // grey, faded
  now:  [ …this step's part(s) ],        // full colour, holes circled and named
  view: { cols: [16, 30] },              // or "full", or [x, y, w, h] in pitches from column/row 1
  width: 860,                            // px
  tagHoles: true,                        // false: no automatic hole tags (overview pictures)
  notes: [{ at: { hole: "J1", dx: 0, dy: 2 }, text: "towards you", anchor: "start" }],
  alt: "…",
});
```

- The view grows to fit the `now` parts, and the whole picture when `"full"`.
- Returns `{ svg, warnings }`. Warnings also appear under the figure in a red box and in the
  console:
  - a hole used twice (rails excepted);
  - pins that don't match their holes;
  - unknown parts, connectors or holes.
- Page URL `#bb-only=N` shows figure N alone; `snap.mjs --only N` uses this.

## Parts from the bundle

```js
{ part: "res", bands: "10k", at: { connector0: "T+21", connector1: "A21" },
  label: "R2 10 K", labelAt: [-2.5, 0], tags: { "T+21": "up-left", A21: "left" } }
```

| Key | Meaning |
|---|---|
| `part` | bundle key |
| `at` | `{ connector: hole }`. Connector by id (`connector0`) or name as `fritzing.mjs show` prints it (`gate`, `cathode`, `+`, `wiper`) |
| `flip` | mirror the drawing across the line between the first and last mapped connectors (e.g. a TO-220 body pointing the other way) |
| `lift` | bendable-leg parts: move the body sideways, in pitches. Negative = up, or left when the holes are stacked vertically. Default: `-1.5` when the body is longer than the holes are apart, else `0` |
| `shift` | `[dx, dy]` extra body offset in pitches (bendable legs) |
| `rotate`, `offset` | when `at` names only one connector: rotation in degrees, and `[dx, dy]` body offset |
| `bands` | resistors: a value (`"4k7"`, `"10k"`, `"1M"`, `220`) or colour names, digits then multiplier (`["brown","black","orange"]`). Uses the part's 4- or 5-band drawing |
| `fill` | `{ svgElementId: colour }` recolour any element of the drawing |
| `text` | `{ "LM358": "LM393" }` replace printed text in the drawing |
| `label`, `labelAt` | name pill, and its offset in pitches from the part |
| `tags` | `{ hole: direction }`, replacing the automatic tags. Directions: `up down left right up-left up-right down-left down-right`, or `[dx, dy]` |

**Two kinds of parts.** `fritzing.mjs show` marks bendable legs.

- **Rigid parts** (no bendable legs): the drawing is rotated and moved so the first and last
  mapped pins sit in their holes. If the pin spacing doesn't match the hole spacing, that's
  reported. Pins you didn't map still claim whatever holes they land on.
- **Bendable-leg parts** (resistors, diodes, capacitors, TO-92, the basic FET): the body sits
  centred between the holes, oriented along them, and legs are drawn from the body to each
  hole. Legs can bend back when the holes are closer together than the body is long.

### Off the board, on wires

```js
{ part: "pot", near: { hole: "T+23", dx: 0, dy: -2 }, anchor: "leg1", rotate: 0,
  wires: { leg1:  { to: "T+22", color: "red" },
           wiper: { to: "B23", color: "purple", route: [0, 2.2, 1.2, 0] } },
  label: "VR2", tags: { B23: "left" } }
```

The `anchor` connector (default: the first) is placed at `near`. Each wire starts at its
connector.

## Generated parts

```js
{ part: "@wire", from: "D22", to: "B26", color: "green", route: [0.8, 1, -0.8, 1] }
{ part: "@wire", from: "A5", to: { hole: "A5", dx: -4, dy: -6 }, color: "red" }  // lead leaving the picture
{ part: "@dip", pins: 8, pin1: "F20", text: "LM393", numbers: true, width: 300 }
```

- **`@wire`**
  - `from` / `to`: a hole, `{hole, dx, dy}`, or `[x, y]`.
  - `bow`: a single curve, in pitches sideways.
  - `route`: `[dx1, dy1, dx2, dy2]`, the curve's pull away from each end, in pitches.
  - Colours: `red black blue green orange yellow white purple grey brown`, or any CSS colour.
- **`@dip`**: a chip straddling the centre channel.
  - Pin 1 is at `pin1`, bottom left, and pins count anticlockwise, so the notch is on the left.
  - `width: 600` for wide chips.
  - `numbers: true` prints pin numbers.

## Helpers

- `BB.credit()`: the attribution sentence, built from the bundle.
- `BB.resistorBands("4k7")` → `["yellow", "violet", "red"]`.
