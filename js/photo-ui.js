/* ============================================================
   Кнопка режима фото, тултип над ней и карточка с фото (вид с места).
   ============================================================ */

// Фотоаппарат 24×24 — ассет Figma «Box», node I4300:19819;1:3080;74516:413794;547:208255
const icoCamera24 =
    '<svg class="photo-btn-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M14.2501 13C14.2501 14.2427 13.2427 15.2501 12.0001 15.2501C10.7574 15.2501 9.75006 14.2427 9.75006 13C9.75006 11.7574 10.7574 10.75 12.0001 10.75C13.2427 10.75 14.2501 11.7574 14.2501 13Z" fill="currentColor"/>'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M20.4245 7.78296C19.4575 6.81023 18.644 6.51432 17.4506 6.35853C17.3713 5.7611 17.1599 5.25207 16.5966 4.56226C16.5324 4.48363 16.3418 4.27705 16.2686 4.20674C15.2402 3.2194 14.5182 3.16128 13.074 3.04504C12.7214 3.01665 12.3609 3 12.0003 3C11.6169 3 11.2319 3.01884 10.8554 3.0506C9.5533 3.16043 8.90225 3.21534 7.93071 4.03085C7.75748 4.17626 7.3637 4.60465 7.23337 4.78948C6.80513 5.39681 6.62778 5.85007 6.55433 6.35772C5.35765 6.51326 4.5432 6.80838 3.57438 7.78281C2.27261 9.09211 2.20185 10.0332 2.06032 11.9154C2.02166 12.4296 1.9989 12.9713 1.9989 13.5343C1.9989 14.0974 2.02167 14.6391 2.06033 15.1533C2.20186 17.0355 2.27262 17.9765 3.57438 19.2858C4.87613 20.5951 5.89914 20.678 7.94515 20.8437C9.09778 20.9371 10.4499 21.0002 11.9993 21.0002C13.5481 21.0002 14.8998 20.9371 16.0523 20.8438C18.0992 20.6781 19.1226 20.5952 20.4245 19.2857C21.7264 17.9761 21.797 17.0346 21.9384 15.1514C21.9769 14.6378 21.9996 14.0967 21.9996 13.5343C21.9996 12.9721 21.9769 12.431 21.9384 11.9174C21.797 10.0341 21.7264 9.0925 20.4245 7.78296ZM16.2501 13C16.2501 15.3473 14.3473 17.2501 12.0001 17.2501C9.65286 17.2501 7.75006 15.3473 7.75006 13C7.75006 10.6528 9.65286 8.75 12.0001 8.75C14.3473 8.75 16.2501 10.6528 16.2501 13Z" fill="currentColor"/>'
    + '</svg>';

// Хвостик тултипа 60×8 — ассет Figma «Arrow», node I4300:19820;5010:334
const icoTipArrow =
    '<svg class="photo-tip-arrow" width="60" height="8" viewBox="0 0 60 8" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M42.5 8C39.5 8 36.5001 0 32.5 0H52.5C48.5251 0 45.5 8 42.5 8Z" fill="currentColor"/>'
    + '</svg>';

const icoCross =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

const CARD_MS = 250;        // открытие и закрытие карточки
const RETURN_MS = 150;      // возврат карточки после короткого свайпа
const SWIPE_CLOSE = 80;     // px: свайп вниз дальше — закрытие
const SWIPE_SLOP = 6;       // px: меньше — это тап по кнопке, а не свайп

const TIP_TEXT = 'Посмотрите фото с мест, чтобы выбрать лучшие';
const TIP_DELAY_MS = 1000;   // от отрисовки схемы до появления
const TIP_IN_MS = 200;       // проявление
const TIP_HOLD_MS = 5000;    // показ после полного проявления

/* Кнопка режима в доке у правого нижнего угла. Клик → onChange(!on).
   → { dockEl, setOn(on), setLift(px) }; dockEl — родитель для тултипа */
export function createPhotoToggle({ parentEl, onChange }) {
    const dock = document.createElement('div');
    dock.className = 'photo-dock';
    dock.innerHTML =
        '<button class="photo-btn" type="button" aria-label="Показать фото">'
        + '<span class="photo-btn-label" aria-hidden="true">Скрыть фото</span>'
        + icoCamera24
        + '</button>';
    parentEl.appendChild(dock);

    const btn = dock.querySelector('.photo-btn');
    const label = dock.querySelector('.photo-btn-label');
    let on = false;
    btn.addEventListener('click', () => onChange(!on));

    // ширина включённой: 10 + иконка 24 + 8 + подпись + 8 + 10. Меряется при каждом включении:
    // подпись набрана Statika, а не шрифтом макета, ширина 164 px из Figma не подходит
    // getBoundingClientRect, а не offsetWidth: тот округляет ширину текста, и справа выходило бы не ровно 18 px
    const fitWidth = () => { if (on) btn.style.width = `${60 + label.getBoundingClientRect().width}px`; };
    document.fonts.ready.then(fitWidth);   // включили до загрузки шрифта — ширина по настоящему шрифту

    return {
        dockEl: dock,
        setOn(v) {
            on = !!v;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-label', on ? 'Скрыть фото' : 'Показать фото');
            if (on) fitWidth();
            else btn.style.width = '';   // назад к 44 px из CSS — переход ширины в обратную сторону
        },
        setLift(px) {
            dock.style.transform = px > 0 ? `translateY(${-px}px)` : '';
        },
    };
}

/* Тултип над кнопкой режима. Один раз за загрузку страницы.
   → { schedule(), dismiss() }: schedule — запустить отсчёт 1 с; dismiss — погасить или отменить навсегда */
export function createPhotoTip({ parentEl }) {
    const el = document.createElement('div');
    el.className = 'photo-tip';
    el.setAttribute('aria-hidden', 'true');   // диктору текст отдаёт live-строка ниже
    el.innerHTML = `<div class="photo-tip-body">${TIP_TEXT}</div>${icoTipArrow}`;
    parentEl.appendChild(el);

    // Live-строка вне тултипа: тултип до показа visibility: hidden, а скрытый live-регион диктор не слушает.
    // Пустая до показа; текст вписывается в момент показа — зачитывается один раз, вежливо
    const sr = document.createElement('span');
    sr.className = 'photo-sr';
    sr.setAttribute('aria-live', 'polite');
    parentEl.appendChild(sr);

    let state = 'idle';   // idle → pending → shown → done; из done не возвращается до перезагрузки
    let timer = null;

    function schedule() {
        if (state !== 'idle') return;
        state = 'pending';
        timer = setTimeout(show, TIP_DELAY_MS);
    }

    function show() {
        state = 'shown';
        el.classList.add('is-shown');
        sr.textContent = TIP_TEXT;
        timer = setTimeout(dismiss, TIP_IN_MS + TIP_HOLD_MS);
    }

    // Любая причина — таймер, касание схемы, кнопка, касание тултипа — одно и то же исчезновение.
    // До показа (idle, pending) — отмена: в эту загрузку тултипа не будет
    function dismiss() {
        clearTimeout(timer);
        if (state === 'shown') {
            el.classList.remove('is-shown');
            el.classList.add('is-gone');
        }
        state = 'done';
    }

    el.addEventListener('pointerdown', dismiss);
    return { schedule, dismiss };
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
