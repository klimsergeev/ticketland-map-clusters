/* ============================================================
   Точка входа: собирает экран, связывает схему ↔ корзину ↔ карусель билетов.
   ============================================================ */
import { EVENT, TIER_COLORS, TIER_PRICES, MAX_SEATS, formatPrice } from './data.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer, applySessionPrices, createFilterLayer } from './seats.js';
import { createPhotoMap } from './photo-map.js';
import { createLightbox } from './photo-ui.js';

/* --- Иконки (инлайн SVG) --- */
const icoChevronLeft =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 L5 8 L10 13"/></svg>';
const icoChevronRight =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5 L15 12 L9 19"/></svg>';
const icoCross =
    '<svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

const $ = (sel, root = document) => root.querySelector(sel);

/* --- DOM-ссылки --- */
const header = $('.header');
const legendEl = $('.legend');
const sliderEl = $('.slider');
const trackEl = $('.slider-track', sliderEl);
const ctaEl = $('.cta');
const floatingEl = $('.floating');

/* --- Фото и подсветка кресла. Объявлено до new HallViewport:
       fitHall() сразу вызывает onView, и обращение к photoMap ниже по файлу упало бы. --- */
let photoMap = null;       // фото секций и подсветка кресла, появляются после загрузки схемы
let showSeq = 0;           // номер текущего ухода из лайтбокса на схему; действие человека его сбивает
let showLeaving = false;   // лайтбокс гаснет после «Показать на схеме» или «Добавить в корзину»: касания схемы игнорируются
let pendingAdd = null;     // место из «Добавить в корзину», которое ещё не легло в заказ
// Лайтбокс пока без входа: превью фото переедет на карточки билетов следующим этапом
const lightbox = createLightbox({ parentEl: $('.app'), onShow: showOnMap, onAdd: addFromPhoto, onRemove: removeFromPhoto, statusOf: seatStatus, addState: addButtonState });

/* --- Шапка: статичная (название, площадка, «Назад») --- */
$('.ttl').textContent = EVENT.title;
$('.sub').textContent = EVENT.venue;
$('.icon-btn').innerHTML = icoChevronLeft;

/* --- Рендер легенды (цвет→цена). Пилюли = ФИЛЬТР цены:
       клик по пилюле увеличивает доступные места её тира (см. toggleTierFilter).
       Активная пилюля — цветная обводка в цвет тира (класс .active, --ring). --- */
function renderLegend() {
    legendEl.innerHTML = '';
    TIER_COLORS.forEach((c, i) => {
        const color = c.toUpperCase();
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill';
        pill.dataset.tier = color;
        pill.style.setProperty('--ring', c);
        pill.innerHTML = `<span class="sw" style="background:${c}"></span>${formatPrice(TIER_PRICES[i])}`;
        pill.addEventListener('click', () => toggleTierFilter(color));
        legendEl.appendChild(pill);
    });
    updateLegendActive();
}

/* --- Корзина: выбранные места. Наполняется кликами по схеме, стартует ПУСТОЙ.
       Каждый элемент — объект-место из модели seats.js (ссылка), у него есть
       .seat/.row/.price/.selected. Максимум MAX_SEATS мест. --- */
const cart = [];

/* --- Галерея билетов: КАРУСЕЛЬ (перенесена из прототипа схемы зала). Карточки едут
       по горизонтали. Якорь активной карточки зависит от её позиции в списке:
       первая → ЛЕВЫЙ край (peek справа), последняя → ПРАВЫЙ край (peek слева),
       середина → ЦЕНТР (peek с обеих сторон). Drag тянет трек за пальцем 1:1, по
       отпусканию — пружинный снап (учёт скорости флика). Активная = последний
       выбранный на схеме билет; ручной свайп это переопределяет.
       Ширина карточек переменная (hug): неактивная узкая, активная шире, поэтому
       геометрию считаем по фактическим offsetWidth (см. measureCards). --- */
const TICKET_GAP = 8;             // зазор между билетами (Figma: gap в карусели)

let activeTicket = 0;
const ticketEls = [];
let cardW = [];                   // фактическая ширина каждой карточки (offsetWidth)
let cardStart = [];               // X левого края карточки i внутри трека (кумулятивно)
let trackX = 0;                   // текущий сдвиг трека по X
let stopSpring = null;            // отмена активной пружины
let cardDX = [];                  // покадровый сдвиг каждой карточки по X (FLIP-реколл при удалении)
let reflowSpring = null;          // отмена пружины реколла соседей
let deleting = false;             // идёт анимация удаления — блок повторного удаления/драга

/* Проставить класс active по текущему activeTicket. Вызывать ПЕРЕД measureCards:
   активная карточка шире, measureCards должен прочитать уже финальные offsetWidth. */
