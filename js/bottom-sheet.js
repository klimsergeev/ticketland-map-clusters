/* ============================================================
   Шторка снизу над затемнением — общая основа диалогов Citrus «Dialog / Mobile»:
   шторки танцпола (js/seatless-dialog.js) и шторки подарков (js/gift-dialog.js).
   Стили — css/seatless.css (.sd-scrim, .sd-sheet): выезд и затемнение 250 мс, свайп вниз закрывает.

   createBottomSheet({ parentEl, label, onClose }) → { sheet, show, close, isOpen, height }
     sheet — элемент шторки, содержимое вставляет вызывающий;
     show() — выехать; close() — уехать (крестик, затемнение, свайп, кнопка действия), затем onClose();
     height() — высота шторки в px, верна и у спрятанной (она разложена, visibility: hidden).
   ============================================================ */

const SWIPE_START = 8;           // px: меньше — это тап, а не свайп
const SWIPE_CLOSE_PX = 80;       // протянули дальше — закрываем
const SWIPE_CLOSE_V = 0.5;       // px/ms: флик быстрее — закрываем

export function createBottomSheet({ parentEl, label = '', onClose }) {
    const scrim = document.createElement('div');
    scrim.className = 'sd-scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sd-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (label) sheet.setAttribute('aria-label', label);
    parentEl.appendChild(scrim);
    parentEl.appendChild(sheet);

    let isOpen = false;

    function show() {
        sheet.style.transform = '';
        sheet.classList.remove('is-dragging');
        scrim.classList.add('is-shown');
        sheet.classList.add('is-open');
        isOpen = true;
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        swipe = null;
        sheet.classList.remove('is-open', 'is-dragging');
        sheet.style.transform = '';   // после свайпа шторка уезжает от того места, где её отпустили
        scrim.classList.remove('is-shown');
        if (onClose) onClose();
    }

    scrim.addEventListener('click', () => close());

    /* ---------- свайп вниз. Захват указателя — только после сдвига на SWIPE_START:
       до этого тапы по кнопкам работают как обычно ---------- */
    let swipe = null;
    let swallowClick = false;   // свайп закончился — click, который браузер пришлёт следом, не нажимает кнопку
    sheet.addEventListener('pointerdown', (e) => {
        if (!isOpen) return;
        swipe = { pid: e.pointerId, y0: e.clientY, dy: 0, t: performance.now(), v: 0, on: false };
    });
    sheet.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.pid) return;
        if (!e.buttons && e.pointerType === 'mouse') { swipe = null; return; }   // кнопку отпустили за пределами шторки
        const dy = Math.max(0, e.clientY - swipe.y0);
        if (!swipe.on) {
            if (dy < SWIPE_START) return;
            swipe.on = true;
            try { sheet.setPointerCapture(e.pointerId); } catch {}
            sheet.classList.add('is-dragging');
        }
        const now = performance.now();
        if (now > swipe.t) swipe.v = (dy - swipe.dy) / (now - swipe.t);
        swipe.dy = dy;
        swipe.t = now;
        sheet.style.transform = `translateY(${dy}px)`;
    });
    function endSwipe(e) {
        if (!swipe || e.pointerId !== swipe.pid) return;
        const s = swipe;
        swipe = null;
        if (!s.on) return;
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 0);
        if (s.dy > SWIPE_CLOSE_PX || s.v > SWIPE_CLOSE_V) { close(); return; }
        sheet.classList.remove('is-dragging');
        sheet.style.transform = '';
    }
    sheet.addEventListener('pointerup', endSwipe);
    sheet.addEventListener('pointercancel', endSwipe);
    // после свайпа click по кнопке под пальцем не должен сработать
    sheet.addEventListener('click', (e) => { if (swallowClick) e.stopPropagation(); }, true);

    return {
        sheet,
        show,
        close,
        isOpen: () => isOpen,
        height: () => sheet.offsetHeight,
    };
}
