import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useModelStore } from '../state/useModelStore'
import { PALETTE } from '../theme/palette'
import { LABEL, SIZE, TABULAR, TYPE, WIDTH } from '../theme/type'
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
      <div style={{ ...LABEL, color: PALETTE.signal }}>
        {label.toUpperCase()}
      </div>
      {/* `inkMuted`, not `control`. This read `PALETTE.baselineGray` — a grey —
          until the storm-blue rename swapped that token for `control`, which
          is the uniform-grid SERIES colour. Provenance captions were being
          painted in a chart magenta, and a data-series colour used as body
          text is exactly what the palette's naming rules exist to stop. */}
      <div style={{
        color: PALETTE.inkMuted, fontSize: 11, lineHeight: 1.5,
      }}>
        {body}
      </div>
    </div>
  )
}

/**
 * A control's name and its current value.
 *
 * The name goes in the label voice the whole site uses; the value is promoted
 * out of the sentence into a tabular readout, because the value is the thing
 * being adjusted and it was previously buried mid-line in prose. Tabular so
 * it does not jitter while a slider is being dragged.
 */
function Field({ name, value, dim = false, children }: {
  name: string
  value?: string
  dim?: boolean
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'block', marginTop: 16, opacity: dim ? 0.45 : 1 }}>
      <span style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', gap: 8, marginBottom: 5,
      }}>
        <span style={{ ...LABEL, color: PALETTE.inkMuted }}>{name}</span>
        {value !== undefined && (
          <span style={{
            ...TABULAR, fontFamily: TYPE.mono, fontStretch: WIDTH.labelNarrow,
            fontSize: SIZE.small, color: PALETTE.ink,
          }}>
            {value}
          </span>
        )}
      </span>
      {children}
    </label>
  )
}

/**
 * A sentence the panel owes the reader but should not lead with.
 *
 * The Lab had the same problem the Rail did — the reason the whole visual
 * rebuild started — which is that it explained itself in paragraphs stacked
 * between the controls, so the controls were hard to find and the paragraphs
 * went unread. This keeps every word, on the page, one click away, and stops
 * it competing with the map behind it.
 *
 * Not a `<details>`: the summary marker cannot be styled consistently across
 * browsers and this one has to sit in the label voice like everything else.
 */
