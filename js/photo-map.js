/* ============================================================
   Фото секций: одно фото на секцию (часть зала и сторона).
   photoOf(item) отдаёт фото секции места или секции без мест (танцпол), gallery() — все фото в порядке лайтбокса:
   сначала секции без мест, затем секции с местами; на схеме фото не отмечаются.
   ============================================================ */
import { loadSectionPhotos, sectionKeyOf } from './photos.js';

/* Порядок галереи: части зала от сцены, в каждой — левая сторона, центр, правая */
const PART_ORDER = ['parter', 'amphitheatre', 'beletage', 'balcony'];
const SIDES = [
    ['left', 'левая сторона'],
    ['center', 'центр'],
    ['right', 'правая сторона'],
];

/* Ключ фото позиции заказа: билет без места — свой photoKey (танцпол), место — «часть зала-сторона» */
const keyOfItem = (item) => (item && item.kind === 'seatless' ? item.photoKey : sectionKeyOf(item));

/* seats — модель мест из buildSeats: из неё берутся названия частей зала («Партер») и известные секции.
   seatless — секции без мест: [{ photoKey, name }], их фото идут в галерее первыми с подписью name */
export function createPhotoMap({ seats, seatless = [] }) {
    const partName = new Map(seats.map((s) => [s.sectionKey, s.section]));
    let sectionPhotos = new Map();   // ключ секции → { url, caption }

    /* Загрузить фото секций. Ключ не из «часть зала на схеме × сторона» — предупреждение (опечатка в ключе).
       Секция без фото — не ошибка: у её мест фото нет */
    function load(url) {
        return loadSectionPhotos(url).then((map) => {
            const known = new Set([...partName.keys()].flatMap((part) => SIDES.map(([side]) => `${part}-${side}`)));
            seatless.forEach((s) => known.add(s.photoKey));
            map.forEach((_, key) => {
                if (!known.has(key)) console.warn(`Фото секции ${key}: такой секции нет на схеме`);
            });
            sectionPhotos = map;
        });
    }

    /* Все фото секций в порядке галереи: [{ key, photo, label }], label — «Партер, левая сторона».
       Секции без фото пропускаются. Секции без мест на схеме тоже: их место занимает секция без мест —
       центр партера занят танцполом, и фото «Партер, центр» в галерее не повторяет фото «Танцпол» */
    function gallery() {
        const seated = new Set(seats.map(sectionKeyOf));
        const items = [];
        seatless.forEach((s) => {
            const photo = sectionPhotos.get(s.photoKey);
            if (photo) items.push({ key: s.photoKey, photo, label: s.name });
        });
        PART_ORDER.forEach((part) => {
            SIDES.forEach(([side, sideLabel]) => {
                const key = `${part}-${side}`;
                const photo = sectionPhotos.get(key);
                if (!photo || !seated.has(key)) return;
                items.push({ key, photo, label: `${partName.get(part) || part}, ${sideLabel}` });
            });
        });
        return items;
    }

    return {
        load,
        // фото секции места { url, caption }; null — у секции нет фото или фото ещё не загружены
        photoOf: (item) => (item ? sectionPhotos.get(keyOfItem(item)) || null : null),
        // ключ фото позиции — по нему лайтбокс находит стартовое фото в gallery()
        keyOf: keyOfItem,
        gallery,
    };
}
