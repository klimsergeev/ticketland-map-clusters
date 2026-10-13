/* ============================================================
   Модель мест схемы зала.
   Данные (ряд/место/цена/секция/статус) НЕ хранятся отдельным списком,
   а ВЫВОДЯТСЯ из геометрии инлайн-SVG (assets/hall.svg) — единственного
   источника расположения мест. Так модель не может «разъехаться» со схемой.

   Каждое место схемы — <rect width=8 height=8>. Цвет fill кодирует тир:
     • тир-цвет из TIERS  → доступное место, цена = цене тира;
     • #BBC1C7            → занятое/недоступное место (без цены).
   (У занятого места в SVG два rect: заливка + белая обводка — обводочный
    rect без атрибута fill, поэтому фильтр по fill его отсеивает, дублей нет.)

   buildSeats() размечает rect'ы data-атрибутами (data-section/row/seat/
   price/tier/status) — данные «привязаны к местам» прямо в DOM — и
   возвращает массив объектов-мест.
   ============================================================ */
import { TIER_COLORS } from './data.js';

const OCCUPIED = '#BBC1C7';
const SECTION_GAP = 40;   // разрыв по Y больше этого = граница секций
const SECTIONS = ['Партер', 'Балкон'];

/* множество цветов-тиров (цвета фиксированы, цены задаёт активный сеанс) */
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
        const row = rowNumberOfY.get(y);
        list.forEach((r, i) => {
            const seatNo = i + 1;
            const rawFill = r.getAttribute('fill');   // исходная заливка (для восстановления)
            const color = norm(rawFill);
            const occupied = color === OCCUPIED;
            const available = !occupied && TIER_SET.has(color);
            const status = occupied ? 'occupied' : (available ? 'available' : 'unknown');

            // привязать данные к месту схемы (в DOM). Цена НЕ ставится здесь —
            // её задаёт активный сеанс (applySessionPrices), т.к. зал переоценивается.
            r.setAttribute('data-section', section);
            r.setAttribute('data-row', row);
            r.setAttribute('data-seat', seatNo);
            r.setAttribute('data-status', status);
            if (available) r.setAttribute('data-tier', color);

            const seat = { el: r, section, row, seat: seatNo, price: null, tier: available ? color : null, status, selected: false };
            // снимок исходного вида места — для восстановления после пер-сеансового
            // оверрайда занятости (см. applyOccupancyOverride / restoreOriginals).
            // rx нужен, т.к. occupySeat меняет скругление (3 → 3.5) под вид занятого.
            seat._orig = { fill: rawFill, status, tier: seat.tier, rx: r.getAttribute('rx') };
            seats.push(seat);
        });
    });

    return seats;
}

/* ============================================================
   Переоценка зала под активный сеанс. priceByColor: Map(ЦВЕТ→цена).
   Обновляет цену доступных мест (объект-место + data-price в DOM).
   Цвета/статусы/геометрия не трогаются — меняются только цены. */
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
   Пер-сеансовый оверрайд занятости («почти распродан»).
   Доступность в SVG общая для всех сеансов; для отдельного сеанса можно
   ДОПОЛНИТЕЛЬНО пометить часть доступных мест занятыми, оставив в каждом
   ЦЕНОВОМ тире лишь несколько свободных. Восстановление — restoreOriginals
   (возврат к исходному fill/статусу/тиру из снимка _orig в buildSeats).

   Выбор оставляемых мест — ДЕТЕРМИНИРОВАННЫЙ (без Math.random): в каждом ЦЕНОВОМ
   тире оставляем И кластер из 2-3 ПОДРЯД идущих мест одного ряда (соседние по
   номеру seat), И 2-3 одиночных места вразброс по ДРУГИМ рядам — итого ~4-6
   свободных на тир. Так демо показывает оба случая: «остались одиночки» и «можно
   взять 2-3 рядом». Итог по залу ~24..36 свободных мест. */

/* Вид занятого места воспроизводится ДВУМЯ элементами (как в assets/hall.svg):
   серая заливка (rx=3.5) + поверх белый stroke-rect (rx=3.5, stroke-width=3, БЕЗ
   fill). Обводка «съедает» края 8×8 → видимый серый кружок ~5px, поэтому занятые
   визуально мельче доступных. occupySeat приводит доступное место к этому виду. */
function occupySeat(s) {
    s.status = 'occupied';
    s.tier = null;
    s.price = null;
    s.selected = false;
    const x = s.el.getAttribute('x');
    const y = s.el.getAttribute('y');
    s.el.setAttribute('fill', OCCUPIED);
    s.el.setAttribute('rx', '3.5');            // скругление как у настоящего занятого
    s.el.setAttribute('data-status', 'occupied');
    s.el.removeAttribute('data-tier');
    s.el.removeAttribute('data-price');
    // парный белый stroke-rect поверх заливки (fill не задаём — наследует fill=none
    // у корневого <svg>, как у настоящих занятых). Вставляем сразу после заливки
    // этого места, в том же родителе → рисуется над ней, но под filter-/sel-layer.
    if (!s._occStroke) {
        const st = document.createElementNS(SVG_NS, 'rect');
        st.setAttribute('x', x);
        st.setAttribute('y', y);
        st.setAttribute('width', '8');
        st.setAttribute('height', '8');
        st.setAttribute('rx', '3.5');
        st.setAttribute('stroke', 'white');
        st.setAttribute('stroke-width', '3');
        s.el.after(st);
        s._occStroke = st;
    }
}

