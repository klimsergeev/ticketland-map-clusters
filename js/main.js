/* ============================================================
   Точка входа: собирает экран, связывает схему ↔ корзину ↔ карусель билетов.
   ============================================================ */
import { EVENT, TIER_COLORS, TIER_PRICES, MAX_SEATS, DANCEFLOOR, formatPrice } from './data.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer, applySessionPrices, createFilterLayer, createHighlightLayer } from './seats.js';
import { createPhotoMap } from './photo-map.js';
import { createLightbox } from './photo-ui.js';
import { createSeatlessDialog } from './seatless-dialog.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* --- DOM-ссылки --- */
const header = $('.header');
const legendEl = $('.legend');
const sliderEl = $('.slider');
const trackEl = $('.slider-track', sliderEl);
const ctaEl = $('.cta');
const floatingEl = $('.floating');

/* --- Фото секций и лайтбокс --- */
let photoMap = null;       // фото секций, появляются после загрузки схемы
// лайтбокс: все фото секций, открывается тапом по фото активной карточки билета (openSectionPhotos)
// «Показать на схеме» под фото: лайтбокс закрывается, схема едет к секции фото (showPhotoOnMap)
const lightbox = createLightbox({
    parentEl: $('.app'),
    onShow: (item) => showPhotoOnMap(item),
});
// диалог танцпола: тап по танцполу на схеме → выбор количества → билеты без места в заказ (addSeatless)
const seatlessDialog = createSeatlessDialog({
    parentEl: $('.app'),
    onAdd: (n) => addSeatless(n),
    onPhoto: () => openSectionPhotos({ kind: 'seatless', photoKey: DANCEFLOOR.photoKey }),   // лайтбокс поверх диалога
    // шторка ушла — её слэк в bottomInset тоже: схема плавно возвращается в обычные границы пана,
    // иначе первый пан после закрытия дёрнул бы её. «Добавить» потом может повести схему сам (focusSeat)
    onClose: () => { if (hall) hall.settle(); },
});

/* --- Шапка: статичная (название, площадка; крестик — без действия, как раньше «Назад») --- */
$('.ttl').textContent = EVENT.title;
$('.dt').textContent = EVENT.date;
$('.sub').textContent = EVENT.venue;

/* --- Рендер легенды (цвет→цена). Пилюли = ФИЛЬТР цены:
       клик по пилюле увеличивает доступные места её тира (см. toggleTierFilter).
       Активная пилюля — цветная обводка в цвет тира (класс .active, --ring). --- */
/* Цвет обводки нажатой пилюли. Обычно — цвет тира. Тир, еле видный на белом (контраст с белым ниже
   RING_MIN_CONTRAST по WCAG), получает тот же тон и насыщенность с яркостью B (HSB) ниже на RING_DARKEN пунктов —
   правило прежних кружков на креслах. Маркер на пилюле остаётся в цвет тира.
   Порог 1,3: темнее становится только «1 750 ₽» (#F2E7E4, контраст 1,21). При пороге 1,5 под правило попал бы
   и жёлтый «4 000 ₽» (#F5D300, контраст 1,48) — обводка #C2A700 */
const RING_MIN_CONTRAST = 1.3;
const RING_DARKEN = 20;