function applyActiveClass() {
    ticketEls.forEach((el, i) => el.classList.toggle('active', i === activeTicket));
}

/* Замер фактических ширин карточек и X их левых краёв в треке (как flex с gap). */
function measureCards() {
    cardW = ticketEls.map((el) => el.offsetWidth);
    cardStart = new Array(cardW.length);
    let x = 0;
    for (let i = 0; i < cardW.length; i++) {
        cardStart[i] = x;
        x += cardW[i] + TICKET_GAP;
    }
}

/* X левого края карточки i во вьюпорте галереи в её «домашней» позиции:
   первая — левый край, последняя — правый, середина — центр. */
function anchorOffset(i) {
    const n = ticketEls.length;
    if (i <= 0) return 0;
    const W = sliderEl.clientWidth;
    const w = cardW[i] || 0;
    if (i >= n - 1) return W - w;
    return (W - w) / 2;
}

/* Суммарная ширина контента карусели = правый край последней карточки в треке. */
function contentWidth() {
    const n = cardW.length;
    if (n === 0) return 0;
    return (cardStart[n - 1] || 0) + (cardW[n - 1] || 0);
}

/* Переполнение = контент шире галереи хотя бы на 1px. */
function isOverflow() {
    return contentWidth() > sliderEl.clientWidth;
}

/* Позиция трека, при которой карточка i стоит в своём якоре. Без переполнения —
   всегда 0: группа прижата влево, смена активного ленту не двигает. */
function targetXFor(i) {
    if (!isOverflow()) return 0;
    return anchorOffset(i) - (cardStart[i] || 0);
}

function setTrackX(px) {
    trackX = px;
    trackEl.style.transform = `translateX(${px}px)`;
    paintDepth();
}

/* Глубина + active-состояние. Z «веером» от активного: z строго убывает с расстоянием
   |i − activeTicket|; активный (100) выше кнопки CTA → его тень ложится поверх соседей и кнопки.
   Scale не используем: видимый зазор должен быть ровно TICKET_GAP. */
function paintDepth() {
    ticketEls.forEach((el, i) => {
        el.style.transform = `translateX(${cardDX[i] || 0}px)`;
        el.style.zIndex = String(100 - Math.abs(i - activeTicket));
        el.classList.toggle('active', i === activeTicket);
    });
}

/* Снап пружиной: карточку i — в её якорь (velocity — инерция флика) */
function snapTo(i, velocity = 0) {
    activeTicket = clamp(i, 0, ticketEls.length - 1);
    applyActiveClass();
    measureCards();
    if (stopSpring) { stopSpring(); stopSpring = null; }
    stopSpring = spring({
        from: trackX, to: targetXFor(activeTicket), velocity,
        onUpdate: (x) => setTrackX(x),
        onDone: () => { stopSpring = null; },
    });
}

/* ЕДИНАЯ ТОЧКА «смена активного билета → маркер ×1,4 + схема на его место».
   Зум только при фактической смене индекса: снап обратно на тот же билет схему не двигает.
   Тап по уже активному идёт мимо (прямой focusSeat в onTicketUp), добавление места — тоже
   (addSeat зовёт focusSeat сам). */
function activateTicket(i, velocity = 0) {
    const prev = activeTicket;
    snapTo(i, velocity);
    if (activeTicket !== prev) {
        renderSelectionActive();
        focusTicket(activeTicket);
    }
}

/* Схема на место билета i (если есть) */
function focusTicket(i) {
    const seat = cart[i];
    if (seat) focusSeat(seat);
}

/* Рецентрирование без анимации (resize) */
function recenterTickets() {
    if (deleting) return;                         // не сбивать FLIP-реколл во время удаления
    if (!ticketEls.length) return;
    applyActiveClass();
    measureCards();
    setTrackX(targetXFor(activeTicket));
}

