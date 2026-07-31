export interface RegionEntry {
  key: string
  label: string
  country: string
  regime: string
}

/**
 * The eight regions `plan.py:REGIONS` defines, in its order.
 *
 * All eight are shown even though one is baked. The picker is what makes the
 * "same code path runs anywhere on Earth" claim checkable — hiding the seven
 * would turn a global model into a single demo, and offering them without
 * saying they are unbaked would fail with a 404 in front of a judge.
 */
export const REGIONS: RegionEntry[] = [
  { key: 'los-padres', label: 'Los Padres', country: 'California, USA', regime: 'chaparral' },
  { key: 'amazon-rondonia', label: 'Rondônia', country: 'Brazil', regime: 'tropical moist' },
  { key: 'siberia-baikal', label: 'Baikal', country: 'Russia', regime: 'boreal larch' },
  { key: 'portugal-centro', label: 'Centro', country: 'Portugal', regime: 'Mediterranean pine' },
  { key: 'victoria-alpine', label: 'Victorian Alps', country: 'Australia', regime: 'eucalypt' },
  { key: 'congo-basin', label: 'Congo Basin', country: 'DR Congo', regime: 'tropical moist' },
  { key: 'sweden-norrland', label: 'Norrland', country: 'Sweden', regime: 'boreal spruce' },
  { key: 'greece-peloponnese', label: 'Peloponnese', country: 'Greece', regime: 'Mediterranean' },
]

/** Every region, flagged with whether the manifest says its data exists. */
export function regionOptions(baked: string[]): Array<RegionEntry & { baked: boolean }> {
  const set = new Set(baked)
  return REGIONS.map((r) => ({ ...r, baked: set.has(r.key) }))
}
