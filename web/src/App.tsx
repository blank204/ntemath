import { MapRoot } from './map/MapRoot'
import { RunPanel } from './ui/RunPanel'
import { BenchmarkPanel } from './ui/BenchmarkPanel'
import { PALETTE } from './theme/palette'

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: PALETTE.canvas }}>
      <MapRoot />
      <RunPanel />
      <BenchmarkPanel />
    </div>
  )
}
