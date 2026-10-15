/* ============================================================
   Переключатель режима фото, тултип над ним и лайтбокс с фото (вид с места).
   ============================================================ */
import { formatPrice } from './data.js';

// Хвостик тултипа 60×8 — ассет Figma «Arrow», node I4300:19820;5010:334
const icoTipArrow =
    '<svg class="photo-tip-arrow" width="60" height="8" viewBox="0 0 60 8" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M42.5 8C39.5 8 36.5001 0 32.5 0H52.5C48.5251 0 45.5 8 42.5 8Z" fill="currentColor"/>'
    + '</svg>';

// Иконки лайтбокса 24×24 — экспорт Figma, фрейм lightbox. Цвет — currentColor, задаёт CSS.
// Крестик — компонент «Cross», node I4334:28383;3977:1542;3477:481;75180:415565;547:208314
const icoCross24 =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M6.29289 16.2929C5.90237 16.6834 5.90237 17.3166 6.29289 17.7071C6.68342 18.0976 7.31658 18.0976 7.70711 17.7071L11.9999 13.4143L16.2929 17.7073C16.6834 18.0978 17.3166 18.0978 17.7071 17.7073C18.0976 17.3167 18.0976 16.6836 17.7071 16.293L13.4141 12.0001L17.7071 7.70711C18.0976 7.31658 18.0976 6.68342 17.7071 6.29289C17.3166 5.90237 16.6834 5.90237 16.2929 6.29289L11.9999 10.5859L7.70711 6.29304C7.31658 5.90252 6.68342 5.90252 6.2929 6.29304C5.90237 6.68357 5.90237 7.31673 6.29289 7.70726L10.5857 12.0001L6.29289 16.2929Z" fill="currentColor"/>'
    + '</svg>';

// Шеврон влево — компонент «Chevron Left», node I4334:28387;547:207731
const icoChevronLeft24 =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M15 5.01246C15 4.11226 13.9234 3.66144 13.2938 4.29798V4.29798L10.1984 7.4273C8.06612 9.58289 7 10.6607 7 12C7 13.3393 8.06612 14.4171 10.1984 16.5727L13.2938 19.702C13.9234 20.3386 15 19.8877 15 18.9875C15 18.7196 14.8947 18.4625 14.7073 18.2731L11.6118 15.1437C10.5058 14.0255 9.82141 13.3276 9.38882 12.7544C8.99838 12.2371 8.99883 12.0565 8.99897 12.0028L8.99897 12L8.99897 11.9973C8.99883 11.9435 8.99838 11.7629 9.38882 11.2456C9.8214 10.6724 10.5058 9.97446 11.6118 8.85627L14.7073 5.72695V5.72695C14.8947 5.53745 15 5.28044 15 5.01246Z" fill="currentColor"/>'
    + '</svg>';

// Шеврон вправо — компонент «Chevron Right», node I4334:28389;547:207741
const icoChevronRight24 =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M9 5.01246C9 4.11226 10.0766 3.66144 10.7062 4.29798L13.8016 7.4273C15.9339 9.58289 17 10.6607 17 12C17 13.3393 15.9339 14.4171 13.8016 16.5727L10.7062 19.702C10.0766 20.3386 9 19.8877 9 18.9875C9 18.7196 9.1053 18.4625 9.29274 18.2731L12.3882 15.1437C13.4942 14.0255 14.1786 13.3276 14.6112 12.7544C15.0016 12.2371 15.0012 12.0565 15.001 12.0028L15.001 12L15.001 11.9973C15.0012 11.9435 15.0016 11.7629 14.6112 11.2456C14.1786 10.6724 13.4942 9.97446 12.3882 8.85627L9.29274 5.72695C9.1053 5.53745 9 5.28044 9 5.01246Z" fill="currentColor"/>'
    + '</svg>';

const RETURN_MS = 150;      // возврат фото после короткого свайпа
const SWIPE_CLOSE = 80;     // px: свайп вниз дальше — закрытие
const SWIPE_SLOP = 6;       // px: меньше — это тап, а не свайп

