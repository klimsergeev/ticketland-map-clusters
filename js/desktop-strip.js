/* ============================================================
   Desktop ticket strip (desktop layout of index.html; the mobile ribbon is mobile-ribbon.js).
   Figma Z4wmhHaKhZMV8UI79y1a9Y, node 5122:31333 «Ticket preview / citrus», Breakpoint=Desktop:
     • active card 232×72 (232×64 when it is the only one): photo, lines, cross;
     • three kinds of order entries, as in the mobile ribbon: seat (part, row and seat, price),
       seatless ticket { kind: 'seatless' } (name, price), gift { kind: 'extra' } (name, its ticket, price; never a photo);
     • other cards 146×64, text only;
     • the strip is «Frame 19» of «Checkout form» (Figma 5180:33882): what the checkout button leaves of the
       980 column (768 next to the 196 button); cards from its left edge, 8 apart while they fit, then overlapping
       with an even step so that the whole row takes the strip width (768: 5 cards — step 134, 7 — 89).
       The layout uses the strip's actual width; refit() re-lays the cards when it changes.
   Hover makes a card active in its own place, cards to its right move right. The last hovered card
   stays active. A click on the active card's photo opens the lightbox, a click elsewhere on a card moves
   the scheme to its seat.
   Motion: card boxes move with a 200 ms decelerating tween, no bounce (photo, padding, cross and
   shadow follow with the same CSS transition); a new card appears half a card to the right of its
   place and slides in while fading in, 250 ms; the removed card goes down 40 px and fades
   (240 ms, as on mobile) before the strip closes up.
   ============================================================ */
import { fillTicketCard } from './desktop-ticket-card.js';

const CARD_W = 146;            // inactive card
const CARD_H = 64;
const ACTIVE_W = 232;          // active card
const ACTIVE_H = 72;
const SINGLE_H = 64;           // the only ticket: Figma «Frame 14» 232×64
const STRIP_H = 72;
const STRIP_W = 768;           // Figma 5180:33882 «Frame 19»; used only while the strip has no size (hidden layout)
const GAP = 8;                 // between cards while they fit

// inactive card text: Figma paddings 12 left / 40 right on a fully visible card;
// on a partly covered card the text keeps TEXT_GAP from the covering card and 12 from the free edge (not in Figma)
const TEXT_PL = 12;
const TEXT_PR = 40;
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

/* Card boxes for n cards with the active one at index a, from the strip's left edge.
   Step between card starts: card width + GAP while the row fits into stripW, else the even step that makes
   the row exactly stripW (whole px, as in Figma: 536 / 6 → 89). Cards right of the active one are shifted
   by its extra width (232 − 146) */
function layout(n, a, stripW) {
    const s = n > 1 ? Math.min(CARD_W + GAP, Math.floor((stripW - ACTIVE_W) / (n - 1))) : 0;
    const inactiveTop = (STRIP_H - CARD_H) / 2;   // inactive 64 centred on the 72 active one (Figma: y 4)
    return Array.from({ length: n }, (_, k) => {
        if (k === a) {
            const h = n === 1 ? SINGLE_H : ACTIVE_H;
            return { x: k * s, y: (STRIP_H - h) / 2, w: ACTIVE_W, h };
        }
        const x = k < a ? k * s : k * s + ACTIVE_W - CARD_W;
        return { x, y: inactiveTop, w: CARD_W, h: CARD_H };
    });
}

/* parentEl — the checkout bar column, the strip goes first in it; getPhoto(entry) → { url, thumb } | null;
   onRemove(entry) — the cross removed an entry; returns entries that leave with it (gifts of a seat);
   onFocus(entry) — a click on a card; onPhoto(entry) — a click on the active card's photo;
   onActive(entry | null) — the active card changed (hover, add, remove) */