function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// контраст с белым по WCAG 2.1: (1 + 0.05) / (L + 0.05), L — относительная яркость цвета
function contrastWithWhite(hex) {
    const [r, g, b] = hexRgb(hex).map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

// #RRGGBB → тот же H и S, яркость B меньше на points пунктов: при тех же H и S все каналы меняются в пропорции newB / B
function darkenHsb(hex, points) {
    const rgb = hexRgb(hex);
    const b = Math.max(...rgb) / 255;
    if (!b) return hex;
    const k = Math.max(0, b - points / 100) / b;
    return '#' + rgb.map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function ringColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex;
    return contrastWithWhite(hex) < RING_MIN_CONTRAST ? darkenHsb(hex, RING_DARKEN) : hex;
}

function renderLegend() {
    legendEl.innerHTML = '';
    TIER_COLORS.forEach((c, i) => {
        const color = c.toUpperCase();
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill';
        pill.dataset.tier = color;
        pill.style.setProperty('--ring', ringColor(c));   // обводка нажатой; светлый тир — темнее
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
       Ширина карточек разная: 280 с фото, 192 без фото (в одной ленте бывают обе), один билет — на всю ширину;
       поэтому геометрию считаем по фактическим offsetWidth (см. measureCards). --- */
const TICKET_GAP = 8;             // зазор между билетами (Figma: gap в карусели)

let activeTicket = 0;
const ticketEls = [];
let cardW = [];                   // фактическая ширина каждой карточки (offsetWidth)
let cardStart = [];               // X левого края карточки i внутри трека (кумулятивно)
let trackX = 0;                   // текущий сдвиг трека по X
let stopSpring = null;            // отмена активной пружины
let cardDX = [];                  // покадровый сдвиг каждой карточки по X (FLIP соседей, выезд новых)
let cardOp = [];                  // покадровая непрозрачность карточки; null — без инлайн-стиля
const cardItem = new WeakMap();   // карточка → позиция заказа: по ней FLIP узнаёт карточку после перестройки
let layoutAnim = null;            // идущая анимация раскладки ленты: { stop() }
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
        el.style.opacity = cardOp[i] == null ? '' : String(cardOp[i]);
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

/* --- Карточка билета: макет «Ticket preview / svklimenk3-cards» 4767:11622 ---
   Три типа позиции заказа:
     • место — объект-место из seats.js (у него есть .el): часть зала, «Ряд N место M», цена;
       фото — фото секции места (photoMap.photoOf), если есть;
     • секция без места — { kind: 'seatless', name, price, photo? }: название секции, цена;
     • доп. инвентарь — { kind: 'extra', name, sort, price }: название, вид, цена; фото нет никогда.
   Сейчас в заказ попадают только места; секция без места и инвентарь умеют только рисоваться. */
// иконки карточки — Citrus «Ticket preview / citrus» (Bottomsheet 4982:4868): Cross 24 #8D969F, Search 24 белая
const ICON_CROSS_CIRCLE = 'assets/ticket-cross-24.svg';
const ICON_SEARCH = 'assets/ticket-search-24.svg';

const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Что показать на карточке: тип, строки текста (первая — заголовок), фото или null */
function ticketView(tk) {
    if (tk.kind === 'seatless') {
        return { type: 'seatless', lines: [tk.name, formatPrice(tk.price)], photo: photoMap ? photoMap.photoOf(tk) : null };
    }
    if (tk.kind === 'extra') {
        return { type: 'extra', lines: [tk.name, tk.sort, formatPrice(tk.price)], photo: null };
    }
    const photo = photoMap ? photoMap.photoOf(tk) : null;
    return { type: 'seat', lines: [tk.section, `Ряд ${tk.row} место ${tk.seat}`, formatPrice(tk.price)], photo };
}

/* Собрать карточку позиции tk в элементе card (класс, фото, тексты, крестик) */
function fillTicketCard(card, tk) {
    const v = ticketView(tk);
    card.className = `ticket type-${v.type}` + (v.photo ? ' has-photo' : '');
    const photoHtml = v.photo
        ? '<span class="t-photo">'
            // миниатюра 324×240 (photos/thumbs); лайтбокс и диалог танцпола берут полное фото v.photo.url
            + `<img class="t-photo-img" src="${escHtml(v.photo.thumb || v.photo.url)}" alt="${escHtml(v.photo.caption || '')}" draggable="false">`
            + `<span class="t-zoom" aria-hidden="true"><img src="${ICON_SEARCH}" alt="" width="24" height="24" draggable="false"></span>`
            + '</span>'
        : '';
    const lines = v.lines.map((text, i) => `<span class="t-line${i === 0 ? ' t-title' : ''}">${escHtml(text)}</span>`).join('');
    card.innerHTML =
        photoHtml
        + `<span class="t-text">${lines}</span>`
        + `<button class="t-x" type="button" aria-label="Убрать"><img src="${ICON_CROSS_CIRCLE}" alt="" width="24" height="24" draggable="false"></button>`;
    // нет миниатюры — полное фото; битое и оно — пустой фон превью, как у карточки места раньше
    const img = card.querySelector('.t-photo-img');
    if (img) {
        img.addEventListener('error', () => {
            if (v.photo.thumb && img.getAttribute('src') !== v.photo.url) img.src = v.photo.url;
            else img.style.visibility = 'hidden';
        });
    }
}

/* ============================================================
   Анимация раскладки ленты (появление, удаление, перестановка карточек).
   После любой перестройки лента сразу стоит в целевом якоре, а карточки доезжают до своих мест:
     • карточки, которые уже были на экране, — FLIP от прежнего положения на экране той же пружиной,
       что раньше закрывала зазор при удалении (stiffness 940 / damping 41);
     • новые карточки выезжают от правого края слайдера на своё место и проявляются:
       ENTER_MS, кривая шторки cubic-bezier(.2,.8,.2,1); несколько новых — одна за другой через ENTER_STAGGER,
       все на путь последней («поездом»).
   Так движение ленты к новой карточке и выезд карточки складываются в одно движение, а не спорят. */
const FLIP_STIFFNESS = 940;
const FLIP_DAMPING = 41;
const ENTER_MS = 320;
const ENTER_STAGGER = 60;         // мс между карточками пачки
const ENTER_FADE = 0.6;           // карточка полностью проявляется к 60% своего выезда

/* cubic-bezier(x1,y1,x2,y2) как в CSS: t (доля времени) → доля пути */
function cubicBezier(x1, y1, x2, y2) {
    const a = (p1, p2) => 1 - 3 * p2 + 3 * p1, b = (p1, p2) => 3 * p2 - 6 * p1, c = (p1) => 3 * p1;
    const at = (t, p1, p2) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
    const slope = (t, p1, p2) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
    return (x) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
            const d = at(t, x1, x2) - x;
            const s = slope(t, x1, x2);
            if (Math.abs(d) < 1e-5 || !s) break;
            t -= d / s;
        }
        return at(Math.min(1, Math.max(0, t)), y1, y2);
    };
}
const enterEase = cubicBezier(0.2, 0.8, 0.2, 1);

/* Остановить анимацию раскладки там, где она есть (снимок для следующего FLIP берётся с экрана) */
function stopLayoutAnim() {
    if (layoutAnim) { layoutAnim.stop(); layoutAnim = null; }
}

/* Довести раскладку до конца сразу: палец лёг на ленту во время анимации */
function finishLayoutAnim() {
    if (!layoutAnim) return;
    const done = layoutAnim.onDone;
    stopLayoutAnim();
    cardDX = cardDX.map(() => 0);
    cardOp = cardOp.map(() => null);
    setTrackX(trackX);
    if (done) done();
}

/* before: Map(позиция заказа → { left, op }) — где карточка была на экране до перестройки.
   onDone — когда все карточки встали на места */
function startLayoutAnim(before, onDone) {
    const sliderRight = sliderEl.getBoundingClientRect().right;
    const flip = [];
    const enter = [];
    ticketEls.forEach((el, i) => {
        const left = el.getBoundingClientRect().left;   // cardDX ещё 0 — это место в новой раскладке
        const b = before.get(cardItem.get(el));
        if (b) {
            if (Math.abs(b.left - left) > 0.5 || b.op < 1) flip.push({ i, dx0: b.left - left, op0: b.op });
        } else {
            enter.push({ i, off: sliderRight - left, delay: enter.length * ENTER_STAGGER, t: 0 });
        }
    });
    if (!flip.length && !enter.length) { if (onDone) onDone(); return; }
    // пачка выезжает «поездом»: все новые карточки сдвигаются на один и тот же путь — путь последней
    // (от правого края слайдера до её места). Без этого первые карточки пачки, чьё место далеко за левым
    // краем, пролетали бы через всю ленту
    if (enter.length > 1) {
        const run = enter[enter.length - 1].off;
        enter.forEach((e) => { e.off = Math.min(e.off, run); });
    }

    let flipP = 1;
    let flipDone = !flip.length;
    let enterDone = !enter.length;
    const apply = () => {
        flip.forEach((f) => {
            cardDX[f.i] = f.dx0 * flipP;
            cardOp[f.i] = f.op0 >= 1 ? null : f.op0 + (1 - f.op0) * (1 - flipP);
        });
        enter.forEach((e) => {
            cardDX[e.i] = e.off * (1 - enterEase(e.t));
            cardOp[e.i] = e.t >= 1 ? null : Math.min(1, e.t / ENTER_FADE);
        });
        setTrackX(trackX);
    };
    apply();

    let raf = 0;
    let stopFlip = null;
    const anim = { onDone, stop: () => { cancelAnimationFrame(raf); if (stopFlip) stopFlip(); } };
    const finish = () => {
        if (!flipDone || !enterDone || layoutAnim !== anim) return;
        layoutAnim = null;
        cardDX = cardDX.map(() => 0);
        cardOp = cardOp.map(() => null);
        setTrackX(trackX);
        if (onDone) onDone();
    };
    if (!flipDone) {
        stopFlip = spring({
            from: 1, to: 0, stiffness: FLIP_STIFFNESS, damping: FLIP_DAMPING,
            onUpdate: (v) => { flipP = v; apply(); },
            onDone: () => { flipDone = true; finish(); },
        });
    }
    if (!enterDone) {
        const t0 = performance.now();
        const step = (now) => {
            let all = true;
            enter.forEach((e) => {
                e.t = Math.min(1, Math.max(0, (now - t0 - e.delay) / ENTER_MS));
                if (e.t < 1) all = false;
            });
            apply();
            if (all) { enterDone = true; finish(); return; }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    }
    layoutAnim = anim;
}

/* Перестроить ленту под заказ. Лента сразу встаёт в якорь активной карточки, карточки доезжают
   анимацией раскладки (см. выше); opts.onDone — когда всё встало */
function renderTickets(opts = {}) {
    // где каждая карточка сейчас на экране — с учётом идущей анимации (transform и opacity)
    const before = new Map();
    ticketEls.forEach((el) => {
        const item = cardItem.get(el);
        if (item) before.set(item, { left: el.getBoundingClientRect().left, op: el.style.opacity === '' ? 1 : +el.style.opacity });
    });
    stopLayoutAnim();
    if (stopSpring) { stopSpring(); stopSpring = null; }
    trackEl.innerHTML = '';
    ticketEls.length = 0;
    // один билет — карточка на всю ширину слайдера; ставится до measureCards, ширины читаются уже итоговые
    trackEl.classList.toggle('is-single', cart.length === 1);
    cardDX = new Array(cart.length).fill(0);
    cardOp = new Array(cart.length).fill(null);
    cart.forEach((tk) => {
        const card = document.createElement('div');
        fillTicketCard(card, tk);
        cardItem.set(card, tk);
        card.addEventListener('pointerdown', (e) => onTicketDown(e, card));
        card.addEventListener('pointermove', onTicketMove);
        card.addEventListener('pointerup', onTicketUp);
        card.addEventListener('pointercancel', onTicketUp);
        // × виден только у активного: удаляет его; у неактивного (только программно) — активирует.
        // Глушим pointerdown, чтобы кнопка не стартовала drag карточки
        // Крестик срабатывает, только если палец или курсор лёг на него сам: тап в правый верхний угол
        // неактивной карточки делает её активной, крестик появляется под пальцем, и click, который браузер
        // присылает после отпускания, иначе сразу удалял бы билет. Click с клавиатуры (detail 0) — как раньше
        const xBtn = card.querySelector('.t-x');
        let xPressed = false;
        xBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); xPressed = true; });
        xBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pressed = xPressed;
            xPressed = false;
            if (deleting) return;                // идёт удаление: индексы ленты и заказа ещё расходятся
            if (!pressed && e.detail !== 0) return;
            const i = ticketEls.indexOf(card);   // актуальный индекс на момент клика
            if (i === activeTicket) deleteActiveTicket(i);
            else activateTicket(i);
        });
        ticketEls.push(card);
        trackEl.appendChild(card);
    });
    if (ticketEls.length === 0) { cardW = []; cardStart = []; setTrackX(0); if (opts.onDone) opts.onDone(); return; }
    // клампим активную в новые границы (активной остаётся позиция в списке)
    activeTicket = clamp(activeTicket, 0, ticketEls.length - 1);
    applyActiveClass();
    measureCards();
    setTrackX(targetXFor(activeTicket));
    startLayoutAnim(before, opts.onDone);
}

