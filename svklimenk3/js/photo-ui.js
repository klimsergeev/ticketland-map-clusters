/* ============================================================
   Лайтбокс с фото секций зала (вид с места).
   ============================================================ */

// Крестик — иконка макета лайтбокса (файл Z4wmhHaKhZMV8UI79y1a9Y, узел I4866:18387;4013:6005;547:208314), белая
const ICON_CROSS = 'assets/lightbox-cross-24.svg';

// Шевроны 24×24 — экспорт Figma, прежний фрейм lightbox; в новом макете стрелок нет. Цвет — currentColor, задаёт CSS.
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

const RETURN_MS = 150;      // возврат фото к краю после пана за край, возврат после короткого вертикального свайпа
const SWIPE_CLOSE = 80;     // px: вертикальный свайп дальше — закрытие, вверх или вниз
const SWIPE_SLOP = 6;       // px: меньше — это тап, а не свайп

const LB_MS = 200;          // проявление и гашение лайтбокса
const SLIDE_MS = 250;       // листание
const SLIDE_GAP = 16;       // px между фото на ленте, видно только во время листания
const EDGE_RUBBER = 0.35;   // сопротивление пана за краем фото: мягкий упор
const MAX_ZOOM = 3;
const ZOOM_RESET_MS = 200;  // сброс двойным тапом
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

/* Зоны тапа по фото — комментарии к кадру 4861:18110, ширина 360: слева полоса 79 — назад,
   справа от x 180 до края — вперёд, между ними тап ничего не делает. На другой ширине — в той же доле */
const ZONE_PREV = 79 / 360;
const ZONE_NEXT = 180 / 360;

/* Покачивание при открытии — подсказка, что фото двигается: после проявления лайтбокса фото плавно съезжает
   влево, потом вправо и возвращается в середину. Только если фото шире области и есть куда двигать */
const WOBBLE_DELAY = LB_MS;   // ждёт, пока лайтбокс проявится
const WOBBLE_MS = 900;
const WOBBLE_PX = 28;         // амплитуда; меньше, если фото выходит за область меньше чем на столько с каждой стороны
// опорные точки: [доля времени, сдвиг в долях амплитуды]; между точками — мягкая кривая easeInOutSine
const WOBBLE_KEYS = [[0, 0], [0.3, -1], [0.75, 1], [1, 0]];
const easeInOutSine = (t) => (1 - Math.cos(Math.PI * t)) / 2;
function wobbleAt(t) {
    for (let i = 1; i < WOBBLE_KEYS.length; i++) {
        const [t1, v1] = WOBBLE_KEYS[i];
        if (t > t1) continue;
        const [t0, v0] = WOBBLE_KEYS[i - 1];
        return v0 + (v1 - v0) * easeInOutSine((t - t0) / (t1 - t0));
    }
    return 0;
}

/* Лайтбокс с фото: галерея фото секций зала.
   open(items, start) — items: [{ key, photo: { url, caption }, label }] в порядке галереи (photoMap.gallery()),
   start — индекс фото, с которого открыть. Под фото — подпись секции label («Партер, левая сторона»)
   и «Показать на схеме»: лайтбокс закрывается, onShow(item) ведёт схему к секции фото.
   Фото занимает всю высоту от верхнего края до подписи (крестик поверх фото), по ширине обрезано, видна середина;
   тап по краям листает, протяжка двигает фото вбок, вертикальный свайп закрывает. При открытии фото
   один раз покачивается — подсказка, что его можно двигать.
   close(onDone) — onDone через LB_MS по таймеру, а не по transitionend: колбэк приходит, даже если переход не сыграл. */
