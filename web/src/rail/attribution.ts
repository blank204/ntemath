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

/**
 * Every 3D model the site ships.
 *
 * ALL FOUR ARE CC-BY, WHICH IS A STANDING OBLIGATION, NOT A ONE-OFF. Stripping
 * the textures (tools/model/strip_gltf.py) and relighting the meshes under this
 * site's own environment does not relicense anything — the geometry is the
 * licensed work and the credit travels with it.
 *
 * WHAT IS AND IS NOT MODELLED FROM SOMEONE ELSE'S WORK. The rule
 * docs/image-manifest.md sets for photographs — "never captioned as
 * LightningWatch hardware" — applies here too, so the split is deliberate:
 *
 *   - Off-the-shelf parts get real models, because a solar panel is a solar
 *     panel and the BOM specifies commodity hardware. Nothing is claimed by
 *     showing one.
 *   - Mounting structures get real models, because they are explicitly NOT
 *     ours: the system attaches to trees, transmission towers and poles that
 *     are already standing.
 *   - The sensor head — the fisheye pair and the microphone ring — stays
 *     procedural, built here. That part is the actual invention, and dressing
 *     a stranger's CCTV camera up as it is the one move this project has
 *     always refused.
 */
export const MODEL_CREDITS: ImageCredit[] = [
  {
    file: 'models/solar.gltf',
    title: 'Solar Panel',
    author: 'rivetech (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/solar-panel-83483a66f8974d7e8f2e7bbde518d606',
    note:
      'The solar subsystem. Commodity hardware — the BOM calls for a 100 W ' +
      'panel and this is a 100 W panel. Textures stripped; lit by this ' +
      'page\'s own environment so it belongs to the same world as everything ' +
      'around it.',
  },
  {
    file: 'models/antenna.gltf',
    title: 'CC0 - Antenna',
    author: 'plaggy (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/cc0-antenna-6bc0ff4565db46ab8f7d229a5d272c12',
    note:
      'The satellite uplink. Titled "CC0" by its author but published under ' +
      'CC Attribution, so it is credited as CC BY — the licence field on the ' +
      'model is what binds, not the name someone typed.',
  },
  {
    file: 'models/pine.gltf',
    title: 'Pine Tree — Proto Series',
    author: 'BitGem (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/pine-tree-proto-series-free-08014e92a59244c992884091218230b8',
    note:
      'Boreal forest, and one of the mounting structures the system is ' +
      'designed to attach to. Not LightningWatch hardware and never captioned '
      + 'as any: ' +
      'the trees were already there, which is the point. This is the second ' +
      'model tried — the first was titled "Pine Tree" and turned out to be a ' +
      'whole forest scene with its own terrain plane, which is the ' +
      'image-manifest rule about titles lying, holding just as well in 3D.',
  },
  {
    file: 'models/pylon.gltf',
    title: 'Transmission tower',
    author: 'Kaqui (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/transmission-tower-f1bab970dbb541ae87116217470c1cb3',
    note:
      'An existing transmission tower — the second mounting option, and the ' +
      'reason the hardware cost can be $960 a unit rather than the price of ' +
      'a mast. Somebody else\'s steel, deliberately.',
  },
  {
    file: 'models/camera.gltf',
    title: 'Surveillance Cam',
    author: 'Marcel Schanz (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/surveillance-cam-3d7f98993ee340179af212e465dd8b4e',
    note:
      'The camera head. The BOM specifies an off-the-shelf Arducam fisheye in ' +
      'a weatherproof housing, so a real camera housing is representative ' +
      'rather than a claim: the invention is the system, not the enclosure.',
  },
  {
    file: 'models/cabinet.gltf',
    title: 'Old Soviet Electrical Junction Box',
    author: 'uliana (Sketchfab)',
    licence: 'CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/old-soviet-electrical-junction-box-fe37bff7b3fa45a7960b7defa30b3f3e',
    note:
      'The weatherproof cabinet carrying the compute and the battery. An ' +
      'outdoor junction box is exactly the class of enclosure this needs, and ' +
      'nothing about it is particular to LightningWatch.',
  },
]

/** The same list as one line per asset, for the end matter. */
export const creditLine = (c: ImageCredit): string =>
  `${c.title} · ${c.author} · ${c.licence}`
