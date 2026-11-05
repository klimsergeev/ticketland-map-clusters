/* ============================================================
   Price pills and the price filter, shared by the mobile and desktop pages.
   getHall() -> HallViewport; getScheme() -> { seats, svgEl, seatlessEls, renderFilterLayer }
   (fields are null/[] until hall.svg is loaded). Returns { render, redraw, clear }.
   ============================================================ */
import { TIER_COLORS, TIER_PRICES, formatPrice } from './data.js';
import { spring } from './spring.js';

/* --- Рендер легенды (цвет→цена). Пилюли = ФИЛЬТР цены:
       клик по пилюле увеличивает доступные места её тира (см. toggleTierFilter).
       Активная пилюля — цветная обводка в цвет тира (класс .active, --ring). --- */
/* Цвет обводки нажатой пилюли. Обычно — цвет тира. Тир, еле видный на белом (контраст с белым ниже
   RING_MIN_CONTRAST по WCAG), получает тот же тон и насыщенность с яркостью B (HSB) ниже на RING_DARKEN пунктов —
   правило прежних кружков на креслах. Маркер на пилюле остаётся в цвет тира.
   Порог 1,3: темнее становится только «1 750 ₽» (#F2E7E4, контраст 1,21). При пороге 1,5 под правило попал бы
   и жёлтый «4 000 ₽» (#F5D300, контраст 1,48) — обводка #C2A700 */
const RING_MIN_CONTRAST = 1.3;
const RING_DARKEN = 20;

