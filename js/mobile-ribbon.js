/* ============================================================
   Mobile ticket ribbon (window narrower than 1024 px): the ticket carousel with the checkout button in the bottom
   block, moved from the former mobile entry point main.js as is. It shows the shared order (app-core.js) and tells
   the core about the active ticket and deletions through callbacks.

   createMobileRibbon({ floatingEl, order, getPhoto, onActive, onFocus, onPhoto, onDelete }) → API at the end
     order — the shared order array; getPhoto(entry) → { url, thumb, caption } | null;
     onActive(entry | null) — the active ticket changed (its seat marker is larger);
     onFocus(entry) — move the scheme to the entry's place; onPhoto(entry) — tap on the active card's photo;
     onDelete(entry) — the cross removes the active entry: the order drops it with its gifts.
   ============================================================ */
import { formatPrice } from './data.js';
import { spring } from './spring.js';
import { createCheckoutButton } from './checkout-button.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function createMobileRibbon({ floatingEl, order, getPhoto, onActive, onFocus, onPhoto, onDelete }) {
    const sliderEl = $('.slider', floatingEl);
    const trackEl = $('.slider-track', sliderEl);
    const ctaEl = $('.cta', floatingEl);

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
       Тап по уже активному идёт мимо (прямой onFocus в onTicketUp), добавление места — тоже
       (ядро само ведёт схему к новому месту). */
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
        if (order[i]) onFocus(order[i]);
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
           фото — фото секции места (getPhoto), если есть;
         • секция без места — { kind: 'seatless', name, price, photo? }: название секции, цена;
         • доп. инвентарь — { kind: 'extra', name, sort, price }: название, вид, цена; фото нет никогда.
       Инвентарь — подарок к билету амфитеатра: name «Сладкий подарок», sort — ряд и место билета, parent — его место. */
    // иконки карточки — Citrus «Ticket preview / citrus» (Bottomsheet 4982:4868): Cross 24 #8D969F, Search 24 белая
    const ICON_CROSS_CIRCLE = 'assets/ticket-cross-24.svg';
    const ICON_SEARCH = 'assets/ticket-search-24.svg';

    const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* Что показать на карточке: тип, строки текста (первая — заголовок), фото или null */
    function ticketView(tk) {
        if (tk.kind === 'seatless') {
            return { type: 'seatless', lines: [tk.name, formatPrice(tk.price)], photo: getPhoto(tk) };
        }
        if (tk.kind === 'extra') {
            return { type: 'extra', lines: [tk.name, tk.sort, formatPrice(tk.price)], photo: null };
        }
        const photo = getPhoto(tk);
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
        trackEl.classList.toggle('is-single', order.length === 1);
        cardDX = new Array(order.length).fill(0);
        cardOp = new Array(order.length).fill(null);
        order.forEach((tk) => {
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
        // switching to the mobile layout: cards stand in place at once
        if (opts.instant) { if (opts.onDone) opts.onDone(); return; }
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
            if (d.index === activeTicket && d.onPhoto) { onPhoto(order[d.index]); return; }
            // tap по активной вне зоны × → схема снова на её место; корзина не меняется
            if (d.index === activeTicket && !inTicketXZone(d.index, e.clientX)) {
                const seat = order[d.index];
                if (seat) onFocus(seat);
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
        onActive(order[activeTicket] || null);
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
        const seat = order[idx];
        if (!seat) return;
        deleting = true;
        if (stopSpring) { stopSpring(); stopSpring = null; }   // погасить возможный снап
        finishLayoutAnim();                                    // недоехавшие карточки — сразу на места

        // вместе с местом уходят его подарки: их карточки гаснут так же, как карточка места
        const giftEls = [];
        order.forEach((item, j) => { if (item.parent === seat) giftEls.push(ticketEls[j]); });
        // the order drops the entry with its gifts: the seat loses its check, a dancefloor ticket goes back on sale
        onDelete(seat);
        giftEls.forEach((el) => { if (el) spawnExit(el); });

        if (order.length === 0) {
            renderMarks();
            // кнопка и блок остаются, пока клон уходит под кнопку; когда он погас — прячется всё разом
            spawnExit(ticketEls[idx], () => {
                if (!order.length) { renderTickets(); renderCTA(); syncFloating(); }
                deleting = false;
            });
            return;
        }

        renderCTA();
        activeTicket = clamp(idx, 0, order.length - 1);
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
        floatingEl.style.display = order.length === 0 ? 'none' : '';
    }

    /* --- CTA «Оформить заказ» с суммой на плашке и скидкой (js/checkout-button.js) ---
       Сумма — общая стоимость всех позиций заказа; пересчитывается при каждом изменении заказа
       (renderCTA зовут refreshCart и удаление). Пустая корзина → кнопки нет; есть билеты → кнопка видна */
    const checkoutBtn = createCheckoutButton(ctaEl);

    function renderCTA() {
        ctaEl.style.display = order.length === 0 ? 'none' : '';
        if (order.length) checkoutBtn.render(order);
    }

    /* Перерисовать маркеры выбранных мест (активное — крупнее) */
    function renderMarks() {
        renderSelectionActive();
    }

    /* Перерисовать всё, что зависит от корзины: карусель, CTA, подложку, маркеры на схеме */
    function refreshCart(opts) {
        // сначала показать нижний блок: при пустом заказе он display: none, и карточки, разложенные внутри
        // скрытого блока, меряются шириной 0 — лента считала, что всё влезает, и оставалась на первой карточке
        // (пачка билетов танцпола в пустой заказ)
        syncFloating();
        renderTickets(opts);
        renderCTA();
        renderMarks();
    }

    return {
        // new entries in the order: activeEntry becomes the active card
        add(entries, activeEntry) {
            const i = order.indexOf(activeEntry);
            activeTicket = i === -1 ? order.length - 1 : i;
            refreshCart();
        },
        // entries left the order by a repeated tap on the seat: the active position stays in the list
        remove() { refreshCart(); },
        // the page switched to the mobile layout: cards built from the order at once, activeEntry active
        rebuild(activeEntry) {
            const i = order.indexOf(activeEntry);
            activeTicket = i === -1 ? Math.max(0, order.length - 1) : i;
            trackEl.innerHTML = '';
            ticketEls.length = 0;
            refreshCart({ instant: true });
        },
        // section photos arrived: cards get photos (width 192 → 280)
        photosLoaded() { if (order.length && !deleting) renderTickets(); },
        renderCTA,
        recenter: recenterTickets,
        isBusy: () => deleting,
        activeEntry: () => order[activeTicket] || null,
        height: () => floatingEl.getBoundingClientRect().height,
    };
}