/* Самый длинный run подряд идущих по seat мест внутри ряда (места уже
   отсортированы по seat). Возвращает массив длиной ≥2 или null. */
function longestRun(rowSeats) {
    let best = null, run = [rowSeats[0]];
    for (let i = 1; i < rowSeats.length; i++) {
        if (rowSeats[i].seat === rowSeats[i - 1].seat + 1) run.push(rowSeats[i]);
        else { if (run.length >= 2 && (!best || run.length > best.length)) best = run; run = [rowSeats[i]]; }
    }
    if (run.length >= 2 && (!best || run.length > best.length)) best = run;
    return best;
}

export function applyOccupancyOverride(seats) {
    // сгруппировать доступные места по тиру
    const byTier = new Map();
    seats.forEach((s) => {
        if (s.status !== 'available' || !s.tier) return;
        (byTier.get(s.tier) || byTier.set(s.tier, []).get(s.tier)).push(s);
    });
    TIER_COLORS.forEach((rawColor, ti) => {
        const list = byTier.get(rawColor.toUpperCase());
        if (!list || !list.length) return;
        list.sort((a, b) => (a.row - b.row) || (a.seat - b.seat));

        // размеры детерминированно по индексу тира (сумма 4..6): варьируем демо.
        const clusterLen = (ti % 2) ? 2 : 3;      // 3,2,3,2,3,2
        const singlesCount = (ti < 3) ? 3 : 2;    // 3,3,3,2,2,2

        // сгруппировать по ряду (внутри ряда места уже по seat — list отсортирован)
        const rows = new Map();
        list.forEach((s) => (rows.get(s.row) || rows.set(s.row, []).get(s.row)).push(s));
        const rowNums = [...rows.keys()].sort((a, b) => a - b);

        const keep = new Set();

        // --- кластер: 2-3 ПОДРЯД идущих места в одном ряду ---
        // ищем в порядке возрастания ряда самый длинный run; останавливаемся,
        // как только нашли run нужной длины (детерминированно — первый подходящий).
        let bestRun = null, clusterRow = null;
        for (const rn of rowNums) {
            const run = longestRun(rows.get(rn));
            if (run && (!bestRun || run.length > bestRun.length)) { bestRun = run; clusterRow = rn; }
            if (bestRun && bestRun.length >= clusterLen) break;
        }
        if (bestRun) {
            bestRun.slice(0, clusterLen).forEach((s) => keep.add(s));
            clusterRow = bestRun[0].row;
        } else {
            // ФОЛБЭК: в тире нигде нет двух подряд идущих мест. Берём ряд с
            // наибольшим числом мест и оставляем clusterLen максимально близких
            // по номеру (первые по возрастанию seat) — «настолько рядом, насколько есть».
            let br = rowNums[0], bcount = -1;
            for (const rn of rowNums) { const c = rows.get(rn).length; if (c > bcount) { bcount = c; br = rn; } }
            clusterRow = br;
            rows.get(br).slice(0, clusterLen).forEach((s) => keep.add(s));
        }

        // --- одиночки: singlesCount мест вразброс по ДРУГИМ рядам (не кластерному) ---
        // пул = все места других рядов (по ряду→месту); берём singlesCount мест,
        // РАВНОМЕРНО распределённых по индексу пула. Много рядов → одиночки садятся в
        // разные ряды; мало рядов (в дешёвых тирах всего 2 ряда) → несколько разнесённых
        // по номеру мест одного ряда (расстояние ≫1 → читаются вразброс, не как кластер).
        const otherRows = rowNums.filter((rn) => rn !== clusterRow);
        const pool = [];
        otherRows.forEach((rn) => rows.get(rn).forEach((s) => pool.push(s)));
        const want = Math.min(singlesCount, pool.length);
        for (let j = 0; j < want; j++) {
            const idx = Math.min(pool.length - 1, Math.floor((j + 0.5) * pool.length / want));
            keep.add(pool[idx]);
        }

        // занять все места тира, кроме оставленных
        list.forEach((s) => { if (!keep.has(s)) occupySeat(s); });
    });
}

/* Вернуть все места к исходному виду (снимок _orig). Цена не ставится —
   её заново проставит applySessionPrices под активный сеанс. */
