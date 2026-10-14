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

/**
 * Compteur d'occurrences par setup en backtest : trades pris + setups présents non pris.
 * `campagneId` null = toutes les campagnes. Les trades « futur vu » sont comptés à part.
 */
export function occurrencesParSetup(journal, campagneId = null) {
  const parSetup = new Map();
  const ligne = (id) => {
    if (!parSetup.has(id)) parSetup.set(id, { setupId: id, pris: 0, nonPris: 0, futurVu: 0, total: 0 });
    return parSetup.get(id);
  };
  const garder = (x) => campagneId == null || x.campagneId === campagneId;
  for (const t of journal.trades) {
    if (t.partie !== 'backtest' || !garder(t)) continue;
    const l = ligne(t.setupId || null);
    l.pris += 1;
    l.total += 1;
    if (t.regardeFutur) l.futurVu += 1;
  }
  for (const s of journal.setupsNonPris) {
    if (!garder(s)) continue;
    const l = ligne(s.setupId || null);
    l.nonPris += 1;
    l.total += 1;
  }
  return [...parSetup.values()].sort((a, b) => b.total - a.total);
}

/** Supprime une campagne : ses trades, sessions et setups non pris sont conservés, sans campagne. */
export function supprimerCampagne(journal, campagneId) {
  journal.campagnes = journal.campagnes.filter((c) => c.id !== campagneId);
  for (const liste of [journal.trades, journal.sessions, journal.setupsNonPris]) {
    for (const x of liste) if (x.campagneId === campagneId) x.campagneId = null;
  }
}

/**
 * Résumé par jour pour le calendrier : trades rattachés à la date (réel : date du trade ;
 * backtest : date réelle du replay), R total et état de discipline.
 * etat : 'victoire' (« je ne trade pas » respecté), 'conforme' (100 %), 'partiel', 'non_conforme', ou null.
 */
export function resumeParJour(journal, partie, p) {
  const jours = new Map();
  const jour = (date) => {
    if (!jours.has(date)) jours.set(date, { date, trades: [], sessions: [] });
    return jours.get(date);
  };
  for (const s of journal.sessions) if (s.partie === partie) jour(s.date).sessions.push(s);
  for (const t of journal.trades) {
    if (t.partie !== partie) continue;
    const date = dateDeRattachement(t, p.fuseauSaisie);
    if (date) jour(date).trades.push(t);
  }
  for (const j of jours.values()) {
    const rs = j.trades.map((t) => valeurR(t, p)).filter((r) => r != null);
    j.totalR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
    let conformes = 0;
    let evalues = 0;
    for (const t of j.trades) {
      const { statut } = etatDiscipline(t, p);
      if (statut === 'conforme') { conformes += 1; evalues += 1; } else if (statut === 'non_conforme') evalues += 1;
    }
    const pasTrade = j.sessions.some((s) => s.checkin?.decision === 'pas_trade');
    if (pasTrade && j.trades.length) j.etat = 'non_conforme';
    else if (pasTrade) j.etat = 'victoire';
    else if (!evalues) j.etat = null;
    else if (conformes === evalues) j.etat = 'conforme';
    else j.etat = conformes ? 'partiel' : 'non_conforme';
    j.score = pasTrade ? (j.trades.length ? 0 : 1) : evalues ? conformes / evalues : null;
  }
  return jours;
}
