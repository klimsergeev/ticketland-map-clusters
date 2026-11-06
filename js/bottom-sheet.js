/* ============================================================
   Шторка снизу над затемнением — общая основа диалогов Citrus «Dialog / Mobile»:
   шторки танцпола (js/seatless-dialog.js) и шторки подарков (js/gift-dialog.js).
   Стили — css/seatless.css (.sd-scrim, .sd-sheet): выезд и затемнение 250 мс, свайп вниз закрывает.

   createBottomSheet({ parentEl, label, onClose }) → { sheet, show, close, isOpen, height }
     sheet — элемент шторки, содержимое вставляет вызывающий;
     show() — выехать; close(opts) — уехать (крестик, затемнение, свайп, кнопка действия), затем onClose();
       opts.instant — без перехода (закрытие с клавиатуры); opts.action — закрыла кнопка действия
       («Добавить в корзину»): такую уезжающую шторку не схватить;
     height() — высота шторки в px, верна и у спрятанной (она разложена, visibility: hidden).

   Свайп: шторка идёт за пальцем вниз 1:1, вверх — с растущим трением. Отпускание: закрытие, если протянули
   дальше SWIPE_CLOSE_PX или бросили вниз быстрее FLICK_SPEED (скорость — по окну последних сэмплов);
   дальше шторку ведёт пружина со скоростью пальца (js/motion.js releaseSpring), затемнение — от её положения.
   Уезжающую шторку (закрытую свайпом, крестиком или затемнением) можно схватить: она идёт от видимого места.
   ============================================================ */
import { spring } from './spring.js';
import { DURATION, FLICK_SPEED, releaseSpring, rubberband, windowedVelocity } from './motion.js';

const SWIPE_START = 8;           // px: меньше — это тап, а не свайп
const SWIPE_CLOSE_PX = 80;       // протянули дальше — закрываем
const RUBBER = 0.55;             // трение вверх, за открытым положением

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
    let grabbableUntil = 0;   // уезжающую шторку можно схватить до этого момента (performance.now)
    let stopSpring = null;
    let curY = 0;             // сдвиг шторки вниз, пока её ведёт палец или пружина

    function stopMotion() {
        if (stopSpring) { stopSpring(); stopSpring = null; }
    }

    /* Шторку ведёт JS: сдвиг и затемнение от него, CSS-переходы выключены */
    function setY(y) {
        curY = y;
        sheet.style.transform = `translateY(${y}px)`;
        const h = sheet.offsetHeight || 1;
        scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(0, y) / h)));
    }
    function takeOver() {
        sheet.classList.add('is-dragging');
        scrim.classList.add('is-dragging');
    }
    function handBack() {
        sheet.classList.remove('is-dragging');
        scrim.classList.remove('is-dragging');
        sheet.style.transform = '';
        scrim.style.opacity = '';
    }

    function show() {
        stopMotion();
        handBack();
        scrim.classList.add('is-shown');
        sheet.classList.add('is-open');
        isOpen = true;
        grabbableUntil = 0;
    }

    function close(opts = {}) {
        if (!isOpen) return;
        isOpen = false;
        swipe = null;
        stopMotion();
        if (opts.instant) {
            // keyboard: the state changes in this frame, the transition is back two frames later
            sheet.dataset.instant = '';
            scrim.dataset.instant = '';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                delete sheet.dataset.instant;
                delete scrim.dataset.instant;
            }));
        }
        grabbableUntil = opts.instant || opts.action ? 0 : performance.now() + DURATION.enter;
        handBack();   // после свайпа шторка уезжает от того места, где её отпустили: переход стартует с текущего значения
        sheet.classList.remove('is-open');
        scrim.classList.remove('is-shown');
        if (onClose) onClose();
    }

    /* Уехать пружиной от отпущенного места со скоростью пальца (закрытие свайпом) */
    function closeBySwipe(v) {
        if (!isOpen) return;
        isOpen = false;
        swipe = null;
        grabbableUntil = Infinity;   // пока едет пружина
        if (onClose) onClose();
        const h = sheet.offsetHeight;
        stopMotion();
        stopSpring = spring({
            from: curY, to: h, velocity: v, ...releaseSpring(v),
            onUpdate: (y) => setY(y),
            onDone: () => {
                stopSpring = null;
                grabbableUntil = 0;
                handBack();
                sheet.classList.remove('is-open');
                scrim.classList.remove('is-shown');
            },
        });
    }

    /* Вернуться на место пружиной со скоростью пальца */
    function settleOpen(v) {
        stopMotion();
        stopSpring = spring({
            from: curY, to: 0, velocity: v, ...releaseSpring(v),
            onUpdate: (y) => setY(y),
            onDone: () => { stopSpring = null; handBack(); },
        });
    }

    scrim.addEventListener('click', () => close());

    /* ---------- свайп вниз. Захват указателя — только после сдвига на SWIPE_START:
       до этого тапы по кнопкам работают как обычно ---------- */
    let swipe = null;
    let swallowClick = false;   // свайп закончился — click, который браузер пришлёт следом, не нажимает кнопку
    sheet.addEventListener('pointerdown', (e) => {
        const closing = !isOpen && performance.now() < grabbableUntil;
        if (!isOpen && !closing) return;
        let y0 = 0;
        if (stopSpring || closing) {
            // схватили на ходу: продолжить от видимого места
            const m = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
            y0 = m.m42;
            stopMotion();
            takeOver();
            setY(y0);
            if (closing) {
                isOpen = true;
                grabbableUntil = 0;
                sheet.classList.add('is-open');
                scrim.classList.add('is-shown');
            }
        }
        swipe = { pid: e.pointerId, yStart: e.clientY, base: y0, dy: y0, on: y0 !== 0, samples: [{ t: performance.now(), x: y0 }] };
        if (swipe.on) { try { sheet.setPointerCapture(e.pointerId); } catch {} }
    });
    sheet.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.pid) return;
        if (!e.buttons && e.pointerType === 'mouse') { swipe = null; return; }   // кнопку отпустили за пределами шторки
        const raw = swipe.base + (e.clientY - swipe.yStart);
        if (!swipe.on) {
            if (Math.abs(raw - swipe.base) < SWIPE_START) return;   // down or up past the slop
            swipe.on = true;
            try { sheet.setPointerCapture(e.pointerId); } catch {}
            takeOver();
        }
        const h = sheet.offsetHeight;
        const y = raw >= 0 ? raw : rubberband(raw, h, RUBBER);   // вверх — с растущим трением
        swipe.dy = y;
        swipe.samples.push({ t: performance.now(), x: y });
        if (swipe.samples.length > 12) swipe.samples.shift();
        setY(y);
    });
    function endSwipe(e) {
        if (!swipe || e.pointerId !== swipe.pid) return;
        const s = swipe;
        swipe = null;
        if (!s.on) return;
        swallowClick = true;
        setTimeout(() => { swallowClick = false; }, 0);
        const v = e.type === 'pointercancel' ? 0 : windowedVelocity(s.samples, performance.now());   // px/s, вниз > 0
        if (s.dy > SWIPE_CLOSE_PX || v / 1000 > FLICK_SPEED) { closeBySwipe(v); return; }
        settleOpen(v);
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
