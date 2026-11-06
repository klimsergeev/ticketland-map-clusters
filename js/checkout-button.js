/* ============================================================
   Checkout button «Оформить заказ» with the order sum on a tag, for both layouts (mobile .floating .cta, desktop .d-cta).
   Figma Z4wmhHaKhZMV8UI79y1a9Y «Скидки на заказ»: mobile 7203:36116 (discount), 7203:36600 (long price),
   desktop 7203:37466, 7203:38806; styles .cta-* in css/hall-common.css.
     • Label «Оформить заказ», shortened to «Оформить» when it does not fit next to the tag (then ellipsis).
     • Tag: the order sum; with a discount the full sum struck through and the sum to pay next to it.
     • Discount: DISCOUNT_RATE of every ticket in DISCOUNT_SECTION (not gifts, not the dancefloor), rounded to a rouble;
       ticket prices on the cards stay as they are.
   createCheckoutButton(btnEl, { hug, onRender }) → { render(order) }:
     hug — the button is as wide as its content with the short label, not less than its min-width (desktop);
       otherwise its width comes from the layout (mobile);
     onRender() — after every fill, including the refit when the font arrives (the desktop strip takes the rest).
     render() only fills the button; showing and hiding is the caller's. A hidden button (no size) is filled without fitting the label: render it again once shown.
   ============================================================ */

export const DISCOUNT_SECTION = 'Балкон';
export const DISCOUNT_RATE = 0.1;
const LABEL_FULL = 'Оформить заказ';
const LABEL_SHORT = 'Оформить';
const STRIKE = 'assets/checkout-strike.svg';   // Figma «Strikethrough», white line corner to corner

const num = (n) => n.toLocaleString('ru-RU');

/* Order sums: total — all entries; discount — DISCOUNT_RATE of the tickets in DISCOUNT_SECTION; pay — total − discount */
export function orderTotals(order) {
    let total = 0;
    let base = 0;
    order.forEach((item) => {
        const price = Number(item.price) || 0;
        total += price;
        if (item.kind !== 'extra' && item.kind !== 'seatless' && item.section === DISCOUNT_SECTION) base += price;
    });
    const discount = Math.round(base * DISCOUNT_RATE);
    return { total, discount, pay: total - discount };
}

export function createCheckoutButton(btnEl, { hug = false, onRender = null } = {}) {
    btnEl.innerHTML = '<span class="cta-content">'
        + '<span class="cta-label"></span>'
        + '<span class="cta-tag">'
        + `<span class="cta-old"><span class="cta-old-num"></span><img class="cta-strike" src="${STRIKE}" alt="" draggable="false"></span>`
        + '<span class="cta-sum"><span class="cta-sum-num"></span><span class="cta-rub">₽</span></span>'
        + '</span>'
        + '</span>';
    const labelEl = btnEl.querySelector('.cta-label');
    const oldEl = btnEl.querySelector('.cta-old');
    const oldNumEl = btnEl.querySelector('.cta-old-num');
    const sumNumEl = btnEl.querySelector('.cta-sum-num');
    let lastOrder = null;

    function render(order) {
        lastOrder = order;
        const { total, discount, pay } = orderTotals(order);
        oldEl.hidden = discount <= 0;
        oldNumEl.textContent = num(total);
        sumNumEl.textContent = num(pay);
        btnEl.setAttribute('aria-label', `${LABEL_FULL}, ${num(pay)} ₽`);
        // the label: full if it fits next to the tag, else short
        labelEl.textContent = LABEL_SHORT;
        if (hug) {
            btnEl.style.width = '';
            const w = btnEl.offsetWidth;   // natural width with the short label, at least min-width
            if (w) btnEl.style.width = `${w}px`;
        }
        labelEl.textContent = LABEL_FULL;
        if (labelEl.scrollWidth > labelEl.clientWidth) labelEl.textContent = LABEL_SHORT;
        if (onRender) onRender();
    }

    // MTS Compact may arrive after the first fit: fit again with the real glyph widths
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (lastOrder) render(lastOrder); });

    return { render };
}
