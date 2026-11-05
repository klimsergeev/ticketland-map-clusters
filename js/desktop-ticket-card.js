/* ============================================================
   Desktop ticket card markup for the desktop strip (desktop-strip.js).
   Figma Z4wmhHaKhZMV8UI79y1a9Y «Ticket preview / citrus», Breakpoint=Desktop; styles .ds-card in css/desktop.css
   (active state .is-active: 232×72, photo, three lines, cross, Shadows/High).
   Order entries, as the mobile ribbon: seat (part, row and seat, price), seatless ticket { kind: 'seatless' } (name, price),
   gift { kind: 'extra' } (name, its ticket, price; never a photo).
   ============================================================ */
import { formatPrice } from './data.js';

export const ICON_SEARCH = 'assets/ticket-search-24.svg';
export const ICON_CROSS = 'assets/strip-cross-16.svg';

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Card lines for an order entry — same texts as the mobile ribbon (ticketView in mobile-ribbon.js) */
export function linesOf(entry) {
    if (entry.kind === 'seatless') return [entry.name, formatPrice(entry.price)];
    if (entry.kind === 'extra') return [entry.name, entry.sort, formatPrice(entry.price)];
    return [entry.section, `Ряд ${entry.row} место ${entry.seat}`, formatPrice(entry.price)];
}

/* Inner markup of a card: photo with Search 24 (only with a photo), lines, Cross 16 */
export function ticketCardInner(entry, photo) {
    return (photo
        ? '<span class="ds-photo">'
            + `<img class="ds-photo-img" src="${esc(photo.thumb || photo.url)}" alt="" draggable="false">`
            + `<span class="ds-zoom" aria-hidden="true"><img src="${ICON_SEARCH}" alt="" width="24" height="24" draggable="false"></span>`
            + '</span>'
        : '')
        + '<span class="ds-text">'
        + linesOf(entry).map((t, i) => `<span class="ds-line${i === 0 ? ' ds-title' : ''}">${esc(t)}</span>`).join('')
        + '</span>'
        + `<button class="ds-x" type="button" aria-label="Убрать"><img src="${ICON_CROSS}" alt="" width="16" height="16" draggable="false"></button>`;
}

/* Fill a card element: kind, photo class, markup; a broken thumbnail falls back to the full photo, then to empty */
export function fillTicketCard(el, entry, photo) {
    el.classList.toggle('has-photo', !!photo);
    el.dataset.kind = entry.kind || 'seat';
    el.innerHTML = ticketCardInner(entry, photo);
    const img = el.querySelector('.ds-photo-img');
    if (img) {
        img.addEventListener('error', () => {
            if (photo.thumb && img.getAttribute('src') !== photo.url) img.src = photo.url;
            else img.style.visibility = 'hidden';
        });
    }
}
