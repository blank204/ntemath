import type { Field } from './types'
import { RefRNG } from './refrng'
import { radiusAt, allowedAt } from './field'

/**
 * Bridson's Poisson-disk sampling with the minimum spacing made a function of
 * position: r(x) = r_max - (r_max - r_min) * risk(x). Port of
 * place.variable_poisson_disk — see that module's docstring for why blue noise
 * is the right family and why the acceptance test uses max(r(p), r(q)).
 *
 * Returns a flat [x0,y0,x1,y1,...] array of km coordinates.
 *
 * `seedFlatIndex`, when supplied, skips the argsort scan and seeds directly
 * at that flat risk-grid index (still subject to the mask check; if that
 * pixel isn't allowed, the whole call returns empty rather than falling
 * back to a scan). Real risk fields routinely have huge plateaus of
 * bit-identical maximum risk -- e.g. whenever a region has no recent FIRMS
 * detections, the hazard model's activity term goes to zero and every
 * burnable pixel ties at risk == 1.0 -- so which tied pixel numpy's
 * unstable `argsort(...)[::-1]` happens to land on in place.py is an
 * implementation detail of quicksort's partitioning, not a total order a
 * second sort implementation can be expected to reproduce. Callers that
 * need byte-identical parity with a specific Python run should resolve the
 * seed index there (see tools/bake/export_fixtures.py's
 * `_resolve_seed_flat_index`) and pass it in explicitly. Omitting it keeps
 * the total-order `(-risk, flatIndex)` scan below as a documented,
 * self-consistent fallback -- deterministic within this port, but not
 * guaranteed to agree with a given `place.py` run when ties exist.
 */
export function variablePoissonDisk(
  rng: RefRNG,
  risk: Field,
  widthKm: number,
  heightKm: number,
  rMinKm: number,
  rMaxKm: number,
  mask: Field | null = null,
  k = 24,
  maxPoints = 200_000,
  seedFlatIndex?: number,
): Float64Array {
  if (rMinKm <= 0 || rMaxKm < rMinKm) {
    throw new Error('need 0 < rMinKm <= rMaxKm')
  }

  // Clip and de-NaN, as np.clip(np.nan_to_num(risk)) does.
  const r = new Float32Array(risk.data.length)
  for (let i = 0; i < r.length; i++) {
    const v = risk.data[i]
    r[i] = Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0
  }
  const riskC: Field = { nx: risk.nx, ny: risk.ny, data: r }

  const rad = (x: number, y: number) =>
    radiusAt(riskC, x, y, widthKm, heightKm, rMinKm, rMaxKm)
  const ok = (x: number, y: number) => allowedAt(mask, x, y, widthKm, heightKm)

  // Grid sized on the smallest radius so the neighbour test is never wrong;
  // the search window then has to span the largest.
  const cell = rMinKm / Math.SQRT2
  const gw = Math.max(1, Math.ceil(widthKm / cell))
  const gh = Math.max(1, Math.ceil(heightKm / cell))
  const grid = new Int32Array(gw * gh).fill(-1)
  const reach = Math.ceil(rMaxKm / cell) + 1

  const px = new Float64Array(maxPoints)
  const py = new Float64Array(maxPoints)
  const pr = new Float64Array(maxPoints)
  let n = 0

  const insert = (x: number, y: number, rr: number): number => {
    px[n] = x; py[n] = y; pr[n] = rr
    const gi = Math.min(Math.trunc(x / cell), gw - 1)
    const gj = Math.min(Math.trunc(y / cell), gh - 1)
    grid[gj * gw + gi] = n
    return n++
  }

  // Seed on the highest-risk allowed pixel so growth starts where it matters.
  let seeded = false

  const trySeedAt = (flat: number): boolean => {
    const jj = Math.floor(flat / riskC.nx)
    const ii = flat % riskC.nx
    const x = ((ii + 0.5) / riskC.nx) * widthKm
    const y = ((jj + 0.5) / riskC.ny) * heightKm
    if (ok(x, y)) { insert(x, y, rad(x, y)); return true }
    return false
  }

  if (seedFlatIndex !== undefined) {
    // Explicit seed: skip the scan (and its O(n log n) sort) entirely. Still
    // subject to the mask check; an unallowed seed pixel means no points.
    seeded = trySeedAt(seedFlatIndex)
  } else {
    // Fallback: total order on (-risk, flatIndex), so this scan is at least
    // self-consistent — see the seedFlatIndex doc comment above for why this
    // won't always agree with a given place.py run when ties exist.
    const order = Array.from({ length: r.length }, (_, i) => i)
    order.sort((a, b) => (r[b] - r[a]) || (a - b))
    const scan = Math.max(1, Math.floor(r.length / 4))
    for (let t = 0; t < scan; t++) {
      if (trySeedAt(order[t])) { seeded = true; break }
    }
  }
  if (!seeded) return new Float64Array(0)

  const active: number[] = [0]
  while (active.length > 0 && n < maxPoints) {
    const a = rng.integers(active.length)
    const idx = active[a]
    const bx = px[idx], by = py[idx], rb = pr[idx]

    // Order matters: all k angles are drawn before all k radii.
    const ang = rng.randomArray(k)
    const rnd = rng.randomArray(k)

    let placed = false
    for (let c = 0; c < k; c++) {
      const rr = rb * Math.sqrt(1 + 3 * rnd[c])
      const cx = bx + rr * Math.cos(ang[c] * 2 * Math.PI)
      const cy = by + rr * Math.sin(ang[c] * 2 * Math.PI)

      if (cx < 0 || cx >= widthKm || cy < 0 || cy >= heightKm) continue
      if (!ok(cx, cy)) continue

      const cr = rad(cx, cy)
      const gi = Math.min(Math.trunc(cx / cell), gw - 1)
      const gj = Math.min(Math.trunc(cy / cell), gh - 1)

      let blocked = false
      for (let dj = -reach; dj <= reach && !blocked; dj++) {
        const jj = Math.min(Math.max(gj + dj, 0), gh - 1)
        for (let di = -reach; di <= reach; di++) {
          const ii = Math.min(Math.max(gi + di, 0), gw - 1)
          const q = grid[jj * gw + ii]
          if (q < 0) continue
          const d = Math.hypot(px[q] - cx, py[q] - cy)
          // The larger of the two radii governs — see place.py's docstring.
          if (d < Math.max(pr[q], cr)) { blocked = true; break }
        }
      }
      if (blocked) continue

      active.push(insert(cx, cy, cr))
      placed = true
      break
    }

    if (!placed) active.splice(a, 1)
  }

  const out = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) { out[2 * i] = px[i]; out[2 * i + 1] = py[i] }
  return out
}
