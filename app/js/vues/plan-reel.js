// Plan de trade (réel) : créé juste avant la prise de position, horodaté automatiquement.

import { store } from '../store.js';
import {
  h, monter, carte, champ, entreeTexte, entreeNombre, segment, selection, bouton, zoneImage, confirmer, notifier,
} from '../ui.js';
import { DIRECTIONS, QUALITES, STATUTS_PLAN, elementsActifs, nomDe } from '../modele.js';
import { rrPrevu, valeurR, signe } from '../calculs.js';
import { trouverParId } from '../domaine.js';
import { depuisUtc, dateLongue, dateCourte } from '../temps.js';
import { fmtR, fmtRatio, fmtNombre, classeSigne } from '../format.js';
import { naviguer } from '../navigation.js';
import { creerTrade, appliquerPlan, routeTrade } from '../actions.js';
import { libelleZone, optionsSessions } from './composants-trade.js';

const OPTIONS_QUALITE = QUALITES.map((q) => ({ id: q, nom: q }));

/** Le plan vu comme un trade (pour réutiliser les calculs de RR). */
const commeTrade = (plan) => ({ direction: plan.direction, prixEntree: plan.entree, sl: plan.sl, tp: plan.tp });

function horodatage(iso) {
  const d = depuisUtc(iso, store.p.fuseauSaisie);
  const secondes = new Date(iso).getUTCSeconds().toString().padStart(2, '0');
  return `${dateLongue(d.date)} à ${d.heure}:${secondes}`;
}

/** Trades réels sans plan, proches dans le temps, auxquels rattacher ce plan. */
function tradesRattachables(plan) {
  return store.journal.trades
    .filter((t) => t.partie === 'reel' && (!t.planId || t.id === plan.tradeId))
    .sort((a, b) => Math.abs(Date.parse(a.entreeLe || a.creeLe) - Date.parse(plan.creeLe))
      - Math.abs(Date.parse(b.entreeLe || b.creeLe) - Date.parse(plan.creeLe)))
    .slice(0, 30)
    .map((t) => {
      const q = depuisUtc(t.entreeLe, store.p.fuseauSaisie);
      return { id: t.id, nom: `${q ? `${dateCourte(q.date)} ${q.heure}` : 'sans date'} · ${nomDe(DIRECTIONS, t.direction)} ${t.instrument} · ${fmtR(valeurR(t, store.p))}` };
    });
}

/** Rattache un plan à un trade existant : ne remplit que les champs vides du trade. */
export function rattacherPlan(t, plan) {
  const avant = { ...t, zone: { ...t.zone } };
  appliquerPlan(t, plan);
  for (const cle of ['direction', 'setupId', 'qualite', 'prixEntree', 'sl', 'tp', 'instrument']) {
    if (avant[cle] != null && avant[cle] !== '') t[cle] = avant[cle];
  }
  if (avant.zone.typeId) t.zone = avant.zone;
  if (avant.qualite != null) t.qualiteAvantResultat = avant.qualiteAvantResultat;
}

export function detacherPlan(t) {
  const plan = trouverParId(store.journal.plans, t.planId);
  if (plan) {
    plan.tradeId = null;
    plan.statut = 'en_attente';
  }
  t.planId = null;
}

