// Moteur de statistiques. Tout est mesuré en R pour comparer backtest et réel.
// Fonctions pures, testées sous Node.

import { CHECKLIST, nomDe, DIRECTIONS } from './modele.js';
import { valeurR, rrPrevu, etatDiscipline } from './calculs.js';
import { trouverParId, aCheckin } from './domaine.js';
import { depuisUtc, killzoneDe, FUSEAU_NY, NOMS_JOURS, minutesDepuisHeure } from './temps.js';

const nb = (x) => typeof x === 'number' && Number.isFinite(x);
const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const somme = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * Trades retenus pour les stats (clôturés, filtrés), triés par date d'entrée.
 * Exclus : trades sans résultat ; en backtest, trades où le futur a été regardé.
 */
export function selectionTrades(journal, p, filtres = {}) {
  const { partie = 'reel', compteId = null, campagneId = null, setupId = null, debut = null, fin = null } = filtres;
  const exclus = { futurVu: 0, sansResultat: 0 };
  const trades = [];
  for (const t of journal.trades) {
    if (t.partie !== partie) continue;
    if (partie === 'reel' && compteId && t.compteId !== compteId) continue;
    if (partie === 'backtest' && campagneId && t.campagneId !== campagneId) continue;
    if (setupId && t.setupId !== setupId) continue;
    const date = depuisUtc(t.entreeLe, p.fuseauSaisie)?.date || null;
    if ((debut && (!date || date < debut)) || (fin && (!date || date > fin))) continue;
    if (partie === 'backtest' && t.regardeFutur) { exclus.futurVu += 1; continue; }
    if (valeurR(t, p) == null) { exclus.sansResultat += 1; continue; }
    trades.push(t);
  }
  trades.sort((a, b) => (a.entreeLe || a.creeLe).localeCompare(b.entreeLe || b.creeLe));
  return { trades, exclus };
}

const risquePct = (t, p) => (nb(t.risquePct) ? t.risquePct : nb(p.risqueDefautPct) ? p.risqueDefautPct : null);

/** Statistiques de base d'une liste de trades (déjà triés par date). */
export function statsDeBase(trades, p) {
  const rs = trades.map((t) => valeurR(t, p)).filter(nb);
  const gains = rs.filter((r) => r > 0);
  const pertes = rs.filter((r) => r < 0);
  const gainMoyen = moyenne(gains);
  const perteMoyenne = moyenne(pertes);
  const sommeGains = somme(gains);
  const sommePertes = -somme(pertes);

  // Courbe des R cumulés, drawdown max (en R et en %) et séries
  let cumul = 0;
  let cumulPct = 0;
  let pic = 0;
  let picPct = 0;
  let ddMax = 0;
  let ddMaxPct = 0;
  let serie = 0;
  let serieGainsMax = 0;
  let seriePertesMax = 0;
  let pctComplet = true;
  const courbe = [];
  for (const t of trades) {
    const r = valeurR(t, p);
    if (!nb(r)) continue;
    cumul += r;
    const rp = risquePct(t, p);
    if (nb(rp)) cumulPct += r * rp; else pctComplet = false;
    pic = Math.max(pic, cumul);
    picPct = Math.max(picPct, cumulPct);
    ddMax = Math.max(ddMax, pic - cumul);
    ddMaxPct = Math.max(ddMaxPct, picPct - cumulPct);
    if (r > 0) serie = serie > 0 ? serie + 1 : 1;
    else if (r < 0) serie = serie < 0 ? serie - 1 : -1;
    else serie = 0;
    serieGainsMax = Math.max(serieGainsMax, serie);
    seriePertesMax = Math.max(seriePertesMax, -serie);
    courbe.push({ id: t.id, entreeLe: t.entreeLe, r, cumul });
  }

  const rrPrevus = trades.map(rrPrevu).filter(nb);
  return {
    n: rs.length,
    gagnants: gains.length,
    perdants: pertes.length,
    nuls: rs.length - gains.length - pertes.length,
    winrate: rs.length ? gains.length / rs.length : null,
    gainMoyen,
    perteMoyenne,
    rrMoyen: nb(gainMoyen) && nb(perteMoyenne) && perteMoyenne !== 0 ? gainMoyen / -perteMoyenne : null,
    rrPrevuMoyen: moyenne(rrPrevus),
    expectancy: moyenne(rs),
    totalR: rs.length ? somme(rs) : null,
    totalPct: rs.length && pctComplet ? cumulPct : null,
    drawdownMaxR: ddMax,
    drawdownMaxPct: pctComplet ? ddMaxPct : null,
    profitFactor: sommePertes > 0 ? sommeGains / sommePertes : (sommeGains > 0 ? Infinity : null),
    serieGainsMax,
    seriePertesMax,
    courbe,
  };
}

