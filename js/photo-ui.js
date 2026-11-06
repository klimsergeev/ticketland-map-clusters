/* ============================================================
   Лайтбокс с фото секций зала (вид с места).
   ============================================================ */

import { DURATION, EASE_OUT, windowedVelocity, releaseSpring, FLICK_SPEED, prefersReducedMotion } from './motion.js';
import { spring } from './spring.js';

// Иконки Citrus «Lightbox / citrus» (файл Z4wmhHaKhZMV8UI79y1a9Y, 4982:4980), 32×32, файлами:
// крестик Cross #1D2023 (I4982:4982), шевроны Chevron Left и Right белые (I4982:5443, I4982:5454)
const ICON_CLOSE = 'assets/lightbox-close-32.svg';
const ICON_PREV = 'assets/lightbox-chevron-left-32.svg';
const ICON_NEXT = 'assets/lightbox-chevron-right-32.svg';

// Стрелки «‹ ›»: false — спрятать (класс no-arrows). Листание тапом по краям фото и клавишами работает в обоих случаях
const SHOW_ARROWS = true;

const RETURN_MS = DURATION.return;      // возврат фото к краю после пана за край, возврат после короткого вертикального свайпа
const SWIPE_CLOSE = 80;     // px: вертикальный свайп дальше — закрытие, вверх или вниз
const SWIPE_SLOP = 6;       // px: меньше — это тап, а не свайп

const LB_MS = DURATION.short;      // проявление и гашение лайтбокса
const SLIDE_MS = DURATION.enter;      // листание
const SLIDE_GAP = 16;       // px между фото на ленте, видно только во время листания
const EDGE_RUBBER = 0.35;   // сопротивление пана за краем фото: мягкий упор
const MAX_ZOOM = 3;
const ZOOM_RESET_MS = DURATION.short;  // сброс двойным тапом
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

/* Зоны тапа по фото — комментарии к кадру 4861:18110, ширина 360: слева полоса 79 — назад,
   справа от x 180 до края — вперёд, между ними тап ничего не делает. На другой ширине — в той же доле */
const ZONE_PREV = 79 / 360;
const ZONE_NEXT = 180 / 360;

/* Рамка фото — «Hall preview» макета: 360 × 240 (3 : 2) на всю ширину экрана, по центру по высоте
   (top: calc(50% + 0.33px) — смещение 0.33 из макета), картинка в рамке — object-fit: cover */
const FRAME_ASPECT = 360 / 240;
const FRAME_SHIFT_Y = 0.33;

/* Лайтбокс с фото: галерея фото секций зала.
   open(items, start) — items: [{ key, photo: { url, caption }, label }] в порядке галереи (photoMap.gallery()),
   start — индекс фото, с которого открыть. Под фото — подпись секции label («Партер, левая сторона»)
   и «Показать на схеме»: лайтбокс закрывается, onShow(item) ведёт схему к секции фото.
   Фото в рамке 3 : 2 на всю ширину, по центру экрана; подпись и кнопка — блоком поверх низа экрана. Без приближения фото стоит на месте: тап по краям листает, вертикальный свайп закрывает,
   протяжка вбок ничего не делает. Щипок приближает, приближенное фото двигается пальцем, двойной тап сбрасывает.
   close(onDone) — onDone через LB_MS по таймеру, а не по transitionend: колбэк приходит, даже если переход не сыграл. */
/* getLayout() — optional, read on every use (the page switches between the mobile and desktop layouts); returns settings
   that override the mobile defaults above: frameAspect, frameShiftY — photo frame proportions and vertical shift;
   tapOnFrame — a tap pages only inside the photo frame, zones are shares of the frame (default: of the whole area);
   swipeClose — vertical swipe closes the lightbox */
