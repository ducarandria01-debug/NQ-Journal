// Graphiques SVG légers : courbe des R cumulés, barres divergentes, jauges.

import { h } from '../ui.js';
import { fmtR } from '../format.js';
import { depuisUtc, dateCourte } from '../temps.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...enfants) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const e of enfants.flat()) if (e) el.append(e);
  return el;
}

/** Graduations « rondes » entre min et max. */
function graduations(min, max, cible = 5) {
  const etendue = max - min || 1;
  const brut = etendue / cible;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((x) => etendue / x <= cible) || puissance * 10;
  const debut = Math.floor(min / pas) * pas;
  const fin = Math.ceil(max / pas) * pas;
  const ticks = [];
  for (let v = debut; v <= fin + pas / 2; v += pas) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * Courbe des R cumulés (une seule série : pas de légende, le titre la nomme).
 * Survol : un réticule vertical se cale sur le trade le plus proche et affiche ses valeurs.
 */
export function courbeR(courbe, { fuseau, hauteur = 240 } = {}) {
  const conteneur = h('div', { class: 'graphique' });
  if (!courbe.length) {
    conteneur.append(h('p', { class: 'discret' }, 'Pas encore de trade clôturé.'));
    return conteneur;
  }
  const points = [{ cumul: 0, r: null, entreeLe: null }, ...courbe];
  const valeurs = points.map((pt) => pt.cumul);
  const ticks = graduations(Math.min(0, ...valeurs), Math.max(0, ...valeurs));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const largeur = 800;
  const marge = { g: 44, d: 14, h: 12, b: 22 };
  const x = (i) => marge.g + (i / Math.max(1, points.length - 1)) * (largeur - marge.g - marge.d);
  const y = (v) => marge.h + (1 - (v - yMin) / (yMax - yMin || 1)) * (hauteur - marge.h - marge.b);

  const ligne = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.cumul).toFixed(1)}`).join('');
  const aire = `${ligne}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const dernier = points[points.length - 1];

  const reticule = s('line', { class: 'reticule', y1: marge.h, y2: hauteur - marge.b, visibility: 'hidden' });
  const repere = s('circle', { class: 'repere', r: 4.5, visibility: 'hidden' });
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${hauteur}`, class: 'svg-courbe', role: 'img',
    'aria-label': `Courbe des R cumulés : ${fmtR(dernier.cumul)} après ${courbe.length} trades` },
  ticks.map((t) => s('g', {},
    s('line', { class: t === 0 ? 'axe-zero' : 'grille', x1: marge.g, x2: largeur - marge.d, y1: y(t), y2: y(t) }),
    s('text', { class: 'tick', x: marge.g - 8, y: y(t) + 4, 'text-anchor': 'end' }, document.createTextNode(`${t > 0 ? '+' : ''}${String(t).replace('.', ',')}`)))),
  s('path', { class: 'aire', d: aire }),
  s('path', { class: 'trace', d: ligne }),
  s('circle', { class: 'point-fin', cx: x(points.length - 1), cy: y(dernier.cumul), r: 4.5 }),
  reticule, repere);

  const bulle = h('div', { class: 'bulle', hidden: true });
  const cible = h('div', { class: 'graphique-cible', tabIndex: 0, 'aria-label': 'Parcourir les trades de la courbe' });

  let indexActif = null;
  const montrer = (i) => {
    indexActif = Math.max(1, Math.min(points.length - 1, i));
    const pt = points[indexActif];
    reticule.setAttribute('x1', x(indexActif));
    reticule.setAttribute('x2', x(indexActif));
    repere.setAttribute('cx', x(indexActif));
    repere.setAttribute('cy', y(pt.cumul));
    reticule.setAttribute('visibility', 'visible');
    repere.setAttribute('visibility', 'visible');
    const d = depuisUtc(pt.entreeLe, fuseau);
    bulle.replaceChildren(
      h('div', { class: 'bulle-valeur mono' }, fmtR(pt.cumul)),
      h('div', { class: 'bulle-ligne' }, h('span', { class: 'cle-ligne' }), `Trade n° ${indexActif} : ${fmtR(pt.r)}`),
      d ? h('div', { class: 'bulle-detail' }, `${dateCourte(d.date)} ${d.heure}`) : null);
    bulle.hidden = false;
    const largeurAffichee = cible.getBoundingClientRect().width || largeur;
    const px = (x(indexActif) / largeur) * largeurAffichee;
    bulle.style.left = `${Math.min(px + 12, largeurAffichee - 170)}px`;
  };
  const cacher = () => {
    reticule.setAttribute('visibility', 'hidden');
    repere.setAttribute('visibility', 'hidden');
    bulle.hidden = true;
  };
  cible.addEventListener('pointermove', (e) => {
    const rect = cible.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * largeur;
    montrer(Math.round(((vx - marge.g) / (largeur - marge.g - marge.d)) * (points.length - 1)));
  });
  cible.addEventListener('pointerleave', cacher);
  cible.addEventListener('focus', () => montrer(points.length - 1));
  cible.addEventListener('blur', cacher);
  cible.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { montrer((indexActif ?? points.length) - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { montrer((indexActif ?? 0) + 1); e.preventDefault(); }
  });
  cible.append(svg, bulle);
  conteneur.append(cible);
  return conteneur;
}

/** Barre horizontale centrée sur zéro (valeur en R), pour les tableaux. */
export function barreDivergente(valeur, maxAbs) {
  const el = h('div', { class: 'barre-div' }, h('span', { class: 'barre-div-zero' }));
  if (typeof valeur === 'number' && Number.isFinite(valeur) && maxAbs > 0) {
    const pct = Math.min(50, (Math.abs(valeur) / maxAbs) * 50);
    el.append(h('span', {
      class: ['barre-div-val', valeur >= 0 ? 'pos' : 'neg'],
      style: valeur >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` },
    }));
  }
  return el;
}

/** Jauge 0 → 1. `ton` : accent, gain, alerte, perte. */
export function jauge(fraction, ton = 'accent') {
  const f = Math.max(0, Math.min(1, fraction ?? 0));
  return h('div', { class: ['jauge', ton], role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(f * 100)) },
    h('span', { style: { width: `${f * 100}%` } }));
}
