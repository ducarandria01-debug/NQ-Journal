// Calculs d'un trade : R, RR, durée, discipline. Fonctions pures, testées sous Node.

import { CHECKLIST } from './modele.js';
import { depuisUtc, dureeMinutes, killzoneDe } from './temps.js';

const nb = (x) => typeof x === 'number' && Number.isFinite(x);

export function signe(direction) {
  if (direction === 'long') return 1;
  if (direction === 'short') return -1;
  return null;
}

/** Distance entre l'entrée et le stop (en points), positive si le stop est du bon côté. */
export function distanceStop({ direction, prixEntree, sl }) {
  const s = signe(direction);
  if (s == null || !nb(prixEntree) || !nb(sl)) return null;
  const d = (prixEntree - sl) * s;
  return d > 0 ? d : null;
}

/** RR prévu : (TP − entrée) / (entrée − SL), dans le sens du trade. */
export function rrPrevu(t) {
  const risque = distanceStop(t);
  const s = signe(t.direction);
  if (risque == null || !nb(t.tp)) return null;
  return ((t.tp - t.prixEntree) * s) / risque;
}

/** RR réalisé d'après les prix (sortie − entrée) / (entrée − SL). Ne tient pas compte des frais. */
export function rrRealise(t) {
  const risque = distanceStop(t);
  const s = signe(t.direction);
  if (risque == null || !nb(t.prixSortie)) return null;
  return ((t.prixSortie - t.prixEntree) * s) / risque;
}

/**
 * Résultat en R, avec sa source :
 * 1. valeur saisie à la main ;
 * 2. résultat $ / risque $ (frais compris si le résultat $ est le net) ;
 * 3. résultat $ / risque fixe par défaut (si le risque $ du trade est inconnu) ;
 * 4. d'après les prix (RR réalisé).
 */
export function resultatR(t, p = null) {
  if (nb(t.resultatRManuel)) return { valeur: t.resultatRManuel, source: 'manuel' };
  if (nb(t.resultatUsd) && nb(t.risqueUsd) && t.risqueUsd > 0) {
    return { valeur: t.resultatUsd / t.risqueUsd, source: 'usd' };
  }
  if (nb(t.resultatUsd) && p && nb(p.risqueDefautUsd) && p.risqueDefautUsd > 0) {
    return { valeur: t.resultatUsd / p.risqueDefautUsd, source: 'usd-defaut' };
  }
  const rr = rrRealise(t);
  if (rr != null) return { valeur: rr, source: 'prix' };
  return { valeur: null, source: null };
}

export const valeurR = (t, p) => resultatR(t, p).valeur;

export const SOURCES_R = {
  manuel: 'saisi à la main',
  usd: 'résultat $ ÷ risque $',
  'usd-defaut': 'résultat $ ÷ risque fixe par défaut',
  prix: "d'après les prix d'entrée, de sortie et le SL",
};

export function duree(t) {
  return dureeMinutes(t.entreeLe, t.sortieLe);
}

export function estGagnant(r) {
  return nb(r) && r > 0;
}

/** Un trade est clôturé quand son résultat est connu. */
export function estCloture(t, p) {
  return valeurR(t, p) != null;
}

// --- Checklist ---

export function checklistComplete(t) {
  return CHECKLIST.every((c) => t.checklist?.[c.id] === true);
}

export function elementsManquants(t) {
  return CHECKLIST.filter((c) => t.checklist?.[c.id] === false).map((c) => c.id);
}

// --- Discipline ---

/** Règles qui s'appliquent à un trade : les règles actives + les archivées déjà évaluées sur ce trade. */
export function reglesDuTrade(t, p) {
  return p.regles.filter((r) => !r.archive || (t.discipline && r.id in t.discipline && t.discipline[r.id] != null));
}

/**
 * statut : 'conforme' (toutes les règles respectées), 'non_conforme' (au moins une cassée)
 * ou 'incomplet' (pas encore toutes renseignées).
 */
export function etatDiscipline(t, p) {
  const regles = reglesDuTrade(t, p);
  const violees = regles.filter((r) => t.discipline?.[r.id] === false).map((r) => r.id);
  const manquantes = regles.filter((r) => t.discipline?.[r.id] == null).map((r) => r.id);
  let statut = 'incomplet';
  if (violees.length) statut = 'non_conforme';
  else if (!manquantes.length && regles.length) statut = 'conforme';
  return { statut, violees, manquantes, total: regles.length };
}

export function dateDuTrade(t, fuseau) {
  return depuisUtc(t.entreeLe, fuseau)?.date || null;
}

/** Somme des R des trades de la même partie, même jour (date de marché), entrés avant `t`. */
export function cumulRAvant(journal, t, p) {
  const jour = dateDuTrade(t, p.fuseauSaisie);
  if (!jour || !t.entreeLe) return null;
  let cumul = 0;
  for (const autre of journal.trades) {
    if (autre.id === t.id || autre.partie !== t.partie || !autre.entreeLe) continue;
    if (t.partie === 'reel' && (autre.compteId || null) !== (t.compteId || null)) continue;
    if (t.partie === 'backtest' && (autre.campagneId || null) !== (t.campagneId || null)) continue;
    if (dateDuTrade(autre, p.fuseauSaisie) !== jour || autre.entreeLe >= t.entreeLe) continue;
    const r = valeurR(autre, p);
    if (nb(r)) cumul += r;
  }
  return cumul;
}

/** Réponses proposées par le journal pour les règles vérifiables (true / false / null = ne sait pas). */
export function suggestionsDiscipline(journal, t, p) {
  const session = t.sessionId ? journal.sessions.find((s) => s.id === t.sessionId) : null;
  const resultat = {};
  for (const regle of p.regles) {
    let v = null;
    switch (regle.auto) {
      case 'biais':
        v = session ? session.vision?.biais != null : null;
        break;
      case 'checklist': {
        const valeurs = CHECKLIST.map((c) => t.checklist?.[c.id]);
        if (valeurs.some((x) => x === false)) v = false;
        else if (valeurs.every((x) => x === true)) v = true;
        break;
      }
      case 'killzone':
        v = t.entreeLe ? killzoneDe(t.entreeLe, p.listes.killzones) != null : null;
        break;
      case 'risque': {
        const tol = (nb(p.toleranceRisquePct) ? p.toleranceRisquePct : 10) / 100;
        if (nb(t.risquePct) && nb(p.risqueDefautPct) && p.risqueDefautPct > 0) {
          v = t.risquePct <= p.risqueDefautPct * (1 + tol);
        } else if (nb(t.risqueUsd) && nb(p.risqueDefautUsd) && p.risqueDefautUsd > 0) {
          v = t.risqueUsd <= p.risqueDefautUsd * (1 + tol);
        }
        break;
      }
      case 'limite': {
        const cumul = cumulRAvant(journal, t, p);
        if (cumul != null && nb(p.limitePertesJourR) && p.limitePertesJourR > 0) {
          v = cumul > -p.limitePertesJourR;
        }
        break;
      }
      default:
        v = null;
    }
    resultat[regle.id] = v;
  }
  return resultat;
}

/** Remplit les règles encore vides avec les suggestions. Retourne le nombre de règles remplies. */
export function appliquerSuggestions(journal, t, p) {
  const sugg = suggestionsDiscipline(journal, t, p);
  let n = 0;
  for (const regle of p.regles) {
    if (regle.archive) continue;
    if (t.discipline[regle.id] == null && sugg[regle.id] != null) {
      t.discipline[regle.id] = sugg[regle.id];
      n += 1;
    }
  }
  return n;
}