export function createLightbox({ parentEl, onShow, getLayout }) {
    const opt = () => ({ frameAspect: FRAME_ASPECT, frameShiftY: FRAME_SHIFT_Y, tapOnFrame: false, swipeClose: true, ...(getLayout ? getLayout() : {}) });
    const el = document.createElement('div');
    el.className = SHOW_ARROWS ? 'lb' : 'lb no-arrows';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Фото секций зала');
    const slideHtml = '<div class="lb-slide"><div class="lb-photo"><img class="lb-img" alt="" draggable="false"></div></div>';
    el.innerHTML =
        // white background on its own layer: the vertical swipe fades it by opacity (no full-screen repaint)
        '<div class="lb-bg" aria-hidden="true"></div>'
        + '<div class="lb-stage">'
        + `<div class="lb-track">${slideHtml}${slideHtml}${slideHtml}</div>`
        + `<button class="lb-arrow lb-arrow--prev" type="button" aria-label="Предыдущее фото"><img src="${ICON_PREV}" width="32" height="32" alt=""></button>`
        + `<button class="lb-arrow lb-arrow--next" type="button" aria-label="Следующее фото"><img src="${ICON_NEXT}" width="32" height="32" alt=""></button>`
        + '</div>'
        + '<div class="lb-bottom">'
        + '<div class="lb-info">'
        + '<div class="lb-place"><span class="lb-seat"></span></div>'
        + '</div>'
        + '<button class="lb-show" type="button">Показать на схеме</button>'
        + '</div>'
        // крестик — поверх фото в правом верхнем углу, отдельной шапки нет (макет 4866:18319)
        + `<button class="lb-close" type="button" aria-label="Закрыть"><img src="${ICON_CLOSE}" width="32" height="32" alt=""></button>`;
    parentEl.appendChild(el);

    // Live-строка вне лайтбокса: закрытый лайтбокс visibility: hidden, а скрытый live-регион диктор не слушает
    const sr = document.createElement('span');
    sr.className = 'photo-sr';
    sr.setAttribute('aria-live', 'polite');
    parentEl.appendChild(sr);

    const q = (s) => el.querySelector(s);
    const stage = q('.lb-stage');
    const bgEl = q('.lb-bg');
    const edgeEls = [q('.lb-close'), q('.lb-bottom')];

    /* Vertical swipe: f = 1 − |shift| / half the stage height, not below 0. The white background takes f,
       the cross, the caption and the button fade twice as fast and are gone at its half */
    const fadeOf = (dy) => Math.max(0, 1 - Math.abs(dy) / (stage.clientHeight / 2));
    function setFade(f) {
        bgEl.style.opacity = f >= 1 ? '' : String(f);
        const edge = Math.max(0, f * 2 - 1);
        edgeEls.forEach((e) => { e.style.opacity = edge >= 1 ? '' : String(edge); });
    }
    function cancelReturn() {
        if (stopReturn) { stopReturn(); stopReturn = null; }
    }
    const track = q('.lb-track');
    const prevBtn = q('.lb-arrow--prev');
    const nextBtn = q('.lb-arrow--next');
    const showBtn = q('.lb-show');
    const labelEl = q('.lb-seat');   // подпись секции — на месте строки с местом

    // Три слота ленты: предыдущее, текущее, следующее. После листания слоты переставляются,
    // а не перезаливаются: картинка на экране не мигает
    let slots = [...el.querySelectorAll('.lb-slide')].map((slide) => {
        const img = slide.querySelector('.lb-img');
        const slot = { slide, photo: slide.querySelector('.lb-photo'), img, url: null, rest: { x: 0, y: 0 } };
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });   // битая картинка — пусто
        return slot;
    });

    let isOpen = false;
    let list = [];
    let index = 0;
    let sliding = 0;         // 0 — лента стоит; 1 или −1 — едет к следующему или предыдущему фото
    /* Положение текущего фото: масштаб s и сдвиг рамки tx, ty в px от левого верхнего угла области.
       Без приближения рамка стоит в slot.rest — вписана и по центру (fitSlot) */
    let zoom = { s: 1, tx: 0, ty: 0 };
    let doneTimer = null;
    let slideTimer = null;
    let stopReturn = null;   // spring that brings the photo back after a short vertical swipe
    const pts = new Map();   // pointerId → { x, y }: пальцы на области фото, не больше двух
    let gesture = null;      // { type: 'pending' | 'pan' | 'vertical' | 'none' | 'pinch', … }
    let lastTap = null;      // прошлый тап по приближенному фото — для двойного

    const cur = () => slots[1];
    const pitch = () => stage.clientWidth + SLIDE_GAP;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // за пределами [a, b] значение идёт с сопротивлением: мягкий упор при протяжке
    const rubber = (v, a, b) => (v < a ? a + (v - a) * EDGE_RUBBER : v > b ? b + (v - b) * EDGE_RUBBER : v);

    function fillSlot(slot, item) {
        slot.slide.style.visibility = item ? '' : 'hidden';   // за крайним фото слот пустой
        if (!item) return;
        slot.img.alt = item.photo.caption || '';
        if (slot.url === item.photo.url) return;
        slot.url = item.photo.url;
        slot.img.style.visibility = '';
        slot.img.src = item.photo.url;
    }

    /* ---------- положение фото ---------- */
    function paint(slot, z, ms) {
        const p = slot.photo;
        p.style.transition = ms ? `transform ${ms}ms ${EASE_OUT}` : 'none';
        p.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.s})`;
    }

    /* Рамка фото без приближения: 3 : 2 на всю ширину экрана (выше экрана — по высоте), по центру экрана.
       Блок с подписью и кнопкой не учитывается: на маленьком экране он может закрыть низ фото */
    function fitSlot(slot) {
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        let w = sw;
        const { frameAspect, frameShiftY } = opt();
        let h = sw / frameAspect;
        if (h > sh) { h = sh; w = sh * frameAspect; }
        slot.photo.style.width = `${w}px`;
        slot.photo.style.height = `${h}px`;
        slot.rest = { x: (sw - w) / 2, y: (sh - h) / 2 + frameShiftY };
        stage.style.setProperty('--lb-frame-w', `${w}px`);   // frame width for CSS (desktop arrows sit on the photo edges)
        paint(slot, { s: 1, tx: slot.rest.x, ty: slot.rest.y }, 0);
    }

    /* Одна ось приближенного фото. Больше экрана — сдвиг от «экран − фото» до 0 (soft — протяжка пальцем:
       за границей с сопротивлением; отпустили — setZoom без soft возвращает к границе). Меньше экрана — фото стоит
       середина к середине своего места без приближения и не уходит за край экрана */
    function axis(v, size, view, mid, soft) {
        if (size > view) return (soft ? rubber : clamp)(v, view - size, 0);
        return clamp(mid - size / 2, 0, view - size);
    }

    // масштаб 1 — фото на своём месте без приближения, сдвиг не принимается
    function setZoom(s, tx, ty, ms = 0, soft = false) {
        const slot = cur();
        s = clamp(s, 1, MAX_ZOOM);
        if (s === 1) {
            zoom = { s: 1, tx: slot.rest.x, ty: slot.rest.y };
        } else {
            const w = slot.photo.offsetWidth;   // offset* не учитывают transform: размеры рамки без приближения
            const h = slot.photo.offsetHeight;
            zoom = {
                s,
                tx: axis(tx, w * s, stage.clientWidth, slot.rest.x + w / 2, soft),
                ty: axis(ty, h * s, stage.clientHeight, slot.rest.y + h / 2, soft),
            };
        }
        paint(slot, zoom, prefersReducedMotion() ? 0 : ms);   // «reduce motion»: the photo moves at once
    }

    // каждое фото вписано и без приближения; текущее — в zoom
    function centerAll() {
        slots.forEach(fitSlot);
        zoom = { s: 1, tx: cur().rest.x, ty: cur().rest.y };
    }

    function layout() {
        const p = pitch();
        slots.forEach((slot, k) => {
            slot.slide.style.transform = `translateX(${(k - 1) * p}px)`;
            fillSlot(slot, list[index + k - 1]);
        });
        centerAll();
    }

    function paintInfo() {
        const item = list[index];
        labelEl.textContent = item.label;
        showBtn.hidden = !onShow;   // кнопка есть у каждого фото
        const first = index === 0;
        const last = index === list.length - 1;
        prevBtn.classList.toggle('is-edge', first);
        prevBtn.setAttribute('aria-disabled', String(first));
        nextBtn.classList.toggle('is-edge', last);
        nextBtn.setAttribute('aria-disabled', String(last));
    }

    function setTrack(x, y, ms) {
        track.style.transition = ms ? `transform ${ms}ms ${EASE_OUT}` : 'none';
        track.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
    }

    // левый верхний угол области фото в координатах экрана; рамка текущего фото стоит в нём, лента — на 0
    function origin() {
        const r = stage.getBoundingClientRect();
        return { x: r.left, y: r.top };
    }

    /* ---------- листание ---------- */
    // лента доезжает сразу: следующий тап по краю листает дальше, а не ждёт конца анимации
    function finishSlide() {
        if (!sliding) return;
        clearTimeout(slideTimer);
        if (sliding > 0) slots.push(slots.shift());
        else slots.unshift(slots.pop());
        sliding = 0;
        setTrack(0, 0, 0);
        layout();
    }

    // dir: 1 — следующее, −1 — предыдущее. false — листать некуда. opts.instant — без перехода (клавиши ← →)
    function go(dir, opts = {}) {
        if (!isOpen) return false;
        finishSlide();
        const to = index + dir;
        if (to < 0 || to >= list.length) return false;
        if (zoom.s > 1) setZoom(1, 0, 0);   // приближенное фото уходит без приближения
        sliding = dir;
        index = to;
        lastTap = null;
        paintInfo();
        sr.textContent = `Фото ${index + 1} из ${list.length}: ${list[index].label}`;
        if (opts.instant || prefersReducedMotion()) {   // keyboard or «reduce motion»: the photo changes at once
            setTrack(-dir * pitch(), 0, 0);
            finishSlide();
            return true;
        }
        setTrack(-dir * pitch(), 0, SLIDE_MS);
        slideTimer = setTimeout(finishSlide, SLIDE_MS);
        return true;
    }

    /* ---------- открытие и закрытие ---------- */
    function open(items, start = 0) {
        if (!Array.isArray(items) || !items.length) return;
        list = items;
        index = clamp(start, 0, items.length - 1);
        clearTimeout(doneTimer);
        clearTimeout(slideTimer);
        sliding = 0;
        gesture = null;
        pts.clear();
        lastTap = null;
        el.style.transition = '';
        cancelReturn();
        setFade(1);   // фон и края — снова непрозрачные после свайпа, которым закрыли
        setTrack(0, 0, 0);
        paintInfo();   // сначала подпись и кнопка: от них зависит высота области фото
        layout();      // закрытый лайтбокс visibility: hidden, раскладка у него есть — размеры области известны
        el.classList.add('is-open');
        isOpen = true;
    }

    // opts.instant — без перехода (Esc)
    function close(onDone, opts = {}) {
        cancelReturn();
        if (!isOpen) {
            if (onDone) onDone();
            return;
        }
        isOpen = false;
        gesture = null;
        pts.clear();
        // после вертикального свайпа фон остаётся полупрозрачным, каким его отпустили: гаснет весь лайтбокс от него
        el.style.transition = '';
        if (opts.instant) {
            el.classList.add('lb-instant');
            requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('lb-instant')));
        }
        el.classList.remove('is-open');
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (onDone) onDone(); }, opts.instant ? 0 : LB_MS);
    }

    /* ---------- жесты на фото ---------- */
    function startOne(id) {
        const p = pts.get(id);
        gesture = { type: 'pending', pid: id, x0: p.x, y0: p.y, tx0: zoom.tx, ty0: zoom.ty };
    }

    function startPan(id) {
        const p = pts.get(id);
        gesture = { type: 'pan', pid: id, x0: p.x, y0: p.y, tx0: zoom.tx, ty0: zoom.ty };
    }

    function startPinch() {
        // вертикальный свайп одним пальцем обрывается: лента и фон сразу на месте
        cancelReturn();
        setTrack(0, 0, 0);
        setFade(1);
        const [a, b] = [...pts.values()];
        const o = origin();
        const mx = (a.x + b.x) / 2 - o.x;
        const my = (a.y + b.y) / 2 - o.y;
        gesture = {
            type: 'pinch',
            d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            s0: zoom.s,
            px: (mx - zoom.tx) / zoom.s,   // точка фото под пальцами, в px рамки без приближения
            py: (my - zoom.ty) / zoom.s,
        };
    }

    function movePinch() {
        const [a, b] = [...pts.values()];
        const o = origin();
        const s = clamp(gesture.s0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0, 1, MAX_ZOOM);
        setZoom(s, (a.x + b.x) / 2 - o.x - gesture.px * s, (a.y + b.y) / 2 - o.y - gesture.py * s);
    }

    /* Тап. Приближенное фото тапом не листается: двойной тап сбрасывает приближение, середина фото на экране
       остаётся на месте. Без приближения тап по левой или правой зоне листает, по середине — ничего */
    function onTap(e) {
        if (zoom.s > 1) {
            const now = performance.now();
            const dbl = lastTap
                && now - lastTap.t < DOUBLE_TAP_MS
                && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX;
            lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
            if (dbl) setZoom(1, 0, 0, ZOOM_RESET_MS);
            return;
        }
        lastTap = null;
        if (opt().tapOnFrame) {
            const r = cur().photo.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;   // white field: nothing
            const fx = (e.clientX - r.left) / r.width;
            if (fx < ZONE_PREV) go(-1);
            else if (fx >= ZONE_NEXT) go(1);
            return;
        }
        const x = (e.clientX - origin().x) / stage.clientWidth;
        if (x < ZONE_PREV) go(-1);
        else if (x >= ZONE_NEXT) go(1);
    }

    stage.addEventListener('pointerdown', (e) => {
        // стрелки — кнопки со своим click; третий палец и не левая кнопка мыши не считаются
        if (!isOpen || e.target.closest('.lb-arrow') || pts.size >= 2 || e.button !== 0) return;
        finishSlide();   // жест во время листания — по уже доехавшему фото
        if (stopReturn) { cancelReturn(); setTrack(0, 0, 0); setFade(1); }   // фото возвращалось после свайпа — уже на месте
        try { stage.setPointerCapture(e.pointerId); } catch {}
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) startPinch();
        else startOne(e.pointerId);
    });

    stage.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!gesture) return;
        if (gesture.type === 'pinch') { movePinch(); return; }
        if (e.pointerId !== gesture.pid) return;
        const dx = p.x - gesture.x0;
        const dy = p.y - gesture.y0;
        if (gesture.type === 'pending') {
            if (Math.hypot(dx, dy) <= SWIPE_SLOP) return;
            // направление — по первому заметному сдвигу. Приближенное фото двигается во все стороны;
            // без приближения вертикаль — свайп закрытия, протяжка вбок ничего не делает и не листает
            if (zoom.s > 1) gesture.type = 'pan';
            else gesture.type = Math.abs(dx) >= Math.abs(dy) || !opt().swipeClose ? 'none' : 'vertical';
            if (gesture.type === 'vertical') gesture.samples = [];
        }
        if (gesture.type === 'none') return;
        if (gesture.type === 'pan') {
            setZoom(zoom.s, gesture.tx0 + dx, gesture.ty0 + dy, 0, true);
        } else {
            setTrack(0, dy, 0);
            gesture.dy = dy;
            gesture.samples.push({ t: performance.now(), x: dy });
            if (gesture.samples.length > 12) gesture.samples.shift();
            // фото уходит за пальцем непрозрачным, белый фон и края тают — сквозь них видна схема
            setFade(fadeOf(dy));
        }
    });

    function onUp(e) {
        if (!pts.delete(e.pointerId)) return;
        try { stage.releasePointerCapture(e.pointerId); } catch {}
        if (!gesture) return;
        if (gesture.type === 'pinch') {
            // оставшийся палец двигает приближенное фото дальше
            gesture = null;
            const [id] = pts.keys();
            if (id !== undefined && zoom.s > 1) startPan(id);
            return;
        }
        if (e.pointerId !== gesture.pid) return;
        const d = gesture;
        gesture = null;
        const cancel = e.type === 'pointercancel';   // у pointercancel координаты не годятся
        if (d.type === 'pending') {
            if (!cancel) onTap(e);
            return;
        }
        if (d.type === 'none') return;   // протяжка вбок без приближения — ничего
        if (d.type === 'pan') {
            setZoom(zoom.s, zoom.tx, zoom.ty, RETURN_MS);   // фото остаётся, где отпустили; за краем — к краю
            return;
        }
        // вертикальный свайп: вверх или вниз дальше SWIPE_CLOSE или бросок быстрее FLICK_SPEED от середины —
        // закрытие; иначе фото на место пружиной со скоростью отпускания, фон и края — кадрами той же пружины
        const dy0 = d.dy || 0;
        const v = cancel ? 0 : windowedVelocity(d.samples, performance.now());   // px/s
        const flick = Math.abs(v) / 1000 > FLICK_SPEED && Math.sign(v) === Math.sign(dy0);
        if (!cancel && (Math.abs(e.clientY - d.y0) > SWIPE_CLOSE || flick)) { close(); return; }
        cancelReturn();
        stopReturn = spring({
            from: dy0, to: 0, velocity: v, ...releaseSpring(v),
            onUpdate: (y) => { setTrack(0, y, 0); setFade(fadeOf(y)); },
            onDone: () => { stopReturn = null; setTrack(0, 0, 0); setFade(1); },
        });
    }
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

    /* ---------- кнопки и клавиатура ---------- */
    prevBtn.addEventListener('click', () => go(-1));   // на крайнем фото go вернёт false — ничего
    nextBtn.addEventListener('click', () => go(1));
    q('.lb-close').addEventListener('click', () => close());
    showBtn.addEventListener('click', () => {
        if (!isOpen) return;
        const item = list[index];
        close();
        onShow(item);
    });

    document.addEventListener('keydown', (e) => {
        if (!isOpen) return;
        // keyboard actions are not animated
        if (e.key === 'Escape') close(null, { instant: true });
        else if (e.key === 'ArrowLeft') go(-1, { instant: true });
        else if (e.key === 'ArrowRight') go(1, { instant: true });
    });

    // поворот или смена ширины окна: лента и фото заново под новые размеры области
    window.addEventListener('resize', () => {
        if (!isOpen) return;
        finishSlide();
        setTrack(0, 0, 0);
        layout();
    });

    return {
        open,
        close,
        isOpen: () => isOpen,
    };
}
