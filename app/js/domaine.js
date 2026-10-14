// Logique métier pure (sans DOM) : rattachement des trades aux sessions, discipline, etc.

import { depuisUtc } from './temps.js';
import { etatDiscipline, valeurR } from './calculs.js';

export const aCheckin = (session) =>
  !!session && (session.checkin?.decision != null || session.checkin?.energie != null);

export function sessionsDu(journal, partie, date) {
  return journal.sessions
    .filter((s) => s.partie === partie && s.date === date)
    .sort((a, b) => a.numero - b.numero);
}

export function prochainNumero(journal, partie, date) {
  return sessionsDu(journal, partie, date).reduce((max, s) => Math.max(max, s.numero), 0) + 1;
}

export function trouverParId(liste, id) {
  return id ? liste.find((x) => x.id === id) || null : null;
}

/**
 * Date qui rattache un trade à une session :
 * - réel : la date du trade (dans le fuseau de saisie) ;
 * - backtest : la date RÉELLE où le replay a été fait (création de la fiche), pas la date du marché rejoué.
 */
export function dateDeRattachement(trade, fuseau) {
  if (trade.partie === 'backtest') return depuisUtc(trade.creeLe, fuseau)?.date || null;
  return depuisUtc(trade.entreeLe, fuseau)?.date || null;
}

/** Session à laquelle rattacher automatiquement un trade (ou null). */
export function sessionPourTrade(journal, trade, fuseau) {
  const date = dateDeRattachement(trade, fuseau);
  if (!date) return null;
  const candidates = sessionsDu(journal, trade.partie, date);
  if (candidates.length <= 1) return candidates[0] || null;
  // Plusieurs sessions le même jour : la dernière ouverte avant le trade.
  const reference = trade.partie === 'backtest' ? trade.creeLe : trade.entreeLe;
  const avant = candidates.filter((s) => s.creeLe <= reference);
  return (avant.length ? avant : candidates)[(avant.length ? avant : candidates).length - 1];
}

export function tradesDeSession(journal, sessionId) {
  return journal.trades
    .filter((t) => t.sessionId === sessionId)
    .sort((a, b) => (a.entreeLe || a.creeLe).localeCompare(b.entreeLe || b.creeLe));
}

export function plansDeSession(journal, sessionId) {
  return journal.plans
    .filter((p) => p.sessionId === sessionId)
    .sort((a, b) => a.creeLe.localeCompare(b.creeLe));
}

/** Supprime une session : ses trades et plans restent, mais deviennent « sans check-in ». */
export function supprimerSession(journal, sessionId) {
  journal.sessions = journal.sessions.filter((s) => s.id !== sessionId);
  for (const liste of [journal.trades, journal.plans, journal.setupsNonPris]) {
    for (const x of liste) if (x.sessionId === sessionId) x.sessionId = null;
  }
}

/**
 * Discipline d'une session :
 * - « je ne trade pas » + aucun trade = victoire de discipline (score 100 %) ; un trade pris malgré tout = 0 % ;
 * - sinon, part des trades conformes parmi les trades dont la discipline est renseignée.
 */
export function disciplineSession(journal, session, p) {
  const trades = tradesDeSession(journal, session.id);
  let conformes = 0;
  let evalues = 0;
  for (const t of trades) {
    const { statut } = etatDiscipline(t, p);
    if (statut === 'conforme') { conformes += 1; evalues += 1; }
    if (statut === 'non_conforme') evalues += 1;
  }
  const base = { nbTrades: trades.length, conformes, evalues, decisionRespectee: null, victoire: false };
  if (session.checkin?.decision === 'pas_trade') {
    const respectee = trades.length === 0;
    return { ...base, decisionRespectee: respectee, victoire: respectee, score: respectee ? 1 : 0 };
  }
  if (session.checkin?.decision === 'trade') base.decisionRespectee = true;
  return { ...base, score: evalues ? conformes / evalues : null };
}

/** Somme des R des trades d'une session (null si aucun résultat connu). */
export function resultatSession(journal, session, p) {
  let total = null;
  for (const t of tradesDeSession(journal, session.id)) {
    const r = valeurR(t, p);
    if (r != null) total = (total ?? 0) + r;
  }
  return total;
}
