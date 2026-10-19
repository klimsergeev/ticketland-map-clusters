/* ============================================================
   Слой меток фото поверх схемы.
   HTML-слой, а не SVG: размер меток постоянный в px экрана без пересчёта на зум.
   Слой и метки события не принимают (pointer-events: none) — жесты hall.js
   работают как раньше, попадание тапа считается здесь по координатам.
   ============================================================ */
import { loadPhotos, bindPhotos, CAMERA16_PATHS } from './photos.js';
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

// фотоаппарат метки: 16×16, цвет из CSS (.ph--marker .ph-body)
const CAMERA16 = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">${CAMERA16_PATHS}</svg>`;

/* Метка: белый кружок 24 px — из CSS. Кластер: диаметр по ступеням — инлайн из it.d, та же цифра,
   по которой считаются касание и наезд кругов. Меньший круг лежит выше: крупный кластер ниже,
   меньший выше, метка (24 px) выше любого кластера (40–88 px). */
function createEl(it) {
    const el = document.createElement('div');
    el.className = 'ph ' + (it.kind === 'marker' ? 'ph--marker' : 'ph--cluster');
    el.dataset.key = it.key;
    el.style.zIndex = String(100 - it.d);
    const body = it.kind === 'marker' ? CAMERA16 : `<span class="ph-num">${it.count}</span>`;
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
