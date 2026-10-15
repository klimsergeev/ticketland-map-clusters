/* ============================================================
   Точка входа: собирает экран, связывает схему ↔ корзину ↔ карусель билетов.
   ============================================================ */
import { EVENT, TIER_COLORS, TIER_PRICES, MAX_SEATS, formatPrice } from './data.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer, applySessionPrices } from './seats.js';
import { createPhotoMap } from './photo-map.js';
import { createPhotoToggle, createPhotoCard, createPhotoTip } from './photo-ui.js';
import { PHOTO_CONFIG } from './photo-config.js';

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
const sliderEl = $('.slider');
const trackEl = $('.slider-track', sliderEl);
const ctaEl = $('.cta');
const floatingEl = $('.floating');

/* --- Режим фото: при открытии схемы выключен. Объявлено до new HallViewport:
       fitHall() сразу вызывает onView, и обращение к photoMap ниже по файлу упало бы. --- */
let photoMode = false;
let photoMap = null;     // слой меток фото, появляется после загрузки схемы
let showSeq = 0;           // номер текущего «Показать на схеме»; действие человека его сбивает
let showLeaving = false;   // карточка уезжает после «Показать на схеме»: касания схемы игнорируются
const photoToggle = createPhotoToggle({ parentEl: $('.app'), onChange: onPhotoButton });
const photoTip = createPhotoTip({ parentEl: photoToggle.dockEl });
const photoCard = createPhotoCard({ parentEl: $('.app'), onShow: showOnMap });

/* Кнопка режима: подсветка кресла и тултип гаснут сразу, режим переключается как обычно */
function onPhotoButton(on) {
    stopShowOnMap();
    photoTip.dismiss();
    setPhotoMode(on);
}

/* --- Шапка: статичная (название, площадка, «Назад») --- */
$('.ttl').textContent = EVENT.title;
$('.sub').textContent = EVENT.venue;
$('.icon-btn').innerHTML = icoChevronLeft;

/* --- Корзина: выбранные места. Наполняется кликами по схеме, стартует ПУСТОЙ.
       Каждый элемент — объект-место из модели seats.js (ссылка), у него есть
       .seat/.row/.price/.selected. Максимум MAX_SEATS мест. --- */
const cart = [];

/* --- Галерея билетов: КАРУСЕЛЬ. Карточки едут по горизонтали. Якорь активной
       карточки зависит от её позиции в списке: первая → ЛЕВЫЙ край (peek справа),
       последняя → ПРАВЫЙ край (peek слева), середина → ЦЕНТР (peek с обеих сторон).
       Drag тянет трек ЗА ПАЛЬЦЕМ 1:1, по отпусканию — пружинный снап к ближайшей
       карточке (учёт скорости флика). Активная = последний выбранный на схеме
       билет; ручной свайп это переопределяет (активной становится ближайшая после
       снапа). Анимация перенесена из anim/carousel.js. --- */
/* Ширина карточек ПЕРЕМЕННАЯ (hug-content, Figma Hug у обоих состояний): неактивная
   узкая, активная шире (крупнее шрифт/паддинги/gap + крестик). Поэтому шаг между
   карточками (pitch) НЕ константа — геометрию карусели считаем по ФАКТИЧЕСКИМ
   offsetWidth (см. measureCards): cardW[i] — ширина карточки i, cardStart[i] — X её
   левого края внутри трека (кумулятивная сумма ширин + зазоров). */
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

/* пружина (velocity-based, rAF) — из anim/carousel.js */
/* stiffness 840 (4× прежней 210 → ω вдвое выше → переход ~2× быстрее),
   damping 44 → ζ≈0.76: лёгкий overshoot ~2.5% (еле заметный баунс) */
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

/* Проставить класс active по текущему activeTicket. Должно вызываться ПЕРЕД
   measureCards при смене активной, т.к. активная карточка шире (hug) — её ширина
   меняется мгновенно (без width-transition), и measureCards должен прочитать уже
   финальные offsetWidth. */
function applyActiveClass() {
    ticketEls.forEach((el, i) => el.classList.toggle('active', i === activeTicket));
}

