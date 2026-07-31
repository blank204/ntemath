import { describe, it, expect } from 'vitest'
import { loadFireData } from '../src/lib/loadFire'

describe('loadFireData', () => {
  it('returns null for a region with no fire bake, rather than throwing', async () => {
    const f = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(loadFireData('congo-basin', f)).resolves.toBeNull()
  })

  it('propagates a real server failure instead of hiding it as absence', async () => {
    // A 500 is not "this region has no fire model", it is a broken deploy,
    // and silently rendering "not available here" would hide it.
    const f = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    await expect(loadFireData('los-padres', f)).rejects.toThrow(/500/)
  })
})
