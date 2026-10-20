/* ============================================================
   Точка входа: собирает экран, связывает схему ↔ корзину ↔ шторку заказа.
   ============================================================ */
import { EVENT, TIER_COLORS, TIER_PRICES, MAX_SEATS, formatPrice } from './data.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer, applySessionPrices } from './seats.js';
import { createPhotoMap } from './photo-map.js';
import { createLightbox, createSeatCard } from './photo-ui.js';

/* --- Иконки (инлайн SVG) --- */
const icoChevronLeft =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 L5 8 L10 13"/></svg>';
/* Иконки шторки — экспорт из Figma, фрейм bottomsheet: пути и заливки как в макете */
const icoTicket =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M16.4561 11.5C16.4561 10.8096 15.8964 10.25 15.2061 10.25C14.5157 10.25 13.9561 10.8096 13.9561 11.5V12.5C13.9561 13.1904 14.5157 13.75 15.2061 13.75C15.8964 13.75 16.4561 13.1904 16.4561 12.5V11.5Z" fill="#8D969F"/>'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M19.206 4.41375C20.5888 4.5936 21.5979 5.72006 21.7575 7.10538L21.9922 9.14211C22.0566 9.7016 21.7111 10.155 21.362 10.6129C21.0357 11.0412 20.7062 11.4733 20.7062 12C20.7062 12.5267 21.0357 12.9588 21.362 13.3871C21.7111 13.845 22.0566 14.2984 21.9922 14.8579L21.7732 16.7586C21.606 18.21 20.5111 19.3799 19.0612 19.5593C17.8964 19.7034 16.3883 19.8546 14.7062 19.9371C13.9062 19.9763 13.0668 20 12.2062 20C9.53604 20 7.06955 19.7718 5.35074 19.5592C3.90082 19.3799 2.80646 18.21 2.63925 16.7586L2.42027 14.8579C2.35582 14.2984 2.70139 13.845 3.05042 13.3871C3.37681 12.9588 3.70623 12.5267 3.70623 12C3.70623 11.4733 3.37681 11.0412 3.05042 10.6129C2.70139 10.155 2.35582 9.7016 2.42027 9.14211L2.65492 7.10537C2.81452 5.72006 3.82309 4.59369 5.20592 4.41383C6.77815 4.20933 9.13709 4 12.2062 4C13.1005 4 13.9345 4.01777 14.7062 4.04802C16.5829 4.12156 18.0919 4.26886 19.206 4.41375ZM12.2062 18C9.64288 18 7.2626 17.7805 5.59627 17.5743C5.11903 17.5153 4.69433 17.1219 4.62611 16.5297L4.43563 14.8763C4.47219 14.8241 4.52647 14.75 4.60798 14.6429L4.64787 14.5907C4.79406 14.3997 5.03959 14.0789 5.23587 13.7257C5.46824 13.3077 5.70623 12.7223 5.70623 12C5.70623 11.2777 5.46824 10.6923 5.23587 10.2743C5.03958 9.92113 4.79405 9.60033 4.64787 9.40933L4.60799 9.35713C4.52648 9.25003 4.47219 9.1759 4.43563 9.12368L4.64178 7.33428C4.70717 6.76664 5.08307 6.44665 5.46388 6.39712C6.95545 6.20311 9.22812 6 12.2062 6C12.8197 6 13.4032 6.00862 13.9561 6.024V7C13.9561 7.69036 14.5157 8.25 15.2061 8.25C15.8964 8.25 16.4561 7.69036 16.4561 7V6.14819C17.4414 6.21997 18.2744 6.30943 18.9481 6.39705C19.3293 6.44663 19.7053 6.76709 19.7707 7.33428L19.9768 9.12368C19.9403 9.1759 19.886 9.25003 19.8045 9.35713L19.7646 9.40933C19.6184 9.60033 19.3729 9.92113 19.1766 10.2743C18.9442 10.6923 18.7062 11.2777 18.7062 12C18.7062 12.7223 18.9442 13.3077 19.1766 13.7257C19.3729 14.0789 19.6184 14.3997 19.7646 14.5907L19.8045 14.6429C19.886 14.75 19.9403 14.8241 19.9768 14.8763L19.7864 16.5297C19.7182 17.1215 19.2933 17.5153 18.8157 17.5744C18.1371 17.6583 17.3385 17.7447 16.4561 17.8175V17C16.4561 16.3096 15.8964 15.75 15.2061 15.75C14.5157 15.75 13.9561 16.3096 13.9561 17V17.9674C13.3864 17.9882 12.8009 18 12.2062 18Z" fill="#8D969F"/>'
    + '</svg>';
