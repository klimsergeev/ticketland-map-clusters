/* ============================================================
   Диалог «билет без места» (танцпол): макет «Seatless popup _ svklimenk3-cards» 4828:36933.
   Шторка снизу над затемнением: шапка (фото, название, «Билет без места», цена, «Без комиссии»),
   выбор количества — кнопки 1–6+ или степпер, кнопка «Добавить N билетов • сумма».
   Стили — css/seatless.css.

   createSeatlessDialog({ parentEl, onAdd, onPhoto }) → { open, prepare, show, height, close, isOpen }
     open(opts) = prepare(opts) + show(). prepare заполняет шторку, не показывая её, — после этого height()
       даёт её высоту в px (схема заранее приближается так, чтобы танцпол встал над шторкой);
     opts = { name, price, photo, available } — photo { url, caption } или null; available — сколько ещё
       можно положить в заказ (лимит заказа минус уже лежащее), 0 — заказ полон;
     onAdd(count) — «Добавить»: диалог уже закрывается, вызывающий кладёт count билетов в заказ;
     onPhoto() — тап по фото или лупе в шапке.
   ============================================================ */
import { formatPrice } from './data.js';

const ICON_CROSS = 'assets/dialog-cross-24.svg';      // Cross 24, #231D1F — экспорт макета
const ICON_MINUS = 'assets/dialog-minus-32.svg';      // Minus 32, #231D1F
const ICON_PLUS = 'assets/dialog-plus-24.svg';        // Plus 24, #231D1F
const ICON_SEARCH = 'assets/ticket-search-16.svg';    // Search 16, белая — тот же экспорт, что у карточки билета

const CHIPS = [1, 2, 3, 4, 5];   // кнопки 1–5; шестая — «6+», переключает на степпер со значением 6
const STEPPER_FROM = 6;
const START_COUNT = 2;           // при открытии выбрано 2, как в макете
const SWIPE_START = 8;           // px: меньше — это тап, а не свайп
const SWIPE_CLOSE_PX = 80;       // протянули дальше — закрываем
const SWIPE_CLOSE_V = 0.5;       // px/ms: флик быстрее — закрываем

