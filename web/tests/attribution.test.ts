import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IMAGE_CREDITS, creditLine } from '../src/rail/attribution'

const WEB = join(__dirname, '..')
const IMG = join(WEB, 'public', 'img')

/** Every raster the site ships, relative to `public/`. */
const shipped = (): string[] => {
  if (!existsSync(IMG)) return []
  return readdirSync(IMG)
    .filter((f) => /\.(jpe?g|png|avif|webp)$/i.test(f))
    .map((f) => `img/${f}`)
}

describe('image attribution', () => {
  it('credits every image the site ships', () => {
    // docs/image-manifest.md: "a photograph whose licence nobody wrote down is
    // a photograph that has to come off the page later". Dropping a file into
    // public/img is the easy half; this is the half that gets forgotten.
    //
    // Twins count as one credit: the WebP and the JPEG are the same picture,
    // so an entry for either covers both.
    const credited = new Set(
      IMAGE_CREDITS.map((c) => c.file.replace(/\.\w+$/, '')))
    for (const file of shipped()) {
      const stem = file.replace(/\.\w+$/, '')
      expect(credited.has(stem), `${file} ships with no credit`).toBe(true)
    }
  })

  it('credits nothing that is not there', () => {
    // A credit left behind after its file was deleted is a claim the page
    // cannot back up.
    const stems = new Set(shipped().map((f) => f.replace(/\.\w+$/, '')))
    for (const c of IMAGE_CREDITS) {
      expect(stems.has(c.file.replace(/\.\w+$/, '')),
        `${c.file} is credited but not shipped`).toBe(true)
    }
  })

  it('gives every credit a licence, an author and a re-fetchable source', () => {
    for (const c of IMAGE_CREDITS) {
      expect(c.licence.length, c.file).toBeGreaterThan(3)
      expect(c.author.length, c.file).toBeGreaterThan(3)
      expect(c.source, c.file).toMatch(/^https?:\/\//)
      // The note is where a caption gets fact-checked, so it is required too.
      expect(c.note.length, c.file).toBeGreaterThan(30)
      expect(creditLine(c)).toContain(c.licence)
    }
  })

  it('keeps every plate inside the page-weight budget', () => {
    // The manifest budgets under 400 KB per full-bleed plate: "a 6000 px
    // original must not ship", and the page must not be slower than the model
    // it runs.
    for (const file of shipped()) {
      const kb = statSync(join(WEB, 'public', file)).size / 1024
      expect(kb, `${file} is ${kb.toFixed(0)} KB`).toBeLessThan(400)
    }
  })

  it('references every shipped image from somewhere in src', () => {
    // An image nobody asks for is dead weight in the bundle and a credit
    // nobody can verify against anything on screen.
    const src = join(WEB, 'src')
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    const all = walk(src)
      .filter((p) => /\.(tsx?|css)$/.test(p))
      .map((p) => readFileSync(p, 'utf-8'))
      .join('\n')
    for (const file of shipped()) {
      expect(all, `${file} is never referenced`).toContain(file)
    }
  })
})