export function rendrePlan(conteneur, plan) {
  const p = store.p;
  const verrou = { ouvert: plan.statut === 'en_attente' };
  const zone = h('div');

  // Une fois le plan tranché (pris, non pris, annulé), il est verrouillé : c'est la trace de ce qui était prévu.
  const trancher = (statut) => {
    plan.statut = statut;
    verrou.ouvert = statut === 'en_attente';
    store.changer();
    rendreTout();
  };

  const rendreTout = () => {
    const verrouille = plan.statut !== 'en_attente' && !verrou.ouvert;
    const rr = rrPrevu(commeTrade(plan));
    const zoneRR = h('div', { class: 'stat' }, h('div', { class: 'stat-libelle' }, 'RR prévu'),
      h('div', { class: 'stat-valeur' }, fmtRatio(rr)));
    const majRR = () => {
      store.changer();
      zoneRR.querySelector('.stat-valeur').textContent = fmtRatio(rrPrevu(commeTrade(plan)));
    };
    const apresModif = () => {
      if (plan.statut !== 'en_attente') plan.corrigeLe = new Date().toISOString();
      majRR();
    };

    const formulaire = h('fieldset', { class: 'formulaire', disabled: verrouille },
      h('div', { class: 'pile' },
        h('div', { class: 'grille grille-2' },
          carte('Le plan',
            h('div', { class: 'pile' },
              champ('Session', selection(plan, 'sessionId', optionsSessions('reel', plan.sessionId), { vide: 'Sans check-in', apres: apresModif })),
              h('div', { class: 'grille grille-2' },
                champ('Instrument', entreeTexte(plan, 'instrument', { apres: apresModif })),
                champ('Direction', segment(plan, 'direction', DIRECTIONS, { apres: apresModif }))),
              h('div', { class: 'grille grille-2' },
                champ('Setup', selection(plan, 'setupId', elementsActifs(p.listes.setups, plan.setupId), { vide: '—', apres: apresModif })),
                champ('Qualité A / B / C', segment(plan, 'qualite', OPTIONS_QUALITE, { apres: apresModif }))),
              h('div', { class: 'grille grille-2' },
                champ("Zone d'entrée", segment(plan.zone, 'typeId', elementsActifs(p.listes.zones, plan.zone.typeId), { apres: apresModif })),
                champ('Timeframe de la zone', selection(plan.zone, 'tf', elementsActifs(p.listes.timeframes), { vide: '—', apres: apresModif }))),
              champ('Scénario (une ou deux lignes)', entreeTexte(plan, 'scenario', { multiligne: true, notes: true, lignes: 2, apres: apresModif,
                placeholder: 'ex. Sweep du low asiatique, MSS M1, entrée dans le FVG M1 vers la BSL.' })))),
          carte("Vision de l'entrée",
            zoneImage(plan.photo, (chemin) => { plan.photo = chemin; apresModif(); }, { libelle: "Photo de l'entrée" }))),
        carte('Niveaux prévus',
          h('div', { class: 'grille grille-4' },
            champ('Entrée', entreeNombre(plan, 'entree', { apres: apresModif })),
            champ('Stop loss', entreeNombre(plan, 'sl', { apres: apresModif })),
            champ('Take profit', entreeNombre(plan, 'tp', { apres: apresModif })),
            zoneRR))));

    const trade = trouverParId(store.journal.trades, plan.tradeId);
    const statut = carte('Statut',
      h('div', { class: 'pile' },
        h('div', { class: 'ligne' },
          h('span', { class: ['tag', plan.statut === 'pris' ? 'gain' : plan.statut === 'en_attente' ? 'alerte' : 'contour'] }, nomDe(STATUTS_PLAN, plan.statut)),
          plan.corrigeLe ? h('span', { class: 'tag perte', title: horodatage(plan.corrigeLe) }, 'Corrigé après coup') : null,
          h('span', { class: 'espace' }),
          verrouille ? bouton('Corriger le plan', async () => {
            const ok = await confirmer('Corriger le plan ?',
              'Le plan est la preuve de ce que tu avais prévu avant l’entrée. La correction sera signalée sur le plan.', { oui: 'Corriger' });
            if (ok) { verrou.ouvert = true; rendreTout(); }
          }, { classe: 'petit discret' }) : null),
        plan.statut === 'en_attente'
          ? h('div', { class: 'pile' },
            h('div', { class: 'ligne' },
              bouton('Prendre le trade', () => creerTrade('reel', { plan, sessionId: plan.sessionId }), { classe: 'principal' }),
              bouton('Non pris', () => trancher('non_pris')),
              bouton('Annulé', () => trancher('annule'))),
            champ('…ou rattacher à un trade déjà enregistré (ex. importé de cTrader)',
              selection({ v: null }, 'v', tradesRattachables(plan), {
                vide: 'Choisir un trade…',
                apres: (id) => {
                  const t = trouverParId(store.journal.trades, id);
                  if (!t) return;
                  if (t.planId) detacherPlan(t);
                  rattacherPlan(t, plan);
                  store.changer();
                  notifier('Plan rattaché au trade.', 'succes');
                  verrou.ouvert = false;
                  rendreTout();
                },
              })))
          : null,
        plan.statut === 'pris' && trade
          ? h('div', { class: 'ligne' },
            bouton('Voir le trade', () => naviguer(routeTrade(trade)), { classe: 'principal' }),
            bouton('Détacher du trade', () => { detacherPlan(trade); store.changer(); rendreTout(); }, { classe: 'discret' }))
          : null,
        ['non_pris', 'annule'].includes(plan.statut)
          ? h('div', { class: 'pile' },
            h('div', { class: 'grille grille-2' },
              champ('Raison', selection(plan, 'raisonId', elementsActifs(p.listes.raisonsNonPris, plan.raisonId), { vide: '—' })),
              champ('Précision', entreeTexte(plan, 'raisonNote', { notes: true }))),
            h('div', { class: 'ligne' }, bouton('Remettre en attente', () => trancher('en_attente'), { classe: 'petit discret' })))
          : null));

    monter(zone,
      h('div', { class: 'fil' }, h('a', { href: '#/trades' }, 'Trades'), ' › Plan de trade'),
      h('div', { class: 'titre-vue' },
        h('h1', {}, 'Plan de trade'),
        h('span', { class: 'tag contour mono', title: 'Horodatage automatique, non modifiable' }, `🔒 ${horodatage(plan.creeLe)}`),
        bouton('Supprimer', async () => {
          if (!(await confirmer('Supprimer ce plan ?', 'Le trade éventuellement rattaché est conservé.', { oui: 'Supprimer', danger: true }))) return;
          const t = trouverParId(store.journal.trades, plan.tradeId);
          if (t) t.planId = null;
          store.journal.plans = store.journal.plans.filter((x) => x.id !== plan.id);
          store.changer();
          naviguer('/trades');
        }, { classe: 'petit danger' })),
      h('div', { class: 'pile' }, statut, formulaire));
  };
  rendreTout();
  conteneur.append(zone);
}