const icoChevronUp =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M3.75215 9.83591C3.08356 9.83591 2.74873 9.02805 3.22149 8.55558L4.98125 6.7969C6.40434 5.37468 7.11589 4.66357 8.00009 4.66357C8.88429 4.66357 9.59583 5.37469 11.0189 6.79691L12.7787 8.55558C13.2514 9.02805 12.9166 9.83591 12.248 9.83591C12.049 9.83591 11.8581 9.75689 11.7174 9.61624L9.95762 7.85757C9.21607 7.11647 8.76441 6.6696 8.39699 6.38944C8.22741 6.26013 8.12382 6.20503 8.06699 6.18135C8.02404 6.16345 8.00888 6.16353 8.00109 6.16357L8.00009 6.16357L7.99908 6.16357C7.99129 6.16353 7.97613 6.16345 7.93319 6.18135C7.87636 6.20503 7.77276 6.26013 7.60318 6.38944C7.23576 6.6696 6.78411 7.11647 6.04256 7.85757L4.2828 9.61624C4.14206 9.75689 3.95118 9.83591 3.75215 9.83591Z" fill="#1D2023"/>'
    + '</svg>';
// Cross 24 из макета: у крестика закрытия заливка #1D2023, у крестика удаления — #8D969F
const icoCross24 = (fill) =>
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + `<path d="M6.29289 16.2929C5.90237 16.6834 5.90237 17.3166 6.29289 17.7071C6.68342 18.0976 7.31658 18.0976 7.70711 17.7071L11.9999 13.4143L16.2929 17.7073C16.6834 18.0978 17.3166 18.0978 17.7071 17.7073C18.0976 17.3167 18.0976 16.6836 17.7071 16.293L13.4141 12.0001L17.7071 7.70711C18.0976 7.31658 18.0976 6.68342 17.7071 6.29289C17.3166 5.90237 16.6834 5.90237 16.2929 6.29289L11.9999 10.5859L7.70711 6.29304C7.31658 5.90252 6.68342 5.90252 6.2929 6.29304C5.90237 6.68357 5.90237 7.31673 6.29289 7.70726L10.5857 12.0001L6.29289 16.2929Z" fill="${fill}"/>`
    + '</svg>';
const icoClose = icoCross24('#1D2023');
const icoClear = icoCross24('#8D969F');

const $ = (sel, root = document) => root.querySelector(sel);

/* --- DOM-ссылки --- */
const header = $('.header');

/* --- Фото и подсветка кресла. Объявлено до new HallViewport:
       fitHall() сразу вызывает onView, и обращение к photoMap ниже по файлу упало бы. --- */
let photoMap = null;       // фото на креслах и подсветка кресла, появляются после загрузки схемы
let showSeq = 0;           // номер текущего ухода из лайтбокса на схему; действие человека его сбивает
let showLeaving = false;   // лайтбокс гаснет после «Показать на схеме» или «Добавить в корзину»: касания схемы игнорируются
let pendingAdd = null;     // место из «Добавить в корзину», которое ещё не легло в заказ
const lightbox = createLightbox({ parentEl: $('.app'), onShow: showOnMap, onAdd: addFromPhoto, onRemove: removeFromPhoto, statusOf: seatStatus, addState: addButtonState });
// карточка выбранного места: до первого refreshCart(), который зовёт syncSheet → seatCard.setLift
const seatCard = createSeatCard({ parentEl: $('.app'), onOpen: openFromCard, onClose: () => seatCard.hide() });
// спрятанная шторка опущена ниже своей высоты ещё на 32 px — .sheet.is-hidden, translateY(calc(100% + 32px)) в css/styles.css;
// путь выезжающей шторки = высота свёрнутой шторки + 32, с него при первом билете стартует и карточка
const SHEET_HIDDEN_EXTRA = 32;

/* --- Шапка: статичная (название, площадка, «Назад») --- */
$('.ttl').textContent = EVENT.title;
$('.sub').textContent = EVENT.venue;
$('.icon-btn').innerHTML = icoChevronLeft;

/* --- Корзина: выбранные места. Наполняется кликами по схеме, стартует ПУСТОЙ.
       Каждый элемент — объект-место из модели seats.js (ссылка), у него есть
       .seat/.row/.price/.selected. Максимум MAX_SEATS мест. --- */
const cart = [];

