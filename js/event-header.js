import { EVENT } from './data.js';

// Fill the event header: title, session date, venue
export function fillEventHeader(root) {
    root.querySelector('.ttl').textContent = EVENT.title;
    root.querySelector('.dt').textContent = EVENT.date;
    root.querySelector('.sub').textContent = EVENT.venue;
}
