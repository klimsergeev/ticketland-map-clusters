/* ============================================================
   Desktop ticket strip (desktop layout of index.html; the mobile ribbon is mobile-ribbon.js).
   Figma Z4wmhHaKhZMV8UI79y1a9Y, node 5181:34021 «[ Hall ] page», strip «Frame 23»; card markup — desktop-ticket-card.js.
     • One card per ticket (seat or dancefloor ticket); gifts are rows inside their ticket's card, not cards.
     • One card is active (232×72 with the photo on the left, 232×64 when it is the only one; its seat marker on the
       scheme is larger), the others are compact 146×64; 8 apart from the strip's left edge. When they do not fit,
       they overlap with an even step so that the row takes the strip width; the active card is on top, then by
       distance from it; a covered card's text ends with an ellipsis at the edge of its visible part.
     • A new ticket becomes the active one. Hover makes a card active (the last hovered card stays active, as in the
       former strip); a ticket with gifts also opens upwards into the focus view (its bottom stays on the strip
       line) while the mouse is on the strip, leaving it closes the card back to the active one.
     • Active and focus views: click on the photo — lightbox; Cross (in the focus view — in the title) — the ticket
       leaves with its gifts; Cross of a gift row — only that gift leaves. A click elsewhere on a card moves the
       scheme to its place.
     • The strip is what the checkout button leaves of the 980 column; refit() re-lays the cards when it changes.
   Motion: card boxes move with a 200 ms decelerating tween, no bounce (views cross-fade with the same CSS curve);
   a new card appears half a card to the right of its place and slides in while fading in, 250 ms; a removed card
   goes down 40 px and fades (240 ms, as on mobile) before the strip closes up.
   ============================================================ */
import { fillTicketCard } from './desktop-ticket-card.js';

const CARD_W = 146;            // compact card
const CARD_H = 64;
const FOCUS_W = 232;           // focus view
const STRIP_W = 768;           // used only while the strip has no size (hidden layout)
const GAP = 8;                 // between cards while they fit
const CARD_TOP = 4;            // compact card top in the 72 strip: the bar line 16 below its top (Figma «Frame 23» py 16)
const CARD_BOTTOM = CARD_TOP + CARD_H;   // the focus view grows upwards from here
const ACTIVE_H = 72;           // active card, Figma 5122:31333
const SINGLE_H = 64;           // the only ticket: Figma «Frame 14» 232×64
const STRIP_H = 72;

// compact card text: Figma paddings 12 / 12; on a partly covered card the text keeps TEXT_GAP from the covering card
const TEXT_PL = 12;
const TEXT_PR = 12;
const TEXT_GAP = 8;

const MOVE_MS = 200;           // boxes of cards that change size or place
const ENTER_MS = 250;          // new card slides in
const ENTER_SHIFT = 0.5;       // new card starts this share of its width to the right of its place
const EXIT_MS = 240;
const EXIT_DY = 40;
const EXIT_EASING = 'cubic-bezier(.4,0,1,1)';

/* cubic-bezier(x1,y1,x2,y2) as in CSS: time share → path share */
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
// decelerating, no overshoot; the same curve is used by the card transitions in desktop.css
const moveEase = cubicBezier(0.2, 0.8, 0.2, 1);

/* Card boxes for n cards, the active one at index a (232 wide), open (focus view, focusH high) or not, in a strip
   stripW wide. Step between card starts: card width + GAP while the row fits, else the even step (whole px) that
   makes the row exactly stripW; cards right of the active one are shifted by its extra width */
function layout(n, a, open, stripW, focusH) {
    const rowExtra = a >= 0 ? FOCUS_W : CARD_W;
    const s = n > 1 ? Math.min(CARD_W + GAP, Math.floor((stripW - rowExtra) / (n - 1))) : 0;
    return Array.from({ length: n }, (_, k) => {
        if (k === a) {
            if (open) return { x: k * s, y: CARD_BOTTOM - focusH, w: FOCUS_W, h: focusH };
            const h = n === 1 ? SINGLE_H : ACTIVE_H;
            return { x: k * s, y: (STRIP_H - h) / 2, w: FOCUS_W, h };
        }
        return { x: k * s + (a >= 0 && k > a ? FOCUS_W - CARD_W : 0), y: CARD_TOP, w: CARD_W, h: CARD_H };
    });
}

/* Stacking: the active card on top, then by distance from it */
const zOf = (k, a) => (a >= 0 ? 100 - Math.abs(k - a) : 100 - k);

/* parentEl — the checkout bar column, the strip goes first in it;
   getPhoto(entry) → { url, thumb } | null; getGifts(entry) → its gifts (order entries);
   onRemove(entry) — a cross removed a ticket or a gift; returns entries that leave with it (gifts of a ticket);
   onFocus(entry) — a click on a card; onPhoto(entry) — a click on the photo of the open card;
   onActive(entry | null) — the open card changed (its seat marker is larger) */
