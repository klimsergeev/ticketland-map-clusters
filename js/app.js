/* ============================================================
   index.html entry point: one adaptive page. From DESKTOP_QUERY wide — the desktop layout (header column, zoom
   buttons, checkout bar with the ticket strip and the checkout button, centred dialogs, white lightbox); narrower —
   the mobile layout (header over the scheme, ticket carousel with the checkout button, bottom sheets), full width.
   One scheme, one order and one set of dialogs (app-core.js); the layouts differ only in their order view
   (desktop-strip.js / mobile-ribbon.js), CSS (css/desktop.css / css/styles.css) and a few core parameters.
   Crossing the width boundary switches live: the order and the scheme view stay, open overlays close.
   ============================================================ */
import { createAppCore } from './app-core.js';
import { createDesktopStrip } from './desktop-strip.js';
import { createMobileRibbon } from './mobile-ribbon.js';
import { createCheckoutButton } from './checkout-button.js';

export const DESKTOP_QUERY = '(min-width: 1024px)';   // = the media queries in css/styles.css and css/desktop.css

const mq = window.matchMedia(DESKTOP_QUERY);
let desktop = mq.matches;
const headerEl = document.querySelector('.header');
const checkoutEl = document.querySelector('.d-checkout');   // desktop checkout bar: strip and «Оформить»
// The order (seats, dancefloor tickets, gifts): one array shared by the core and both order views
const order = [];

// The views are created before the core: the core's scheme asks for the insets while it is being built.
// core stays null until then; the views' callbacks reach it only on user actions
let core = null;

const strip = createDesktopStrip({
    parentEl: checkoutEl.querySelector('.d-checkout-col'),
    getPhoto: (entry) => core.photoOf(entry),
    getGifts: (entry) => order.filter((x) => x.parent === entry),   // rows of a ticket's focus view
    onRemove: (entry) => core.dropEntry(entry),        // cross of a ticket (returns its gifts, they leave too) or a gift
    onFocus: (entry) => core.focusEntry(entry),        // click on a card: the scheme goes to its place
    onPhoto: (entry) => core.openSectionPhotos(entry), // click on the photo of the open (focus) card: lightbox
    onActive: (entry) => { if (desktop) core.setActiveEntry(entry); },   // active card: its seat marker is larger
});

const ribbon = createMobileRibbon({
    floatingEl: document.querySelector('.floating'),
    order,
    getPhoto: (entry) => core.photoOf(entry),
    onActive: (entry) => { if (core && !desktop) core.setActiveEntry(entry); },
    onFocus: (entry) => core.focusEntry(entry),
    onPhoto: (entry) => core.openSectionPhotos(entry),
    onDelete: (entry) => core.dropEntry(entry),
});

core = createAppCore({
    order,
    isDesktop: () => desktop,
    layoutStale: () => mq.matches !== desktop,
    topInset: () => (desktop ? 0 : headerEl.getBoundingClientRect().height),
    // mobile, empty order: the fitted scheme moves down by half the header, so the empty space is shared evenly
    restOffsetY: () => (!desktop && order.length === 0 ? headerEl.getBoundingClientRect().height / 2 : 0),
    // desktop: the checkout bar covers the bottom of the scheme while the order is not empty
    pageBottom: () => (desktop ? (order.length ? checkoutEl.offsetHeight : 0) : ribbon.height()),
    isBusy: () => !desktop && ribbon.isBusy(),
    // desktop: the button gets its new sum first, so the new cards are laid out for the strip width that remains
    onAdd: (entries, activeEntry) => {
        if (desktop) { renderDesktopCTA(); strip.add(entries, activeEntry); } else ribbon.add(entries, activeEntry);
    },
    onRemove: (entries) => (desktop ? strip.remove(entries) : ribbon.remove(entries)),
    onChange: () => { renderDesktopCTA(); if (!desktop) ribbon.renderCTA(); },
    onPhotosLoaded: () => (desktop ? strip.refresh() : ribbon.photosLoaded()),
});

/* Desktop checkout bar: shown while the order is not empty (slides up / down, css/desktop.css);
   «Оформить заказ» with the sum (js/checkout-button.js), no action yet. The button keeps the last sum while the bar
   leaves. Its width follows the sum and the strip takes the rest of the column: its cards are re-laid */
const checkoutBtn = createCheckoutButton(checkoutEl.querySelector('.d-cta'), {
    hug: true,
    onRender: () => { if (desktop) strip.refit(); },
});
function renderDesktopCTA() {
    checkoutEl.classList.toggle('is-shown', order.length > 0);
    if (!order.length || !desktop) return;   // the mobile layout hides the bar: fitted when the page is desktop
    checkoutBtn.render(order);
}

/* Build the current layout's order view from the order */
function showView(activeEntry) {
    renderDesktopCTA();   // before the strip: its width depends on the button
    if (desktop) strip.reset(order, activeEntry);   // a gift stands for its ticket's card
    else ribbon.rebuild(activeEntry);
    core.setActiveEntry(desktop ? strip.activeEntry() : activeEntry);
}
showView(null);

/* Live switch across the width boundary: overlays close, the order view of the other layout is built
   with the same active entry, the scheme keeps its centre and scale once the new layout has its size */
mq.addEventListener('change', (e) => {
    if (e.matches === desktop) return;
    const view = core.captureView();
    const active = desktop ? strip.activeEntry() : ribbon.activeEntry();
    core.closeOverlays();
    desktop = e.matches;
    showView(active);
    requestAnimationFrame(() => core.restoreView(view));
});

// mobile: the carousel re-anchors on resize and after the first layout
window.addEventListener('resize', () => { if (!desktop) ribbon.recenter(); });
requestAnimationFrame(() => { if (!desktop) ribbon.recenter(); });
