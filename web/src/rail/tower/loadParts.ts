import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The downloaded parts, loaded and dressed in this site's own materials.
 *
 * These are CC-BY meshes from Sketchfab with their textures stripped by
 * tools/model/strip_gltf.py. They arrive as geometry and nothing else, which
 * is deliberate: five authors means five different bakes, and dropped in
 * unaltered they read as clippings pasted together rather than as one machine
 * standing in one storm. Everything here gets the same environment map, the
 * same key and rim, and a material out of the same palette as the mast.
 *
 * The credits are in `src/rail/attribution.ts` and a test fails the build if a
 * file in `public/models` has no entry — the licence obligation survives the
 * stripping, because the geometry is the licensed work.
 */

export type PartName = 'solar' | 'antenna' | 'pine' | 'pylon'

/**
 * Everything a part needs to arrive at the right size and the right way up.
 *
 * `targetHeight` is in metres and is the whole reason this table exists: the
 * four models were authored at four unrelated scales (one arrives 0.6 units
 * tall, one nearly 40), so nothing can simply be added to a scene built around
 * a 30 m mast. Each one is measured after load and scaled to a real dimension.
 */
const FIT: Record<PartName, { targetHeight: number; spinY?: number }> = {
  // A 100 W panel is roughly a metre on its long edge.
  solar: { targetHeight: 1.05 },
  // The satellite uplink: a compact patch antenna, not a dish.
  antenna: { targetHeight: 1.2 },
  // Boreal spruce around the base. Real ones here run 12-20 m.
  pine: { targetHeight: 15 },
  // An existing transmission tower, taller than our mast by design.
  pylon: { targetHeight: 42 },
}

const loader = new GLTFLoader()

/** Load one part, normalised to sit on the ground at a known height. */
export async function loadPart(
  name: PartName, material: THREE.Material,
): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(`models/${name}.gltf`)
  const root = gltf.scene

  // One material for the whole part. The stripped files keep their material
  // slots so they COULD be addressed individually, but a part is one object
  // here and splitting it would only reintroduce the mixed look.
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.material = material
    m.castShadow = true
    m.receiveShadow = true
  })

  // Measure, then scale to the real dimension. Done from the bounding box
  // rather than trusted from the file: glTF carries no unit convention, and
  // every one of these was authored to a different one.
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  const tallest = Math.max(size.y, 1e-6)
  const fit = FIT[name]
  root.scale.setScalar(fit.targetHeight / tallest)

  // Re-measure after scaling and drop the part so its base sits on y = 0.
  const scaled = new THREE.Box3().setFromObject(root)
  root.position.y -= scaled.min.y
  if (fit.spinY) root.rotation.y = fit.spinY

  const wrap = new THREE.Group()
  wrap.add(root)
  wrap.name = name
  return wrap
}

/**
 * Load several parts at once, tolerating any that fail.
 *
 * A missing or malformed model must not take the whole scene down with it: the
 * mast is procedural and stands on its own, so a part that will not load is a
 * part that is simply absent. Returns only what arrived.
 */
export async function loadParts(
  wanted: Array<{ name: PartName; material: THREE.Material }>,
): Promise<Partial<Record<PartName, THREE.Group>>> {
  const settled = await Promise.allSettled(
    wanted.map((w) => loadPart(w.name, w.material)))
  const out: Partial<Record<PartName, THREE.Group>> = {}
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') out[wanted[i].name] = r.value
  })
  return out
}
