import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useModelStore, spacingFor } from '../state/useModelStore'
import { PALETTE } from '../theme/palette'
import type { DoneMessage, ErrorMessage, RunMessage } from '../workers/place.worker'

const REGIONS = [
  'los-padres', 'amazon-rondonia', 'siberia-baikal', 'portugal-centro',
  'victoria-alpine', 'congo-basin', 'sweden-norrland', 'greece-peloponnese',
]

export function RunPanel() {
  const workerRef = useRef<Worker | null>(null)
  // Correlation id for the worker protocol. Incremented once per run and
  // echoed back on `done`/`error`; a response whose id no longer matches the
  // latest run is stale (a superseded run finishing late) and is ignored so
  // it cannot clobber a newer result — e.g. moving the detect-radius slider
  // twice quickly before the first run finishes.
  const runIdRef = useRef(0)
  const {
    regionName, region, params, result, running, error,
    setRegionName, setParam, setRunning, setResult, setError,
  } = useModelStore()

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  const run = () => {
    if (!region) return
    setRunning(true)
    setError(null)
    workerRef.current?.terminate()

    const runId = ++runIdRef.current
    const w = new Worker(
      new URL('../workers/place.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = w
    w.onmessage = (e: MessageEvent<DoneMessage | ErrorMessage>) => {
      if (e.data.runId !== runIdRef.current) return // stale response, ignore
      if (e.data.type === 'done') setResult(e.data.result)
      else setError(e.data.message)
      setRunning(false)
      w.terminate()
      if (workerRef.current === w) workerRef.current = null
    }
    w.postMessage({ type: 'run', runId, region, params } satisfies RunMessage)
  }

  const panel: CSSProperties = {
    position: 'absolute', top: 16, left: 16, width: 280, padding: 16,
    background: PALETTE.surface, color: PALETTE.ink,
    border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 8,
    font: '13px/1.5 system-ui, sans-serif', zIndex: 10,
  }

  return (
    <div style={panel}>
      <div style={{ color: PALETTE.brandOrange, fontWeight: 700, letterSpacing: 1 }}>
        PYRA
      </div>

      <label style={{ display: 'block', marginTop: 12 }}>
        Region
        <select
          value={regionName}
          onChange={(e) => setRegionName(e.target.value)}
          style={{ width: '100%', marginTop: 4 }}
        >
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {regionName !== 'los-padres' && (
        <p style={{ color: PALETTE.baselineGray, marginTop: 6, fontSize: 12 }}>
          Only Los Padres is baked so far. Other regions will show an error
          until their data is baked.
        </p>
      )}

      <label style={{ display: 'block', marginTop: 12 }}>
        Detection radius: {params.detectKm.toFixed(1)} km
        <input
          type="range" min={0.5} max={5} step={0.1} value={params.detectKm}
          onChange={(e) => {
            const v = Number(e.target.value)
            const s = spacingFor(v)
            setParam('detectKm', v)
            setParam('rMinKm', s.rMinKm)
            setParam('rMaxKm', s.rMaxKm)
          }}
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Coverage target: {(params.target * 100).toFixed(0)}%
        <input
          type="range" min={0.5} max={0.99} step={0.01} value={params.target}
          onChange={(e) => setParam('target', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>

      <button
        onClick={run}
        disabled={!region || running}
        style={{
          width: '100%', marginTop: 16, padding: '8px 0',
          background: PALETTE.meshTeal, color: PALETTE.canvas,
          border: 0, borderRadius: 6, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {running ? 'Running…' : 'Run placement'}
      </button>

      {error && (
        <p style={{ color: PALETTE.heat[2], marginTop: 12 }}>{error}</p>
      )}

      {result && (
        <div style={{ marginTop: 16, lineHeight: 1.7 }}>
          <div>candidates <b>{result.candidateCount.toLocaleString()}</b></div>
          <div>nodes <b>{result.nodeCount.toLocaleString()}</b></div>
          <div>cut <b>{result.reductionPct.toFixed(0)}%</b></div>
          <div>coverage <b>{(result.coveredFraction * 100).toFixed(1)}%</b></div>
        </div>
      )}
    </div>
  )
}
