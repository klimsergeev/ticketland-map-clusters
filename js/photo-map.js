/* ============================================================
   Слой меток фото поверх схемы.
   HTML-слой, а не SVG: размер меток задан в px экрана и не масштабируется вместе со схемой
   (лупа меняется только ступенями 16 / 24 / 32 по размеру кресла).
   Слой и метки события не принимают (pointer-events: none) — жесты hall.js
   работают как раньше, попадание тапа считается здесь по координатам.
   ============================================================ */
import { loadPhotos, bindPhotos } from './photos.js';
import { buildTree, cutTree, buildItems } from './cluster.js';
import { SEL_HALF, SEL_RADIUS, SEL_COLOR } from './seats.js';

const HIT_HALF = 22;   // половина наименьшей зоны касания 44×44 px
const SEAT_HIT_R = 8;  // радиус поиска кресла в SVG-юнитах, как в handleTap
const SEAT_UNITS = 8;  // сторона кресла в SVG-юнитах: rect 8×8 (js/seats.js); s = SEAT_UNITS · k
const PRESS_SLOP = 6;  // жест стал паном — тот же порог, что TAP_DIST в hall.js
const CLUSTER_SPAN = 0.6;   // доля экрана между крайними креслами кластера после тапа
const CLUSTER_STEP = 2;     // шаг приближения, если кластер не распался на масштабе «60%»

/* Подсветка кресла после «Показать на схеме»: контур в форме кресла цветом кресла,
   посадка и один ореол, дальше контур стоит до касания */
const HL_GAP = 2;                // px экрана, белый зазор между креслом и контуром
const HL_LINE = 3;               // px экрана, линия контура и ореола; = border в .seat-hl-ring и .seat-hl-halo
const HL_LAND_FROM = 1.6;        // посадка стартует в 1,6 размера покоя
const HL_LAND_UNDER = 0.95;      // перелёт посадки
const HL_LAND_UNDER_MS = 300;    // момент перелёта
const HL_LAND_MS = 350;
const HL_SHOW_MS = 100;          // непрозрачность контура 0 → 1
const HL_HALO_AT = 450;          // старт ореола от появления контура
const HL_HALO_MS = 700;
const HL_HALO_GROW = 2;          // ореол вырастает до 2 размеров контура
const HL_HALO_OPACITY = 0.5;
const HL_OFF_MS = 150;           // гашение по касанию
const HL_EASE = 'cubic-bezier(.33, 1, .68, 1)';   // быстрый старт, мягкая остановка

/* Видимая фигура кресла в единицах схемы: полусторона h и радиус угла r.
   Кресло в заказе — маркер выбора (js/seats.js). Занятое кресло в hall.svg — заливка и поверх неё rect
   с теми же x, y и белой обводкой: обводка по центру края съедает stroke-width / 2 с каждой стороны. */
function seatShape(seat) {
    if (seat.selected) return { h: SEL_HALF, r: SEL_RADIUS };
    const el = seat.el;
    const rx = +el.getAttribute('rx') || 0;
    const cover = el.nextElementSibling;
    const covered = cover && cover.getAttribute('stroke') === 'white'
        && cover.getAttribute('x') === el.getAttribute('x')
        && cover.getAttribute('y') === el.getAttribute('y');
    const inset = covered ? (+cover.getAttribute('stroke-width') || 0) / 2 : 0;
    return { h: SEAT_UNITS / 2 - inset, r: Math.max(0, rx - inset) };
}

