/* ============================================================
   Desktop ticket strip (desktop layout of index.html; the mobile ribbon is mobile-ribbon.js).
   Figma Z4wmhHaKhZMV8UI79y1a9Y, node 5181:34021 «[ Hall ] page», strip «Frame 23»; card markup — desktop-ticket-card.js.
     • One card per ticket (seat or dancefloor ticket); gifts are rows inside their ticket's card, not cards.
     • One card is active (232×72 with the photo on the left, 232×64 when it is the only one; its seat marker on the
       scheme is larger), the others are compact 146×64; 8 apart from the strip's left edge. When they do not fit,
       they overlap with an even step so that the row takes the strip width; the active card is on top, then by
       distance from it; a covered card's text ends with an ellipsis at the edge of its visible part.
     • A new ticket becomes the active one. Hover (mouse only) makes a card active (the last hovered card stays active,
       as in the former strip); a ticket with gifts also opens upwards into the focus view (its bottom stays on the
       strip line) while the mouse is on the strip, leaving it closes the card back to the active one.
     • Touch on a screen from 1024 px: a tap on an inactive card makes it active and moves the scheme to its place;
       a tap on the active card of a ticket with gifts opens it; a tap outside the strip closes it.
     • Active and focus views: click on the photo — lightbox; Cross (in the focus view — in the title) — the ticket
       leaves with its gifts; Cross of a gift row — only that gift leaves. A click elsewhere on a card moves the
       scheme to its place.
     • The strip is what the checkout button leaves of the 980 column; refit() re-lays the cards when it changes.
   Motion: card boxes move with a 200 ms decelerating tween, no bounce (views cross-fade with the same CSS curve).
   No layout per frame: while a card changes size, its element keeps one size (the union of the old and the new box)
   for the whole tween, and only transform and clip-path change per frame (layers — css/desktop.css .ds-card);
   a new card appears half a card to the right of its place and slides in while fading in, 250 ms; a removed card
   goes down 40 px and fades (--duration-short, --ease-out, as on mobile) before the strip closes up.
   ============================================================ */
import { fillTicketCard } from './desktop-ticket-card.js';
import { DURATION, EASE_OUT, easeOut, staggerDelay, prefersReducedMotion } from './motion.js';

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

const MOVE_MS = DURATION.short;           // boxes of cards that change size or place (add, remove)
const HOVER_MS = DURATION.hover;          // hover and touch: a card becomes active, opens, closes
const ENTER_MS = DURATION.enter;          // new card slides in
const ENTER_SHIFT = 0.5;       // new card starts this share of its width to the right of its place
const EXIT_MS = DURATION.short;
const EXIT_DY = 40;
const EXIT_EASING = EASE_OUT;

// decelerating, no overshoot: --ease-out, the same curve as the card transitions in desktop.css
const moveEase = easeOut;

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