const LB_MS = 200;          // проявление и гашение лайтбокса
const SLIDE_MS = 250;       // листание
const SLIDE_GAP = 16;       // px между фото на ленте, видно только во время листания
const FLIP_SHARE = 0.2;     // доля ширины: свайп дальше — листание
const FLICK_MS = 300;       // быстрый короткий свайп — тоже листание,
const FLICK_PX = 30;        // если палец прошёл больше этого
const EDGE_RUBBER = 0.35;   // сопротивление свайпа за крайним фото
const MAX_ZOOM = 3;
const ZOOM_RESET_MS = 200;  // сброс двойным тапом
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

const TIP_TEXT = 'Посмотрите фото с мест, чтобы выбрать лучшие';
const TIP_DELAY_MS = 1000;   // от отрисовки схемы до появления
const TIP_IN_MS = 200;       // проявление
const TIP_HOLD_MS = 5000;    // показ после полного проявления

/* Переключатель «Фото с мест» в доке у правого нижнего угла. Клик → onChange(!on).
   → { dockEl, btnEl, setOn(on), setLift(px) }; dockEl — родитель для тултипа */
export function createPhotoToggle({ parentEl, onChange }) {
    const dock = document.createElement('div');
    dock.className = 'photo-dock';
    dock.innerHTML =
        '<button class="photo-switch" type="button" role="switch" aria-checked="false">'
        + '<span class="photo-switch-label">Фото с мест</span>'
        + '<span class="photo-switch-track" aria-hidden="true"><span class="photo-switch-knob"></span></span>'
        + '</button>';
    parentEl.appendChild(dock);

    const btn = dock.querySelector('.photo-switch');
    let on = false;
    btn.addEventListener('click', () => onChange(!on));

    return {
        dockEl: dock,
        btnEl: btn,
        setOn(v) {
            on = !!v;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-checked', String(on));
        },
        setLift(px) {
            dock.style.transform = px > 0 ? `translateY(${-px}px)` : '';
        },
    };
}

/* Тултип над кнопкой режима. Один раз за загрузку страницы.
   → { schedule(), dismiss() }: schedule — запустить отсчёт 1 с; dismiss — погасить или отменить навсегда */
export function createPhotoTip({ parentEl }) {
    const el = document.createElement('div');
    el.className = 'photo-tip';
    el.setAttribute('aria-hidden', 'true');   // диктору текст отдаёт live-строка ниже
    el.innerHTML = `<div class="photo-tip-body">${TIP_TEXT}</div>${icoTipArrow}`;
    parentEl.appendChild(el);

    // Live-строка вне тултипа: тултип до показа visibility: hidden, а скрытый live-регион диктор не слушает.
    // Пустая до показа; текст вписывается в момент показа — зачитывается один раз, вежливо
    const sr = document.createElement('span');
    sr.className = 'photo-sr';
    sr.setAttribute('aria-live', 'polite');
    parentEl.appendChild(sr);

    let state = 'idle';   // idle → pending → shown → done; из done не возвращается до перезагрузки
    let timer = null;

    function schedule() {
        if (state !== 'idle') return;
        state = 'pending';
        timer = setTimeout(show, TIP_DELAY_MS);
    }

    function show() {
        state = 'shown';
        el.classList.add('is-shown');
        sr.textContent = TIP_TEXT;
        timer = setTimeout(dismiss, TIP_IN_MS + TIP_HOLD_MS);
    }

    // Любая причина — таймер, касание схемы, кнопка, касание тултипа — одно и то же исчезновение.
    // До показа (idle, pending) — отмена: в эту загрузку тултипа не будет
    function dismiss() {
        clearTimeout(timer);
        if (state === 'shown') {
            el.classList.remove('is-shown');
            el.classList.add('is-gone');
        }
        state = 'done';
    }

    el.addEventListener('pointerdown', dismiss);
    return { schedule, dismiss };
}

// Место словами: «партер, ряд 3, место 12» — для подписи к фото и для диктора
const seatText = (s) => `${s.section.toLowerCase()}, ряд ${s.row}, место ${s.seat}`;

