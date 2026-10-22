/* ============================================================
   Модель мест схемы зала.
   Данные (ряд/место/цена/секция/статус) НЕ хранятся отдельным списком,
   а ВЫВОДЯТСЯ из геометрии инлайн-SVG (assets/hall.svg) — единственного
   источника расположения мест. Так модель не может «разъехаться» со схемой.

   Каждое место схемы — <rect width=8 height=8>. Цвет fill кодирует тир:
     • тир-цвет из TIERS  → доступное место, цена = цене тира;
     • #D8E0E8            → занятое/недоступное место (без цены).
   (У занятого места в SVG два rect: заливка + белая обводка — обводочный
    rect без атрибута fill, поэтому фильтр по fill его отсеивает, дублей нет.)

   Секции (части зала) по порядку от сцены: партер, амфитеатр, бельэтаж, балкон.
     • граница частей — разрыв между соседними рядами не меньше SECTION_GAP
       (в схеме 61 при шаге ряда 14); разрывы меньше — проходы внутри части,
       как проход 24 внутри балкона, они части не делят;
     • номера рядов: партер, амфитеатр и бельэтаж — сквозные от сцены (1–14),
       балкон — свой счёт с 1. Общий счёт задаёт поле rows в SECTIONS.
   Сторона места side — 'left' | 'center' | 'right': ось — середина продольного
   прохода (самый широкий разрыв между соседними местами ряда, в схеме x 260…276 → 268).
   Центр — места, чей центр не дальше от оси, чем треть полуширины части зала
   (партер — по 4 места с каждой стороны прохода, бельэтаж — по 5, амфитеатр и балкон — по 7).

   buildSeats() размечает rect'ы data-атрибутами (data-section/row/seat/
   side/price/tier/status) — данные «привязаны к местам» прямо в DOM — и
   возвращает массив объектов-мест.
   ============================================================ */
import { TIER_COLORS } from './data.js';

const OCCUPIED = '#D8E0E8';
const SEAT = 8;           // сторона места в единицах схемы
const SECTION_GAP = 40;   // разрыв по Y не меньше этого = граница частей зала
/* Части зала по порядку от сцены. key — латиницей для seatId и ключа фото секции,
   rows — счёт рядов: у частей с одинаковым rows номера рядов сквозные */
const SECTIONS = [
    { name: 'Партер', key: 'parter', rows: 'hall' },
    { name: 'Амфитеатр', key: 'amphitheatre', rows: 'hall' },
    { name: 'Бельэтаж', key: 'beletage', rows: 'hall' },
    { name: 'Балкон', key: 'balcony', rows: 'balcony' },
];

/* множество цветов-тиров (цены задаёт applySessionPrices) */
const TIER_SET = new Set(TIER_COLORS.map((c) => c.toUpperCase()));

const norm = (c) => (c || '').toUpperCase();

