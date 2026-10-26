/* ============================================================
   Фото секций: одно фото на секцию зала — часть зала и сторона.
   Ключ секции — `${seat.sectionKey}-${seat.side}` (js/seats.js), например «parter-left».
   ============================================================ */

/* Ключ секции места: «amphitheatre-center» */
export const sectionKeyOf = (seat) => `${seat.sectionKey}-${seat.side}`;

/* Миниатюра фото для карточки билета — по правилу: тот же файл в папке thumbs рядом,
   «photos/low-left.jpg» → «photos/thumbs/low-left.jpg». 324×240 — превью карточки 108×80 на экране 3x,
   обрезка по центру, как object-fit: cover на карточке */
export const thumbOf = (url) => url.replace(/([^/]+)$/, 'thumbs/$1');

/* JSON: { "<ключ секции>": { url, caption? } }. Сбой загрузки или не объект — пустой Map и ошибка в консоли.
   Запись без url пропускается с предупреждением. Возвращает Map(ключ секции → { url, thumb, caption }). */
export function loadSectionPhotos(url) {
    return fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ожидался объект { ключ секции: фото }');
            const map = new Map();
            Object.entries(data).forEach(([key, p]) => {
                if (!p || typeof p.url !== 'string' || !p.url) {
                    console.warn(`Фото секции ${key}: нет url, фото не показано`);
                    return;
                }
                map.set(key, { url: p.url, thumb: thumbOf(p.url), caption: p.caption || '' });
            });
            return map;
        })
        .catch((e) => {
            console.error(`Не загрузились фото секций ${url}`, e);
            return new Map();
        });
}
