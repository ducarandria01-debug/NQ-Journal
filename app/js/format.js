// Mise en forme des nombres (français). Fonctions pures, testables sous Node.

const cache = new Map();
function nf(min, max, signe = false) {
  const cle = `${min}-${max}-${signe}`;
  if (!cache.has(cle)) {
    cache.set(cle, new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      signDisplay: signe ? 'exceptZero' : 'auto',
    }));
  }
  return cache.get(cle);
}

const ok = (n) => typeof n === 'number' && Number.isFinite(n);

export function fmtNombre(n, dec = 2, { signe = false, min = 0 } = {}) {
  return ok(n) ? nf(Math.min(min, dec), dec, signe).format(n) : '—';
}

export function fmtR(r, dec = 2) {
  return ok(r) ? `${nf(dec, dec, true).format(r)} R` : '—';
}

export function fmtPct(p, dec = 1, { signe = false } = {}) {
  return ok(p) ? `${nf(dec, dec, signe).format(p)} %` : '—';
}

export function fmtUsd(n, { signe = false, dec = 2 } = {}) {
  return ok(n) ? `${nf(dec, dec, signe).format(n)} $` : '—';
}

export function fmtRatio(r, dec = 2) {
  return ok(r) ? nf(dec, dec).format(r) : '—';
}

/** Lit un nombre saisi à la française ("1 234,5") ou à l'anglaise ("1234.5"). */
export function lireNombre(texte) {
  if (texte == null) return null;
  const propre = String(texte).trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (propre === '' || propre === '-' || propre === '.') return null;
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

/** Classe CSS selon le signe (gain / perte / neutre). */
export function classeSigne(n) {
  if (!ok(n) || n === 0) return 'neutre';
  return n > 0 ? 'gain' : 'perte';
}
