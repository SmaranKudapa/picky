export const PITCH_LIMIT = 80;
export const NAME_LIMIT = 20;
// Fallback location if the leader blocks location access: Chou Hall, UC Berkeley.
// If a Find dies mid-way (e.g. the serverless function is killed), phones stop showing
// "finding…" after this long and the leader can hit Find again.
export const FIND_STALE_MS = 75000;
export const DEFAULT_CENTER = { lat: 37.8716, lng: -122.2533 };
