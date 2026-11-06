/* пружина (velocity-based, rAF) — карусель билетов, съезд карточек, увеличение мест по фильтру цены, возвраты жестов.
   stiffness 840, damping 44 → ζ≈0.76: лёгкий overshoot (после броска); без броска вызывающий передаёт критическое
   затухание (criticalDamping в js/motion.js).
   restDelta / restSpeed — пороги покоя в единицах самой величины: 0.35 для пикселей, 0.001 для прогресса 0…1 */
import { prefersReducedMotion } from './motion.js';

export function spring({ from, to, velocity = 0, stiffness = 840, damping = 44, mass = 1, restDelta = 0.35, restSpeed = 0.35, onUpdate, onDone }) {
    // «reduce motion»: the value is at its target at once
    if (prefersReducedMotion()) {
        onUpdate(to, 0);
        if (onDone) onDone();
        return () => {};
    }
    let x = from, v = velocity, last = performance.now(), raf;
    const step = (now) => {
        let dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / sub;
        for (let i = 0; i < sub; i++) {
            const a = (-stiffness * (x - to) - damping * v) / mass;
            v += a * h;
            x += v * h;
        }
        onUpdate(x, v);
        if (Math.abs(x - to) < restDelta && Math.abs(v) < restSpeed) {
            onUpdate(to, 0);
            onDone && onDone();
            return;
        }
        raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
}