/* --- drag галереи: тянем трек за пальцем 1:1, по отпусканию — снап/флик.
       drag по карточке → карусель; drag по пустоте → пан схемы. --- */
let tDrag = null;
const TICKET_TAP = 8;             // px: движение меньше — это tap, а не drag
/* Правая зона активного билета: колонка под крестиком (у текста справа отступ 40) + буфер = 44px.
   Тап в ней схему не двигает (× удаляет своим хендлером, остальное — no-op). */
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
    finishLayoutAnim();
    if (stopSpring) { stopSpring(); stopSpring = null; }
    const t0 = performance.now();
    tDrag = {
        startX: e.clientX, startY: e.clientY,
        startTrack: trackX, pid: e.pointerId,
        // окно последних сэмплов {t,x} для робастной оценки скорости флика
        samples: [{ t: t0, x: e.clientX }],
        index: ticketEls.indexOf(el),
        onPhoto: !!e.target.closest('.t-photo'),   // фото или лупа: тап по активной открывает лайтбокс
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
        // tap по фото активной → лайтбокс фото секций; схема не двигается
        if (d.index === activeTicket && d.onPhoto) { openSectionPhotos(cart[d.index]); return; }
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
   Удаление активного билета крестиком — две фазы подряд:
     1. клон уходящей карточки уходит вниз на EXIT_DY и гаснет: EXIT_MS, ускоряющаяся кривая
        cubic-bezier(.4,0,1,1). Клон лежит в .floating слоем 0 — под лентой (2) и под кнопкой
        «Оформить» (1): его нижняя часть заезжает под кнопку, а не поверх неё. Сама карточка в ленте
        на это время прячется (visibility), её место остаётся пустым — соседи стоят;
     2. когда клон ушёл целиком, лента перестраивается и соседи съезжаются анимацией раскладки
        (FLIP, stiffness 940 / damping 41).
   Активным становится билет на той же позиции (у последнего — левый сосед), схема едет на его место
   сразу, вместе с уходом карточки. deleting-флаг блокирует повторное удаление, драг, крестики и тапы
   по схеме до конца обеих фаз. Последний билет: после ухода клона прячется весь блок вместе с кнопкой. */
const EXIT_MS = 240;
const EXIT_DY = 40;               // px: насколько карточка уходит вниз (из 80 её высоты; низ уходит под кнопку)
const EXIT_EASING = 'cubic-bezier(.4,0,1,1)';

/* onGone — когда клон погас целиком (конец перехода opacity; страховка по таймеру, если перехода не было) */
function spawnExit(leavingEl, onGone) {
    const fr = floatingEl.getBoundingClientRect();
    const lr = leavingEl.getBoundingClientRect();
    const clone = leavingEl.cloneNode(true);
    clone.classList.add('exit-clone');
    if (leavingEl.classList.contains('active')) clone.classList.add('active');
    clone.style.left = (lr.left - fr.left) + 'px';
    clone.style.top = (lr.top - fr.top) + 'px';
    clone.style.width = lr.width + 'px';
    clone.style.height = lr.height + 'px';
    clone.style.transform = 'none';
    clone.style.opacity = leavingEl.style.opacity || '1';
    clone.style.zIndex = '';
    clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASING}, opacity ${EXIT_MS}ms ${EXIT_EASING}`;
    floatingEl.appendChild(clone);
    leavingEl.style.visibility = 'hidden';   // в ленте карточки больше нет, место пустое до второй фазы
    void clone.offsetWidth;   // зафиксировать старт, потом запустить переход
    let gone = false;
    const done = () => {
        if (gone) return;
        gone = true;
        clone.remove();
        if (onGone) onGone();
    };
    clone.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity') done(); });
    setTimeout(done, EXIT_MS + 120);
    clone.style.transform = `translateY(${EXIT_DY}px)`;
    clone.style.opacity = '0';
}

function deleteActiveTicket(idx) {
    if (deleting) return;
    const seat = cart[idx];
    if (!seat) return;
    deleting = true;
    if (stopSpring) { stopSpring(); stopSpring = null; }   // погасить возможный снап
    finishLayoutAnim();                                    // недоехавшие карточки — сразу на места

    seat.selected = false;              // место схемы → дефолт
    cart.splice(idx, 1);
    if (seat.kind === 'seatless') dancefloorLeft++;   // билет танцпола вернулся в продажу

    if (cart.length === 0) {
        renderMarks();
        // кнопка и блок остаются, пока клон уходит под кнопку; когда он погас — прячется всё разом
        spawnExit(ticketEls[idx], () => {
            if (!cart.length) { renderTickets(); renderCTA(); syncFloating(); }
            deleting = false;
        });
        return;
    }

    renderCTA();
    activeTicket = clamp(idx, 0, cart.length - 1);
    renderMarks();                      // увеличенным становится место нового активного
    focusTicket(activeTicket);          // схема на место нового активного — вместе с уходом карточки
    // вторая фаза: соседи съезжаются только после того, как клон погас целиком
    spawnExit(ticketEls[idx], () => {
        renderTickets({ onDone: () => { deleting = false; } });
    });
}

/* --- Подложка нижнего блока: видна только при непустой корзине. Пустая корзина →
   display:none, чтобы белый градиент не рисовался и высота не резервировалась. --- */
function syncFloating() {
    floatingEl.style.display = cart.length === 0 ? 'none' : '';
}

/* --- CTA «Оформить • сумма» — Citrus Button из «Bottomsheet / citrus», без таймера ---
   Сумма — общая стоимость всех позиций заказа: места, билеты танцпола, допинвентарь (у каждой позиции своё price).
   Пересчитывается при каждом изменении заказа (renderCTA зовут refreshCart и удаление).
   Пустая корзина → кнопки нет; есть билеты → кнопка видна */
ctaEl.innerHTML = '<span class="cta-label"></span>';
const ctaLabelEl = $('.cta-label', ctaEl);

function renderCTA() {
    ctaEl.style.display = cart.length === 0 ? 'none' : '';
    const total = cart.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    ctaLabelEl.textContent = `Оформить • ${formatPrice(total)}`;
}

/* Перерисовать маркеры выбранных мест (активное — крупнее) и всё, что от них зависит */
function renderMarks() {
    renderSelectionActive();
    renderFilter();   // место вошло в заказ — увеличенная копия снимается, вышло — возвращается
}

/* Перерисовать всё, что зависит от корзины: карусель, CTA, подложку, маркеры на схеме */
function refreshCart() {
    // сначала показать нижний блок: при пустом заказе он display: none, и карточки, разложенные внутри
    // скрытого блока, меряются шириной 0 — лента считала, что всё влезает, и оставалась на первой карточке
    // (пачка билетов танцпола в пустой заказ)
    syncFloating();
    renderTickets();
    renderCTA();
    renderMarks();
}

/* Добавить место: отметить selected, положить в корзину, показать билет активным,
   поставить место в центр видимой полосы. Молча игнорируем 9-е место. */
function addSeat(seat) {
    if (cart.length >= MAX_SEATS) return;
    seat.selected = true;
    cart.push(seat);
    activeTicket = cart.length - 1;     // новый билет — активная карточка
    refreshCart();
    focusSeat(seat);
}

/* --- Танцпол: билеты без места ---
   Цена — по тиру заливки танцпола, центр — середина его прямоугольника в hall.svg (для фокуса схемы).
   Каждый билет — отдельная позиция заказа { kind: 'seatless' } и отдельная карточка в карусели. */
function dancefloorPrice() {
    const i = TIER_COLORS.findIndex((c) => c.toUpperCase() === DANCEFLOOR.tier.toUpperCase());
    return i === -1 ? 0 : TIER_PRICES[i];
}
function dancefloorCenter() {
    const r = seatlessEls[0] && seatlessEls[0].querySelector('rect');
    if (!r) return null;
    return { x: +r.getAttribute('x') + +r.getAttribute('width') / 2, y: +r.getAttribute('y') + +r.getAttribute('height') / 2 };
}

function dancefloorSize() {
    const r = seatlessEls[0] && seatlessEls[0].querySelector('rect');
    return r ? { w: +r.getAttribute('width'), h: +r.getAttribute('height') } : { w: 0, h: 0 };
}

/* Тап по танцполу: сначала схема приближается — танцпол на DANCEFLOOR_SHARE ширины экрана, центр в полосе
   между шапкой и шторкой диалога; по высоте он может частично уйти под шторку или шапку — главное, чтобы
   было видно, какой сектор выбран, — после остановки открывается диалог. Можно выбрать не больше, чем осталось
   до лимита заказа. Если человек оборвал приближение касанием, диалог всё равно открывается по таймеру,
   а «Добавить» потом довезёт схему до танцпола */
const DANCEFLOOR_SHARE = 0.8;
// остаток билетов на танцпол в продаже: «Добавить в корзину» уменьшает, удаление билета танцпола из ленты возвращает 1
let dancefloorLeft = DANCEFLOOR.stock;
const DANCEFLOOR_ZOOM_MS = 260;   // = длительность _animateTo в hall.js
let dancefloorView = null;   // вид схемы, в котором открыт диалог: «Добавить» второй раз схему не двигает
let dancefloorSeq = 0;       // номер текущего открытия: поздний onDone или таймер старого открытия не срабатывают
let dancefloorFocusing = false;   // схема едет к танцполу перед диалогом: шторка уже считается нижним оверлеем (bottomInset)

function openSeatlessDialog() {
    const photo = photoMap ? photoMap.photoOf({ kind: 'seatless', photoKey: DANCEFLOOR.photoKey }) : null;
    seatlessDialog.prepare({ name: DANCEFLOOR.name, price: dancefloorPrice(), photo, left: dancefloorLeft, available: MAX_SEATS - cart.length });
    dancefloorView = null;
    const c = dancefloorCenter();
    if (!c || !hall) { seatlessDialog.show(); return; }
    const seq = ++dancefloorSeq;
    const showOnce = (arrived) => {
        if (seq !== dancefloorSeq) return;
        dancefloorSeq++;
        dancefloorView = arrived ? hall.viewState() : null;
        seatlessDialog.show();
        dancefloorFocusing = false;   // дальше шторку как оверлей держит seatlessDialog.isOpen()
    };
    // шторка закрывает низ схемы так же, как нижний блок заказа: без этого клэмп пана не пускает танцпол
    // в полосу над шторкой, и высокий танцпол уходит под неё
    dancefloorFocusing = true;
    const sheet = seatlessDialog.height();
    const scale = hall.scaleForWidth(dancefloorSize().w, viewportEl.clientWidth * DANCEFLOOR_SHARE);
    hall.focusAt(c.x, c.y, scale, sheet, () => showOnce(true));
    setTimeout(() => showOnce(false), DANCEFLOOR_ZOOM_MS + 200);   // приближение оборвано — onDone не придёт
}

/* Схема стоит там, где открывался диалог: человек её не двигал */
function sameView(a, b) {
    return !!a && !!b && Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
}

/* «Добавить» в диалоге: n билетов в конец заказа, активный — последний добавленный.
   Схема уже стоит на танцполе с открытия диалога; едет к нему, только если человек её успел сдвинуть */
function addSeatless(n) {
    const count = Math.min(n, MAX_SEATS - cart.length, dancefloorLeft);
    if (count < 1) return;
    dancefloorLeft -= count;
    const c = dancefloorCenter();
    let last = null;
    for (let i = 0; i < count; i++) {
        last = { kind: 'seatless', name: DANCEFLOOR.name, price: dancefloorPrice(), photoKey: DANCEFLOOR.photoKey, cx: c ? c.x : null, cy: c ? c.y : null };
        cart.push(last);
    }
    activeTicket = cart.length - 1;
    refreshCart();
    if (!sameView(dancefloorView, hall.viewState())) focusSeat(last);
    dancefloorView = null;
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
    if (!hall || !seat) return;
    // билет без места — центр секции (танцпола); у инвентаря точки на схеме нет
    if (seat.kind === 'seatless') {
        if (seat.cx != null) hall.focusInBand(seat.cx, seat.cy, FOCUS_SCALE);
        return;
    }
    if (!seat.el) return;
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
/* Точка схемы (SVG-юниты) внутри прямоугольника танцпола (<g class="seatless"> в hall.svg) */
function onSeatless(sx, sy) {
    return seatlessEls.some((g) => {
        const r = g.querySelector('rect');
        if (!r) return false;
        const x = +r.getAttribute('x'), y = +r.getAttribute('y');
        return sx >= x && sx <= x + +r.getAttribute('width') && sy >= y && sy <= y + +r.getAttribute('height');
    });
}
function handleTap(clientX, clientY) {
    if (lightbox.isOpen()) { lightbox.close(); return; }   // лайтбокс перекрывает весь экран, тап до схемы не дойдёт; строка — страховка
    if (deleting) return;                                   // не трогаем корзину во время анимации удаления
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    if (onSeatless(p.x, p.y)) { openSeatlessDialog(); return; }   // танцпол: схема приближается к нему, потом диалог
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

/* --- Карточка билета → лайтбокс ---
   Тап по фото (или лупе) активной карточки или по фото в диалоге танцпола: лайтбокс со всеми фото —
   танцпол первым, затем 12 секций, — начиная с фото секции этого билета. Схема, карусель и фильтр не меняются ни при открытии, ни при закрытии. */
function openSectionPhotos(tk) {
    if (!photoMap || !tk) return;
    const items = photoMap.gallery();
    const start = items.findIndex((it) => it.key === photoMap.keyOf(tk));
    if (start === -1) return;   // у секции билета нет фото — на карточке и фото нет
    lightbox.open(items, start);
}

/* Где на схеме секция фото: { x, y, w } в SVG-юнитах — середина и ширина прямоугольника, в который вписаны
   места секции (часть зала + сторона, место 8×8), или танцпола. null — у секции нет мест на схеме */
function photoPlace(item) {
    if (!item) return null;
    if (item.key === DANCEFLOOR.photoKey) {
        const c = dancefloorCenter();
        return c ? { x: c.x, y: c.y, w: dancefloorSize().w } : null;
    }
    if (!photoMap) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    seats.forEach((s) => {
        if (photoMap.keyOf(s) !== item.key) return;
        const x = +s.el.getAttribute('x');
        const y = +s.el.getAttribute('y');
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 8); y1 = Math.max(y1, y + 8);
    });
    return x0 === Infinity ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0 };
}

/* «Показать на схеме» в лайтбоксе: лайтбокс уже закрывается, диалог танцпола закрывается, если открыт.
   Секция или танцпол встают на DANCEFLOOR_SHARE ширины экрана, середина — в центр полосы над нижним блоком;
   схема и приближается, и отдаляется. Узкой секции масштаб по ширине вышел бы слишком крупным — у секций
   он не больше FOCUS_SCALE, масштаба фокуса на выбранном билете: кресло не крупнее, чем там.
   У танцпола ограничения нет — как перед диалогом. Фокус сбрасывает фильтр — как любое движение схемы */
function showPhotoOnMap(item) {
    const c = photoPlace(item);
    if (!c || !hall) return;
    dancefloorSeq++;            // приближение к танцполу перед диалогом, если ещё шло, диалог уже не откроет
    dancefloorFocusing = false;
    dancefloorView = null;
    seatlessDialog.close();     // onClose → hall.settle(); фокус ниже его перебивает
    let scale = hall.scaleForWidth(c.w, viewportEl.clientWidth * DANCEFLOOR_SHARE);
    if (item.key !== DANCEFLOOR.photoKey) scale = Math.min(scale, FOCUS_SCALE);
    // схема доехала и встала — секция на секунду подсвечивается; движение оборвали касанием — onDone не придёт
    hall.focusAt(c.x, c.y, scale, floatingEl.getBoundingClientRect().height, () => highlightPhotoPlace(item));
}

/* Контуры секции фото: вокруг каждого свободного места секции, кроме мест в заказе, — в цвет места;
   у танцпола — вокруг его прямоугольника, в цвет его тира. В секции нет свободных мест (всё продано или
   всё в заказе) — контуров нет: схема только приезжает к секции, show([]) ничего не рисует */
function highlightPhotoPlace(item) {
    if (!sectionHighlight || !hall) return;
    const shape = (el, color) => ({
        x: +el.getAttribute('x'),
        y: +el.getAttribute('y'),
        w: +el.getAttribute('width'),
        h: +el.getAttribute('height'),
        r: +el.getAttribute('rx') || 0,
        color,
    });
    let shapes;
    if (item.key === DANCEFLOOR.photoKey) {
        shapes = seatlessEls.map((g) => g.querySelector('rect')).filter(Boolean)
            .map((r) => shape(r, r.getAttribute('fill')));
    } else {
        shapes = seats
            .filter((s) => s.status === 'available' && !s.selected && photoMap.keyOf(s) === item.key)
            .map((s) => shape(s.el, s.el.getAttribute('fill')));
    }
    sectionHighlight.show(shapes, hall.viewTransform().k);
}

// касание где угодно — схемы, ленты билетов, фильтра — гасит контуры секции сразу
document.addEventListener('pointerdown', () => { if (sectionHighlight) sectionHighlight.hide(); }, true);

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
let seatlessEls = [];      // секции без мест (танцпол) — <g class="seatless" data-tier> в hall.svg
let renderSelection = null; // fn(seats, activeSeat) — перерисовать слой выбранных мест
let renderFilterLayer = null; // fn(items) — перерисовать слой увеличения по фильтру цены
let sectionHighlight = null;  // { show, hide } — контуры секции после «Показать на схеме» (showPhotoOnMap)

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
        seatlessEls.forEach((g) => g.classList.remove('tier-active'));
        return;
    }
    hallSvgEl.classList.add('filtering');
    seats.forEach((s) => {
        const on = s.status === 'available' && s.tier && active.has(s.tier);
        s.el.classList.toggle('tier-active', on);
    });
    // танцпол: свой тир (data-tier) — в полном цвете, только если активен его тир
    seatlessEls.forEach((g) => g.classList.toggle('tier-active', active.has((g.dataset.tier || '').toUpperCase())));
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
            seatlessEls = [...svgEl.querySelectorAll('.seatless')];   // танцпол: бледнение по фильтру и тап мимо
            // привязать к местам схемы данные (ряд/место/статус) + разметить DOM
            seats = buildSeats(svgEl);
            // слой увеличения по фильтру цены (ПОД слоем выбора — создаётся раньше)
            renderFilterLayer = createFilterLayer(svgEl);
            // слой selected-отметок поверх мест (оранжевый + галочка)
            renderSelection = createSelectionLayer(svgEl);
            // контуры секции после «Показать на схеме» — над всеми слоями
            sectionHighlight = createHighlightLayer(svgEl);
            // цены мест: цвет тира → цена
            applySessionPrices(seats, new Map(TIER_COLORS.map((c, i) => [c.toUpperCase(), TIER_PRICES[i]])));
        })
        .catch((e) => console.error('hall.svg load failed', e));
}

/* --- Инициализация --- */
const hallReady = injectHall();
renderLegend();
refreshCart();   // заказ пуст: нижнего блока нет

const viewportEl = $('.map-viewport');
const hall = new HallViewport(viewportEl, $('.map-content'), {
    // высоты плавающих оверлеев (шапка с фильтрами / нижний блок) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев; по ним же focusInBand
    // считает видимую полосу. Пустая корзина → .floating display:none → 0.
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    // Шторка диалога танцпола — тоже нижний оверлей: пока схема едет к танцполу и пока диалог открыт
    bottomInset: () => Math.max(
        floatingEl.getBoundingClientRect().height,
        dancefloorFocusing || seatlessDialog.isOpen() ? seatlessDialog.height() : 0,
    ),
    // Оффсет покоя: при ПУСТОЙ корзине (снизу нет блока) опускаем вписанную схему
    // на половину высоты шапки, чтобы вертикальный воздух распределился симметрично.
    restOffsetY: () => (cart.length === 0 && header ? header.getBoundingClientRect().height / 2 : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
    // любое взаимодействие со схемой (pan/zoom/tap/фокус) → сброс фильтра цены
    onInteract: () => {
        clearFilters();
        if (sectionHighlight) sectionHighlight.hide();   // схему тронули или повели к другой точке — контуры секции гаснут сразу
    },
});

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

// фото секций — после загрузки схемы: нужна модель кресел с секцией и стороной
const PHOTOS_URL = 'photos/sections.json';   // одно фото на секцию: { "<часть>-<сторона>": { url, caption } }

hallReady.then(() => {
    if (!seats.length) return;   // схема не загрузилась — ошибка уже в консоли
    try {
        photoMap = createPhotoMap({ seats, seatless: [{ photoKey: DANCEFLOOR.photoKey, name: DANCEFLOOR.name }] });
        // фото секций пришли — карточки билетов, уже лежащих в заказе, получают фото (ширина 192 → 280)
        photoMap.load(PHOTOS_URL).then(() => {
            if (cart.length && !deleting) renderTickets();
        });
    } catch (e) {
        photoMap = null;
        console.error('Фото секций: не созданы, карточки без фото', e);
    }
});
