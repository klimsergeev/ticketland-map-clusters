/* ============================================================
   Схема зала: пан/зум вьюпорт.
   Зум/пан применяются через АТРИБУТ viewBox инлайн-SVG (вектор
   перерисовывается растеризатором на каждом уровне — без текстурного
   мыла), а НЕ через CSS transform: scale() на промоутнутом слое.

   МОДЕЛЬ COVER: схема — слой на ВЕСЬ вьюпорт (полная ширина И высота,
   край в край). Верхний блок (шапка) и нижний (билеты+CTA) — оверлеи
   на слоях выше по z-index, схема уходит ПОД них и заполняет экран.

   scale измеряется в долях cover-фита (scale=1 → cover). Нижний предел зума —
   это ЗАГРУЗОЧНЫЙ (полный) вид: весь зал в кадре по МЕНЬШЕЙ стороне (contain),
   что в единицах scale = contain/cover ≤ 1 (см. _fitScale). Отзумив до упора,
   пользователь возвращается ровно к загрузочному виду. Зум до MAX_SCALE
   (5× cover-фита), свободный 2D-пан.

   Состояние (scale, tx, ty): tx/ty — пан в экранных px (положительный tx —
   схема вправо, положительный ty — вниз). viewBox выводится из
   состояния. ppu (px на SVG-юнит) = cover(vp) * scale.
   ============================================================ */
import { DURATION, easeOutCubic, rubberband, releaseSpring, windowedVelocity, FLICK_SPEED, prefersReducedMotion } from './motion.js';

const MAX_SCALE = 5;

/* Порог «тап vs drag»: если указатель за жест сместился меньше TAP_DIST px
   (и уложился в TAP_TIME), это тап — выбор места, а не пан. */
const TAP_DIST = 6;
const TAP_TIME = 500;

/* Базовый viewBox схемы (из assets/hall.svg): 0 0 536 582 */
const BASE_W = 536;
const BASE_H = 582;

/* Небольшой отступ клэмпа пана (экранные px): до крайних мест можно
   доехать с этим зазором, но без гигантского пустого поля. */
const PAD = 24;

/* Pan gestures: past the pan bound the scheme follows with growing friction (rubberband, constant RUBBER);
   after the release it coasts with the release velocity, the velocity × INERTIA_DECAY every millisecond,
   and comes back to the bound by a spring (js/motion.js releaseSpring) */
const RUBBER = 0.55;
const INERTIA_DECAY = 0.998;
const INERTIA_STOP = 0.1;   // px per frame: the coast stops below this
// inverse of rubberband(): the raw overshoot that gives the visible one (to grab a scheme that is past its bound)
const unrubber = (o, d, c = RUBBER) => {
    const a = Math.min(Math.abs(o), d * 0.999);
    return Math.sign(o) * (a * d) / (c * (d - a));
};