/* Замер фактических ширин карточек и кумулятивных X-позиций их левых краёв в треке.
   cardStart[i] = сумма ширин карточек 0..i-1 + i зазоров (как во flex-раскладке с gap).
   Читает offsetWidth (border-box, включает padding) — форсирует reflow, поэтому даёт
   уже settled-значение (width не анимируем → без промежуточных кадров). */
function measureCards() {
    cardW = ticketEls.map((el) => el.offsetWidth);
    cardStart = new Array(cardW.length);
    let x = 0;
    for (let i = 0; i < cardW.length; i++) {
        cardStart[i] = x;
        x += cardW[i] + TICKET_GAP;
    }
}

/* Якорь активной карточки во вьюпорте зависит от её позиции в списке:
     • первая (i=0)      → ЛЕВЫЙ край галереи (offset 0), peek справа;
     • последняя (i=n-1) → ПРАВЫЙ край (offset = W - cardW[i]), peek слева;
     • середина          → ЦЕНТР (offset = (W - cardW[i]) / 2), peek с обеих сторон.
   Ширина карточки cardW[i] — фактическая (переменная), поэтому центрирование/якорение
   учитывает реальную ширину именно этой карточки. Возвращает X левого края карточки i
   во вьюпорте в её «домашней» позиции. */
function anchorOffset(i) {
    const n = ticketEls.length;
    if (i <= 0) return 0;                              // первая — левый край
    const W = sliderEl.clientWidth;
    const w = cardW[i] || 0;
    if (i >= n - 1) return W - w;                      // последняя — правый край
    return (W - w) / 2;                               // середина — центр
}

/* Суммарная ширина контента карусели = правый край последней карточки в треке
   (сумма фактических offsetWidth + зазоры между ними). Читает уже замеренные
   cardStart/cardW (measureCards вызывается ПЕРЕД targetXFor во всех путях, после
   applyActiveClass — значит ширины актуальны с учётом того, что активная шире). */
function contentWidth() {
    const n = cardW.length;
    if (n === 0) return 0;
    return (cardStart[n - 1] || 0) + (cardW[n - 1] || 0);
}

/* Переполнение = контент шире фактической ширины галереи (clientWidth слайдера)
   хотя бы на 1px. clientWidth = ширина вьюпорта минус паддинги (не хардкодим 384).
   Признак пересчитывается на КАЖДОМ вызове по свежим замерам (ширины меняются:
   hug, смена активного расширяет карточку). */
function isOverflow() {
    return contentWidth() > sliderEl.clientWidth;
}

/* позиция трека, при которой карточка i стоит в своём якоре (left/center/right).
   cardStart[i] — фактический левый край карточки в треке (сумма реальных ширин).
   БЕЗ переполнения (контент влезает в галерею): целевой trackX = 0 для ЛЮБОГО
   активного — вся группа прижата к левому краю, смена активного ленту не двигает,
   диапазон драга [0,0] (min=max=targetXFor(...)=0 → лента залипла на 0).
   С переполнением: текущее якорение (первый→левый, средний→центр, последний→правый). */
function targetXFor(i) {
    if (!isOverflow()) return 0;
    return anchorOffset(i) - (cardStart[i] || 0);
}