// --- Plan vs réalité ---

function ecartPrix(prevu, reel, sens = 1) {
  if (prevu == null || reel == null) return null;
  return (reel - prevu) * sens;
}

export function comparaisonPlan(plan, t) {
  const p = store.p;
  // Les heures d'entrée se saisissent à la minute : on compare à la minute près.
  const minutePlan = Math.floor(Date.parse(plan.creeLe) / 60000);
  const ecartMin = t.entreeLe ? Math.floor(Date.parse(t.entreeLe) / 60000) - minutePlan : null;
  const sens = signe(t.direction) ?? 1;
  const r = valeurR(t, p);
  const rrPlan = rrPrevu(commeTrade(plan));
  const ligne = (libelle, prevu, reel, ecart = null, ok = null) => h('tr', {},
    h('td', {}, libelle),
    h('td', { class: 'num' }, prevu ?? '—'),
    h('td', { class: 'num' }, reel ?? '—'),
    h('td', { class: ['num', ok === true ? 'gain' : ok === false ? 'perte' : 'discret'] }, ecart ?? ''));
  const pareil = (a, b) => (a == null || b == null ? null : a === b);
  const txt = (a, b) => (pareil(a, b) == null ? '' : pareil(a, b) ? 'identique' : 'différent');
  const ecartTexte = (e) => (e == null ? '' : `${fmtNombre(e, 2, { signe: true })} pts`);
  // Pour l'entrée : un écart positif (dans le sens du trade) = entrée moins bonne que prévu.
  const eEntree = ecartPrix(plan.entree, t.prixEntree, sens);
  const zonePlan = plan.zone?.typeId ? libelleZone(plan.zone) : null;
  const zoneTrade = t.zone?.typeId ? libelleZone(t.zone) : null;

  return carte('Plan vs réalité',
    h('div', { class: 'pile' },
      h('div', { class: 'ligne' },
        h('a', { href: `#/trades/plan/${plan.id}` }, 'Voir le plan'),
        ecartMin == null ? null
          : ecartMin >= 0
            ? h('span', { class: 'tag gain' }, ecartMin === 0 ? "Plan créé dans la minute de l'entrée" : `Plan créé ${ecartMin} min avant l'entrée`)
            : h('span', { class: 'tag perte' }, `Plan créé ${-ecartMin} min APRÈS l'entrée`),
        plan.corrigeLe ? h('span', { class: 'tag perte' }, 'Plan corrigé après coup') : null),
      plan.scenario ? h('p', { class: 'police-notes' }, `« ${plan.scenario} »`) : null,
      h('div', { class: 'tableau-conteneur' },
        h('table', { class: 'tableau' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Plan'), h('th', { class: 'num' }, 'Réalité'), h('th', { class: 'num' }, 'Écart'))),
          h('tbody', {},
            ligne('Direction', nomDe(DIRECTIONS, plan.direction), nomDe(DIRECTIONS, t.direction), txt(plan.direction, t.direction), pareil(plan.direction, t.direction)),
            ligne('Setup', nomDe(p.listes.setups, plan.setupId), nomDe(p.listes.setups, t.setupId), txt(plan.setupId, t.setupId), pareil(plan.setupId, t.setupId)),
            ligne('Zone', libelleZone(plan.zone), libelleZone(t.zone), txt(zonePlan, zoneTrade), pareil(zonePlan, zoneTrade)),
            ligne('Qualité', plan.qualite, t.qualite, txt(plan.qualite, t.qualite), pareil(plan.qualite, t.qualite)),
            ligne('Entrée', fmtNombre(plan.entree, 2), fmtNombre(t.prixEntree, 2), ecartTexte(eEntree), eEntree == null ? null : eEntree <= 0),
            ligne('Stop loss', fmtNombre(plan.sl, 2), fmtNombre(t.sl, 2), ecartTexte(ecartPrix(plan.sl, t.sl)), pareil(plan.sl, t.sl)),
            ligne('Take profit', fmtNombre(plan.tp, 2), fmtNombre(t.tp, 2), ecartTexte(ecartPrix(plan.tp, t.tp)), pareil(plan.tp, t.tp)),
            ligne('RR / résultat', fmtRatio(rrPlan), fmtR(r), rrPlan != null && r != null ? `${fmtNombre((r / rrPlan) * 100, 0)} % de l'objectif` : '',
              rrPlan != null && r != null ? r >= rrPlan * 0.95 : null))))));
}
