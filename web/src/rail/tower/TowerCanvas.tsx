import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../theme/palette'
import { SIZE } from '../../theme/type'
import {
  TOWER_PARTS, MAST_HEIGHT_M, MAST_WIDTH_M, explodedY, latticeRungs,
} from './towerModel'

/**
 * The tower, in three dimensions, opening as the reader scrolls.
 *
 * Every vertex is generated here — there is no downloaded mesh and no
 * texture to fetch. A CC0 model of this thing does not exist, and the CC-BY
 * comms towers that do are single welded meshes that cannot come apart into
 * the five subsystems this beat names. Procedural also means the lattice
 * costs nothing to ship and the explode is exact rather than eyeballed.
 *
 * The geometry decisions all live in `towerModel.ts`, which is tested. This
 * file is the part a test runner cannot see: materials, lights, camera.
 */
export function TowerCanvas({ t, height = 520, fallback = null }: {
  t: number
  height?: number
  /** Shown instead when WebGL is unavailable. */
  fallback?: React.ReactNode
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

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500)
    const group = new THREE.Group()
    scene.add(group)

    const steel = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.chart.inkMuted),
      roughness: 0.42, metalness: 0.55,
    })
    const instrument = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.meshTeal),
      roughness: 0.35, metalness: 0.2,
      emissive: new THREE.Color(PALETTE.meshTeal), emissiveIntensity: 0.18,
    })
    const lens = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.heat[2]),
      roughness: 0.2, metalness: 0.1,
      emissive: new THREE.Color(PALETTE.heat[2]), emissiveIntensity: 0.5,
    })

    // ---- the mast: four legs and a ladder of cross-braces ----------------
    const mast = new THREE.Group()
    const legR = 0.13
    // Half-width at a given height: the mast tapers, which is what stops it
    // reading as a box on stilts.
    const halfAt = (y: number) =>
      (MAST_WIDTH_M / 2) * (1 - 0.42 * (y / MAST_HEIGHT_M))
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

    /** A member between two points, as a cylinder. Every brace is one. */
    const member = (
      a: THREE.Vector3, b: THREE.Vector3, r: number,
    ): THREE.Mesh => {
      const dir = new THREE.Vector3().subVectors(b, a)
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, dir.length(), 6), steel)
      m.position.copy(a).addScaledVector(dir, 0.5)
      m.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      return m
    }

    const cornerAt = (c: readonly [number, number], y: number) =>
      new THREE.Vector3(c[0] * halfAt(y), y, c[1] * halfAt(y))

    // Four tapering legs.
    for (const c of corners) {
      mast.add(member(cornerAt(c, 0), cornerAt(c, MAST_HEIGHT_M), legR))
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
        mast.add(member(cornerAt(a, y0), cornerAt(b, y0), 0.055))
      }
    }
    // Cap the top so the legs meet something.
    for (let f = 0; f < 4; f++) {
      mast.add(member(
        cornerAt(corners[f], MAST_HEIGHT_M),
        cornerAt(corners[(f + 1) % 4], MAST_HEIGHT_M), 0.055))
    }
    group.add(mast)

    // ---- the instruments -------------------------------------------------
    const parts = TOWER_PARTS.map((p) => {
      const g = new THREE.Group()
      if (p.id === 'mics') {
        // Three booms at 120°, which is the array that gives the bearing.
        for (let i = 0; i < 3; i++) {
          const boom = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, p.radius * 2, 6), instrument)
          boom.rotation.z = Math.PI / 2
          boom.rotation.y = (i * 2 * Math.PI) / 3
          boom.position.set(
            Math.cos((i * 2 * Math.PI) / 3) * p.radius * 0.5, 0,
            Math.sin((i * 2 * Math.PI) / 3) * p.radius * 0.5)
          g.add(boom)
          const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 12, 10), instrument)
          cap.position.set(
            Math.cos((i * 2 * Math.PI) / 3) * p.radius, 0,
            Math.sin((i * 2 * Math.PI) / 3) * p.radius)
          g.add(cap)
        }
      } else if (p.id === 'solar') {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 2, p.height, p.radius * 1.2), instrument)
        panel.rotation.z = 0.22
        g.add(panel)
      } else if (p.id === 'camera') {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(p.radius * 0.55, p.radius * 0.55, p.height, 16),
          instrument)
        g.add(body)
        const eye = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), lens)
        eye.rotation.z = Math.PI / 2
        eye.position.set(p.radius * 0.6, 0, 0)
        g.add(eye)
      } else if (p.id === 'backhaul') {
        const dish = new THREE.Mesh(
          new THREE.SphereGeometry(p.radius * 0.8, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
          instrument)
        dish.rotation.x = Math.PI / 2.6
        g.add(dish)
      } else {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 1.5, p.height, p.radius * 1.5), instrument)
        g.add(box)
      }
      group.add(g)
      return { part: p, group: g }
    })

    // Ground: a ring and a faint grid, purely for scale. Without it the mast
    // floats and reads as a diagram rather than as a thirty-metre object.
    const groundColor = new THREE.Color(PALETTE.chart.axis)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.6, 48),
      new THREE.MeshBasicMaterial({
        color: groundColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    group.add(ring)
    const grid = new THREE.GridHelper(60, 12, groundColor, groundColor)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.16
    group.add(grid)

    scene.add(new THREE.AmbientLight(new THREE.Color(PALETTE.ink), 0.55))
    const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.4)
    key.position.set(14, 26, 12)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.meshTeal), 0.9)
    rim.position.set(-16, 8, -10)
    scene.add(rim)

    let raf = 0
    let current = t
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
      for (const { part, group: g } of parts) {
        g.position.y = explodedY(part, current)
      }
      // A slow turn, so the lattice reads as three-dimensional without
      // anyone having to drag it.
      group.rotation.y += 0.0025
      // Framed on the mast, pulling back as the assembly opens so it never
      // grows out of the panel. The vertical FOV is what binds on a wide
      // canvas, so the distance is set from the height, not from the width.
      const spread = 1 + current * 0.38
      camera.position.set(0, MAST_HEIGHT_M * 0.52, 31 * spread)
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
        for (const mat of [steel, instrument, lens]) mat.dispose()
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
    <div>
      <div
        ref={mount}
        role="img"
        aria-label={
          'An exploded view of the tower: camera head, microphone array, ' +
          'compute, solar and backhaul, separating along a 30 m lattice mast'
        }
        // A thirty-metre mast is a portrait subject. Left at full column
        // width it sits in the middle of a letterbox with the composition
        // doing nothing; capped, it fills its frame.
        style={{
          width: '100%', maxWidth: 460, margin: '0 auto',
          height, position: 'relative',
        }}
      />
      <ul style={{
        listStyle: 'none', margin: '10px 0 0', padding: 0,
        display: 'grid', gap: 5, fontSize: SIZE.small,
        color: PALETTE.chart.inkMuted,
      }}>
        {TOWER_PARTS.map((p) => (
          <li key={p.id} style={{ opacity: t > 0.15 ? 1 : 0.5, transition: 'opacity 200ms' }}>
            <span style={{ color: PALETTE.meshTeal }}>{p.label}</span>
            {' — '}{p.note}
          </li>
        ))}
      </ul>
    </div>
  )
}
