// Éléments d'affichage partagés par les trades réels et backtest.

import { store } from '../store.js';
import { h } from '../ui.js';
import { nomDe, CHECKLIST, DIRECTIONS } from '../modele.js';
import { valeurR, rrPrevu, etatDiscipline } from '../calculs.js';
import { aCheckin, trouverParId } from '../domaine.js';
import { depuisUtc, dateCourte } from '../temps.js';
import { fmtR, fmtRatio, classeSigne } from '../format.js';
import { naviguer } from '../navigation.js';
import { routeTrade } from '../actions.js';

export function libelleZone(zone, p = store.p) {
  if (!zone?.typeId) return '—';
  return `${nomDe(p.listes.zones, zone.typeId)}${zone.tf ? ` ${zone.tf}` : ''}`;
}

export function tagDiscipline(t, p = store.p) {
  const { statut, violees } = etatDiscipline(t, p);
  if (statut === 'conforme') return h('span', { class: 'tag gain' }, 'Conforme');
  if (statut === 'non_conforme') {
    return h('span', { class: 'tag perte', title: violees.map((id) => nomDe(p.regles, id)).join('\n') },
      `Non conforme (${violees.length})`);
  }
  return h('span', { class: 'tag contour' }, 'À évaluer');
}

export function tagsStatut(t, journal = store.journal) {
  const tags = [];
  if (t.statut === 'a_completer') tags.push(h('span', { class: 'tag alerte' }, 'À compléter'));
  const session = trouverParId(journal.sessions, t.sessionId);
  if (!aCheckin(session)) tags.push(h('span', { class: 'tag contour', title: "Compte dans les stats normales, pas dans celles liées à l'énergie." }, 'Sans check-in'));
  if (t.partie === 'backtest' && t.regardeFutur) tags.push(h('span', { class: 'tag perte' }, 'Futur vu'));
  return tags;
}

export function nbChecklist(t) {
  return CHECKLIST.filter((c) => t.checklist?.[c.id] === true).length;
}

/** Tableau de trades cliquables. */
export function tableauTrades(trades, { p = store.p, vide: texteVide = 'Aucun trade.' } = {}) {
  if (!trades.length) return h('p', { class: 'discret' }, texteVide);
  const backtest = trades.every((t) => t.partie === 'backtest');
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {},
        h('th', {}, backtest ? 'Date du marché' : 'Date'), h('th', {}, 'Heure'), h('th', {}, 'Setup'), h('th', {}, 'Zone'),
        h('th', {}, 'Sens'), h('th', {}, 'Qualité'), h('th', { class: 'num' }, 'Checklist'),
        h('th', { class: 'num' }, 'RR prévu'), h('th', { class: 'num' }, 'Résultat'), h('th', {}, 'Discipline'), h('th', {}, ''))),
      h('tbody', {}, trades.map((t) => {
        const quand = depuisUtc(t.entreeLe, p.fuseauSaisie);
        const r = valeurR(t, p);
        return h('tr', { class: 'cliquable', onclick: () => naviguer(routeTrade(t)) },
          h('td', { class: 'mono' }, quand ? dateCourte(quand.date) : '—'),
          h('td', { class: 'mono' }, quand?.heure || '—'),
          h('td', {}, nomDe(p.listes.setups, t.setupId)),
          h('td', {}, libelleZone(t.zone, p)),
          h('td', {}, t.direction ? h('span', { class: t.direction === 'long' ? 'gain' : 'perte' }, nomDe(DIRECTIONS, t.direction)) : '—'),
          h('td', { class: 'mono' }, t.qualite || '—'),
          h('td', { class: 'num' }, `${nbChecklist(t)}/6`),
          h('td', { class: 'num' }, fmtRatio(rrPrevu(t))),
          h('td', { class: ['num', classeSigne(r)] }, fmtR(r)),
          h('td', {}, tagDiscipline(t, p)),
          h('td', {}, h('div', { class: 'ligne', style: { gap: '4px', flexWrap: 'nowrap' } }, tagsStatut(t))));
      }))));
}

/** Liste des sessions proposées pour rattacher un trade. */
export function optionsSessions(partie, idCourant) {
  return store.journal.sessions
    .filter((s) => s.partie === partie)
    .sort((a, b) => b.date.localeCompare(a.date) || b.numero - a.numero)
    .filter((s, i) => i < 90 || s.id === idCourant)
    .map((s) => ({ id: s.id, nom: `${dateCourte(s.date)} · session ${s.numero}${aCheckin(s) ? '' : ' (sans check-in)'}` }));
}

