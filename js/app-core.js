/* ============================================================
   Page core for index.html in both layouts (desktop from 1024 px wide, mobile below):
   header, price filter, hall scheme with zoom, the order (seats, dancefloor tickets, gifts), taps on the scheme,
   dancefloor and gift dialogs (seatless-dialog.js / gift-dialog.js: bottom sheets on mobile, centred dialogs on desktop
   by css/desktop.css), photo lightbox (photo-ui.js) with «Показать на схеме».
   What the page shows of the order (the mobile ribbon, the desktop strip and checkout button) are the page's own
   modules; the core tells them about changes through callbacks and never reads their DOM.

   createAppCore(opts):
     opts.order — the order array, shared with the page's order views;
     opts.isDesktop() — current layout;
     opts.layoutStale() — the window already crossed the width boundary, but the page has not switched yet:
       the scheme has the new size with the old layout's state, so it is neither re-clamped nor remembered;
     opts.topInset() / opts.restOffsetY() — header over the scheme (mobile), rest offset of the fitted scheme;
     opts.pageBottom() — px the page's own blocks cover at the bottom of the scheme (ribbon or strip);
     opts.isBusy() — the page is animating a deletion: taps on the scheme wait;
     opts.onAdd(entries, activeEntry) — entries went into the order; opts.onRemove(entries) — they left by a repeated
       tap on the seat (the seat and its gifts); opts.onChange() — after every change of the order;
     opts.onPhotosLoaded() — section photos arrived.
   ============================================================ */
import { HallViewport } from './hall.js';
import { loadHall, hitTest, seatTapAction, FOCUS_SCALE } from './hall-scheme.js';
import { createPriceFilter } from './price-filter.js';
import { fillEventHeader } from './event-header.js';
import { createPhotoMap } from './photo-map.js';
import { createLightbox } from './photo-ui.js';
import { createSeatlessDialog } from './seatless-dialog.js';
import { createGiftDialog } from './gift-dialog.js';
import { DANCEFLOOR, GIFT, MAX_ORDER_ITEMS, TIER_COLORS, TIER_PRICES } from './data.js';

const ZOOM_STEP = 1.5;            // one click of "+" or "−" (desktop); not in the Figma mockup
// Desktop zoom when a seat is picked, a card is clicked or a miss is clicked at the minimum scale.
// Weaker than FOCUS_SCALE (1.8, mobile)
const DESKTOP_FOCUS_SCALE = 1.3;
const PLACE_SHARE = 0.8;          // «Показать на схеме», dancefloor: the place takes this share of the scheme width
const DANCEFLOOR_ZOOM_MS = 260;   // = _animateTo in hall.js
const PHOTOS_URL = 'photos/sections.json';   // one photo per section: { "<part>-<side>": { url, caption } }

/* Desktop lightbox: Figma 5132:10436 «Gallery / Modal / Desktop» — photo frame 1107/740 fitted to the height
   between the close button and the caption block, no vertical shift; a click pages only on the photo;
   closing — cross and Esc, no drag-to-close. Mobile — the photo-ui.js defaults */
const DESKTOP_LIGHTBOX = { frameAspect: 1107 / 740, frameShiftY: 0, tapOnFrame: true, swipeClose: false };

