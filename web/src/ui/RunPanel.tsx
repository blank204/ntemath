import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useModelStore } from '../state/useModelStore'
import { PALETTE } from '../theme/palette'
import type { RegionMeta } from '../lib/loadRegion'
import { loadManifest } from '../lib/loadRegion'
import { strideKm } from '../lib/pipeline'
import { regionOptions } from '../lib/regions'
import {
  budgetSentence, gateSentence, ignitionCaveat, unbakedNotice, weightSentence,
} from './copy'
import type { DoneMessage, ErrorMessage, RunMessage } from '../workers/place.worker'

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
          {asText(notes.lightning) && <Note label="lightning" body={asText(notes.lightning)!} />}
          {asText(notes.weather) && <Note label="fire weather" body={asText(notes.weather)!} />}
          {asText(notes.riskFormula) && <Note label="risk formula" body={asText(notes.riskFormula)!} />}
          <Note
            label="coverage"
            body={
              `Risk-weighted coverage is the share of burnable-area demand ` +
              `weight within the confirmation radius of a tower, scored on a ` +
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
              'Lightning: NASA LIS/OTD gridded climatology (public domain). ' +
              'Fire detections: NASA FIRMS. Weather: ERA5 via Open-Meteo. ' +
              'Basemap: MapTiler, © OpenStreetMap contributors.'
            }
          />
        </div>
      )}
    </div>
  )
}

/**
 * The manual escape hatch for the blue-noise spacing, mirroring plan_region's
 * `r_min_km` / `r_max_km` arguments: leave both empty and the budget mode
 * derives them, fill both and they win. Half-filled is not a state the model
 * has, so it is treated as "still derived" rather than guessed at.
 *
 * The derived values are shown as placeholders, so the reader can see what
 * they are overriding before they override it.
 */
