/* ============================================================
   Кнопка режима фото и карточка с фото (вид с места).
   ============================================================ */
import { cameraSvg } from './photo-map.js';

const icoCross =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

const CARD_MS = 250;        // открытие и закрытие карточки
const RETURN_MS = 150;      // возврат карточки после короткого свайпа
const SWIPE_CLOSE = 80;     // px: свайп вниз дальше — закрытие
const SWIPE_SLOP = 6;       // px: меньше — это тап по кнопке, а не свайп

/* Кнопка режима: капсула «Фото» под шапкой справа. Клик → onChange(!on). */
export function createPhotoToggle({ parentEl, onChange }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<span class="photo-toggle-body">${cameraSvg(16)}<span class="photo-toggle-label">Фото</span></span>`;
    let on = false;
    btn.addEventListener('click', () => onChange(!on));
    parentEl.appendChild(btn);
    return {
        setOn(v) {
            on = !!v;
            btn.setAttribute('aria-pressed', String(on));
            btn.classList.toggle('is-on', on);
        },
    };
}

/* Карточка с фото. open(node) — узел из bindPhotos; close(onDone) — onDone через 250 мс
   по таймеру, а не по transitionend: колбэк приходит, даже если переход не сыграл. */
export function createPhotoCard({ parentEl, onSelect }) {
    const el = document.createElement('div');
    el.className = 'photo-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Вид с места');
    el.innerHTML =
        '<div class="photo-card-media">'
        + '<img class="photo-card-img" alt="" draggable="false">'
        + `<button class="photo-card-close" type="button" aria-label="Закрыть"><span class="photo-card-close-body">${icoCross}</span></button>`
        + '</div>'
        + '<div class="photo-card-caption"></div>'
        + '<button class="photo-card-select" type="button">Выбрать места</button>';
    parentEl.appendChild(el);

    const img = el.querySelector('.photo-card-img');
    const caption = el.querySelector('.photo-card-caption');
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });   // битая картинка — серый блок

    let isOpen = false;
    let node = null;
    let doneTimer = null;
    let returnTimer = null;

    function open(n) {
        node = n;
        clearTimeout(doneTimer);
        clearTimeout(returnTimer);
        img.style.visibility = '';
        img.alt = n.photo.caption || '';
        img.src = n.photo.url;
        const s = n.seat;
        caption.textContent = `Вид с места: ${s.section.toLowerCase()}, ряд ${s.row}, место ${s.seat}`;
        el.style.transition = '';
        el.style.transform = '';
        el.classList.add('is-open');
        isOpen = true;
    }

    function close(onDone) {
        clearTimeout(returnTimer);
        if (!isOpen) {
            if (onDone) onDone();
            return;
        }
        isOpen = false;
        drag = null;
        // инлайн-стили свайпа снимаются в том же кадре: переход идёт от текущей точки вниз
        el.style.transition = '';
        el.style.transform = '';
        el.classList.remove('is-open');
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (onDone) onDone(); }, CARD_MS);
    }

    el.querySelector('.photo-card-close').addEventListener('click', () => close());
    el.querySelector('.photo-card-select').addEventListener('click', () => {
        if (isOpen && node) onSelect(node);
    });

    /* Свайп вниз: карточка едет за пальцем вниз, вверх не едет.
       Захват указателя — только когда жест стал свайпом, иначе клик по кнопкам ушёл бы карточке. */
    let drag = null;   // { pid, y0, dy, active }
    el.addEventListener('pointerdown', (e) => {
        if (!isOpen) return;
        drag = { pid: e.pointerId, y0: e.clientY, dy: 0, active: false };
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pid) return;
        const dy = e.clientY - drag.y0;
        if (!drag.active) {
            if (Math.abs(dy) <= SWIPE_SLOP) return;
            drag.active = true;
            try { el.setPointerCapture(e.pointerId); } catch {}
            el.style.transition = 'none';
        }
        drag.dy = Math.max(0, dy);
        el.style.transform = `translateY(${drag.dy}px)`;
    });
    const endDrag = (e) => {
        if (!drag || e.pointerId !== drag.pid) return;
        const d = drag;
        drag = null;
        if (!d.active) return;
        try { el.releasePointerCapture(e.pointerId); } catch {}
        if (d.dy > SWIPE_CLOSE) { close(); return; }
        el.style.transition = `transform ${RETURN_MS}ms ease-out`;
        el.style.transform = '';
        clearTimeout(returnTimer);
        returnTimer = setTimeout(() => { el.style.transition = ''; }, RETURN_MS);
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    return {
        open,
        close,
        isOpen: () => isOpen,
    };
}