const RADIUS = 12;             // compact card
const RADIUS_ACTIVE = 16;      // active and open card
const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

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
        item.shadow = el.querySelector('.ds-shadow');
        item.body = el.querySelector('.ds-body');
        item.views = el.querySelector('.ds-views');
        if (item.frame) draw(item, items.indexOf(item), activeIndex());
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

    /* Element size of a card: set when a tween starts and when it ends, never per frame */
    function setFrame(it, f) {
        it.frame = { x: f.x, y: f.y, w: f.w, h: f.h };
        it.el.style.width = `${f.w}px`;
        it.el.style.height = `${f.h}px`;
    }

    /* One frame of a card: position, stacking, opacity; while its box differs from the element — the clip of the body,
       the views at the bottom left corner of the visible box and the shadow fitted to it */
    function draw(it, k, a) {
        const c = it.cur;
        const f = it.frame;
        if (!f || !it.body) return;
        it.el.style.transform = `translate(${f.x}px, ${f.y}px)`;
        it.el.style.opacity = c.op >= 1 ? '' : String(c.op);
        it.el.style.zIndex = String(zOf(k, a));
        const l = c.x - f.x, t = c.y - f.y;
        const r = f.x + f.w - (c.x + c.w), b = f.y + f.h - (c.y + c.h);
        const clipped = Math.abs(l) + Math.abs(t) + Math.abs(r) + Math.abs(b) > 0.01;
        it.body.style.clipPath = clipped ? `inset(${t}px ${r}px ${b}px ${l}px round ${c.r}px)` : '';
        it.views.style.transform = clipped ? `translate(${l}px, ${-b}px)` : '';
        it.shadow.style.transform = clipped ? `translate(${l}px, ${t}px) scale(${c.w / f.w}, ${c.h / f.h})` : '';
    }

    /* State classes of every card for the current active card; set once per layout change */
    function setClasses() {
        const a = activeIndex();
        items.forEach((it, k) => {
            it.el.classList.toggle('is-active', k === a);
            it.el.classList.toggle('is-open', k === a && isOpen());
            it.el.classList.toggle('is-single', items.length === 1);
        });
    }

    /* Text of a compact card ends with an ellipsis at the edge of its visible part: a neighbour higher in the stack
       covers it from that side. Counted once for the boxes the cards are going to */
    function fitTexts(boxes) {
        const a = activeIndex();
        items.forEach((it, k) => {
            const t = it.el.querySelector('.ds-text');
            if (!t) return;
            if (k === a) { t.style.paddingLeft = ''; t.style.paddingRight = ''; return; }
            const c = boxes[k];
            let leftCover = 0;
            let rightCover = 0;
            const z = zOf(k, a);
            if (boxes[k - 1] && zOf(k - 1, a) > z) {
                const p = boxes[k - 1];
                leftCover = Math.min(c.w, Math.max(0, p.x + p.w - c.x));
            }
            if (boxes[k + 1] && zOf(k + 1, a) > z) {
                const q = boxes[k + 1];
                rightCover = Math.min(c.w, Math.max(0, c.x + c.w - q.x));
            }
            t.style.paddingLeft = `${leftCover > 0 ? leftCover + TEXT_GAP : TEXT_PL}px`;
            t.style.paddingRight = `${rightCover > 0 ? rightCover + TEXT_GAP : TEXT_PR}px`;
        });
    }

    /* Every card at its box, no tween */
    function pinAll() {
        const a = activeIndex();
        items.forEach((it, k) => { setFrame(it, it.cur); draw(it, k, a); });
    }

    // natural height of the open card's focus view (photo, title, gift rows)
    const focusHeight = (item) => (item ? item.el.querySelector('.ds-focus').offsetHeight : 0);

    /* Move every card from where it is now to the layout for the current open card.
       entering — new cards, which start half their width to the right of their place, transparent */
    function relayout(entering = [], ms = MOVE_MS) {
        cancelAnimationFrame(raf);
        // every change of the open card goes through here: report it once
        const activeEntry = activeItem ? activeItem.entry : null;
        if (activeEntry !== lastActive) {
            lastActive = activeEntry;
            if (onActive) onActive(activeEntry);
        }
        const n = items.length;
        if (!n) return;
        setClasses();   // before measuring: the open card's focus view must be laid out
        laidW = stripW();
        const a = activeIndex();
        const radiusOf = (k) => (k === a ? RADIUS_ACTIVE : RADIUS);
        const target = layout(n, a, isOpen(), laidW, isOpen() ? focusHeight(activeItem) : 0)
            .map((box, k) => ({ ...box, r: radiusOf(k), op: 1 }));
        fitTexts(target);
        root.style.setProperty('--ds-move', `${ms}ms`);
        // a batch into a strip that already had cards: starts one after another (0, 30, 48 … ms)
        const stagger = entering.length > 1 && entering.length < items.length;
        // «reduce motion»: boxes go to their places at once; new cards only fade in (DURATION.short, no shift)
        const reduce = prefersReducedMotion();
        const tracks = items.map((it, k) => {
            const to = target[k];
            if (reduce) {
                const fresh = entering.includes(it);
                it.cur = { ...to, op: fresh ? 0 : 1 };
                setFrame(it, to);
                return { it, k, to, from: { ...it.cur }, resize: false, ms: fresh ? DURATION.short : 1, delay: 0 };
            }
            const from = entering.includes(it)
                ? { ...to, x: to.x + to.w * ENTER_SHIFT, op: 0 }
                : { ...it.cur, r: it.cur.r ?? radiusOf(k) };
            const resize = Math.abs(from.w - to.w) > 0.01 || Math.abs(from.h - to.h) > 0.01;
            setFrame(it, resize ? union(from, to) : from);
            const e = entering.indexOf(it);
            return { it, k, to, from, resize, ms: e !== -1 ? ENTER_MS : ms, delay: e !== -1 && stagger ? staggerDelay(e) : 0 };
        });
        const t0 = performance.now();
        const step = (now) => {
            let running = false;
            tracks.forEach(({ it, k, from, to, resize, ms: dur, delay }) => {
                const t = Math.min(1, Math.max(0, (now - t0 - delay) / dur));
                if (t < 1) running = true;
                const e = moveEase(t);
                it.cur = {
                    x: from.x + (to.x - from.x) * e,
                    y: from.y + (to.y - from.y) * e,
                    w: from.w + (to.w - from.w) * e,
                    h: from.h + (to.h - from.h) * e,
                    r: from.r + (to.r - from.r) * e,
                    op: from.op + (1 - from.op) * e,
                };
                if (t >= 1) { it.cur = { ...to }; setFrame(it, to); }
                else if (!resize) { it.frame.x = it.cur.x; it.frame.y = it.cur.y; }
                draw(it, k, a);
            });
            if (running) raf = requestAnimationFrame(step);
        };
        step(t0);
    }

    /* Hover makes a card active and opens it; leaving the strip closes it, it stays active; the scheme does not move */
    function hover(item) {
        if (deleting || (item === activeItem && open)) return;
        activeItem = item;
        open = true;
        relayout([], HOVER_MS);
    }
    function close() {
        if (deleting || !open) return;
        open = false;
        relayout([], HOVER_MS);
    }
    // the open card sticks out above the strip but is its child: leaving it upwards leaves the strip too
    root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') close(); });
    // touch: a tap outside the strip closes the open card
    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' && open && !root.contains(e.target)) close();
    }, true);

    /* Touch on a card (instead of hover): true — the tap is used up */
    function touchCard(item, e) {
        if (item !== activeItem) {
            activeItem = item;
            open = false;
            relayout([], HOVER_MS);
            onFocus(item.entry);   // the scheme goes to its place
            return true;
        }
        if (!open && getGifts(item.entry).length) {
            open = true;
            relayout([], HOVER_MS);
            return true;
        }
        return false;   // the active card: photo, crosses and the rest as with the mouse
    }

    /* Card element for a ticket, with hover (open) and click (photo of the open card — lightbox, else — focus) */
    function makeItem(entry) {
        const el = document.createElement('div');
        el.className = 'ds-card';
        const item = { entry, el, cur: { x: 0, y: CARD_TOP, w: CARD_W, h: CARD_H, r: RADIUS, op: 0 }, frame: null };
        fill(item);
        el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover(item); });
        el.addEventListener('click', (e) => {
            if (deleting) return;
            if (e.pointerType && e.pointerType !== 'mouse' && touchCard(item, e)) return;
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
        pinAll();          // a tween cut short: every card at its current box, nothing clipped
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
        clone.style.transform = `translate(${it.cur.x}px, ${it.cur.y + (prefersReducedMotion() ? 0 : EXIT_DY)}px)`;
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
        const a = activeIndex();
        const target = layout(items.length, a, false, laidW, 0);
        items.forEach((it, k) => { it.cur = { ...target[k], r: k === a ? RADIUS_ACTIVE : RADIUS, op: 1 }; });
        setClasses();
        fitTexts(items.map((it) => it.cur));
        pinAll();
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
        setClasses();
        fitTexts(items.map((it) => it.cur));
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