/* --- Шторка заказа --- */
const appEl = $('.app');
const sheetEl = $('.sheet');
const scrimEl = $('.sheet-scrim');
const detailsEl = $('.sheet-details', sheetEl);
const headEl = $('.sheet-head', sheetEl);
const listEl = $('.sheet-list', sheetEl);
const totalEl = $('.sheet-total', sheetEl);
const sumBtn = $('.sheet-sum', sheetEl);

$('.sheet-title').textContent = EVENT.title;
$('.sheet-date').textContent = EVENT.date;
$('.sheet-venue').textContent = EVENT.venue;
$('.sheet-close').innerHTML = icoClose;
$('.sheet-ico').innerHTML = icoTicket;
$('.sheet-chevron').innerHTML = icoChevronUp;

const DETAILS_PAD_TOP = 24;   // отступ над заголовком развёрнутой шторки (макет)
const SHEET_MAX = 718;        // максимум высоты развёрнутой шторки (макет, экран 800)
const SHEET_TOP_GAP = 82;     // 800 − 718: просвет над развёрнутой шторкой на любом экране
const ROW_OUT_MS = 150;       // строка удалённого билета гаснет
const SWIPE_START = 8;        // px: меньше — это тап, а не свайп
const SWIPE_CLOSE_PX = 80;    // протянули дальше — сворачиваем
const SWIPE_CLOSE_V = 0.5;    // px/ms: флик быстрее — сворачиваем

let sheetOpen = false;

const seatLabel = (s) => `${s.section}, ряд ${s.row}, место ${s.seat}`;

function ticketWord(n) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return 'билет';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'билета';
    return 'билетов';
}

/* Высота свёрнутой шторки — от неё считается полоса схемы.
   offsetHeight не видит transform, поэтому при пустом заказе 0 ставится явно */
function sheetLift() {
    return cart.length ? totalEl.offsetHeight : 0;
}

/* Высота верхней части развёрнутой шторки: по содержимому, но шторка целиком не выше предела.
   Не влезло — список получает прокрутку. scrollHeight даёт полную высоту списка и при overflow: hidden */
function fitDetails() {
    if (!sheetOpen) return;
    const natural = DETAILS_PAD_TOP + headEl.offsetHeight + listEl.scrollHeight;
    const max = Math.max(0, Math.min(SHEET_MAX, appEl.clientHeight - SHEET_TOP_GAP) - totalEl.offsetHeight);
    listEl.classList.toggle('is-scroll', natural > max);
    detailsEl.style.height = `${Math.min(natural, max)}px`;
}

function openSheet() {
    if (sheetOpen || !cart.length) return;
    seatCard.hide();   // уезжает под растущую шторку; после сворачивания не возвращается
    sheetOpen = true;
    sheetEl.classList.add('is-open');
    scrimEl.classList.add('is-shown');
    sumBtn.setAttribute('aria-expanded', 'true');
    fitDetails();
}

function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    swipe = null;
    sheetEl.classList.remove('is-open', 'is-dragging');
    scrimEl.classList.remove('is-shown');
    sumBtn.setAttribute('aria-expanded', 'false');
    sheetEl.style.transform = '';          // после свайпа шторка возвращается вместе со сворачиванием
    detailsEl.style.height = '0px';
}

function renderTotal() {
    const total = cart.reduce((acc, s) => acc + (s.price || 0), 0);
    $('.sheet-count').textContent = `${cart.length} ${ticketWord(cart.length)}`;
    $('.sheet-amount').textContent = formatPrice(total);
}

function renderList() {
    listEl.innerHTML = '';
    cart.forEach((seat) => {
        const row = document.createElement('div');
        row.className = 'sheet-row';
        row.innerHTML =
            `<span class="sheet-seat">${seatLabel(seat)}</span>`
            + '<span class="sheet-row-end">'
            + `<span class="sheet-price">${formatPrice(seat.price)}</span>`
            + `<button class="sheet-clear" type="button" aria-label="Убрать билет">${icoClear}</button>`
            + '</span>';
        row.querySelector('.sheet-clear').addEventListener('click', () => dropTicket(seat, row));
        listEl.appendChild(row);
    });
    listEl.scrollTop = 0;
}

/* Показать или спрятать шторку по заказу и поставить карточку над свёрнутой шторкой */
function syncSheet() {
    if (!cart.length) closeSheet();
    sheetEl.classList.toggle('is-hidden', !cart.length);
    seatCard.setLift(sheetLift());
}

