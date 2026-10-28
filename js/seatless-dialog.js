/* ============================================================
   Диалог «билет без места» (танцпол) — Citrus «Dialog / Mobile» с «.tickets-count-citrus»
   (файл Z4wmhHaKhZMV8UI79y1a9Y, компоненты 4987:23457 и 4983:17370, экраны 4983:20794 и 4983:20856).
   Шторка снизу над затемнением: название и подпись, справа крестик; строка количества — «N билетов» и сумма
   слева, степпер «− N +» справа; кнопка «Добавить в корзину». Фото в шапке в Citrus нет — спрятано флагом SHOW_PHOTO.
   Стили — css/seatless.css.

   createSeatlessDialog({ parentEl, onAdd, onPhoto, onClose }) → { open, prepare, show, height, close, isOpen }
     open(opts) = prepare(opts) + show(). prepare заполняет шторку, не показывая её, — после этого height()
       даёт её высоту в px (схема заранее приближается так, чтобы танцпол встал над шторкой);
     opts = { name, price, photo, left, available } — photo { url, caption } или null; left — остаток билетов
       на танцпол в продаже (подпись под названием: «23 билета», при 0 — «Билетов нет»); available — сколько ещё
       можно положить в заказ (лимит заказа минус уже лежащее), 0 — заказ полон. Выбрать можно не больше
       меньшего из left и available;
     onAdd(count) — «Добавить в корзину»: диалог уже закрывается, вызывающий кладёт count билетов в заказ;
     onPhoto() — тап по фото (только если SHOW_PHOTO);
     onClose() — шторка закрылась любым способом (крестик, затемнение, свайп, «Добавить» — до onAdd).
   ============================================================ */
import { formatPrice } from './data.js';
import { createBottomSheet } from './bottom-sheet.js';

// иконки Citrus 24, #1D2023 — экспорт макета
const ICON_MINUS = 'assets/dialog-minus-citrus-24.svg';
const ICON_PLUS = 'assets/dialog-plus-citrus-24.svg';
const ICON_CLOSE = 'assets/dialog-close-24.svg';
const ICON_SEARCH = 'assets/dialog-search-24.svg';    // лупа на фото шапки (фото спрятано)

// Фото танцпола в шапке шторки: в Citrus его нет. true — вернуть фото с лупой (тап открывает лайтбокс)
const SHOW_PHOTO = false;

const START_COUNT = 1;           // при открытии выбран 1 билет, как в Citrus (4987:23457)

export function ticketWord(n) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return 'билет';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'билета';
    return 'билетов';
}

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSeatlessDialog({ parentEl, onAdd, onPhoto, onClose }) {
    // шторка, затемнение и свайп вниз — общая основа (js/bottom-sheet.js)
    const bs = createBottomSheet({ parentEl, label: 'Билеты без места', onClose });
    const { sheet, show, close, height } = bs;
    sheet.innerHTML =
        (SHOW_PHOTO
            ? '<button class="sd-photo" type="button" aria-label="Открыть фото">'
              + '<img class="sd-photo-img" alt="" draggable="false">'
              + `<span class="sd-zoom" aria-hidden="true"><img src="${ICON_SEARCH}" alt="" width="24" height="24" draggable="false"></span>`
              + '</button>'
            : '')
        + '<div class="sd-title">'
        + '<div class="sd-title-text"><span class="sd-name"></span><span class="sd-kind"></span></div>'
        + `<button class="sd-close" type="button" aria-label="Закрыть"><img src="${ICON_CLOSE}" alt="" width="24" height="24" draggable="false"></button>`
        + '</div>'
        + '<div class="sd-body"><div class="sd-count"></div></div>'
        + '<div class="sd-buttons"><button class="sd-add" type="button">Добавить в корзину</button></div>';

    const q = (s) => sheet.querySelector(s);
    const photoBtn = q('.sd-photo');
    const photoImg = q('.sd-photo-img');
    const nameEl = q('.sd-name');
    const kindEl = q('.sd-kind');
    const countEl = q('.sd-count');
    const addBtn = q('.sd-add');
    if (photoImg) photoImg.addEventListener('error', () => { photoImg.style.visibility = 'hidden'; });

    let price = 0;
    let available = 0;   // сколько можно выбрать: меньшее из остатка танцпола и места в заказе
    let soldOut = false; // остаток танцпола 0
    let count = 0;

    /* ---------- строка количества «Counter»: слева «N билетов» и сумма, справа «− N +» ----------
       Билетов нет (остаток 0): «0 билетов» и 0 ₽, степпер и кнопка неактивны.
       Заказ полон (8 в заказе): вместо «N билетов» — «В заказе уже нет мест», степпер и кнопка неактивны */
    function renderCount() {
        const atMax = count >= available;
        countEl.innerHTML =
            '<div class="sd-count-text">'
            + `<span class="sd-count-label">${available > 0 || soldOut ? `${count} ${ticketWord(count)}` : 'В заказе уже нет мест'}</span>`
            + `<span class="sd-count-sum">${esc(formatPrice(count * price))}</span>`
            + '</div>'
            + '<div class="sd-counter">'
            + `<button class="sd-step" type="button" data-step="-1" aria-label="Меньше"${count <= 1 ? ' disabled' : ''}>`
            + `<img src="${ICON_MINUS}" alt="" width="24" height="24" draggable="false">`
            + '</button>'
            + `<span class="sd-count-value">${count}</span>`
            + `<button class="sd-step" type="button" data-step="1" aria-label="Больше"${atMax ? ' disabled' : ''}>`
            + `<img src="${ICON_PLUS}" alt="" width="24" height="24" draggable="false">`
            + '</button>'
            + '</div>';
        addBtn.disabled = count < 1;
    }

    countEl.addEventListener('click', (e) => {
        const step = e.target.closest('.sd-step');
        if (step && !step.disabled) {
            count = Math.max(1, Math.min(available, count + +step.dataset.step));
            renderCount();
        }
    });

    addBtn.addEventListener('click', () => {
        if (!bs.isOpen() || addBtn.disabled) return;
        const n = count;
        close();
        onAdd(n);
    });

    if (photoBtn) photoBtn.addEventListener('click', () => { if (bs.isOpen() && onPhoto) onPhoto(); });
    q('.sd-close').addEventListener('click', () => close());

    /* ---------- открытие и закрытие ---------- */
    function prepare(opts) {
        price = opts.price || 0;
        const left = Math.max(0, opts.left ?? Infinity);
        soldOut = left === 0;
        available = Math.max(0, Math.min(left, opts.available || 0));
        kindEl.textContent = soldOut ? 'Билетов нет' : `${left} ${ticketWord(left)}`;
        count = Math.min(START_COUNT, available);   // заказ полон — 0: «−», «+» и «Добавить» неактивны
        nameEl.textContent = opts.name || '';
        const photo = opts.photo || null;
        if (photoBtn) photoBtn.hidden = !photo;
        if (photoBtn && photo) {
            photoImg.alt = photo.caption || '';
            if (photoImg.getAttribute('src') !== photo.url) {
                photoImg.style.visibility = '';
                photoImg.src = photo.url;
            }
        }
        renderCount();
    }

    function open(opts) {
        prepare(opts);
        show();
    }

    return { open, prepare, show, height, close, isOpen: bs.isOpen };
}