function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// контраст с белым по WCAG 2.1: (1 + 0.05) / (L + 0.05), L — относительная яркость цвета
function contrastWithWhite(hex) {
    const [r, g, b] = hexRgb(hex).map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

// #RRGGBB → тот же H и S, яркость B меньше на points пунктов: при тех же H и S все каналы меняются в пропорции newB / B
function darkenHsb(hex, points) {
    const rgb = hexRgb(hex);
    const b = Math.max(...rgb) / 255;
    if (!b) return hex;
    const k = Math.max(0, b - points / 100) / b;
    return '#' + rgb.map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function ringColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex;
    return contrastWithWhite(hex) < RING_MIN_CONTRAST ? darkenHsb(hex, RING_DARKEN) : hex;
}

/* ============================================================
   Фильтр цены (пилюли легенды). Клик по пилюле анимированно увеличивает
   доступные места её тира; мультивыбор (несколько тиров сразу); повторный
   клик — снимает. filterTiers: color → { p, target, stop } — p ∈ [0..1] прогресс
   пружины, target — целевое (1 подсветить / 0 убрать), stop — отмена пружины.

   КЛЮЧЕВОЕ: экранный размер увеличенного места ФИКСИРОВАН при любом зуме.
   Место — 8 SVG-юнитов; его экранный размер = 8 * pxPerUnit (pxPerUnit=cover*scale
   растёт с зумом). Чтобы экранный размер стал целевым TARGET_PX, множитель места
   sc = TARGET_PX / (8 * pxPerUnit) — обратно пропорционален текущему зуму. При
   сильном приближении места и так крупнее TARGET_PX → sc клампится к 1 (не
   уменьшаем). Итоговый размер с анимацией: 1 + (sc − 1) * p.

   Места в заказе не увеличиваются: их показывает маркер выбора, а копия в цвет тира
   торчала бы из-под маркера цветным кольцом.
   Смена активного билета ставит схему на место через hall.focusInBand → onInteract →
   clearFilters: фильтр сбрасывается, как при любом взаимодействии со схемой. */
const TARGET_PX = 18;                // целевой экранный размер увеличенного места, px

export function createPriceFilter({ legendEl, getHall, getScheme }) {
    const filterTiers = new Map();

    function renderLegend() {
        legendEl.innerHTML = '';
        TIER_COLORS.forEach((c, i) => {
            const color = c.toUpperCase();
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'pill';
            pill.dataset.tier = color;
            pill.style.setProperty('--ring', ringColor(c));   // обводка нажатой; светлый тир — темнее
            pill.innerHTML = `<span class="sw" style="background:${c}"></span>${formatPrice(TIER_PRICES[i])}`;
            pill.addEventListener('click', () => toggleTierFilter(color));
            legendEl.appendChild(pill);
        });
        updateLegendActive();
    }

    /* Множитель места для постоянного экранного размера при текущем зуме. */
    function tierScale() {
        const hall = getHall();
        const per = (hall && hall.pxPerUnit()) || 1;
        return Math.max(1, TARGET_PX / (8 * per));
    }

    /* Перерисовать слой увеличения: доступные места активных тиров, масштаб = прогресс. */
    function renderFilter() {
        const { seats, renderFilterLayer } = getScheme();
        if (!renderFilterLayer) return;
        if (!filterTiers.size) { renderFilterLayer([]); return; }
        const sc = tierScale();
        const items = [];
        seats.forEach((s) => {
            if (s.status !== 'available' || !s.tier || s.selected) return;
            const st = filterTiers.get(s.tier);
            if (!st || st.p <= 0) return;
            items.push({ s, sc: 1 + (sc - 1) * st.p });
        });
        renderFilterLayer(items);
    }

    /* Анимировать тир к target (1 — увеличить, 0 — вернуть) пружиной. */
    function animateTier(color, target) {
        let st = filterTiers.get(color);
        if (!st) { st = { p: 0, target, stop: null }; filterTiers.set(color, st); }
        st.target = target;
        if (st.stop) { st.stop(); st.stop = null; }
        st.stop = spring({
            from: st.p, to: target,
            onUpdate: (v) => { st.p = v; renderFilter(); },
            onDone: () => {
                st.stop = null;
                if (target === 0) { filterTiers.delete(color); }
                renderFilter();
            },
        });
    }

    /* Клик по пилюле: переключить подсветку тира (мультивыбор). */
    function toggleTierFilter(color) {
        const st = filterTiers.get(color);
        const on = !!st && st.target === 1;
        animateTier(color, on ? 0 : 1);
        updateLegendActive();
        updateFade();
    }

    /* Бледнение при активном фильтре. Активен ≥1 тир (target===1) → на корневой
       <svg> вешаем класс .filtering: CSS приглушает ВСЕ базовые 8×8-места,
       а места активных тиров помечаем классом .tier-active (CSS возвращает им полный цвет).
       Слои .filter-layer/.sel-layer из бледнения исключены в CSS, поэтому
       увеличенные копии и оранжевый маркер остаются в полном цвете. */
    function updateFade() {
        const { seats, svgEl: hallSvgEl, seatlessEls } = getScheme();
        if (!hallSvgEl) return;
        const active = new Set();
        filterTiers.forEach((st, color) => { if (st.target === 1) active.add(color); });
        if (active.size === 0) {
            hallSvgEl.classList.remove('filtering');
            seats.forEach((s) => s.el.classList.remove('tier-active'));
            seatlessEls.forEach((g) => g.classList.remove('tier-active'));
            return;
        }
        hallSvgEl.classList.add('filtering');
        seats.forEach((s) => {
            const on = s.status === 'available' && s.tier && active.has(s.tier);
            s.el.classList.toggle('tier-active', on);
        });
        // танцпол: свой тир (data-tier) — в полном цвете, только если активен его тир
        seatlessEls.forEach((g) => g.classList.toggle('tier-active', active.has((g.dataset.tier || '').toUpperCase())));
    }

    /* Синхронизировать .active у пилюль с активными тирами (без ре-рендера легенды). */
    function updateLegendActive() {
        legendEl.querySelectorAll('.pill').forEach((p) => {
            const st = filterTiers.get(p.dataset.tier);
            p.classList.toggle('active', !!st && st.target === 1);
        });
    }

    /* Сброс фильтра: мгновенно вернуть размеры и погасить обводки пилюль.
       Вызывается при любом взаимодействии со схемой (hall.onInteract). */
    function clearFilters() {
        if (!filterTiers.size) { updateLegendActive(); updateFade(); return; }
        const { renderFilterLayer } = getScheme();
        filterTiers.forEach((st) => { if (st.stop) st.stop(); });
        filterTiers.clear();
        if (renderFilterLayer) renderFilterLayer([]);
        updateLegendActive();
        updateFade();       // снять .filtering и все .tier-active → полный цвет у всех
    }

    return { render: renderLegend, redraw: renderFilter, clear: clearFilters };
}