/* Лайтбокс с фото: галерея всех фото зала.
   open(node, list) — node из bindPhotos, list — узлы в порядке галереи (photoMap.gallery()).
   close(onDone) — onDone через LB_MS по таймеру, а не по transitionend: колбэк приходит, даже если переход не сыграл.
   onShow(node) — кнопка «Показать на схеме» для открытого фото. */
export function createLightbox({ parentEl, onShow }) {
    const el = document.createElement('div');
    el.className = 'lb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Фото с места');
    const slideHtml = '<div class="lb-slide"><div class="lb-photo"><img class="lb-img" alt="" draggable="false"></div></div>';
    el.innerHTML =
        `<div class="lb-top"><button class="lb-close" type="button" aria-label="Закрыть">${icoCross24}</button></div>`
        + '<div class="lb-stage">'
        + `<div class="lb-track">${slideHtml}${slideHtml}${slideHtml}</div>`
        + `<button class="lb-arrow lb-arrow--prev" type="button" aria-label="Предыдущее фото">${icoChevronLeft24}</button>`
        + `<button class="lb-arrow lb-arrow--next" type="button" aria-label="Следующее фото">${icoChevronRight24}</button>`
        + '</div>'
        + '<div class="lb-bottom">'
        + '<div class="lb-info"><div class="lb-place"><span class="lb-section"></span><span class="lb-seat"></span></div><div class="lb-price"></div></div>'
        + '<button class="lb-show" type="button">Показать на схеме</button>'
        + '</div>';
    parentEl.appendChild(el);

    // Live-строка вне лайтбокса: закрытый лайтбокс visibility: hidden, а скрытый live-регион диктор не слушает
    const sr = document.createElement('span');
    sr.className = 'photo-sr';
    sr.setAttribute('aria-live', 'polite');
    parentEl.appendChild(sr);

    const q = (s) => el.querySelector(s);
    const stage = q('.lb-stage');
    const track = q('.lb-track');
    const prevBtn = q('.lb-arrow--prev');
    const nextBtn = q('.lb-arrow--next');
    const sectionEl = q('.lb-section');
    const seatEl = q('.lb-seat');
    const priceEl = q('.lb-price');

    // Три слота ленты: предыдущее, текущее, следующее. После листания слоты переставляются,
    // а не перезаливаются: картинка на экране не мигает
    let slots = [...el.querySelectorAll('.lb-slide')].map((slide) => {
        const img = slide.querySelector('.lb-img');
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });   // битая картинка — пусто
        return { slide, photo: slide.querySelector('.lb-photo'), img, url: null };
    });

    let isOpen = false;
    let list = [];
    let index = 0;
    let sliding = false;
    let zoom = { s: 1, tx: 0, ty: 0 };   // приближение текущего фото: масштаб и сдвиг в px от левого верхнего угла рамки
    let doneTimer = null;
    let slideTimer = null;
    let returnTimer = null;
    const pts = new Map();   // pointerId → { x, y }: пальцы на области фото, не больше двух
    let gesture = null;      // { type: 'pending' | 'swipe' | 'down' | 'pan' | 'pinch' | 'none', … }
    let lastTap = null;      // прошлый тап по фото — для двойного

    const cur = () => slots[1];
    const pitch = () => stage.clientWidth + SLIDE_GAP;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function fillSlot(slot, node) {
        slot.slide.style.visibility = node ? '' : 'hidden';   // за крайним фото слот пустой
        if (!node) return;
        slot.img.alt = node.photo.caption || '';
        if (slot.url === node.photo.url) return;
        slot.url = node.photo.url;
        slot.img.style.visibility = '';
        slot.img.src = node.photo.url;
    }

    function layout() {
        const p = pitch();
        slots.forEach((slot, k) => {
            slot.slide.style.transform = `translateX(${(k - 1) * p}px)`;
            fillSlot(slot, list[index + k - 1]);
        });
    }

    function paintInfo() {
        const s = list[index].seat;
        sectionEl.textContent = s.section;
        seatEl.textContent = `Ряд ${s.row} место ${s.seat}`;
        priceEl.textContent = s.status === 'available' && s.price != null ? formatPrice(s.price) : 'Недоступно';
        const first = index === 0;
        const last = index === list.length - 1;
        prevBtn.classList.toggle('is-edge', first);
        prevBtn.setAttribute('aria-disabled', String(first));
        nextBtn.classList.toggle('is-edge', last);
        nextBtn.setAttribute('aria-disabled', String(last));
    }

    function setTrack(x, y, ms) {
        track.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)` : 'none';
        track.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
    }

    /* ---------- приближение ---------- */
    function applyZoom(ms) {
        const p = cur().photo;
        p.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)` : 'none';
        p.style.transform = zoom.s > 1 ? `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})` : '';
        p.classList.toggle('is-zoomed', zoom.s > 1);
    }

    /* Границы: по горизонтали фото закрывает ширину области; по вертикали фото ниже области
       остаётся внутри неё, выше области — закрывает её. Масштаб 1 — фото на своём месте */
    function setZoom(s, tx, ty, ms = 0) {
        if (s <= 1.001) {
            zoom = { s: 1, tx: 0, ty: 0 };
        } else {
            const p = cur().photo;   // offset* не учитывают transform: размеры и место рамки без приближения
            const w = p.offsetWidth;
            const h = p.offsetHeight;
            const a = -p.offsetTop;
            const b = stage.clientHeight - p.offsetTop - h * s;
            zoom = { s, tx: clamp(tx, w - w * s, 0), ty: clamp(ty, Math.min(a, b), Math.max(a, b)) };
        }
        applyZoom(ms);
    }

    // сразу, без перехода: в том числе после плавного сброса двойным тапом
    function resetAllZoom() {
        zoom = { s: 1, tx: 0, ty: 0 };
        slots.forEach((slot) => {
            slot.photo.style.transition = 'none';
            slot.photo.style.transform = '';
            slot.photo.classList.remove('is-zoomed');
        });
    }

    // левый верхний угол рамки текущего фото в координатах экрана; лента во время щипка стоит на 0
    function origin() {
        const r = stage.getBoundingClientRect();
        const p = cur().photo;
        return { x: r.left + p.offsetLeft, y: r.top + p.offsetTop };
    }

    /* ---------- листание ---------- */
    // dir: 1 — следующее, −1 — предыдущее. false — листать некуда или листание уже идёт
    function go(dir) {
        const to = index + dir;
        if (!isOpen || sliding || to < 0 || to >= list.length) return false;
        setZoom(1, 0, 0);
        sliding = true;
        index = to;
        paintInfo();
        sr.textContent = `Фото ${index + 1} из ${list.length}: ${seatText(list[index].seat)}`;
        setTrack(-dir * pitch(), 0, SLIDE_MS);   // от текущего положения ленты, в том числе после свайпа
        clearTimeout(slideTimer);
        slideTimer = setTimeout(() => {
            if (dir > 0) slots.push(slots.shift());
            else slots.unshift(slots.pop());
            setTrack(0, 0, 0);
            layout();
            sliding = false;
        }, SLIDE_MS);
        return true;
    }

    /* ---------- открытие и закрытие ---------- */
    function open(node, all) {
        const i = Array.isArray(all) ? all.findIndex((n) => n.seatId === node.seatId) : -1;
        list = i === -1 ? [node] : all;
        index = i === -1 ? 0 : i;
        clearTimeout(doneTimer);
        clearTimeout(slideTimer);
        clearTimeout(returnTimer);
        sliding = false;
        gesture = null;
        pts.clear();
        lastTap = null;
        el.style.transition = '';
        el.style.opacity = '';
        setTrack(0, 0, 0);
        resetAllZoom();
        layout();   // закрытый лайтбокс visibility: hidden, раскладка у него есть — ширина области известна
        paintInfo();
        el.classList.add('is-open');
        isOpen = true;
    }

    function close(onDone) {
        clearTimeout(returnTimer);
        if (!isOpen) {
            if (onDone) onDone();
            return;
        }
        isOpen = false;
        gesture = null;
        pts.clear();
        // инлайн-стили свайпа вниз снимаются в том же кадре: гашение идёт от текущей прозрачности
        el.style.transition = '';
        el.style.opacity = '';
        el.classList.remove('is-open');
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (onDone) onDone(); }, LB_MS);
    }

    /* ---------- жесты на фото ---------- */
    function startOne(id) {
        const p = pts.get(id);
        gesture = { type: 'pending', pid: id, x0: p.x, y0: p.y, t0: performance.now(), tx0: zoom.tx, ty0: zoom.ty };
    }

    function startPan(id) {
        const p = pts.get(id);
        gesture = { type: 'pan', pid: id, x0: p.x, y0: p.y, tx0: zoom.tx, ty0: zoom.ty };
    }

    function startPinch() {
        // свайп одним пальцем обрывается: лента и прозрачность сразу на месте
        setTrack(0, 0, 0);
        el.style.transition = '';
        el.style.opacity = '';
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

    function onTap(e) {
        const now = performance.now();
        const dbl = lastTap
            && now - lastTap.t < DOUBLE_TAP_MS
            && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX;
        lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
        if (dbl && zoom.s > 1) setZoom(1, 0, 0, ZOOM_RESET_MS);
    }

    stage.addEventListener('pointerdown', (e) => {
        // стрелки — кнопки со своим click; третий палец не считается
        if (!isOpen || sliding || e.target.closest('.lb-arrow') || pts.size >= 2) return;
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
            if (zoom.s > 1) gesture.type = 'pan';
            else if (Math.abs(dx) >= Math.abs(dy)) gesture.type = 'swipe';
            else gesture.type = dy > 0 ? 'down' : 'none';
            if (gesture.type === 'down') el.style.transition = 'none';
        }
        if (gesture.type === 'pan') {
            setZoom(zoom.s, gesture.tx0 + dx, gesture.ty0 + dy);
        } else if (gesture.type === 'swipe') {
            const edge = (dx > 0 && index === 0) || (dx < 0 && index === list.length - 1);
            setTrack(edge ? dx * EDGE_RUBBER : dx, 0, 0);
        } else if (gesture.type === 'down') {
            const y = Math.max(0, dy);
            setTrack(0, y, 0);
            el.style.opacity = String(Math.max(0.5, 1 - y / stage.clientHeight));
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
        const dx = e.clientX - d.x0;
        const dy = e.clientY - d.y0;
        if (d.type === 'pending') {
            if (!cancel) onTap(e);
            return;
        }
        if (d.type === 'swipe') {
            const far = Math.abs(dx) > stage.clientWidth * FLIP_SHARE;
            const flick = performance.now() - d.t0 < FLICK_MS && Math.abs(dx) > FLICK_PX;
            if (cancel || !(far || flick) || !go(dx < 0 ? 1 : -1)) setTrack(0, 0, RETURN_MS);
            return;
        }
        if (d.type === 'down') {
            if (!cancel && dy > SWIPE_CLOSE) { close(); return; }
            setTrack(0, 0, RETURN_MS);
            el.style.transition = `opacity ${RETURN_MS}ms ease-out`;
            el.style.opacity = '';
            clearTimeout(returnTimer);
            returnTimer = setTimeout(() => { el.style.transition = ''; }, RETURN_MS);
        }
    }
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

    /* ---------- кнопки и клавиатура ---------- */
    prevBtn.addEventListener('click', () => go(-1));   // на крайнем фото go вернёт false — ничего
    nextBtn.addEventListener('click', () => go(1));
    q('.lb-close').addEventListener('click', () => close());
    q('.lb-show').addEventListener('click', () => {
        if (!isOpen) return;   // второй тап, пока лайтбокс гаснет, — ничего
        const n = list[index];
        // сначала пусто, потом текст: одна и та же фраза подряд зачитывается снова
        sr.textContent = '';
        requestAnimationFrame(() => { sr.textContent = `Показано: ${seatText(n.seat)}`; });
        onShow(n);
    });

    document.addEventListener('keydown', (e) => {
        if (!isOpen) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
    });

    // поворот или смена ширины окна: лента и приближение заново под новую ширину
    window.addEventListener('resize', () => {
        if (!isOpen || sliding) return;
        setTrack(0, 0, 0);
        resetAllZoom();
        layout();
    });

    return {
        open,
        close,
        isOpen: () => isOpen,
    };
}
