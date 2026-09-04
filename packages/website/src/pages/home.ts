import { renderLiveValues } from "../lib/live.js";

const track = document.getElementById("track");
const canvas = document.getElementById("aperture") as HTMLCanvasElement | null;
const layers = Array.from(document.querySelectorAll<HTMLElement>(".ph-layer"));
const dots = Array.from(document.querySelectorAll<HTMLElement>("#dots span"));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function progress(): number {
  if (!track) return 0;
  const r = track.getBoundingClientRect();
  const range = r.height - window.innerHeight;
  return range > 0 ? clamp(-r.top / range, 0, 1) : 0;
}

function layerState(i: number, p: number): { vis: number; dy: number } {
  const n = layers.length;
  const c = (i + 0.5) / n;
  const d = Math.abs(p - c) * n;
  const vis = i === 0 ? Math.max(0, 1 - Math.max(0, p * n - 0.6) / 0.4) : Math.max(0, 1 - Math.max(0, d - 0.3) / 0.25);
  return { vis, dy: (1 - vis) * (p * n > c * n ? -24 : 24) };
}

let lastP = -1;
let start = performance.now();

function drawAperture(p: number, t: number): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const wide = w > 860;
  const cx = wide ? w * 0.68 : w * 0.5;
  const cy = wide ? h * 0.5 : h * 0.72;
  const base = Math.min(w, h) * (wide ? 0.2 : 0.16);
  const pulse = 1 + 0.02 * Math.sin(t / 900);
  const radius = base * (1 + 1.4 * p) * pulse;
  const alpha = 0.45 + 0.4 * p;
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.62, "rgba(0,0,0,1)");
  gradient.addColorStop(0.82, `rgba(11,143,74,${(alpha * 0.55).toFixed(3)})`);
  gradient.addColorStop(0.95, `rgba(43,255,136,${alpha.toFixed(3)})`);
  gradient.addColorStop(1, "rgba(184,255,220,0.05)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  for (const [factor, a] of [
    [1.25, 0.22],
    [1.6, 0.12],
    [2.05, 0.06],
  ] as const) {
    ctx.strokeStyle = `rgba(43,255,136,${(a * (0.6 + 0.4 * p)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius * 2.6);
  glow.addColorStop(0, `rgba(43,255,136,${(0.08 + 0.1 * p).toFixed(3)})`);
  glow.addColorStop(1, "rgba(43,255,136,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

function apply(): void {
  const p = progress();
  if (Math.abs(p - lastP) > 0.002) {
    lastP = p;
    layers.forEach((el, i) => {
      const { vis, dy } = layerState(i, p);
      el.style.opacity = vis.toFixed(3);
      el.style.transform = `translateY(${dy.toFixed(1)}px)`;
      el.style.pointerEvents = vis > 0.5 ? "auto" : "none";
    });
    const step = Math.min(dots.length - 1, Math.floor(p * dots.length));
    dots.forEach((dot, i) => {
      dot.style.background = i === step ? "var(--accent)" : "var(--border)";
    });
  }
}

function frame(t: number): void {
  apply();
  if (track) {
    const r = track.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) drawAperture(lastP < 0 ? 0 : lastP, t - start);
  }
  requestAnimationFrame(frame);
}

start = performance.now();
window.addEventListener("scroll", apply, { passive: true });
window.addEventListener("resize", () => {
  lastP = -1;
  apply();
});
apply();
requestAnimationFrame(frame);
void renderLiveValues();
