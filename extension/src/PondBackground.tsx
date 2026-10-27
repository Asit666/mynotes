import { useEffect, useRef } from 'react'

export interface PondBackgroundProps {
  theme: 'light' | 'dark'
  paused?: boolean
}

export default function PondBackground({ theme, paused = false }: PondBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDarkRef = useRef(theme === 'dark')
  const pausedRef = useRef(paused)
  const onThemeSwitchRef = useRef<((dark: boolean) => void) | null>(null)
  const kickRef = useRef<(() => void) | null>(null)
  const drawStaticRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    isDarkRef.current = theme === 'dark'
    if (onThemeSwitchRef.current) {
      onThemeSwitchRef.current(theme === 'dark')
    }
  }, [theme])

  useEffect(() => {
    pausedRef.current = paused
    if (paused) {
      if (drawStaticRef.current) drawStaticRef.current()
    } else {
      if (kickRef.current) kickRef.current()
    }
  }, [paused])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const cx = cv.getContext('2d')
    if (!cx) return

    const P = { speed: 1, count: isDarkRef.current ? 9 : 7, px: isDarkRef.current ? 8 : 6 }

    let W = window.innerWidth
    let H = window.innerHeight
    let grid: Int32Array
    let cellD: Float32Array
    let cellI: Int16Array
    let cellB: Float32Array
    let touched: Int32Array
    let stamp = 0
    let last = performance.now()
    let raf: number
    let active: any[] = []
    let backTex: HTMLCanvasElement | null = null
    let backCtx: CanvasRenderingContext2D | null = null
    let dust: Array<{
      x: number
      y: number
      size: number
      speed: number
      phase: number
      alpha: number
      drift: number
      seed: number
    }> = []

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    const wrapA = (a: number) => {
      while (a > Math.PI) a -= 6.283
      while (a < -Math.PI) a += 6.283
      return a
    }

    const NZ = new Uint8Array(65536)
    let nzSeed = 123456789
    for (let i = 0; i < 65536; i++) {
      nzSeed ^= nzSeed << 13
      nzSeed ^= nzSeed >>> 17
      nzSeed ^= nzSeed << 5
      NZ[i] = nzSeed & 255
    }
    const hash = (x: number, y: number) => NZ[(((x & 255) << 8) | (y & 255)) & 65535] / 255

    function bakeBackdrop() {
      if (!W || !H) return
      const dark = isDarkRef.current
      backTex = document.createElement('canvas')
      backTex.width = Math.max(1, Math.round(W))
      backTex.height = Math.max(1, Math.round(H))
      backCtx = backTex.getContext('2d')
      if (!backCtx) return

      backCtx.fillStyle = dark ? '#171817' : '#f8f8f6'
      backCtx.fillRect(0, 0, W, H)
      const vg = backCtx.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.08, W * 0.5, H * 0.48, Math.max(W, H) * 0.78)
      if (dark) {
        vg.addColorStop(0, 'rgba(42,43,40,.12)')
        vg.addColorStop(1, 'rgba(0,0,0,.1)')
      } else {
        vg.addColorStop(0, 'rgba(255,255,255,.1)')
        vg.addColorStop(1, 'rgba(206,209,207,.15)')
      }
      backCtx.fillStyle = vg
      backCtx.fillRect(0, 0, W, H)
      if (!dark) {
        backCtx.strokeStyle = 'rgba(70,76,82,.035)'
        backCtx.lineWidth = 1
        for (let x = 0; x < W; x += 5) {
          backCtx.beginPath()
          backCtx.moveTo(x + 0.5, 0)
          backCtx.lineTo(x + 0.5, H)
          backCtx.stroke()
        }
        for (let y = 0; y < H; y += 5) {
          backCtx.beginPath()
          backCtx.moveTo(0, y + 0.5)
          backCtx.lineTo(W, y + 0.5)
          backCtx.stroke()
        }
      }
      const step = dark ? 11 : 8
      for (let y = 3; y < H; y += step) {
        for (let x = 3; x < W; x += step) {
          const h = hash(Math.floor(x / step) + 17, Math.floor(y / step) + 31)
          if (h > (dark ? 0.94 : 0.91)) {
            backCtx.fillStyle = dark
              ? `rgba(205,199,180,${0.025 + (h - 0.94) * 0.22})`
              : `rgba(69,76,86,${0.025 + (h - 0.91) * 0.18})`
            const z = h > 0.985 ? 2 : 1
            backCtx.fillRect(x, y, z, z)
          }
        }
      }
      dust = Array.from({ length: Math.max(55, Math.min(150, Math.round((W * H) / 7500))) }, (_, i) => ({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() > 0.86 ? 2 : 1,
        speed: 5 + Math.random() * 13,
        phase: Math.random() * 6.283,
        alpha: 0.025 + Math.random() * 0.08,
        drift: (Math.random() - 0.5) * 7,
        seed: i + Math.floor(Math.random() * 1000),
      }))
    }

    function drawAtmosphere(t: number, dt: number, dark: boolean) {
      if (backTex) cx!.drawImage(backTex, 0, 0, W, H)
      for (let i = 0; i < dust.length; i++) {
        const p = dust[i]
        if (dt) {
          p.y -= p.speed * dt * (dark ? 0.32 : 0.55)
          p.x += Math.sin(t * 0.00017 + p.phase) * p.drift * dt
          if (p.y < -3) {
            p.y = H + 3
            p.x = Math.random() * W
          }
        }
        const pulse = 0.55 + 0.45 * Math.sin(t * 0.0007 + p.phase)
        cx!.globalAlpha = p.alpha * pulse * (dark ? 1 : 0.82)
        cx!.fillStyle = dark ? '#c9c7bd' : '#656c73'
        cx!.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size)
      }
      cx!.globalAlpha = 1
    }

    function size() {
      let r = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      if (W * H * r * r > 7e6) r = Math.max(1, Math.sqrt(7e6 / (W * H)))
      cv!.width = Math.round(W * r)
      cv!.height = Math.round(H * r)
      cx!.setTransform(cv!.width / W, 0, 0, cv!.height / H, 0, 0)
      cx!.imageSmoothingEnabled = false
      bakeBackdrop()
    }

    let SIDE = 0
    let curCs = 0
    let img: ImageData | null = null
    let dat: Uint8ClampedArray | null = null
    let cellCv: HTMLCanvasElement | null = null
    let cctx: CanvasRenderingContext2D | null = null
    let lay: HTMLCanvasElement | null = null
    let lx: CanvasRenderingContext2D | null = null
    const bwA = new Float32Array(1400)
    const fwA = new Float32Array(1400)
    const pats: Record<number, CanvasPattern> = {}

    function ensure() {
      const Cs = cellOf()
      const Lmax = Math.max(...sharks.map((s) => s.L), ...koi.map((s) => s.L))
      const side = Math.ceil((Lmax * 1.7) / Cs) + 8
      curCs = Cs
      const fine = Cs < 4
      if (side === SIDE && fine === Boolean(lay) && (!fine || lay!.width === side * Cs)) return
      SIDE = side
      const n = side * side
      grid = new Int32Array(n)
      cellD = new Float32Array(n)
      cellI = new Int16Array(n)
      cellB = new Float32Array(n)
      touched = new Int32Array(n)
      stamp = 0
      for (const k in pats) delete pats[k]
      if (fine) {
        img = new ImageData(side, side)
        dat = img.data
        cellCv = cellCv || document.createElement('canvas')
        cellCv.width = cellCv.height = side
        cctx = cellCv.getContext('2d')
        lay = lay || document.createElement('canvas')
        lay.width = lay.height = side * Cs
        lx = lay.getContext('2d')
        if (lx) lx.imageSmoothingEnabled = false
      } else {
        img = dat = cellCv = cctx = lay = lx = null
      }
    }

    function gapPat(gap: number, Cs: number) {
      const key = gap * 100 + Cs
      let p = pats[key]
      if (!p && lx) {
        const c = document.createElement('canvas')
        c.width = c.height = Cs
        const g = c.getContext('2d')
        if (g) {
          g.fillStyle = '#000'
          g.fillRect(Cs - gap, 0, gap, Cs)
          g.fillRect(0, Cs - gap, Cs, gap)
          p = pats[key] = lx.createPattern(c, 'repeat')!
        }
      }
      return p
    }

    const cellOf = () => Math.max(2, P.px)
    const SHARKS = [
      { hammer: 1, bwm: 0.056, c: [96, 108, 152], pf: 0.16 },
      { band: 1, bwm: 0.068, c: [150, 130, 108], pf: 0.14 },
      { whale: 1, bwm: 0.1, c: [74, 88, 114], pf: 0.15 },
      { spots: 1, bwm: 0.07, c: [140, 108, 80], pf: 0.14 },
      { hammer: 1, bwm: 0.052, c: [112, 118, 140], pf: 0.17 },
    ]

    const vn = (x: number, y: number, sd: number) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const fx = x - xi
      const fy = y - yi
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      const a = hash(xi + sd, yi)
      const b = hash(xi + 1 + sd, yi)
      const c = hash(xi + sd, yi + 1)
      const d = hash(xi + 1 + sd, yi + 1)
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }

    const mk = (i: number, kind: string) => {
      const sc = clamp(Math.min(window.innerWidth, window.innerHeight) / 760, 0.55, 1.5)
      const k = kind === 'koi'
      const L = (k ? 150 + Math.random() * 100 : 230 + Math.random() * 150) * sc
      const v0 = L * (k ? 0.3 + Math.random() * 0.18 : 0.17 + Math.random() * 0.1)
      return {
        id: i,
        kind,
        T: k ? {} : SHARKS[i % SHARKS.length],
        var: (i * 7) % 6,
        L,
        v0,
        sp: v0,
        h: Math.random() * 6.283,
        om: 0,
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        ph: Math.random() * 6.283,
        ph2: Math.random() * 6.283,
        w1: 0.6 + Math.random() * 0.6,
        beat: Math.random() * 6.283,
        sd: Math.floor(Math.random() * 999),
        burst: 0,
        curlT: 0,
        curlDir: 1,
        alpha: 1,
        cxs: null as Float32Array | null,
        cys: null as Float32Array | null,
      }
    }

    const sharks = Array.from({ length: 14 }, (_, i) => mk(i, 'shark'))
    const koi = Array.from({ length: 14 }, (_, i) => mk(i, 'koi'))
    const ripples: Array<{ x: number; y: number; a: number; big?: number }> = []
    const ripple = (x: number, y: number) => {
      if (ripples.length < 12) ripples.push({ x, y, a: 0 })
    }
    for (let i = 0; i < 3; i++) ripple(Math.random() * window.innerWidth, Math.random() * window.innerHeight)
    let tgt = { x: 0, y: 0, until: 0 }

    const setActive = () => {
      active = (isDarkRef.current ? koi : sharks).slice(0, P.count)
    }

    let bw = 0
    let fw = 0
    function widths(u: number, s: any) {
      const L = s.L
      const T = s.T
      if (s.kind === 'koi') {
        const e = (u - 0.68) / 0.32
        bw = e > -1 && e < 1 ? L * 0.155 * Math.sqrt(1 - e * e) : 0
        if (u > 0.2 && u < 0.5) bw = Math.max(bw, L * 0.04 * Math.min(1, (u - 0.2) / 0.12))
        let tf = 0
        if (u < 0.34 && u >= 0.12) tf = L * (0.035 + 0.095 * Math.sin(((0.34 - u) / 0.22) * 1.5708))
        else if (u < 0.12) tf = L * 0.15 * Math.sqrt(Math.max(0, 1 - Math.pow((0.12 - u) / 0.12, 2)))
        const fl = 1 + 0.25 * Math.sin(s.beat * 0.5)
        const pf = u >= 0.62 && u <= 0.8 ? (L * 0.085 * fl * (0.8 - u)) / 0.18 : 0
        const vf = u >= 0.44 && u <= 0.56 ? (L * 0.07 * fl * (0.56 - u)) / 0.12 : 0
        fw = Math.max(tf - bw, 0, pf, vf)
        return
      }
      const wh = T.whale
      bw = L * T.bwm * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, 1.357))), wh ? 0.5 : 0.8)
      bw *= 0.2 + 0.8 * Math.pow(Math.min(1, u / 0.34), 1.5)
      if (wh && u > 0.9) bw = Math.max(bw, L * 0.1 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.9) / 0.1, 2))))
      if (u < 0.04) bw = 0
      if (T.hammer && u > 0.905) {
        const q = (u - 0.905) / 0.095
        bw = Math.max(bw, L * 0.17 * (q < 0.35 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((q - 0.35) / 0.65, 2)))))
      }
      const fl = 1 + 0.1 * Math.sin(s.beat * 0.5)
      const E = L * T.pf
      fw = u > 0.5 && u < 0.68 ? ((E * (0.68 - u)) / 0.18) * fl : 0
      if (u > 0.3 && u < 0.38) fw = Math.max(fw, (L * 0.05 * (0.38 - u)) / 0.08)
      if (u < 0.17) fw = Math.max(fw, L * 0.055 * Math.pow(1 - u / 0.17, 0.7) - bw)
    }

    const NS = 26
    const spx = new Float32Array(NS + 1)
    const spy = new Float32Array(NS + 1)
    const spa = new Float32Array(NS + 1)
    function follow(s: any) {
      const seg = s.L / NS
      if (!s.cxs) {
        s.cxs = new Float32Array(NS + 1)
        s.cys = new Float32Array(NS + 1)
        for (let i = 0; i <= NS; i++) {
          s.cxs[i] = s.x - Math.cos(s.h) * seg * i
          s.cys[i] = s.y - Math.sin(s.h) * seg * i
        }
      }
      s.cxs[0] = s.x
      s.cys[0] = s.y
      for (let i = 1; i <= NS; i++) {
        const dx = s.cxs[i] - s.cxs[i - 1]
        const dy = s.cys[i] - s.cys[i - 1]
        const d = Math.hypot(dx, dy) || 1e-6
        s.cxs[i] = s.cxs[i - 1] + (dx / d) * seg
        s.cys[i] = s.cys[i - 1] + (dy / d) * seg
      }
    }

    const tmx = new Float32Array(NS + 1)
    const tmy = new Float32Array(NS + 1)
    function buildSpine(s: any) {
      if (!s.cxs) follow(s)
      const k = s.kind === 'koi'
      const amp = (k ? 0.085 : 0.06) * s.L * (0.65 + 0.45 * Math.min(1, s.sp / s.v0))
      for (let i = 0; i <= NS; i++) {
        const i0 = Math.max(0, i - 1)
        const i1 = Math.min(NS, i + 1)
        const tx = s.cxs[i0] - s.cxs[i1]
        const ty = s.cys[i0] - s.cys[i1]
        const l = Math.hypot(tx, ty) || 1
        const w = i / NS
        const off = amp * (0.03 + 0.97 * w * w) * Math.sin(s.beat - w * 4)
        spx[i] = s.cxs[i] - (ty / l) * off
        spy[i] = s.cys[i] + (tx / l) * off
      }
      for (let p = 0; p < 2; p++) {
        for (let i = 1; i < NS; i++) {
          tmx[i] = (spx[i - 1] + 2 * spx[i] + spx[i + 1]) / 4
          tmy[i] = (spy[i - 1] + 2 * spy[i] + spy[i + 1]) / 4
        }
        for (let i = 1; i < NS; i++) {
          spx[i] = tmx[i]
          spy[i] = tmy[i]
        }
      }
      for (let i = 0; i <= NS; i++) {
        const i0 = Math.max(0, i - 1)
        const i1 = Math.min(NS, i + 1)
        spa[i] = Math.atan2(spy[i0] - spy[i1], spx[i0] - spx[i1])
      }
    }

    function swim(s: any, t: number, dt: number, set: any[]) {
      const k = s.kind === 'koi'
      const lim = Math.min(k ? 1 : 0.55, ((k ? 2.4 : 1.6) * s.sp) / s.L)
      const far = s.L * 1.4
      if (s.x < -far || s.x > W + far || s.y < -far || s.y > H + far) {
        const e = (Math.random() * 4) | 0
        const m = s.L * 1.2
        s.x = e === 0 ? -m : e === 1 ? W + m : Math.random() * W
        s.y = e === 2 ? -m : e === 3 ? H + m : Math.random() * H
        s.h = Math.atan2(H / 2 - s.y, W / 2 - s.x) + (Math.random() - 0.5)
        s.om = 0
        s.cxs = null
      }
      let wt = Math.sin(t * 0.00032 * s.w1 + s.ph) * (k ? 0.45 : 0.3) + Math.sin(t * 0.00081 * s.w1 + s.ph2) * (k ? 0.25 : 0.15)
      if (k) {
        if (s.curlT > 0) {
          s.curlT -= dt
          wt = s.curlDir * 0.85
        } else if (Math.random() < dt * 0.1) {
          s.curlT = 1.3 + Math.random() * 1.3
          s.curlDir = Math.random() < 0.5 ? -1 : 1
        }
        if (Math.random() < dt * 0.05) {
          s.burst = 1
          ripple(s.x, s.y)
        }
      }
      const edge = Math.min(s.x, W - s.x, s.y, H - s.y)
      const zone = s.L * 0.9
      if (edge < zone) {
        wt +=
          clamp(
            wrapA(Math.atan2(H / 2 + Math.sin(s.ph2) * H * 0.3 - s.y, W / 2 + Math.cos(s.ph) * W * 0.3 - s.x) - s.h),
            -1,
            1,
          ) *
          1.6 *
          clamp((zone - edge) / zone, 0, 1.4)
      }
      if (tgt.until > t) {
        const dx = tgt.x - s.x
        const dy = tgt.y - s.y
        if (Math.hypot(dx, dy) > s.L * 0.45) wt += clamp(wrapA(Math.atan2(dy, dx) - s.h), -1, 1) * 1.6
      }
      for (const o of set) {
        if (o === s) continue
        const dx = s.x - o.x
        const dy = s.y - o.y
        const d = Math.hypot(dx, dy)
        const R = (s.L + o.L) * 0.4
        if (d < R && d > 0) wt += clamp(wrapA(Math.atan2(dy, dx) - s.h), -1, 1) * (1 - d / R) * 1.6
      }
      wt = clamp(wt, -lim, lim)
      s.om += (wt - s.om) * Math.min(1, dt * (k ? 2.2 : 1.4))
      s.h += s.om * dt
      s.burst = Math.max(0, s.burst - dt * 0.7)
      const target = s.v0 * (1 + 1.3 * s.burst) * (1 - 0.18 * Math.min(1, Math.abs(s.om) / lim))
      s.sp += (target - s.sp) * Math.min(1, dt * 2)
      s.beat += dt * 6.283 * (0.5 + (1.1 * s.sp) / s.L) * (1 + 0.4 * s.burst)
      s.x += Math.cos(s.h) * s.sp * dt
      s.y += Math.sin(s.h) * s.sp * dt
      const dp = 0.5 + 0.5 * Math.sin(t * 0.00018 * s.w1 + s.ph2)
      s.alpha = k ? 0.5 + 0.5 * dp : 0.72 + 0.28 * dp
      follow(s)
    }

    let CR = 0
    let CG = 0
    let CB = 0
    let CA = 1
    const cstr = new Map<number, string>()
    function colStr() {
      const r = CR < 0 ? 0 : CR > 255 ? 255 : CR | 0
      const g = CG < 0 ? 0 : CG > 255 ? 255 : CG | 0
      const b = CB < 0 ? 0 : CB > 255 ? 255 : CB | 0
      const ai = (CA * 7 + 0.5) | 0
      const key = ((r >> 3) << 13) | ((g >> 3) << 8) | ((b >> 3) << 3) | ai
      let v = cstr.get(key)
      if (v === undefined) {
        if (cstr.size > 3000) cstr.clear()
        v = `rgba(${(r >> 3) * 8 + 4},${(g >> 3) * 8 + 4},${(b >> 3) * 8 + 4},${(ai / 7).toFixed(2)})`
        cstr.set(key, v)
      }
      return v
    }

    function sharkCol(s: any, body: boolean, d: number, u: number, tu: number, tb: number, ab: number, Cs: number) {
      const T = s.T
      let r = T.c[0]
      let g = T.c[1]
      let b = T.c[2]
      if (!body) {
        const x = 0.8 + 0.2 * vn(tu, tb, s.sd + 3)
        CR = r * x
        CG = g * x
        CB = b * x
        CA = 0.55
        return
      }
      const e = ab / Math.max(bw, 1)
      const fu = Math.floor(tu)
      const fb = Math.floor(tb)
      let m = 0.6 + 0.34 * d + (u > 0.3 ? 0.08 : 0)
      m += (vn(tu * 1.3 + 7, tb * 1.3, s.sd) - 0.5) * 0.24
      if (T.band && u > 0.25 && fu % 7 < 3) {
        r *= 0.5
        g *= 0.46
        b *= 0.42
        m += 0.25
      }
      if (T.spots && vn(tu * 0.5, tb * 0.5, s.sd) > 0.7) {
        r *= 0.4
        g *= 0.34
        b *= 0.28
        m += 0.2
      }
      if (T.whale && u > 0.2 && u < 0.93 && fu % 3 === 1 && (((fb % 3) + 3) % 3) === 1) {
        r = g = b = 238
        m = 0.9
      }
      if (ab < Cs * 0.8 && u > 0.3 && u < 0.93) m = Math.min(1, m * 1.2)
      if (u > 0.755 && u < 0.79 && e > 0.4 && e < 0.92) m = Math.min(1, m + 0.3)
      m = clamp(m * (0.6 + 0.4 * clamp(u / 0.35, 0, 1)), 0.15, 1)
      const tm = Cs >= 5 ? (vn(tu * 2.1, tb * 2.1, s.sd + 9) > 0.5 ? 0.94 : 1.04) : 1
      CR = (255 - (255 - r) * m) * tm
      CG = (255 - (255 - g) * m) * tm
      CB = (255 - (255 - b) * m) * tm
      CA = Math.min(0.97, 0.8 + d * 0.3)
    }

    function koiCol(s: any, body: boolean, ab: number, tu: number, tb: number, u: number, Cs: number) {
      if (!body) {
        const a = (0.3 + 0.28 * vn(tu * 1.5, tb * 1.5, s.sd + 3) + ((Math.floor(tb) & 1) ? 0.12 : 0)) * (u < 0.34 ? 0.55 + 0.45 * clamp(u * 3, 0, 1) : 1.15)
        CR = 88
        CG = 88
        CB = 96
        CA = Math.min(0.85, a)
        return
      }
      const V = s.var
      const e = ab / Math.max(bw, 1)
      const n = vn(tu * 0.42, tb * 0.42, s.sd)
      const n2 = vn(tu * 0.9 + 9, tb * 0.9, s.sd)
      const j = (vn(tu * 1.7 + 5, tb * 1.7, s.sd) - 0.5) * 14
      const w = 238 - 72 * e * e + 3 * Math.sin(tu * 2.2) * Math.sin(tb * 2.2)
      let r = w + j
      let g = w + j
      let b = w + j + 2
      if (V === 3) {
        const v = w / 238
        r = 228 * v + j
        g = 152 * v + j
        b = 54 * v + j
      } else if (V === 2) {
        r = g = b = 54 + e * 30 + j
        if (n > 0.55) {
          r = 232
          g = 116
          b = 46
        } else if (n < 0.3) {
          r = g = b = w + j
        }
      } else if (V === 4) {
        if (u > 0.8 && u < 0.97 && e < 0.78) {
          r = 214 + j
          g = 62 + j
          b = 38 + j
        }
      } else {
        if (V !== 5 && n > 0.62 - (u > 0.9 ? 0.1 : 0)) {
          const t = Math.min(1, (n - 0.6) * 3)
          r = 232 - 26 * t + j
          g = 116 - 42 * t + j
          b = 48 - 16 * t + j
        } else if (V === 1 && n2 > 0.8) {
          r = g = b = 60 + j
        }
      }
      let f = 1
      if (ab < Cs * 0.7 && u > 0.42 && u < 0.7) f = 0.8
      if (u > 0.795 && u < 0.82 && e > 0.25 && e < 0.95) f = Math.min(f, 0.74)
      const row = Math.floor((tb + 12) * 1.35)
      const phase = tu * 1.42 + ((row & 1) ? 1.5708 : 0)
      const scaleLight = 1 + 0.045 * Math.sin(phase) * (0.55 + 0.45 * Math.cos(tb * 3.14159))
      const scaleEdge = 1 - 0.025 * Math.abs(Math.sin(phase * 0.5 + row * 0.8))
      CR = r * f * scaleLight * scaleEdge
      CG = g * f * scaleLight * scaleEdge
      CB = b * f * scaleLight * scaleEdge
      CA = 1
    }

    function pointOnSpine(u: number) {
      const f = (1 - u) * NS
      const i0 = Math.min(NS - 1, Math.max(0, f | 0))
      const fr = f - i0
      return {
        x: spx[i0] + (spx[i0 + 1] - spx[i0]) * fr,
        y: spy[i0] + (spy[i0 + 1] - spy[i0]) * fr,
        a: spa[i0] + (spa[i0 + 1] - spa[i0]) * fr,
      }
    }

    function drawAnatomy(s: any, _dark: boolean, Cs: number) {
      const k = s.kind === 'koi'
      if (!k) {
        cx!.lineWidth = Math.max(1, Cs * 0.16)
        cx!.lineCap = 'square'
        for (let j = 0; j < 4; j++) {
          const u = 0.755 + j * 0.018
          const pt = pointOnSpine(u)
          widths(u, s)
          const nx = -Math.sin(pt.a)
          const ny = Math.cos(pt.a)
          const len = Math.max(Cs * 1.1, bw * 0.72)
          cx!.strokeStyle = 'rgba(25,30,39,.54)'
          cx!.beginPath()
          cx!.moveTo(pt.x - nx * len, pt.y - ny * len)
          cx!.lineTo(pt.x + nx * len, pt.y + ny * len)
          cx!.stroke()
          cx!.strokeStyle = 'rgba(235,238,239,.22)'
          cx!.beginPath()
          cx!.moveTo(pt.x - nx * len * 0.72 + 1, pt.y - ny * len * 0.72 + 1)
          cx!.lineTo(pt.x + nx * len * 0.72 + 1, pt.y + ny * len * 0.72 + 1)
          cx!.stroke()
        }
        const nose = pointOnSpine(0.985)
        cx!.fillStyle = 'rgba(24,28,35,.68)'
        cx!.fillRect(Math.round(nose.x - Cs * 0.8), Math.round(nose.y - Cs * 0.12), Math.max(2, Cs * 0.55), Math.max(1, Cs * 0.22))
        cx!.strokeStyle = 'rgba(28,33,42,.24)'
        cx!.lineWidth = Math.max(1, Cs * 0.12)
        for (let u = 0.535; u < 0.665; u += 0.032) {
          const pt = pointOnSpine(u)
          widths(u, s)
          if (fw < Cs * 0.5) continue
          const nx = -Math.sin(pt.a)
          const ny = Math.cos(pt.a)
          for (const side of [-1, 1]) {
            cx!.beginPath()
            cx!.moveTo(pt.x + nx * side * (bw + Cs * 0.15), pt.y + ny * side * (bw + Cs * 0.15))
            cx!.lineTo(pt.x + nx * side * (bw + fw * 0.78), pt.y + ny * side * (bw + fw * 0.78))
            cx!.stroke()
          }
        }
      } else {
        cx!.strokeStyle = 'rgba(37,38,42,.25)'
        cx!.lineWidth = Math.max(0.8, Cs * 0.1)
        for (let u = 0.475; u < 0.685; u += 0.027) {
          const pt = pointOnSpine(u)
          widths(u, s)
          if (fw < Cs * 0.6) continue
          const nx = -Math.sin(pt.a)
          const ny = Math.cos(pt.a)
          for (const side of [-1, 1]) {
            cx!.beginPath()
            cx!.moveTo(pt.x + nx * side * (bw + Cs * 0.1), pt.y + ny * side * (bw + Cs * 0.1))
            cx!.lineTo(pt.x + nx * side * (bw + fw * 0.9), pt.y + ny * side * (bw + fw * 0.9))
            cx!.stroke()
          }
        }
        const root = pointOnSpine(0.16)
        const tail = pointOnSpine(0.28)
        widths(0.22, s)
        cx!.strokeStyle = 'rgba(48,48,50,.24)'
        cx!.lineWidth = Math.max(0.8, Cs * 0.1)
        for (let j = -3; j <= 3; j++) {
          const n1 = j * Cs * 0.52
          const n2 = j * Cs * 1.5
          const ax = root.x - Math.sin(root.a) * n1
          const ay = root.y + Math.cos(root.a) * n1
          const bx = tail.x - Math.sin(tail.a) * n2
          const by = tail.y + Math.cos(tail.a) * n2
          cx!.beginPath()
          cx!.moveTo(ax, ay)
          cx!.lineTo(bx, by)
          cx!.stroke()
        }
      }
    }

    function drawWake(s: any, dark: boolean, Cs: number) {
      const nx = -Math.sin(s.h)
      const ny = Math.cos(s.h)
      const dirX = -Math.cos(s.h)
      const dirY = -Math.sin(s.h)
      for (let i = 0; i < 11; i++) {
        const d = (i + 2) * Cs * 1.35
        const side = Math.sin(s.beat * 0.35 + i * 1.7) * Cs * (1 + i * 0.16)
        const x = s.x - Math.cos(s.h) * s.L * 0.17 + dirX * d + nx * side
        const y = s.y - Math.sin(s.h) * s.L * 0.17 + dirY * d + ny * side
        if (x < 0 || x > W || y < 0 || y > H || hash(i + s.id * 19, Math.floor(s.beat * 2)) < 0.48) continue
        cx!.globalAlpha = s.alpha * (1 - i / 12) * (dark ? 0.28 : 0.23)
        cx!.fillStyle = dark ? (i % 3 === 0 ? '#e2a36f' : '#dedbd0') : '#48505b'
        const z = i % 4 === 0 ? Cs * 0.55 : Math.max(1, Cs * 0.25)
        cx!.fillRect(Math.round(x), Math.round(y), z, z)
      }
      cx!.globalAlpha = 1
    }

    function drawCreature(s: any, _t: number, dark: boolean) {
      const L = s.L
      const k = s.kind === 'koi'
      const Cs = cellOf()
      const step = Math.max(Cs * 0.5, 1.1)
      const gap = k ? (Cs >= 8 ? 2 : Cs > 3 ? 1 : 0) : Cs > 3 ? 1 : 0
      buildSpine(s)
      let mnx = 1e9
      let mny = 1e9
      let mxx = -1e9
      let mxy = -1e9
      for (let i = 0; i <= NS; i++) {
        const x = spx[i]
        const y = spy[i]
        if (x < mnx) mnx = x
        if (x > mxx) mxx = x
        if (y < mny) mny = y
        if (y > mxy) mxy = y
      }
      const m = L * 0.3 + Cs * 2
      const ox = Math.floor((mnx - m) / Cs)
      const oy = Math.floor((mny - m) / Cs)
      let wc = Math.ceil((mxx + m) / Cs) - ox + 1
      let hc = Math.ceil((mxy + m) / Cs) - oy + 1
      if (wc > SIDE) wc = SIDE
      if (hc > SIDE) hc = SIDE
      if ((ox + wc) * Cs < 0 || ox * Cs > W || (oy + hc) * Cs < 0 || oy * Cs > H) return
      const NU = Math.min(bwA.length - 1, Math.ceil(L / step))
      stamp++
      let nt = 0
      for (let ui = 0; ui <= NU; ui++) {
        const u = 1 - ui / NU
        const f = (1 - u) * NS
        const i0 = Math.min(NS - 1, f | 0)
        const fr = f - i0
        const bx = spx[i0] + (spx[i0 + 1] - spx[i0]) * fr
        const by = spy[i0] + (spy[i0 + 1] - spy[i0]) * fr
        const a = spa[i0] + (spa[i0 + 1] - spa[i0]) * fr
        const nx = -Math.sin(a)
        const ny = Math.cos(a)
        widths(u, s)
        bwA[ui] = bw
        fwA[ui] = fw
        const nb = Math.ceil((bw + fw + Cs * 1.6) / step)
        for (let j = -nb; j <= nb; j++) {
          const b = j * step
          const X = bx + nx * b
          const Y = by + ny * b
          const gx = Math.floor(X / Cs) - ox
          const gy = Math.floor(Y / Cs) - oy
          if (gx < 0 || gy < 0 || gx >= wc || gy >= hc) continue
          const id = gy * SIDE + gx
          const dx = (gx + ox + 0.5) * Cs - X
          const dy = (gy + oy + 0.5) * Cs - Y
          const d2 = dx * dx + dy * dy
          if (grid[id] !== stamp) {
            grid[id] = stamp
            cellD[id] = d2
            cellI[id] = ui
            cellB[id] = b
            touched[nt++] = id
          } else if (d2 < cellD[id]) {
            cellD[id] = d2
            cellI[id] = ui
            cellB[id] = b
          }
        }
      }
      const direct = Cs >= 4
      if (!direct && dat) dat.fill(0, 0, ((hc - 1) * SIDE + wc) * 4)
      cx!.globalAlpha = s.alpha
      cx!.fillStyle = dark ? 'rgba(255,255,255,.22)' : 'rgba(80,88,110,.3)'
      for (let q = 0; q < nt; q++) {
        const id = touched[q]
        const cyy = (id / SIDE) | 0
        const cxx = id - cyy * SIDE
        const ui = cellI[id]
        const b = cellB[id]
        const ab = Math.abs(b)
        const u = 1 - ui / NU
        bw = bwA[ui]
        fw = fwA[ui]
        const body = ab < bw
        const fin = !body && ab < bw + fw
        if (!body && !fin) {
          const out = ab - bw - fw
          const gx = cxx + ox
          const gy = cyy + oy
          if (out < Cs * 1.5 && hash(gx, gy) < 0.2 * (1 - out / (Cs * 1.5))) {
            cx!.fillRect(gx * Cs + ((hash(gx + 3, gy) * (Cs - 1)) | 0), gy * Cs + ((hash(gx, gy + 3) * (Cs - 1)) | 0), 2, 2)
          }
          continue
        }
        if (fin && (k ? u < 0.1 && ab < L * 0.05 * (1 - u / 0.1) : u < 0.1 && ab < L * 0.012 * (1 - u / 0.1))) continue
        const tu = (u * L) / Cs
        const tb = b / Cs
        if (k) koiCol(s, body, ab, tu, tb, u, Cs)
        else sharkCol(s, body, body ? 1 - ab / Math.max(bw, 1) : 0.3, u, tu, tb, ab, Cs)
        if (direct) {
          cx!.fillStyle = colStr()
          cx!.fillRect((cxx + ox) * Cs, (cyy + oy) * Cs, Cs - gap, Cs - gap)
        } else if (dat) {
          const p = (cyy * SIDE + cxx) * 4
          dat[p] = CR
          dat[p + 1] = CG
          dat[p + 2] = CB
          dat[p + 3] = CA * 255
        }
      }
      if (!direct && cctx && img && lx && lay) {
        cctx.putImageData(img, 0, 0, 0, 0, wc, hc)
        const pw = wc * Cs
        const ph = hc * Cs
        lx.clearRect(0, 0, pw, ph)
        lx.drawImage(cellCv!, 0, 0, wc, hc, 0, 0, pw, ph)
        if (gap) {
          lx.globalCompositeOperation = 'destination-out'
          const gp = gapPat(gap, Cs)
          if (gp) {
            lx.fillStyle = gp
            lx.fillRect(0, 0, pw, ph)
          }
          lx.globalCompositeOperation = 'source-over'
        }
        cx!.drawImage(lay, 0, 0, pw, ph, ox * Cs, oy * Cs, pw, ph)
      }
      const ue = k ? 0.885 : s.T.hammer ? 0.948 : 0.9
      const f = (1 - ue) * NS
      const i0 = Math.min(NS - 1, f | 0)
      const fr = f - i0
      const bx = spx[i0] + (spx[i0 + 1] - spx[i0]) * fr
      const by = spy[i0] + (spy[i0 + 1] - spy[i0]) * fr
      const a = spa[i0] + (spa[i0 + 1] - spa[i0]) * fr
      widths(ue, s)
      const off = bw * (k ? 0.6 : s.T.hammer ? 0.9 : 0.5)
      const es = Math.max(Cs, 3)
      for (let sg = -1; sg <= 1; sg += 2) {
        const X = bx - Math.sin(a) * sg * off
        const Y = by + Math.cos(a) * sg * off
        const ex = Math.floor(X / Cs) * Cs
        const ey = Math.floor(Y / Cs) * Cs
        cx!.fillStyle = '#0b0b0b'
        cx!.fillRect(ex, ey, es - 1, es - 1)
        if (k && es >= 5) {
          cx!.fillStyle = 'rgba(255,255,255,.65)'
          cx!.fillRect(ex + Math.round(es * 0.3), ey + Math.round(es * 0.2), 2, 2)
        }
      }
      if (k) {
        cx!.fillStyle = 'rgba(30,30,30,.7)'
        for (let sg = -1; sg <= 1; sg += 2) {
          const X = spx[0] - Math.sin(spa[0]) * sg * Cs * 0.9 + Math.cos(spa[0]) * Cs * 0.4
          const Y = spy[0] + Math.cos(spa[0]) * sg * Cs * 0.9 + Math.sin(spa[0]) * Cs * 0.4
          cx!.fillRect(Math.round(X), Math.round(Y), 2, 2)
        }
      }
      drawAnatomy(s, dark, Cs)
      cx!.globalAlpha = 1
    }

    const ord: any[] = []
    let ema = 0
    let slow = 0
    function draw(t: number, dt: number) {
      if (cellOf() !== curCs) ensure()
      const dark = isDarkRef.current
      cx!.clearRect(0, 0, W, H)
      drawAtmosphere(t, dt, dark)
      cx!.setLineDash([2, 5])
      cx!.lineWidth = 1
      cx!.strokeStyle = dark ? 'rgba(220,214,197,.11)' : 'rgba(34,43,53,.09)'
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        if (dt) r.a += dt / (r.big ? 9 : 5)
        if (r.a >= 1) {
          if (ripples.length > 3) {
            ripples.splice(i, 1)
            continue
          }
          r.a = 0
          r.x = Math.random() * W
          r.y = Math.random() * H
          r.big = 1
        }
        cx!.globalAlpha = (1 - r.a) * (dark ? 0.8 : 0.7)
        cx!.beginPath()
        cx!.arc(r.x, r.y, 8 + r.a * (r.big ? 130 : 90), 0, 6.283)
        cx!.stroke()
        if (r.big) {
          cx!.globalAlpha = (1 - r.a) * 0.24
          cx!.beginPath()
          cx!.arc(r.x, r.y, 14 + r.a * 106, 0, 6.283)
          cx!.stroke()
        }
      }
      cx!.globalAlpha = 1
      cx!.setLineDash([])
      if (dt) for (let i = 0; i < active.length; i++) swim(active[i], t, dt * P.speed, active)
      ord.length = 0
      for (let i = 0; i < active.length; i++) ord.push(active[i])
      for (let i = 1; i < ord.length; i++) {
        const v = ord[i]
        let j = i - 1
        while (j >= 0 && ord[j].alpha > v.alpha) {
          ord[j + 1] = ord[j]
          j--
        }
        ord[j + 1] = v
      }
      for (let i = 0; i < ord.length; i++) drawWake(ord[i], dark, cellOf())
      for (let i = 0; i < ord.length; i++) drawCreature(ord[i], t, dark)
    }

    function loop(t = performance.now()) {
      if (pausedRef.current) return
      const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000))
      if (t - last >= 14 || last === 0) {
        const t0 = performance.now()
        draw(t, dt)
        last = t
        const c = performance.now() - t0
        ema += (c - ema) * 0.1
        if (ema > 14 && P.count > 4) {
          if (++slow > 90) {
            slow = 0
            ema = 8
            P.count--
            setActive()
          }
        } else {
          slow = Math.max(0, slow - 2)
        }
      }
      if (!pausedRef.current && !document.hidden) {
        raf = requestAnimationFrame(loop)
      }
    }

    const kick = () => {
      cancelAnimationFrame(raf)
      last = performance.now() - 16
      raf = requestAnimationFrame(loop)
    }

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('button, input, select, textarea, a, .pop, .sheet, .note, .hero, .nc')) return
      tgt = { x: e.clientX, y: e.clientY, until: performance.now() + 3500 }
      ripple(e.clientX, e.clientY)
    }

    let rz: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(rz)
      rz = setTimeout(() => {
        size()
        draw(performance.now(), 0)
      }, 120)
    }

    const onVisibilityChange = () => {
      if (!document.hidden && !pausedRef.current) kick()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibilityChange)

    onThemeSwitchRef.current = (dark: boolean) => {
      P.count = dark ? 9 : 7
      P.px = dark ? 8 : 6
      size()
      ensure()
      setActive()
      draw(performance.now(), 0)
    }

    kickRef.current = kick
    drawStaticRef.current = () => draw(performance.now(), 0)

    size()
    ensure()
    setActive()
    kick()

    return () => {
      kickRef.current = null
      drawStaticRef.current = null
      onThemeSwitchRef.current = null
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return <canvas ref={canvasRef} id="bg" aria-hidden="true" />
}
