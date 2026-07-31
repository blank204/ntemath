import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PALETTE } from '../theme/palette'
import { LABEL, SIZE, TABULAR, TYPE, WEIGHT } from '../theme/type'
import {
  phaseAt, speedOfSound, warmAirErrorFraction, delayForRangeKm,
  REFERENCE_SPEED_MS, type FlashState,
} from '../lib/flashToBang'

/** How much of the schematic's half-width one kilometre is worth. */
const VIEW = { w: 520, h: 200, towerX: 60, towerY: 150, maxKm: 20 }

const kmToPx = (km: number) =>
  (km / VIEW.maxKm) * (VIEW.w - VIEW.towerX - 24)

/**
 * The scene, as a pure function of the animation's state.
 *
 * Split from the stateful wrapper deliberately: this is the half that can be
 * rendered to static markup and asserted at any instant of the sequence,
 * which is the only way a timing-driven animation gets tested at all.
 */
export function FlashScene({ state, distanceKm, tempC, reducedMotion = false }: {
  state: FlashState
  distanceKm: number
  tempC: number
  reducedMotion?: boolean
}) {
  const strikeX = VIEW.towerX + kmToPx(distanceKm)
  const ringPx = kmToPx(state.ringKm)
  const flashing = state.phase === 'flash' && !reducedMotion
  const booming = state.phase === 'boom'

  return (
    <svg
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      width="100%"
      role="img"
      aria-label={
        state.rangeKm === null
          ? `Flash seen ${state.elapsedS.toFixed(2)} seconds ago; thunder has ` +
            'not arrived, so the range is not yet known'
          : `Thunder arrived after ${state.elapsedS.toFixed(2)} seconds: ` +
            `${state.rangeKm.toFixed(2)} km`
      }
      style={{ display: 'block', background: PALETTE.canvas, borderRadius: 6 }}
    >
      {/* Ground line. */}
      <line
        x1={0} y1={VIEW.towerY + 18} x2={VIEW.w} y2={VIEW.towerY + 18}
        stroke={PALETTE.chart.axis} strokeWidth={1}
      />

      {/* The sound wavefront, centred on the TOWER: at any instant it is the
          locus the strike could still be on, and it stops the moment the
          thunder arrives. Drawing it at the final radius from the start
          would show a measurement the tower has not made yet. */}
      {ringPx > 0 && (
        <circle
          cx={VIEW.towerX} cy={VIEW.towerY} r={ringPx}
          fill="none"
          stroke={state.rangeKm === null ? PALETTE.chart.axis : PALETTE.signal}
          strokeWidth={state.rangeKm === null ? 1 : 2}
          strokeDasharray={state.rangeKm === null ? '4 4' : undefined}
        />
      )}

      {/* The strike. Held bright at the flash, then a dim marker: the light
          arrives in about 50 microseconds at these ranges, so it is the
          start signal, not an event with duration. */}
      <g>
        <path
          d={`M ${strikeX} ${VIEW.towerY - 120} l -10 58 l 12 0 l -14 62`}
          fill="none"
          stroke={flashing ? PALETTE.heat[4] : PALETTE.heat[2]}
          strokeWidth={flashing ? 4 : 2}
          opacity={flashing ? 1 : 0.55}
        />
        <circle
          cx={strikeX} cy={VIEW.towerY} r={flashing ? 7 : 4}
          fill={flashing ? PALETTE.heat[4] : PALETTE.heat[1]}
        />
      </g>

      {/* The tower. */}
      <g stroke={booming ? PALETTE.signal : PALETTE.chart.inkMuted} fill="none">
        <path
          d={`M ${VIEW.towerX - 10} ${VIEW.towerY + 18} L ${VIEW.towerX} ${VIEW.towerY - 34}
              L ${VIEW.towerX + 10} ${VIEW.towerY + 18}`}
          strokeWidth={2}
        />
        <circle
          cx={VIEW.towerX} cy={VIEW.towerY - 40} r={5}
          strokeWidth={2}
          fill={booming ? PALETTE.signal : 'none'}
        />
      </g>

      {/* The clock, which is the whole point of the silence. */}
      <text
        x={VIEW.w - 12} y={30} textAnchor="end"
        fontFamily={TYPE.mono} fontWeight={WEIGHT.medium} fontSize={26}
        style={TABULAR}
        fill={state.rangeKm === null ? PALETTE.ink : PALETTE.signal}
      >
        {state.elapsedS.toFixed(2)} s
      </text>
      <text
        x={VIEW.w - 12} y={52} textAnchor="end"
        fontFamily={TYPE.mono} fontSize={SIZE.small} style={TABULAR}
        fill={PALETTE.chart.inkMuted}
      >
        {state.rangeKm === null
          ? 'listening'
          : `${state.elapsedS.toFixed(2)} s × ${speedOfSound(tempC).toFixed(1)} m/s ` +
            `= ${state.rangeKm.toFixed(2)} km`}
      </text>
      {booming && (
        <text
          x={VIEW.towerX} y={VIEW.towerY - 60} textAnchor="middle"
          fontFamily={TYPE.mono} fontWeight={WEIGHT.medium} fontSize={13}
          fill={PALETTE.heat[2]}
        >
          BOOM
        </text>
      )}
    </svg>
  )
}