/* Перерисовать всё, что зависит от заказа: шторку, карточку, маркеры на схеме */
function refreshCart() {
    renderList();
    renderTotal();
    dropCardIfGone();
    syncSheet();
    renderMarks();
}

/* Карточка бывает только у последнего выбранного места: у места с фото — его карточка,
   у места без фото — никакой, карточка прошлого места уезжает.
   sheetPx — путь шторки, которая выезжает вместе с этим билетом; 0 — шторка уже стоит */
function cardForLast(seat, sheetPx) {
    const node = photoMap ? photoMap.nodeOf(seat.id) : null;
    if (node) seatCard.show(node, sheetPx);
    else seatCard.hide();
}

/* Место карточки ушло из заказа — карточка уезжает под шторку.
   Заказ опустел — шторка уезжает целиком, карточка пропадает сразу, даже если уже уезжала.
   Вызывать до syncSheet */
function dropCardIfGone() {
    if (!cart.length) { seatCard.hide(true); return; }
    const node = seatCard.node();
    if (node && !node.seat.selected) seatCard.hide();
}

/* Превью или «развернуть» на карточке: лайтбокс на фото этого места, карточки при открытом лайтбоксе нет */
function openFromCard(node) {
    seatCard.hide();
    lightbox.open(node, photoMap.gallery());
}

/* Крестик в строке билета: заказ меняется сразу, строка уходит анимацией */
function dropTicket(seat, row) {
    if (!seat.selected) return;            // повторный тап по гаснущей строке
    seat.selected = false;
    cart.splice(cart.indexOf(seat), 1);
    renderTotal();
    renderMarks();
    if (!cart.length) { syncSheet(); return; }   // последний билет: шторка уезжает вниз целиком
    row.classList.add('is-leaving');
    setTimeout(() => { row.remove(); fitDetails(); }, ROW_OUT_MS);
}

sumBtn.addEventListener('click', () => (sheetOpen ? closeSheet() : openSheet()));
$('.sheet-close').addEventListener('click', closeSheet);
scrimEl.addEventListener('click', closeSheet);

/* Свайп вниз по развёрнутой шторке. Захват указателя — только после сдвига на SWIPE_START:
   до этого тапы по кнопкам внутри шторки работают как обычно, после — click до кнопки не дойдёт */
let swipe = null;
sheetEl.addEventListener('pointerdown', (e) => {
    if (!sheetOpen) return;
    if (listEl.contains(e.target) && listEl.classList.contains('is-scroll')) return;   // жест прокрутки списка
    swipe = { pid: e.pointerId, y0: e.clientY, dy: 0, t: performance.now(), v: 0, on: false };
});
sheetEl.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.pid) return;
    if (!e.buttons) { swipe = null; return; }   // мышь отпустили за пределами шторки, pointerup сюда не пришёл
    const dy = Math.max(0, e.clientY - swipe.y0);
    if (!swipe.on) {
        if (dy < SWIPE_START) return;
        swipe.on = true;
        sheetEl.setPointerCapture(e.pointerId);
        sheetEl.classList.add('is-dragging');
    }
    const now = performance.now();
    if (now > swipe.t) swipe.v = (dy - swipe.dy) / (now - swipe.t);
    swipe.dy = dy;
    swipe.t = now;
    sheetEl.style.transform = `translateY(${dy}px)`;
});
function endSwipe(e) {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const s = swipe;
    swipe = null;
    if (!s.on) return;
    if (s.dy > SWIPE_CLOSE_PX || s.v > SWIPE_CLOSE_V) { closeSheet(); return; }
    sheetEl.classList.remove('is-dragging');
    sheetEl.style.transform = '';
}
sheetEl.addEventListener('pointerup', endSwipe);
sheetEl.addEventListener('pointercancel', endSwipe);

/* --- Корзина ↔ схема: выбор/снятие мест --- */
/* Перерисовать маркеры выбранных мест: все одного размера, оранжевые, с галочкой */
function renderMarks() {
    if (renderSelection) renderSelection(seats);
    // подсветка кресла: контур снимается, если кресло под ним вошло в заказ или вышло из него;
    // ошибка здесь не мешает выбору мест
    if (!photoMap) return;
    try {
        photoMap.syncSelected();
    } catch (e) {
        console.error('Подсветка кресла: не обновлена после смены заказа', e);
    }
}

/* Добавить место: отметить selected, положить в заказ, обновить шторку,
   центрировать схему на месте с приближением. Молча игнорируем 9-е место.
   focus: false — схема уже стоит на месте (добавление из лайтбокса), второго движения нет. */