function renderTickets(opts = {}) {
    trackEl.innerHTML = '';
    ticketEls.length = 0;
    cardDX = new Array(cart.length).fill(0);   // FLIP-сдвиги обнуляются на каждом ререндере
    cart.forEach((tk) => {
        const card = document.createElement('div');
        card.className = 'ticket';
        card.innerHTML =
            `<span class="t-text">` +
                `<span class="t-seat">${tk.row} ряд, ${tk.seat} место</span>` +
                `<span class="t-price">${formatPrice(tk.price)}</span>` +
            `</span>` +
            `<button class="t-x" type="button" aria-label="Убрать">${icoCross}</button>`;
        card.addEventListener('pointerdown', (e) => onTicketDown(e, card));
        card.addEventListener('pointermove', onTicketMove);
        card.addEventListener('pointerup', onTicketUp);
        card.addEventListener('pointercancel', onTicketUp);
        // × виден только у активного: удаляет его; у неактивного (только программно) — активирует.
        // Глушим pointerdown, чтобы кнопка не стартовала drag карточки
        const xBtn = card.querySelector('.t-x');
        xBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        xBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const i = ticketEls.indexOf(card);   // актуальный индекс на момент клика
            if (i === activeTicket) deleteActiveTicket(i);
            else activateTicket(i);
        });
        ticketEls.push(card);
        trackEl.appendChild(card);
    });
    if (ticketEls.length === 0) { cardW = []; cardStart = []; setTrackX(0); return; }
    // клампим активную в новые границы (активной остаётся позиция в списке)
    activeTicket = clamp(activeTicket, 0, ticketEls.length - 1);
    applyActiveClass();
    measureCards();
    // instant — мгновенно в целевую позицию: при удалении поверх лейаута идёт FLIP-реколл соседей
    if (opts.instant) setTrackX(targetXFor(activeTicket));
    else snapTo(activeTicket);
}

/* --- drag галереи: тянем трек за пальцем 1:1, по отпусканию — снап/флик.
       drag по карточке → карусель; drag по пустоте → пан схемы. --- */
let tDrag = null;
const TICKET_TAP = 8;             // px: движение меньше — это tap, а не drag
/* Правая зона активного билета: крестик (padding-right 12 + иконка 24) + буфер ~8px = 44px.
   Тап в ней схему не двигает (× удаляет своим хендлером, буфер — no-op). */
const TICKET_X_ZONE = 44;

function inTicketXZone(index, clientX) {
    const el = ticketEls[index];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.right - TICKET_X_ZONE;
}

function onTicketDown(e, el) {
    if (deleting) return;
    if (e.target.closest('.t-x')) return;
    if (stopSpring) { stopSpring(); stopSpring = null; }
    const t0 = performance.now();
    tDrag = {
        startX: e.clientX, startY: e.clientY,
        startTrack: trackX, pid: e.pointerId,
        // окно последних сэмплов {t,x} для робастной оценки скорости флика
        samples: [{ t: t0, x: e.clientX }],
        index: ticketEls.indexOf(el),
    };
    try { el.setPointerCapture(e.pointerId); } catch {}
    sliderEl.classList.add('grabbing');
    e.preventDefault();
}

function onTicketMove(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const now = performance.now();
    tDrag.samples.push({ t: now, x: e.clientX });
    const cutoff = now - VX_WINDOW;
    let k = 0;
    while (k < tDrag.samples.length - 1 && tDrag.samples[k + 1].t < cutoff) k++;
    if (k > 0) tDrag.samples.splice(0, k);

    let x = tDrag.startTrack + (e.clientX - tDrag.startX);   // follow-the-finger 1:1
    // резина за краями
    const min = targetXFor(ticketEls.length - 1);
    const max = targetXFor(0);
    if (x > max) x = max + (x - max) * 0.35;
    if (x < min) x = min + (x - min) * 0.35;
    setTrackX(x);
}

/* Скорость отпускания — средняя по последним VX_WINDOW мс (последний сегмент занижает флик). */
const VX_WINDOW = 70;             // мс
function windowedVX(samples, now) {
    if (!samples || samples.length < 2) return 0;
    const cutoff = now - VX_WINDOW;
    let i = samples.length - 1;
    while (i > 0 && samples[i - 1].t >= cutoff) i--;
    const a = samples[i], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt * 1000 : 0;
}

/* «Сила жеста → число шагов»: тормозной путь флика |vx|·VX_TAU в шагах неактивной карточки.
     • INTENT_FRACTION — доля пути до соседа: прошли её → жест намеренный;
     • INTENT_VX — либо короткий, но быстрый флик тоже намеренный;
     • VX_TAU — тормозное время инерции, с. */
const INTENT_FRACTION = 0.32;
const INTENT_VX = 250;
const VX_TAU = 0.26;

/* Дискретный выбор целевого индекса: направление — по знаку жеста, дальность — по скорости. */
function chooseTicketTarget({ cur, n, deltaX, vx, stepDist, pitch }) {
    let dir = deltaX < 0 ? 1 : deltaX > 0 ? -1 : 0;
    if (dir === 0) dir = vx < 0 ? 1 : vx > 0 ? -1 : 0;
    if (dir === 0) return cur;

    const travel = Math.abs(deltaX);
    const speed = Math.abs(vx);
    const intentional = travel >= stepDist * INTENT_FRACTION || speed >= INTENT_VX;

    const P = pitch > 0 ? pitch : (stepDist > 0 ? stepDist : 1);
    let steps = Math.round(speed * VX_TAU / P);
    if (!intentional && steps < 1) return cur;        // слабый свайп → снап на текущий
    if (steps < 1) steps = 1;                         // намеренный → минимум сосед
    return clamp(cur + dir * steps, 0, n - 1);
}

