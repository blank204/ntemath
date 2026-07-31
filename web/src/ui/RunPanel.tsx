import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useModelStore } from '../state/useModelStore'
import { PALETTE } from '../theme/palette'
import type { RegionMeta } from '../lib/loadRegion'
import { strideKm } from '../lib/pipeline'
import type { DoneMessage, ErrorMessage, RunMessage } from '../workers/place.worker'

const REGIONS = [
  'los-padres', 'amazon-rondonia', 'siberia-baikal', 'portugal-centro',
  'victoria-alpine', 'congo-basin', 'sweden-norrland', 'greece-peloponnese',
]

const asText = (v: unknown): string | null =>
  typeof v === 'string' ? v : null

function Note({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color: PALETTE.meshTeal, fontSize: 11, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ color: PALETTE.baselineGray, fontSize: 11, lineHeight: 1.5 }}>
        {body}
      </div>
    </div>
  )
}

/**
 * Everything the numbers on this panel depend on, and everything they leave
 * out. Collapsed by default so it does not compete with the map, but present
 * and true: a coverage figure with no stride, no source list and no statement
 * of what is unmodelled is not a result, it is a poster.
 */
function Provenance({ meta, strideText }: { meta: RegionMeta; strideText: string }) {
  const [open, setOpen] = useState(false)
  const notes = meta.sourceNotes ?? {}
  const notModelled = Array.isArray(notes.notModelled)
    ? (notes.notModelled as unknown[]).map(String)
    : []
  const baked = meta.generated
    ? new Date(meta.generated).toISOString().slice(0, 10)
    : 'unknown'

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${PALETTE.surfaceRaised}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', marginTop: 10, padding: 0, textAlign: 'left',
          background: 'transparent', color: PALETTE.ink, border: 0,
          font: 'inherit', cursor: 'pointer',
        }}
      >
        {open ? '▾' : '▸'} Data, method and limits
      </button>

      {open && (
        <div style={{ marginTop: 4, maxHeight: 260, overflowY: 'auto' }}>
          <Note label="baked" body={`${meta.name}, ${baked} (UTC). Grid ${meta.nx}x${meta.ny}.`} />
          {asText(notes.landcover) && <Note label="land cover" body={asText(notes.landcover)!} />}
          {asText(notes.activity) && <Note label="fire activity" body={asText(notes.activity)!} />}
          {asText(notes.weather) && <Note label="fire weather" body={asText(notes.weather)!} />}
          {asText(notes.riskFormula) && <Note label="risk formula" body={asText(notes.riskFormula)!} />}
          <Note
            label="coverage"
            body={
              `Risk-weighted coverage is the share of burnable-area demand ` +
              `weight within the detection radius of a node, scored on a ` +
              `${strideText} sampling stride. Area covered is the same set ` +
              `of demand points counted unweighted.`
            }
          />
          {notModelled.length > 0 && (
            <Note label="not modelled" body={notModelled.join(', ')} />
          )}
          <Note
            label="attribution"
            body={
              'Land cover: ESA WorldCover, CC BY 4.0. ' +
              'Fire detections: NASA FIRMS. Weather: ERA5 via Open-Meteo. ' +
              'Basemap: MapTiler, © OpenStreetMap contributors.'
            }
          />
        </div>
      )}
    </div>
  )
}

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
    position: 'absolute', top: 16, left: 16, width: 300, padding: 16,
    maxHeight: 'calc(100% - 32px)', overflowY: 'auto',
    background: PALETTE.surface, color: PALETTE.ink,
    border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 8,
    font: '13px/1.5 system-ui, sans-serif', zIndex: 10,
  }

  // accentColor keeps native form controls on-palette; without it the
  // browser paints them in its OS default blue, which is not in the palette.
  const control: CSSProperties = {
    width: '100%', marginTop: 4, accentColor: PALETTE.meshTeal,
  }

  const stride = region ? strideKm(region.meta, params.demandStride) : null

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
          style={control}
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
          // Spacing is no longer a separate parameter: the pipeline derives it
          // from detectKm through budget.ts, the way plan_region does.
          onChange={(e) => setParam('detectKm', Number(e.target.value))}
          style={control}
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Coverage target: {(params.target * 100).toFixed(0)}%
        <input
          type="range" min={0.5} max={0.99} step={0.01} value={params.target}
          onChange={(e) => setParam('target', Number(e.target.value))}
          style={control}
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
          <div>
            cut <b>{result.reductionPct.toFixed(0)}%</b>
            <span style={{ color: PALETTE.baselineGray }}>
              {' '}of the blue-noise pool
            </span>
          </div>
          <div style={{ color: PALETTE.baselineGray, fontSize: 11, lineHeight: 1.4 }}>
            hardware saved by the greedy minimisation stage — not a comparison
            against another method
          </div>
          <div style={{ marginTop: 8 }}>
            risk-weighted coverage{' '}
            <b>{(result.coveredFraction * 100).toFixed(1)}%</b>
          </div>
          <div style={{ color: PALETTE.baselineGray, fontSize: 11, lineHeight: 1.4 }}>
            of burnable area
            {stride !== null && `, ${stride.toFixed(2)} km scoring stride`}
          </div>
          <div style={{ marginTop: 4 }}>
            area covered <b>{(result.areaFraction * 100).toFixed(1)}%</b>
            <span style={{ color: PALETTE.baselineGray }}> (unweighted)</span>
          </div>
        </div>
      )}

      {region && (
        <Provenance
          meta={region.meta}
          strideText={stride !== null ? `${stride.toFixed(2)} km` : 'sampled'}
        />
      )}
    </div>
  )
}