/* индекс карточки, чья якорная позиция ближе всего к текущему сдвигу трека x */
function nearestIndex(x) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < ticketEls.length; i++) {
        const d = Math.abs(x - targetXFor(i));
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

function setTrackX(px) {
    trackX = px;
    trackEl.style.transform = `translateX(${px}px)`;
    paintDepth();
}

/* глубина + active-состояние: активная (в своём якоре) — развёрнута
   (Selected=True, h64), соседи свёрнуты (Selected=False, h52). Дистанцию
   меряем от ЯКОРЯ активной карточки (левый/центр/правый), а не от левого края.
   height/radius переключает класс active. Прозрачность НЕ трогаем — все карточки
   полностью непрозрачны.
   ВАЖНО: scale-глубину соседей УБРАЛИ. При scale вокруг центра карточка ужимается
   к центру и её отрисованный край отходит от соседа → видимый зазор становится
   больше layout-зазора (8px → ~17px у активной, ~26px между соседями). Чтобы
   РЕАЛЬНЫЙ (после трансформа) зазор был ровно 8px = TICKET_GAP, ширина рендера
   должна равняться layout-ширине, т.е. scale=1. Иерархию активной даёт разница
   высот (h64 vs h52), а не scale. */
function paintDepth() {
    ticketEls.forEach((el, i) => {
        // без scale → рендер-ширина = layout-ширина → видимый зазор = 8px. cardDX[i]=0 в покое
        // (translateX(0) ≡ none); ненулевой — только во время FLIP-реколла соседей при удалении.
        el.style.transform = `translateX(${cardDX[i] || 0}px)`;
        // Z «веером» от активного: z СТРОГО убывает с расстоянием |i − activeTicket| в
        // ОБЕ стороны. Активный — максимум (100), каждый билет дальше — на 1 ниже (для
        // ВСЕХ, а не только соседей). Активный (100) выше кнопки CTA (z-index 1) → его
        // тень ложится поверх соседних билетов И поверх кнопки. Диапазон при ≤8 билетах:
        // 100…93 — все положительны и > z CTA. Пересчёт на каждый render/setTrackX/смену
        // активного (paintDepth зовётся из setTrackX; activeTicket меняют snapTo/renderTickets).
        el.style.zIndex = String(100 - Math.abs(i - activeTicket));
        el.classList.toggle('active', i === activeTicket);
    });
}

/* Снап пружиной: выровнять карточку i по левому краю (velocity — инерция флика) */
function snapTo(i, velocity = 0) {
    activeTicket = clamp(i, 0, ticketEls.length - 1);
    // новая активная карточка мгновенно разворачивается (шире) → сперва проставляем
    // класс и перемеряем ширины, только потом считаем целевую позицию трека.
    applyActiveClass();
    measureCards();
    if (stopSpring) { stopSpring(); stopSpring = null; }
    stopSpring = spring({
        from: trackX, to: targetXFor(activeTicket), velocity,
        onUpdate: (x) => setTrackX(x),
        onDone: () => { stopSpring = null; },
    });
}

/* ЕДИНАЯ ТОЧКА «смена активного билета». Все пути РЕАЛЬНОЙ смены активного
   (тап по неактивному, свайп со снапом на другой индекс, × неактивного) проходят
   сюда. Схема при этом стоит на месте — меняется только увеличенный маркер места. */
function activateTicket(i, velocity = 0) {
    const prev = activeTicket;
    snapTo(i, velocity);                 // клампит i и выставляет activeTicket
    if (activeTicket !== prev) {
        renderSelectionActive();         // увеличенным становится место нового активного
    }
}

/* Рецентрирование без анимации (resize) */
function recenterTickets() {
    if (deleting) return;                         // не сбивать FLIP-реколл во время удаления
    if (!ticketEls.length) return;
    // актуализировать класс active и ширины перед расчётом целевой позиции
    applyActiveClass();
    measureCards();
    setTrackX(targetXFor(activeTicket));
    renderSelectionActive();
}

function renderTickets(opts = {}) {
    trackEl.innerHTML = '';
    ticketEls.length = 0;
    cardDX = new Array(cart.length).fill(0);   // FLIP-сдвиги обнуляются на каждом ререндере
    cart.forEach((tk, idx) => {
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
        // × — удалить билет ТОЛЬКО если он активен; иначе первый клик центрирует
        // (делает активным), удаление — повторным кликом.
        // глушим pointerdown, чтобы кнопка не стартовала drag карточки
        const xBtn = card.querySelector('.t-x');
        xBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        xBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const i = ticketEls.indexOf(card);   // актуальный индекс на момент клика
            if (i === activeTicket) {
                deleteActiveTicket(i);            // активный билет — удаляем с fade-анимацией
            } else {
                activateTicket(i);
            }
        });
        ticketEls.push(card);
        trackEl.appendChild(card);
    });
    if (ticketEls.length === 0) { cardW = []; cardStart = []; setTrackX(0); return; }
    // клампим активную в новые границы и центрируем карусель на ней
    activeTicket = clamp(activeTicket, 0, ticketEls.length - 1);
    // проставить active-класс и замерить фактические ширины ПЕРЕД расчётом позиций
    // (активная карточка шире — hug); дальше геометрия считается по реальным ширинам.
    applyActiveClass();
    measureCards();
    // instant — мгновенно в целевую позицию (без пружины): нужно при удалении,
    // чтобы поверх мгновенного лейаута наложить FLIP-реколл соседей.
    if (opts.instant) setTrackX(targetXFor(activeTicket));
    else snapTo(activeTicket);
}

