/* ============================================================
   Слой меток фото поверх схемы.
   HTML-слой, а не SVG: размер меток постоянный в px экрана без пересчёта на зум.
   Слой и метки события не принимают (pointer-events: none) — жесты hall.js
   работают как раньше, попадание тапа считается здесь по координатам.
   ============================================================ */
import { loadPhotos, bindPhotos } from './photos.js';
import { buildTree, cutTree, buildItems } from './cluster.js';
import { SEL_HALF, SEL_RADIUS } from './seats.js';

const HIT_HALF = 22;   // половина наименьшей зоны касания 44×44 px
const SEAT_HIT_R = 8;  // радиус поиска кресла в SVG-юнитах, как в handleTap
const PRESS_SLOP = 6;  // жест стал паном — тот же порог, что TAP_DIST в hall.js
const CLUSTER_SPAN = 0.6;   // доля экрана между крайними креслами кластера после тапа
const CLUSTER_STEP = 2;     // шаг приближения, если кластер не распался на масштабе «60%»

/* Подсветка кресла после «Показать на схеме»: одна расходящаяся волна, без статичного кольца */
const RING_GAP = 2;    // px от края кресла или маркера до внутреннего края волны на старте
const RING_LINE = 4;   // px, толщина линии волны; совпадает с border в .seat-pulse-wave
const WAVE_GROW = 2.5; // волна вырастает до 2,5 стартового диаметра
const WAVE_MS = 1600;  // волна одна; её конец — конец подсветки
const PULSE_OFF_MS = 150;   // гашение по действию человека
const PULSE_EASE = 'cubic-bezier(.2, .8, .2, 1)';   // быстрый старт, мягкая остановка

// дальняя от центра точка скруглённого квадрата: полусторона h, радиус угла r, в единицах схемы
const reach = (h, r) => (h - r) * Math.SQRT2 + r;

/* Лупа метки 16×16 — компонент Figma «Search», Size=16, Style=Outline, ассет «Box»
   (node I4340:30131;552:206132), контур дословно; цвет из CSS (.ph--marker .ph-body) */
