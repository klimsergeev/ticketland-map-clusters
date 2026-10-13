/* ============================================================
   Кластеризация меток фото и элементы слоя из групп кресел.
   Группа — массив индексов узлов (js/photos.js).
   ============================================================ */

/* Агломерация с полной связью: сливаются две группы с наименьшим расстоянием,
   расстояние между группами — наибольшее между их креслами; пока оно меньше порога.
   Порядок слияний зависит только от координат, порог отсекает префикс последовательности —
   при приближении кластер делится только на свои части. Равные расстояния — первая пара по индексам.
   nodes — узлы-кресла { x, y, ... } в SVG-юнитах; threshold — порог в тех же юнитах.
   Возвращает группы — массивы индексов nodes. */
export function clusterize(nodes, threshold) {
    const n = nodes.length;
    const groups = nodes.map((_, i) => [i]);
    const alive = nodes.map(() => true);
    // d[i][j] — расстояние полной связи между группами i и j
    const d = nodes.map((a) => nodes.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
    for (;;) {
        let bi = -1;
        let bj = -1;
        let best = threshold;
        for (let i = 0; i < n; i++) {
            if (!alive[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (alive[j] && d[i][j] < best) { best = d[i][j]; bi = i; bj = j; }
            }
        }
        if (bi < 0) break;
        groups[bi] = groups[bi].concat(groups[bj]);
        alive[bj] = false;
        for (let k = 0; k < n; k++) {
            if (alive[k] && k !== bi) d[bi][k] = d[k][bi] = Math.max(d[bi][k], d[bj][k]);
        }
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
