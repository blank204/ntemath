import { decodeArrivals, type ArrivalSet } from './arrivals'

/**
 * Fetch a region's baked fire runs, or `null` if it has none.
 *
 * Seven of the eight regions will never have this file, because the fire
 * model is validated in California only. That is a designed state, not a
 * failure, so it is a value the caller can hold rather than an exception it
 * has to translate. A non-404 failure IS an error and is thrown — a broken
 * deploy must not render as "not available in this region".
 */
export async function loadFireData(
  region: string, fetchImpl: typeof fetch = fetch,
): Promise<ArrivalSet | null> {
  const base = `/data/${region}`
  const metaRes = await fetchImpl(`${base}/arrivals.json`)
  if (metaRes.status === 404) return null
  if (!metaRes.ok) {
    throw new Error(`GET ${base}/arrivals.json failed: ${metaRes.status}`)
  }
  const meta = await metaRes.json()

  const binRes = await fetchImpl(`${base}/arrivals.bin`)
  if (!binRes.ok) {
    throw new Error(`GET ${base}/arrivals.bin failed: ${binRes.status}`)
  }
  return decodeArrivals(meta, await binRes.arrayBuffer())
}