function ticketWord(n) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return 'билет';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'билета';
    return 'билетов';
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSeatlessDialog({ parentEl, onAdd, onPhoto }) {
    const scrim = document.createElement('div');
    scrim.className = 'sd-scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sd-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
        '<div class="sd-title">'
        + '<button class="sd-photo" type="button" aria-label="Открыть фото">'
        + '<img class="sd-photo-img" alt="" draggable="false">'
        + `<span class="sd-zoom" aria-hidden="true"><img src="${ICON_SEARCH}" alt="" width="16" height="16" draggable="false"></span>`
        + '</button>'
        + '<div class="sd-details">'
        + '<span class="sd-name"></span>'
        + '<span class="sd-kind">Билет без места</span>'
        + '<span class="sd-price-row"><span class="sd-price"></span><span class="sd-badge">Без комиссии</span></span>'
        + '</div>'
        + '</div>'
        + '<div class="sd-count"></div>'
        + '<button class="sd-add" type="button"></button>'
        + `<button class="sd-close" type="button" aria-label="Закрыть"><img src="${ICON_CROSS}" alt="" width="24" height="24" draggable="false"></button>`;
    parentEl.appendChild(scrim);
    parentEl.appendChild(sheet);

    const q = (s) => sheet.querySelector(s);
    const titleEl = q('.sd-title');
    const photoBtn = q('.sd-photo');
    const photoImg = q('.sd-photo-img');
    const nameEl = q('.sd-name');
    const priceEl = q('.sd-price');
    const countEl = q('.sd-count');
    const addBtn = q('.sd-add');
    photoImg.addEventListener('error', () => { photoImg.style.visibility = 'hidden'; });

    let isOpen = false;
    let price = 0;
    let available = 0;   // сколько ещё влезает в заказ
    let count = 0;
    let stepper = false; // false — кнопки 1–6+, true — степпер

    /* ---------- блок количества ---------- */
    function renderCount() {
        if (!stepper) {
            countEl.className = 'sd-count is-options';
            countEl.innerHTML =
                '<div class="sd-count-subtitle">Выберите количество билетов</div>'
                + '<div class="sd-chips">'
                + CHIPS.map((n) => `<button class="sd-chip${n === count ? ' is-active' : ''}" type="button" data-n="${n}"${n > available ? ' disabled' : ''}>${n}</button>`).join('')
                + `<button class="sd-chip" type="button" data-n="more"${available < STEPPER_FROM ? ' disabled' : ''}>6+</button>`
                + '</div>';
        } else {
            const atMax = count >= available;
            countEl.className = 'sd-count is-number' + (atMax ? ' is-warning' : '');
            countEl.innerHTML =
                '<div class="sd-count-text">'
                + '<span class="sd-count-label">Билетов</span>'
                + `<span class="sd-count-limit">${available > 0 ? `Не более ${available}` : 'В заказе уже нет мест'}</span>`
                + '</div>'
                + '<div class="sd-counter">'
                + `<button class="sd-step" type="button" data-step="-1" aria-label="Меньше"${count <= 1 ? ' disabled' : ''}>`
                + `<img src="${ICON_MINUS}" alt="" width="32" height="32" draggable="false">`
                + '</button>'
                + `<span class="sd-count-value">${count}</span>`
                + `<button class="sd-step" type="button" data-step="1" aria-label="Больше"${atMax ? ' disabled' : ''}>`
                + `<img src="${ICON_PLUS}" alt="" width="24" height="24" draggable="false">`
                + '</button>'
                + '</div>';
        }
        renderAdd();
    }

    function renderAdd() {
        addBtn.disabled = count < 1;
        if (count < 1) { addBtn.textContent = 'Добавить'; return; }
        addBtn.innerHTML = `Добавить ${count} ${ticketWord(count)} <span class="sd-dot">•</span> ${formatPrice(count * price)}`;
    }

    countEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.sd-chip');
        if (chip && !chip.disabled) {
            if (chip.dataset.n === 'more') { stepper = true; count = STEPPER_FROM; }
            else count = +chip.dataset.n;
            renderCount();
            return;
        }
        const step = e.target.closest('.sd-step');
        if (step && !step.disabled) {
            count = Math.max(1, Math.min(available, count + +step.dataset.step));
            renderCount();
        }
    });

    addBtn.addEventListener('click', () => {
        if (!isOpen || addBtn.disabled) return;
        const n = count;
        close();
        onAdd(n);
    });

    photoBtn.addEventListener('click', () => { if (isOpen && onPhoto) onPhoto(); });
    q('.sd-close').addEventListener('click', () => close());
    scrim.addEventListener('click', () => close());

    /* ---------- открытие и закрытие ---------- */
    function prepare(opts) {
        price = opts.price || 0;
        available = Math.max(0, opts.available || 0);
        // заказ полон — сразу степпер с нулём: «−», «+» и «Добавить» неактивны, подпись-предупреждение
        stepper = available === 0;
        count = Math.min(START_COUNT, available);
        nameEl.textContent = opts.name || '';
        priceEl.textContent = formatPrice(price);
        const photo = opts.photo || null;
        titleEl.classList.toggle('no-photo', !photo);
        photoBtn.hidden = !photo;
        if (photo) {
            photoImg.alt = photo.caption || '';
            if (photoImg.getAttribute('src') !== photo.url) {
                photoImg.style.visibility = '';
                photoImg.src = photo.url;
            }
        }
        renderCount();
    }

    function show() {
        sheet.style.transform = '';
        sheet.classList.remove('is-dragging');
        scrim.classList.add('is-shown');
        sheet.classList.add('is-open');
        isOpen = true;
    }

    function open(opts) {
        prepare(opts);
        show();
    }

    // высота шторки в px; спрятанная шторка тоже разложена (visibility: hidden), offsetHeight верный
    const height = () => sheet.offsetHeight;

    function close() {
        if (!isOpen) return;
        isOpen = false;
        swipe = null;
        sheet.classList.remove('is-open', 'is-dragging');
        sheet.style.transform = '';   // после свайпа шторка уезжает от того места, где её отпустили
        scrim.classList.remove('is-shown');
    }

    /* ---------- свайп вниз. Захват указателя — только после сдвига на SWIPE_START:
       до этого тапы по кнопкам работают как обычно ---------- */
    let swipe = null;
    let swallowClick = false;   // свайп закончился — click, который браузер пришлёт следом, не нажимает кнопку
    sheet.addEventListener('pointerdown', (e) => {
        if (!isOpen) return;
        swipe = { pid: e.pointerId, y0: e.clientY, dy: 0, t: performance.now(), v: 0, on: false };
    });
    sheet.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.pid) return;
        if (!e.buttons && e.pointerType === 'mouse') { swipe = null; return; }   // кнопку отпустили за пределами шторки
        const dy = Math.max(0, e.clientY - swipe.y0);
        if (!swipe.on) {
            if (dy < SWIPE_START) return;
            swipe.on = true;
            try { sheet.setPointerCapture(e.pointerId); } catch {}
            sheet.classList.add('is-dragging');
        }
        const now = performance.now();
        if (now > swipe.t) swipe.v = (dy - swipe.dy) / (now - swipe.t);
        swipe.dy = dy;
        swipe.t = now;
        sheet.style.transform = `translateY(${dy}px)`;
    });
    function endSwipe(e) {
        if (!swipe || e.pointerId !== swipe.pid) return;
        const s = swipe;
        swipe = null;
        if (!s.on) return;
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 0);
        if (s.dy > SWIPE_CLOSE_PX || s.v > SWIPE_CLOSE_V) { close(); return; }
        sheet.classList.remove('is-dragging');
        sheet.style.transform = '';
    }
    sheet.addEventListener('pointerup', endSwipe);
    sheet.addEventListener('pointercancel', endSwipe);
    // после свайпа click по кнопке под пальцем не должен сработать
    sheet.addEventListener('click', (e) => { if (swallowClick) e.stopPropagation(); }, true);

    return { open, prepare, show, height, close, isOpen: () => isOpen };
}
