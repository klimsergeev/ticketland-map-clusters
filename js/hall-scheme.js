/* ============================================================
   Hall scheme for index.html (both layouts): loading assets/hall.svg with its layers, hit-testing a tap
   and the decision on a seat tap. Focusing the scheme on a seat is in app-core.js (focus scale per layout).
   ============================================================ */
import { TIER_COLORS, TIER_PRICES, MAX_ORDER_ITEMS, GIFT } from './data.js';
import { buildSeats, createSelectionLayer, applySessionPrices, createFilterLayer, createHighlightLayer } from './seats.js';

/* Mobile focus scale: a picked seat into the centre of the visible band at this zoom or more
   (мягкий: место видно + видны соседи, без гипер-зума); desktop uses its own, weaker one (app-core.js) */
export const FOCUS_SCALE = 1.8;

/* --- Инлайн-SVG схемы (вектор в DOM, чёткий на зуме) ---
   Load assets/hall.svg into hostEl, mark seats, create layers and set prices.
   Resolves to { svgEl, seats, seatlessEls, renderFilterLayer, renderSelection, sectionHighlight };
   the caller handles load errors */
export function loadHall(hostEl) {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => {
            hostEl.innerHTML = svg;
            const svgEl = hostEl.querySelector('svg');
            const seatlessEls = [...svgEl.querySelectorAll('.seatless')];   // танцпол: бледнение по фильтру и тап мимо
            // привязать к местам схемы данные (ряд/место/статус) + разметить DOM
            const seats = buildSeats(svgEl);
            // слой увеличения по фильтру цены (ПОД слоем выбора — создаётся раньше)
            const renderFilterLayer = createFilterLayer(svgEl);
            // слой selected-отметок поверх мест (оранжевый + галочка)
            const renderSelection = createSelectionLayer(svgEl);
            // контуры секции после «Показать на схеме» — над всеми слоями
            const sectionHighlight = createHighlightLayer(svgEl);
            // цены мест: цвет тира → цена
            applySessionPrices(seats, new Map(TIER_COLORS.map((c, i) => [c.toUpperCase(), TIER_PRICES[i]])));
            return { svgEl, seats, seatlessEls, renderFilterLayer, renderSelection, sectionHighlight };
        });
}

/* Тап по схеме → hit-test ближайшего места → выбрать/снять.
   Занятые и неизвестные (occupied/unknown) места некликабельны. */
export function findNearestSeat(seats, sx, sy, maxR) {
    let best = null;
    let bestD = maxR;
    for (const s of seats) {
        const cx = +s.el.getAttribute('x') + 4;
        const cy = +s.el.getAttribute('y') + 4;
        const d = Math.hypot(cx - sx, cy - sy);
        if (d < bestD) { bestD = d; best = s; }
    }
    return best;
}
/* Точка схемы (SVG-юниты) внутри прямоугольника танцпола (<g class="seatless"> в hall.svg) */
export function onSeatless(seatlessEls, sx, sy) {
    return seatlessEls.some((g) => {
        const r = g.querySelector('rect');
        if (!r) return false;
        const x = +r.getAttribute('x'), y = +r.getAttribute('y');
        return sx >= x && sx <= x + +r.getAttribute('width') && sy >= y && sy <= y + +r.getAttribute('height');
    });
}

// Hit-test a pointer tap on the scheme: dancefloor first, then the nearest available seat, else a miss
export function hitTest(hall, seats, seatlessEls, clientX, clientY) {
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return null;
    if (onSeatless(seatlessEls, p.x, p.y)) return { kind: 'seatless', x: p.x, y: p.y };
    const seat = findNearestSeat(seats, p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    if (seat && seat.status === 'available') return { kind: 'seat', seat, x: p.x, y: p.y };
    // Промах (пустая область ИЛИ серое/недоступное место)
    return { kind: 'miss', x: p.x, y: p.y };
}

// What a tap on an available seat does: 'remove' | 'gift' | 'add' | 'none' (order is full);
// itemCount — order entries, tickets and gifts together
export function seatTapAction(seat, itemCount) {
    if (seat.selected) return 'remove';   // повторный тап — снять
    if (itemCount >= MAX_ORDER_ITEMS) return 'none';
    if (seat.sectionKey === GIFT.sectionKey) return 'gift';
    return 'add';
}
