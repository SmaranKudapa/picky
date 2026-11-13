"use client";
// Halftone street map. A scene paints ink density into a tiny buffer (one pixel per dot):
// red = ink, green = orange accent. Each frame the buffer is printed as dots sized by density.
// The scene follows the real app state: friends appear as they join, the radar sweeps while
// Claude is finding, and everyone's walking path converges on the pick when it's done.
// Frames run only while something moves, the canvas is on screen and the tab is visible.
import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;
const clamp = (v) => Math.min(1, Math.max(0, v));
const ink = (v) => `rgb(${Math.round(clamp(v) * 255)},0,0)`;
const acc = (v) => `rgb(0,${Math.round(clamp(v) * 255)},0)`;
const CUT = "rgb(0,0,0)";
const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
const easeInOut = (t) => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_INK = [34, 23, 15];
const COLOR_ACC = [255, 106, 31];
const COLOR_PAPER = [245, 238, 226];
const ALPHAS = [0.15, 0.4, 0.86];

function buildCity(W, H, focus, seed) {
  const rand = rng(seed);
  const street = 15;
  const xs = [], ys = [];
  for (let x = -40; x < W + 140; x += 74 + Math.round(rand() * 50) + street) xs.push(x);
  for (let y = -40; y < H + 120; y += 56 + Math.round(rand() * 34) + street) ys.push(y);
  // Street centerlines sit in the gaps between blocks.
  const sx = xs.map((x) => x - street / 2), sy = ys.map((y) => y - street / 2);
  const blocks = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    blocks.push({ x: xs[i], y: ys[j], w: xs[i + 1] - xs[i] - street, h: ys[j + 1] - ys[j] - street, tone: 0.24 + rand() * 0.14, park: rand() < 0.06 });
  }
  const target = { x: W * focus.x, y: H * focus.y };
  const near = (arr, v) => arr.reduce((b, a) => (Math.abs(a - v) < Math.abs(b - v) ? a : b), arr[0]);
  const D = { x: near(sx, target.x), y: near(sy, target.y) };
  // Places: block corners within a radius of the destination.
  const places = [];
  for (const b of blocks) {
    const corners = [[b.x + 6, b.y + 6], [b.x + b.w - 8, b.y + b.h - 8]];
    for (const [px, py] of corners) {
      const d = Math.hypot(px - D.x, py - D.y);
      if (d > 30 && d < Math.min(W, H) * 0.42 && rand() < 0.35) places.push({ x: px, y: py, a: Math.atan2(py - D.y, px - D.x), lost: rand() < 0.45 });
    }
  }
  // Friend starts: intersections spread around the destination.
  const R = Math.min(W, H) * 0.36;
  const starts = [];
  for (let k = 0; k < 6; k++) {
    const ang = -2.4 + k * 1.05 + (rand() - 0.5) * 0.4;
    const s = { x: near(sx, D.x + Math.cos(ang) * R * (0.9 + rand() * 0.35)), y: near(sy, D.y + Math.sin(ang) * R * (0.8 + rand() * 0.3)) };
    if (s.x === D.x) s.x = sx[Math.min(sx.length - 1, sx.indexOf(s.x) + (k % 2 ? 1 : -1))] ?? s.x + 90;
    if (s.y === D.y) s.y = sy[Math.min(sy.length - 1, sy.indexOf(s.y) + 1)] ?? s.y + 70;
    // Walk along the street to the destination's avenue, then along it.
    starts.push({ path: [s, { x: D.x, y: s.y }, D] });
  }
  for (const s of starts) {
    const p = s.path;
    s.len = [0];
    for (let i = 1; i < p.length; i++) s.len.push(s.len[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  }
  return { blocks, D, places, starts, street };
}

function along(s, t) {
  const total = s.len[s.len.length - 1] || 1;
  const d = clamp(t) * total;
  for (let i = 1; i < s.path.length; i++) {
    if (d <= s.len[i]) {
      const f = (d - s.len[i - 1]) / (s.len[i] - s.len[i - 1] || 1);
      const a = s.path[i - 1], b = s.path[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return s.path[s.path.length - 1];
}

function star(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

export default function Halftone({ phase = "idle", friends = 3, focus = { x: 0.68, y: 0.52 }, seed = 7, dark = false, className }) {
  const ref = useRef(null);
  const live = useRef({ phase, friends, phaseAt: 0, friendAt: [] });

  useEffect(() => {
    const L = live.current;
    if (L.phase !== phase) { L.phase = phase; L.phaseAt = performance.now(); L.friendAt = []; }
    L.friends = friends;
    L.wake?.();
  }, [phase, friends]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const low = document.createElement("canvas");
    const lctx = low.getContext("2d", { willReadFrequently: true });
    const base = document.createElement("canvas");
    const bctx = base.getContext("2d");
    const L = live.current;
    L.phaseAt = performance.now();
    const st = { W: 0, H: 0, cell: 6, cols: 0, rows: 0, dpr: 1, city: null, pointer: null, glow: 0, visible: true, raf: 0, last: 0 };
    const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = () => matchMedia("(pointer: fine)").matches;

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const W = Math.round(r.width), H = Math.round(r.height);
      if (!W || !H) return false;
      if (W === st.W && H === st.H && st.city) return true;
      Object.assign(st, { W, H, cell: W < 640 ? 5 : 6, dpr: Math.min(2, devicePixelRatio || 1) });
      canvas.width = Math.round(W * st.dpr); canvas.height = Math.round(H * st.dpr);
      st.cols = Math.ceil(W / st.cell); st.rows = Math.ceil(H / st.cell);
      low.width = base.width = st.cols; low.height = base.height = st.rows;
      st.city = buildCity(W, H, focus, seed);
      // Static city into the base buffer, one pixel per dot.
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.fillStyle = CUT; bctx.fillRect(0, 0, st.cols, st.rows);
      const c = st.cell;
      for (const b of st.city.blocks) {
        const step = b.park ? 3 : 2;
        bctx.fillStyle = ink(b.park ? b.tone * 0.7 : b.tone);
        for (let gy = Math.ceil(b.y / c); gy * c < b.y + b.h; gy++)
          for (let gx = Math.ceil(b.x / c); gx * c < b.x + b.w; gx++)
            if ((gx + gy) % step === 0) bctx.fillRect(gx, gy, 1, 1);
        bctx.fillStyle = ink(b.tone + 0.12); // crisp block edge
        for (let gx = Math.ceil(b.x / c); gx * c < b.x + b.w; gx += 2) bctx.fillRect(gx, Math.ceil(b.y / c), 1, 1);
      }
      // A diagonal avenue cut through the grid.
      bctx.setTransform(1 / c, 0, 0, 1 / c, 0, 0);
      bctx.strokeStyle = CUT; bctx.lineWidth = 18;
      bctx.beginPath(); bctx.moveTo(-40, H * 0.15); bctx.lineTo(W + 40, H * 0.98); bctx.stroke();
      for (const p of st.city.places) { bctx.fillStyle = ink(0.62); bctx.fillRect(p.x - 4, p.y - 4, 8, 8); }
      return true;
    };

    const drawFrame = (now) => {
      const { cols, rows, cell, dpr, W, H, city } = st;
      const t = reduced() ? 99 : (now - L.phaseAt) / 1000;
      const phase = L.phase;
      const n = Math.max(1, Math.min(6, L.friends || 1));
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = "source-over";
      lctx.fillStyle = CUT; lctx.fillRect(0, 0, cols, rows);
      lctx.drawImage(base, 0, 0);
      lctx.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0);
      lctx.globalCompositeOperation = "lighten";
      const { D } = city;
      let moving = false;

      const dotted = (s, upto, color) => {
        lctx.fillStyle = color;
        const total = s.len[s.len.length - 1];
        for (let d = 0; d <= total * upto; d += 11) { const p = along(s, d / total); lctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
      };
      const friendDot = (p, k, scale = 1) => {
        if (scale <= 0) return;
        lctx.fillStyle = ink(1);
        lctx.beginPath(); lctx.arc(p.x, p.y, 12 * scale, 0, TAU); lctx.fill();
        lctx.fillStyle = CUT; lctx.globalCompositeOperation = "source-over";
        lctx.beginPath(); lctx.arc(p.x, p.y, 5 * scale, 0, TAU); lctx.fill();
        lctx.globalCompositeOperation = "lighten";
      };

      if (phase === "idle") {
        // The story on a loop: three friends walk from their corners to one starred place.
        const period = 9.5, k = t % period;
        moving = true;
        const walk = easeInOut((k - 0.5) / 4.4);
        const fade = k > period - 0.8 ? 1 - (k - (period - 0.8)) / 0.8 : 1;
        for (let i = 0; i < 3; i++) {
          const s = city.starts[i * 2];
          dotted(s, walk, acc(0.9 * fade));
          friendDot(along(s, walk), i, fade * (walk > 0.92 ? Math.max(0, 1 - (walk - 0.92) / 0.08) : 1));
        }
        if (k > 4.9) {
          const pop = easeOut((k - 4.9) / 0.5);
          star(lctx, D.x, D.y, 26 * pop * fade, acc(fade));
          const ring = (k - 4.9) / 1.4;
          if (ring < 1) { lctx.strokeStyle = acc(1 - ring); lctx.lineWidth = 5; lctx.beginPath(); lctx.arc(D.x, D.y, 18 + ring * 60, 0, TAU); lctx.stroke(); }
          for (const p of city.places) if (p.lost) { lctx.strokeStyle = ink(0.55 * fade * pop); lctx.lineWidth = 3; lctx.beginPath(); lctx.moveTo(p.x - 6, p.y - 6); lctx.lineTo(p.x + 6, p.y + 6); lctx.moveTo(p.x + 6, p.y - 6); lctx.lineTo(p.x - 6, p.y + 6); lctx.stroke(); }
        } else {
          lctx.strokeStyle = ink(0.55); lctx.lineWidth = 4; lctx.beginPath(); lctx.arc(D.x, D.y, 11, 0, TAU); lctx.stroke();
        }
      } else if (phase === "waiting") {
        // Friends pop in at their corners as they join; the destination is still a question.
        for (let i = 0; i < n; i++) {
          if (L.friendAt[i] === undefined) L.friendAt[i] = t;
          const pop = easeOut((t - L.friendAt[i]) / 0.5);
          if (pop < 1) moving = true;
          friendDot(city.starts[i].path[0], i, pop);
        }
        lctx.strokeStyle = acc(0.9); lctx.lineWidth = 5; lctx.beginPath(); lctx.arc(D.x, D.y, 20, 0, TAU); lctx.stroke();
        lctx.fillStyle = acc(0.9); lctx.font = `800 24px ui-monospace, monospace`; lctx.textAlign = "center"; lctx.textBaseline = "middle"; lctx.fillText("?", D.x, D.y + 2);
      } else if (phase === "finding") {
        // Radar sweep: places light up as Claude checks them.
        moving = true;
        const sweep = (t * 2.4) % TAU;
        for (let i = 0; i < n; i++) friendDot(city.starts[i].path[0], i, 1);
        for (const p of city.places) {
          let da = (sweep - (p.a < 0 ? p.a + TAU : p.a)) % TAU; if (da < 0) da += TAU;
          const lit = Math.max(0, 1 - da / 1.6);
          if (lit > 0) { lctx.fillStyle = acc(lit); lctx.fillRect(p.x - 5, p.y - 5, 10, 10); }
        }
        const R = Math.min(W, H) * 0.42;
        lctx.strokeStyle = acc(0.85); lctx.lineWidth = 4;
        lctx.beginPath(); lctx.moveTo(D.x, D.y); lctx.lineTo(D.x + Math.cos(sweep) * R, D.y + Math.sin(sweep) * R); lctx.stroke();
        for (let k = 0; k < 3; k++) {
          const r = ((t * 0.7 + k / 3) % 1);
          lctx.strokeStyle = ink(0.7 * (1 - r)); lctx.lineWidth = 3;
          lctx.beginPath(); lctx.arc(D.x, D.y, 14 + r * R, 0, TAU); lctx.stroke();
        }
      } else if (phase === "done") {
        // Everyone's path converges on the pick. Losers get crossed out.
        const draw = easeOut(t / 1.4), walk = easeInOut((t - 0.6) / 2.4), pop = easeOut((t - 0.2) / 0.5);
        if (t < 3.4) moving = true;
        for (const p of city.places) if (p.lost) { lctx.strokeStyle = ink(0.6 * pop); lctx.lineWidth = 3; lctx.beginPath(); lctx.moveTo(p.x - 6, p.y - 6); lctx.lineTo(p.x + 6, p.y + 6); lctx.moveTo(p.x + 6, p.y - 6); lctx.lineTo(p.x - 6, p.y + 6); lctx.stroke(); }
        for (let i = 0; i < n; i++) { dotted(city.starts[i], draw, acc(0.9)); friendDot(along(city.starts[i], walk), i, walk > 0.92 ? Math.max(0, 1 - (walk - 0.92) / 0.08) : 1); }
        star(lctx, D.x, D.y, 28 * pop, acc(1));
        const ring = (t - 2.8) / 1.2;
        if (ring > 0 && ring < 1) { lctx.strokeStyle = acc(1 - ring); lctx.lineWidth = 5; lctx.beginPath(); lctx.arc(D.x, D.y, 20 + ring * 70, 0, TAU); lctx.stroke(); }
      }

      const px = lctx.getImageData(0, 0, cols, rows).data;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const paths = [0, 1, 2, 3, 4, 5].map(() => new Path2D());
      const rMax = cell * 0.44;
      const p = st.pointer, glow = st.glow, R = 120;
      for (let y = 0; y < rows; y++) {
        const cy = (y + 0.5) * cell;
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4, r = px[i], g = px[i + 1];
          let v = Math.max(r, g) / 255;
          const cx = (x + 0.5) * cell;
          if (glow && p) {
            const dx = cx - p.x, dy = cy - p.y, d2 = dx * dx + dy * dy;
            if (d2 < R * R) { const f = 1 - Math.sqrt(d2) / R; v = Math.min(1, v + f * f * glow * (v > 0.05 ? 0.55 : 0.22)); }
          }
          if (v < 0.06) continue;
          const k = (g > r + 8 ? 3 : 0) + (v < 0.36 ? 0 : v < 0.7 ? 1 : 2);
          const rad = rMax * (0.5 + 0.5 * Math.sqrt(v));
          paths[k].moveTo(cx + rad, cy); paths[k].arc(cx, cy, rad, 0, TAU);
        }
      }
      for (let k = 0; k < 6; k++) {
        const [cr, cg, cb] = k < 3 ? (dark ? COLOR_PAPER : COLOR_INK) : COLOR_ACC;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${ALPHAS[k % 3]})`;
        ctx.fill(paths[k]);
      }
      return moving;
    };

    const tick = (now) => {
      st.raf = 0;
      if (!st.visible || document.hidden || !fit()) return;
      const dt = now - (st.last || now);
      if (dt < 30 && st.last) { st.raf = requestAnimationFrame(tick); return; } // ~33 fps
      st.last = now;
      st.glow = st.pointer && fine() && !reduced() ? Math.min(1, st.glow + dt / 200) : Math.max(0, st.glow - dt / 300);
      const moving = drawFrame(now);
      if ((moving && !reduced()) || st.glow > 0.001) st.raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!st.raf) { st.last = 0; st.raf = requestAnimationFrame(tick); } };
    L.wake = wake;

    const host = canvas.parentElement;
    const move = (e) => { if (!fine()) return; const r = canvas.getBoundingClientRect(); st.pointer = { x: e.clientX - r.left, y: e.clientY - r.top }; wake(); };
    const leave = () => { st.pointer = null; wake(); };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    const io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; if (st.visible) wake(); });
    io.observe(canvas);
    let rt = 0;
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { st.W = 0; wake(); }, 100); });
    ro.observe(canvas);
    const vis = () => { if (!document.hidden) wake(); };
    document.addEventListener("visibilitychange", vis);
    wake();
    return () => {
      cancelAnimationFrame(st.raf); io.disconnect(); ro.disconnect(); clearTimeout(rt);
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", vis);
      L.wake = null;
    };
  }, [focus.x, focus.y, seed, dark]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