export function buildSeats(svgRoot) {
    if (!svgRoot) return [];

    // только rect-места с заливкой (обводочные дубли занятых мест отсеиваются)
    const rects = [...svgRoot.querySelectorAll('rect[width="8"][height="8"]')]
        .filter((r) => r.getAttribute('fill'));

    // разбить ряды (уникальные Y, от сцены) на части зала: разрыв не меньше SECTION_GAP — следующая часть
    const ys = [...new Set(rects.map((r) => +r.getAttribute('y')))].sort((a, b) => a - b);
    const sectionOfY = new Map();
    let sec = 0;
    ys.forEach((y, i) => {
        if (i > 0 && y - ys[i - 1] >= SECTION_GAP) sec++;
        sectionOfY.set(y, sec);
    });

    // номер ряда: от сцены с 1, сквозной по частям с одним счётом рядов (SECTIONS[].rows).
    // Часть сверх списка SECTIONS считает ряды сама
    const rowCount = new Map();   // счёт → сколько рядов уже пронумеровано
    const rowNumberOfY = new Map();
    ys.forEach((y) => {
        const s = sectionOfY.get(y);
        const counter = SECTIONS[s] ? SECTIONS[s].rows : `section-${s + 1}`;
        const n = (rowCount.get(counter) || 0) + 1;
        rowCount.set(counter, n);
        rowNumberOfY.set(y, n);
    });

    // сгруппировать по Y, внутри ряда пронумеровать места слева направо (по X)
    const byY = new Map();
    rects.forEach((r) => {
        const y = +r.getAttribute('y');
        (byY.get(y) || byY.set(y, []).get(y)).push(r);
    });
    byY.forEach((list) => list.sort((a, b) => +a.getAttribute('x') - +b.getAttribute('x')));

    // ось продольного прохода: середина самого широкого разрыва между соседними местами ряда
    let axis = 0;
    let widest = -Infinity;
    byY.forEach((list) => {
        for (let i = 1; i < list.length; i++) {
            const right = +list[i - 1].getAttribute('x') + SEAT;   // правый край левого соседа
            const left = +list[i].getAttribute('x');               // левый край правого соседа
            if (left - right > widest) { widest = left - right; axis = (right + left) / 2; }
        }
    });

    // полуширина секции от оси: самое дальнее от оси место
    const center = (r) => +r.getAttribute('x') + SEAT / 2;
    const halfWidth = new Map();   // индекс секции → полуширина
    byY.forEach((list, y) => {
        const s = sectionOfY.get(y);
        list.forEach((r) => halfWidth.set(s, Math.max(halfWidth.get(s) || 0, Math.abs(center(r) - axis))));
    });

    const seats = [];
    byY.forEach((list, y) => {
        const s = sectionOfY.get(y);
        const section = SECTIONS[s] ? SECTIONS[s].name : `Секция ${s + 1}`;
        const sectionKey = SECTIONS[s] ? SECTIONS[s].key : `section-${s + 1}`;
        const row = rowNumberOfY.get(y);
        const band = halfWidth.get(s) / 3;   // центр — средняя треть ширины секции вокруг оси
        list.forEach((r, i) => {
            const seatNo = i + 1;
            const id = `${sectionKey}-${row}-${seatNo}`;   // стабильный ID кресла: <секция>-<ряд>-<место>
            const d = center(r) - axis;
            const side = Math.abs(d) <= band ? 'center' : (d < 0 ? 'left' : 'right');
            const color = norm(r.getAttribute('fill'));
            const occupied = color === OCCUPIED;
            const available = !occupied && TIER_SET.has(color);
            const status = occupied ? 'occupied' : (available ? 'available' : 'unknown');

            // привязать данные к месту схемы (в DOM). Цена НЕ ставится здесь —
            // её проставляет applySessionPrices.
            r.setAttribute('data-seat-id', id);
            r.setAttribute('data-section', section);
            r.setAttribute('data-row', row);
            r.setAttribute('data-seat', seatNo);
            r.setAttribute('data-side', side);
            r.setAttribute('data-status', status);
            if (available) r.setAttribute('data-tier', color);

            seats.push({ id, el: r, section, sectionKey, side, row, seat: seatNo, price: null, tier: available ? color : null, status, selected: false });
        });
    });

    return seats;
}

/* ============================================================
   Цены мест. priceByColor: Map(ЦВЕТ→цена).
   Ставит цену доступным местам (объект-место + data-price в DOM).
   Цвета/статусы/геометрия не трогаются. */
export function applySessionPrices(seats, priceByColor) {
    seats.forEach((s) => {
        if (s.status !== 'available' || !s.tier) return;
        const price = priceByColor.get(s.tier) ?? null;
        s.price = price;
        if (price != null) s.el.setAttribute('data-price', price);
        else s.el.removeAttribute('data-price');
    });
}

/* ============================================================
   Selected-вид места (Figma-нода 4902-80205).
   Выбранное место = оранжевый #FF5005 + белый значок, ПЕРЕКРЫВАЕТ цвет тира.
   Значок — белая галочка у любого выбранного места.
   Оригинальный rect места (8×8) не трогаем — рисуем поверх отдельный слой
   <g class="sel-layer"> в конце <svg> (document order = сверху всех мест).
   Разметка галочки взята дословно из макета для 8px-варианта с
   базовой точкой (88,16); для места (x,y) сдвигаем группу на (x-88, y-16). */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEL_COLOR = '#FF5005';