export function createLightbox({ parentEl, onShow }) {
    const el = document.createElement('div');
    el.className = 'lb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Фото секций зала');
    const slideHtml = '<div class="lb-slide"><div class="lb-photo"><img class="lb-img" alt="" draggable="false"></div></div>';
    el.innerHTML =
        '<div class="lb-stage">'
        + `<div class="lb-track">${slideHtml}${slideHtml}${slideHtml}</div>`
        + `<button class="lb-arrow lb-arrow--prev" type="button" aria-label="Предыдущее фото">${icoChevronLeft24}</button>`
        + `<button class="lb-arrow lb-arrow--next" type="button" aria-label="Следующее фото">${icoChevronRight24}</button>`
        + '</div>'
        + '<div class="lb-bottom">'
        + '<div class="lb-info">'
        + '<div class="lb-place"><span class="lb-seat"></span></div>'
        + '</div>'
        + '<button class="lb-show" type="button">Показать на схеме</button>'
        + '</div>'
        // крестик — поверх фото в правом верхнем углу, отдельной шапки нет (макет 4866:18319)
        + `<button class="lb-close" type="button" aria-label="Закрыть"><img src="${ICON_CROSS}" width="24" height="24" alt=""></button>`;
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
    const showBtn = q('.lb-show');
    const labelEl = q('.lb-seat');   // подпись секции — на месте строки с местом

    // Три слота ленты: предыдущее, текущее, следующее. После листания слоты переставляются,
    // а не перезаливаются: картинка на экране не мигает
    let slots = [...el.querySelectorAll('.lb-slide')].map((slide) => {
        const img = slide.querySelector('.lb-img');
        const slot = { slide, photo: slide.querySelector('.lb-photo'), img, url: null };
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });   // битая картинка — пусто
        // рамка — в пропорциях самой картинки: по высоте фото не обрезается
        img.addEventListener('load', () => {
            if (!img.naturalWidth || !img.naturalHeight) return;
            slot.photo.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
            if (slot !== cur()) paint(slot, { s: 1, tx: centerX(slot), ty: 0 }, 0);
            else if (wobbleRaf) return;   // покачивание считает середину каждый кадр само
            else if (!gesture && zoom.s === 1) setZoom(1, centerX(slot), 0);   // фото ещё не трогали — по центру
            else setZoom(zoom.s, zoom.tx, zoom.ty);
        });
        return slot;
    });

    let isOpen = false;
    let list = [];
    let index = 0;
    let sliding = 0;         // 0 — лента стоит; 1 или −1 — едет к следующему или предыдущему фото
    /* Положение текущего фото: масштаб s и сдвиг рамки tx, ty в px от левого верхнего угла области.
       Рамка шире области (высота области × 3 : 2), поэтому и без приближения tx бывает от «ширина области −
       ширина рамки» до 0; ty без приближения — 0 */
    let zoom = { s: 1, tx: 0, ty: 0 };
    let doneTimer = null;
    let slideTimer = null;
    let returnTimer = null;
    let wobbleTimer = null;  // покачивание ждёт проявления лайтбокса
    let wobbleRaf = null;    // покачивание идёт
    const pts = new Map();   // pointerId → { x, y }: пальцы на области фото, не больше двух
    let gesture = null;      // { type: 'pending' | 'pan' | 'vertical' | 'pinch', … }
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
    // offset* не учитывают transform: размеры рамки без приближения
    const centerX = (slot) => (stage.clientWidth - slot.photo.offsetWidth) / 2;

    function paint(slot, z, ms) {
        const p = slot.photo;
        p.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)` : 'none';
        p.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.s})`;
    }

    /* Границы сдвига: рамка закрывает область целиком. soft — протяжка пальцем: за границей с сопротивлением,
       отпустили — setZoom без soft возвращает к границе */
    function setZoom(s, tx, ty, ms = 0, soft = false) {
        const p = cur().photo;
        s = clamp(s, 1, MAX_ZOOM);
        const minX = stage.clientWidth - p.offsetWidth * s;
        const minY = stage.clientHeight - p.offsetHeight * s;
        const fit = soft ? rubber : clamp;
        zoom = { s, tx: fit(tx, Math.min(minX, 0), 0), ty: fit(ty, Math.min(minY, 0), 0) };
        paint(cur(), zoom, ms);
    }

    // каждое фото без приближения и по центру; текущее — в zoom
    function centerAll() {
        slots.forEach((slot) => paint(slot, { s: 1, tx: centerX(slot), ty: 0 }, 0));
        zoom = { s: 1, tx: centerX(cur()), ty: 0 };
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
        track.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)` : 'none';
        track.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
    }

    // левый верхний угол области фото в координатах экрана; рамка текущего фото стоит в нём, лента — на 0
    function origin() {
        const r = stage.getBoundingClientRect();
        return { x: r.left, y: r.top };
    }

    /* ---------- покачивание при открытии ---------- */
    // фото остаётся там, где его застала остановка: касание забирает его с этого места
    function stopWobble() {
        clearTimeout(wobbleTimer);
        cancelAnimationFrame(wobbleRaf);
        wobbleTimer = null;
        wobbleRaf = null;
    }

    function wobble() {
        stopWobble();
        wobbleTimer = setTimeout(() => {
            wobbleTimer = null;
            const slot = cur();
            const room = (slot.photo.offsetWidth - stage.clientWidth) / 2;   // запас сдвига от середины в каждую сторону
            if (room < 1) return;   // фото не шире области — двигать нечего
            const a = Math.min(WOBBLE_PX, room);
            const t0 = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - t0) / WOBBLE_MS);
                setZoom(1, centerX(slot) + a * wobbleAt(t), 0);   // середина — каждый кадр: картинка могла догрузиться
                wobbleRaf = t < 1 ? requestAnimationFrame(step) : null;
            };
            wobbleRaf = requestAnimationFrame(step);
        }, WOBBLE_DELAY);
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

    // dir: 1 — следующее, −1 — предыдущее. false — листать некуда
    function go(dir) {
        if (!isOpen) return false;
        stopWobble();
        finishSlide();
        const to = index + dir;
        if (to < 0 || to >= list.length) return false;
        if (zoom.s > 1) setZoom(1, centerX(cur()), 0);   // приближенное фото уходит без приближения
        sliding = dir;
        index = to;
        lastTap = null;
        paintInfo();
        sr.textContent = `Фото ${index + 1} из ${list.length}: ${list[index].label}`;
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
        clearTimeout(returnTimer);
        sliding = 0;
        gesture = null;
        pts.clear();
        lastTap = null;
        el.style.transition = '';
        el.style.removeProperty('--lb-fade');   // фон и края — снова непрозрачные после свайпа, которым закрыли
        setTrack(0, 0, 0);
        paintInfo();   // сначала подпись и кнопка: от них зависит высота области фото
        layout();      // закрытый лайтбокс visibility: hidden, раскладка у него есть — размеры области известны
        el.classList.add('is-open');
        isOpen = true;
        wobble();      // при каждом открытии, при листании — нет
    }

    function close(onDone) {
        clearTimeout(returnTimer);
        stopWobble();
        if (!isOpen) {
            if (onDone) onDone();
            return;
        }
        isOpen = false;
        gesture = null;
        pts.clear();
        // после вертикального свайпа фон остаётся полупрозрачным, каким его отпустили: гаснет весь лайтбокс от него
        el.style.transition = '';
        el.classList.remove('is-open');
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (onDone) onDone(); }, LB_MS);
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
        setTrack(0, 0, 0);
        el.style.transition = '';
        el.style.removeProperty('--lb-fade');
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
            if (dbl) setZoom(1, stage.clientWidth / 2 - (stage.clientWidth / 2 - zoom.tx) / zoom.s, 0, ZOOM_RESET_MS);
            return;
        }
        lastTap = null;
        const x = (e.clientX - origin().x) / stage.clientWidth;
        if (x < ZONE_PREV) go(-1);
        else if (x >= ZONE_NEXT) go(1);
    }

    stage.addEventListener('pointerdown', (e) => {
        // стрелки — кнопки со своим click; третий палец и не левая кнопка мыши не считаются
        if (!isOpen || e.target.closest('.lb-arrow') || pts.size >= 2 || e.button !== 0) return;
        stopWobble();    // касание прекращает покачивание и забирает фото с того места, где оно сейчас
        finishSlide();   // жест во время листания — по уже доехавшему фото
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
            // направление — по первому заметному сдвигу; приближенное фото двигается во все стороны
            gesture.type = zoom.s > 1 || Math.abs(dx) >= Math.abs(dy) ? 'pan' : 'vertical';
            if (gesture.type === 'vertical') el.style.transition = 'none';
        }
        if (gesture.type === 'pan') {
            // без приближения фото ходит только вбок: по высоте оно ровно в области
            setZoom(zoom.s, gesture.tx0 + dx, zoom.s > 1 ? gesture.ty0 + dy : 0, 0, true);
        } else {
            setTrack(0, dy, 0);
            // фото уходит за пальцем непрозрачным, белый фон и края тают — сквозь них видна схема
            el.style.setProperty('--lb-fade', String(Math.max(0, 1 - Math.abs(dy) / (stage.clientHeight / 2))));
        }
    });

    function onUp(e) {
        if (!pts.delete(e.pointerId)) return;
        try { stage.releasePointerCapture(e.pointerId); } catch {}
        if (!gesture) return;
        if (gesture.type === 'pinch') {
            // оставшийся палец двигает фото дальше
            gesture = null;
            const [id] = pts.keys();
            if (id !== undefined) startPan(id);
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
        if (d.type === 'pan') {
            setZoom(zoom.s, zoom.tx, zoom.ty, RETURN_MS);   // фото остаётся, где отпустили; за краем — к краю
            return;
        }
        // вертикальный свайп: вверх или вниз дальше SWIPE_CLOSE — закрытие, короче — фото на место
        if (!cancel && Math.abs(e.clientY - d.y0) > SWIPE_CLOSE) { close(); return; }
        setTrack(0, 0, RETURN_MS);
        el.style.transition = `--lb-fade ${RETURN_MS}ms ease-out`;
        el.style.removeProperty('--lb-fade');
        clearTimeout(returnTimer);
        returnTimer = setTimeout(() => { el.style.transition = ''; }, RETURN_MS);
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
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
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