export class HallViewport {
    /* opts: { topInset, bottomInset, restOffsetY, onTap, onInteract } — insets в экранных px (число|fn):
       высоты оверлеев (шапка/нижний блок). На них расширяется пан-слэк,
       чтобы крайние места можно было вывести из-под оверлея.
       onTap(clientX, clientY) — вызывается на «тапе» (pointerdown→up без drag),
       чтобы верхний слой сделал hit-test места и выбрал/снял его.
       onInteract() — любое взаимодействие со схемой (см. _userInteract). */
    constructor(viewport, content, opts = {}) {
        this.vp = viewport;
        this.content = content;
        this.opts = Object.assign({}, opts);

        this.scale = 1;   // зум-фактор относительно cover-фита (инициализируется fit'ом ниже)
        this.tx = 0;      // пан по X в экранных px
        this.ty = 0;      // пан по Y в экранных px

        this.drag = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0, pid: null };
        this.pinch = { active: false, baseDist: 0, baseScale: 1 };
        this.touchPan = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 };
        this._tap = null;   // { x, y, t } — старт последнего жеста (для tap-детекции)
        this._raf = null;

        this._bind();
        // старт в загрузочном (полном) виде — это же нижний предел зума
        this.scale = this._fitScale();
        // ...опущенный на оффсет покоя (баланс леттербокса под развёрнутой шапкой)
        this.ty = this._restY();
    }

    /* Вертикальный оффсет ПОКОЯ (экранные px): в состоянии загрузки/покоя
       вписанная схема опускается на restOffsetY, чтобы вертикальный леттербокс
       распределился симметрично (шапка сверху перекрывает верхний зазор, иначе
       весь пустой воздух сваливается вниз). Значение (обычно половина высоты
       шапки) задаётся снаружи и клампится в пан-границы текущего
       зума. При непустой корзине оффсет = 0 → композиция как прежде. */
    _restY() {
        return this._clampPan(0, this._inset('restOffsetY'), this.scale)[1];
    }

    _svg() { return this.content.querySelector('svg'); }

    /* Нижний предел зума = ЗАГРУЗОЧНЫЙ вид (весь зал в кадре, contain).
       scale измеряется в долях cover-фита (scale=1 → cover). Полный вид =
       contain-фит, что в этих единицах = contain/cover ≤ 1. Это и есть min. */
    _fitScale() {
        const VW = this.vp.clientWidth;
        const VH = this.vp.clientHeight;
        const cover = Math.max(VW / BASE_W, VH / BASE_H) || 1;
        const contain = Math.min(VW / BASE_W, VH / BASE_H) || 1;
        return contain / cover;
    }

    _bind() {
        const vp = this.vp;
        vp.addEventListener('pointerdown', this._onPointerDown);
        vp.addEventListener('pointermove', this._onPointerMove);
        vp.addEventListener('pointerup', this._onPointerUp);
        vp.addEventListener('pointercancel', this._onPointerUp);
        vp.addEventListener('wheel', this._onWheel, { passive: false });
        vp.addEventListener('touchstart', this._onTouchStart, { passive: false });
        vp.addEventListener('touchmove', this._onTouchMove, { passive: false });
        vp.addEventListener('touchend', this._onTouchEnd);
    }

    _inset(key) {
        const v = this.opts[key];
        const n = typeof v === 'function' ? v() : v;
        return n || 0;
    }

    /* Единая точка «пользователь взаимодействует со схемой» (pan/zoom/tap/фокус):
       уведомляет наружу (opts.onInteract) — на неё app-core.js вешает сброс фильтра цены.
       Вызывается из всех точек начала взаимодействия: _onPointerDown/_onWheel/
       _onTouchStart/focusOnSvgPoint/focusInBand. */
    _userInteract() {
        if (this.opts.onInteract) this.opts.onInteract();
    }

    /* px на один SVG-юнит при текущем зуме = cover * scale. Экранный размер
       места (8 юнитов) = 8 * pxPerUnit(). Используется price-filter.js для расчёта
       обратного масштаба увеличенного места (постоянный экранный размер). */
    pxPerUnit() {
        const { cover } = this._dims();
        return cover * this.scale;
    }

    /* Размеры вьюпорта (px) и cover-фактор: px на SVG-юнит при scale=1.
       cover = max(VW/BASE_W, VH/BASE_H) → по большей стороне зал заполняет
       вьюпорт, по меньшей выходит за края (кропится, панорамируется). */
    _dims() {
        const VW = this.vp.clientWidth;
        const VH = this.vp.clientHeight;
        const cover = Math.max(VW / BASE_W, VH / BASE_H) || 1;
        return { VW, VH, cover };
    }

    /* Клэмп пана: контент можно двигать так, чтобы любой его край доехал до
       края вьюпорта + PAD; сверх того — слэк на высоту оверлеев (insetTop/
       insetBottom), чтобы верхние/нижние места вывести из-под шапки/блока. */
    _clampPan(nx, ny, s) {
        const { VW, VH, cover } = this._dims();
        const ppu = cover * s;
        const Tx = Math.max(0, (BASE_W * ppu - VW) / 2) + PAD;
        const Ty = Math.max(0, (BASE_H * ppu - VH) / 2) + PAD;
        const insetTop = this._inset('topInset');
        const insetBottom = this._inset('bottomInset');
        return [
            Math.max(-Tx, Math.min(Tx, nx)),
            Math.max(-(Ty + insetBottom), Math.min(Ty + insetTop, ny)),
        ];
    }

    /* Выставить состояние и отрисовать через viewBox (мгновенно) */
    _apply(s, nx, ny) {
        s = Math.max(this._fitScale(), Math.min(MAX_SCALE, s));
        const [cx, cy] = this._clampPan(nx, ny, s);
        this.scale = s;
        this.tx = cx;
        this.ty = cy;
        this._renderViewBox();
        // подсветка кресла: пересчёт на каждое изменение масштаба и пана (в т.ч. кадры _animateTo и refit)
        if (this.opts.onView) this.opts.onView();
    }

    /* Pan by a gesture: past the bound the scheme follows with growing friction */
    _applyRubber(nx, ny) {
        const { VW, VH } = this._dims();
        const [cx, cy] = this._clampPan(nx, ny, this.scale);
        this.tx = cx + rubberband(nx - cx, VW, RUBBER);
        this.ty = cy + rubberband(ny - cy, VH, RUBBER);
        this._renderViewBox();
        if (this.opts.onView) this.opts.onView();
    }

    /* Raw (before friction) pan that shows the current one: a new grab of a scheme past its bound goes on from it */
    _rawPan() {
        const { VW, VH } = this._dims();
        const [cx, cy] = this._clampPan(this.tx, this.ty, this.scale);
        return [cx + unrubber(this.tx - cx, VW), cy + unrubber(this.ty - cy, VH)];
    }

    /* Release of a pan with velocity (px/s): coast with decay, past the bound — spring back to it.
       Each axis on its own. Any touch, press, wheel or programmatic move stops it (they cancel this._raf) */
    _release(vx, vy) {
        cancelAnimationFrame(this._raf);
        const flick = Math.hypot(vx, vy) / 1000 > FLICK_SPEED;
        if (prefersReducedMotion()) { this._apply(this.scale, this.tx, this.ty); return; }
        const axes = [
            { p: this.tx, v: flick ? vx : 0, spring: null },
            { p: this.ty, v: flick ? vy : 0, spring: null },
        ];
        let last = performance.now();
        const step = (now) => {
            const dt = Math.min(now - last, 34) / 1000;   // s
            last = now;
            const bounds = this._clampPan(axes[0].p, axes[1].p, this.scale);
            let moving = false;
            axes.forEach((a, i) => {
                const b = bounds[i];
                if (!a.spring && Math.abs(a.p - b) > 0.01) a.spring = releaseSpring(a.v);   // left the bound: spring back
                if (a.spring) {
                    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
                    const h = dt / sub;
                    for (let k = 0; k < sub; k++) {
                        const acc = -a.spring.stiffness * (a.p - b) - a.spring.damping * a.v;
                        a.v += acc * h;
                        a.p += a.v * h;
                    }
                    if (Math.abs(a.p - b) < 0.35 && Math.abs(a.v) < 0.35) { a.p = b; a.v = 0; } else moving = true;
                } else {
                    a.v *= Math.pow(INERTIA_DECAY, dt * 1000);
                    const d = a.v * dt;
                    if (Math.abs(d) < INERTIA_STOP) a.v = 0; else { a.p += d; moving = true; }
                }
            });
            this.tx = axes[0].p;
            this.ty = axes[1].p;
            this._renderViewBox();
            if (this.opts.onView) this.opts.onView();
            if (moving) this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    }

    /* Вывести viewBox из (scale, tx, ty).
       ppu = cover*scale; окно viewBox = VW/ppu × VH/ppu (аспект = аспекту
       вьюпорта → SVG заполняет слой без леттербокса). Центр окна в
       SVG-юнитах = центр зала минус пан/ppu. */
    _renderViewBox() {
        const svg = this._svg();
        if (!svg) return;
        const { VW, VH, cover } = this._dims();
        if (VW <= 0 || VH <= 0) return;
        const ppu = cover * this.scale;
        const vw = VW / ppu;
        const vh = VH / ppu;
        const cx = BASE_W / 2 - this.tx / ppu;
        const cy = BASE_H / 2 - this.ty / ppu;
        svg.setAttribute('viewBox', `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`);
    }

    /* Пересчитать viewBox под текущее состояние (после resize). */
    refit() {
        this._apply(this.scale, this.tx, this.ty);
    }

    /* Плавный переход состояния (фокус на точке) — твин по rAF,
       т.к. CSS-transition к атрибуту viewBox не применяется. */
    _animateTo(s, nx, ny, onDone) {
        cancelAnimationFrame(this._raf);
        if (prefersReducedMotion()) {   // the camera does not travel across the whole surface: the end view at once
            this._apply(s, nx, ny);
            if (onDone) onDone();
            return;
        }
        const fromS = this.scale, fromX = this.tx, fromY = this.ty;
        const dur = DURATION.camera;
        const t0 = performance.now();
        cancelAnimationFrame(this._raf);
        const ease = easeOutCubic;
        const step = (now) => {
            const p = Math.min(1, (now - t0) / dur);
            const k = ease(p);
            const [toX, toY] = this._clampPan(nx, ny, s);
            this._apply(fromS + (s - fromS) * k, fromX + (toX - fromX) * k, fromY + (toY - fromY) * k);
            if (p < 1) this._raf = requestAnimationFrame(step);
            else if (onDone) onDone();
        };
        this._raf = requestAnimationFrame(step);
    }

    /* true, если схема на МИНИМАЛЬНОМ (загрузочном) масштабе — с допуском
       1.001 (защита от накопленной погрешности cover/contain-фита). */
    atMinScale() {
        return this.scale <= this._fitScale() * 1.001;
    }

    /* Zoom buttons: scale × factor around the viewport centre, animated with the same tween as focus.
       Pan grows in the same proportion as scale, so the scheme point in the centre stays in the centre. */
    zoomBy(factor) {
        this._userInteract();   // same as wheel: clears the price filter
        const s = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.scale * factor));
        const k = s / this.scale;
        this._animateTo(s, this.tx * k, this.ty * k);
    }

    /* false at MAX_SCALE (with the same tolerance as atMinScale) */
    canZoomIn() {
        return this.scale < MAX_SCALE / 1.001;
    }

    /* Snapshot of the view for a layout switch: scheme point at the viewport centre, px per unit,
       and whether the view is at the minimum (whole hall fitted) */
    captureView() {
        const { cover } = this._dims();
        const ppu = cover * this.scale;
        return { cx: BASE_W / 2 - this.tx / ppu, cy: BASE_H / 2 - this.ty / ppu, ppu, atMin: this.atMinScale() };
    }

    /* Put a snapshot back after the viewport changed size: a fitted view stays fitted (with the rest offset);
       otherwise the same point in the centre at the same px per unit, within the zoom limits of the new viewport */
    restoreView(v) {
        cancelAnimationFrame(this._raf);
        if (!v || v.atMin) { this._apply(this._fitScale(), 0, this._clampPan(0, this._inset('restOffsetY'), this._fitScale())[1]); return; }
        const { cover } = this._dims();
        const s = Math.max(this._fitScale(), Math.min(MAX_SCALE, v.ppu / cover));
        const ppu = cover * s;
        this._apply(s, (BASE_W / 2 - v.cx) * ppu, (BASE_H / 2 - v.cy) * ppu);
    }

    /* Мгновенный пан (с клампом) на текущем зуме — реклампинг после resize */
    panTo(tx, ty) {
        cancelAnimationFrame(this._raf);
        this._apply(this.scale, tx, ty);
    }

    /* Плавно вернуть вид в границы пана на текущем зуме — после того как убран оверлей, расширявший слэк
       (шторка диалога танцпола). Вид в границах — движения нет. Фильтр не сбрасывает */
    settle() {
        this._animateTo(this.scale, this.tx, this.ty);
    }

    /* Экранные координаты (clientX/clientY) → координаты в SVG-юнитах.
       Через getScreenCTM инлайн-SVG (учитывает viewBox и позицию слоя),
       поэтому работает при любом зуме/пане. null — если SVG ещё не в DOM. */
    clientToSvg(clientX, clientY) {
        const svg = this._svg();
        if (!svg || !svg.getScreenCTM) return null;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
    }

    /* Центрировать вьюпорт на точке (px,py) в SVG-юнитах и приблизить к scale
       (плавно, через тот же viewBox-твин). Пан выводится из условия «центр окна
       viewBox = (px,py)»: cx = BASE_W/2 - tx/ppu = px  →  tx = (BASE_W/2 - px)*ppu.
       Зум берём не меньше текущего (жест всегда приближает, не отдаляет). */
    focusOnSvgPoint(px, py, scale) {
        const { cover } = this._dims();
        this._userInteract();   // фокус на месте (жест выбора) → сброс фильтра
        const s = Math.max(this.scale, this._fitScale(), Math.min(MAX_SCALE, scale));
        const ppu = cover * s;
        const tx = (BASE_W / 2 - px) * ppu;
        const ty = (BASE_H / 2 - py) * ppu;
        this._animateTo(s, tx, ty);
    }

    /* SVG-юниты → px относительно левого верхнего угла вьюпорта:
       экранX = x * k + ox, экранY = y * k + oy.
       Выводится из _renderViewBox: центр окна viewBox = центр зала минус пан / ppu.
       Считать один раз на кадр, а не на каждую метку: _dims() читает clientWidth. */
    viewTransform() {
        const { VW, VH, cover } = this._dims();
        const k = cover * this.scale;
        return {
            k,
            ox: VW / 2 + this.tx - (BASE_W / 2) * k,
            oy: VH / 2 + this.ty - (BASE_H / 2) * k,
        };
    }

    /* Точка (px, py) в SVG-юнитах → центр полосы между шапкой и нижним блоком.
       Масштаб не меньше текущего и не больше MAX_SCALE; пан клампится в каждом кадре _animateTo,
       поэтому у края схемы точка остаётся не по центру, а вид не выходит за границы.
       onDone — после последнего кадра; движение оборвано жестом, panTo или новым _animateTo — не приходит. */
    focusInBand(px, py, scale, onDone) {
        const { cover } = this._dims();
        this._userInteract();   // уход из лайтбокса на кресло → сброс фильтра
        const top = this._inset('topInset');
        const bottom = this._inset('bottomInset');
        const s = Math.max(this.scale, this._fitScale(), Math.min(MAX_SCALE, scale));
        const ppu = cover * s;
        // экранY точки = VH/2 + ty - (BASE_H/2 - py) * ppu; нужно VH/2 + (top - bottom)/2
        this._animateTo(s, (BASE_W / 2 - px) * ppu, (BASE_H / 2 - py) * ppu + (top - bottom) / 2, onDone);
    }

    /* Точка (px, py) в SVG-юнитах → центр полосы между шапкой и нижним краем полосы bottom (px экрана от низа
       вьюпорта), ровно на масштабе scale — и приближая, и отдаляя (в пределах от вписанного до MAX_SCALE).
       Для фокуса под шторку, которая ещё не открыта: её высоту передаёт вызывающий.
       onDone — после последнего кадра; движение оборвано жестом, panTo или новым _animateTo — не приходит. */
    focusAt(px, py, scale, bottom, onDone) {
        const { cover } = this._dims();
        this._userInteract();
        const top = this._inset('topInset');
        const s = Math.max(this._fitScale(), Math.min(MAX_SCALE, scale));
        const ppu = cover * s;
        this._animateTo(s, (BASE_W / 2 - px) * ppu, (BASE_H / 2 - py) * ppu + (top - bottom) / 2, onDone);
    }

    /* Масштаб, на котором отрезок w SVG-юнитов занимает px пикселей экрана */
    scaleForWidth(w, px) {
        const { cover } = this._dims();
        return px / (w * cover);
    }

    /* Снимок вида: сравнить «сдвигал ли человек схему» */
    viewState() {
        return { s: this.scale, tx: this.tx, ty: this.ty };
    }

    /* ---- pointer (мышь): drag-пан ---- */
    _onPointerDown = (e) => {
        if (e.pointerType === 'touch') return; // тач — отдельно
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        this._userInteract();   // жест пользователя → сброс фильтра
        this._tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        const [bx, by] = this._rawPan();
        this.drag = { active: true, startX: e.clientX, startY: e.clientY, baseTx: bx, baseTy: by, pid: e.pointerId,
            samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }] };
        try { this.vp.setPointerCapture(e.pointerId); } catch {}
        this.vp.classList.add('grabbing');
    };
    _onPointerMove = (e) => {
        if (!this.drag.active || e.pointerType === 'touch') return;
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        this._sample(this.drag.samples, e.clientX, e.clientY);
        this._applyRubber(this.drag.baseTx + dx, this.drag.baseTy + dy);
    };

    /* Last positions of a pan for its release velocity */
    _sample(samples, x, y) {
        samples.push({ t: performance.now(), x, y });
        if (samples.length > 12) samples.shift();
    }
    _releaseFrom(samples) {
        const now = performance.now();
        const vx = windowedVelocity(samples.map((p) => ({ t: p.t, x: p.x })), now);
        const vy = windowedVelocity(samples.map((p) => ({ t: p.t, x: p.y })), now);
        this._release(vx, vy);
    }
    _onPointerUp = (e) => {
        // палец: тап считает touchend (_onTouchEnd) — там же гасится «призрачный» click. pointerup касания
        // приходит раньше touchend и раньше забирал тап себе, тогда touchend уже нечего было отменять
        if (e.pointerType === 'touch') return;
        const wasDragging = this.drag.active;
        this.drag.active = false;
        this.vp.classList.remove('grabbing');
        try { this.vp.releasePointerCapture(e.pointerId); } catch {}
        if (this._maybeTap(e.clientX, e.clientY) || !wasDragging) return;
        this._releaseFrom(this.drag.samples || []);
    };

    /* Если жест не превратился в пан (смещение < TAP_DIST, время < TAP_TIME) —
       это тап: отдать координаты наверх для hit-test/выбора места. true — тап засчитан. */
    _maybeTap(clientX, clientY) {
        const d = this._tap;
        this._tap = null;
        if (!d) return false;
        const moved = Math.hypot(clientX - d.x, clientY - d.y);
        if (moved <= TAP_DIST && performance.now() - d.t <= TAP_TIME) {
            this.opts.onTap && this.opts.onTap(clientX, clientY);
            return true;
        }
        return false;
    }

    /* ---- wheel: зум ---- */
    _onWheel = (e) => {
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        this._userInteract();   // жест пользователя → сброс фильтра
        const delta = -e.deltaY * 0.003;
        const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.scale + delta));
        // the scheme point under the cursor stays under it: t' = p − (p − t) · k, p — from the viewport centre
        const r = this.vp.getBoundingClientRect();
        const px = e.clientX - r.left - r.width / 2;
        const py = e.clientY - r.top - r.height / 2;
        const k = next / this.scale;
        this._apply(next, px - (px - this.tx) * k, py - (py - this.ty) * k);
    };

    /* ---- touch: pinch-зум + 1-палец пан ---- */
    _onTouchStart = (e) => {
        cancelAnimationFrame(this._raf);
        this._userInteract();   // жест пользователя → сброс фильтра
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            const r = this.vp.getBoundingClientRect();
            this.pinch = {
                active: true,
                baseDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                baseScale: this.scale,
                // the scheme point under the middle of the fingers follows the middle (from the viewport centre)
                mx0: (a.clientX + b.clientX) / 2 - r.left - r.width / 2,
                my0: (a.clientY + b.clientY) / 2 - r.top - r.height / 2,
                tx0: this.tx,
                ty0: this.ty,
            };
            this.touchPan.active = false;
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            this._tap = { x: t.clientX, y: t.clientY, t: performance.now() };
            const [bx, by] = this._rawPan();
            this.touchPan = { active: true, startX: t.clientX, startY: t.clientY, baseTx: bx, baseTy: by,
                samples: [{ t: performance.now(), x: t.clientX, y: t.clientY }] };
            this.pinch.active = false;
            this.vp.classList.add('grabbing');
        }
    };
    _onTouchMove = (e) => {
        if (this.pinch.active && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = e.touches;
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const ratio = d / (this.pinch.baseDist || 1);
            const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.pinch.baseScale * ratio));
            const r = this.vp.getBoundingClientRect();
            const mx = (a.clientX + b.clientX) / 2 - r.left - r.width / 2;
            const my = (a.clientY + b.clientY) / 2 - r.top - r.height / 2;
            const k = next / this.pinch.baseScale;
            this._apply(next, mx - (this.pinch.mx0 - this.pinch.tx0) * k, my - (this.pinch.my0 - this.pinch.ty0) * k);
        } else if (this.touchPan.active && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - this.touchPan.startX;
            const dy = t.clientY - this.touchPan.startY;
            this._sample(this.touchPan.samples, t.clientX, t.clientY);
            this._applyRubber(this.touchPan.baseTx + dx, this.touchPan.baseTy + dy);
        }
    };
    _onTouchEnd = (e) => {
        // тап одним пальцем (без pinch): взять координаты отпущенного касания
        if (!this.pinch.active && e && e.changedTouches && e.changedTouches.length) {
            const t = e.changedTouches[0];
            // тап обработан здесь — гасим совместимые mouse-события и click, которые браузер иначе пришлёт
            // в ту же точку после touchend: под пальцем к этому моменту уже открытый диалог, и «призрачный»
            // click по затемнению сразу его закрывал (тап по танцполу на телефоне и в режиме устройства DevTools)
            if (this._maybeTap(t.clientX, t.clientY)) { if (e.cancelable) e.preventDefault(); }
            else if (this.touchPan.active) this._releaseFrom(this.touchPan.samples || []);
        } else {
            this._tap = null;
        }
        this.pinch.active = false;
        this.touchPan.active = false;
        this.vp.classList.remove('grabbing');
    };
}
