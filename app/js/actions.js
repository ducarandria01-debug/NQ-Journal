// Création des fiches (sessions, plans, trades…) avec leurs valeurs par défaut et leur rattachement.

import { store } from './store.js';
import {
  nouvelleSession, nouveauTrade, nouveauPlan, nouveauSetupNonPris, nouvelleCampagne, elementsActifs,
} from './modele.js';
import { prochainNumero, sessionPourTrade, trouverParId } from './domaine.js';
import { aujourdhui } from './temps.js';
import { naviguer } from './navigation.js';

export const routeTrade = (t) => (t.partie === 'backtest' ? `/backtest/trade/${t.id}` : `/trades/${t.id}`);

/** Instant actuel arrondi à la minute (ISO UTC). */
function maintenantMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function creerSession(partie, date = aujourdhui(store.p.fuseauSaisie), { ouvrir = true } = {}) {
  const s = nouvelleSession({ partie, date, numero: prochainNumero(store.journal, partie, date) });
  if (partie === 'backtest') {
    s.campagneId = store.journal.campagnes.filter((c) => c.active).at(-1)?.id || null;
  }
  store.journal.sessions.push(s);
  store.changer();
  if (ouvrir) naviguer(`/sessions/${s.id}`);
  return s;
}

function compteParDefaut() {
  return elementsActifs(store.p.listes.comptes)[0]?.id || null;
}

export function creerTrade(partie, { sessionId = null, plan = null, ouvrir = true } = {}) {
  const p = store.p;
  const t = nouveauTrade({ partie, instrument: plan?.instrument || p.instrumentParDefaut });
  t.risquePct = p.risqueDefautPct ?? null;
  t.risqueUsd = p.risqueDefautUsd ?? null;
  if (partie === 'reel') {
    t.compteId = compteParDefaut();
    t.entreeLe = maintenantMinute();
  }
  if (plan) appliquerPlan(t, plan);
  if (sessionId) {
    t.sessionId = sessionId;
  } else if (partie === 'reel' || partie === 'backtest') {
    t.sessionId = sessionPourTrade(store.journal, t, p.fuseauSaisie)?.id || null;
  }
  if (partie === 'backtest') {
    const session = trouverParId(store.journal.sessions, t.sessionId);
    t.campagneId = session?.campagneId || store.journal.campagnes.filter((c) => c.active).at(-1)?.id || null;
  }
  store.journal.trades.push(t);
  store.changer();
  if (ouvrir) naviguer(routeTrade(t));
  return t;
}

/** Préremplit un trade avec les champs de son plan et lie les deux fiches. */
export function appliquerPlan(t, plan) {
  t.planId = plan.id;
  t.instrument = plan.instrument || t.instrument;
  t.direction = plan.direction;
  t.setupId = plan.setupId;
  t.zone = { ...plan.zone };
  t.qualite = plan.qualite;
  t.qualiteAvantResultat = plan.qualite != null ? true : t.qualiteAvantResultat;
  t.prixEntree = plan.entree;
  t.sl = plan.sl;
  t.tp = plan.tp;
  if (plan.photo && !t.screenshots.avant) t.screenshots.avant = plan.photo;
  if (plan.sessionId && !t.sessionId) t.sessionId = plan.sessionId;
  plan.statut = 'pris';
  plan.tradeId = t.id;
}

export function creerPlan({ sessionId = null, ouvrir = true } = {}) {
  const p = store.p;
  const plan = nouveauPlan({ instrument: p.instrumentParDefaut });
  if (sessionId) {
    plan.sessionId = sessionId;
  } else {
    // Même logique que pour un trade réel : la session du jour.
    plan.sessionId = sessionPourTrade(store.journal, { partie: 'reel', entreeLe: plan.creeLe, creeLe: plan.creeLe }, p.fuseauSaisie)?.id || null;
  }
  store.journal.plans.push(plan);
  store.changer();
  if (ouvrir) naviguer(`/trades/plan/${plan.id}`);
  return plan;
}

export function creerSetupNonPris({ sessionId = null, campagneId = null, ouvrir = true } = {}) {
  const p = store.p;
  if (!sessionId) {
    sessionId = sessionPourTrade(store.journal, { partie: 'backtest', creeLe: new Date().toISOString() }, p.fuseauSaisie)?.id || null;
  }
  const session = trouverParId(store.journal.sessions, sessionId);
  const snp = nouveauSetupNonPris({
    sessionId,
    campagneId: campagneId || session?.campagneId || store.journal.campagnes.filter((c) => c.active).at(-1)?.id || null,
  });
  snp.instrument = p.instrumentParDefaut;
  store.journal.setupsNonPris.push(snp);
  store.changer();
  if (ouvrir) naviguer(`/backtest/non-pris/${snp.id}`);
  return snp;
}

export function creerCampagne({ ouvrir = true } = {}) {
  const c = nouvelleCampagne();
  store.journal.campagnes.push(c);
  store.changer();
  if (ouvrir) naviguer(`/backtest/campagne/${c.id}`);
  return c;
}
