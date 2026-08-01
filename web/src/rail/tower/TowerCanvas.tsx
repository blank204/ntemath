import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { PALETTE } from '../../theme/palette'
import { LABEL } from '../../theme/type'
import {
  TOWER_PARTS, MAST_HEIGHT_M, MAST_WIDTH_M, EXPLODE_SPREAD_M, explodedY,
  latticeRungs, partProgress,
} from './towerModel'
import { loadParts } from './loadParts'

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
      // Opaque, not alpha. The sky is rendered inside the scene now, so the
      // pane's backdrop and the object's reflections are the same thing —
      // which is the arrangement that makes the reference site's object sit
      // in its picture rather than float on top of one.
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      // Filmic response and a little exposure headroom: without tone mapping
      // the emissive lens and beacon clip to flat white the moment bloom
      // touches them.
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
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
        //
        // Thicker and shorter than the first attempt, with the windscreens
        // seated directly on the boom ends rather than raised on little
        // stalks. Thin rods with small balls on stalks read as an insect,
        // which is what this looked like: a real array is a chunky thing,
        // because a microphone that has to survive a boreal winter lives
        // inside a foam windscreen the size of a fist.
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.5, 0.9, 16), housing)
        g.add(hub)
        const collar = new THREE.Mesh(
          new THREE.TorusGeometry(0.5, 0.07, 8, 20), instrument)
        collar.rotation.x = Math.PI / 2
        g.add(collar)
        const reach = p.radius * 0.78
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3
          const boom = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.085, reach, 10), housing)
          boom.rotation.z = Math.PI / 2
          boom.rotation.y = -a
          boom.position.set(Math.cos(a) * reach * 0.5, 0,
            Math.sin(a) * reach * 0.5)
          g.add(boom)
          // The windscreen: a fist-sized foam ball, slightly squashed, with
          // the capsule collar visible where it meets the boom.
          const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.36, 18, 14), instrument)
          ball.scale.set(1, 0.88, 1)
          ball.position.set(Math.cos(a) * reach, 0, Math.sin(a) * reach)
          g.add(ball)
          const capsule = new THREE.Mesh(
            new THREE.CylinderGeometry(0.13, 0.13, 0.18, 10), housing)
          capsule.rotation.z = Math.PI / 2
          capsule.rotation.y = -a
          capsule.position.set(Math.cos(a) * (reach - 0.34), 0,
            Math.sin(a) * (reach - 0.34))
          g.add(capsule)
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

    /*
     * THE DOWNLOADED PARTS. Loaded after the procedural scene is standing, so
     * the mast is on screen immediately and the models arrive when they
     * arrive — a slow connection gets a tower, not an empty pane.
     *
     * Solar and antenna REPLACE the primitives that stood in for them: those
     * were a tilted box and a hemisphere, and a real panel and a real antenna
     * are the parts the bill of materials actually specifies. The spruce and
     * the transmission tower are the two mounting structures the system is
     * designed to attach to, and they are here because they are not ours —
     * the hardware costs $960 a unit precisely because somebody else already
     * paid for the steel and the trees were always there.
     */
    let cancelled = false
    loadParts([
      { name: 'solar', material: instrument },
      { name: 'antenna', material: instrument },
      { name: 'pine', material: braceSteel },
      { name: 'pylon', material: legSteel },
    ]).then((got) => {
      if (cancelled) return

      // Swap the two stand-ins out of their part groups and the real meshes in.
      for (const [id, key] of [['solar', 'solar'], ['backhaul', 'antenna']] as const) {
        const slot = parts.find((p) => p.part.id === id)
        const model = got[key]
        if (!slot || !model) continue
        for (const child of [...slot.group.children]) slot.group.remove(child)
        slot.group.add(model)
      }

      // Spruce around the base, at fixed offsets. Deterministic, not random:
      // the same forest every load, and nothing in the render path may call
      // Math.random.
      if (got.pine) {
        for (const [x, z, sc] of [
          [-16, -9, 1.0], [13, -14, 0.82], [-9, 12, 0.92],
          [19, 7, 0.74], [-22, 3, 0.68], [6, 17, 0.88],
        ] as const) {
          const t = got.pine.clone(true)
          t.position.set(x, 0, z)
          t.scale.multiplyScalar(sc)
          t.rotation.y = x * 0.7 + z
          group.add(t)
        }
      }

      // One existing transmission tower, set back and to the side: the mast
      // is one mounting option and this is another, standing in the same
      // frame so the comparison is visible rather than asserted.
      if (got.pylon) {
        got.pylon.position.set(-34, 0, -26)
        got.pylon.rotation.y = 0.5
        group.add(got.pylon)
      }
    })

    // Ground: a plane that only exists to catch shadow, plus a ring and a
    // faint grid for scale. Without them the mast floats and reads as a
    // diagram rather than as a thirty-metre object.
    const groundColor = new THREE.Color(PALETTE.chart.axis)
    // A real dark ground rather than a THREE.ShadowMaterial. The shadow-only
    // material renders its unshadowed area as a pale sheet once it goes
    // through the EffectComposer's float target and the OutputPass, so the
    // scene sat on a light grey plate under a night sky. A standard material
    // in a palette colour is one fewer thing depending on how alpha survives
    // post-processing, and a night forest floor should be visible anyway —
    // the mast is standing ON something.
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      track(new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE.canvas),
        roughness: 0.96, metalness: 0.0,
      })),
    )
    shadowCatcher.rotation.x = -Math.PI / 2
    shadowCatcher.receiveShadow = true
    group.add(shadowCatcher)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.6, 48),
      track(new THREE.MeshBasicMaterial({
        color: groundColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      })),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    group.add(ring)
    const grid = new THREE.GridHelper(120, 24, groundColor, groundColor)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.1
    group.add(grid)

    /**
     * THE ENVIRONMENT, AND WHY THE TOWER LOOKED LIKE PLASTIC WITHOUT IT.
     *
     * The legs are `metalness: 0.72`. A metal surface has essentially no
     * diffuse term — it renders what it reflects and nothing else. With no
     * environment in the scene there was nothing to reflect, so every member
     * fell back to flat shading and the whole mast read as grey plastic. This
     * is the single biggest reason the object did not look like the reference
     * site's: every Spline scene ships an HDRI by default, and that is most of
     * why they look expensive without anyone choosing to make them so.
     *
     * Painted rather than downloaded: a night storm over water, as an
     * equirectangular gradient with a lit cloud break high on the left, where
     * this page's field is lit from. No HDR to fetch, no licence to record,
     * about 4 KB of canvas, and it is the same storm the rest of the site is.
     */
    const sky = document.createElement('canvas')
    sky.width = 1024
    sky.height = 512
    const g2 = sky.getContext('2d')!
    const band = g2.createLinearGradient(0, 0, 0, sky.height)
    band.addColorStop(0.00, '#050b20')   // zenith, nearly black
    band.addColorStop(0.30, '#0b1738')
    band.addColorStop(0.47, '#22356e')
    band.addColorStop(0.52, '#33488c')   // the horizon, the brightest thing
    band.addColorStop(0.57, '#0d1730')
    band.addColorStop(1.00, '#03060f')   // the water below
    g2.fillStyle = band
    g2.fillRect(0, 0, sky.width, sky.height)

    // Cloud banding. Flat gradients read as a painted wall — a storm has
    // structure, and soft horizontal bars are enough to suggest it once the
    // background is blurred. Deterministic offsets, not random: the same sky
    // every load, and no Math.random anywhere in the render path.
    //
    // Weighted towards the TOP of the frame. At rest the camera is low and
    // angled up, so most of what a reader sees is the zenith — and with only
    // horizon-height bands that upper half was the plainest part of the shot,
    // which is the "sky is a bit flat" note. Overhead cloud is also what a
    // storm actually looks like from underneath it.
    for (const [cy, h, a] of [
      [14, 34, 0.34], [46, 40, 0.30], [86, 46, 0.30], [118, 26, 0.24],
      [140, 30, 0.22], [168, 24, 0.20], [196, 22, 0.16],
      [232, 34, 0.20], [268, 18, 0.13],
    ] as const) {
      const c = g2.createLinearGradient(0, cy - h, 0, cy + h)
      c.addColorStop(0, 'rgba(4,8,22,0)')
      c.addColorStop(0.5, `rgba(4,8,22,${a})`)
      c.addColorStop(1, 'rgba(4,8,22,0)')
      g2.fillStyle = c
      g2.fillRect(0, cy - h, sky.width, h * 2)
    }
    // Two soft lit patches high up, where the cloud is thinner. Without them
    // the overhead half is one tone no matter how many dark bars go over it,
    // and the metal has nothing to catch when the camera is looking up.
    for (const [x, y, r, a] of [
      [640, 60, 210, 0.30], [180, 96, 150, 0.20],
    ] as const) {
      const c = g2.createRadialGradient(x, y, 4, x, y, r)
      c.addColorStop(0, `rgba(122,156,232,${a})`)
      c.addColorStop(1, 'rgba(122,156,232,0)')
      g2.fillStyle = c
      g2.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // The break in the cloud the storm is lit through. Equirectangular, so x
    // is azimuth: this sits behind and to the left of the camera's start.
    const glow = g2.createRadialGradient(300, 150, 10, 300, 150, 260)
    glow.addColorStop(0, 'rgba(146,178,255,0.95)')
    glow.addColorStop(0.4, 'rgba(90,124,214,0.40)')
    glow.addColorStop(1, 'rgba(90,124,214,0)')
    g2.fillStyle = glow
    g2.fillRect(0, 0, sky.width, sky.height)
    // A second, colder break opposite it, so the metal has something to catch
    // on its far side and the object never has a completely dead edge.
    const glow2 = g2.createRadialGradient(830, 205, 8, 830, 205, 170)
    glow2.addColorStop(0, 'rgba(120,150,220,0.55)')
    glow2.addColorStop(1, 'rgba(120,150,220,0)')
    g2.fillStyle = glow2
    g2.fillRect(0, 0, sky.width, sky.height)

    const skyTex = new THREE.CanvasTexture(sky)
    skyTex.mapping = THREE.EquirectangularReflectionMapping
    skyTex.colorSpace = THREE.SRGBColorSpace

    const pmrem = new THREE.PMREMGenerator(renderer)
    const envRT = pmrem.fromEquirectangular(skyTex)
    scene.environment = envRT.texture
    // The same sky is the backdrop, not just the reflection. That is what the
    // reference site does — the room behind its object is also the room the
    // object is reflecting — and it replaces a CSS gradient that banded.
    scene.background = envRT.texture
    // Blurred and dimmed as a BACKDROP while staying bright as a REFLECTION.
    // These two knobs are separate for exactly this reason: darkening the
    // environment itself to calm the backdrop would take the highlights off
    // the steel with it, which is the problem this whole change is fixing.
    scene.backgroundBlurriness = 0.6
    scene.backgroundIntensity = 0.42
    // Distance haze, so the ground grid dissolves into the horizon instead of
    // ending in a hard square edge.
    scene.fog = new THREE.Fog(new THREE.Color('#0b1430'), 60, 190)

    // Key, rim and a soft fill on top of the image-based lighting. The
    // hemisphere light is gone: with a real environment it was double-counting
    // the sky and washing the shadow side flat.
    // High and to the side. Lower than this and a 30 m mast throws a shadow
    // sixty metres long that runs off the frame and reads as a mistake.
    const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.2)
    key.position.set(30, 74, 26)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 140
    const s = 34
    key.shadow.camera.left = -s
    key.shadow.camera.right = s
    key.shadow.camera.top = s * 1.4
    key.shadow.camera.bottom = -s * 0.3
    key.shadow.bias = -0.0012
    key.shadow.normalBias = 0.03
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.signal), 1.8)
    rim.position.set(-24, 12, -18)
    scene.add(rim)

    // Everything steel casts and receives. Done after the whole tree exists
    // so nothing has to remember to set it at construction.
    group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m !== shadowCatcher) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })

    /**
     * Bloom, so the lens and the obstruction beacon read as light sources
     * rather than as bright paint. Threshold is high on purpose: only the
     * emissive parts should glow, and a low threshold turns the whole
     * galvanised mast into a haze.
     */
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1), 0.62, 0.75, 0.92)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    let raf = 0
    let current = t
    let spin = 0
    const size = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      const dpr = Math.min(window.devicePixelRatio, 2)
      renderer.setPixelRatio(dpr)
      renderer.setSize(w, h, false)
      composer.setPixelRatio(dpr)
      composer.setSize(w, h)
      bloom.resolution.set(w, h)
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

      // THE CAMERA IS THE SHOT, and it moves through two of them.
      //
      // At rest: low, close, angled up, with the top of the mast cropping out
      // of frame. A thirty-metre lattice is a slender object — framed whole
      // and centred it reads as a thin diagram of a tower, which is what the
      // first attempt at this looked like. Looking up at it from underneath
      // is what makes it thirty metres.
      //
      // Fully open: pulled back and level, because by then the subject is no
      // longer the mast, it is five subsystems laid out in the air, and the
      // reader has to be able to see all of them at once.
      //
      // Everything between is an interpolation, so the shot travels with the
      // reveal rather than cutting.
      const needed = MAST_HEIGHT_M + EXPLODE_SPREAD_M * 1.05 + 10
      const vFov = (camera.fov * Math.PI) / 180
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
      const wide = Math.max(
        (needed / 2) / Math.tan(vFov / 2),
        (needed * 0.42) / Math.tan(hFov / 2),
      )
      // Smoothstep the move so it eases rather than tracking the scroll
      // linearly, which reads as a mechanism rather than as a camera.
      const e = opened * opened * (3 - 2 * opened)
      const dist = 24 + (wide - 24) * e
      camera.position.set(0, 5 + (MAST_HEIGHT_M * 0.5 - 5) * e, dist)
      camera.lookAt(0, MAST_HEIGHT_M * (0.72 - 0.28 * e), 0)
      composer.render()
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
        cancelled = true
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
        // The environment, its PMREM render target and the composer's own
        // buffers are all GPU allocations React StrictMode would otherwise
        // leak a second copy of on its double mount.
        envRT.dispose()
        pmrem.dispose()
        skyTex.dispose()
        composer.dispose()
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
