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

   buildSeats() размечает rect'ы data-атрибутами (data-section/row/seat/
   price/tier/status) — данные «привязаны к местам» прямо в DOM — и
   возвращает массив объектов-мест.
   ============================================================ */
import { TIER_COLORS } from './data.js';

const OCCUPIED = '#D8E0E8';
const SECTION_GAP = 40;   // разрыв по Y больше этого = граница секций
const SECTIONS = ['Партер', 'Балкон'];
const SECTION_KEYS = ['parter', 'balcony'];   // секция латиницей для seatId, порядок как в SECTIONS

/* множество цветов-тиров (цены задаёт applySessionPrices) */
const TIER_SET = new Set(TIER_COLORS.map((c) => c.toUpperCase()));

const norm = (c) => (c || '').toUpperCase();

export function buildSeats(svgRoot) {
    if (!svgRoot) return [];

    // только rect-места с заливкой (обводочные дубли занятых мест отсеиваются)
    const rects = [...svgRoot.querySelectorAll('rect[width="8"][height="8"]')]
        .filter((r) => r.getAttribute('fill'));

    // разбить ряды (уникальные Y) на секции по крупному вертикальному разрыву
    const ys = [...new Set(rects.map((r) => +r.getAttribute('y')))].sort((a, b) => a - b);
    const sectionOfY = new Map();
    let sec = 0;
    ys.forEach((y, i) => {
        if (i > 0 && y - ys[i - 1] >= SECTION_GAP) sec++;
        sectionOfY.set(y, sec);
    });

    // номер ряда внутри секции: меньший Y (ближе к сцене) = ряд 1
    const rowsBySection = {};                       // sec → отсортированные Y
    ys.forEach((y) => {
        const s = sectionOfY.get(y);
        (rowsBySection[s] ||= []).push(y);
    });
    const rowNumberOfY = new Map();
    Object.values(rowsBySection).forEach((list) => {
        list.sort((a, b) => a - b).forEach((y, i) => rowNumberOfY.set(y, i + 1));
    });

    // сгруппировать по Y, внутри ряда пронумеровать места слева направо (по X)
    const byY = new Map();
    rects.forEach((r) => {
        const y = +r.getAttribute('y');
        (byY.get(y) || byY.set(y, []).get(y)).push(r);
    });

    const seats = [];
    byY.forEach((list, y) => {
        list.sort((a, b) => +a.getAttribute('x') - +b.getAttribute('x'));
        const section = SECTIONS[sectionOfY.get(y)] || `Секция ${sectionOfY.get(y) + 1}`;
        const sectionKey = SECTION_KEYS[sectionOfY.get(y)] || `section-${sectionOfY.get(y) + 1}`;
        const row = rowNumberOfY.get(y);
        list.forEach((r, i) => {
            const seatNo = i + 1;
            const id = `${sectionKey}-${row}-${seatNo}`;   // стабильный ID кресла: <секция>-<ряд>-<место>
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
            r.setAttribute('data-status', status);
            if (available) r.setAttribute('data-tier', color);

            seats.push({ id, el: r, section, row, seat: seatNo, price: null, tier: available ? color : null, status, selected: false });
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
   Значок — белая галочка у любого выбранного места, в том числе у кресла с фото.
   Оригинальный rect места (8×8) не трогаем — рисуем поверх отдельный слой
   <g class="sel-layer"> в конце <svg> (document order = сверху всех мест).
   Разметка галочки взята дословно из макета для 8px-варианта с
   базовой точкой (88,16); для места (x,y) сдвигаем группу на (x-88, y-16). */
const SVG_NS = 'http://www.w3.org/2000/svg';
export const SEL_COLOR = '#FF5005';
const CHECK_D = 'M94.5543 18.1123C94.7008 18.2587 94.7008 18.4962 94.5543 18.6426L91.5983 21.5986C91.528 21.6689 91.4326 21.7085 91.3332 21.7085C91.2337 21.7085 91.1383 21.6689 91.068 21.5986L89.4013 19.932C89.2549 19.7855 89.2549 19.5481 89.4013 19.4016C89.5478 19.2552 89.7852 19.2552 89.9317 19.4016L91.3332 20.8031L94.024 18.1123C94.1704 17.9658 94.4079 17.9658 94.5543 18.1123Z';

/* Половина маркера выбранного места в единицах схемы: кресло 8 + обводка 3 (по 1,5 с каждой стороны). */
export const SEL_HALF = 5.5;

/* Радиус угла маркера выбранного места снаружи обводки, в единицах схемы: rx 2,5 + половина обводки 1,5.
   Нужен js/photo-map.js: контур подсветки кресла в заказе строится вокруг маркера. */
export const SEL_RADIUS = 4;

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

   render(items) — items: [{ s, sc, dot }], где sc — множитель размера места вокруг
   ЕГО центра (x+4, y+4): центр на месте, растёт только размер. Заливка берётся
   из текущего fill места (цвет тира). dot — кружок фото кресла { r, fill } в единицах
   схемы или null: рисуется в той же группе и растёт вместе с копией, как кружок на кресле
   при зуме. sc и список задаёт вызывающий (main.js): sc считается обратно
   пропорционально текущему зуму, чтобы экранный размер увеличенного места был
   постоянным при любом масштабе схемы. */
export function createFilterLayer(svgRoot) {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'filter-layer');
    layer.setAttribute('pointer-events', 'none');
    svgRoot.appendChild(layer);
    return function render(items) {
        const parts = items.map(({ s, sc, dot }) => {
            const x = +s.el.getAttribute('x');
            const y = +s.el.getAttribute('y');
            const cx = x + 4, cy = y + 4;
            const fill = s.el.getAttribute('fill');
            const t = `translate(${cx} ${cy}) scale(${sc}) translate(${-cx} ${-cy})`;
            const circle = dot ? `<circle cx="${cx}" cy="${cy}" r="${dot.r}" fill="${dot.fill}"/>` : '';
            return `<g transform="${t}"><rect x="${x}" y="${y}" width="8" height="8" rx="3" fill="${fill}"/>${circle}</g>`;
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