const LOUPE16 = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.03536 6.03335C3.09086 5.23972 3.11779 4.8429 3.45178 4.23033C3.6734 3.82385 4.32303 3.17422 4.7295 2.9526C5.34208 2.61861 5.7389 2.59086 6.53253 2.53536C6.84917 2.51322 7.17441 2.5 7.49965 2.5C7.8249 2.5 8.15014 2.51322 8.46678 2.53536C9.26041 2.59086 9.65723 2.61861 10.2698 2.9526C10.6763 3.17422 11.3259 3.82385 11.5475 4.23033C11.8815 4.8429 11.9093 5.23924 11.9648 6.03287C11.9869 6.34952 12.0001 6.67476 12.0001 7C12.0001 7.32524 11.9869 7.65048 11.9648 7.96713C11.9093 8.76076 11.8815 9.15806 11.5475 9.77063C11.5245 9.81292 11.4968 9.85785 11.4652 9.90464L13.7803 12.2198C13.9262 12.3657 13.9995 12.5568 14 12.748C14.0005 12.9407 13.9273 13.1335 13.7803 13.2805C13.6304 13.4304 13.4328 13.5035 13.2364 13.5C13.049 13.4966 12.8627 13.4234 12.7197 13.2805L10.4047 10.9654C10.3576 10.9973 10.3124 11.0252 10.2698 11.0484C9.65723 11.3823 9.26042 11.4091 8.46679 11.4646C8.15014 11.4868 7.8249 11.5 7.49965 11.5C7.17441 11.5 6.84917 11.4868 6.53253 11.4646C5.73889 11.4091 5.34208 11.3823 4.7295 11.0484C4.32303 10.8267 3.67339 10.1771 3.45178 9.77063C3.11779 9.15805 3.09086 8.76124 3.03536 7.9676C3.01322 7.65096 3 7.32572 3 7.00048C3 6.67524 3.01322 6.34999 3.03536 6.03335ZM6.63717 4.03171C6.92451 4.01162 7.21446 4 7.49965 4C7.78485 4 8.07479 4.01162 8.36214 4.03171C9.1477 4.08664 9.25111 4.10565 9.55177 4.26958C9.55978 4.27474 9.59864 4.29992 9.66573 4.35426C9.74153 4.41564 9.82898 4.49446 9.91733 4.5828C10.0057 4.67115 10.0845 4.75861 10.1459 4.8344C10.2002 4.9015 10.2248 4.93964 10.23 4.94765C10.3939 5.2483 10.4135 5.35196 10.4684 6.13751C10.4885 6.42486 10.5001 6.71481 10.5001 7C10.5001 7.28519 10.4885 7.57514 10.4684 7.86249C10.4135 8.64804 10.3945 8.75194 10.2306 9.05259C10.2254 9.0606 10.2002 9.09946 10.1459 9.16656C10.0845 9.24235 10.0057 9.32981 9.91733 9.41815C9.82899 9.5065 9.74153 9.58532 9.66573 9.6467C9.59863 9.70104 9.5605 9.72562 9.55249 9.73078C9.25183 9.8947 9.1477 9.91431 8.36214 9.96925C8.0748 9.98934 7.78485 10.001 7.49965 10.001C7.21446 10.001 6.92451 9.98934 6.63717 9.96925C5.85161 9.91431 5.7482 9.8953 5.44754 9.73138C5.43953 9.72622 5.40067 9.70104 5.33358 9.6467C5.25778 9.58532 5.17032 9.5065 5.08198 9.41815C4.99363 9.32981 4.91481 9.24235 4.85343 9.16656C4.7991 9.09946 4.77452 9.06133 4.76935 9.05331C4.60543 8.75266 4.58664 8.64852 4.53171 7.86296C4.51162 7.57562 4.5 7.28567 4.5 7.00048C4.5 6.71528 4.51162 6.42534 4.53171 6.13799C4.58664 5.35244 4.60483 5.24902 4.76875 4.94837C4.77391 4.94036 4.79909 4.9015 4.85343 4.8344C4.91481 4.75861 4.99364 4.67115 5.08198 4.5828C5.17032 4.49446 5.25778 4.41564 5.33358 4.35426C5.40067 4.29992 5.43881 4.27534 5.44682 4.27018C5.74748 4.10625 5.85161 4.08664 6.63717 4.03171Z" fill="currentColor"/>'
    + '</svg>';

/* Метка: светлый кружок 24 px с обводкой — из CSS. Кластер: диаметр по ступеням — инлайн из it.d, та же цифра,
   по которой считаются касание и наезд кругов. Меньший круг лежит выше: крупный кластер ниже,
   меньший выше, метка (24 px) выше любого кластера (40–88 px). */
function createEl(it) {
    const el = document.createElement('div');
    el.className = 'ph ' + (it.kind === 'marker' ? 'ph--marker' : 'ph--cluster');
    el.dataset.key = it.key;
    el.style.zIndex = String(100 - it.d);
    const body = it.kind === 'marker' ? LOUPE16 : `<span class="ph-num">${it.count}</span>`;
    el.innerHTML = `<span class="ph-anim"><span class="ph-body">${body}</span></span>`;
    if (it.kind === 'cluster') {
        const b = el.querySelector('.ph-body');
        b.style.width = `${it.d}px`;
        b.style.height = `${it.d}px`;
    }
    return el;
}

const tf = (it) => `translate(${it.sx}px, ${it.sy}px) translate(-50%, -50%)`;

/* Разъезд: часть появляется в точке кластера (смещение dx, dy от своего места) уменьшенной
   и полупрозрачной и едет к своему месту. Анимируется .ph-anim: позицию держит .ph, нажатие — .ph-body. */
