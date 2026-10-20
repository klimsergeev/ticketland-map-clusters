/* ============================================================
   Фото на креслах: загрузка набора и привязка к креслам схемы.
   Узел — кресло с его единственным фото.
   ============================================================ */

/* JSON набора: [{ id, url, seatId, caption? }]. Сбой загрузки — пустой список и ошибка в консоли. */
export function loadPhotos(url) {
    return fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((e) => {
            console.error(`Не загрузились фото ${url}`, e);
            return [];
        });
}

/* list — записи из JSON, seatsById — Map(seatId → место из buildSeats).
   Возвращает узлы в порядке данных: { seatId, seat, x, y, order, photo },
   x, y — центр кресла в SVG-юнитах, order — индекс записи в данных. */
export function bindPhotos(list, seatsById) {
    const bySeat = new Map();
    (Array.isArray(list) ? list : []).forEach((p, order) => {
        const seat = seatsById.get(p.seatId);
        if (!seat) {
            console.warn(`Фото ${p.id}: кресла ${p.seatId} нет на схеме, фото не показано`);
            return;
        }
        if (bySeat.has(p.seatId)) {
            console.warn(`Фото ${p.id}: у кресла ${p.seatId} уже есть фото, второе не показано`);
            return;
        }
        bySeat.set(p.seatId, {
            seatId: p.seatId,
            seat,
            x: +seat.el.getAttribute('x') + 4,
            y: +seat.el.getAttribute('y') + 4,
            order,
            photo: p,
        });
    });
    return [...bySeat.values()];
}
