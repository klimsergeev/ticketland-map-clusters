/* ============================================================
   Desktop ticket card markup for the desktop strip (desktop-strip.js); styles .ds-* in css/desktop.css.
   Figma Z4wmhHaKhZMV8UI79y1a9Y, node 5181:34021 «[ Hall ] page» (strip «Frame 23»).
   One card per ticket — a seat or a dancefloor ticket { kind: 'seatless' }; gifts { kind: 'extra', parent }
   are not cards, they are rows of their ticket's focus view. A card holds three views:
     • compact 146×64 (.ds-compact): name, row and seat (seat only), price — the ticket with its gifts;
       with gifts a badge «N 🎟» in the top right corner, N = the ticket and its gifts;
     • active 232×72 (.ds-active, the card of the active ticket; as the former strip, Figma 5122:31333):
       section photo on the left with Search 24, the same lines; Cross 16 in the top right corner, or the badge
       there for a ticket with gifts (it leaves only by the Cross of its focus view);
     • focus 232 wide (.ds-focus, shown on hover, only for a ticket with gifts): section photo 232×172 with Search 16,
       name and row and seat («Билет без места» for the dancefloor), the ticket's own price (without gifts) and Cross 16,
       then a row per gift: name, its price, Cross 16.
   ============================================================ */
import { formatPrice } from './data.js';

export const ICON_SEARCH = 'assets/ticket-search-16.svg';   // Figma «Search» 16, white
export const ICON_SEARCH_24 = 'assets/ticket-search-24.svg'; // active view, as the former strip
export const ICON_CROSS = 'assets/strip-cross-16.svg';      // Figma «Cross» 16, #8D969F
export const ICON_TICKET = 'assets/strip-ticket-16.svg';    // Figma «Ticket» 16, #FF0032

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const seatLine = (entry) => `Ряд ${entry.row} место ${entry.seat}`;
const nameOf = (entry) => (entry.kind === 'seatless' ? entry.name : entry.section);

/* Price of a ticket together with its gifts */
export function totalOf(entry, gifts) {
    return gifts.reduce((sum, g) => sum + (Number(g.price) || 0), Number(entry.price) || 0);
}

const crossButton = (cls, label, extra = '') => `<button class="${cls}" type="button" aria-label="${label}"${extra}>`
    + `<img src="${ICON_CROSS}" alt="" width="16" height="16" draggable="false"></button>`;

/* Inner markup of a card for a ticket, its gifts (order entries) and its section photo */
export function ticketCardInner(entry, gifts, photo) {
    const total = formatPrice(totalOf(entry, gifts));
    const compactLines = entry.kind === 'seatless' ? [nameOf(entry), total] : [nameOf(entry), seatLine(entry), total];
    const lines = (cls) => `<span class="${cls}">`
        + compactLines.map((t, i) => `<span class="ds-line${i === 0 ? ' ds-title' : ''}">${esc(t)}</span>`).join('')
        + '</span>';
    const badge = gifts.length
        ? `<span class="ds-badge"><span class="ds-badge-n">${gifts.length + 1}</span>`
            + `<img src="${ICON_TICKET}" alt="" width="16" height="16" draggable="false"></span>`
        : '';
    const compact = '<span class="ds-compact">' + lines('ds-text') + badge + '</span>';
    // a ticket with gifts shows the active view only at rest (a hover opens the focus view), the badge instead of
    // the cross; without gifts the active view is the hovered one: click on the photo — lightbox, Cross — the ticket leaves
    const active = '<span class="ds-active">'
        + (photo
            ? '<span class="ds-aphoto">'
                + `<img class="ds-aphoto-img" src="${esc(photo.thumb || photo.url)}" alt="" draggable="false">`
                + `<span class="ds-azoom"><img src="${ICON_SEARCH_24}" alt="" width="24" height="24" draggable="false"></span>`
                + '</span>'
            : '')
        + lines('ds-atext')
        + (gifts.length ? badge : crossButton('ds-ax', 'Убрать билет'))
        + '</span>';
    const focus = '<span class="ds-focus">'
        + (photo
            ? '<span class="ds-photo">'
                + `<img class="ds-photo-img" src="${esc(photo.url || photo.thumb)}" alt="" draggable="false">`
                + `<span class="ds-zoom" aria-hidden="true"><img src="${ICON_SEARCH}" alt="" width="16" height="16" draggable="false"></span>`
                + '</span>'
            : '')
        + '<span class="ds-head">'
        + '<span class="ds-head-title">'
        + `<span class="ds-name">${esc(nameOf(entry))}</span>`
        + `<span class="ds-sub">${esc(entry.kind === 'seatless' ? 'Билет без места' : seatLine(entry))}</span>`
        + '</span>'
        + `<span class="ds-price">${esc(formatPrice(entry.price))}</span>`   // the gifts have their own rows below
        + crossButton('ds-x', 'Убрать билет')
        + '</span>'
        + (gifts.length
            ? '<span class="ds-gifts">'
                + gifts.map((g, i) => '<span class="ds-gift">'
                    + `<span class="ds-gift-name">${esc(g.name)}</span>`
                    + `<span class="ds-gift-price">${esc(formatPrice(g.price))}</span>`
                    + crossButton('ds-gx', 'Убрать подарок', ` data-gift="${i}"`)
                    + '</span>').join('')
                + '</span>'
            : '')
        + '</span>';
    return compact + active + focus;
}

/* Fill a card element */
export function fillTicketCard(el, entry, gifts, photo) {
    el.classList.toggle('has-photo', !!photo);
    el.classList.toggle('has-gifts', gifts.length > 0);
    el.dataset.kind = entry.kind || 'seat';
    el.innerHTML = ticketCardInner(entry, gifts, photo);
    // a broken photo falls back to the other size, then to empty
    el.querySelectorAll('.ds-photo-img, .ds-aphoto-img').forEach((img) => {
        img.addEventListener('error', () => {
            const other = img.getAttribute('src') === photo.url ? photo.thumb : photo.url;
            if (other && img.getAttribute('src') !== other) img.src = other;
            else img.style.visibility = 'hidden';
        });
    });
}