function addSeat(seat, focus = true) {
    if (cart.length >= MAX_SEATS) return;
    const sheetComing = !cart.length;   // шторка выезжает вместе с этим билетом
    seat.selected = true;
    cart.push(seat);
    refreshCart();
    cardForLast(seat, sheetComing ? sheetLift() + SHEET_HIDDEN_EXTRA : 0);
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
   Тап по месту на схеме. Крестик в строке билета идёт через dropTicket (строка гаснет анимацией). */
function removeSeat(seat) {
    const i = cart.indexOf(seat);
    if (i === -1) return;
    seat.selected = false;
    cart.splice(i, 1);
    refreshCart();
}

/* Центрировать+приблизить схему к месту (центр rect'а = x+4, y+4 в SVG-юнитах) */
const FOCUS_SCALE = 1.8;   // уровень приближения при выборе (мягкий: место видно + видны соседи, без гипер-зума)
function focusSeat(seat) {
    if (!hall) return;
    const x = +seat.el.getAttribute('x') + 4;
    const y = +seat.el.getAttribute('y') + 4;
    hall.focusOnSvgPoint(x, y, FOCUS_SCALE);
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
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    const seat = findNearestSeat(p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    // Попадание в ДОСТУПНОЕ место, с фото или без → выбрать/снять + подзум
    if (seat && seat.status === 'available') {
        if (seat.selected) { removeSeat(seat); return; }   // повторный тап — снять
        addSeat(seat);
        return;
    }
    // Промах (пустая область ИЛИ серое/недоступное место): только на МИНИМАЛЬНОМ
    // масштабе подзумливаем по точке тапа, как при выборе места, но БЕЗ выбора
    // (корзина не меняется). Если уже подзумлен — ничего не делаем (как раньше).
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
   Место ложится в заказ после остановки схемы — маркер появляется на уже приближенном кресле
   у человека на глазах; второго движения схемы нет. Касание во время приближения
   добавляет место сразу (stopShowOnMap): тап по кнопке не теряется */
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
let renderSelection = null; // fn(seats) — перерисовать слой выбранных мест

function injectHall() {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => {
            $('.hall-svg').innerHTML = svg;
            const svgEl = $('.hall-svg svg');
            // привязать к местам схемы данные (ряд/место/статус) + разметить DOM
            seats = buildSeats(svgEl);
            // слой selected-отметок поверх мест (оранжевый + галочка)
            renderSelection = createSelectionLayer(svgEl);
            // цены мест: цвет тира → цена
            applySessionPrices(seats, new Map(TIER_COLORS.map((c, i) => [c.toUpperCase(), TIER_PRICES[i]])));
        })
        .catch((e) => console.error('hall.svg load failed', e));
}

/* --- Инициализация --- */
const hallReady = injectHall();
refreshCart();   // заказ пуст: шторка скрыта

const hall = new HallViewport($('.map-viewport'), $('.map-content'), {
    // высоты плавающих оверлеев (шапка / свёрнутая шторка) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    bottomInset: () => sheetLift(),
    // Оффсет покоя: при ПУСТОЙ корзине (загрузка — снизу нет кнопки) опускаем
    // вписанную схему на половину высоты шапки, чтобы вертикальный
    // воздух распределился симметрично, а не сваливался весь вниз. Есть билеты
    // (кнопка снизу) → 0 → композиция как раньше.
    restOffsetY: () => (cart.length === 0 && header ? header.getBoundingClientRect().height / 2 : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
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
// касание шторки: крестик удаления меняет кресло в заказе, и контур, построенный под маркер, остался бы не по месту
sheetEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });

// вписать всю схему в кадр (contain) сразу и после первого лейаута
fitHall();
requestAnimationFrame(fitHall);

// пересчёт при смене размеров вьюпорта: высота развёрнутой шторки + фит схемы,
// затем переприменить viewBox под новые размеры коробки
window.addEventListener('resize', () => {
    fitDetails();
    fitHall();
    hall.panTo(hall.tx, hall.ty);   // реклампинг + перерисовка viewBox
});

// SVG уже в DOM → отрисовать загрузочный viewBox через состояние (= min-зум)
hallReady.then(fitHall);

// фото и подсветка — после загрузки схемы: нужна модель кресел с seat.id
const PHOTOS_URL = 'photos/photos-bug.json';   // набор фото; другие наборы лежат рядом в photos/

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