function Why({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          ...LABEL, padding: 0, background: 'transparent', border: 0,
          color: PALETTE.signal, cursor: 'pointer',
        }}
      >
        {open ? 'Why ▾' : 'Why ▸'}
      </button>
      {open && (
        <div style={{
          color: PALETTE.inkMuted, fontSize: 11, lineHeight: 1.6,
          marginTop: 6, paddingLeft: 10,
          borderLeft: `1px solid ${PALETTE.surfaceRaised}`,
        }}>
          {children}
        </div>
      )}
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
    width: '48%', marginTop: 4, accentColor: PALETTE.signal,
    background: PALETTE.canvas, color: PALETTE.ink,
    border: `1px solid ${PALETTE.surfaceRaised}`, borderRadius: 4, padding: '4px 6px',
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ ...LABEL, color: PALETTE.inkMuted, marginBottom: 5 }}>
        Spacing bounds (km)
      </div>
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
    setTriangulation, setDoubleCoverage,
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
        setTriangulation(e.data.triangulation)
        setDoubleCoverage(e.data.doubleCoverage)
      } else {
        // A failed run must not leave the previous run's stats on screen next
        // to the error — the reader would take them for this run's answer.
        setResult(null)
        setBenchmark(null)
        setTriangulation(null)
        setDoubleCoverage(null)
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
    fontSize: SIZE.small, lineHeight: 1.55, zIndex: 10,
  }

  // accentColor keeps native form controls on-palette; without it the
  // browser paints them in its OS default blue, which is not in the palette.
  const control: CSSProperties = {
    width: '100%', marginTop: 4, accentColor: PALETTE.signal,
  }

  const stride = region ? strideKm(region.meta, params.demandStride) : null
  const options = regionOptions(availableRegions)
  const selected = options.find((o) => o.key === regionName) ?? null
  // Which regions are baked, by label, straight off the manifest — so the
  // "not baked" notice names the current truth rather than a remembered one.
  const bakedLabels = options.filter((o) => o.baked).map((o) => o.label)

  return (
    <div style={panel}>
      {/* Ink, not ember. The wordmark used to be orange, and a wordmark is
          chrome — spending the fire signal on it is what left the old page
          unable to mean anything by orange when it actually meant fire. */}
      <div style={{ ...LABEL, fontSize: SIZE.headline, letterSpacing: '0.06em',
        fontFamily: TYPE.display, fontStretch: WIDTH.displayWide,
        color: PALETTE.ink }}>
        PYRA
      </div>

      <Field name="Region">
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
      </Field>
      {selected && (
        <p style={{ color: PALETTE.chart.inkMuted, marginTop: 6, fontSize: 11 }}>
          {selected.regime} · ignition: {selected.ignition}
          {!selected.baked && ` · ${unbakedNotice(selected.label, bakedLabels)}`}
        </p>
      )}
      {/* Said out loud rather than left to the reader: a tower that watches
          for lightning is worth nothing where people start the fires. */}
      {selected && ignitionCaveat(selected) && (
        <p style={{ color: PALETTE.ember, marginTop: 6, fontSize: 11 }}>
          {ignitionCaveat(selected)}
        </p>
      )}
      {region?.meta.lightningGate && (
        <Why>{gateSentence(region.meta.lightningGate)}</Why>
      )}

      <Field name="Fire-weather weight" value={params.wWeather.toFixed(2)}>
        <input
          type="range" min={0} max={1} step={0.01} value={params.wWeather}
          onChange={(e) => setWeights({
            wWeather: Number(e.target.value), wActivity: params.wActivity,
          })}
          style={control}
        />
      </Field>

      <Field
        name={region?.meta.layer === 'fire-activity'
          ? 'Observed-activity weight' : 'Strike-density weight'}
        value={params.wActivity.toFixed(2)}
      >
        <input
          // Capped at what the weather weight leaves, so the base weight the
          // readout below shows can never go negative.
          type="range" min={0} max={1} step={0.01} value={params.wActivity}
          onChange={(e) => setWeights({
            wWeather: params.wWeather, wActivity: Number(e.target.value),
          })}
          style={control}
        />
      </Field>

      <Why>
        {weightSentence({
          wWeather: params.wWeather, wActivity: params.wActivity,
          wBase: params.wBase, fwiNorm: region?.meta.fwiNorm ?? 0,
          layer: region?.meta.layer ?? 'lightning',
        })}
      </Why>

      <Field name="Confirmation radius" value={`${params.detectKm.toFixed(1)} km`}>
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
      </Field>

      <Field
        name="Coverage target"
        value={`${(params.target * 100).toFixed(0)}%`}
        dim={params.budgetMode !== 'saturation'}
      >
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
      </Field>

      <Field name="Budget mode">
        <select
          value={params.budgetMode}
          onChange={(e) => setParam('budgetMode', e.target.value as typeof params.budgetMode)}
          style={control}
        >
          <option value="saturation">saturation — reach the target</option>
          <option value="auto">auto — the library default</option>
          <option value="fixed">fixed — a node count I choose</option>
        </select>
      </Field>

      {params.budgetMode === 'fixed' && (
        <Field name="Fixed nodes" value={String(params.fixedNodes)}>
          <input
            type="range" min={1} max={2000} step={1} value={params.fixedNodes}
            onChange={(e) => setParam('fixedNodes', Math.round(Number(e.target.value)))}
            style={control}
          />
        </Field>
      )}

      <Why>
        {budgetSentence({
          mode: params.budgetMode,
          maxNodes: result?.budget.maxNodes ?? (
            params.budgetMode === 'fixed' ? params.fixedNodes : null
          ),
          nodeCount: result?.nodeCount ?? 0,
        })}
      </Why>

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
          background: PALETTE.signal, color: PALETTE.canvas,
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
