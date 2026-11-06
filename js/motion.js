/* ============================================================
   Motion values for JS: the same curves and durations as the «Motion» tokens in css/colors_and_type.css
   (read from :root once, the numbers below are only fallbacks), plus small helpers shared by the animated modules.
   ============================================================ */

const FALLBACK = {
    ease: [0.2, 0.8, 0.2, 1],
    hover: 120, state: 160, fade: 180, short: 200, enter: 250, return: 150,
};

function readTokens() {
    const out = { ...FALLBACK };
    try {
        const cs = getComputedStyle(document.documentElement);
        const ms = (name, fb) => {
            const v = cs.getPropertyValue(name).trim();
            const n = parseFloat(v);
            if (!Number.isFinite(n)) return fb;
            return /ms$/.test(v) ? n : (/s$/.test(v) ? n * 1000 : n);
        };
        out.hover = ms('--duration-hover', out.hover);
        out.state = ms('--duration-state', out.state);
        out.fade = ms('--duration-fade', out.fade);
        out.short = ms('--duration-short', out.short);
        out.enter = ms('--duration-enter', out.enter);
        out.return = ms('--duration-return', out.return);
        const m = cs.getPropertyValue('--ease-out').match(/cubic-bezier\(([^)]+)\)/);
        if (m) {
            const p = m[1].split(',').map(Number);
            if (p.length === 4 && p.every(Number.isFinite)) out.ease = p;
        }
    } catch { /* no DOM: fallbacks */ }
    return out;
}
const T = readTokens();

/* --ease-out as a CSS string and as a function */
export const EASE_OUT = `cubic-bezier(${T.ease.join(', ')})`;

export const DURATION = {
    hover: T.hover,
    state: T.state,
    fade: T.fade,
    short: T.short,
    enter: T.enter,
    return: T.return,
    camera: 260,          // programmatic move and zoom of the hall scheme
    highlightIn: 100,     // section highlight after «Показать на схеме»: lights up,
    highlightHold: 1000,  // stays,
    highlightOut: 350,    // goes out
};

/* cubic-bezier(x1,y1,x2,y2) as in CSS: time share → path share */
export function cubicBezier(x1, y1, x2, y2) {
    const a = (p1, p2) => 1 - 3 * p2 + 3 * p1, b = (p1, p2) => 3 * p2 - 6 * p1, c = (p1) => 3 * p1;
    const at = (t, p1, p2) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
    const slope = (t, p1, p2) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
    return (x) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
            const d = at(t, x1, x2) - x;
            const s = slope(t, x1, x2);
            if (Math.abs(d) < 1e-5 || !s) break;
            t -= d / s;
        }
        return at(Math.min(1, Math.max(0, t)), y1, y2);
    };
}
export const easeOut = cubicBezier(...T.ease);

/* camera of the hall scheme: 1 − (1 − t)³ */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* Start delays of a batch of cards entering together: the first pause STAGGER_FIRST, every next one STAGGER_RATIO
   as long (each start rounded to a ms) — 0, 30, 48, 59, 65, 69, 71, 72 … ms */
const STAGGER_FIRST = 30;
const STAGGER_RATIO = 0.6;
export function staggerDelay(i) {
    let d = 0;
    let step = STAGGER_FIRST;
    for (let k = 1; k <= i; k++) { d = Math.round(d + step); step *= STAGGER_RATIO; }
    return d;
}

/* «Reduce motion» is checked at the moment a motion starts */
const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const prefersReducedMotion = () => !!(reduceQuery && reduceQuery.matches);

/* Velocity of a gesture by the window of the last samples [{ t, x }] (ms, px) → px/s */
export const VELOCITY_WINDOW = 70;
export function windowedVelocity(samples, now, windowMs = VELOCITY_WINDOW) {
    if (!samples || samples.length < 2) return 0;
    const cutoff = now - windowMs;
    let i = samples.length - 1;
    while (i > 0 && samples[i - 1].t >= cutoff) i--;
    const a = samples[i], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt * 1000 : 0;
}

/* Damping that stops a spring without overshoot: 2 · √(stiffness · mass) */
export const criticalDamping = (stiffness, mass = 1) => 2 * Math.sqrt(stiffness * mass);

/* Release of a dragged thing (sheet, photo, scheme edge): damping ratio 0.8 after a flick, 1 without one,
   response 0.3 s — the «sheet» pair of skill-web-animations */
export const RELEASE_STIFFNESS = Math.pow(2 * Math.PI / 0.3, 2);   // ≈ 439
export const FLICK_SPEED = 0.11;                                    // px/ms: faster release counts as a flick
export function releaseSpring(velocityPxPerS) {
    const flick = Math.abs(velocityPxPerS) / 1000 > FLICK_SPEED;
    const ratio = flick ? 0.8 : 1;
    return { stiffness: RELEASE_STIFFNESS, damping: 2 * ratio * Math.sqrt(RELEASE_STIFFNESS) };
}

/* Growing friction past a bound: the further past it, the less the thing follows */
export function rubberband(overshoot, dimension, constant = 0.55) {
    if (!dimension) return 0;
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
