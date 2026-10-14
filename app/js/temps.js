// Fuseaux horaires et dates. Tous les instants sont stockés en ISO UTC ("…Z").
// Les killzones sont toujours exprimées en heure de New York.

export const FUSEAU_NY = 'America/New_York';

const formateurs = new Map();
function formateur(fuseau) {
  if (!formateurs.has(fuseau)) {
    formateurs.set(fuseau, new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formateurs.get(fuseau);
}

export function fuseauNavigateur() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function fuseauValide(fuseau) {
  try { formateur(fuseau); return true; } catch { return false; }
}

// Composantes "heure murale" d'un instant dans un fuseau.
function composantes(ms, fuseau) {
  const p = {};
  for (const { type, value } of formateur(fuseau).formatToParts(new Date(ms))) p[type] = value;
  return { an: +p.year, mois: +p.month, jour: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

function decalageMs(ms, fuseau) {
  const c = composantes(ms, fuseau);
  return Date.UTC(c.an, c.mois - 1, c.jour, c.h, c.min, c.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** "2026-10-14" + "15:42" dans `fuseau` → "2026-10-14T13:42:00.000Z". */
export function versUtc(date, heure, fuseau) {
  if (!date) return null;
  const [an, mois, jour] = date.split('-').map(Number);
  const [h, min, s] = (heure || '00:00').split(':').map(Number);
  const mural = Date.UTC(an, mois - 1, jour, h || 0, min || 0, s || 0);
  let ms = mural - decalageMs(mural, fuseau);
  ms = mural - decalageMs(ms, fuseau); // second passage : corrige autour du changement d'heure
  return new Date(ms).toISOString();
}

/** Instant ISO → { date, heure, minutes, jourSemaine (1 = lundi … 7 = dimanche) } dans `fuseau`. */
export function depuisUtc(iso, fuseau) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const c = composantes(ms, fuseau);
  const date = `${c.an}-${pad(c.mois)}-${pad(c.jour)}`;
  const js = new Date(Date.UTC(c.an, c.mois - 1, c.jour)).getUTCDay();
  return {
    date,
    heure: `${pad(c.h)}:${pad(c.min)}`,
    minutes: c.h * 60 + c.min,
    jourSemaine: js === 0 ? 7 : js,
  };
}

/** Décalage d'un fuseau par rapport à UTC, en minutes, à un instant donné. */
export function decalageMinutes(iso, fuseau) {
  return Math.round(decalageMs(Date.parse(iso), fuseau) / 60000);
}

/** Date du jour (YYYY-MM-DD) dans le fuseau. */
export function aujourdhui(fuseau, maintenant = new Date()) {
  return depuisUtc(maintenant.toISOString(), fuseau).date;
}

export function minutesDepuisHeure(hhmm) {
  const [h, m] = (hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** Killzone (heure de New York) dans laquelle tombe l'instant, ou null. */
export function killzoneDe(iso, killzones) {
  const ny = depuisUtc(iso, FUSEAU_NY);
  if (!ny) return null;
  for (const kz of killzones || []) {
    if (kz.archive) continue;
    const debut = minutesDepuisHeure(kz.debut);
    const fin = minutesDepuisHeure(kz.fin);
    if (debut != null && fin != null && ny.minutes >= debut && ny.minutes < fin) return kz.id;
  }
  return null;
}

/** Semaine ISO d'une date YYYY-MM-DD → "2026-W42". */
export function semaineIso(date) {
  const [an, mois, jour] = date.split('-').map(Number);
  const d = new Date(Date.UTC(an, mois - 1, jour));
  const js = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - js);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const num = Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(num)}`;
}

/** Lundi (YYYY-MM-DD) d'une semaine ISO "2026-W42". */
export function lundiDeSemaine(semaine) {
  const [an, num] = semaine.split('-W').map(Number);
  const quatreJanvier = new Date(Date.UTC(an, 0, 4));
  const js = quatreJanvier.getUTCDay() || 7;
  const lundi = new Date(quatreJanvier);
  lundi.setUTCDate(quatreJanvier.getUTCDate() - js + 1 + (num - 1) * 7);
  return lundi.toISOString().slice(0, 10);
}

export function ajouterJours(date, n) {
  const [an, mois, jour] = date.split('-').map(Number);
  const d = new Date(Date.UTC(an, mois - 1, jour + n));
  return d.toISOString().slice(0, 10);
}

/** Durée en minutes entre deux instants ISO. */
export function dureeMinutes(debut, fin) {
  if (!debut || !fin) return null;
  const d = (Date.parse(fin) - Date.parse(debut)) / 60000;
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

export function formaterDuree(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

export const NOMS_JOURS = JOURS;
export const NOMS_MOIS = MOIS;

/** "2026-10-14" → "mercredi 14 octobre 2026". */
export function dateLongue(date) {
  if (!date) return '';
  const [an, mois, jour] = date.split('-').map(Number);
  const js = new Date(Date.UTC(an, mois - 1, jour)).getUTCDay() || 7;
  return `${JOURS[js - 1]} ${jour} ${MOIS[mois - 1]} ${an}`;
}

/** "2026-10-14" → "14/10/2026". */
export function dateCourte(date) {
  if (!date) return '';
  const [an, mois, jour] = date.split('-');
  return `${jour}/${mois}/${an}`;
}
