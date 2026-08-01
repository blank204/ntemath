import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IMAGE_CREDITS, MODEL_CREDITS, creditLine } from '../src/rail/attribution'

const WEB = join(__dirname, '..')
const IMG = join(WEB, 'public', 'img')
const MODELS = join(WEB, 'public', 'models')

/** Every raster the site ships, relative to `public/`. */
const shipped = (): string[] => {
  if (!existsSync(IMG)) return []
  return readdirSync(IMG)
    .filter((f) => /\.(jpe?g|png|avif|webp)$/i.test(f))
    .map((f) => `img/${f}`)
}

/**
 * Every 3D model the site ships. The `.bin` twins are geometry buffers rather
 * than works in their own right, so the `.gltf` is what carries the credit.
 */
const shippedModels = (): string[] => {
  if (!existsSync(MODELS)) return []
  return readdirSync(MODELS)
    .filter((f) => /\.(gltf|glb)$/i.test(f))
    .map((f) => `models/${f}`)
}

/** A model plus the buffers it pulls in — what the reader actually downloads. */
const modelWeightKb = (file: string): number => {
  const stem = file.replace(/^models\//, '').replace(/\.\w+$/, '')
  return readdirSync(MODELS)
    .filter((f) => f === `${stem}.gltf` || f.startsWith(`${stem}.bin`)
      || f.startsWith(`${stem}_`))
    .reduce((n, f) => n + statSync(join(MODELS, f)).size, 0) / 1024
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

describe('3D model attribution', () => {
  it('credits every model the site ships', () => {
    // These are CC-BY meshes. Stripping their textures and relighting them
    // under this site's environment does not relicense anything — the
    // geometry is the licensed work and the credit travels with it.
    const credited = new Set(MODEL_CREDITS.map((c) => c.file))
    for (const file of shippedModels()) {
      expect(credited.has(file), `${file} ships with no credit`).toBe(true)
    }
  })

  it('credits no model that is not there', () => {
    const there = new Set(shippedModels())
    for (const c of MODEL_CREDITS) {
      expect(there.has(c.file), `${c.file} is credited but not shipped`).toBe(true)
    }
  })

  it('records a licence, an author and a re-fetchable source for each', () => {
    for (const c of MODEL_CREDITS) {
      expect(c.author, c.file).toMatch(/\S/)
      expect(c.licence, c.file).toMatch(/CC|public domain/i)
      expect(c.source, c.file).toMatch(/^https?:\/\//)
      expect(c.note.length, c.file).toBeGreaterThan(30)
    }
  })

  it('keeps the whole model set inside a sane download budget', () => {
    // Geometry only, because the textures were stripped. The Raspberry Pi
    // board that was also fetched came to 897 KB on its own for a part that
    // renders about 60 px tall, and was dropped rather than shipped — this
    // ceiling is what makes that kind of decision explicit rather than a
    // matter of whoever last added a file.
    // Raised from 500 KB once the mast itself became a licensed model rather
    // than procedural geometry: the mast is the hero object and 785 KB buys
    // real lattice proportions that the 289 KB alternative did not have (it
    // was 48:1 slender, which at 30 m leaves a 0.6 m tower carrying a solar
    // panel). These are fetched after first paint and block nothing, which is
    // what makes the trade affordable — it is NOT licence to keep adding.
    const total = shippedModels().reduce((n, f) => n + modelWeightKb(f), 0)
    expect(total, `models total ${total.toFixed(0)} KB`).toBeLessThan(1500)
    for (const f of shippedModels()) {
      expect(modelWeightKb(f), `${f}`).toBeLessThan(820)
    }
  })

  it('ships no texture alongside the models', () => {
    // tools/model/strip_gltf.py removes every image reference. A texture
    // reappearing in this directory means a model was added by hand without
    // going through it, and with it comes the mixed-bake look the stripping
    // exists to prevent.
    if (!existsSync(MODELS)) return
    for (const f of readdirSync(MODELS)) {
      expect(/\.(gltf|bin)$/i.test(f), `${f} is not geometry`).toBe(true)
    }
  })
})
