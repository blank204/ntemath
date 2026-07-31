import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TYPE, SIZE, LABEL, TABULAR, TRACK, WEIGHT } from '../src/theme/type'

const SRC = join(__dirname, '..', 'src')

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
        if (/TYPE\.(display|body|mono)|LABEL/.test(line)) continue
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
  })

  it('keeps the scale to six steps, in descending order', () => {
    const steps = Object.values(SIZE)
    expect(steps.length).toBe(6)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1])
    }
  })

  it('tracks small caps open and condensed headlines tight', () => {
    // Caps at 11px crowd; a condensed display face at 30px does not.
    expect(parseFloat(TRACK.label)).toBeGreaterThan(0.1)
    expect(parseFloat(TRACK.display)).toBeLessThan(0)
  })

  it('carries only the weights the fonts are loaded at', () => {
    // src/index.css imports 600 condensed, 400/500 sans, 400/500 mono. A
    // weight named here but not loaded is a weight the browser fakes, and
    // font-synthesis is off — so it would silently render at the wrong one.
    const css = readFileSync(join(SRC, 'index.css'), 'utf-8')
    for (const w of Object.values(WEIGHT)) {
      expect(css, `weight ${w}`).toContain(`/${w}.css`)
    }
  })

  it('self-hosts the faces rather than fetching them from a CDN', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf-8')
    expect(css).toContain('@fontsource/')
    // The import graph, not the prose: the comment above those imports says
    // why a CDN was rejected, and naming it there is not fetching from it.
    expect(css).not.toMatch(/@import[^;]*fonts\.(googleapis|gstatic)/)
    expect(css).not.toMatch(/url\(\s*['"]?https?:\/\//)
  })
})
