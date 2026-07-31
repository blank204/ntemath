/**
 * The tower, as numbers.
 *
 * Everything about the geometry that can be decided without a GPU is decided
 * here: what the parts are, where they sit on the mast, and how far each one
 * travels when the assembly opens. The renderer turns this into meshes and
 * does nothing else, so the shape of the thing is testable — which a WebGL
 * scene, in a node test runner, is not.
 *
 * BUILT FROM PRIMITIVES, DELIBERATELY. No CC0 model of a tower like this
 * exists (searched: the only CC0 results for tower/mast/antenna queries are
 * unrelated scans of 185k+ triangles), and the CC-BY comms towers that do
 * exist are single welded meshes — they cannot come apart into the five
 * subsystems this page names, which is the entire point of the beat.
 * Generating the lattice procedurally also costs nothing to ship and lets the
 * explode be exact.
 */

/** Metres. A real lookout mast, not a broadcast tower. */
export const MAST_HEIGHT_M = 30
export const MAST_WIDTH_M = 3.4

export interface TowerPart {
  id: string
  label: string
  /** A word that must appear in the beat's copy, so the two cannot drift. */
  keyword: string
  /** Height of the part's centre above ground, metres. */
  y: number
  height: number
  /** Half-width, metres — the parts are wider than the mast they sit on. */
  radius: number
  /** What it does, shown as a caption when the assembly is open. */
  note: string
}

/**
 * Top to bottom, which is also the order they are named in the copy.
 * Ordering is asserted rather than assumed: the test walks the list and
 * requires it to already be sorted downwards with no overlaps.
 */
export const TOWER_PARTS: TowerPart[] = [
  {
    id: 'camera', label: 'camera head', keyword: 'camera',
    y: 28.6, height: 1.6, radius: 1.1,
    note: 'sees the flash; the start of every measurement',
  },
  {
    id: 'mics', label: 'microphone array', keyword: 'microphone',
    y: 25.8, height: 1.4, radius: 2.6,
    note: 'three booms; bearing from time-difference-of-arrival',
  },
  {
    id: 'compute', label: 'compute', keyword: 'compute',
    y: 10.0, height: 1.8, radius: 1.0,
    note: 'scores the strike on the tower; only the answer leaves',
  },
  {
    id: 'solar', label: 'solar', keyword: 'solar',
    y: 7.0, height: 0.4, radius: 2.2,
    note: 'no grid this far north of the road',
  },
  {
    id: 'backhaul', label: 'backhaul', keyword: 'backhaul',
    y: 4.0, height: 1.2, radius: 1.4,
    note: 'a coordinate and a confidence, not a video feed',
  },
]

export function partAt(id: string): TowerPart {
  const p = TOWER_PARTS.find((x) => x.id === id)
  if (!p) throw new Error(`no tower part "${id}"`)
  return p
}

/** How far the outermost part travels when the assembly is fully open. */
export const EXPLODE_SPREAD_M = 9

/**
 * Where a part sits at explode progress `t`.
 *
 * Parts move away from the assembly's middle rather than all one way, so the
 * tower opens in place instead of walking off the top of the frame. The
 * travel is proportional to how far the part already is from that middle, so
 * neighbours separate evenly and the order never scrambles.
 */
export function explodedY(part: TowerPart, t: number): number {
  const ys = TOWER_PARTS.map((p) => p.y)
  const mid = (Math.max(...ys) + Math.min(...ys)) / 2
  const half = (Math.max(...ys) - Math.min(...ys)) / 2 || 1
  const clamped = Math.min(1, Math.max(0, t))
  return part.y + ((part.y - mid) / half) * EXPLODE_SPREAD_M * clamped
}

/** Height of each lattice cross-brace, metres. */
export function latticeRungs(step = 2.5): number[] {
  const out: number[] = []
  for (let y = 0; y <= MAST_HEIGHT_M - step; y += step) out.push(y)
  return out
}
