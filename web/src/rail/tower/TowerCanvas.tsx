import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../theme/palette'
import { LABEL } from '../../theme/type'
import {
  TOWER_PARTS, MAST_HEIGHT_M, MAST_WIDTH_M, explodedY, latticeRungs,
  partProgress,
} from './towerModel'

/**
 * The tower, in three dimensions, coming apart as the reader scrolls.
 *
 * THIS IS THE PAGE'S OBJECT. Both reference sites are carried by one thing —
 * a console, a can — that changes state while the words scroll past it. The
 * first pass here gave every beat its own small diagram, and the verdict was
 * that they were "way too simple"; a lightning bolt drawn as a polyline is an
 * illustration of a subject, not the subject. So the tower stands for the
 * whole rail and the reveal is the animation: each subsystem opens in its own
 * slice of the scroll, in sequence, top to bottom.
 *
 * No labels in here. Text lives on the other side of the seam now — the
 * reference site's left half is one fixed line and an object, never a column
 * of copy competing with the column of copy opposite it.
 *
 * Every vertex is generated here — there is no downloaded mesh and no texture
 * to fetch. A CC0 model of this thing does not exist, and the CC-BY comms
 * towers that do are single welded meshes that cannot come apart into the five
 * subsystems this page names. Procedural also means the lattice costs nothing
 * to ship and the explode is exact rather than eyeballed.
 *
 * The geometry decisions all live in `towerModel.ts`, which is tested. This
 * file is the part a test runner cannot see: materials, lights, camera.
 */

/**
 * Which way each subsystem drifts as it comes off the mast, and how far it
 * turns doing it. Alternating sides, so the open assembly reads as a machine
 * laid out for inspection rather than as a column stretched vertically.
 */
const OUT: Array<[number, number, number]> = [
  [0.10, 0.95, 0.5],    // camera head — forward, barely aside
  [-0.85, 0.30, -0.7],  // microphone array — out to the left
  [0.80, 0.45, 0.9],    // compute — out to the right
  [-0.45, -0.80, -0.5], // solar — back left
  [0.55, -0.70, 1.2],   // backhaul — back right
]
const OUT_TRAVEL_M = 3.4

