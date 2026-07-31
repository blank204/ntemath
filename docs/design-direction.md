# Design direction — from the references

Written 2026-07-31 after Aarav rejected the first visual pass: "I don't like the
fonts or neon colours, the text and graphics way too centered, too much text,
and I don't WANT to look at it." References given: **str8fire.io** and
**flowdrinks.webflow.io**, both walked end to end.

This supersedes the visual half of `2026-07-31-pyra-website-design.md`. The
model, the data, the honesty rules and the test culture are untouched.

---

## 1. What the references actually do

### FlowDrinks — one composition, four worlds

- **The object is the page.** A can, centre frame, tilted ~20°, at roughly 60%
  of viewport height, **in front of** a two-line headline set two to three
  times larger than the object is wide. The type is occluded by the object and
  cropped by the frame. It is never fully readable in one glance and that is
  the point.
- **The colour world changes completely per section** — blue/purple → red →
  yellow with blue type. Background is a full-bleed illustrated pattern, not a
  flat fill. **Light worlds as well as dark.** No black voids anywhere.
- **Scroll drives a transition, not a jump**: a radial wipe opens the next
  world from centre while the outgoing can flies out bottom-left with rotation
  and the incoming one rotates in from the right.
- Chrome is tiny and persistent: wordmark top-left, section list bottom-left
  (active bold, rest at ~35% opacity), 3-line caption bottom-centre, CTA
  bottom-right. It never moves; only its colour flips per world.
- Body copy on screen at any moment: **about 20 words.**

### STR8FIRE — pinned scene, scrolling instrument column

- **Split screen.** Left half is a pinned cinematic scene; right half scrolls.
  The split is a hard vertical edge, not a gutter.
- Left: a photographic/3D interior, colour-graded to one hue, with a **giant
  headline cropped mid-word** by the split (`TOKENIZIN` / `ENTE`) and a 3D
  object that progresses through states as you scroll — cartridge, then
  console, then a coin dropping in, rotating the whole time.
- Right: hairline-ruled rows. Each row is `/ EYEBROW` · `01` · **an enormous
  figure** (`$3TN`, `R00`, `D101`) · three lines of small mono caps. The figure
  is the content; the sentence is the footnote.
- Chrome: `≡ MENU` pill top-centre, wordmark top-left, community bar
  bottom-centre, `SCROLL DOWN ↓` and a four-bar progress meter bottom-right,
  `+` crop marks at grid corners.
- Later sections drop to a **blueprint grid**: hairlines, `(19)` in brackets,
  `+` marks, one bordered button. Technical-drawing chrome, not decoration.
- Everything is uppercase mono at 11–13px except the giant figures.

### The two things they share

1. **One object carries the page.** Text supports it. Never the reverse.
2. **Type is treated as material** — cropped, occluded, oversized — not as a
   paragraph in a column.

---

## 2. What Pyra does wrong against that

| | Reference | Pyra now |
|---|---|---|
| Hero | object at 60% viewport, type 3× larger behind it | 46px headline, 3D tower at ~25% of a half-column |
| Background | full-bleed colour world, edge to edge | near-black void with 60% empty space |
| Type | cropped, occluded, oversized | inside the margins, never touching an edge |
| Words per screen | ~20 | ~90 (body + source note) |
| Layout | asymmetric split or centred object with bleeding type | one centred 58ch column, everything symmetrical |
| Colour | immersive world per section | one dark surface + teal line work → reads as neon-on-black |

---

## 3. The direction

**Storm blue, full-bleed** (Aarav's pick). The subject is a night storm over
James Bay, so the page is that: an immersive deep indigo/slate field, edge to
edge, lit from within. Lightning-white type. **Ember orange appears once or
twice per screen and never as line work** — it is the fire, and spending it on
UI chrome is what made the old page read as neon.

Structure: **STR8FIRE's split, FlowDrinks' object.**

- **Left half, pinned:** the tower, full height, **cropped by the top and bottom
  of the frame**, drifting and exploding as the reader scrolls. Behind it, the
  beat headline set large enough to be cut in half by the split — `MOST OF WHAT
  BURNS WAS NEVER LIT BY A` and the rest disappears past the edge.
- **Right half, scrolling:** the measurement column. Per beat: `/ EYEBROW`,
  the beat number, **the figure at 120–180px** (`81–93%`, `>40 ms`, `1.91×`,
  `54.6%`), then **three lines maximum** of small mono caps. Sources move to
  end matter — they stay on the page, they stop competing for the eye.
- Chrome: wordmark top-left, beat list bottom-left with the active one lit,
  progress meter and `SCROLL ↓` bottom-right, `+` crop marks at the corners.
- The Lab keeps its panels but inherits the field and the type; the map goes
  full-bleed behind them rather than sitting in a letterbox.

**The one risk worth taking:** the colour world shifts across the seven beats —
cold indigo at the strike, warming through the middle, ember at the ignition
beat, back to cold blue for the Lab. It is the same move FlowDrinks makes per
flavour, and here it tracks something true: the page heats up as the fire gets
closer, then cools when it becomes a measurement problem.

**Type:** IBM Plex is out — it reads as documentation, which is exactly the
"too much text" problem. The references both use a wide techno grotesque for
figures and a mono for labels. Target: a condensed/wide display grotesque with
slashed zeros for the giant figures, and one mono for labels. Keep the token
module and its test; change the faces inside it.

**Words:** every beat gets one headline, one figure, and three lines. The
current bodies are 60–90 words and must come down to under 25. The research and
the sourcing do not disappear — they move to an end-matter section and the
`/assumptions` page, where a judge who wants them will look.

---

## 4. What is needed from Aarav

- **Imagery.** Both references lean on art direction that cannot be generated
  from data: FlowDrinks has illustrated fruit patterns, STR8FIRE a rendered
  interior. Pyra can build its field from the data (the lightning density
  raster and the risk field are both textures) but a photographic layer —
  boreal forest at night, a storm front, the James Bay coast — would raise the
  ceiling a long way. Licensed stock or team photography both work.
- Confirmation that **breaking the palette is accepted**, which also retires
  `docs/palette-validation.md`'s waiver: the new pair needs its own CVD
  validation run before it ships.

---

## 5. Checklist for the rebuild

- [ ] New palette module: storm-blue field, lightning white, ember accent, and
      a per-beat world ramp. Re-run the CVD validator; rewrite the waiver doc.
- [ ] New type tokens: display grotesque for figures, mono for labels. Keep the
      "nothing outside type.ts names a family" test.
- [ ] Rail becomes a pinned split: `RailStage` (left, pinned) and
      `RailColumn` (right, scrolling).
- [ ] Tower at full frame height, cropped top and bottom, scroll-driven
      explode retained.
- [ ] Beat copy cut to one headline + one figure + ≤25 words. Sources to end
      matter. `beats.test.ts` gains a word-count ceiling per beat.
- [ ] Full-bleed field behind everything; no letterboxing, no centred column.
- [ ] Lab inherits the field; map goes full-bleed behind the panels.
- [ ] Re-run the palette and type tests, then walk it in a browser at 1440 and
      at 390 wide.
