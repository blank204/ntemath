/**
 * Every image the site ships, and where it came from.
 *
 * This exists because `docs/image-manifest.md` says a photograph whose licence
 * nobody wrote down is a photograph that has to come off the page later. The
 * list is data rather than prose so a test can hold it to the files actually
 * in `public/img` — an image added without an entry here fails the suite, and
 * an entry left behind after its file is deleted fails it too.
 */

export interface ImageCredit {
  /** Path under `public/`, exactly as the CSS or the markup asks for it. */
  file: string
  title: string
  /** Who made it. For a public-domain instrument frame, the mission. */
  author: string
  licence: string
  /** Where it can be re-fetched or checked. */
  source: string
  /** What it actually shows — and what it must never be captioned as. */
  note: string
}

export const IMAGE_CREDITS: ImageCredit[] = [
  {
    file: 'img/james-bay-plate.jpg',
    title: 'James Bay, 12 August 2024 — MODIS Terra, true colour',
    author: 'NASA Worldview / GIBS (MODIS Terra, Corrected Reflectance)',
    licence: 'Public domain (NASA)',
    source:
      'https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot' +
      '&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326' +
      '&TIME=2024-08-12&BBOX=51.0,-80.8,53.2,-76.2&WIDTH=2400&HEIGHT=1149' +
      '&FORMAT=image/jpeg',
    note:
      'The demo region itself, at the exact bounding box the model runs on — ' +
      'not a stock photograph of somewhere that looks similar. Graded to a ' +
      'duotone by tools/img/grade_plate.py; the structure is the satellite\'s, ' +
      'the colour is ours. The bright streaks off the coast are river ' +
      'sediment, not smoke.',
  },
]

/** The same list as one line per image, for the end matter. */
export const creditLine = (c: ImageCredit): string =>
  `${c.title} · ${c.author} · ${c.licence}`