/**
 * Flash to bang, played out in real time.
 *
 * The flash fires, the clock runs in silence, and the range only appears when
 * the sound actually arrives — because that is when the tower knows it. The
 * silence is the measurement, so it is not skipped, shortened or filled with
 * a progress bar.
 *
 * The clock always reads TRUE seconds. A playback multiplier compresses the
 * wall-clock wait for a strike far enough away that nobody would sit through
 * it (18 km is 53 real seconds), and says so on screen rather than quietly
 * making thunder faster than it is.
 */
export function FlashToBang() {
  const [distanceKm, setDistanceKm] = useState(2)
  const [tempC, setTempC] = useState(15)
  const [rate, setRate] = useState(1)
  const [elapsedS, setElapsedS] = useState(0)
  const [running, setRunning] = useState(false)
  const startRef = useRef(0)
  const rafRef = useRef(0)

  const reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const delayS = delayForRangeKm(distanceKm, tempC)

  useEffect(() => {
    if (!running) return
    const tick = () => {
      const t = ((performance.now() - startRef.current) / 1000) * rate
      setElapsedS(t)
      // Hold the resolved state on screen rather than looping: the answer is
      // the thing the reader came for.
      if (t >= delayS + 2) setRunning(false)
      else rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [running, rate, delayS])

  const fire = () => {
    startRef.current = performance.now()
    setElapsedS(0)
    setRunning(true)
  }

  const state = phaseAt(elapsedS, delayS, tempC)
  const errPct = 100 * warmAirErrorFraction(tempC)

  const panel: CSSProperties = {
    background: PALETTE.surface, color: PALETTE.ink,
    padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
  }
  const control: CSSProperties = {
    width: '100%', marginTop: 4, accentColor: PALETTE.signal,
  }

  return (
    <div style={panel}>
      <div style={{ ...LABEL, color: PALETTE.ember }}>
        FLASH TO BANG
      </div>
      <p style={{ color: PALETTE.chart.inkMuted, marginTop: 4 }}>
        Light arrives in about 50 microseconds. Sound takes the same distance
        at {speedOfSound(tempC).toFixed(1)} m/s. The gap is the range — one
        camera, one microphone, one clock.
      </p>

      <div style={{ marginTop: 8 }}>
        <FlashScene
          state={state} distanceKm={distanceKm} tempC={tempC}
          reducedMotion={reducedMotion}
        />
      </div>

      <button
        type="button"
        onClick={fire}
        style={{
          marginTop: 10, width: '100%', padding: '8px 10px',
          background: PALETTE.surfaceRaised, color: PALETTE.ink,
          border: `1px solid ${PALETTE.chart.axis}`, borderRadius: 6,
          cursor: 'pointer', ...LABEL, fontSize: SIZE.small,
        }}
      >
        {running ? 'STRIKE IN PROGRESS' : 'TRIGGER A STRIKE'}
      </button>

      <label style={{ display: 'block', marginTop: 10 }}>
        Strike distance: {distanceKm.toFixed(1)} km
        {' · '}{delayS.toFixed(1)} s of silence
        <input
          type="range" min={0.5} max={20} step={0.5} value={distanceKm}
          onChange={(e) => setDistanceKm(Number(e.target.value))}
          style={control}
        />
      </label>

      <label style={{ display: 'block', marginTop: 10 }}>
        Air temperature: {tempC.toFixed(0)} °C
        <input
          type="range" min={-25} max={35} step={1} value={tempC}
          onChange={(e) => setTempC(Number(e.target.value))}
          style={control}
        />
      </label>
      <p style={{ color: PALETTE.chart.inkMuted, marginTop: 4 }}>
        {/* The caveat, in the same breath as the measurement rather than in a
            footnote: the textbook constant is a 20 °C constant. */}
        Sound is slower in cold air. Using the textbook{' '}
        {REFERENCE_SPEED_MS.toFixed(0)} m/s at {tempC.toFixed(0)} °C would put
        the strike {Math.abs(errPct).toFixed(1)}%{' '}
        {errPct >= 0 ? 'further away than it is' : 'closer than it is'} —{' '}
        {Math.abs(errPct * 10 * distanceKm).toFixed(0)} m at{' '}
        {distanceKm.toFixed(1)} km.
      </p>

      <label style={{ display: 'block', marginTop: 10 }}>
        Playback: {rate}× {rate === 1 ? '(real time)' : '(the clock is still real seconds)'}
        <select
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          style={control}
        >
          <option value={1}>1× — real time</option>
          <option value={4}>4×</option>
          <option value={10}>10×</option>
        </select>
      </label>

      <p style={{ color: PALETTE.chart.inkMuted, marginTop: 10 }}>
        A local confirmation layer, not a lightning network. Audible thunder
        gives out near 20 km, and terrain and temperature gradients open
        shadow zones well inside that; NLDN and GLD360 are sub-kilometre and
        range-unlimited. What a tower adds is the ground truth at the strike,
        where the fuel is.
      </p>
    </div>
  )
}
