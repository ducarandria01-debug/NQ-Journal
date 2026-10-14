// Résumé d'une session et bloc « plans et trades » de sa fiche.

import { store } from '../store.js';
import { h, carte, bouton } from '../ui.js';
import { STATUTS_PLAN, DIRECTIONS, nomDe } from '../modele.js';
import { tradesDeSession, plansDeSession, disciplineSession, resultatSession } from '../domaine.js';
import { fmtR, fmtPct, classeSigne } from '../format.js';
import { depuisUtc } from '../temps.js';
import { creerTrade, creerPlan, creerSetupNonPris } from '../actions.js';
import { naviguer } from '../navigation.js';
import { tableauTrades } from './composants-trade.js';

export function resumeSession(journal, session, p) {
  const total = resultatSession(journal, session, p);
  return {
    nbTrades: tradesDeSession(journal, session.id).length,
    total,
    texteR: fmtR(total),
    classeR: classeSigne(total),
    discipline: disciplineSession(journal, session, p),
  };
}

export function classeScore(score) {
  if (score == null) return 'neutre';
  if (score >= 1) return 'gain';
  if (score >= 0.5) return 'alerte';
  return 'perte';
}

export function celluleDiscipline(d) {
  if (d.victoire) return h('span', { class: 'tag gain', title: '« Je ne trade pas » respecté' }, 'Victoire · pas de trade');
  if (d.decisionRespectee === false) return h('span', { class: 'tag perte' }, 'Trade malgré « je ne trade pas »');
  if (d.score == null) return h('span', { class: 'discret' }, '—');
  return h('span', { class: ['tag', classeScore(d.score)] }, `${fmtPct(d.score * 100, 0)} conformes`);
}

function listePlans(plans) {
  if (!plans.length) return null;
  const p = store.p;
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Plan créé à'), h('th', {}, 'Setup'), h('th', {}, 'Sens'),
        h('th', {}, 'Qualité'), h('th', {}, 'Scénario'), h('th', {}, 'Statut'))),
      h('tbody', {}, plans.map((plan) => h('tr', { class: 'cliquable', onclick: () => naviguer(`/trades/plan/${plan.id}`) },
        h('td', { class: 'mono' }, depuisUtc(plan.creeLe, p.fuseauSaisie).heure),
        h('td', {}, nomDe(p.listes.setups, plan.setupId)),
        h('td', {}, nomDe(DIRECTIONS, plan.direction)),
        h('td', { class: 'mono' }, plan.qualite || '—'),
        h('td', { class: 'police-notes', style: { whiteSpace: 'normal', maxWidth: '360px' } }, plan.scenario || '—'),
        h('td', {}, h('span', { class: ['tag', plan.statut === 'pris' ? 'gain' : plan.statut === 'en_attente' ? 'alerte' : 'contour'] },
          nomDe(STATUTS_PLAN, plan.statut))))))));
}

export function blocTradesDeSession(session) {
  const j = store.journal;
  const p = store.p;
  const trades = tradesDeSession(j, session.id);
  const d = disciplineSession(j, session, p);
  const total = resultatSession(j, session, p);
  const actions = session.partie === 'reel'
    ? [
      bouton('+ Plan de trade', () => creerPlan({ sessionId: session.id }), { classe: 'principal', titre: 'À créer juste avant de prendre position' }),
      bouton('+ Trade', () => creerTrade('reel', { sessionId: session.id })),
    ]
    : [
      bouton('+ Trade de backtest', () => creerTrade('backtest', { sessionId: session.id }), { classe: 'principal' }),
      bouton('+ Setup présent non pris', () => creerSetupNonPris({ sessionId: session.id })),
    ];
  const nonPris = session.partie === 'backtest' ? j.setupsNonPris.filter((x) => x.sessionId === session.id).length : 0;

  return carte(session.partie === 'reel' ? 'Plans et trades de la session' : 'Trades de la session',
    h('div', { class: 'pile' },
      h('div', { class: 'ligne' },
        ...actions,
        h('span', { class: 'espace' }),
        h('span', { class: 'discret' }, 'Résultat :'), h('span', { class: ['mono', classeSigne(total)] }, fmtR(total)),
        h('span', { class: 'discret' }, 'Discipline :'), celluleDiscipline(d)),
      session.checkin.decision === 'pas_trade' && !trades.length
        ? h('div', { class: 'info' }, 'Décision « je ne trade pas » : une session sans trade est une victoire de discipline.')
        : null,
      session.partie === 'reel' ? listePlans(plansDeSession(j, session.id)) : null,
      tableauTrades(trades, { vide: 'Aucun trade dans cette session.' }),
      nonPris ? h('p', { class: 'discret' }, `${nonPris} setup(s) présent(s) non pris enregistré(s) pour cette session.`) : null));
}