function onTicketUp(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const d = tDrag;
    tDrag = null;
    sliderEl.classList.remove('grabbing');
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (moved < TICKET_TAP) {
        // tap по неактивной карточке → активировать + схема на её место
        if (d.index !== -1 && d.index !== activeTicket) { activateTicket(d.index); return; }
        // лента могла уехать за пальцем на несколько px — вернуть её в якорь
        // (в прототипе схемы зала этого не было: после «почти тапа» лента оставалась сдвинутой)
        snapTo(activeTicket);
        // tap по активной вне зоны × → схема снова на её место; корзина не меняется
        if (d.index === activeTicket && !inTicketXZone(d.index, e.clientX)) {
            const seat = cart[d.index];
            if (seat) focusSeat(seat);
        }
        return;
    }
    // свайп: целевой индекс дискретно от текущего активного
    const cur = activeTicket;
    const n = ticketEls.length;
    const deltaX = e.clientX - d.startX;
    const vxWin = windowedVX(d.samples, performance.now());
    const dirGuess = deltaX < 0 ? 1 : deltaX > 0 ? -1 : (vxWin < 0 ? 1 : -1);
    const nb = clamp(cur + dirGuess, 0, n - 1);
    const stepDist = Math.abs(targetXFor(nb) - targetXFor(cur)) || ((cardW[cur] || 0) + TICKET_GAP);
    const pitch = ((cardW[nb] || cardW[cur] || 0) + TICKET_GAP);
    const target = chooseTicketTarget({ cur, n, deltaX, vx: vxWin, stepDist, pitch });
    activateTicket(target, vxWin);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* Перерисовать слой выбранных мест: место активного билета крупнее (×1,4) и поверх остальных. */
function renderSelectionActive() {
    if (renderSelection) renderSelection(seats, cart[activeTicket]);
}

/* ============================================================
   Удаление активного билета крестиком — «fade».
     • exit-клон уходящей карточки: scale 1→.2 + opacity 1→0 на месте, 140ms,
       cubic-bezier(.4,0,1,1); рисуется поверх слайдера вне потока;
     • реколл соседей: FLIP + пружина (stiffness 940 / damping 41).
   Активным становится билет на той же позиции (у последнего — левый сосед), схема едет на его место.
   deleting-флаг блокирует повторное удаление, драг и тапы по схеме во время анимации. */
const EXIT_MS = 140;
const EXIT_EASING = 'cubic-bezier(.4,0,1,1)';

function spawnExit(leavingEl) {
    const sr = sliderEl.getBoundingClientRect();
    const lr = leavingEl.getBoundingClientRect();
    const clone = leavingEl.cloneNode(true);
    clone.classList.add('exit-clone');
    if (leavingEl.classList.contains('active')) clone.classList.add('active');
    clone.style.left = (lr.left - sr.left) + 'px';
    clone.style.top = (lr.top - sr.top) + 'px';
    clone.style.width = lr.width + 'px';
    clone.style.height = lr.height + 'px';
    clone.style.transformOrigin = 'center center';
    clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASING}, opacity ${EXIT_MS}ms ${EXIT_EASING}`;
    sliderEl.appendChild(clone);
    requestAnimationFrame(() => {
        clone.style.transform = 'scale(.2)';
        clone.style.opacity = '0';
    });
    setTimeout(() => clone.remove(), EXIT_MS + 60);
}

function deleteActiveTicket(idx) {
    if (deleting) return;
    const seat = cart[idx];
    if (!seat) return;
    deleting = true;
    if (stopSpring) { stopSpring(); stopSpring = null; }   // погасить возможный снап
    const leavingEl = ticketEls[idx];

    // FLIP: запомнить X оставшихся карточек ДО удаления (ключ — объект-место)
    const firstMap = new Map();
    ticketEls.forEach((el, i) => { if (i !== idx) firstMap.set(cart[i], el.getBoundingClientRect().left); });

    spawnExit(leavingEl);

    seat.selected = false;              // место схемы → дефолт
    cart.splice(idx, 1);
    renderCTA();

    if (cart.length === 0) {
        renderTickets();
        renderMarks();
        // exit-клон живёт внутри .floating, поэтому блок прячем ПОСЛЕ exit-анимации
        setTimeout(syncFloating, EXIT_MS + 60);
        deleting = false;
        return;
    }

    activeTicket = clamp(idx, 0, cart.length - 1);
    renderMarks();                      // увеличенным становится место нового активного
    renderTickets({ instant: true });   // мгновенный лейаут без пружины
    focusTicket(activeTicket);          // схема на место нового активного

    // FLIP invert: сдвинуть каждую карточку обратно к её прежней позиции
    const dx0 = ticketEls.map((el, i) => {
        const f = firstMap.get(cart[i]);
        const l = el.getBoundingClientRect().left;
        return f == null ? 0 : (f - l);
    });
    cardDX = dx0.slice();
    setTrackX(trackX);

    // play: пружина ведёт сдвиги к 0 — соседи плавно закрывают зазор
    if (reflowSpring) reflowSpring();
    reflowSpring = spring({
        from: 1, to: 0, stiffness: 940, damping: 41,
        onUpdate: (p) => { for (let i = 0; i < cardDX.length; i++) cardDX[i] = dx0[i] * p; setTrackX(trackX); },
        onDone: () => { cardDX = cardDX.map(() => 0); setTrackX(trackX); reflowSpring = null; deleting = false; },
    });
}

/* --- Подложка нижнего блока: видна только при непустой корзине. Пустая корзина →
   display:none, чтобы белый градиент не рисовался и высота не резервировалась. --- */
function syncFloating() {
    floatingEl.style.display = cart.length === 0 ? 'none' : '';
}

/* --- CTA: сумма = сумме цен выбранных мест. Пустая корзина → кнопки нет. --- */
function renderCTA() {
    if (cart.length === 0) {
        ctaEl.style.display = 'none';
        ctaEl.innerHTML = '';
        return;
    }
    const total = cart.reduce((acc, s) => acc + (s.price || 0), 0);
    ctaEl.style.display = '';
    ctaEl.innerHTML =
        `<span>Оформить: ${formatPrice(total)}</span>` +
        `<span class="cta-ico">${icoChevronRight}</span>`;
}

/* Перерисовать маркеры выбранных мест (активное — крупнее) и всё, что от них зависит */
function renderMarks() {
    renderSelectionActive();
    renderFilter();   // место вошло в заказ — увеличенная копия снимается, вышло — возвращается
    // подсветка кресла: контур снимается, если кресло под ним вошло в заказ или вышло из него;
    // ошибка здесь не мешает выбору мест
    if (!photoMap) return;
    try {
        photoMap.syncSelected();
    } catch (e) {
        console.error('Подсветка кресла: не обновлена после смены заказа', e);
    }
}

/* Перерисовать всё, что зависит от корзины: карусель, CTA, подложку, маркеры на схеме */
function refreshCart() {
    renderTickets();
    renderCTA();
    syncFloating();
    renderMarks();
}

/* Добавить место: отметить selected, положить в корзину, показать билет активным,
   поставить место в центр видимой полосы. Молча игнорируем 9-е место.
   focus: false — схема уже стоит на месте (добавление из лайтбокса), второго движения нет. */
function addSeat(seat, focus = true) {
    if (cart.length >= MAX_SEATS) return;
    seat.selected = true;
    cart.push(seat);
    activeTicket = cart.length - 1;     // новый билет — активная карточка
    refreshCart();
    if (focus) focusSeat(seat);
}

/* Место можно добавить из лайтбокса: свободное, ещё не в заказе, в заказе есть место */
function canAddSeat(seat) {
    return seat.status === 'available' && !seat.selected && cart.length < MAX_SEATS;
}

/* Статус места в подписи лайтбокса: в заказе — 'cart', свободное — 'free', занятое и неизвестное — 'busy' */
function seatStatus(seat) {
    if (seat.selected) return 'cart';
    return seat.status === 'available' ? 'free' : 'busy';
}

/* Главная кнопка лайтбокса: заказ полон — её нет ни у одного места, в том числе у места из заказа;
   место в заказе — «Убрать из корзины»; свободное — активная «Добавить в корзину»; занятое — неактивная */
function addButtonState(seat) {
    if (cart.length >= MAX_SEATS) return 'hidden';
    if (seat.selected) return 'remove';
    return seat.status === 'available' ? 'on' : 'off';
}

/* «Убрать из корзины» в лайтбоксе: обычное снятие билета, лайтбокс остаётся открытым */
function removeFromPhoto(node) {
    removeSeat(node.seat);
}

/* Убрать место: снять selected, выкинуть из корзины, вернуть в дефолт.
   Мгновенный путь (тап по месту на схеме). Активной остаётся позиция в списке, как в
   прототипе схемы зала. Удаление крестиком активного билета — deleteActiveTicket (с анимацией). */
function removeSeat(seat) {
    const i = cart.indexOf(seat);
    if (i === -1) return;
    seat.selected = false;
    cart.splice(i, 1);
    refreshCart();
}

/* Поставить место в центр видимой полосы между шапкой и нижним блоком и приблизить
   (центр rect'а = x+4, y+4 в SVG-юнитах). Зум не меньше текущего. */
const FOCUS_SCALE = 1.8;   // уровень приближения при выборе (мягкий: место видно + видны соседи, без гипер-зума)
function focusSeat(seat) {
    if (!hall) return;
    const x = +seat.el.getAttribute('x') + 4;
    const y = +seat.el.getAttribute('y') + 4;
    hall.focusInBand(x, y, FOCUS_SCALE);
}

/* Тап по схеме → hit-test ближайшего места → выбрать/снять.
   Занятые и неизвестные (occupied/unknown) места некликабельны. */
function findNearestSeat(sx, sy, maxR) {
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
function handleTap(clientX, clientY) {
    if (lightbox.isOpen()) { lightbox.close(); return; }   // лайтбокс перекрывает весь экран, тап до схемы не дойдёт; строка — страховка
    if (deleting) return;                                   // не трогаем корзину во время анимации удаления
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    const seat = findNearestSeat(p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    // Попадание в ДОСТУПНОЕ место → выбрать/снять + подзум
    if (seat && seat.status === 'available') {
        if (seat.selected) { removeSeat(seat); return; }   // повторный тап — снять
        addSeat(seat);
        return;
    }
    // Промах (пустая область ИЛИ серое/недоступное место): только на МИНИМАЛЬНОМ
    // масштабе подзумливаем по точке тапа, как при выборе места, но БЕЗ выбора
    // (корзина не меняется). Если уже подзумлен — ничего не делаем.
    if (hall.atMinScale()) {
        hall.focusOnSvgPoint(p.x, p.y, FOCUS_SCALE);
    }
}

/* --- Лайтбокс ↔ схема --- */
/* Уход из лайтбокса на схему: лайтбокс гаснет, после этого схема приближается к креслу,
   после остановки — onArrive. Касание схемы во время приближения сбивает showSeq — onArrive не приходит */
function leaveLightbox(node, onArrive) {
    const seq = ++showSeq;
    showLeaving = true;
    // схема не реагирует на касания, пока гаснет лайтбокс: ни тап, ни пан, ни щипок, ни колесо
    viewportEl.style.pointerEvents = 'none';
    lightbox.close(() => {
        showLeaving = false;
        viewportEl.style.pointerEvents = '';
        hall.focusInBand(node.x, node.y, FOCUS_SCALE, () => {
            if (seq !== showSeq) return;
            onArrive();
        });
    });
}

/* «Показать на схеме»: после остановки схемы кресло подсвечивается контуром */
function showOnMap(node) {
    leaveLightbox(node, () => {
        if (!photoMap) return;
        try {
            photoMap.highlightSeat(node.seatId);
        } catch (e) {
            console.error('Подсветка кресла не показана', e);
        }
    });
}

/* «Добавить в корзину»: то же приближение, что у «Показать на схеме», без подсветки.
   Место ложится в заказ после остановки схемы — второго движения схемы нет. Касание во время
   приближения добавляет место сразу (stopShowOnMap): тап по кнопке не теряется */
function addFromPhoto(node) {
    pendingAdd = node.seat;
    leaveLightbox(node, commitAdd);
}

function commitAdd() {
    const seat = pendingAdd;
    pendingAdd = null;
    if (seat && canAddSeat(seat)) addSeat(seat, false);
}

/* Действие человека: подсветка гаснет за 150 мс, подсветка, которая ещё не началась, отменяется;
   место из «Добавить в корзину», которое ещё не легло в заказ, ложится сразу.
   Пока лайтбокс гаснет — ничего: сценарий доводится до конца */
function stopShowOnMap() {
    if (showLeaving) return;
    showSeq++;
    if (pendingAdd) commitAdd();
    if (photoMap) photoMap.hideHighlight();
}

/* --- Пересчёт схемы под размеры вьюпорта ---
   Схема — cover-слой на весь вьюпорт (см. hall.js). Коробка .map-content
   заполняет вьюпорт через CSS (inset:0), JS лишь переприменяет viewBox под
   текущее состояние (после resize/смены высоты оверлеев). */
function fitHall() {
    if (hall) hall.refit();
}

/* --- Инлайн-SVG схемы (вектор в DOM, чёткий на зуме) --- */
let seats = [];            // модель мест (ряд/место/цена/секция/статус), см. js/seats.js
let hallSvgEl = null;      // корневой <svg> схемы (для класса бледнения .filtering)
let renderSelection = null; // fn(seats, activeSeat) — перерисовать слой выбранных мест
let renderFilterLayer = null; // fn(items) — перерисовать слой увеличения по фильтру цены

/* пружина (velocity-based, rAF) — карусель билетов и увеличение мест по фильтру цены.
   stiffness 840, damping 44 → ζ≈0.76: лёгкий overshoot ~2.5% (еле заметный баунс) */
function spring({ from, to, velocity = 0, stiffness = 840, damping = 44, mass = 1, onUpdate, onDone }) {
    let x = from, v = velocity, last = performance.now(), raf;
    const step = (now) => {
        let dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / sub;
        for (let i = 0; i < sub; i++) {
            const a = (-stiffness * (x - to) - damping * v) / mass;
            v += a * h;
            x += v * h;
        }
        onUpdate(x, v);
        if (Math.abs(x - to) < 0.35 && Math.abs(v) < 0.35) {
            onUpdate(to, 0);
            onDone && onDone();
            return;
        }
        raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
}

/* ============================================================
   Фильтр цены (пилюли легенды). Клик по пилюле анимированно увеличивает
   доступные места её тира; мультивыбор (несколько тиров сразу); повторный
   клик — снимает. filterTiers: color → { p, target, stop } — p ∈ [0..1] прогресс
   пружины, target — целевое (1 подсветить / 0 убрать), stop — отмена пружины.

   КЛЮЧЕВОЕ: экранный размер увеличенного места ФИКСИРОВАН при любом зуме.
   Место — 8 SVG-юнитов; его экранный размер = 8 * pxPerUnit (pxPerUnit=cover*scale
   растёт с зумом). Чтобы экранный размер стал целевым TARGET_PX, множитель места
   sc = TARGET_PX / (8 * pxPerUnit) — обратно пропорционален текущему зуму. При
   сильном приближении места и так крупнее TARGET_PX → sc клампится к 1 (не
   уменьшаем). Итоговый размер с анимацией: 1 + (sc − 1) * p.

   Места в заказе не увеличиваются: их показывает маркер выбора, а копия в цвет тира
   торчала бы из-под маркера цветным кольцом.
   Смена активного билета ставит схему на место через hall.focusInBand → onInteract →
   clearFilters: фильтр сбрасывается, как при любом взаимодействии со схемой. */
const TARGET_PX = 18;                // целевой экранный размер увеличенного места, px
const filterTiers = new Map();

/* Множитель места для постоянного экранного размера при текущем зуме. */
function tierScale() {
    const per = (hall && hall.pxPerUnit()) || 1;
    return Math.max(1, TARGET_PX / (8 * per));
}

/* Перерисовать слой увеличения: доступные места активных тиров, масштаб = прогресс. */
function renderFilter() {
    if (!renderFilterLayer) return;
    if (!filterTiers.size) { renderFilterLayer([]); return; }
    const sc = tierScale();
    const items = [];
    seats.forEach((s) => {
        if (s.status !== 'available' || !s.tier || s.selected) return;
        const st = filterTiers.get(s.tier);
        if (!st || st.p <= 0) return;
        items.push({ s, sc: 1 + (sc - 1) * st.p });
    });
    renderFilterLayer(items);
}

/* Анимировать тир к target (1 — увеличить, 0 — вернуть) пружиной. */
function animateTier(color, target) {
    let st = filterTiers.get(color);
    if (!st) { st = { p: 0, target, stop: null }; filterTiers.set(color, st); }
    st.target = target;
    if (st.stop) { st.stop(); st.stop = null; }
    st.stop = spring({
        from: st.p, to: target,
        onUpdate: (v) => { st.p = v; renderFilter(); },
        onDone: () => {
            st.stop = null;
            if (target === 0) { filterTiers.delete(color); }
            renderFilter();
        },
    });
}

/* Клик по пилюле: переключить подсветку тира (мультивыбор). */
function toggleTierFilter(color) {
    const st = filterTiers.get(color);
    const on = !!st && st.target === 1;
    animateTier(color, on ? 0 : 1);
    updateLegendActive();
    updateFade();
}

/* Бледнение при активном фильтре. Активен ≥1 тир (target===1) → на корневой
   <svg> вешаем класс .filtering: CSS приглушает ВСЕ базовые 8×8-места,
   а места активных тиров помечаем классом .tier-active (CSS возвращает им полный цвет).
   Слои .filter-layer/.sel-layer из бледнения исключены в CSS, поэтому
   увеличенные копии и оранжевый маркер остаются в полном цвете. */
function updateFade() {
    if (!hallSvgEl) return;
    const active = new Set();
    filterTiers.forEach((st, color) => { if (st.target === 1) active.add(color); });
    if (active.size === 0) {
        hallSvgEl.classList.remove('filtering');
        seats.forEach((s) => s.el.classList.remove('tier-active'));
        return;
    }
    hallSvgEl.classList.add('filtering');
    seats.forEach((s) => {
        const on = s.status === 'available' && s.tier && active.has(s.tier);
        s.el.classList.toggle('tier-active', on);
    });
}

/* Синхронизировать .active у пилюль с активными тирами (без ре-рендера легенды). */
function updateLegendActive() {
    legendEl.querySelectorAll('.pill').forEach((p) => {
        const st = filterTiers.get(p.dataset.tier);
        p.classList.toggle('active', !!st && st.target === 1);
    });
}

/* Сброс фильтра: мгновенно вернуть размеры и погасить обводки пилюль.
   Вызывается при любом взаимодействии со схемой (hall.onInteract). */
function clearFilters() {
    if (!filterTiers.size) { updateLegendActive(); updateFade(); return; }
    filterTiers.forEach((st) => { if (st.stop) st.stop(); });
    filterTiers.clear();
    if (renderFilterLayer) renderFilterLayer([]);
    updateLegendActive();
    updateFade();       // снять .filtering и все .tier-active → полный цвет у всех
}

function injectHall() {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => {
            $('.hall-svg').innerHTML = svg;
            const svgEl = $('.hall-svg svg');
            hallSvgEl = svgEl;   // для класса бледнения .filtering (см. updateFade)
            // привязать к местам схемы данные (ряд/место/статус) + разметить DOM
            seats = buildSeats(svgEl);
            // слой увеличения по фильтру цены (ПОД слоем выбора — создаётся раньше)
            renderFilterLayer = createFilterLayer(svgEl);
            // слой selected-отметок поверх мест (оранжевый + галочка)
            renderSelection = createSelectionLayer(svgEl);
            // цены мест: цвет тира → цена
            applySessionPrices(seats, new Map(TIER_COLORS.map((c, i) => [c.toUpperCase(), TIER_PRICES[i]])));
        })
        .catch((e) => console.error('hall.svg load failed', e));
}

/* --- Инициализация --- */
const hallReady = injectHall();
renderLegend();
refreshCart();   // заказ пуст: нижнего блока нет

const hall = new HallViewport($('.map-viewport'), $('.map-content'), {
    // высоты плавающих оверлеев (шапка с фильтрами / нижний блок) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев; по ним же focusInBand
    // считает видимую полосу. Пустая корзина → .floating display:none → 0.
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    bottomInset: () => floatingEl.getBoundingClientRect().height,
    // Оффсет покоя: при ПУСТОЙ корзине (снизу нет блока) опускаем вписанную схему
    // на половину высоты шапки, чтобы вертикальный воздух распределился симметрично.
    restOffsetY: () => (cart.length === 0 && header ? header.getBoundingClientRect().height / 2 : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
    // любое взаимодействие со схемой (pan/zoom/tap/фокус) → сброс фильтра цены
    onInteract: () => clearFilters(),
    // подсветка кресла едет вместе со схемой; ошибка в ней не должна ломать пан и зум
    onView: () => {
        if (!photoMap) return;
        try { photoMap.update(); } catch (e) { console.error('Подсветка кресла: пересчёт не удался', e); }
    },
});

const viewportEl = $('.map-viewport');
// тап, пан, щипок, колесо по схеме — подсветка гаснет; жест идёт в hall.js как обычно.
// Слушается ввод, а не onView: onView зовут и программные движения схемы — fitHall, refit, resize
viewportEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });
viewportEl.addEventListener('wheel', stopShowOnMap, { capture: true, passive: true });
// касание карусели или кнопки: карусель двигает схему, контур остался бы не по месту
floatingEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });
// касание фильтра цены: под контуром кресло могло побледнеть или увеличиться, контур остался бы не по креслу
legendEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });

// вписать всю схему в кадр (contain) сразу и после первого лейаута
fitHall();
requestAnimationFrame(fitHall);

// пересчёт при смене размеров вьюпорта: рецентрирование карусели + фит схемы,
// затем переприменить viewBox под новые размеры коробки
window.addEventListener('resize', () => {
    recenterTickets();
    fitHall();
    hall.panTo(hall.tx, hall.ty);   // реклампинг + перерисовка viewBox
});
requestAnimationFrame(recenterTickets);   // добор после первого лейаута

// SVG уже в DOM → отрисовать загрузочный viewBox через состояние (= min-зум)
hallReady.then(fitHall);

// фото секций и подсветка — после загрузки схемы: нужна модель кресел с секцией и стороной
const PHOTOS_URL = 'photos/sections.json';   // одно фото на секцию: { "<часть>-<сторона>": { url, caption } }

hallReady.then(() => {
    if (!seats.length) return;   // схема не загрузилась — ошибка уже в консоли
    try {
        photoMap = createPhotoMap({ hall, viewportEl, seats });
        photoMap.load(PHOTOS_URL);
    } catch (e) {
        photoMap = null;
        console.error('Фото: слой не создан, схема работает без фото', e);
    }
});