export function restoreOriginals(seats) {
    seats.forEach((s) => {
        const o = s._orig;
        if (!o) return;
        s.status = o.status;
        s.tier = o.tier;
        s.price = null;
        s.el.setAttribute('fill', o.fill);
        if (o.rx != null) s.el.setAttribute('rx', o.rx);   // вернуть скругление доступного (3)
        else s.el.removeAttribute('rx');
        s.el.setAttribute('data-status', o.status);
        if (o.tier) s.el.setAttribute('data-tier', o.tier);
        else s.el.removeAttribute('data-tier');
        s.el.removeAttribute('data-price');
        // снять парный белый stroke-rect, добавленный occupySeat при оверрайде
        if (s._occStroke) { s._occStroke.remove(); s._occStroke = null; }
    });
}

/* ============================================================
   Selected-вид места (Figma-нода 4902-80205 / layout/hall-place.svg).
   Выбранное место = оранжевый #FF5005 + белая галочка, ПЕРЕКРЫВАЕТ цвет тира.
   Оригинальный rect места (8×8) не трогаем — рисуем поверх отдельный слой
   <g class="sel-layer"> в конце <svg> (document order = сверху всех мест).
   Разметка галочки взята дословно из hall-place.svg для 8px-варианта с
   базовой точкой (88,16); для места (x,y) сдвигаем группу на (x-88, y-16). */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SEL_COLOR = '#FF5005';
const CHECK_D = 'M94.5543 18.1123C94.7008 18.2587 94.7008 18.4962 94.5543 18.6426L91.5983 21.5986C91.528 21.6689 91.4326 21.7085 91.3332 21.7085C91.2337 21.7085 91.1383 21.6689 91.068 21.5986L89.4013 19.932C89.2549 19.7855 89.2549 19.5481 89.4013 19.4016C89.5478 19.2552 89.7852 19.2552 89.9317 19.4016L91.3332 20.8031L94.024 18.1123C94.1704 17.9658 94.4079 17.9658 94.5543 18.1123Z';

/* Масштаб маркера АКТИВНОГО места относительно обычного выбранного.
   1.4× — заметная разница (визуально ~11px → ~15.5px с учётом обводки),
   середина рекомендованного диапазона 1.3–1.5×: явно выделяется, но не
   перекрывает соседние места и не выглядит чрезмерно. */
const ACTIVE_SCALE = 1.4;

/* Маркер выбранного места. scale — множитель размера вокруг ЦЕНТРА места
   (x+4, y+4): центр остаётся на месте при любом масштабе, растёт только размер.
   Композиция трансформа: translate(cx,cy) scale(k) translate(-92,-20) — при k=1
   даёт исходный translate(x-88,y-16); центр контента (92,20) всегда → (cx,cy). */
function selectedGroup(x, y, scale = 1) {
    const inner =
        `<rect x="88" y="16" width="8" height="8" rx="2.5" fill="${SEL_COLOR}"/>`
        + `<rect x="88" y="16" width="8" height="8" rx="2.5" stroke="${SEL_COLOR}" stroke-width="3"/>`
        + `<path fill-rule="evenodd" clip-rule="evenodd" d="${CHECK_D}" fill="white"/>`;
    const t = scale === 1
        ? `translate(${x - 88} ${y - 16})`
        : `translate(${x + 4} ${y + 4}) scale(${scale}) translate(-92 -20)`;
    return `<g transform="${t}">${inner}</g>`;
}

/* Создать слой выбора и вернуть функцию его перерисовки под список мест.
   activeSeat — объект-место активного билета: рисуется ПОСЛЕДНИМ (поверх всех)
   и КРУПНЕЕ (ACTIVE_SCALE). В любой момент увеличено ровно одно место. */
export function createSelectionLayer(svgRoot) {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'sel-layer');
    svgRoot.appendChild(layer);
    return function render(seats, activeSeat) {
        const selected = seats.filter((s) => s.selected);
        const parts = selected
            .filter((s) => s !== activeSeat)
            .map((s) => selectedGroup(+s.el.getAttribute('x'), +s.el.getAttribute('y')));
        // активное место — крупнее и поверх остальных (последним в document order)
        if (activeSeat && activeSeat.selected) {
            parts.push(selectedGroup(
                +activeSeat.el.getAttribute('x'),
                +activeSeat.el.getAttribute('y'),
                ACTIVE_SCALE,
            ));
        }
        layer.innerHTML = parts.join('');
    };
}

/* ============================================================
   Слой фильтра цены: временно УВЕЛИЧЕННЫЕ копии доступных мест выбранных
   тиров. Рисуется отдельным <g> ПОД слоем выбора (создаётся раньше в
   document order), чтобы оранжевый маркер выбранного места оставался сверху.

   render(items) — items: [{ s, sc }], где sc — множитель размера места вокруг
   ЕГО центра (x+4, y+4): центр на месте, растёт только размер. Заливка берётся
   из текущего fill места (цвет тира). sc и список задаёт вызывающий (main.js):
   sc считается обратно пропорционально текущему зуму, чтобы экранный размер
   увеличенного места был постоянным при любом масштабе схемы. */
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
            return `<rect x="${x}" y="${y}" width="8" height="8" rx="3" fill="${fill}" transform="${t}"/>`;
        });
        layer.innerHTML = parts.join('');
    };
}