export function createDesktopStrip({ parentEl, getPhoto, getGifts, onRemove, onFocus, onPhoto, onActive }) {
    const root = document.createElement('div');
    root.className = 'd-strip';
    parentEl.prepend(root);

    const items = [];          // { entry, el, cur: { x, y, w, h, op } } — tickets only
    let activeItem = null;     // active card
    let open = false;          // the mouse is on the strip: the active card shows the focus view if it has gifts
    let raf = 0;               // running layout tween
    let deleting = false;
    let lastActive = null;     // entry last reported to onActive
    let laidW = 0;             // strip width the current layout was made for
    const stripW = () => root.clientWidth || STRIP_W;
    const activeIndex = () => items.indexOf(activeItem);
    const isTicket = (entry) => entry && entry.kind !== 'extra';
    const isOpen = () => open && !!activeItem && getGifts(activeItem.entry).length > 0;

    function fill(item) {
        const { entry, el } = item;
        fillTicketCard(el, entry, getGifts(entry), getPhoto(entry));   // shared card markup (desktop-ticket-card.js)
        // Cross of the focus view (open) or of the active view (closed)
        el.querySelectorAll('.ds-x, .ds-ax').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (deleting || item !== activeItem || btn.classList.contains('ds-x') !== isOpen()) return;
                removeWithExit(items.indexOf(item));
            });
        });
        el.querySelectorAll('.ds-gx').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (deleting || item !== activeItem || !isOpen()) return;
                const gift = getGifts(entry)[+btn.dataset.gift];
                if (!gift) return;
                onRemove(gift);
                fill(item);          // rows, price and badge without the gift; the open card gets shorter
                relayout();
            });
        });
    }

    function paint() {
        const a = activeIndex();
        items.forEach((it, k) => {
            const { x, y, w, h, op } = it.cur;
            it.el.style.transform = `translate(${x}px, ${y}px)`;
            it.el.style.width = `${w}px`;
            it.el.style.height = `${h}px`;
            it.el.style.opacity = op >= 1 ? '' : String(op);
            it.el.style.zIndex = String(zOf(k, a));
            it.el.classList.toggle('is-active', k === a);
            it.el.classList.toggle('is-open', k === a && isOpen());
        });
        items.forEach((it, k) => fitText(it, k, a));
    }

    /* Text of a compact card ends with an ellipsis at the edge of its visible part: a neighbour higher in the stack
       covers it from that side */
    function fitText(it, k, a) {
        const t = it.el.querySelector('.ds-text');
        if (!t) return;
        if (k === a) { t.style.paddingLeft = ''; t.style.paddingRight = ''; return; }
        const c = it.cur;
        let leftCover = 0;
        let rightCover = 0;
        const z = zOf(k, a);
        if (items[k - 1] && zOf(k - 1, a) > z) {
            const p = items[k - 1].cur;
            leftCover = Math.min(c.w, Math.max(0, p.x + p.w - c.x));
        }
        if (items[k + 1] && zOf(k + 1, a) > z) {
            const q = items[k + 1].cur;
            rightCover = Math.min(c.w, Math.max(0, c.x + c.w - q.x));
        }
        t.style.paddingLeft = `${leftCover > 0 ? leftCover + TEXT_GAP : TEXT_PL}px`;
        t.style.paddingRight = `${rightCover > 0 ? rightCover + TEXT_GAP : TEXT_PR}px`;
    }

    // natural height of the open card's focus view (photo, title, gift rows)
    const focusHeight = (item) => (item ? item.el.querySelector('.ds-focus').offsetHeight : 0);

    /* Move every card from where it is now to the layout for the current open card.
       entering — new cards, which start half their width to the right of their place, transparent */
    function relayout(entering = []) {
        cancelAnimationFrame(raf);
        // every change of the open card goes through here: report it once
        const activeEntry = activeItem ? activeItem.entry : null;
        if (activeEntry !== lastActive) {
            lastActive = activeEntry;
            if (onActive) onActive(activeEntry);
        }
        const n = items.length;
        if (!n) { paint(); return; }
        laidW = stripW();
        const target = layout(n, activeIndex(), isOpen(), laidW, isOpen() ? focusHeight(activeItem) : 0);
        const tracks = items.map((it, k) => {
            const to = target[k];
            if (entering.includes(it)) {
                return { it, to, from: { ...to, x: to.x + to.w * ENTER_SHIFT, op: 0 }, ms: ENTER_MS };
            }
            return { it, to, from: { ...it.cur }, ms: MOVE_MS };
        });
        const t0 = performance.now();
        const step = (now) => {
            let running = false;
            tracks.forEach(({ it, from, to, ms }) => {
                const t = Math.min(1, (now - t0) / ms);
                if (t < 1) running = true;
                const k = moveEase(t);
                it.cur = {
                    x: from.x + (to.x - from.x) * k,
                    y: from.y + (to.y - from.y) * k,
                    w: from.w + (to.w - from.w) * k,
                    h: from.h + (to.h - from.h) * k,
                    op: from.op + (1 - from.op) * k,
                };
            });
            paint();
            if (running) raf = requestAnimationFrame(step);
        };
        step(t0);
    }

    /* Hover makes a card active and opens it; leaving the strip closes it, it stays active; the scheme does not move */
    function hover(item) {
        if (deleting || (item === activeItem && open)) return;
        activeItem = item;
        open = true;
        relayout();
    }
    // the open card sticks out above the strip but is its child: leaving it upwards leaves the strip too
    root.addEventListener('pointerleave', () => {
        if (deleting || !open) return;
        open = false;
        relayout();
    });

    /* Card element for a ticket, with hover (open) and click (photo of the open card — lightbox, else — focus) */
    function makeItem(entry) {
        const el = document.createElement('div');
        el.className = 'ds-card';
        const item = { entry, el, cur: { x: 0, y: CARD_TOP, w: CARD_W, h: CARD_H, op: 0 } };
        fill(item);
        el.addEventListener('pointerenter', () => hover(item));
        el.addEventListener('click', (e) => {
            if (deleting) return;
            const photoHit = isOpen() ? e.target.closest('.ds-photo') : e.target.closest('.ds-aphoto');
            if (photoHit && item === activeItem) { if (onPhoto) onPhoto(item.entry); return; }
            onFocus(item.entry);
        });
        root.appendChild(el);
        return item;
    }

    // the card of an entry; a gift stands for its ticket
    const itemOf = (entry) => items.find((it) => it.entry === entry || (entry && it.entry === entry.parent)) || null;

    /* New entries: tickets become cards at the end of the strip, gifts come with their ticket;
       activeEntry (default: the last new ticket) becomes the active card, closed */
    function add(entries, activeEntry) {
        const list = (Array.isArray(entries) ? entries : [entries]).filter(isTicket);
        if (!list.length) return;
        if (deleting && exitDone) exitDone();
        const added = list.map((entry) => {
            const item = makeItem(entry);
            items.push(item);
            return item;
        });
        activeItem = itemOf(activeEntry) || added[added.length - 1];
        open = false;
        relayout(added);
    }

    /* The active card left: its place in the row stays active (the next card, or the last one), as on mobile */
    function dropAt(i) {
        const [it] = items.splice(i, 1);
        it.el.remove();
        if (it === activeItem) {
            activeItem = items[Math.min(i, items.length - 1)] || null;
            open = false;
        }
        return it;
    }

    /* Repeated click on the seat (with its gifts): the card disappears at once, the strip closes up */
    function remove(entries) {
        const list = Array.isArray(entries) ? entries : [entries];
        if (deleting && exitDone) exitDone();
        list.forEach((entry) => {
            const i = items.findIndex((it) => it.entry === entry);
            if (i !== -1) dropAt(i);
        });
        relayout();
    }

    /* Cross in the open card's title: the card goes down and fades with its gifts, then the strip closes up */
    let exitDone = null;
    function removeWithExit(i) {
        deleting = true;
        cancelAnimationFrame(raf);
        const it = items[i];
        onRemove(it.entry);   // the ticket and its gifts leave the order
        const clone = it.el.cloneNode(true);
        clone.classList.add('ds-exit');
        clone.style.zIndex = '0';
        clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASING}, opacity ${EXIT_MS}ms ${EXIT_EASING}`;
        root.appendChild(clone);
        it.el.style.visibility = 'hidden';
        void root.offsetWidth;
        let gone = false;
        exitDone = () => {
            if (gone) return;
            gone = true;
            exitDone = null;
            clone.remove();
            const k = items.indexOf(it);
            if (k !== -1) dropAt(k);   // the next card is active, closed: it opens on the next mouse move
            deleting = false;
            relayout();
        };
        clone.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity' && exitDone) exitDone(); });
        setTimeout(() => { if (exitDone) exitDone(); }, EXIT_MS + 120);
        clone.style.transform = `translate(${it.cur.x}px, ${it.cur.y + EXIT_DY}px)`;
        clone.style.opacity = '0';
    }

    /* The page switched to the desktop layout: cards built from the order at once, activeEntry's card active
       (default: the last), closed, no animation */
    function reset(entries, activeEntry) {
        if (deleting && exitDone) exitDone();
        cancelAnimationFrame(raf);
        items.splice(0).forEach((it) => it.el.remove());
        root.querySelectorAll('.ds-exit').forEach((c) => c.remove());
        entries.filter(isTicket).forEach((entry) => items.push(makeItem(entry)));
        activeItem = itemOf(activeEntry) || items[items.length - 1] || null;
        open = false;
        lastActive = activeItem ? activeItem.entry : null;
        laidW = stripW();
        const target = layout(items.length, activeIndex(), false, laidW, 0);
        items.forEach((it, k) => { it.cur = { ...target[k], op: 1 }; });
        paint();
    }

    /* The strip width changed (the checkout button got wider or narrower with the sum): cards move to the
       layout for the new width. During a removal the layout after it reads the width anyway */
    function refit() {
        if (deleting || !items.length || stripW() === laidW) return;
        relayout();
    }

    /* Refill cards after section photos arrive */
    function refresh() {
        items.forEach(fill);
        paint();
    }

    return {
        add,
        remove,
        reset,
        refit,
        refresh,
        activeEntry: () => (activeItem ? activeItem.entry : null),
    };
}