export function TowerCanvas({
  t, height = 520, fallback = null, showParts = true,
}: {
  t: number
  /** CSS height for the canvas. `'100%'` when it fills a pinned pane. */
  height?: number | string
  /** Shown instead when WebGL is unavailable. */
  fallback?: React.ReactNode
  /**
   * The parts list under the mast. Off when the tower is the pinned hero:
   * there it sat on top of a 96px headline and neither could be read, and the
   * left half of the split is meant to carry no text at all.
   */
  showParts?: boolean
}) {
  const mount = useRef<HTMLDivElement | null>(null)
  const api = useRef<{ setT: (t: number) => void; dispose: () => void } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = mount.current
    if (!el) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // No WebGL — a locked-down machine, a headless capture, an old GPU
      // blocklist. The caller falls back to the schematic rather than
      // showing an empty rectangle.
      setFailed(true)
      return
    }

    // Honoured rather than overridden: the idle turn stops, and the assembly
    // moves only because the reader scrolled it.
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ?? false

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500)
    const group = new THREE.Group()
    scene.add(group)

    const mats: THREE.Material[] = []
    const track = <M extends THREE.Material>(m: M): M => { mats.push(m); return m }

    // Two steels, not one. Galvanised legs catch the key light; the bracing
    // is darker and recedes, which is what stops a lattice reading as a
    // uniform grey scribble at this distance.
    const legSteel = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.inkMuted),
      roughness: 0.38, metalness: 0.72,
    }))
    const braceSteel = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.chart.axis),
      roughness: 0.55, metalness: 0.6,
    }))
    const instrument = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.signal),
      roughness: 0.34, metalness: 0.25,
      emissive: new THREE.Color(PALETTE.signal), emissiveIntensity: 0.16,
    }))
    const housing = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.surfaceRaised),
      roughness: 0.5, metalness: 0.45,
    }))
    const lens = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.heat[2]),
      roughness: 0.18, metalness: 0.1,
      emissive: new THREE.Color(PALETTE.heat[2]), emissiveIntensity: 0.55,
    }))
    const glass = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.canvas),
      roughness: 0.14, metalness: 0.85,
    }))
    // The aviation obstruction light. `heat` is reserved for fire, heat and
    // alert — a warning beacon is the third, and it is the one warm point on
    // an otherwise cold object.
    const beaconMat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.heat[1]),
      emissive: new THREE.Color(PALETTE.heat[2]), emissiveIntensity: 1.4,
      roughness: 0.4,
    }))

    // ---- the mast: four legs, a ladder of cross-braces, and a climb -------
    const mast = new THREE.Group()
    const legR = 0.14
    // Half-width at a given height: the mast tapers, which is what stops it
    // reading as a box on stilts.
    const halfAt = (y: number) =>
      (MAST_WIDTH_M / 2) * (1 - 0.42 * (y / MAST_HEIGHT_M))
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

    /** A member between two points, as a cylinder. Every brace is one. */
    const member = (
      a: THREE.Vector3, b: THREE.Vector3, r: number,
      mat: THREE.Material = braceSteel,
    ): THREE.Mesh => {
      const dir = new THREE.Vector3().subVectors(b, a)
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, dir.length(), 8), mat)
      m.position.copy(a).addScaledVector(dir, 0.5)
      m.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      return m
    }

    const cornerAt = (c: readonly [number, number], y: number) =>
      new THREE.Vector3(c[0] * halfAt(y), y, c[1] * halfAt(y))

    // Four tapering legs.
    for (const c of corners) {
      mast.add(member(cornerAt(c, 0), cornerAt(c, MAST_HEIGHT_M), legR, legSteel))
    }

    // X-bracing on all four faces, bay by bay, plus a horizontal at each
    // level. This is what a lattice mast actually is, and it is the
    // difference between "tower" and "four poles" at a glance.
    const rungs = latticeRungs()
    for (let i = 0; i < rungs.length; i++) {
      const y0 = rungs[i]
      const y1 = rungs[i + 1] ?? MAST_HEIGHT_M
      for (let f = 0; f < 4; f++) {
        const a = corners[f]
        const b = corners[(f + 1) % 4]
        mast.add(member(cornerAt(a, y0), cornerAt(b, y1), 0.045))
        mast.add(member(cornerAt(b, y0), cornerAt(a, y1), 0.045))
        mast.add(member(cornerAt(a, y0), cornerAt(b, y0), 0.058))
      }
      // Flange plates where the legs are spliced. Small, but they are what
      // makes the mast read as fabricated steel rather than as extruded
      // tube — a real mast is bolted together in sections.
      for (const c of corners) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(legR * 2.1, legR * 2.1, 0.09, 8), legSteel)
        plate.position.copy(cornerAt(c, y0))
        mast.add(plate)
      }
    }
    // Cap the top so the legs meet something.
    for (let f = 0; f < 4; f++) {
      mast.add(member(
        cornerAt(corners[f], MAST_HEIGHT_M),
        cornerAt(corners[(f + 1) % 4], MAST_HEIGHT_M), 0.058))
    }

    // A climbing ladder up one face, with a fall-arrest hoop every few metres.
    // Nobody will name it, but a thirty-metre mast that cannot be climbed
    // reads as a rendering of a tower instead of a tower.
    for (let y = 0.6; y < MAST_HEIGHT_M - 1; y += 0.45) {
      const h = halfAt(y)
      mast.add(member(
        new THREE.Vector3(-0.34, y, h + 0.22),
        new THREE.Vector3(0.34, y, h + 0.22), 0.028))
    }
    for (const s of [-0.34, 0.34]) {
      mast.add(member(
        new THREE.Vector3(s, 0.6, halfAt(0.6) + 0.22),
        new THREE.Vector3(s, MAST_HEIGHT_M - 1, halfAt(MAST_HEIGHT_M - 1) + 0.22),
        0.038, legSteel))
    }
    for (let y = 3; y < MAST_HEIGHT_M - 2; y += 3) {
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.03, 6, 16, Math.PI * 1.35), braceSteel)
      hoop.position.set(0, y, halfAt(y) + 0.24)
      hoop.rotation.y = Math.PI / 2
      hoop.rotation.z = Math.PI / 2
      mast.add(hoop)
    }
    group.add(mast)

    // The obstruction beacon sits on the mast, not on a subsystem — it stays
    // put while everything else comes off.
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 10), beaconMat)
    beacon.position.set(0, MAST_HEIGHT_M + 0.24, 0)
    mast.add(beacon)

    // ---- the instruments -------------------------------------------------
    const parts = TOWER_PARTS.map((p) => {
      const g = new THREE.Group()
      if (p.id === 'mics') {
        // Three booms at 120°, which is the array that gives the bearing.
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.34, 0.4, 0.7, 12), housing)
        g.add(hub)
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3
          const boom = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.045, p.radius * 2, 8), instrument)
          boom.rotation.z = Math.PI / 2
          boom.rotation.y = a
          boom.position.set(Math.cos(a) * p.radius * 0.5, 0,
            Math.sin(a) * p.radius * 0.5)
          g.add(boom)
          // Windshield, on a short standoff — a microphone on a boom in a
          // boreal winter is a microphone inside a foam ball.
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.26, 6), housing)
          stem.position.set(Math.cos(a) * p.radius, 0.13, Math.sin(a) * p.radius)
          g.add(stem)
          const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 14, 12), instrument)
          ball.position.set(Math.cos(a) * p.radius, 0.3, Math.sin(a) * p.radius)
          g.add(ball)
        }
      } else if (p.id === 'solar') {
        // A tilted array on a frame, with mullions. A flat plate reads as a
        // sheet of card; the frame and the cell divisions are what make it a
        // panel.
        const frame = new THREE.Group()
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 2, 0.07, p.radius * 1.15), glass)
        frame.add(panel)
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 2.08, 0.11, p.radius * 1.22), housing)
        edge.position.y = -0.04
        frame.add(edge)
        for (let i = -1; i <= 1; i++) {
          const mull = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.1, p.radius * 1.15), housing)
          mull.position.set(i * p.radius * 0.62, 0.03, 0)
          frame.add(mull)
        }
        frame.rotation.z = 0.34
        g.add(frame)
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), housing)
        strut.position.set(0, -0.55, 0)
        g.add(strut)
      } else if (p.id === 'camera') {
        // Housing, sunshade hood, lens. The hood is the detail that makes a
        // cylinder read as an outdoor camera.
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(p.radius * 0.5, p.radius * 0.5, p.height, 20),
          housing)
        body.rotation.z = Math.PI / 2
        g.add(body)
        const hood = new THREE.Mesh(
          new THREE.CylinderGeometry(p.radius * 0.62, p.radius * 0.62, p.height * 0.62,
            20, 1, true), instrument)
        hood.rotation.z = Math.PI / 2
        hood.position.x = p.radius * 0.34
        g.add(hood)
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.3, 0.42, 16), housing)
        barrel.rotation.z = Math.PI / 2
        barrel.position.x = p.radius * 0.72
        g.add(barrel)
        const eye = new THREE.Mesh(
          new THREE.CylinderGeometry(0.21, 0.21, 0.1, 16), lens)
        eye.rotation.z = Math.PI / 2
        eye.position.x = p.radius * 0.93
        g.add(eye)
        const mount = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.5, 0.34), housing)
        mount.position.y = -p.height * 0.62
        g.add(mount)
      } else if (p.id === 'backhaul') {
        // A parabolic dish on a feed arm, pointed off-axis the way a real
        // backhaul link is aimed at a distant repeater.
        const dish = new THREE.Mesh(
          new THREE.SphereGeometry(p.radius * 0.85, 24, 16, 0, Math.PI * 2, 0,
            Math.PI / 2.6),
          instrument)
        dish.rotation.x = Math.PI / 2.4
        g.add(dish)
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(p.radius * 0.6, 0.05, 8, 28), housing)
        rim.rotation.x = Math.PI / 2.4 + Math.PI / 2
        g.add(rim)
        const arm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, p.radius * 1.05, 8), housing)
        arm.rotation.x = Math.PI / 2.4
        arm.position.set(0, p.radius * 0.34, p.radius * 0.42)
        g.add(arm)
        const feed = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.16, 0.3, 12), lens)
        feed.position.set(0, p.radius * 0.66, p.radius * 0.82)
        g.add(feed)
      } else {
        // Compute: a sealed cabinet with cooling fins and a door seam.
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 1.5, p.height, p.radius * 1.2), housing)
        g.add(box)
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 1.1, p.height * 0.72, 0.05), instrument)
        door.position.z = p.radius * 0.61
        g.add(door)
        for (let i = 0; i < 5; i++) {
          const fin = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, p.height * 0.8, p.radius * 0.5), housing)
          fin.position.set(-p.radius * 0.76, 0, (i - 2) * 0.16)
          g.add(fin)
        }
      }
      group.add(g)
      return { part: p, group: g }
    })

    // Ground: a ring and a faint grid, purely for scale. Without it the mast
    // floats and reads as a diagram rather than as a thirty-metre object.
    const groundColor = new THREE.Color(PALETTE.chart.axis)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.6, 48),
      track(new THREE.MeshBasicMaterial({
        color: groundColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      })),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    group.add(ring)
    const grid = new THREE.GridHelper(60, 12, groundColor, groundColor)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.14
    group.add(grid)

    // Sky above, field below. A hemisphere light is what stops the underside
    // of every member going flat black on a dark page.
    scene.add(new THREE.HemisphereLight(
      new THREE.Color(PALETTE.signal), new THREE.Color(PALETTE.canvas), 1.15))
    scene.add(new THREE.AmbientLight(new THREE.Color(PALETTE.ink), 0.28))
    const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.5)
    key.position.set(14, 26, 12)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.signal), 1.5)
    rim.position.set(-16, 8, -10)
    scene.add(rim)

    let raf = 0
    let current = t
    let spin = 0
    const size = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)

      // Each subsystem on its own scroll window, so the assembly comes apart
      // a piece at a time instead of all five sliding together.
      let opened = 0
      for (let i = 0; i < parts.length; i++) {
        const { part, group: g } = parts[i]
        const p = partProgress(i, current)
        opened += p
        g.position.y = explodedY(part, p)
        g.position.x = OUT[i][0] * p * OUT_TRAVEL_M
        g.position.z = OUT[i][1] * p * OUT_TRAVEL_M
        g.rotation.y = p * OUT[i][2]
      }
      opened /= parts.length

      // A slow turn, so the lattice reads as three-dimensional without anyone
      // having to drag it — plus a quarter-turn earned by the scroll itself,
      // so opening the assembly also walks around it.
      if (!calm) spin += 0.0022
      group.rotation.y = spin + opened * 0.6

      // Framed on the mast, pulling back and lifting as the assembly opens so
      // it never grows out of the panel. The vertical FOV is what binds on a
      // wide canvas, so the distance is set from the height, not the width.
      const dist = 31 * (1 + opened * 0.42)
      camera.position.set(0, MAST_HEIGHT_M * (0.52 + opened * 0.06), dist)
      camera.lookAt(0, MAST_HEIGHT_M * 0.48, 0)
      renderer.render(scene, camera)
    }

    el.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    size()
    draw()
    window.addEventListener('resize', size)

    api.current = {
      setT: (next) => { current = next },
      dispose: () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', size)
        // Explicit teardown: React StrictMode mounts twice in development,
        // and a leaked WebGL context is one of the few things a browser will
        // not clean up for you — it drops the oldest context instead, which
        // blanks whichever canvas was there first.
        scene.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
        })
        for (const mat of mats) mat.dispose()
        renderer.dispose()
        el.removeChild(renderer.domElement)
      },
    }
    return () => { api.current?.dispose(); api.current = null }
  }, [])

  // Drive the animation without re-running the effect: rebuilding the scene
  // on every scroll frame would be a new WebGL context per frame.
  useEffect(() => { api.current?.setT(t) }, [t])

  if (failed) return <>{fallback}</>

  return (
    // The block is capped, not just the canvas. The parts list underneath was
    // uncapped, so it set its own width from the longest note, overflowed the
    // pinned pane and got clipped at both edges once the pane started
    // centring its stage.
    <div style={{
      width: '100%', maxWidth: showParts ? 460 : '100%', margin: '0 auto',
      // The wrapper has to carry the height too. `height: 100%` on the mount
      // resolves against THIS box, so leaving it auto collapses the canvas to
      // nothing and the renderer sizes itself 1x1 — a blank pane, with no
      // error anywhere.
      height: typeof height === 'string' ? height : undefined,
    }}>
      <div
        ref={mount}
        role="img"
        aria-label={
          'An exploded view of the tower: camera head, microphone array, ' +
          'compute, solar and backhaul, separating along a 30 m lattice mast'
        }
        style={{ width: '100%', height, position: 'relative' }}
      />
      {/* Set in the label voice like every other caption on the page. It was
          running in the body face at default size, which read as raw markup
          next to the rebuilt column. */}
      {showParts && <ul style={{
        ...LABEL, listStyle: 'none', margin: '14px 0 0', padding: 0,
        display: 'grid', gap: 7, lineHeight: 1.7,
        color: PALETTE.chart.inkMuted,
      }}>
        {TOWER_PARTS.map((p) => (
          <li key={p.id} style={{ opacity: t > 0.15 ? 1 : 0.5, transition: 'opacity 200ms' }}>
            <span style={{ color: PALETTE.signal }}>{p.label}</span>
            {' — '}{p.note}
          </li>
        ))}
      </ul>}
    </div>
  )
}