export function tauxDiscipline(trades, p) {
  let conformes = 0;
  let evalues = 0;
  for (const t of trades) {
    const { statut } = etatDiscipline(t, p);
    if (statut === 'conforme') conformes += 1;
    if (statut !== 'incomplet') evalues += 1;
  }
  return { conformes, evalues, taux: evalues ? conformes / evalues : null };
}

/** Regroupe les trades par clé et calcule les stats de chaque groupe. */
export function decouper(trades, p, cle, { libelle = (k) => k ?? '—', ordre = null } = {}) {
  const groupes = new Map();
  for (const t of trades) {
    const k = cle(t);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(t);
  }
  let lignes = [...groupes.entries()].map(([k, ts]) => {
    const s = statsDeBase(ts, p);
    return { cle: k, libelle: libelle(k), n: s.n, winrate: s.winrate, expectancy: s.expectancy, totalR: s.totalR, profitFactor: s.profitFactor };
  });
  if (ordre) {
    lignes.sort((a, b) => ordre.indexOf(a.cle) - ordre.indexOf(b.cle));
  } else {
    lignes = lignes.sort((a, b) => b.n - a.n);
  }
  return lignes;
}

// --- Clés de découpage ---

export function trancheHoraire(t, minutes = 30) {
  const ny = depuisUtc(t.entreeLe, FUSEAU_NY);
  if (!ny) return null;
  const debut = Math.floor(ny.minutes / minutes) * minutes;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hhmm(debut)}–${hhmm(debut + minutes)}`;
}

/** Le trade va-t-il dans le sens du biais HTF de sa session ? */
export function alignementBiais(journal, t) {
  const session = trouverParId(journal.sessions, t.sessionId);
  const biais = session?.vision?.biais;
  if (!biais || !t.direction) return 'inconnu';
  if (biais === 'neutre') return 'neutre';
  const avec = (biais === 'haussier' && t.direction === 'long') || (biais === 'baissier' && t.direction === 'short');
  return avec ? 'avec' : 'contre';
}

export const LIBELLES_ALIGNEMENT = {
  avec: 'Dans le sens du biais', contre: 'Contre le biais', neutre: 'Biais neutre', inconnu: 'Biais non défini',
};

export function decoupagesExpert(journal, trades, p) {
  const l = p.listes;
  const kzOrdre = l.killzones.map((k) => k.id);
  return [
    { titre: 'Session (killzone)', lignes: decouper(trades, p, (t) => t.killzoneId || killzoneDe(t.entreeLe, l.killzones) || 'hors',
      { libelle: (k) => (k === 'hors' ? 'Hors killzone' : nomDe(l.killzones, k)), ordre: [...kzOrdre, 'hors'] }) },
    { titre: 'Tranche horaire (heure NY)', lignes: decouper(trades, p, (t) => trancheHoraire(t), { libelle: (k) => k || '—' })
      .sort((a, b) => (minutesDepuisHeure(a.cle) ?? 9999) - (minutesDepuisHeure(b.cle) ?? 9999)) },
    { titre: 'Setup', lignes: decouper(trades, p, (t) => t.setupId, { libelle: (k) => nomDe(l.setups, k, 'Sans setup') }) },
    { titre: 'Timeframe de la zone', lignes: decouper(trades, p, (t) => t.zone?.tf || null, {
      libelle: (k) => k || 'Non renseigné', ordre: [...l.timeframes.map((x) => x.id), null] }) },
    { titre: 'Biais HTF', lignes: decouper(trades, p, (t) => alignementBiais(journal, t), {
      libelle: (k) => LIBELLES_ALIGNEMENT[k], ordre: ['avec', 'contre', 'neutre', 'inconnu'] }) },
    { titre: 'Qualité', lignes: decouper(trades, p, (t) => t.qualite || null, {
      libelle: (k) => k || 'Non notée', ordre: ['A', 'B', 'C', null] }) },
    { titre: 'Jour de la semaine', lignes: decouper(trades, p, (t) => depuisUtc(t.entreeLe, FUSEAU_NY)?.jourSemaine ?? null, {
      libelle: (k) => (k ? NOMS_JOURS[k - 1].replace(/^./, (c) => c.toUpperCase()) : '—'), ordre: [1, 2, 3, 4, 5, 6, 7, null] }) },
    { titre: 'Long vs short', lignes: decouper(trades, p, (t) => t.direction || null, {
      libelle: (k) => nomDe(DIRECTIONS, k, 'Sens inconnu'), ordre: ['long', 'short', null] }) },
  ];
}

/** FVG vs OB (et autres types de zone). */
export function parZone(trades, p) {
  return decouper(trades, p, (t) => t.zone?.typeId || null, {
    libelle: (k) => nomDe(p.listes.zones, k, 'Zone non renseignée'),
    ordre: [...p.listes.zones.map((z) => z.id), null],
  });
}

/**
 * Analyse par élément de checklist : pour chaque élément, part des pertes (et des gains)
 * où il manquait (coché « non »).
 */
export function analyseChecklist(trades, p) {
  const pertes = trades.filter((t) => valeurR(t, p) < 0);
  const gains = trades.filter((t) => valeurR(t, p) > 0);
  const part = (ts, id) => {
    const renseignes = ts.filter((t) => t.checklist?.[id] != null);
    return renseignes.length ? renseignes.filter((t) => t.checklist[id] === false).length / renseignes.length : null;
  };
  return CHECKLIST.map((c) => ({
    id: c.id,
    nom: c.nom,
    manquantPertes: part(pertes, c.id),
    manquantGains: part(gains, c.id),
    nbPertes: pertes.filter((t) => t.checklist?.[c.id] === false).length,
  })).sort((a, b) => (b.manquantPertes ?? -1) - (a.manquantPertes ?? -1));
}

/** Expectancy des trades conformes vs non conformes, et R perdus hors règles. */
export function conformesVsNon(trades, p) {
  const conformes = trades.filter((t) => etatDiscipline(t, p).statut === 'conforme');
  const nonConformes = trades.filter((t) => etatDiscipline(t, p).statut === 'non_conforme');
  const rNon = nonConformes.map((t) => valeurR(t, p));
  return {
    conformes: statsDeBase(conformes, p),
    nonConformes: statsDeBase(nonConformes, p),
    rNetHorsRegles: rNon.length ? somme(rNon) : 0,
    rPerdusHorsRegles: -somme(rNon.filter((r) => r < 0)),
  };
}

/** R par raison de règle cassée (un trade compte pour chacune de ses raisons). */
export function rParRaison(trades, p) {
  const parRaison = new Map();
  for (const t of trades) {
    const { violees } = etatDiscipline(t, p);
    const raisons = new Set(violees.map((id) => t.raisonsViolation?.[id] || null));
    for (const raison of raisons) {
      if (!parRaison.has(raison)) parRaison.set(raison, []);
      parRaison.get(raison).push(t);
    }
  }
  return [...parRaison.entries()].map(([raison, ts]) => ({
    cle: raison,
    libelle: nomDe(p.listes.raisonsViolation, raison, 'Raison non précisée'),
    n: ts.length,
    totalR: somme(ts.map((t) => valeurR(t, p))),
  })).sort((a, b) => a.totalR - b.totalR);
}

/** Discipline et expectancy selon l'énergie du check-in (trades sans check-in exclus). */
export function disciplineParEnergie(journal, trades, p) {
  const lignes = [];
  for (let e = 1; e <= 5; e++) {
    const ts = trades.filter((t) => {
      const s = trouverParId(journal.sessions, t.sessionId);
      return aCheckin(s) && s.checkin.energie === e;
    });
    const d = tauxDiscipline(ts, p);
    lignes.push({ energie: e, n: ts.length, tauxDiscipline: d.taux, evalues: d.evalues, expectancy: statsDeBase(ts, p).expectancy });
  }
  const sansCheckin = trades.filter((t) => !aCheckin(trouverParId(journal.sessions, t.sessionId))).length;
  return { lignes, sansCheckin };
}

/** Comparaison backtest vs réel, setup par setup. */
export function comparaisonBacktestReel(journal, p, filtres = {}) {
  const reel = selectionTrades(journal, p, { ...filtres, partie: 'reel', campagneId: null }).trades;
  const bt = selectionTrades(journal, p, { ...filtres, partie: 'backtest', compteId: null }).trades;
  const ids = new Set([...reel, ...bt].map((t) => t.setupId || null));
  return [...ids].map((id) => {
    const r = statsDeBase(reel.filter((t) => (t.setupId || null) === id), p);
    const b = statsDeBase(bt.filter((t) => (t.setupId || null) === id), p);
    return {
      setupId: id,
      libelle: nomDe(p.listes.setups, id, 'Sans setup'),
      reel: { n: r.n, winrate: r.winrate, expectancy: r.expectancy, rrMoyen: r.rrMoyen },
      backtest: { n: b.n, winrate: b.winrate, expectancy: b.expectancy, rrMoyen: b.rrMoyen },
      ecartExpectancy: nb(r.expectancy) && nb(b.expectancy) ? r.expectancy - b.expectancy : null,
    };
  }).sort((a, b) => (b.reel.n + b.backtest.n) - (a.reel.n + a.backtest.n));
}

/** Suivi du challenge Prop Firm (en $, sur les trades réels du compte depuis la date de début). */
export function challengePropFirm(journal, p) {
  const c = p.propFirm;
  if (!c?.actif || !nb(c.tailleCompte) || c.tailleCompte <= 0) return null;
  const trades = journal.trades
    .filter((t) => t.partie === 'reel' && (!c.compteId || t.compteId === c.compteId))
    .filter((t) => {
      const d = depuisUtc(t.entreeLe, p.fuseauSaisie)?.date;
      return d && (!c.dateDebut || d >= c.dateDebut);
    })
    .sort((a, b) => a.entreeLe.localeCompare(b.entreeLe));
  let pnl = 0;
  let plusBas = 0;
  const jours = new Set();
  let estime = 0;
  for (const t of trades) {
    let usd = t.resultatUsd;
    if (!nb(usd)) {
      const r = valeurR(t, p);
      const risque = nb(t.risqueUsd) ? t.risqueUsd : p.risqueDefautUsd;
      if (!nb(r) || !nb(risque)) continue;
      usd = r * risque;
      estime += 1;
    }
    pnl += usd;
    plusBas = Math.min(plusBas, pnl);
    jours.add(depuisUtc(t.entreeLe, p.fuseauSaisie).date);
  }
  const ddMaxUsd = (c.tailleCompte * (c.drawdownMaxPct || 0)) / 100;
  const objectifUsd = (c.tailleCompte * (c.objectifPct || 0)) / 100;
  const ddUtilise = Math.max(0, -pnl); // drawdown statique : perte sous la taille initiale
  const ddRestant = ddMaxUsd - ddUtilise;
  const statut = ddRestant <= 0 ? 'echoue'
    : pnl >= objectifUsd && jours.size >= (c.joursMin || 0) ? 'reussi' : 'en_cours';
  return {
    tailleCompte: c.tailleCompte,
    solde: c.tailleCompte + pnl,
    pnlUsd: pnl,
    pnlPct: (pnl / c.tailleCompte) * 100,
    objectifUsd,
    progression: objectifUsd > 0 ? Math.max(0, pnl) / objectifUsd : null,
    drawdownMaxUsd: ddMaxUsd,
    drawdownUtiliseUsd: ddUtilise,
    drawdownRestantUsd: ddRestant,
    plusBasUsd: plusBas,
    joursTrading: jours.size,
    joursMin: c.joursMin || 0,
    nbTrades: trades.length,
    tradesEstimes: estime,
    statut,
  };
}

