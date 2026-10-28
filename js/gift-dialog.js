/* ============================================================
   Шторка «Подарки к вашему билету» — Citrus «Dialog / Mobile» с «.tickets-count-citrus» Gift=True
   (файл Z4wmhHaKhZMV8UI79y1a9Y, экраны 4983:18887 — 0 подарков и 4983:21004 — 3 подарка).
   Открывается тапом по свободному месту амфитеатра, до того как место попадёт в заказ.
   Внутри: строка билета (часть зала, ряд, место и цена), строка «Подарок» с суммой и счётчиком «− N +»,
   кнопка «Добавить в корзину». Шторка, затемнение и свайп — общая основа (js/bottom-sheet.js),
   стили — css/seatless.css.

   createGiftDialog({ parentEl, onAdd, onClose }) → { open, height, close, isOpen }
     open({ place, price, giftPrice, available }) — place «Амфитеатр, ряд 5, место 14», price — цена билета,
       giftPrice — цена подарка, available — сколько подарков можно взять к этому билету (0 — нельзя ни одного);
     onAdd(count) — «Добавить в корзину»: шторка уже закрывается, вызывающий кладёт билет и count подарков;
     onClose() — шторка закрылась любым способом (для «Добавить в корзину» — до onAdd).
   ============================================================ */
import { formatPrice } from './data.js';
import { createBottomSheet } from './bottom-sheet.js';
import { esc } from './seatless-dialog.js';

const ICON_CLOSE = 'assets/dialog-close-24.svg';   // Cross 24 #1D2023 — экспорт макета

export function createGiftDialog({ parentEl, onAdd, onClose }) {
    const bs = createBottomSheet({ parentEl, label: 'Подарки к вашему билету', onClose });
    const { sheet, close, height } = bs;
    sheet.classList.add('gd-sheet');
    sheet.innerHTML =
        '<div class="sd-title">'
        + '<div class="sd-title-text"><span class="sd-name">Подарки к вашему билету</span>'
        + '<span class="sd-kind">Можно добавить подарки или продолжить без них</span></div>'
        + `<button class="sd-close" type="button" aria-label="Закрыть"><img src="${ICON_CLOSE}" alt="" width="24" height="24" draggable="false"></button>`
        + '</div>'
        + '<div class="sd-body gd-body">'
        + '<div class="gd-ticket"><span class="gd-place"></span><span class="gd-price"></span></div>'
        + '<div class="sd-count gd-count"></div>'
        + '</div>'
        + '<div class="sd-buttons"><button class="sd-add" type="button">Добавить в корзину</button></div>';

    const q = (s) => sheet.querySelector(s);
    const placeEl = q('.gd-place');
    const priceEl = q('.gd-price');
    const countEl = q('.gd-count');
    const addBtn = q('.sd-add');

    let giftPrice = 0;
    let available = 0;   // сколько подарков ещё можно взять к этому билету
    let count = 0;

    /* Строка «Подарок»: слева подпись и сумма (количество × цена подарка), справа «− N +».
       Подарков взять уже нельзя (в заказе их предел) — вместо «Подарок» подпись «В заказе уже 5 подарков»,
       оба шага неактивны; билет добавить можно */
    function renderCount() {
        countEl.innerHTML =
            '<div class="sd-count-text">'
            + `<span class="sd-count-label">${available > 0 ? 'Подарок' : esc(noRoomText)}</span>`
            + `<span class="sd-count-sum">${esc(formatPrice(count * giftPrice))}</span>`
            + '</div>'
            + '<div class="sd-counter">'
            + `<button class="sd-step gd-step" type="button" data-step="-1" aria-label="Меньше"${count <= 0 ? ' disabled' : ''}>`
            + '<span class="gd-ico gd-ico-minus" aria-hidden="true"></span></button>'
            + `<span class="sd-count-value">${count}</span>`
            + `<button class="sd-step gd-step" type="button" data-step="1" aria-label="Больше"${count >= available ? ' disabled' : ''}>`
            + '<span class="gd-ico gd-ico-plus" aria-hidden="true"></span></button>'
            + '</div>';
    }
    let noRoomText = '';

    countEl.addEventListener('click', (e) => {
        const step = e.target.closest('.sd-step');
        if (step && !step.disabled) {
            count = Math.max(0, Math.min(available, count + +step.dataset.step));
            renderCount();
        }
    });

    addBtn.addEventListener('click', () => {
        if (!bs.isOpen()) return;
        const n = count;
        close();
        onAdd(n);
    });
    q('.sd-close').addEventListener('click', () => close());

    function open(opts) {
        giftPrice = opts.giftPrice || 0;
        available = Math.max(0, opts.available || 0);
        noRoomText = opts.noRoomText || '';
        count = 0;                                 // счётчик стартует с 0, как в макете
        placeEl.textContent = opts.place || '';
        priceEl.textContent = formatPrice(opts.price || 0);
        renderCount();
        bs.show();
    }

    return { open, height, close, isOpen: bs.isOpen };
}
