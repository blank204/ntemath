import { MapRoot } from './map/MapRoot'
import { RunPanel } from './ui/RunPanel'
import { BenchmarkPanel } from './ui/BenchmarkPanel'
import { Rail } from './rail/Rail'
import { LAB_ANCHOR } from './rail/beats'
import { PALETTE } from './theme/palette'

/**
 * The Rail, then the Lab.
 *
 * The Rail is the argument and the Lab is the evidence, in that order, with a
 * skip link at the top for a reader who only wants the evidence. The Lab is a
 * positioned, viewport-tall section rather than a fixed overlay so the page
 * can scroll past it — the map and its panels are absolute inside that
 * section, not inside the window.
 */
export default function App() {
  return (
    <div style={{ background: PALETTE.canvas, color: PALETTE.ink }}>
      <Rail />
      <section
        id={LAB_ANCHOR}
        aria-label="The Lab: the siting model, running here"
        style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}
      >
        <MapRoot />
        <RunPanel />
        <BenchmarkPanel />
      </section>
    </div>
  )
}
