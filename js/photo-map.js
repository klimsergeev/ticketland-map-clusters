/* ============================================================
   Слой меток фото поверх схемы.
   HTML-слой, а не SVG: размер меток постоянный в px экрана без пересчёта на зум.
   Слой и метки события не принимают (pointer-events: none) — жесты hall.js
   работают как раньше, попадание тапа считается здесь по координатам.
   ============================================================ */
import { loadPhotos, bindPhotos } from './photos.js';
import { clusterize, buildItems } from './cluster.js';

const HIT_HALF = 22;   // половина зоны касания 44×44 px
const SEAT_HIT_R = 8;  // радиус поиска кресла в SVG-юнитах, как в handleTap
const PRESS_SLOP = 6;  // жест стал паном — тот же порог, что TAP_DIST в hall.js
const CLUSTER_FOCUS_PAD = 48;   // px вокруг содержимого кластера при зуме: метки по краю видны целиком

/* Фотоаппарат: скруглённый корпус и круглый объектив. Тот же рисунок — в кнопке режима (16 px). */
export function cameraSvg(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">`
        + '<rect x="4" y="1.5" width="4" height="2" rx="0.75" fill="currentColor"/>'
        + '<rect x="0.75" y="3" width="10.5" height="7.5" rx="1.75" fill="currentColor"/>'
        + '<circle class="ph-lens" cx="6" cy="6.75" r="2.1"/>'
        + '</svg>';
}

function createEl(it) {
    const el = document.createElement('div');
    el.className = 'ph ' + (it.kind === 'marker' ? 'ph--marker' : 'ph--cluster')
        + (it.count >= 100 ? ' ph--wide' : it.count >= 10 ? ' ph--mid' : '');
    el.dataset.key = it.key;
    const body = it.kind === 'marker' ? cameraSvg(12) : `<span class="ph-num">${it.count}</span>`;
    el.innerHTML = `<span class="ph-anim"><span class="ph-body">${body}</span></span>`;
    return el;
}

/* После вставки в DOM: полуразмеры кружка с обводкой 2 px — для попадания «по кружку».
   offsetWidth трансформацию не учитывает, поэтому замер верный при любом нажатии и анимации. */
function measure(el) {
    const b = el.querySelector('.ph-body');
    el._bodyHalfW = b.offsetWidth / 2 + 2;
    el._bodyHalfH = b.offsetHeight / 2 + 2;
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

    let enabled = false;
    let nodes = [];             // узлы из bindPhotos, порядок данных
    let bySeat = new Map();     // seatId → узел
    let items = [];             // элементы слоя (см. buildItems)
    let els = new Map();        // key → div.ph
    let prevBySeat = new Map(); // seatId → элемент, где кресло было до пересборки (для разъезда)
    let lastK = null;           // px на SVG-юнит при прошлой пересборке: от него зависит порог
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
                measure(el);
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

    /* Полный пересчёт кластеров. Порог объединения — radiusPx в SVG-юнитах текущего масштаба.
       С disableAtScale кластеризация отключена: каждое кресло — своя метка. */
    function rebuild(vt) {
        dirty = false;
        const off = hall.scale >= cfg.disableAtScale - 1e-3;
        const groups = off ? nodes.map((_, i) => [i]) : clusterize(nodes, cfg.radiusPx / vt.k);
        items = buildItems(nodes, groups, cfg);
        place(vt);
        reconcile(vt);
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
    }

    function setPhotos(list) {
        nodes = bindPhotos(list, seatsById);
        bySeat = new Map(nodes.map((n) => [n.seatId, n]));
        prevBySeat = new Map();   // при загрузке данных разъезд не играет
        dirty = true;
        update();
    }

    /* Тап по кластеру: схема вписывает его кресла в видимую полосу — масштаб растёт в разы,
       кластер распадается. Упрётся в MAX_SCALE — распадается, там кластеризация отключена. */
    function zoomToCluster(it) {
        try {
            hall.focusOnSvgBox(it.box, CLUSTER_FOCUS_PAD);
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

    /* Ближайший элемент, в который попадает точка (lx, ly) в px вьюпорта.
       byBody: true — только по кружку (капсуле), false — по зоне касания. */
    function nearestItem(lx, ly, byBody) {
        let best = null;
        let bestD = Infinity;
        for (const it of items) {
            const el = els.get(it.key);
            if (!el) continue;
            const dx = Math.abs(lx - it.sx);
            const dy = Math.abs(ly - it.sy);
            const inside = byBody
                // расстояние до капсулы: у круга halfW = halfH, у капсулы от 100 прямой участок halfW - halfH
                ? Math.hypot(Math.max(0, dx - (el._bodyHalfW - el._bodyHalfH)), dy) <= el._bodyHalfH
                : dx <= Math.max(HIT_HALF, el._bodyHalfW) && dy <= HIT_HALF;
            if (!inside) continue;
            const d = Math.hypot(dx, dy);
            if (d < bestD) { bestD = d; best = it; }
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

    /* ---------- режим и масштаб для «Выбрать места» ---------- */
    function setEnabled(on) {
        enabled = !!on;
        layerEl.classList.toggle('is-off', !enabled);
        release();
    }

    /* Масштаб, с которого метка кресла гарантированно не входит в кластер: при полной связи
       кресло ни с кем не сливается, если все остальные кресла с фото дальше порога объединения.
       Не выше disableAtScale: там кластеризация отключена. */
    function aloneScale(node) {
        let d = Infinity;
        for (const m of nodes) if (m !== node) d = Math.min(d, Math.hypot(m.x - node.x, m.y - node.y));
        if (!Number.isFinite(d) || d <= 0) return 0;
        const cover = hall.pxPerUnit() / hall.scale;           // px на SVG-юнит при scale = 1
        const s = (cfg.radiusPx / (d * cover)) * 1.02;       // запас 2 % против погрешности на самом пороге
        return Math.min(cfg.disableAtScale, s);
    }

    return {
        load,
        setEnabled,
        hasPhoto: (seatId) => bySeat.has(seatId),
        update,
        resolveTap,
        aloneScale,
        zoomToCluster,
    };
}
