import { MapRoot } from './map/MapRoot'
import { RunPanel } from './ui/RunPanel'
import { BenchmarkPanel } from './ui/BenchmarkPanel'
import { FlashToBang } from './ui/FlashToBang'
import { PALETTE } from './theme/palette'

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: PALETTE.canvas }}>
      <MapRoot />
      <RunPanel />
      <BenchmarkPanel />
      {/* Bottom centre, clear of both panels. It belongs in the Rail's fifth
          beat once that exists; until then it lives here, because it is the
          one part of the site that explains what a tower actually measures. */}
      <div style={{
        position: 'absolute', left: 332, bottom: 16, width: 380,
        maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
      }}>
        <FlashToBang />
      </div>
    </div>
  )
}
