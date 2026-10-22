/* ============================================================
   Фото на креслах, их метки-кружки и подсветка кресла после «Показать на схеме».
   Фото: набор загружается и раскладывается по креслам, галерея — в порядке зала; на каждом кресле с фото — кружок в SVG схемы.
   Подсветка — HTML-слой поверх схемы: размер контура в px экрана, касаний не принимает.
   ============================================================ */
import { loadPhotos, bindPhotos } from './photos.js';
import { SEL_HALF, SEL_RADIUS, SEL_COLOR } from './seats.js';

const SEAT_UNITS = 8;  // сторона кресла в SVG-юнитах: rect 8×8 (js/seats.js)

/* Подсветка кресла после «Показать на схеме»: контур в форме кресла цветом кресла,
   посадка и один ореол, дальше контур стоит до касания */
const HL_GAP = 2;                // px экрана, белый зазор между креслом и контуром
const HL_LINE = 3;               // px экрана, линия контура и ореола; = border в .seat-hl-ring и .seat-hl-halo
const HL_LAND_FROM = 1.6;        // посадка стартует в 1,6 размера покоя
const HL_LAND_UNDER = 0.95;      // перелёт посадки
const HL_LAND_UNDER_MS = 300;    // момент перелёта
const HL_LAND_MS = 350;
const HL_SHOW_MS = 100;          // непрозрачность контура 0 → 1
const HL_HALO_AT = 450;          // старт ореола от появления контура
const HL_HALO_MS = 700;
const HL_HALO_GROW = 2;          // ореол вырастает до 2 размеров контура
const HL_HALO_OPACITY = 0.5;
const HL_OFF_MS = 150;           // гашение по касанию
const HL_EASE = 'cubic-bezier(.33, 1, .68, 1)';   // быстрый старт, мягкая остановка

/* Сколько единиц схемы с каждой стороны кресла съедает белая обводка. Занятое кресло в hall.svg — заливка
   и поверх неё rect с теми же x, y и белой обводкой: обводка по центру края съедает stroke-width / 2. У свободного 0 */
function coverInset(el) {
    const cover = el.nextElementSibling;
    const covered = cover && cover.getAttribute('stroke') === 'white'
        && cover.getAttribute('x') === el.getAttribute('x')
        && cover.getAttribute('y') === el.getAttribute('y');
    return covered ? (+cover.getAttribute('stroke-width') || 0) / 2 : 0;
}

/* Видимая фигура кресла в единицах схемы: полусторона h и радиус угла r.
   Кресло в заказе — маркер выбора (js/seats.js) */
function seatShape(seat) {
    if (seat.selected) return { h: SEL_HALF, r: SEL_RADIUS };
    const el = seat.el;
    const rx = +el.getAttribute('rx') || 0;
    const inset = coverInset(el);
    return { h: SEAT_UNITS / 2 - inset, r: Math.max(0, rx - inset) };
}