export function createAppCore({
    order,
    isDesktop,
    layoutStale = () => false,
    topInset = () => 0,
    restOffsetY = () => 0,
    pageBottom = () => 0,
    isBusy = () => false,
    onAdd = () => {},
    onRemove = () => {},
    onChange = () => {},
    onPhotosLoaded = () => {},
}) {
    // Empty until hall.svg is loaded, then the object from loadHall
    let scheme = { svgEl: null, seats: [], seatlessEls: [], renderFilterLayer: null, renderSelection: null, sectionHighlight: null };
    let photoMap = null;          // section photos, after hall.svg is loaded

    /* Order (opts.order), as the mobile cart: seats (objects from seats.js), dancefloor tickets { kind: 'seatless' }
       and gifts { kind: 'extra', parent } right after their seat. Tickets and gifts together: not more than
       MAX_ORDER_ITEMS */
    const roomLeft = () => Math.max(0, MAX_ORDER_ITEMS - order.length);
    let activeEntry = null;       // its seat marker is larger (×1.4), as on mobile
    const focusScale = () => (isDesktop() ? DESKTOP_FOCUS_SCALE : FOCUS_SCALE);

    const appEl = document.querySelector('.app');
    fillEventHeader(document.querySelector('.header'));
    const priceFilter = createPriceFilter({
        legendEl: document.querySelector('.legend'),
        getHall: () => hall,
        getScheme: () => scheme,
    });
    priceFilter.render();

    const zoomInBtn = document.querySelector('[data-zoom="in"]');
    const zoomOutBtn = document.querySelector('[data-zoom="out"]');
    const viewportEl = document.querySelector('.map-viewport');

    // all photos of the sections, from the photo of a ticket card; «Показать на схеме» moves the scheme to the section
    const lightbox = createLightbox({
        parentEl: appEl,
        onShow: (item) => showPhotoOnMap(item),
        getLayout: () => (isDesktop() ? DESKTOP_LIGHTBOX : {}),
    });

    /* ---------- Dancefloor and gift dialogs: bottom sheets on mobile, centred dialogs on desktop (css/desktop.css).
       Closing: cross and scrim; on mobile also the swipe down, on desktop Esc ---------- */
    const seatlessDialog = createSeatlessDialog({
        parentEl: appEl,
        onAdd: (n) => addSeatless(n),
        onPhoto: () => openSectionPhotos({ kind: 'seatless', photoKey: DANCEFLOOR.photoKey }),
        // the sheet is gone, so is its slack in the bottom inset: the scheme glides back into the usual pan limits
        onClose: () => { if (hall) hall.settle(); },
    });
    let giftSeat = null;    // seat the gift dialog is open for; it goes into the order only on «Добавить в корзину»
    const giftDialog = createGiftDialog({
        parentEl: appEl,
        onAdd: (n) => addSeatWithGifts(giftSeat, n),
        onClose: () => { if (hall) hall.settle(); },
    });

    // desktop: dialogs are dialogs, not sheets — a mouse press on them never starts the shared swipe-down
    document.body.addEventListener('pointerdown', (e) => { if (isDesktop() && e.target.closest('.sd-sheet')) e.stopPropagation(); }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !isDesktop()) return;
        if (seatlessDialog.isOpen()) seatlessDialog.close();
        if (giftDialog.isOpen()) giftDialog.close();
    });

    let dancefloorLeft = DANCEFLOOR.stock;   // dancefloor tickets on sale: «Добавить» takes, removing a ticket gives back
    let dancefloorView = null;               // scheme view the dialog opened in: «Добавить» does not move it again
    let dancefloorSeq = 0;                   // current opening: a late onDone or timer of an old one does nothing
    let dancefloorFocusing = false;          // mobile: the scheme zooms to the dancefloor, the sheet already counts as a bottom overlay

    /* Bottom of the scheme covered by the page: the ribbon or strip; on mobile also an open sheet
       (and the dancefloor sheet while the scheme zooms to the dancefloor before it) */
    function bottomInset() {
        if (isDesktop()) return pageBottom();
        return Math.max(
            pageBottom(),
            dancefloorFocusing || seatlessDialog.isOpen() ? seatlessDialog.height() : 0,
            giftDialog.isOpen() ? giftDialog.height() : 0,
        );
    }

    /* Last scheme view (centre in scheme units, px per unit), taken while the scheme had its layout's size.
       A layout switch restores it: by the time the page learns about the switch the scheme already has
       the new size, and a view read from it then would carry the wrong scale */
    let lastView = null;
    const hall = new HallViewport(viewportEl, document.querySelector('.map-content'), {
        topInset: () => topInset(),
        bottomInset,
        restOffsetY: () => restOffsetY(),
        onTap: (x, y) => handleTap(x, y),
        onInteract: () => {
            priceFilter.clear();
            if (scheme.sectionHighlight) scheme.sectionHighlight.hide();   // the scheme moved: section outlines go off
        },
        // called on every view change, including tween frames
        onView: () => {
            syncZoomButtons();
            if (!layoutStale()) lastView = hall.captureView();
        },
    });

    function syncZoomButtons() {
        zoomOutBtn.disabled = hall.atMinScale();
        zoomInBtn.disabled = !hall.canZoomIn();
    }

    /* Tap on the scheme → hit-test → pick / unpick. Occupied and unknown seats do not respond */
    function handleTap(clientX, clientY) {
        if (lightbox.isOpen()) { lightbox.close(); return; }   // the lightbox covers the page; insurance
        if (isBusy()) return;                                   // the order is not touched during a deletion animation
        const hit = hitTest(hall, scheme.seats, scheme.seatlessEls, clientX, clientY);
        if (!hit) return;
        if (hit.kind === 'seatless') { openSeatlessDialog(); return; }   // dancefloor: the scheme zooms to it, then the dialog
        if (hit.kind === 'seat') {
            const seat = hit.seat;
            const action = seatTapAction(seat, order.length);
            if (action === 'remove') {   // repeated tap: the seat leaves with its gifts
                const gifts = dropEntry(seat);
                onRemove([seat, ...gifts]);
                return;
            }
            if (action === 'gift') { openGiftDialog(seat); return; }   // amphitheatre: gift dialog first, the seat goes in on «Добавить»
            if (action !== 'add') return;                               // order full
            seat.selected = true;
            order.push(seat);
            renderMarks();
            onAdd([seat], seat);
            onChange();
            focusSeat(seat);   // the picked seat into the centre of the visible band; unpicking does not move the scheme
            return;
        }
        // miss (empty area or an occupied seat): only at the minimum scale the scheme zooms to the tap point, nothing is picked
        if (hall.atMinScale()) hall.focusOnSvgPoint(hit.x, hit.y, focusScale());
    }

    /* Seat centre (x+4, y+4) or the dancefloor centre into the centre of the band between the header and the bottom
       blocks, at the layout's focus scale or the current zoom if larger; a gift has no place */
    function focusSeat(entry) {
        if (!entry) return;
        if (entry.kind === 'seatless') {
            if (entry.cx != null) hall.focusInBand(entry.cx, entry.cy, focusScale());
            return;
        }
        if (!entry.el) return;
        hall.focusInBand(+entry.el.getAttribute('x') + 4, +entry.el.getAttribute('y') + 4, focusScale());
    }

    /* Seat markers and filter copies follow the order and the active entry (a dancefloor ticket or a gift
       is not a seat, no marker is larger then) */
    function renderMarks() {
        if (scheme.renderSelection) scheme.renderSelection(scheme.seats, activeEntry);
        priceFilter.redraw();                          // a picked seat drops its enlarged filter copy
    }

    function setActiveEntry(entry) {
        activeEntry = entry || null;
        renderMarks();
    }

    /* Take an entry out of the order together with its gifts; a seat loses its check, a dancefloor ticket goes back
       on sale. Returns the gifts that left with it. Used by the page's own removal (ribbon or strip cross) */
    function dropEntry(entry) {
        if (!order.includes(entry)) return [];
        const gifts = order.filter((x) => x.parent === entry);
        const keep = order.filter((x) => x !== entry && x.parent !== entry);
        order.length = 0;
        order.push(...keep);
        if (entry.el) entry.selected = false;
        if (entry.kind === 'seatless') dancefloorLeft++;
        renderMarks();
        onChange();
        return gifts;
    }

    function dancefloorRect() {
        return scheme.seatlessEls[0] && scheme.seatlessEls[0].querySelector('rect');
    }
    function dancefloorPrice() {
        const i = TIER_COLORS.findIndex((c) => c.toUpperCase() === DANCEFLOOR.tier.toUpperCase());
        return i === -1 ? 0 : TIER_PRICES[i];
    }

    /* Tap on the dancefloor: the scheme first zooms to it — PLACE_SHARE of the scheme width (desktop: not above
       DESKTOP_FOCUS_SCALE), centre in the band above the sheet (mobile) or the strip (desktop) — then the dialog.
       If the zoom is cut short by a touch, the dialog still opens by the timer, and «Добавить» then brings the scheme */
    function openSeatlessDialog() {
        const photo = photoMap ? photoMap.photoOf({ kind: 'seatless', photoKey: DANCEFLOOR.photoKey }) : null;
        seatlessDialog.prepare({ name: DANCEFLOOR.name, price: dancefloorPrice(), photo, left: dancefloorLeft, available: roomLeft() });
        dancefloorView = null;
        const r = dancefloorRect();
        if (!r) { seatlessDialog.show(); return; }
        const seq = ++dancefloorSeq;
        const showOnce = (arrived) => {
            if (seq !== dancefloorSeq) return;
            dancefloorSeq++;
            dancefloorView = arrived ? hall.viewState() : null;
            seatlessDialog.show();
            dancefloorFocusing = false;   // from here the open sheet itself is the overlay
        };
        const w = +r.getAttribute('width');
        const cx = +r.getAttribute('x') + w / 2;
        const cy = +r.getAttribute('y') + +r.getAttribute('height') / 2;
        let scale = hall.scaleForWidth(w, viewportEl.clientWidth * PLACE_SHARE);
        let bottom;
        if (isDesktop()) {
            scale = Math.min(scale, DESKTOP_FOCUS_SCALE);
            bottom = bottomInset();
        } else {
            // the sheet covers the bottom of the scheme like the order block: without this the pan clamp
            // does not let the dancefloor into the band above the sheet
            dancefloorFocusing = true;
            bottom = seatlessDialog.height();
        }
        hall.focusAt(cx, cy, scale, bottom, () => showOnce(true));
        setTimeout(() => showOnce(false), DANCEFLOOR_ZOOM_MS + 200);   // zoom cut short — onDone will not come
    }

    /* The scheme stands where the dialog opened: nobody moved it */
    function sameView(a, b) {
        return !!a && !!b && Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
    }

    /* «Добавить в корзину» in the dancefloor dialog: n tickets, each its own entry; the last one is active.
       The scheme already stands on the dancefloor; it goes there only if it was moved */
    function addSeatless(n) {
        const count = Math.min(n, roomLeft(), dancefloorLeft);
        if (count < 1) return;
        dancefloorLeft -= count;
        const r = dancefloorRect();
        const cx = r ? +r.getAttribute('x') + +r.getAttribute('width') / 2 : null;
        const cy = r ? +r.getAttribute('y') + +r.getAttribute('height') / 2 : null;
        const added = Array.from({ length: count }, () => ({ kind: 'seatless', name: DANCEFLOOR.name, price: dancefloorPrice(), photoKey: DANCEFLOOR.photoKey, cx, cy }));
        order.push(...added);
        const last = added[added.length - 1];
        onAdd(added, last);
        onChange();
        if (!sameView(dancefloorView, hall.viewState())) focusSeat(last);
        dancefloorView = null;
    }

    /* Free amphitheatre seat: the gift dialog (the seat has room: seatTapAction); gifts — not more than
       GIFT.maxPerTicket and what the order has left after the seat itself.
       Mobile: the sheet is open — the seat goes into the centre of the band above it */
    const giftRoom = () => Math.max(0, Math.min(GIFT.maxPerTicket, roomLeft() - 1));
    function openGiftDialog(seat) {
        giftSeat = seat;
        giftDialog.open({
            place: `${seat.section}, ряд ${seat.row}, место ${seat.seat}`,
            price: seat.price,
            giftPrice: GIFT.price,
            available: giftRoom(),
            noRoomText: 'В заказе нет мест для подарков',
        });
        if (!isDesktop()) focusSeat(seat);
    }

    /* «Добавить в корзину» in the gift dialog: the seat and n gifts right after it; the seat is the active entry */
    function addSeatWithGifts(seat, n) {
        giftSeat = null;
        if (!seat || seat.selected || roomLeft() < 1) return;
        seat.selected = true;
        const gifts = Array.from({ length: Math.min(n, giftRoom()) }, () => ({ kind: 'extra', name: GIFT.name, sort: `Ряд ${seat.row} место ${seat.seat}`, price: GIFT.price, parent: seat }));
        order.push(seat, ...gifts);
        renderMarks();
        onAdd([seat, ...gifts], seat);
        onChange();
        focusSeat(seat);
    }

    /* Lightbox with all section photos — the dancefloor first, then the sections — starting at this entry's section */
    function openSectionPhotos(entry) {
        if (!photoMap || !entry || entry.kind === 'extra') return;
        const items = photoMap.gallery();
        const start = items.findIndex((it) => it.key === photoMap.keyOf(entry));
        if (start === -1) return;   // the section has no photo — the card has none either
        lightbox.open(items, start);
    }

    /* Where the photo's section is on the scheme: { x, y, w } in scheme units — centre and width of the box around
       the section's seats, or of the dancefloor. null — the section has no seats on the scheme */
    function photoPlace(item) {
        if (!item) return null;
        if (item.key === DANCEFLOOR.photoKey) {
            const r = dancefloorRect();
            if (!r) return null;
            const w = +r.getAttribute('width');
            return { x: +r.getAttribute('x') + w / 2, y: +r.getAttribute('y') + +r.getAttribute('height') / 2, w };
        }
        if (!photoMap) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        scheme.seats.forEach((s) => {
            if (photoMap.keyOf(s) !== item.key) return;
            const x = +s.el.getAttribute('x');
            const y = +s.el.getAttribute('y');
            x0 = Math.min(x0, x); y0 = Math.min(y0, y);
            x1 = Math.max(x1, x + 8); y1 = Math.max(y1, y + 8);
        });
        return x0 === Infinity ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0 };
    }

    /* «Показать на схеме»: the lightbox is already closing, the dancefloor dialog closes if open. The section or the
       dancefloor takes PLACE_SHARE of the scheme width, its centre goes to the centre of the band above the bottom
       blocks. Sections are capped at the layout's focus scale (a seat not larger than when picked), the dancefloor is
       not. When the scheme stops, the section's seats are outlined */
    function showPhotoOnMap(item) {
        const c = photoPlace(item);
        if (!c) return;
        dancefloorSeq++;            // a zoom to the dancefloor before its dialog, if still going, no longer opens it
        dancefloorFocusing = false;
        dancefloorView = null;
        seatlessDialog.close();     // onClose → hall.settle(); the focus below overrides it
        let scale = hall.scaleForWidth(c.w, viewportEl.clientWidth * PLACE_SHARE);
        if (item.key !== DANCEFLOOR.photoKey) scale = Math.min(scale, focusScale());
        hall.focusAt(c.x, c.y, scale, pageBottom(), () => highlightPhotoPlace(item));
    }

    /* Outlines around every free seat of the section that is not in the order, in the seat's colour;
       for the dancefloor — around its rectangle */
    function highlightPhotoPlace(item) {
        if (!scheme.sectionHighlight) return;
        const shape = (el, color) => ({
            x: +el.getAttribute('x'),
            y: +el.getAttribute('y'),
            w: +el.getAttribute('width'),
            h: +el.getAttribute('height'),
            r: +el.getAttribute('rx') || 0,
            color,
        });
        const shapes = item.key === DANCEFLOOR.photoKey
            ? scheme.seatlessEls.map((g) => g.querySelector('rect')).filter(Boolean).map((r) => shape(r, r.getAttribute('fill')))
            : scheme.seats
                .filter((s) => s.status === 'available' && !s.selected && photoMap.keyOf(s) === item.key)
                .map((s) => shape(s.el, s.el.getAttribute('fill')));
        scheme.sectionHighlight.show(shapes, hall.viewTransform().k);
    }

    // a press anywhere — scheme, ribbon or strip, filter — puts the section outlines off at once
    document.addEventListener('pointerdown', () => { if (scheme.sectionHighlight) scheme.sectionHighlight.hide(); }, true);

    zoomInBtn.addEventListener('click', () => hall.zoomBy(ZOOM_STEP));
    zoomOutBtn.addEventListener('click', () => hall.zoomBy(1 / ZOOM_STEP));

    loadHall(document.querySelector('.hall-svg'))
        .then((s) => {
            scheme = s;
            hall.refit();
            photoMap = createPhotoMap({ seats: s.seats, seatless: [{ photoKey: DANCEFLOOR.photoKey, name: DANCEFLOOR.name }] });
            photoMap.load(PHOTOS_URL).then(() => onPhotosLoaded());
        })
        .catch((e) => console.error('hall.svg load failed', e));
    hall.refit();
    requestAnimationFrame(() => hall.refit());
    // re-clamp and redraw the viewBox; across the width boundary the switch restores the view instead
    window.addEventListener('resize', () => { if (!layoutStale()) hall.panTo(hall.tx, hall.ty); });

    /* Layout switch: open lightbox and dialogs close (a dialog's seat or tickets are not added),
       the scheme view is kept by its centre and scale */
    function closeOverlays() {
        lightbox.close();
        dancefloorSeq++;
        dancefloorFocusing = false;
        dancefloorView = null;
        seatlessDialog.close();
        giftDialog.close();
        giftSeat = null;
        if (scheme.sectionHighlight) scheme.sectionHighlight.hide();
    }

    return {
        dropEntry,
        focusEntry: focusSeat,
        openSectionPhotos,
        setActiveEntry,
        // section photo of an entry: { url, thumb, caption } | null (gifts have none)
        photoOf: (entry) => (photoMap && entry && entry.kind !== 'extra' ? photoMap.photoOf(entry) : null),
        closeOverlays,
        captureView: () => lastView,
        restoreView: (v) => hall.restoreView(v),
    };
}