/* --- drag галереи: тянем трек за пальцем 1:1, по отпусканию — снап/флик.
       drag по карточке → карусель; drag по пустоте → пан схемы (не мешаем). --- */
let tDrag = null;
const TICKET_TAP = 8;             // px: движение меньше — это tap, а не drag

function onTicketDown(e, el) {
    if (deleting) return;
    if (e.target.closest('.t-x')) return;
    if (stopSpring) { stopSpring(); stopSpring = null; }
    const t0 = performance.now();
    tDrag = {
        startX: e.clientX, startY: e.clientY,
        startTrack: trackX, pid: e.pointerId,
        lastX: e.clientX, lastT: t0, vx: 0,
        // окно последних сэмплов {t,x} для робастной оценки скорости флика
        // (одиночный last-frame занижает vx: палец тормозит перед отпусканием).
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
    const dt = now - tDrag.lastT;
    if (dt > 0) tDrag.vx = (e.clientX - tDrag.lastX) / dt * 1000;   // last-segment (шумный)
    tDrag.lastX = e.clientX;
    tDrag.lastT = now;
    // копим окно сэмплов; чистим всё старше VX_WINDOW от текущего момента
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

/* --- Скорость жеста: РОБАСТНОЕ окно вместо last-frame ---
   Один последний сегмент перед отпусканием занижает скорость (палец тормозит),
   поэтому даже сильный флик давал низкий release-vx → карусель всегда шла +1.
   Берём среднюю скорость по последним VX_WINDOW мс: (Δx / Δt) на всём окне.
   Флик так надёжно отдаёт свою реальную высокую скорость. */
const VX_WINDOW = 70;             // мс: окно усреднения скорости отпускания
function windowedVX(samples, now) {
    if (!samples || samples.length < 2) return 0;
    const cutoff = now - VX_WINDOW;
    // первый сэмпл внутри окна (или предыдущий к нему, чтобы окно не схлопнулось)
    let i = samples.length - 1;
    while (i > 0 && samples[i - 1].t >= cutoff) i--;
    const a = samples[i], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt * 1000 : 0;
}

/* --- Маппинг «сила жеста → число шагов»: проекция инерции в ПЕЙЧАХ карточки ---
   Не привязываемся к магическим px/s. Тормозной путь флика proj = |vx|·VX_TAU
   (VX_TAU — время затухания инерции, с) делим на PITCH — фактический шаг НЕАКТИВНОЙ
   карточки (её ширина + зазор, ~128px). Округляем → сколько карточек пролетел бросок.
   Это self-calibrating к ширине карточек и НЕ зависит от сжатия якорей у краёв
   (важно: у левого края якорь 0→1 сжат до ~48px — проекция «на якорь» перескакивала
   бы соседа; счёт в пейчах карточки этого лишён). Достижение края — через clamp:
   у последней карточки якорь почти совпадает с предпоследним, так что сильный флик
   всегда доводит до края.
     • INTENT_FRACTION 0.32 — доля пути до соседа: прошли её → жест намеренный;
     • INTENT_VX 250 px/s — либо короткий, но быстрый флик тоже намеренный;
     • VX_TAU 0.26 c — тормозное время (замерено на реальных жестах: обычный свайп
       vx≈480–550 → ровно сосед; уверенный флик ≈1600 → +3; сильный ≈3400–3600 →
       через весь список до края). round(proj/PITCH): 1 шаг держится до vx≈770. */
const INTENT_FRACTION = 0.32;
const INTENT_VX = 250;
const VX_TAU = 0.26;

/* Дискретный выбор целевого индекса по параметрам жеста.
   cur — активный на старте жеста; n — число билетов; deltaX — смещение пальца по X
   (px; влево < 0); vx — РОБАСТНАЯ оконная скорость при отпускании (px/s; влево < 0);
   stepDist — расстояние до соседнего якоря (px, > 0; для порога намеренности);
   pitch — шаг неактивной карточки (px; единица счёта шагов; опц. → fallback stepDist).
   Направление — от ЗНАКА жеста; дальность — проекция инерции в пейчах карточки. */
function chooseTicketTarget({ cur, n, deltaX, vx, stepDist, pitch }) {
    // свайп влево (deltaX < 0) → следующий билет (+1); при нулевом смещении — по vx
    let dir = deltaX < 0 ? 1 : deltaX > 0 ? -1 : 0;
    if (dir === 0) dir = vx < 0 ? 1 : vx > 0 ? -1 : 0;
    if (dir === 0) return cur;

    const travel = Math.abs(deltaX);
    const speed = Math.abs(vx);
    // намеренность: прошли заметную долю пути ЛИБО фликнули достаточно быстро
    const intentional = travel >= stepDist * INTENT_FRACTION || speed >= INTENT_VX;

    const P = pitch > 0 ? pitch : (stepDist > 0 ? stepDist : 1);
    const proj = speed * VX_TAU;                      // тормозной путь инерции, px
    let steps = Math.round(proj / P);                 // сколько карточек пролетел бросок
    if (!intentional && steps < 1) return cur;        // слабый свайп → снап на текущий
    if (steps < 1) steps = 1;                         // намеренный → минимум сосед
    return clamp(cur + dir * steps, 0, n - 1);        // насыщение до края списка
}

function onTicketUp(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const d = tDrag;
    tDrag = null;
    sliderEl.classList.remove('grabbing');
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (moved < TICKET_TAP) {
        // tap по НЕактивной карточке (любая её область) → активировать и центрировать
        // карусель. Tap по активной — ничего (× удаляет своим click-хендлером).
        if (d.index !== -1 && d.index !== activeTicket) activateTicket(d.index);
        return;
    }
    // ручной свайп: целевой индекс ДИСКРЕТНО от текущего активного — направление по
    // знаку жеста, число шагов по скорости флика (см. chooseTicketTarget). Позицию
    // momentum НЕ используем для выбора индекса: узкие карточки иначе перескакивают.
    const cur = activeTicket;
    const n = ticketEls.length;
    const deltaX = e.clientX - d.startX;
    // РОБАСТНАЯ скорость отпускания по окну (не шумный last-frame d.vx)
    const vxWin = windowedVX(d.samples, performance.now());
    // расстояние по треку до соседа в сторону жеста (для порога намеренности).
    // targetXFor читается при текущем активном (cur шире) — реальная геометрия снапа.
    const dirGuess = deltaX < 0 ? 1 : deltaX > 0 ? -1 : (vxWin < 0 ? 1 : -1);
    const nb = clamp(cur + dirGuess, 0, n - 1);
    const stepDist = Math.abs(targetXFor(nb) - targetXFor(cur)) || ((cardW[cur] || 0) + TICKET_GAP);
    // PITCH — шаг НЕАКТИВНОЙ карточки (её ширина + зазор). Единица счёта шагов флика,
    // устойчивая к сжатию якорей у краёв. nb инактивна при cur-активном → её ширина.
    const pitch = ((cardW[nb] || cardW[cur] || 0) + TICKET_GAP);
    const target = chooseTicketTarget({ cur, n, deltaX, vx: vxWin, stepDist, pitch });
    // тот же velocity-based пружинный снап — меняется только целевой индекс.
    // В пружину отдаём оконную скорость: анимация соответствует силе флика.
    activateTicket(target, vxWin);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* --- Подложка галереи: видна только при непустой корзине. Пустая корзина →
   display:none, чтобы белый градиент не рисовался и высота не резервировалась
   (низ схемы зала не перекрывается белой пеленой). --- */
const appEl = $('.app');

/* Подъём дока над нижним блоком: от низа экрана до верха ряда билетов. Блок скрыт — 0.
   Градиент над билетами в счёт не идёт: меряется .slider, а не .floating */
function photoDockLift() {
    if (floatingEl.style.display === 'none') return 0;
    return Math.round(appEl.getBoundingClientRect().bottom - sliderEl.getBoundingClientRect().top);
}

function syncFloating() {
    if (!floatingEl) return;
    floatingEl.style.display = cart.length === 0 ? 'none' : '';
    photoToggle.setLift(photoDockLift());   // getBoundingClientRect после смены display — свежая раскладка
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
    // Figma 4902:80257 (Button): текст + шеврон-вправо 24×24 (Icons/Inverted #fafafa),
    // gap 4. Текст оставляем «Оформить: {сумма} ₽» (без слова «заказ»).
    ctaEl.innerHTML =
        `<span>Оформить: ${formatPrice(total)}</span>` +
        `<span class="cta-ico">${icoChevronRight}</span>`;
}

/* --- Корзина ↔ схема: выбор/снятие мест --- */
/* Перерисовать слой выбранных мест с учётом АКТИВНОГО билета (cart[activeTicket]) —
   его место рисуется крупнее и поверх остальных. Вызывать при любой смене
   корзины ИЛИ активного билета, чтобы увеличенным было ровно одно (новое) место. */
/* Фотоаппарат вместо галочки: кресло с фото в заказе при включённом режиме фото */
const cameraOnSeat = (s) => photoMode && photoMap !== null && photoMap.hasPhoto(s.id);

function renderSelectionActive() {
    const active = cart[activeTicket];
    if (renderSelection) renderSelection(seats, active, cameraOnSeat);
    // слой меток: метка кресла с фото в заказе прячется; ошибка здесь не мешает выбору мест
    if (!photoMap) return;
    try {
        photoMap.syncSelected(active);
    } catch (e) {
        console.error('Метки фото: метки выбранных кресел не обновлены', e);
    }
}

/* Перерисовать зависимые от корзины UI (галерея + CTA + отметки на схеме) */
function refreshCart() {
    renderTickets();
    renderCTA();
    syncFloating();
    renderSelectionActive();
}

/* Добавить место: отметить selected, положить в корзину, показать билет,
   центрировать схему на месте с приближением. Молча игнорируем 9-е место. */
function addSeat(seat) {
    if (cart.length >= MAX_SEATS) return;
    seat.selected = true;
    cart.push(seat);
    activeTicket = cart.length - 1;     // новый билет — активная карточка
    refreshCart();
    focusSeat(seat);
}

/* Убрать место: снять selected, выкинуть из корзины, вернуть в дефолт.
   Мгновенный путь (тап по месту на схеме). Удаление через × активного билета
   идёт через deleteActiveTicket (с fade-анимацией). */
function removeSeat(seat) {
    const i = cart.indexOf(seat);
    if (i === -1) return;
    seat.selected = false;
    cart.splice(i, 1);
    refreshCart();
}

/* ============================================================
   Удаление активного билета — CONCEPT «fade» (портирован из anim/del-fade.js).
   Тайминги:
     • exit-клон уходящей карточки: scale 1→.2 + opacity 1→0 на месте
       (origin center), 140ms, cubic-bezier(.4,0,1,1) — быстрое «схлопывание точкой»;
       рисуется поверх слайдера вне потока, чтобы не ломать layout карусели;
     • реколл соседей: FLIP + velocity-spring (stiffness 940 / damping 41, ζ≈0.67) —
       карточки плавно закрывают зазор на месте удалённой.
   deleting-флаг блокирует повторное удаление/драг во время анимации.
   Боевая логика удаления (снять selected, splice корзины, пересчёт CTA, место
   схемы в дефолт, пустая корзина → скрыть кнопку) — идёт синхронно. */
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

    // FLIP: запомнить X оставшихся карточек ДО удаления (ключ — объект-место, стабильная ссылка)
    const firstMap = new Map();
    ticketEls.forEach((el, i) => { if (i !== idx) firstMap.set(cart[i], el.getBoundingClientRect().left); });

    spawnExit(leavingEl);

    // --- боевая логика удаления (без изменений по сути) ---
    seat.selected = false;              // место схемы → дефолт
    cart.splice(idx, 1);                // выкинуть из корзины
    renderCTA();                        // пересчитать сумму / скрыть кнопку при пустой корзине

    renderSelectionActive();            // перерисовать отметки; увеличенным станет место нового активного

    if (cart.length === 0) {
        renderTickets();
        // последний билет уходит с fade: exit-клон живёт внутри .floating > .slider,
        // поэтому подложку прячем ПОСЛЕ завершения exit-анимации (иначе display:none
        // мгновенно оборвёт fade). Тайминг = удаление клона в spawnExit.
        setTimeout(syncFloating, EXIT_MS + 60);
        deleting = false;
        return;
    }

    activeTicket = clamp(idx, 0, cart.length - 1);
    renderSelectionActive();            // увеличенным становится место нового активного (в т.ч. при удалении последнего билета)
    renderTickets({ instant: true });   // мгновенный лейаут без пружины

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

/* Центрировать+приблизить схему к месту (центр rect'а = x+4, y+4 в SVG-юнитах) */
const FOCUS_SCALE = 1.8;   // уровень приближения при выборе (мягкий: место видно + видны соседи, без гипер-зума)
function focusSeat(seat) {
    if (!hall) return;
    const x = +seat.el.getAttribute('x') + 4;
    const y = +seat.el.getAttribute('y') + 4;
    hall.focusOnSvgPoint(x, y, FOCUS_SCALE);
}

/* Тап по схеме → hit-test ближайшего места → выбрать/снять.
   Серые (occupied/unknown) места некликабельны. */
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
    if (photoCard.isOpen()) { photoCard.close(); return; }   // тап при открытой карточке только закрывает её
    if (deleting) return;                         // не трогаем корзину во время анимации удаления
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    // Режим фото: разбор тапа по правилам касания меток. Код фото упал — тап уходит креслам.
    let hit = null;
    try {
        hit = photoMap ? photoMap.resolveTap(clientX, clientY) : null;
    } catch (e) {
        console.error('Метки фото: тап не разобран, он уходит креслам', e);
    }
    if (hit && hit.type === 'photo') { photoCard.open(hit.node); return; }
    if (hit && hit.type === 'cluster') { photoMap.zoomToCluster(hit.item); return; }   // этап кластеризации
    const seat = hit && hit.type === 'seat' ? hit.seat : findNearestSeat(p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    // Попадание в ДОСТУПНОЕ место → выбрать/снять + подзум. В режиме фото место с фото в заказ не идёт.
    if (seat && seat.status === 'available' && !(photoMode && photoMap && photoMap.hasPhoto(seat.id))) {
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

/* --- Режим фото: кнопка ↔ слой меток ↔ карточка --- */
function setPhotoMode(on) {
    photoMode = on;
    photoToggle.setOn(on);
    $('.hall-svg').classList.toggle('is-photo-mode', on);   // приглушение свободных кресел, см. css/photos.css
    if (photoMap) photoMap.setEnabled(on);
    renderSelectionActive();             // галочка ↔ фотоаппарат на креслах с фото в заказе, сразу
    if (!on) photoCard.close();          // выключение режима убирает открытую карточку
}

/* «Показать на схеме»: карточка уезжает и одновременно выключается режим фото,
   через 250 мс схема приближается к креслу, после остановки кресло подсвечивается */
function showOnMap(node) {
    const seq = ++showSeq;
    showLeaving = true;
    // схема не реагирует на касания, пока уезжает карточка: ни тап, ни пан, ни щипок, ни колесо
    viewportEl.style.pointerEvents = 'none';
    // сначала закрыть с колбэком: setPhotoMode(false) закрывает карточку без колбэка,
    // и после него close(cb) вызвал бы cb сразу — приближение пошло бы под карточкой
    photoCard.close(() => {
        showLeaving = false;
        viewportEl.style.pointerEvents = '';
        hall.focusInBand(node.x, node.y, FOCUS_SCALE, () => {
            if (seq !== showSeq || !photoMap) return;
            try {
                photoMap.highlightSeat(node.seatId);
            } catch (e) {
                console.error('Метки фото: подсветка кресла не показана', e);
            }
        });
    });
    // режим выключается тем же, что вызывает кнопка режима; второй close() внутри — пустой
    photoTip.dismiss();
    setPhotoMode(false);
}

/* Действие человека: подсветка гаснет за 150 мс, подсветка, которая ещё не началась, отменяется.
   Пока карточка уезжает — ничего: сценарий доводится до конца */
function stopShowOnMap() {
    if (showLeaving) return;
    showSeq++;
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
            // слой selected-отметок поверх мест (оранжевый + галочка или фотоаппарат)
            renderSelection = createSelectionLayer(svgEl);
            // цены мест: цвет тира → цена
            applySessionPrices(seats, new Map(TIER_COLORS.map((c, i) => [c.toUpperCase(), TIER_PRICES[i]])));
        })
        .catch((e) => console.error('hall.svg load failed', e));
}

/* --- Инициализация --- */
const hallReady = injectHall();
renderTickets();
renderCTA();
syncFloating();

const hall = new HallViewport($('.map-viewport'), $('.map-content'), {
    // высоты плавающих оверлеев (шапка / нижний блок) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    bottomInset: () => (floatingEl ? floatingEl.getBoundingClientRect().height : 0),
    // Оффсет покоя: при ПУСТОЙ корзине (загрузка — снизу нет кнопки) опускаем
    // вписанную схему на половину высоты шапки, чтобы вертикальный
    // воздух распределился симметрично, а не сваливался весь вниз. Есть билеты
    // (кнопка снизу) → 0 → композиция как раньше.
    restOffsetY: () => (cart.length === 0 && header ? header.getBoundingClientRect().height / 2 : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
    // слой меток фото: ошибка в нём не должна ломать пан и зум
    onView: () => {
        if (!photoMap) return;
        try { photoMap.update(); } catch (e) { console.error('Метки фото: пересчёт не удался', e); }
    },
});

/* Первое касание схемы гасит тултип; жест при этом идёт в hall.js как обычно.
   Слушается ввод, а не onView: onView зовут и программные движения схемы — fitHall, refit, resize */
const viewportEl = $('.map-viewport');
viewportEl.addEventListener('pointerdown', () => photoTip.dismiss(), { capture: true });
viewportEl.addEventListener('wheel', () => photoTip.dismiss(), { capture: true, passive: true });
// тап, пан, щипок, колесо по схеме — подсветка гаснет; жест идёт в hall.js как обычно
viewportEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });
viewportEl.addEventListener('wheel', stopShowOnMap, { capture: true, passive: true });
// касание билетов: смена активного билета меняет размер маркера, от которого считается волна
floatingEl.addEventListener('pointerdown', stopShowOnMap, { capture: true });
// кнопка режима: подсветка гаснет при касании, а не по click; вызов в onPhotoButton — для клавиатуры
photoToggle.dockEl.querySelector('.photo-btn').addEventListener('pointerdown', stopShowOnMap);

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

// слой меток фото — после загрузки схемы: нужна модель кресел с seat.id
hallReady.then(() => {
    if (!seats.length) return;   // схема не загрузилась — ошибка уже в консоли
    try {
        photoMap = createPhotoMap({
            hall, viewportEl: $('.map-viewport'), seats, nearestSeat: findNearestSeat, config: PHOTO_CONFIG,
        });
        photoMap.setEnabled(photoMode);
        photoMap.load(PHOTO_CONFIG.dataUrl).then(renderSelectionActive);   // режим к этому моменту может быть уже включён
    } catch (e) {
        photoMap = null;
        console.error('Метки фото: слой не создан, схема работает без фото', e);
    }
});

// тултип: отсчёт 1 с с момента, когда схема на экране. Схема не загрузилась — подсказывать не к чему
hallReady.then(() => {
    if (!seats.length) return;
    // два кадра: в первом применяется загрузочный viewBox, ко второму схема уже нарисована
    requestAnimationFrame(() => requestAnimationFrame(() => photoTip.schedule()));
});
