// Onglet « Trades » (réel) : plans en attente, liste des trades, fiches.

import { store } from '../store.js';
import { h, monter, carte, segment, selection, bouton, vide } from '../ui.js';
import { DIRECTIONS, elementsActifs, nomDe } from '../modele.js';
import { trouverParId } from '../domaine.js';
import { depuisUtc } from '../temps.js';
import { lirePref, ecrirePref } from '../etat-ui.js';
import { naviguer } from '../navigation.js';
import { creerTrade, creerPlan } from '../actions.js';
import { tableauTrades } from './composants-trade.js';
import { rendreFicheTrade } from './fiche-trade.js';
import { rendrePlan } from './plan-reel.js';
import { ouvrirImportCtrader } from './import-ctrader.js';

export function rendre(conteneur, segments) {
  if (segments[0] === 'plan') {
    const plan = trouverParId(store.journal.plans, segments[1]);
    if (!plan) return conteneur.append(vide('Ce plan n’existe plus.', bouton('Retour aux trades', () => naviguer('/trades'))));
    return rendrePlan(conteneur, plan);
  }
  if (segments[0]) {
    const t = trouverParId(store.journal.trades, segments[0]);
    if (!t || t.partie !== 'reel') return conteneur.append(vide('Ce trade n’existe plus.', bouton('Retour aux trades', () => naviguer('/trades'))));
    return rendreFicheTrade(conteneur, t);
  }
  return rendreListe(conteneur);
}

function plansEnAttente() {
  const p = store.p;
  const plans = store.journal.plans.filter((pl) => pl.statut === 'en_attente')
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  if (!plans.length) return null;
  return carte('Plans en attente',
    h('div', { class: 'pile' }, plans.map((pl) => {
      const q = depuisUtc(pl.creeLe, p.fuseauSaisie);
      return h('div', { class: 'ligne plan-attente' },
        h('span', { class: 'mono' }, `${q.date.slice(8)}/${q.date.slice(5, 7)} ${q.heure}`),
        h('span', {}, `${nomDe(DIRECTIONS, pl.direction, '?')} · ${nomDe(p.listes.setups, pl.setupId, 'setup ?')}${pl.qualite ? ` · ${pl.qualite}` : ''}`),
        h('span', { class: 'police-notes discret', style: { flex: 1, minWidth: '160px' } }, pl.scenario),
        bouton('Prendre le trade', () => creerTrade('reel', { plan: pl, sessionId: pl.sessionId }), { classe: 'petit principal' }),
        bouton('Ouvrir', () => naviguer(`/trades/plan/${pl.id}`), { classe: 'petit' }));
    })));
}

function rendreListe(conteneur) {
  const p = store.p;
  const filtres = lirePref('trades:filtres', { statut: 'tous', compteId: null, setupId: null });
  const zoneTableau = h('div');

  const rendreTableau = () => {
    ecrirePref('trades:filtres', filtres);
    const trades = store.journal.trades
      .filter((t) => t.partie === 'reel')
      .filter((t) => filtres.statut !== 'a_completer' || t.statut === 'a_completer')
      .filter((t) => !filtres.compteId || t.compteId === filtres.compteId)
      .filter((t) => !filtres.setupId || t.setupId === filtres.setupId)
      .sort((a, b) => (b.entreeLe || b.creeLe).localeCompare(a.entreeLe || a.creeLe));
    monter(zoneTableau, tableauTrades(trades, {
      vide: store.journal.trades.some((t) => t.partie === 'reel')
        ? 'Aucun trade ne correspond aux filtres.'
        : 'Aucun trade réel pour l’instant. Crée un plan juste avant ta prochaine entrée, ou importe ton historique cTrader.',
    }));
  };

  const aCompleter = store.journal.trades.filter((t) => t.partie === 'reel' && t.statut === 'a_completer').length;
  conteneur.append(
    h('div', { class: 'titre-vue' },
      h('h1', {}, 'Trades'),
      bouton('+ Plan de trade', () => creerPlan(), { classe: 'principal', titre: 'À créer juste avant de prendre position' }),
      bouton('+ Trade', () => creerTrade('reel')),
      bouton('Importer cTrader…', () => ouvrirImportCtrader())),
    h('div', { class: 'pile' },
      plansEnAttente(),
      h('div', { class: 'ligne' },
        segment(filtres, 'statut', [{ id: 'tous', nom: 'Tous' }, { id: 'a_completer', nom: `À compléter (${aCompleter})` }],
          { vide: false, apres: rendreTableau }),
        h('div', { style: { width: '200px' } }, selection(filtres, 'compteId', elementsActifs(p.listes.comptes, filtres.compteId), { vide: 'Tous les comptes', apres: rendreTableau })),
        h('div', { style: { width: '200px' } }, selection(filtres, 'setupId', elementsActifs(p.listes.setups, filtres.setupId), { vide: 'Tous les setups', apres: rendreTableau }))),
      zoneTableau));
  rendreTableau();
}
