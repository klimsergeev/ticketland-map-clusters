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

export const MAX_SCALE = 5;

/* Порог «тап vs drag»: если указатель за жест сместился меньше TAP_DIST px
   (и уложился в TAP_TIME), это тап — выбор места, а не пан. */
const TAP_DIST = 6;
const TAP_TIME = 500;

/* Базовый viewBox схемы (из assets/hall.svg): 0 0 536 442 */
const BASE_W = 536;
const BASE_H = 442;

/* Небольшой отступ клэмпа пана (экранные px): до крайних мест можно
   доехать с этим зазором, но без гигантского пустого поля. */
const PAD = 24;

export class HallViewport {
    /* opts: { topInset, bottomInset, restOffsetY, onTap } — insets в экранных px (число|fn):
       высоты оверлеев (шапка/нижний блок). На них расширяется пан-слэк,
       чтобы крайние места можно было вывести из-под оверлея.
       onTap(clientX, clientY) — вызывается на «тапе» (pointerdown→up без drag),
       чтобы верхний слой сделал hit-test места и выбрал/снял его. */
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

    /* px на один SVG-юнит при текущем зуме = cover * scale. Экранный размер
       места (8 юнитов) = 8 * pxPerUnit(). Используется main.js для расчёта
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
        // слой меток фото: пересчёт на каждое изменение масштаба и пана (в т.ч. кадры _animateTo и refit)
        if (this.opts.onView) this.opts.onView();
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
        const fromS = this.scale, fromX = this.tx, fromY = this.ty;
        const dur = 260;
        const t0 = performance.now();
        cancelAnimationFrame(this._raf);
        const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic
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

    /* Мгновенный пан (с клампом) на текущем зуме — реклампинг после resize */
    panTo(tx, ty) {
        cancelAnimationFrame(this._raf);
        this._apply(this.scale, tx, ty);
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
       поэтому у края схемы точка остаётся не по центру, а вид не выходит за границы. */
    focusInBand(px, py, scale) {
        const { cover } = this._dims();
        const top = this._inset('topInset');
        const bottom = this._inset('bottomInset');
        const s = Math.max(this.scale, this._fitScale(), Math.min(MAX_SCALE, scale));
        const ppu = cover * s;
        // экранY точки = VH/2 + ty - (BASE_H/2 - py) * ppu; нужно VH/2 + (top - bottom)/2
        this._animateTo(s, (BASE_W / 2 - px) * ppu, (BASE_H / 2 - py) * ppu + (top - bottom) / 2);
    }

    /* Рамка box { minX, minY, maxX, maxY } в SVG-юнитах → вписать в полосу между шапкой
       и нижним блоком с отступом padPx и поставить в её центр (тап по кластеру).
       Зум не меньше текущего и не больше MAX_SCALE — ограничивает focusInBand. */
    focusOnSvgBox(box, padPx) {
        const { VW, VH, cover } = this._dims();
        const top = this._inset('topInset');
        const bottom = this._inset('bottomInset');
        const w = Math.max(box.maxX - box.minX, 1);
        const h = Math.max(box.maxY - box.minY, 1);
        const availW = Math.max(1, VW - 2 * padPx);
        const availH = Math.max(1, VH - top - bottom - 2 * padPx);
        const fit = Math.min(availW / w, availH / h) / cover;   // масштаб, при котором рамка вписывается
        this.focusInBand((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, fit);
    }

    /* ---- pointer (мышь): drag-пан ---- */
    _onPointerDown = (e) => {
        if (e.pointerType === 'touch') return; // тач — отдельно
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        this._tap = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.drag = { active: true, startX: e.clientX, startY: e.clientY, baseTx: this.tx, baseTy: this.ty, pid: e.pointerId };
        try { this.vp.setPointerCapture(e.pointerId); } catch {}
        this.vp.classList.add('grabbing');
    };
    _onPointerMove = (e) => {
        if (!this.drag.active || e.pointerType === 'touch') return;
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        this._apply(this.scale, this.drag.baseTx + dx, this.drag.baseTy + dy);
    };
    _onPointerUp = (e) => {
        this.drag.active = false;
        this.vp.classList.remove('grabbing');
        try { this.vp.releasePointerCapture(e.pointerId); } catch {}
        this._maybeTap(e.clientX, e.clientY);
    };

    /* Если жест не превратился в пан (смещение < TAP_DIST, время < TAP_TIME) —
       это тап: отдать координаты наверх для hit-test/выбора места. */
    _maybeTap(clientX, clientY) {
        const d = this._tap;
        this._tap = null;
        if (!d) return;
        const moved = Math.hypot(clientX - d.x, clientY - d.y);
        if (moved <= TAP_DIST && performance.now() - d.t <= TAP_TIME) {
            this.opts.onTap && this.opts.onTap(clientX, clientY);
        }
    }

    /* ---- wheel: зум ---- */
    _onWheel = (e) => {
        e.preventDefault();
        cancelAnimationFrame(this._raf);
        const delta = -e.deltaY * 0.003;
        const next = Math.max(this._fitScale(), Math.min(MAX_SCALE, this.scale + delta));
        this._apply(next, this.tx, this.ty);
    };

    /* ---- touch: pinch-зум + 1-палец пан ---- */
    _onTouchStart = (e) => {
        cancelAnimationFrame(this._raf);
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            this.pinch = {
                active: true,
                baseDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                baseScale: this.scale,
            };
            this.touchPan.active = false;
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            this._tap = { x: t.clientX, y: t.clientY, t: performance.now() };
            this.touchPan = { active: true, startX: t.clientX, startY: t.clientY, baseTx: this.tx, baseTy: this.ty };
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
            this._apply(next, this.tx, this.ty);
        } else if (this.touchPan.active && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - this.touchPan.startX;
            const dy = t.clientY - this.touchPan.startY;
            this._apply(this.scale, this.touchPan.baseTx + dx, this.touchPan.baseTy + dy);
        }
    };
    _onTouchEnd = (e) => {
        // тап одним пальцем (без pinch): взять координаты отпущенного касания
        if (!this.pinch.active && e && e.changedTouches && e.changedTouches.length) {
            const t = e.changedTouches[0];
            this._maybeTap(t.clientX, t.clientY);
        } else {
            this._tap = null;
        }
        this.pinch.active = false;
        this.touchPan.active = false;
        this.vp.classList.remove('grabbing');
    };
}