function SpacingOverride({ value, derived, onChange }: {
  value: { rMinKm: number; rMaxKm: number } | null
  derived: { rMinKm: number; rMaxKm: number } | null
  onChange: (v: { rMinKm: number; rMaxKm: number } | null) => void
}) {
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')

  const commit = (nextMin: string, nextMax: string) => {
    setMin(nextMin)
    setMax(nextMax)
    const a = Number(nextMin)
    const b = Number(nextMax)
    const ok = nextMin.trim() !== '' && nextMax.trim() !== ''
      && Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a
    onChange(ok ? { rMinKm: a, rMaxKm: b } : null)
  }

  const box: CSSProperties = {
    width: '48%', marginTop: 4, accentColor: PALETTE.meshTeal,
    background: PALETTE.canvas, color: PALETTE.ink,
    border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 4, padding: '4px 6px',
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div>Spacing bounds (km)</div>
      <div style={{ display: 'flex', gap: '4%' }}>
        <input
          type="number" step={0.1} min={0} value={min} style={box}
          placeholder={derived ? `min ${derived.rMinKm.toFixed(2)}` : 'min — derived'}
          onChange={(e) => commit(e.target.value, max)}
        />
        <input
          type="number" step={0.1} min={0} value={max} style={box}
          placeholder={derived ? `max ${derived.rMaxKm.toFixed(2)}` : 'max — derived'}
          onChange={(e) => commit(min, e.target.value)}
        />
      </div>
      <div style={{ color: PALETTE.chart.inkMuted, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        {value
          ? 'Overridden. The budget mode no longer sets the candidate spacing.'
          : 'Derived from the budget mode, as plan_region derives it. Fill both to override.'}
      </div>
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
    regionName, region, params, result, running, error, availableRegions,
    setRegionName, setParam, setWeights, setRunning, setResult, setBenchmark,
    setAvailableRegions, setError,
  } = useModelStore()

  // Which regions actually have baked data. Read from the manifest the bake
  // writes by scanning the data directory, so the picker cannot claim a region
  // that was never baked.
  useEffect(() => {
    let cancelled = false
    loadManifest()
      .then((m) => { if (!cancelled) setAvailableRegions(m.baked) })
      // A missing manifest is not fatal: every region simply shows as unbaked,
      // which is the honest degradation rather than an empty picker.
      .catch(() => { if (!cancelled) setAvailableRegions([]) })
    return () => { cancelled = true }
  }, [setAvailableRegions])

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  // Changing region must invalidate any run still in flight. `setRegionName`
  // clears result and benchmark, but without this the worker started under the
  // OLD region still passes the runId check when it lands and puts that
  // region's numbers straight back — 572 nodes and a Los Padres curve
  // rendered under another region's name. Bumping the id makes the pending
  // response stale by definition; terminating the worker stops the work; and
  // `running` has to be released here too, or the Run button stays disabled
  // until a message that will now be discarded arrives.
  useEffect(() => {
    runIdRef.current++
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
  }, [regionName, setRunning])

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
      if (e.data.type === 'done') {
        setResult(e.data.result)
        setBenchmark(e.data.benchmark)
      } else {
        // A failed run must not leave the previous run's stats on screen next
        // to the error — the reader would take them for this run's answer.
        setResult(null)
        setBenchmark(null)
        setError(e.data.message)
      }
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
  const options = regionOptions(availableRegions)
  const selected = options.find((o) => o.key === regionName) ?? null
  // Which regions are baked, by label, straight off the manifest — so the
  // "not baked" notice names the current truth rather than a remembered one.
  const bakedLabels = options.filter((o) => o.baked).map((o) => o.label)

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
          {/* Every region is listed. The ones without data are disabled and
              say so — the model runs anywhere, the bake is what is missing,
              and hiding them would understate the first while pretending the
              second. */}
          {options.map((o) => (
            <option key={o.key} value={o.key} disabled={!o.baked}>
              {o.label} — {o.country}{o.baked ? '' : ' — not baked'}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p style={{ color: PALETTE.chart.inkMuted, marginTop: 6, fontSize: 11 }}>
          {selected.regime} · ignition: {selected.ignition}
          {!selected.baked && ` · ${unbakedNotice(selected.label, bakedLabels)}`}
        </p>
      )}
      {/* Said out loud rather than left to the reader: a tower that watches
          for lightning is worth nothing where people start the fires. */}
      {selected && ignitionCaveat(selected) && (
        <p style={{ color: PALETTE.brandOrange, marginTop: 6, fontSize: 11 }}>
          {ignitionCaveat(selected)}
        </p>
      )}
      {region?.meta.lightningGate && (
        <p style={{ color: PALETTE.chart.inkMuted, marginTop: 6, fontSize: 11, lineHeight: 1.5 }}>
          {gateSentence(region.meta.lightningGate)}
        </p>
      )}

      <label style={{ display: 'block', marginTop: 12 }}>
        Fire-weather weight: {params.wWeather.toFixed(2)}
        <input
          type="range" min={0} max={1} step={0.01} value={params.wWeather}
          onChange={(e) => setWeights({
            wWeather: Number(e.target.value), wActivity: params.wActivity,
          })}
          style={control}
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        {region?.meta.layer === 'fire-activity'
          ? 'Observed-activity weight' : 'Strike-density weight'}
        : {params.wActivity.toFixed(2)}
        <input
          // Capped at what the weather weight leaves, so the base weight the
          // readout below shows can never go negative.
          type="range" min={0} max={1} step={0.01} value={params.wActivity}
          onChange={(e) => setWeights({
            wWeather: params.wWeather, wActivity: Number(e.target.value),
          })}
          style={control}
        />
      </label>

      <div style={{ marginTop: 8, color: PALETTE.chart.inkMuted, fontSize: 11, lineHeight: 1.5 }}>
        {weightSentence({
          wWeather: params.wWeather, wActivity: params.wActivity,
          wBase: params.wBase, fwiNorm: region?.meta.fwiNorm ?? 0,
          layer: region?.meta.layer ?? 'lightning',
        })}
      </div>

      <label style={{ display: 'block', marginTop: 12 }}>
        Confirmation radius: {params.detectKm.toFixed(1)} km
        <input
          // Up to 20 km, where audible thunder gives out. The camera sees
          // the flash much further; what this slider bounds is the range at
          // which flash-to-bang can confirm the strike is real and place it.
          type="range" min={1} max={20} step={0.5} value={params.detectKm}
          // Spacing is no longer a separate parameter: the pipeline derives it
          // from detectKm through budget.ts, the way plan_region does.
          onChange={(e) => setParam('detectKm', Number(e.target.value))}
          style={control}
        />
      </label>

      <label style={{
        display: 'block', marginTop: 12,
        opacity: params.budgetMode === 'saturation' ? 1 : 0.45,
      }}>
        Coverage target: {(params.target * 100).toFixed(0)}%
        <input
          type="range" min={0.5} max={0.99} step={0.01} value={params.target}
          // Only saturation honours the target. The budgeted regimes set an
          // unreachable 1.01 so the node cap is what binds, exactly as
          // plan_region does — so the control is disabled rather than left
          // looking live while doing nothing.
          disabled={params.budgetMode !== 'saturation'}
          onChange={(e) => setParam('target', Number(e.target.value))}
          style={control}
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Budget mode
        <select
          value={params.budgetMode}
          onChange={(e) => setParam('budgetMode', e.target.value as typeof params.budgetMode)}
          style={control}
        >
          <option value="saturation">saturation — reach the target</option>
          <option value="auto">auto — the library default</option>
          <option value="fixed">fixed — a node count I choose</option>
        </select>
      </label>

      {params.budgetMode === 'fixed' && (
        <label style={{ display: 'block', marginTop: 12 }}>
          Fixed nodes: {params.fixedNodes}
          <input
            type="range" min={1} max={2000} step={1} value={params.fixedNodes}
            onChange={(e) => setParam('fixedNodes', Math.round(Number(e.target.value)))}
            style={control}
          />
        </label>
      )}

      <div style={{ marginTop: 8, color: PALETTE.chart.inkMuted, fontSize: 11, lineHeight: 1.5 }}>
        {budgetSentence({
          mode: params.budgetMode,
          maxNodes: result?.budget.maxNodes ?? (
            params.budgetMode === 'fixed' ? params.fixedNodes : null
          ),
          nodeCount: result?.nodeCount ?? 0,
        })}
      </div>

      <SpacingOverride
        value={params.spacingOverride}
        derived={result ? { rMinKm: result.budget.rMinKm, rMaxKm: result.budget.rMaxKm } : null}
        onChange={(v) => setParam('spacingOverride', v)}
      />

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

      {/* The run's numbers live in BenchmarkPanel now — one place, beside the
          comparison they belong to. Repeating them here would give the reader
          two sources for the same figure. */}

      {region && (
        <Provenance
          meta={region.meta}
          strideText={stride !== null ? `${stride.toFixed(2)} km` : 'sampled'}
        />
      )}
    </div>
  )
}
