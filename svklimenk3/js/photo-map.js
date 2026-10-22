/* ============================================================
   Фото секций: одно фото на секцию (часть зала и сторона).
   photoOf(seat) отдаёт фото секции места, gallery() — все фото секций в порядке лайтбокса;
   на схеме фото не отмечаются.
   ============================================================ */
import { loadSectionPhotos, sectionKeyOf } from './photos.js';

/* Порядок галереи: части зала от сцены, в каждой — левая сторона, центр, правая */
const PART_ORDER = ['parter', 'amphitheatre', 'beletage', 'balcony'];
const SIDES = [
    ['left', 'левая сторона'],
    ['center', 'центр'],
    ['right', 'правая сторона'],
];

/* seats — модель мест из buildSeats: из неё берутся названия частей зала («Партер») и известные секции */
export function createPhotoMap({ seats }) {
    const partName = new Map(seats.map((s) => [s.sectionKey, s.section]));
    let sectionPhotos = new Map();   // ключ секции → { url, caption }

    /* Загрузить фото секций. Ключ, которого нет ни у одного места схемы, — предупреждение;
       секция без фото — не ошибка: у её мест фото нет */
    function load(url) {
        return loadSectionPhotos(url).then((map) => {
            const known = new Set(seats.map(sectionKeyOf));
            map.forEach((_, key) => {
                if (!known.has(key)) console.warn(`Фото секции ${key}: такой секции нет на схеме`);
            });
            sectionPhotos = map;
        });
    }

    /* Все фото секций в порядке галереи: [{ key, photo, label }], label — «Партер, левая сторона».
       Секции без фото пропускаются */
    function gallery() {
        const items = [];
        PART_ORDER.forEach((part) => {
            SIDES.forEach(([side, sideLabel]) => {
                const key = `${part}-${side}`;
                const photo = sectionPhotos.get(key);
                if (!photo) return;
                items.push({ key, photo, label: `${partName.get(part) || part}, ${sideLabel}` });
            });
        });
        return items;
    }

    return {
        load,
        // фото секции места { url, caption }; null — у секции нет фото или фото ещё не загружены
        photoOf: (seat) => (seat ? sectionPhotos.get(sectionKeyOf(seat)) || null : null),
        // ключ секции места — по нему лайтбокс находит стартовое фото в gallery()
        keyOf: sectionKeyOf,
        gallery,
    };
}