export function createDesktopStrip({ parentEl, getPhoto, onRemove, onFocus, onPhoto, onActive }) {
    const root = document.createElement('div');
    root.className = 'd-strip';
    parentEl.prepend(root);

    const items = [];          // { entry, el, cur: { x, y, w, h, op } }
    let active = -1;
    let raf = 0;               // running layout tween
    let deleting = false;
    let lastActive = null;     // entry last reported to onActive
    let laidW = 0;             // strip width the current layout was made for
    const stripW = () => root.clientWidth || STRIP_W;

    function fill(item) {
        const { entry, el } = item;
        const photo = entry.kind === 'extra' ? null : getPhoto(entry);
        fillTicketCard(el, entry, photo);   // shared card markup (desktop-ticket-card.js)
        el.querySelector('.ds-x').addEventListener('click', (e) => {
            e.stopPropagation();
            if (deleting) return;
            const i = items.indexOf(item);
            if (i === active) removeWithExit(i);
        });
    }

    function paint() {
        items.forEach((it, k) => {
            const { x, y, w, h, op } = it.cur;
            it.el.style.transform = `translate(${x}px, ${y}px)`;
            it.el.style.width = `${w}px`;
            it.el.style.height = `${h}px`;
            it.el.style.opacity = op >= 1 ? '' : String(op);
            it.el.style.zIndex = String(100 - Math.abs(k - active));
            it.el.classList.toggle('is-active', k === active);
        });
        items.forEach((it, k) => fitText(it, k));
    }

    /* Text of an inactive card ends with an ellipsis at the edge of its visible part.
       Cards left of the active one are covered on the right by the next card, cards right of it on the left
       by the previous one (the card closer to the active is on top) */
    function fitText(it, k) {
        const t = it.el.querySelector('.ds-text');
        if (!t) return;
        if (k === active) { t.style.paddingLeft = ''; t.style.paddingRight = ''; return; }
        const c = it.cur;
        let leftCover = 0;
        let rightCover = 0;
        if (k > active && items[k - 1]) {
            const p = items[k - 1].cur;
            leftCover = Math.min(c.w, Math.max(0, p.x + p.w - c.x));
        }
        if (k < active && items[k + 1]) {
            const q = items[k + 1].cur;
            rightCover = Math.min(c.w, Math.max(0, c.x + c.w - q.x));
        }
        const covered = leftCover > 0 || rightCover > 0;
        t.style.paddingLeft = `${leftCover > 0 ? leftCover + TEXT_GAP : TEXT_PL}px`;
        t.style.paddingRight = `${rightCover > 0 ? rightCover + TEXT_GAP : (covered ? TEXT_PL : TEXT_PR)}px`;
    }

    /* Move every card from where it is now to the layout for the current active card.
       entering — new cards, which start half their width to the right of their place, transparent */
    function relayout(entering = []) {
        cancelAnimationFrame(raf);
        // every change of the active card goes through here: report it once
        const activeEntry = items[active] ? items[active].entry : null;
        if (activeEntry !== lastActive) {
            lastActive = activeEntry;
            if (onActive) onActive(activeEntry);
        }
        const n = items.length;
        if (!n) { paint(); return; }
        laidW = stripW();
        const target = layout(n, active, laidW);
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

    /* Hover: the card becomes active in its own place; the scheme does not move */
    function setActive(i) {
        if (deleting || i === active || i < 0 || i >= items.length) return;
        active = i;
        relayout();
    }

    /* Card element for an entry, in the strip, with hover (active) and click (photo — lightbox, else — focus) */
    function makeItem(entry) {
        const el = document.createElement('div');
        el.className = 'ds-card';
        const item = { entry, el, cur: { x: 0, y: 0, w: ACTIVE_W, h: ACTIVE_H, op: 0 } };
        fill(item);
        el.addEventListener('pointerenter', () => setActive(items.indexOf(item)));
        // click on the active card's photo — lightbox; elsewhere on the card — the scheme goes to its place
        // (the cross stops its own click; inactive cards have their photo collapsed to zero width)
        el.addEventListener('click', (e) => {
            if (deleting) return;
            if (e.target.closest('.ds-photo') && el.classList.contains('is-active')) { if (onPhoto) onPhoto(item.entry); return; }
            onFocus(item.entry);
        });
        root.appendChild(el);
        return item;
    }

    /* New entries at the end of the strip; activeEntry (default: the last one) becomes the active card.
       A seat with gifts: the seat is active, as on mobile; several dancefloor tickets: the last one */
    function add(entries, activeEntry) {
        const list = Array.isArray(entries) ? entries : [entries];
        if (!list.length) return;
        if (deleting && exitDone) exitDone();
        const added = list.map((entry) => {
            const item = makeItem(entry);
            items.push(item);
            return item;
        });
        const a = items.findIndex((it) => it.entry === (activeEntry || list[list.length - 1]));
        active = a === -1 ? items.length - 1 : a;
        relayout(added);
    }

    function dropAt(i) {
        const [it] = items.splice(i, 1);
        it.el.remove();
        // the active position stays in the list, as on mobile
        if (active >= items.length) active = items.length - 1;
        else if (i < active) active -= 1;
        return it;
    }

    /* Repeated click on the seat (with its gifts): the cards disappear at once, the strip closes up */
    function remove(entries) {
        const list = Array.isArray(entries) ? entries : [entries];
        if (deleting && exitDone) exitDone();
        list.forEach((entry) => {
            const i = items.findIndex((it) => it.entry === entry);
            if (i !== -1) dropAt(i);
        });
        relayout();
    }

    /* Cross on the active card: the card and the entries leaving with it go down and fade, then the strip closes up */
    let exitDone = null;
    function removeWithExit(i) {
        deleting = true;
        cancelAnimationFrame(raf);
        const it = items[i];
        const deps = (onRemove(it.entry) || []).map((e) => items.find((x) => x.entry === e)).filter(Boolean);
        const leaving = [it, ...deps];
        const clones = leaving.map((x) => {
            const clone = x.el.cloneNode(true);
            clone.classList.add('ds-exit');
            clone.style.zIndex = '0';
            clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASING}, opacity ${EXIT_MS}ms ${EXIT_EASING}`;
            root.appendChild(clone);
            x.el.style.visibility = 'hidden';
            return { clone, x };
        });
        void root.offsetWidth;
        let gone = false;
        exitDone = () => {
            if (gone) return;
            gone = true;
            exitDone = null;
            clones.forEach(({ clone }) => clone.remove());
            leaving.forEach((x) => { const k = items.indexOf(x); if (k !== -1) dropAt(k); });
            deleting = false;
            relayout();
        };
        clones[0].clone.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity' && exitDone) exitDone(); });
        setTimeout(() => { if (exitDone) exitDone(); }, EXIT_MS + 120);
        clones.forEach(({ clone, x }) => {
            clone.style.transform = `translate(${x.cur.x}px, ${x.cur.y + EXIT_DY}px)`;
            clone.style.opacity = '0';
        });
    }

    /* The page switched to the desktop layout: cards built from the order at once, activeEntry active, no animation */
    function reset(entries, activeEntry) {
        if (deleting && exitDone) exitDone();
        cancelAnimationFrame(raf);
        items.splice(0).forEach((it) => it.el.remove());
        root.querySelectorAll('.ds-exit').forEach((c) => c.remove());
        entries.forEach((entry) => items.push(makeItem(entry)));
        const a = items.findIndex((it) => it.entry === activeEntry);
        active = items.length ? (a === -1 ? items.length - 1 : a) : -1;
        laidW = stripW();
        const target = items.length ? layout(items.length, active, laidW) : [];
        items.forEach((it, k) => { it.cur = { ...target[k], op: 1 }; });
        lastActive = items[active] ? items[active].entry : null;
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
        activeEntry: () => (items[active] ? items[active].entry : null),
    };
}
