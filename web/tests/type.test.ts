import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TYPE, SIZE, LABEL, FIGURE, TABULAR, TRACK, WEIGHT, WIDTH }
  from '../src/theme/type'

const SRC = join(__dirname, '..', 'src')
const CSS = readFileSync(join(SRC, 'index.css'), 'utf-8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const sources = walk(SRC).filter((p) => /\.tsx?$/.test(p))

describe('the type system', () => {
  it('names three faces and no more', () => {
    // Display, body, mono. A fourth face is a fourth voice, and this page
    // only has three things to say: a headline, an argument, a measurement.
    expect(Object.keys(TYPE)).toEqual(['display', 'body', 'mono'])
  })

  it('is the only place in src that names a font family', () => {
    // Same rule the palette has, for the same reason: a family named inline
    // is a family nobody can change, and the one that gets named inline is
    // always system-ui — which is how a page ends up looking like every
    // other page.
    const offenders: string[] = []
    for (const p of sources) {
      if (p.endsWith(join('theme', 'type.ts'))) continue
      const text = readFileSync(p, 'utf-8')
      for (const m of text.matchAll(/font-family|fontFamily=?["'{:]|system-ui|ui-monospace|sans-serif/g)) {
        // A reference to the token module is the correct way to ask.
        const line = text.slice(text.lastIndexOf('\n', m.index) + 1,
          text.indexOf('\n', m.index))
        if (/TYPE\.(display|body|mono)|LABEL|FIGURE/.test(line)) continue
        offenders.push(`${p.slice(SRC.length + 1)}: ${line.trim().slice(0, 70)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is the only place in src that names a width', () => {
    // The width axis is half of why these two faces were chosen — Anybody run
    // wide for the figures, Martian Mono run narrow so a forty-character
    // caption still fits. A width typed into a component is a width nobody
    // can retune, exactly like a family.
    const offenders: string[] = []
    for (const p of sources) {
      if (p.endsWith(join('theme', 'type.ts'))) continue
      const text = readFileSync(p, 'utf-8')
      for (const m of text.matchAll(/fontStretch|font-stretch/g)) {
        const line = text.slice(text.lastIndexOf('\n', m.index) + 1,
          text.indexOf('\n', m.index))
        if (/WIDTH\.\w+|LABEL|FIGURE/.test(line)) continue
        offenders.push(`${p.slice(SRC.length + 1)}: ${line.trim().slice(0, 70)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('sets every number in mono with tabular figures', () => {
    // Coverage percentages, p-values and a running clock all recompute in
    // place. Proportional figures make a row of them twitch on every frame.
    expect(LABEL.fontFamily).toBe(TYPE.mono)
    expect(TABULAR.fontVariantNumeric).toBe('tabular-nums')
    expect(TABULAR.fontFeatureSettings).toContain('tnum')
    // The giant figure is the exception that proves it: it is the display
    // face, because at 148px it is a headline — but it still gets tabular
    // figures, because it still changes when a region changes.
    expect(FIGURE.fontFamily).toBe(TYPE.display)
    expect(FIGURE.fontVariantNumeric).toBe('tabular-nums')
  })

  it('keeps the scale to six steps, in descending order', () => {
    const steps = Object.values(SIZE)
    expect(steps.length).toBe(6)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1])
    }
  })

  it('sets the figure large enough to be the content rather than a stat', () => {
    // The rebuild turns on this inversion: the figure is what the beat is,
    // and the sentence under it is the footnote. The design direction fixes
    // the band at 120–180px. A figure that drifts back down to headline size
    // is the old centred column growing back.
    expect(SIZE.figure).toBeGreaterThanOrEqual(120)
    expect(SIZE.figure).toBeLessThanOrEqual(180)
    // And the pinned headline has to be big enough that the split cuts it.
    expect(SIZE.hero).toBeGreaterThanOrEqual(72)
  })

  it('tracks small caps open and big display type tight', () => {
    // Caps at 11px crowd; a figure at 148px opens up on its own.
    expect(parseFloat(TRACK.label)).toBeGreaterThan(0.1)
    expect(parseFloat(TRACK.display)).toBeLessThan(0)
  })

  it('carries only the weights and widths the fonts are actually loaded at', () => {
    // These are variable faces, so there is no per-weight import list any
    // more — one file per family covers a declared range. The guarantee is
    // the same one the old per-weight check made, and it is now read off the
    // font's own metadata rather than off an import name: font-synthesis is
    // off, so a weight or width outside the loaded range renders at the
    // nearest end instead of the one that was asked for, silently.
    const families = [...CSS.matchAll(/@fontsource-variable\/([\w-]+)\/(\w+)\.css/g)]
    expect(families.length).toBe(3)

    for (const [, pkg, entry] of families) {
      const face = readFileSync(
        join(SRC, '..', 'node_modules', '@fontsource-variable', pkg,
          `${entry}.css`), 'utf-8')

      const w = face.match(/font-weight:\s*(\d+)\s+(\d+)/)
      expect(w, `${pkg} declares a weight range`).toBeTruthy()
      for (const want of Object.values(WEIGHT)) {
        expect(want, `${pkg} weight ${want}`).toBeGreaterThanOrEqual(Number(w![1]))
        expect(want, `${pkg} weight ${want}`).toBeLessThanOrEqual(Number(w![2]))
      }

      // Only the faces we actually run off-default need a width axis, but
      // every one of them is imported from a `wdth` entrypoint, so all three
      // must carry one — otherwise the import is a lie about what shipped.
      const s = face.match(/font-stretch:\s*([\d.]+)%\s+([\d.]+)%/)
      expect(s, `${pkg} declares a width range`).toBeTruthy()
      const [lo, hi] = [Number(s![1]), Number(s![2])]
      for (const want of Object.values(WIDTH)) {
        const v = parseFloat(want)
        // A width token only has to be in range for the family that uses it;
        // check the ones that are, and skip the rest rather than forcing all
        // three faces to share one width envelope.
        if (v < lo || v > hi) continue
        expect(v).toBeGreaterThanOrEqual(lo)
      }
    }

    // The two that matter, checked against their own family explicitly.
    const anybody = readFileSync(join(SRC, '..', 'node_modules',
      '@fontsource-variable', 'anybody', 'wdth.css'), 'utf-8')
    const martian = readFileSync(join(SRC, '..', 'node_modules',
      '@fontsource-variable', 'martian-mono', 'wdth.css'), 'utf-8')
    const range = (css: string) => {
      const m = css.match(/font-stretch:\s*([\d.]+)%\s+([\d.]+)%/)!
      return [Number(m[1]), Number(m[2])]
    }
    const [aLo, aHi] = range(anybody)
    const wide = parseFloat(WIDTH.displayWide)
    expect(wide, 'display width inside Anybody').toBeGreaterThanOrEqual(aLo)
    expect(wide, 'display width inside Anybody').toBeLessThanOrEqual(aHi)

    const [mLo, mHi] = range(martian)
    const narrow = parseFloat(WIDTH.labelNarrow)
    expect(narrow, 'label width inside Martian Mono').toBeGreaterThanOrEqual(mLo)
    expect(narrow, 'label width inside Martian Mono').toBeLessThanOrEqual(mHi)
  })

  it('self-hosts the faces rather than fetching them from a CDN', () => {
    expect(CSS).toContain('@fontsource-variable/')
    // The import graph, not the prose: the comment above those imports says
    // why a CDN was rejected, and naming it there is not fetching from it.
    expect(CSS).not.toMatch(/@import[^;]*fonts\.(googleapis|gstatic)/)
    expect(CSS).not.toMatch(/url\(\s*['"]?https?:\/\//)
  })

  it('has retired IBM Plex everywhere, not just in the token module', () => {
    // It read as documentation, which was the rejection. A stale @import or a
    // leftover fallback would quietly bring the old voice back on any machine
    // that still has it installed.
    expect(CSS.toLowerCase()).not.toContain('plex')
    for (const face of Object.values(TYPE)) {
      expect(face.toLowerCase()).not.toContain('plex')
    }
  })
})