/* Внешняя сторона d и внешний радиус угла R контура в px экрана; внутренний радиус = R − HL_LINE */
function ringBox({ h, r }, k) {
    return { d: 2 * (h * k + HL_GAP + HL_LINE), R: r * k + HL_GAP + HL_LINE };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Лупа метки — библиотека Figma Icons, компонент «Search» (набор 4341:30387), Style=Outline,
   варианты Size=16 (4341:30391), Size=24 (4341:30390), Size=32 (4341:30388): контуры дословно
   из экспорта SVG; clipPath экспорта по рамке иконки снят — контур целиком внутри viewBox.
   Цвет из CSS (.ph--marker .ph-body), fill — currentColor */
const LOUPE16 = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.03536 6.03335C3.09086 5.23972 3.11779 4.8429 3.45178 4.23033C3.6734 3.82385 4.32303 3.17422 4.7295 2.9526C5.34208 2.61861 5.7389 2.59086 6.53253 2.53536C6.84917 2.51322 7.17441 2.5 7.49965 2.5C7.8249 2.5 8.15014 2.51322 8.46678 2.53536C9.26041 2.59086 9.65723 2.61861 10.2698 2.9526C10.6763 3.17422 11.3259 3.82385 11.5475 4.23033C11.8815 4.8429 11.9093 5.23924 11.9648 6.03287C11.9869 6.34952 12.0001 6.67476 12.0001 7C12.0001 7.32524 11.9869 7.65048 11.9648 7.96713C11.9093 8.76076 11.8815 9.15806 11.5475 9.77063C11.5245 9.81292 11.4968 9.85785 11.4652 9.90464L13.7803 12.2198C13.9262 12.3657 13.9995 12.5568 14 12.748C14.0005 12.9407 13.9273 13.1335 13.7803 13.2805C13.6304 13.4304 13.4328 13.5035 13.2364 13.5C13.049 13.4966 12.8627 13.4234 12.7197 13.2805L10.4047 10.9654C10.3576 10.9973 10.3124 11.0252 10.2698 11.0484C9.65723 11.3823 9.26042 11.4091 8.46679 11.4646C8.15014 11.4868 7.8249 11.5 7.49965 11.5C7.17441 11.5 6.84917 11.4868 6.53253 11.4646C5.73889 11.4091 5.34208 11.3823 4.7295 11.0484C4.32303 10.8267 3.67339 10.1771 3.45178 9.77063C3.11779 9.15805 3.09086 8.76124 3.03536 7.9676C3.01322 7.65096 3 7.32572 3 7.00048C3 6.67524 3.01322 6.34999 3.03536 6.03335ZM6.63717 4.03171C6.92451 4.01162 7.21446 4 7.49965 4C7.78485 4 8.07479 4.01162 8.36214 4.03171C9.1477 4.08664 9.25111 4.10565 9.55177 4.26958C9.55978 4.27474 9.59864 4.29992 9.66573 4.35426C9.74153 4.41564 9.82898 4.49446 9.91733 4.5828C10.0057 4.67115 10.0845 4.75861 10.1459 4.8344C10.2002 4.9015 10.2248 4.93964 10.23 4.94765C10.3939 5.2483 10.4135 5.35196 10.4684 6.13751C10.4885 6.42486 10.5001 6.71481 10.5001 7C10.5001 7.28519 10.4885 7.57514 10.4684 7.86249C10.4135 8.64804 10.3945 8.75194 10.2306 9.05259C10.2254 9.0606 10.2002 9.09946 10.1459 9.16656C10.0845 9.24235 10.0057 9.32981 9.91733 9.41815C9.82899 9.5065 9.74153 9.58532 9.66573 9.6467C9.59863 9.70104 9.5605 9.72562 9.55249 9.73078C9.25183 9.8947 9.1477 9.91431 8.36214 9.96925C8.0748 9.98934 7.78485 10.001 7.49965 10.001C7.21446 10.001 6.92451 9.98934 6.63717 9.96925C5.85161 9.91431 5.7482 9.8953 5.44754 9.73138C5.43953 9.72622 5.40067 9.70104 5.33358 9.6467C5.25778 9.58532 5.17032 9.5065 5.08198 9.41815C4.99363 9.32981 4.91481 9.24235 4.85343 9.16656C4.7991 9.09946 4.77452 9.06133 4.76935 9.05331C4.60543 8.75266 4.58664 8.64852 4.53171 7.86296C4.51162 7.57562 4.5 7.28567 4.5 7.00048C4.5 6.71528 4.51162 6.42534 4.53171 6.13799C4.58664 5.35244 4.60483 5.24902 4.76875 4.94837C4.77391 4.94036 4.79909 4.9015 4.85343 4.8344C4.91481 4.75861 4.99364 4.67115 5.08198 4.5828C5.17032 4.49446 5.25778 4.41564 5.33358 4.35426C5.40067 4.29992 5.43881 4.27534 5.44682 4.27018C5.74748 4.10625 5.85161 4.08664 6.63717 4.03171Z" fill="currentColor"/>'
    + '</svg>';

const LOUPE24 = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.7015 6.304C4.15545 7.31394 4.11683 7.94568 4.0396 9.20915C4.01362 9.63411 3.99854 10.0675 3.99854 10.5008C3.99854 10.9342 4.01362 11.3676 4.0396 11.7925C4.11683 13.056 4.15545 13.6877 4.7015 14.6977C5.05931 15.3595 6.14076 16.4409 6.80253 16.7987C7.81247 17.3448 8.44421 17.3834 9.70769 17.4606C10.1326 17.4866 10.566 17.5017 10.9994 17.5017C11.4327 17.5017 11.8661 17.4866 12.2911 17.4606C13.5545 17.3834 14.1863 17.3448 15.1962 16.7987C15.3218 16.7308 15.4624 16.6369 15.6104 16.5247L19.2929 20.2073C19.6834 20.5978 20.3166 20.5978 20.7071 20.2073C21.0976 19.8167 21.0976 19.1836 20.7071 18.793L17.0244 15.1103C17.1361 14.9629 17.2296 14.8228 17.2972 14.6977C17.8433 13.6877 17.8819 13.056 17.9591 11.7925C17.9851 11.3676 18.0002 10.9342 18.0002 10.5008C18.0002 10.0675 17.9851 9.63411 17.9591 9.20915C17.8819 7.94568 17.8433 7.31394 17.2972 6.304C16.9394 5.64222 15.858 4.56078 15.1962 4.20297C14.1863 3.65691 13.5545 3.6183 12.2911 3.54107C11.8661 3.51509 11.4327 3.5 10.9994 3.5C10.566 3.5 10.1326 3.51509 9.70769 3.54107C8.44421 3.6183 7.81248 3.65691 6.80253 4.20297C6.14076 4.56078 5.05931 5.64222 4.7015 6.304ZM9.82971 5.53734C10.2196 5.51351 10.6119 5.5 10.9994 5.5C11.3868 5.5 11.7792 5.51351 12.169 5.53734C13.41 5.61319 13.6524 5.64186 14.245 5.96226C14.245 5.96226 14.2514 5.9658 14.2646 5.97405C14.2782 5.98255 14.2966 5.99459 14.3198 6.01072C14.3669 6.04345 14.4256 6.08744 14.4945 6.14323C14.6334 6.25576 14.7901 6.39735 14.9465 6.55371C15.1029 6.71007 15.2445 6.86682 15.357 7.00574C15.4128 7.0746 15.4568 7.13335 15.4895 7.18042C15.5056 7.20361 15.5177 7.22201 15.5262 7.2356C15.5348 7.24939 15.5379 7.25522 15.5379 7.25522C15.8584 7.84784 15.887 8.09022 15.9629 9.33118C15.9867 9.72105 16.0002 10.1134 16.0002 10.5008C16.0002 10.8883 15.9867 11.2806 15.9629 11.6705C15.887 12.9115 15.8584 13.1538 15.5379 13.7465C15.5379 13.7465 15.5348 13.7523 15.5262 13.7661C15.5177 13.7797 15.5056 13.7981 15.4895 13.8213C15.4568 13.8683 15.4128 13.9271 15.357 13.9959C15.2445 14.1349 15.1029 14.2916 14.9465 14.448C14.7901 14.6043 14.6334 14.7459 14.4945 14.8585C14.4256 14.9142 14.3669 14.9582 14.3198 14.991C14.2966 15.0071 14.2782 15.0191 14.2646 15.0276C14.2508 15.0363 14.245 15.0394 14.245 15.0394C13.6524 15.3598 13.41 15.3885 12.169 15.4643C11.7792 15.4882 11.3868 15.5017 10.9994 15.5017C10.6119 15.5017 10.2196 15.4882 9.82971 15.4643C8.58875 15.3885 8.34638 15.3598 7.75375 15.0394C7.75375 15.0394 7.74793 15.0363 7.73414 15.0276C7.72054 15.0191 7.70214 15.0071 7.67895 14.991C7.63188 14.9582 7.57314 14.9142 7.50427 14.8585C7.36536 14.7459 7.2086 14.6043 7.05224 14.448C6.89588 14.2916 6.75429 14.1349 6.64176 13.9959C6.58598 13.9271 6.54199 13.8683 6.50925 13.8213C6.49312 13.7981 6.48108 13.7797 6.47258 13.7661C6.46434 13.7529 6.46079 13.7464 6.46079 13.7464C6.14039 13.1538 6.11173 12.9114 6.03587 11.6705C6.01204 11.2806 5.99854 10.8883 5.99854 10.5008C5.99854 10.1134 6.01204 9.72105 6.03587 9.33118C6.11173 8.09022 6.14037 7.84789 6.46079 7.25526C6.46079 7.25526 6.46434 7.24879 6.47258 7.2356C6.48108 7.22201 6.49312 7.20361 6.50925 7.18042C6.54199 7.13335 6.58598 7.0746 6.64176 7.00574C6.75429 6.86682 6.89588 6.71007 7.05224 6.55371C7.2086 6.39735 7.36536 6.25576 7.50427 6.14323C7.57314 6.08744 7.63188 6.04345 7.67895 6.01072C7.70214 5.99459 7.72054 5.98255 7.73414 5.97405C7.74793 5.96543 7.75375 5.96228 7.75375 5.96228C8.34638 5.64186 8.58875 5.61319 9.82971 5.53734Z" fill="currentColor"/>'
    + '</svg>';

const LOUPE32 = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">'
    + '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.11637 11.2975C4.26214 9.51489 4.33502 8.62358 5.05943 7.30969C5.5484 6.42283 6.92282 5.0484 7.80969 4.55943C9.12358 3.83502 10.0149 3.76214 11.7975 3.61637C12.6751 3.5446 13.5875 3.5 14.5 3.5C15.4125 3.5 16.3249 3.5446 17.2025 3.61636C18.9851 3.76214 19.8764 3.83502 21.1903 4.55943C22.0772 5.0484 23.4516 6.42283 23.9406 7.30969C24.665 8.62358 24.7379 9.51489 24.8836 11.2975C24.9554 12.1751 25 13.0875 25 14C25 14.9125 24.9554 15.8249 24.8836 16.7025C24.7379 18.4851 24.665 19.3764 23.9406 20.6903C23.8415 20.87 23.7061 21.0696 23.5458 21.2779L28.6364 26.3649C28.8817 26.6102 29.0037 26.9319 29.0025 27.2534C29.0014 27.5718 28.8793 27.8898 28.6364 28.1327C28.3958 28.3733 28.0816 28.4953 27.7662 28.4987C27.4418 28.5023 27.1162 28.3803 26.8687 28.1327L21.7781 23.0457C21.5697 23.2061 21.37 23.3415 21.1903 23.4406C19.8764 24.165 18.9851 24.2379 17.2025 24.3836C16.3249 24.4554 15.4125 24.5 14.5 24.5C13.5875 24.5 12.6751 24.4554 11.7975 24.3836C10.0149 24.2379 9.12358 24.165 7.80969 23.4406C6.92283 22.9516 5.5484 21.5772 5.05943 20.6903C4.33502 19.3764 4.26214 18.4851 4.11637 16.7025C4.0446 15.8249 4 14.9125 4 14C4 13.0875 4.0446 12.1751 4.11637 11.2975ZM12.0013 6.10805C12.8239 6.04078 13.6673 6 14.5 6C15.3327 6 16.1761 6.04078 16.9987 6.10805C18.7866 6.25425 19.1862 6.30926 19.9833 6.74872C20.1284 6.82877 20.5011 7.10736 20.9469 7.55312C21.3926 7.99888 21.6712 8.37156 21.7513 8.51675C22.1907 9.31382 22.2458 9.71339 22.392 11.5013C22.4592 12.3239 22.5 13.1673 22.5 14C22.5 14.8327 22.4592 15.6761 22.392 16.4987C22.2458 18.2866 22.1907 18.6862 21.7513 19.4833C21.6712 19.6284 21.3926 20.0011 20.9469 20.4469C20.5011 20.8926 20.1284 21.1712 19.9833 21.2513C19.1862 21.6907 18.7866 21.7458 16.9987 21.892C16.1761 21.9592 15.3327 22 14.5 22C13.6673 22 12.8239 21.9592 12.0013 21.892C10.2134 21.7458 9.81382 21.6907 9.01675 21.2513C8.87156 21.1712 8.49888 20.8926 8.05312 20.4469C7.60736 20.0011 7.32877 19.6284 7.24872 19.4833C6.80926 18.6862 6.75425 18.2866 6.60805 16.4987C6.54078 15.6761 6.5 14.8327 6.5 14C6.5 13.1673 6.54078 12.3239 6.60805 11.5013C6.75425 9.71339 6.80926 9.31382 7.24872 8.51675C7.32877 8.37156 7.60736 7.99888 8.05312 7.55312C8.49888 7.10736 8.87156 6.82877 9.01675 6.74872C9.81382 6.30926 10.2134 6.25425 12.0013 6.10805Z" fill="currentColor"/>'
    + '</svg>';

/* Ступени лупы по стороне кресла на экране s (px). Гистерезис: вверх на UP, вниз — когда s < DOWN;
   внутри запаса ступень не меняется. Индекс 0 — 16, 1 — 24, 2 — 32 */
const LOUPES = [
    { b: 16, svg: LOUPE16 },
    { b: 24, svg: LOUPE24, up: 32, down: 28 },
    { b: 32, svg: LOUPE32, up: 48, down: 42 },
];
const LOUPE_GROW_MS = 150;
const LOUPE_EASE = 'cubic-bezier(.2, .8, .2, 1)';   // как у разъезда кластера

function nextTier(t, s) {
    while (t < LOUPES.length - 1 && s >= LOUPES[t + 1].up) t++;
    while (t > 0 && s < LOUPES[t].down) t--;
    return t;
}

/* Сдвиг центра рамки лупы от центра кресла вправо и вверх, px: рамка заходит на кресло на 3/4
   стороны и выступает за правый верхний угол на 1/4; при s < b — прежние b/4 (4 px у лупы 16) */
const loupeShift = (b, s) => Math.max(b / 4, s / 2 - b / 4);

/* Метка: тёмная лупа ступени tier, сдвиг рамки — из --ph-shift слоя (CSS). Кластер: диаметр по ступеням — инлайн из it.d, та же цифра,
   по которой считаются касание и наезд кругов. Меньший круг лежит выше: крупный кластер ниже,
   меньший выше, метка (it.d = 24) выше любого кластера (40–88 px). */
function createEl(it, tier) {
    const el = document.createElement('div');
    el.className = 'ph ' + (it.kind === 'marker' ? 'ph--marker' : 'ph--cluster');
    el.dataset.key = it.key;
    el.style.zIndex = String(100 - it.d);
    const body = it.kind === 'marker' ? LOUPES[tier].svg : `<span class="ph-num">${it.count}</span>`;
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
    const hlEl = document.createElement('div');
    hlEl.className = 'seat-hl';
    hlEl.hidden = true;
    hlEl.setAttribute('aria-hidden', 'true');
    hlEl.innerHTML = '<span class="seat-hl-halo"></span><span class="seat-hl-ring"></span>';
    viewportEl.insertBefore(hlEl, layerEl.nextSibling);
    const haloEl = hlEl.firstElementChild;
    const ringEl = hlEl.lastElementChild;

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
    let tier = 0;               // ступень лупы — индекс LOUPES
    let tierReady = false;      // первая ступень ставится сразу по текущему s, без дорастания

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
                el = createEl(it, tier);
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
        // кресло под контуром вошло в заказ или вышло из него: контур построен под прежнюю фигуру и цвет —
        // убрать сразу, на его месте маркер выбора или кресло без маркера
        if (hlSeat && hlSeat.selected !== hlSelected) stopHighlight();
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

    /* ---------- ступень лупы ---------- */

    /* Смена ступени: у каждой метки лупа заменяется лупой новой ступени. Новая стартует в видимом
       размере старой — с учётом дорастания, которое ещё идёт, — и за LOUPE_GROW_MS дорастает до своего.
       Опора — правый верхний угол кресла: transform-origin рамки 75% 25% (css/photos.css).
       Прозрачность не меняется. */
    function swapLoupes(t) {
        const b = LOUPES[t].b;
        for (const el of els.values()) {
            if (!el.classList.contains('ph--marker')) continue;
            const body = el.querySelector('.ph-body');
            const old = body.firstElementChild;
            let from = b;
            if (old) {
                const sc = parseFloat(getComputedStyle(old).scale);   // 'none' → NaN → 1
                from = old.width.baseVal.value * (Number.isFinite(sc) ? sc : 1);
            }
            body.innerHTML = LOUPES[t].svg;
            if (from !== b) {
                body.firstElementChild.animate(
                    [{ scale: from / b }, { scale: 1 }],
                    { duration: LOUPE_GROW_MS, easing: LOUPE_EASE },
                );
            }
        }
    }

    /* Ступень и сдвиг рамки — от стороны кресла на экране s на каждом кадре изменения вида */
    function updateLoupe(k) {
        const s = SEAT_UNITS * k;
        if (!tierReady) {
            tier = nextTier(0, s);
            tierReady = true;
        } else {
            const t = nextTier(tier, s);
            if (t !== tier) {
                tier = t;
                swapLoupes(t);
            }
        }
        layerEl.style.setProperty('--ph-shift', `${loupeShift(LOUPES[tier].b, s)}px`);
    }

    /* Из hall.opts.onView: состав пересобирается при смене px на SVG-юнит (зум, ресайз)
       и после загрузки данных; при пане меняются только позиции. */
    function update() {
        const vt = hall.viewTransform();
        updateLoupe(vt.k);   // до пересборки: новые метки сразу создаются в текущей ступени
        if (vt.k !== lastK) {
            lastK = vt.k;
            dirty = true;
        }
        if (dirty) rebuild(vt);
        else place(vt);
        placeHighlight(vt);
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

    /* Попала ли точка (dx, dy от центра кресла, px) в фигуру элемента: кластер — круг it.d;
       метка — всё кресло с фото, квадрат SEAT_UNITS единиц схемы; спрятанная метка — маркер
       выбранного места, квадрат 2 · SEL_HALF единиц схемы. */
    function inBody(it, dx, dy, dist) {
        if (it.kind === 'cluster') return dist <= it.d / 2;
        const half = (isSel(it) ? SEL_HALF : SEAT_UNITS / 2) * lastK;
        return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }

    /* Попала ли точка в рамку лупы видимой метки: квадрат b текущей ступени, центр сдвинут
       на loupeShift вправо и вверх. Внутри кресла рамку уже покрывает inBody — здесь важен выступ за угол */
    function inLoupe(it, dx, dy) {
        if (it.kind !== 'marker' || isSel(it)) return false;
        const b = LOUPES[tier].b;
        const shift = loupeShift(b, SEAT_UNITS * lastK);
        return Math.abs(dx - shift) <= b / 2 && Math.abs(dy + shift) <= b / 2;
    }

    /* Элемент, в который попадает точка (lx, ly) в px вьюпорта. mode:
       'body' — по фигуре (inBody), из нескольких — верхний: меньший диаметр, при равном — ближний центр;
       маркер выбранного места лежит в SVG под слоем меток — ниже любого элемента слоя;
       'loupe' — по рамке лупы (inLoupe), из нескольких — ближний центр;
       'zone' — по зоне касания (квадрат со стороной max(44, d)), из нескольких — ближний центр. */
    function nearestItem(lx, ly, mode) {
        let best = null;
        let bestDist = Infinity;
        let bestRank = Infinity;
        for (const it of items) {
            if (!els.has(it.key)) continue;
            const dx = lx - it.sx;
            const dy = ly - it.sy;
            const dist = Math.hypot(dx, dy);
            if (mode === 'body') {
                if (!inBody(it, dx, dy, dist)) continue;
                const rank = isSel(it) ? Infinity : it.d;
                const above = !best || rank < bestRank || (rank === bestRank && dist < bestDist);
                if (above) { best = it; bestDist = dist; bestRank = rank; }
            } else if (mode === 'loupe') {
                if (!inLoupe(it, dx, dy)) continue;
                if (dist < bestDist) { best = it; bestDist = dist; }
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

    /* Порядок: кружок кластера или кресло с фото → рамка лупы (выступ за угол кресла) →
       свободное кресло без фото → зона касания метки → ближайшее кресло с фото →
       null (тап уходит креслам по прежнему пути). Рамка идёт раньше свободного кресла: на мелком
       масштабе лупа 16 заходит на соседнее кресло, и тап по видимой лупе всё равно открывает фото;
       соседнее кресло вне рамки выбирается как обычно. */
    function resolveTap(clientX, clientY) {
        if (!enabled) return null;
        const r = viewportEl.getBoundingClientRect();
        const lx = clientX - r.left;
        const ly = clientY - r.top;
        const body = nearestItem(lx, ly, 'body');
        if (body) return asHit(body);
        const loupe = nearestItem(lx, ly, 'loupe');
        if (loupe) return asHit(loupe);
        const p = hall.clientToSvg(clientX, clientY);
        if (!p) return null;
        const seat = seatAt(p);
        if (seat && seat.status === 'available' && !bySeat.has(seat.id)) return { type: 'seat', seat };
        const zone = nearestItem(lx, ly, 'zone');
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
    let hlSeat = null;        // кресло под контуром; null — подсветки нет
    let hlShape = null;       // фигура кресла на момент подсветки: { h, r }
    let hlSelected = false;   // было ли кресло в заказе на момент подсветки
    let hlK = null;           // k, под который выставлен размер контура
    let hlAnims = [];         // посадка и ореол
    let hlFade = null;        // гашение по касанию

    /* Из update на каждом кадре изменения вида: сдвиг всегда, размер — при смене k */
    function placeHighlight({ k, ox, oy }) {
        if (!hlSeat) return;
        const x = +hlSeat.el.getAttribute('x') + SEAT_UNITS / 2;
        const y = +hlSeat.el.getAttribute('y') + SEAT_UNITS / 2;
        hlEl.style.transform = `translate(${x * k + ox}px, ${y * k + oy}px)`;
        if (k === hlK) return;
        hlK = k;
        const { d, R } = ringBox(hlShape, k);
        ringEl.style.width = `${d}px`;
        ringEl.style.height = `${d}px`;
        ringEl.style.borderRadius = `${R}px`;
    }

    /* Сразу, без гашения: новая подсветка или кресло под контуром вошло в заказ или вышло из него */
    function stopHighlight() {
        hlSeat = null;
        hlShape = null;
        hlK = null;
        hlEl.hidden = true;
        hlAnims.forEach((a) => a.cancel());
        hlAnims = [];
        if (hlFade) { hlFade.cancel(); hlFade = null; }
    }

    function highlightSeat(seatId) {
        stopHighlight();
        const seat = seatsById.get(seatId);
        if (!seat) return;
        hlSeat = seat;
        hlSelected = seat.selected;
        hlShape = seatShape(seat);
        // цвет — заливка кресла: тир у свободного, светло-серый у занятого; у кресла в заказе — маркер.
        // Приглушение режима фото — fill-opacity в CSS, атрибут fill оно не трогает
        hlEl.style.color = seat.selected ? SEL_COLOR : seat.el.getAttribute('fill');
        const vt = hall.viewTransform();
        placeHighlight(vt);
        hlEl.hidden = false;
        if (reducedMotion()) return;   // контур сразу в размере покоя, без посадки и ореола

        const c = 'translate(-50%, -50%)';
        const { d, R } = ringBox(hlShape, vt.k);
        const G = HL_HALO_GROW;
        hlAnims = [
            // посадка: с 1,6 до 0,95 к 300 мс и до 1 к 350 мс; форма масштабируется целиком
            ringEl.animate([
                { transform: `${c} scale(${HL_LAND_FROM})`, easing: HL_EASE },
                { transform: `${c} scale(${HL_LAND_UNDER})`, offset: HL_LAND_UNDER_MS / HL_LAND_MS, easing: 'ease-in-out' },
                { transform: `${c} scale(1)` },
            ], { duration: HL_LAND_MS }),
            ringEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: HL_SHOW_MS }),
            // ореол: размер и радиус угла растут вдвое, линия остаётся 3 px — поэтому width/height, а не scale
            haloEl.animate([
                { width: `${d}px`, height: `${d}px`, borderRadius: `${R}px` },
                { width: `${d * G}px`, height: `${d * G}px`, borderRadius: `${R * G}px` },
            ], { duration: HL_HALO_MS, delay: HL_HALO_AT, easing: HL_EASE }),
            haloEl.animate([{ opacity: HL_HALO_OPACITY }, { opacity: 0 }], { duration: HL_HALO_MS, delay: HL_HALO_AT }),
        ];
    }

    /* Касание схемы, шторки или тумблера: движение замирает там, где его застало касание,
       всё гаснет за 150 мс и больше не возвращается */
    function hideHighlight() {
        if (!hlSeat || hlFade) return;
        hlAnims.forEach((a) => { if (a.playState === 'running') a.pause(); });
        hlFade = hlEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HL_OFF_MS, easing: 'ease-out', fill: 'forwards' });
        hlFade.onfinish = stopHighlight;
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