const CHECK_D = 'M94.5543 18.1123C94.7008 18.2587 94.7008 18.4962 94.5543 18.6426L91.5983 21.5986C91.528 21.6689 91.4326 21.7085 91.3332 21.7085C91.2337 21.7085 91.1383 21.6689 91.068 21.5986L89.4013 19.932C89.2549 19.7855 89.2549 19.5481 89.4013 19.4016C89.5478 19.2552 89.7852 19.2552 89.9317 19.4016L91.3332 20.8031L94.024 18.1123C94.1704 17.9658 94.4079 17.9658 94.5543 18.1123Z';

const CHECK = `<path fill-rule="evenodd" clip-rule="evenodd" d="${CHECK_D}" fill="white"/>`;

/* Маркер места активного билета крупнее остальных во столько раз (как в прототипе схемы зала). */
export const ACTIVE_SCALE = 1.4;

/* Маркер выбранного места с галочкой. scale — множитель размера вокруг ЦЕНТРА места
   (x+4, y+4): translate(cx,cy) scale(k) translate(-92,-20) при k=1 даёт translate(x-88,y-16). */
function selectedGroup(x, y, scale = 1) {
    const inner =
        `<rect x="88" y="16" width="8" height="8" rx="2.5" fill="${SEL_COLOR}"/>`
        + `<rect x="88" y="16" width="8" height="8" rx="2.5" stroke="${SEL_COLOR}" stroke-width="3"/>`
        + CHECK;
    const t = scale === 1
        ? `translate(${x - 88} ${y - 16})`
        : `translate(${x + 4} ${y + 4}) scale(${scale}) translate(-92 -20)`;
    return `<g transform="${t}">${inner}</g>`;
}

/* ============================================================
   Слой фильтра цены: временно УВЕЛИЧЕННЫЕ копии доступных мест выбранных
   тиров. Рисуется отдельным <g> ПОД слоем выбора (создаётся раньше в
   document order), чтобы оранжевый маркер выбранного места оставался сверху.

   render(items) — items: [{ s, sc }], где sc — множитель размера места вокруг
   ЕГО центра (x+4, y+4): центр на месте, растёт только размер. Заливка берётся
   из текущего fill места (цвет тира). sc и список задаёт вызывающий (main.js): sc считается обратно
   пропорционально текущему зуму, чтобы экранный размер увеличенного места был
   постоянным при любом масштабе схемы. */
export function createFilterLayer(svgRoot) {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'filter-layer');
    layer.setAttribute('pointer-events', 'none');
    svgRoot.appendChild(layer);
    return function render(items) {
        const parts = items.map(({ s, sc }) => {
            const x = +s.el.getAttribute('x');
            const y = +s.el.getAttribute('y');
            const cx = x + 4, cy = y + 4;
            const fill = s.el.getAttribute('fill');
            const t = `translate(${cx} ${cy}) scale(${sc}) translate(${-cx} ${-cy})`;
            return `<g transform="${t}"><rect x="${x}" y="${y}" width="8" height="8" rx="3" fill="${fill}"/></g>`;
        });
        layer.innerHTML = parts.join('');
    };
}

/* Создать слой выбора и вернуть функцию его перерисовки под список мест.
   activeSeat — место активного билета: рисуется последним (поверх всех) и крупнее (ACTIVE_SCALE). */
export function createSelectionLayer(svgRoot) {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'sel-layer');
    svgRoot.appendChild(layer);
    return function render(seats, activeSeat) {
        const parts = seats
            .filter((s) => s.selected && s !== activeSeat)
            .map((s) => selectedGroup(+s.el.getAttribute('x'), +s.el.getAttribute('y')));
        if (activeSeat && activeSeat.selected) {
            parts.push(selectedGroup(+activeSeat.el.getAttribute('x'), +activeSeat.el.getAttribute('y'), ACTIVE_SCALE));
        }
        layer.innerHTML = parts.join('');
    };
}