function playSpread(animEl, dx, dy) {
    animEl.animate(
        [
            { transform: `translate(${dx}px, ${dy}px) scale(.6)`, opacity: 0.5 },
            { transform: 'none', opacity: 1 },
        ],
        { duration: 250, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
}

/* hall — HallViewport; viewportEl — .map-viewport; seats — модель мест из buildSeats;
   nearestSeat — findNearestSeat из main.js; config — PHOTO_CONFIG, во время работы не меняется. */
export function createPhotoMap({ hall, viewportEl, seats, nearestSeat, config }) {
    const cfg = config;
    const seatsById = new Map(seats.map((s) => [s.id, s]));

    const layerEl = document.createElement('div');
    layerEl.className = 'photo-layer is-off';
    layerEl.setAttribute('aria-hidden', 'true');
    const contentEl = viewportEl.querySelector('.map-content');
    viewportEl.insertBefore(layerEl, contentEl ? contentEl.nextSibling : null);

    // подсветка кресла — отдельно от слоя меток: при выключенном режиме он прозрачен
    const pulseEl = document.createElement('div');
    pulseEl.className = 'seat-pulse';
    pulseEl.hidden = true;
    pulseEl.setAttribute('aria-hidden', 'true');
    pulseEl.innerHTML = '<span class="seat-pulse-wave"></span>';
    viewportEl.insertBefore(pulseEl, layerEl.nextSibling);
    const waveEl = pulseEl.firstElementChild;

    let enabled = false;
    let nodes = [];             // узлы из bindPhotos, порядок данных
    let bySeat = new Map();     // seatId → узел
    let gallery = [];           // узлы в порядке галереи: секция, ряд от сцены, место слева направо
    let items = [];             // элементы слоя (см. buildItems)
    let els = new Map();        // key → div.ph
    let prevBySeat = new Map(); // seatId → элемент, где кресло было до пересборки (для разъезда)
    let tree = { merges: [], aloneK: [] };   // дерево слияний: строится в setPhotos один раз на загрузку данных
    let lastK = null;           // px на SVG-юнит при прошлой пересборке: по нему режется дерево слияний
    let dirty = true;

    /* ---------- позиции и сверка DOM ---------- */
    // vt — hall.viewTransform(), один раз на кадр
    function place({ k, ox, oy }) {
        for (const it of items) {
            it.sx = it.x * k + ox;
            it.sy = it.y * k + oy;
            const el = els.get(it.key);
            if (el) el.style.transform = tf(it);
        }
    }

    /* Сверка DOM по key. Новый элемент, чьё кресло раньше было в элементе крупнее, —
       часть распавшегося кластера: разлетается из точки родителя в этом же кадре.
       Кластер, который распался, удаляется сразу, без затухания; слияние при отдалении — без анимации. */
    function reconcile({ k, ox, oy }) {
        const next = new Map();
        for (const it of items) {
            let el = els.get(it.key);
            if (!el) {
                el = createEl(it);
                el.style.transform = tf(it);
                layerEl.appendChild(el);
                const parent = prevBySeat.get(it.members[0].seatId);
                if (parent && parent.count > it.count) {
                    playSpread(el.firstChild, parent.x * k + ox - it.sx, parent.y * k + oy - it.sy);
                }
            }
            next.set(it.key, el);
        }
        for (const [key, el] of els) if (!next.has(key)) el.remove();
        els = next;
        prevBySeat = new Map();
        for (const it of items) for (const m of it.members) prevBySeat.set(m.seatId, it);
    }

    /* ---------- кресло с фото в заказе ---------- */

    /* Вместо метки виден маркер выбранного места с галочкой (js/seats.js). Прячется только
       одиночная метка: фото в кластере — кластер лежит поверх маркера, число не меняется. */
    const isSel = (it) => it.kind === 'marker' && it.members[0].seat.selected;

    function paintSelected() {
        for (const it of items) {
            const el = els.get(it.key);
            if (el) el.classList.toggle('is-selected', isSel(it));
        }
    }

    /* Из main.js после каждой перерисовки маркеров выбранных мест */
    function syncSelected() {
        paintSelected();
    }

    /* Полный пересчёт кластеров: дерево слияний режется по текущему vt.k.
       С disableAtScale кластеризация отключена: каждое кресло — своя метка. */
    function rebuild(vt) {
        dirty = false;
        const off = hall.scale >= cfg.disableAtScale - 1e-3;
        const groups = off ? nodes.map((_, i) => [i]) : cutTree(nodes.length, tree.merges, vt.k);
        items = buildItems(nodes, groups, cfg);
        place(vt);
        reconcile(vt);
        paintSelected();   // новые элементы после зума: метка кресла в заказе тоже прячется
    }

    /* Из hall.opts.onView: состав пересобирается при смене px на SVG-юнит (зум, ресайз)
       и после загрузки данных; при пане меняются только позиции. */
    function update() {
        const vt = hall.viewTransform();
        if (vt.k !== lastK) {
            lastK = vt.k;
            dirty = true;
        }
        if (dirty) rebuild(vt);
        else place(vt);
        placePulse(vt);
    }

    function setPhotos(list) {
        nodes = bindPhotos(list, seatsById);
        bySeat = new Map(nodes.map((n) => [n.seatId, n]));
        // y растёт от сцены назад и от партера к балкону, x — слева направо; у кресел одного ряда y одинаковый
        gallery = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
        tree = buildTree(nodes, cfg);
        prevBySeat = new Map();   // при загрузке данных разъезд не играет
        dirty = true;
        update();
    }

    /* Тап по кластеру: один шаг приближения. Не распался — следующий тап приближает ещё в CLUSTER_STEP раз. */
    function zoomToCluster(it) {
        try {
            hall.focusOnSvgBox(it.box, CLUSTER_SPAN, CLUSTER_STEP);
        } catch (e) {
            console.error('Метки фото: зум к кластеру не удался', e);
        }
    }

    function load(url) {
        return loadPhotos(url).then((list) => {
            try {
                setPhotos(list);
            } catch (e) {
                console.error('Метки фото: данные не разложены по креслам', e);
            }
        });
    }

    /* ---------- правила касания ---------- */

    /* Попала ли точка в видимую фигуру: метка — круг it.d, спрятанная метка — маркер выбранного
       места, квадрат 2 · SEL_HALF единиц схемы. */
    function inBody(it, dx, dy, dist) {
        if (!isSel(it)) return dist <= it.d / 2;
        const half = SEL_HALF * lastK;
        return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }

    /* Элемент, в который попадает точка (lx, ly) в px вьюпорта.
       byBody: true — по видимой фигуре, из нескольких — верхний: меньший диаметр, при равном — ближний центр;
       маркер выбранного места лежит в SVG под слоем меток — ниже любого круга слоя;
       false — по зоне касания (квадрат со стороной max(44, d)), из нескольких — ближний центр. */
    function nearestItem(lx, ly, byBody) {
        let best = null;
        let bestDist = Infinity;
        let bestRank = Infinity;
        for (const it of items) {
            if (!els.has(it.key)) continue;
            const dx = lx - it.sx;
            const dy = ly - it.sy;
            const dist = Math.hypot(dx, dy);
            if (byBody) {
                if (!inBody(it, dx, dy, dist)) continue;
                const rank = isSel(it) ? Infinity : it.d;
                const above = !best || rank < bestRank || (rank === bestRank && dist < bestDist);
                if (above) { best = it; bestDist = dist; bestRank = rank; }
            } else {
                const half = Math.max(HIT_HALF, it.d / 2);
                if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
                if (dist < bestDist) { best = it; bestDist = dist; }
            }
        }
        return best;
    }

    const asHit = (it) => (it.kind === 'marker'
        ? { type: 'photo', node: it.members[0], item: it }
        : { type: 'cluster', item: it });

    // кресло, в контур которого (квадрат 8×8 SVG-юнитов) попала точка
    function seatAt(p) {
        return seats.find((s) => {
            const x = +s.el.getAttribute('x');
            const y = +s.el.getAttribute('y');
            return p.x >= x && p.x <= x + 8 && p.y >= y && p.y <= y + 8;
        }) || null;
    }

    /* Порядок: кружок метки → свободное кресло без фото → зона касания метки →
       ближайшее кресло с фото → null (тап уходит креслам по прежнему пути). */
    function resolveTap(clientX, clientY) {
        if (!enabled) return null;
        const r = viewportEl.getBoundingClientRect();
        const lx = clientX - r.left;
        const ly = clientY - r.top;
        const body = nearestItem(lx, ly, true);
        if (body) return asHit(body);
        const p = hall.clientToSvg(clientX, clientY);
        if (!p) return null;
        const seat = seatAt(p);
        if (seat && seat.status === 'available' && !bySeat.has(seat.id)) return { type: 'seat', seat };
        const zone = nearestItem(lx, ly, false);
        if (zone) return asHit(zone);
        const near = nearestSeat(p.x, p.y, SEAT_HIT_R);
        if (near && bySeat.has(near.id)) return { type: 'photo', node: bySeat.get(near.id) };
        return null;
    }

    /* ---------- нажатие: кружок 0,9 на время касания ---------- */
    let pressed = null;
    let pressAt = null;
    const release = () => {
        if (pressed) pressed.classList.remove('is-pressed');
        pressed = null;
    };
    viewportEl.addEventListener('pointerdown', (e) => {
        release();
        try {
            const hit = resolveTap(e.clientX, e.clientY);
            pressed = hit && hit.item ? els.get(hit.item.key) || null : null;
        } catch (err) {
            console.error('Метки фото: нажатие не разобрано', err);
            pressed = null;
        }
        if (!pressed) return;
        pressed.classList.add('is-pressed');
        pressAt = { x: e.clientX, y: e.clientY };
    });
    viewportEl.addEventListener('pointermove', (e) => {
        if (pressed && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > PRESS_SLOP) release();
    });
    viewportEl.addEventListener('pointerup', release);
    viewportEl.addEventListener('pointercancel', release);

    /* ---------- режим ---------- */
    function setEnabled(on) {
        enabled = !!on;
        layerEl.classList.toggle('is-off', !enabled);
        release();
    }

    /* ---------- подсветка кресла после «Показать на схеме» ---------- */
    let pulseSeat = null;   // кресло под подсветкой; null — подсветки нет
    let pulseAnims = [];
    let pulseFade = null;

    /* Стартовый внешний диаметр волны в px (внутренний край на RING_GAP снаружи кресла): кресло 8×8 со своим rx; кресло в заказе — маркер */
    function ringDiameter(seat, k) {
        const units = seat.selected
            ? reach(SEL_HALF, SEL_RADIUS)
            : reach(4, +seat.el.getAttribute('rx') || 0);
        return 2 * (units * k + RING_GAP + RING_LINE);
    }

    function placePulse({ k, ox, oy }) {
        if (!pulseSeat) return;
        const x = +pulseSeat.el.getAttribute('x') + 4;
        const y = +pulseSeat.el.getAttribute('y') + 4;
        pulseEl.style.transform = `translate(${x * k + ox}px, ${y * k + oy}px)`;
    }

    /* Сразу, без затухания: конец сценария или новая подсветка */
    function stopPulse() {
        pulseSeat = null;
        pulseEl.hidden = true;
        pulseAnims.forEach((a) => a.cancel());
        pulseAnims = [];
        if (pulseFade) { pulseFade.cancel(); pulseFade = null; }
    }

    function highlightSeat(seatId) {
        stopPulse();
        const seat = seatsById.get(seatId);
        if (!seat) return;
        pulseSeat = seat;
        // цвет волны — заливка кресла из SVG: полный цвет тира у свободного и у кресла в заказе,
        // серый у занятого; приглушение режима фото — fill-opacity в CSS, атрибут fill оно не трогает
        pulseEl.style.color = seat.el.getAttribute('fill');
        const vt = hall.viewTransform();
        const d = ringDiameter(seat, vt.k);
        waveEl.style.width = `${d}px`;
        waveEl.style.height = `${d}px`;
        placePulse(vt);
        pulseEl.hidden = false;
        const wave = waveEl.animate(
            [
                { width: `${d}px`, height: `${d}px`, opacity: 0.6 },
                { width: `${d * WAVE_GROW}px`, height: `${d * WAVE_GROW}px`, opacity: 0 },
            ],
            { duration: WAVE_MS, easing: PULSE_EASE },
        );
        pulseAnims = [wave];
        wave.onfinish = stopPulse;   // конец волны — конец подсветки
    }

    /* Действие человека: волна гаснет за 150 мс; повторно подсветка не возвращается */
    function hideHighlight() {
        if (!pulseSeat || pulseFade) return;
        pulseFade = pulseEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PULSE_OFF_MS, easing: 'ease-out', fill: 'forwards' });
        pulseFade.onfinish = stopPulse;
    }

    return {
        load,
        setEnabled,
        hasPhoto: (seatId) => bySeat.has(seatId),
        gallery: () => gallery,
        update,
        syncSelected,
        resolveTap,
        zoomToCluster,
        highlightSeat,
        hideHighlight,
    };
}