/* Внешняя сторона d и внешний радиус угла R контура в px экрана; внутренний радиус = R − HL_LINE */
function ringBox({ h, r }, k) {
    return { d: 2 * (h * k + HL_GAP + HL_LINE), R: r * k + HL_GAP + HL_LINE };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Метка фото — кружок по центру кресла с фото, свободного и занятого. Рисуется в SVG схемы,
   поэтому растёт вместе с креслом при зуме; касаний не принимает — SVG схемы pointer-events: none */
const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SHARE = 6 / 16; // диаметр кружка — доля видимой стороны кресла: макет «Photo / centered-mg» 4598:17215 — кружок 6 на кресле 16
const DOT_DARKEN = 20;    // кружок темнее заливки кресла: яркость B в HSB меньше на 20 пунктов, H и S те же
                          // (макет: кресло #FA7E31, B 98 → кружок #C76427, B 78)

/* #RRGGBB → тот же тон и насыщенность с яркостью B (HSB) меньше на points пунктов.
   B — доля самого яркого канала; при тех же H и S все каналы меняются в одной пропорции newB / B */
function darkenHsb(hex, points) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex;
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const b = Math.max(...rgb) / 255;
    if (!b) return hex;
    const k = Math.max(0, b - points / 100) / b;
    return '#' + rgb.map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* hall — HallViewport; viewportEl — .map-viewport; seats — модель мест из buildSeats. */
export function createPhotoMap({ hall, viewportEl, seats }) {
    const seatsById = new Map(seats.map((s) => [s.id, s]));

    // подсветка кресла — сразу над схемой
    const hlEl = document.createElement('div');
    hlEl.className = 'seat-hl';
    hlEl.hidden = true;
    hlEl.setAttribute('aria-hidden', 'true');
    hlEl.innerHTML = '<span class="seat-hl-halo"></span><span class="seat-hl-ring"></span>';
    const contentEl = viewportEl.querySelector('.map-content');
    viewportEl.insertBefore(hlEl, contentEl ? contentEl.nextSibling : null);
    const haloEl = hlEl.firstElementChild;
    const ringEl = hlEl.lastElementChild;

    let bySeat = new Map();     // seatId → узел из bindPhotos
    let gallery = [];           // узлы в порядке галереи: секция, ряд от сцены, место слева направо

    /* ---------- фото ---------- */
    function load(url) {
        return loadPhotos(url).then((list) => {
            try {
                const nodes = bindPhotos(list, seatsById);
                bySeat = new Map(nodes.map((n) => [n.seatId, n]));
                // y растёт от сцены назад и от партера к балкону, x — слева направо; у кресел одного ряда y одинаковый
                gallery = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
                drawDots(nodes);
            } catch (e) {
                console.error('Фото: данные не разложены по креслам', e);
            }
        });
    }

    /* Кружки меток в SVG схемы: центр — центр кресла (node.x, node.y), диаметр — DOT_SHARE видимой стороны кресла
       (у занятого белая обводка съедает края: видимая сторона 8 − 3 = 5), цвет — заливка кресла темнее на DOT_DARKEN.
       Слой — под слоем увеличения фильтра цены и слоем маркеров выбора: увеличенная копия кресла
       и маркер выбранного места (11 единиц) закрывают кружок */
    let dotsEl = null;
    let dots = new Map();   // seatId → { r, fill } — кружок кресла, его же рисует увеличенная копия фильтра цены
    function drawDots(nodes) {
        const svg = seats.length ? seats[0].el.ownerSVGElement : null;
        if (!svg) return;
        if (dotsEl) dotsEl.remove();
        dots = new Map(nodes.map((n) => [n.seatId, {
            r: (SEAT_UNITS / 2 - coverInset(n.seat.el)) * DOT_SHARE,
            fill: darkenHsb(n.seat.el.getAttribute('fill'), DOT_DARKEN),
        }]));
        dotsEl = document.createElementNS(SVG_NS, 'g');
        dotsEl.setAttribute('class', 'photo-dots');
        dotsEl.innerHTML = nodes.map((n) => {
            const { r, fill } = dots.get(n.seatId);
            return `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}"/>`;
        }).join('');
        // нет слоя увеличения — под слой выбора, нет и его — в конец
        svg.insertBefore(dotsEl, svg.querySelector('.filter-layer') || svg.querySelector('.sel-layer'));
    }

    /* Из hall.opts.onView: контур подсветки едет вместе со схемой */
    function update() {
        placeHighlight(hall.viewTransform());
    }

    /* Из main.js после каждой перерисовки маркеров выбранных мест: кресло под контуром
       вошло в заказ или вышло из него — контур построен под прежнюю фигуру и цвет, убрать сразу,
       на его месте маркер выбора или кресло без маркера */
    function syncSelected() {
        if (hlSeat && hlSeat.selected !== hlSelected) stopHighlight();
    }

    /* ---------- подсветка кресла после «Показать на схеме» ---------- */
    let hlSeat = null;        // кресло под контуром; null — подсветки нет
    let hlShape = null;       // фигура кресла на момент подсветки: { h, r }
    let hlSelected = false;   // было ли кресло в заказе на момент подсветки
    let hlK = null;           // k, под который выставлен размер контура
    let hlAnims = [];         // посадка и ореол
    let hlFade = null;        // гашение по касанию

    /* Из update на каждом кадре изменения вида: сдвиг всегда, размер — при смене k */
    function placeHighlight({ k, ox, oy }) {
        if (!hlSeat) return;
        const x = +hlSeat.el.getAttribute('x') + SEAT_UNITS / 2;
        const y = +hlSeat.el.getAttribute('y') + SEAT_UNITS / 2;
        hlEl.style.transform = `translate(${x * k + ox}px, ${y * k + oy}px)`;
        if (k === hlK) return;
        hlK = k;
        const { d, R } = ringBox(hlShape, k);
        ringEl.style.width = `${d}px`;
        ringEl.style.height = `${d}px`;
        ringEl.style.borderRadius = `${R}px`;
    }

    /* Сразу, без гашения: новая подсветка или кресло под контуром вошло в заказ или вышло из него */
    function stopHighlight() {
        hlSeat = null;
        hlShape = null;
        hlK = null;
        hlEl.hidden = true;
        hlAnims.forEach((a) => a.cancel());
        hlAnims = [];
        if (hlFade) { hlFade.cancel(); hlFade = null; }
    }

    function highlightSeat(seatId) {
        stopHighlight();
        const seat = seatsById.get(seatId);
        if (!seat) return;
        hlSeat = seat;
        hlSelected = seat.selected;
        hlShape = seatShape(seat);
        // цвет — заливка кресла: тир у свободного, светло-серый у занятого; у кресла в заказе — маркер
        hlEl.style.color = seat.selected ? SEL_COLOR : seat.el.getAttribute('fill');
        const vt = hall.viewTransform();
        placeHighlight(vt);
        hlEl.hidden = false;
        if (reducedMotion()) return;   // контур сразу в размере покоя, без посадки и ореола

        const c = 'translate(-50%, -50%)';
        const { d, R } = ringBox(hlShape, vt.k);
        const G = HL_HALO_GROW;
        hlAnims = [
            // посадка: с 1,6 до 0,95 к 300 мс и до 1 к 350 мс; форма масштабируется целиком
            ringEl.animate([
                { transform: `${c} scale(${HL_LAND_FROM})`, easing: HL_EASE },
                { transform: `${c} scale(${HL_LAND_UNDER})`, offset: HL_LAND_UNDER_MS / HL_LAND_MS, easing: 'ease-in-out' },
                { transform: `${c} scale(1)` },
            ], { duration: HL_LAND_MS }),
            ringEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: HL_SHOW_MS }),
            // ореол: размер и радиус угла растут вдвое, линия остаётся 3 px — поэтому width/height, а не scale
            haloEl.animate([
                { width: `${d}px`, height: `${d}px`, borderRadius: `${R}px` },
                { width: `${d * G}px`, height: `${d * G}px`, borderRadius: `${R * G}px` },
            ], { duration: HL_HALO_MS, delay: HL_HALO_AT, easing: HL_EASE }),
            haloEl.animate([{ opacity: HL_HALO_OPACITY }, { opacity: 0 }], { duration: HL_HALO_MS, delay: HL_HALO_AT }),
        ];
    }

    /* Касание схемы или шторки: движение замирает там, где его застало касание,
       всё гаснет за 150 мс и больше не возвращается */
    function hideHighlight() {
        if (!hlSeat || hlFade) return;
        hlAnims.forEach((a) => { if (a.playState === 'running') a.pause(); });
        hlFade = hlEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HL_OFF_MS, easing: 'ease-out', fill: 'forwards' });
        hlFade.onfinish = stopHighlight;
    }

    return {
        load,
        // узел фото кресла; null — у кресла нет фото или набор ещё не загружен
        nodeOf: (seatId) => bySeat.get(seatId) || null,
        // кружок фото кресла { r, fill } в единицах схемы; null — у кресла нет фото
        dotOf: (seatId) => dots.get(seatId) || null,
        gallery: () => gallery,
        update,
        syncSelected,
        highlightSeat,
        hideHighlight,
    };
}
