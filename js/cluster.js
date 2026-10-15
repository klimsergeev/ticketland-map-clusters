/* ============================================================
   Кластеризация меток фото и элементы слоя из групп кресел.
   Группа — массив индексов узлов (js/photos.js).
   ============================================================ */

/* Метка — круг 20 px и обводка 2 px снаружи: на экране она занимает 24 px. */
export const MARKER_D = 24;

/* Диаметр круга кластера в px экрана по числу фото — ступени размера дизайнера. */
export function clusterDiameter(count) {
    if (count <= 2) return 40;
    if (count <= 4) return 48;
    if (count <= 9) return 64;
    return 88;
}

/* Дерево слияний. Строится один раз на загрузку данных и от масштаба не зависит.
   Ключ пары групп — vt.k (px на SVG-юнит), ниже которого, то есть при отдалении, они сливаются:
     • радиус объединения, полная связь: radiusPx / наибольшее расстояние между креслами групп;
     • наезд кругов: (Dа + Dб) / 2 / расстояние между точками групп — для пар кругов из overlap.
   Берётся больший из двух. Рабочий ключ пары — не больше ключей, на которых сложились сами группы:
   eff = min(K, E[a], E[b]). На каждом шаге сливается пара с наибольшим рабочим ключом, равные —
   первая по индексам. Ключи шагов поэтому не растут, и группы на масштабе k — префикс шагов с ключом больше k.
   Возвращает merges — шаги { a, b, e } (группа b вливается в a) — и aloneK[i]: ключ первого слияния
   кресла i, 0 — кресло ни с кем не сливается. */
export function buildTree(nodes, { radiusPx, minPhotos, position, overlap }) {
    const n = nodes.length;
    const minCluster = Math.max(2, minPhotos);
    const alive = nodes.map(() => true);
    const count = nodes.map(() => 1);
    const sumX = nodes.map((m) => m.x);
    const sumY = nodes.map((m) => m.y);
    const first = nodes.map((_, i) => i);   // кресло группы, раньше всех стоящее в данных: узлы идут в порядке данных
    const E = nodes.map(() => Infinity);    // ключ, на котором сложилась группа; у кресла — бесконечность
    const aloneK = nodes.map(() => 0);
    const merges = [];
    // d[i][j] — расстояние полной связи между группами i и j
    const d = nodes.map((a) => nodes.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));

    // круг группы на экране или null: такую группу правило наезда не трогает
    function circle(i) {
        const c = count[i];
        let size = 0;
        if (c >= minCluster) size = overlap === 'off' ? 0 : clusterDiameter(c);
        else if (c === 1 && overlap === 'all') size = MARKER_D;
        if (!size) return null;
        const p = position === 'first' ? nodes[first[i]] : { x: sumX[i] / c, y: sumY[i] / c };
        return { x: p.x, y: p.y, size };
    }

    for (let step = 1; step < n; step++) {
        const circles = nodes.map((_, i) => (alive[i] ? circle(i) : null));
        let bi = -1;
        let bj = -1;
        let best = -1;
        for (let i = 0; i < n; i++) {
            if (!alive[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (!alive[j]) continue;
                let k = radiusPx / d[i][j];
                const a = circles[i];
                const b = circles[j];
                if (a && b) k = Math.max(k, (a.size + b.size) / 2 / Math.hypot(a.x - b.x, a.y - b.y));
                const eff = Math.min(k, E[i], E[j]);
                if (eff > best) { best = eff; bi = i; bj = j; }
            }
        }
        if (count[bi] === 1) aloneK[bi] = best;
        if (count[bj] === 1) aloneK[bj] = best;
        merges.push({ a: bi, b: bj, e: best });
        alive[bj] = false;
        count[bi] += count[bj];
        sumX[bi] += sumX[bj];
        sumY[bi] += sumY[bj];
        first[bi] = Math.min(first[bi], first[bj]);
        E[bi] = best;
        for (let k = 0; k < n; k++) {
            if (alive[k] && k !== bi) d[bi][k] = d[k][bi] = Math.max(d[bi][k], d[bj][k]);
        }
    }
    return { merges, aloneK };
}

/* Группы на масштабе k (px на SVG-юнит) — массивы индексов nodes.
   Шаги идут с невозрастающим ключом: сливается префикс с ключом больше k. */
export function cutTree(n, merges, k) {
    const groups = Array.from({ length: n }, (_, i) => [i]);
    const alive = groups.map(() => true);
    for (const { a, b, e } of merges) {
        if (e <= k) break;
        groups[a] = groups[a].concat(groups[b]);
        alive[b] = false;
    }
    return groups.filter((_, i) => alive[i]);
}

/* Группа, где кресел меньше minPhotos, показывается креслами по отдельности.
   position: 'centroid' — центр масс кресел, 'first' — кресло, раньше всех стоящее в данных. */
export function buildItems(nodes, groups, { minPhotos, position }) {
    const items = [];
    for (const g of groups) {
        const members = g.map((i) => nodes[i]);
        if (members.length > 1 && members.length < minPhotos) members.forEach((m) => items.push(makeItem([m], position)));
        else items.push(makeItem(members, position));
    }
    return items;
}

function makeItem(members, position) {
    const sorted = [...members].sort((a, b) => a.order - b.order);
    const count = sorted.length;
    const x = position === 'first' ? sorted[0].x : sorted.reduce((s, m) => s + m.x, 0) / count;
    const y = position === 'first' ? sorted[0].y : sorted.reduce((s, m) => s + m.y, 0) / count;
    return {
        key: `${sorted[0].photo.id}:${count}`,
        kind: count === 1 ? 'marker' : 'cluster',
        members: sorted,
        count,
        d: count === 1 ? MARKER_D : clusterDiameter(count),   // диаметр круга в px экрана: вёрстка, касание, порядок слоёв
        x,
        y,
        box: {
            minX: Math.min(...sorted.map((m) => m.x)),
            minY: Math.min(...sorted.map((m) => m.y)),
            maxX: Math.max(...sorted.map((m) => m.x)),
            maxY: Math.max(...sorted.map((m) => m.y)),
        },
        sx: 0,
        sy: 0,
    };
}
