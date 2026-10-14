// Import de l'historique cTrader (onglet History → Statement, plateforme en anglais).
// Parseur volontairement tolérant : colonnes dans n'importe quel ordre, fuseau lu dans l'en-tête
// des colonnes de temps, devise lue dans l'en-tête de Gross / Net / Balance.
// ⚠ Structure à confirmer avec un export réel avant de figer.

import { nouveauTrade, elementsActifs } from './modele.js';
import { depuisUtc, killzoneDe } from './temps.js';
import { sessionsDu } from './domaine.js';

export class ErreurImport extends Error {}

// --- Lecture CSV ---

export function lireCsv(texte) {
  const propre = texte.replace(/^﻿/, '');
  const premiere = propre.split(/\r?\n/).find((l) => l.trim()) || '';
  const separateur = [',', ';', '\t'].map((s) => [s, premiere.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = [];
  let ligne = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < propre.length; i++) {
    const c = propre[i];
    if (guillemets) {
      if (c === '"' && propre[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && propre[i + 1] === '\n') i++;
      ligne.push(champ); lignes.push(ligne); ligne = []; champ = '';
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter((l) => l.some((x) => String(x).trim() !== ''));
}

// --- Colonnes ---

const norm = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/** Colonnes attendues : clé interne → test sur le nom normalisé. */
const COLONNES = {
  id: (n) => n === 'id' || n === 'positionid' || n === 'dealid',
  orderId: (n) => n === 'orderid',
  symbole: (n) => n === 'symbol',
  sensOuverture: (n) => n === 'openingdirection',
  sensFermeture: (n) => n === 'closingdirection',
  ouverture: (n) => n.startsWith('openingtime'),
  fermeture: (n) => n.startsWith('closingtime'),
  prixEntree: (n) => n === 'entryprice',
  prixSortie: (n) => n === 'closingprice',
  quantite: (n) => n.startsWith('closingquantity'),
  volumeUsd: (n) => n.startsWith('closingusdvolume'),
  swap: (n) => n.startsWith('swap'),
  commission: (n) => n.startsWith('commission'),
  brut: (n) => n.startsWith('gross'),
  net: (n) => n.startsWith('net'),
  solde: (n) => n.startsWith('balance'),
  pips: (n) => n === 'pips',
  quantiteDemandee: (n) => n.startsWith('requestedquantity'),
  canal: (n) => n === 'channel',
  label: (n) => n === 'label',
  commentaire: (n) => n === 'comment',
};

const ESSENTIELLES = {
  symbole: 'Symbol', sensOuverture: 'Opening Direction', ouverture: 'Opening Time',
  prixEntree: 'Entry Price', prixSortie: 'Closing Price', net: 'Net',
};

/** Décalage UTC lu dans un en-tête : "Opening Time (UTC+1)" → 60, "(UTC-04:30)" → -270. */
export function decalageEnTete(entete) {
  const m = String(entete).match(/UTC\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return /UTC|GMT/i.test(String(entete)) ? 0 : null;
  const signe = m[1] === '+' ? 1 : -1;
  return signe * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Devise lue dans un en-tête : "Net EUR", "Net (€)", "Gross USD" → "EUR" / "€" / "USD". */
export function deviseEnTete(entete) {
  const reste = String(entete).replace(/^\s*(gross|net|balance)\s*/i, '').replace(/[()[\]]/g, '').trim();
  return reste || null;
}

/** Trouve la ligne d'en-tête (le relevé peut commencer par des lignes d'information du compte). */
function trouverEnTete(lignes) {
  for (let i = 0; i < Math.min(lignes.length, 60); i++) {
    const noms = lignes[i].map(norm);
    const trouvees = Object.values(COLONNES).filter((test) => noms.some(test)).length;
    if (trouvees >= 5 && noms.some(COLONNES.symbole)) return i;
  }
  return -1;
}

// --- Valeurs ---

/** Nombre tolérant : "1,234.50", "1 234,50", "-12.3", "(12.3)", 12.3. */
export function lireMontant(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s  $€£]/g, '').replace(/[A-Z]{3}$/i, '');
  if (!s || s === '-') return null;
  let negatif = false;
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1); }
  s = s.replace('−', '-');
  const virgule = s.lastIndexOf(',');
  const point = s.lastIndexOf('.');
  if (virgule >= 0 && point >= 0) {
    s = virgule > point ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (virgule >= 0) {
    // Plateforme en anglais : "1,234" ou "21,450" = milliers ; "12,5" = décimale
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negatif ? -n : n) : null;
}

/** Date-heure : texte (jj/mm/aaaa, mm/jj/aaaa ou aaaa-mm-jj, avec heure) ou nombre de série Excel. */
export function lireDateHeure(v, { jourDabord = true } = {}) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return { an: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds() };
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?/);
  if (m) return { an: +m[1], mois: +m[2], jour: +m[3], h: +(m[4] || 0), min: +(m[5] || 0), s: +(m[6] || 0), ms: +((m[7] || '0').padEnd(3, '0')) };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let [a, b] = [+m[1], +m[2]];
  if (!jourDabord) [a, b] = [b, a];
  let h = +(m[4] || 0);
  if (m[8]) { const pm = m[8].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  const an = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return { an, mois: b, jour: a, h, min: +(m[5] || 0), s: +(m[6] || 0), ms: +((m[7] || '0').padEnd(3, '0')) };
}

/** Détecte l'ordre jour/mois sur l'ensemble des dates (un nombre > 12 tranche). */
function detecterJourDabord(valeurs) {
  let jourDabord = null;
  for (const v of valeurs) {
    const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) jourDabord = false;
  }
  return jourDabord ?? true;
}

function versIso(d, decalageMin) {
  if (!d || !d.an || !d.mois || !d.jour || d.mois > 12 || d.jour > 31) return null;
  const ms = Date.UTC(d.an, d.mois - 1, d.jour, d.h, d.min, d.s, d.ms) - (decalageMin || 0) * 60000;
  return new Date(ms).toISOString();
}

function sens(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.startsWith('buy') || s === 'long' || s === 'achat') return 'long';
  if (s.startsWith('sell') || s === 'short' || s === 'vente') return 'short';
  return null;
}

/** Symbole cTrader → instrument du journal via la table de correspondance (casse et suffixes ignorés). */
export function instrumentPour(symbole, table) {
  const base = (s) => String(s ?? '').toUpperCase().split(/[.\s_-]/)[0];
  const s = String(symbole ?? '').trim();
  const exact = table.find((x) => x.source && x.source.toUpperCase() === s.toUpperCase());
  if (exact) return { instrument: exact.cible, connu: true };
  const approx = table.find((x) => x.source && base(x.source) === base(s));
  if (approx) return { instrument: approx.cible, connu: true };
  return { instrument: s, connu: false };
}

// --- Analyse d'un relevé ---

/**
 * Lignes brutes → deals normalisés.
 * Retourne { deals, colonnes, fuseau: { ouverture, fermeture }, devise, avertissements }.
 */
export function analyserReleve(lignes) {
  const iEnTete = trouverEnTete(lignes);
  if (iEnTete < 0) {
    throw new ErreurImport("Je ne trouve pas la ligne d'en-tête du relevé (colonnes Symbol, Opening Time, Entry Price…). Vérifie que c'est bien l'export « Statement » de l'onglet History, plateforme en anglais.");
  }
  const enTete = lignes[iEnTete].map((x) => String(x ?? '').trim());
  const noms = enTete.map(norm);
  const index = {};
  for (const [cle, test] of Object.entries(COLONNES)) {
    const i = noms.findIndex(test);
    if (i >= 0) index[cle] = i;
  }
  // Repli : s'il n'y a pas de "Net", on accepte "Gross" (frais non déduits)
  const avertissements = [];
  if (index.net == null && index.brut != null) {
    index.net = index.brut;
    avertissements.push('Colonne « Net » absente : le résultat utilise « Gross » (sans commissions ni swap).');
  }
  const manquantes = Object.entries(ESSENTIELLES).filter(([cle]) => index[cle] == null).map(([, nom]) => nom);
  if (manquantes.length) {
    throw new ErreurImport(`Colonne(s) essentielle(s) introuvable(s) : ${manquantes.join(', ')}. Colonnes trouvées : ${enTete.filter(Boolean).join(', ')}. Dans cTrader, coche toutes les colonnes avant l'export.`);
  }
  if (index.id == null && index.orderId == null) {
    avertissements.push("Ni « ID » ni « Order ID » : l'anti-doublon se fera sur la date, le symbole et le sens.");
  }
  const decOuverture = decalageEnTete(enTete[index.ouverture]);
  const decFermeture = index.fermeture != null ? decalageEnTete(enTete[index.fermeture]) : decOuverture;
  if (decOuverture == null) avertissements.push(`Fuseau introuvable dans « ${enTete[index.ouverture]} » : heures lues comme UTC.`);
  const devise = deviseEnTete(enTete[index.net]) || (index.solde != null ? deviseEnTete(enTete[index.solde]) : null);

  const corps = lignes.slice(iEnTete + 1);
  const jourDabord = detecterJourDabord([
    ...corps.map((l) => l[index.ouverture]),
    ...(index.fermeture != null ? corps.map((l) => l[index.fermeture]) : []),
  ]);
  const val = (l, cle) => (index[cle] == null ? null : l[index[cle]]);
  const deals = [];
  let ignorees = 0;
  for (const l of corps) {
    const symbole = String(val(l, 'symbole') ?? '').trim();
    const ouverture = versIso(lireDateHeure(val(l, 'ouverture'), { jourDabord }), decOuverture);
    const direction = sens(val(l, 'sensOuverture'));
    // Lignes de total, de dépôt, vides… : ignorées
    if (!symbole || !ouverture || !direction) { ignorees += 1; continue; }
    deals.push({
      id: val(l, 'id') != null && val(l, 'id') !== '' ? String(val(l, 'id')).trim() : null,
      orderId: val(l, 'orderId') != null && val(l, 'orderId') !== '' ? String(val(l, 'orderId')).trim() : null,
      symbole,
      direction,
      ouverture,
      fermeture: index.fermeture != null ? versIso(lireDateHeure(val(l, 'fermeture'), { jourDabord }), decFermeture) : null,
      prixEntree: lireMontant(val(l, 'prixEntree')),
      prixSortie: lireMontant(val(l, 'prixSortie')),
      quantite: lireMontant(val(l, 'quantite')),
      brut: lireMontant(val(l, 'brut')),
      commission: lireMontant(val(l, 'commission')) ?? 0,
      swap: lireMontant(val(l, 'swap')) ?? 0,
      net: lireMontant(val(l, 'net')),
      solde: lireMontant(val(l, 'solde')),
      pips: lireMontant(val(l, 'pips')),
      label: String(val(l, 'label') ?? '').trim(),
      commentaire: String(val(l, 'commentaire') ?? '').trim(),
    });
  }
  return {
    deals,
    ignorees,
    colonnes: enTete,
    fuseau: { ouverture: decOuverture, fermeture: decFermeture },
    devise,
    jourDabord,
    avertissements,
  };
}

/**
 * Regroupe les deals d'un même trade (fermetures partielles) :
 * même heure d'ouverture, même symbole, même sens. Résultats et frais additionnés,
 * prix de sortie moyen pondéré par la quantité, heure de sortie = la dernière.
 */
export function regrouperDeals(deals) {
  const groupes = new Map();
  for (const d of deals) {
    const cle = `${d.ouverture}|${d.symbole.toUpperCase()}|${d.direction}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(d);
  }
  return [...groupes.values()].map((ds) => {
    const somme = (k) => ds.reduce((s, d) => s + (d[k] ?? 0), 0);
    const quantite = ds.every((d) => d.quantite != null) ? somme('quantite') : null;
    const avecPrix = ds.filter((d) => d.prixSortie != null);
    const poids = avecPrix.reduce((s, d) => s + (d.quantite ?? 1), 0);
    return {
      ids: [...new Set(ds.map((d) => d.id).filter(Boolean))],
      orderIds: [...new Set(ds.map((d) => d.orderId).filter(Boolean))],
      symbole: ds[0].symbole,
      direction: ds[0].direction,
      ouverture: ds[0].ouverture,
      fermeture: ds.map((d) => d.fermeture).filter(Boolean).sort().at(-1) || null,
      prixEntree: ds[0].prixEntree,
      prixSortie: poids ? avecPrix.reduce((s, d) => s + d.prixSortie * (d.quantite ?? 1), 0) / poids : null,
      quantite,
      brut: ds.some((d) => d.brut != null) ? somme('brut') : null,
      commission: somme('commission'),
      swap: somme('swap'),
      net: ds.some((d) => d.net != null) ? somme('net') : null,
      pips: ds.some((d) => d.pips != null) ? somme('pips') : null,
      // Solde avant le trade : solde après le 1er deal − son résultat
      soldeAvant: ds[0].solde != null && ds[0].net != null ? ds[0].solde - ds[0].net : null,
      label: ds[0].label,
      commentaire: ds[0].commentaire,
      nbDeals: ds.length,
    };
  }).sort((a, b) => a.ouverture.localeCompare(b.ouverture));
}

/** Clé anti-doublon d'un trade importé (repli si le relevé n'a pas d'ID). */
const cleSecours = (g) => `${g.ouverture}|${g.symbole.toUpperCase()}|${g.direction}`;

/** Le trade groupé est-il déjà dans le journal ? (par ID / Order ID, sinon par ouverture + symbole + sens) */
export function dejaImporte(journal, g) {
  for (const t of journal.trades) {
    const c = t.ctrader;
    if (!c) continue;
    if (g.ids.length && (c.ids || []).some((id) => g.ids.includes(id))) return t;
    if (g.orderIds.length && (c.orderIds || []).some((id) => g.orderIds.includes(id))) return t;
    if (!g.ids.length && !g.orderIds.length && c.cle === cleSecours(g)) return t;
  }
  return null;
}

/** Plans candidats : même date, même instrument, même sens, créés avant l'entrée, pas encore pris. */
export function plansCandidats(journal, trade, fuseau) {
  const date = depuisUtc(trade.entreeLe, fuseau)?.date;
  return journal.plans.filter((pl) => pl.statut === 'en_attente'
    && depuisUtc(pl.creeLe, fuseau)?.date === date
    && String(pl.instrument || '').toUpperCase() === String(trade.instrument || '').toUpperCase()
    && (!pl.direction || pl.direction === trade.direction)
    && pl.creeLe <= trade.entreeLe)
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
}

/** Sessions candidates (réel, même date). */
export function sessionsCandidates(journal, trade, fuseau) {
  const date = depuisUtc(trade.entreeLe, fuseau)?.date;
  return date ? sessionsDu(journal, 'reel', date) : [];
}

/**
 * Risque en $ déduit du SL et de la taille : la valeur d'un point est tirée du trade lui-même
 * (résultat brut ÷ points gagnés ou perdus), puis multipliée par la distance entrée → SL.
 * Retourne null si ce n'est pas calculable (trade à zéro point, SL absent…).
 */
export function risqueDepuisSl(t) {
  const c = t.ctrader;
  const sensT = t.direction === 'long' ? 1 : t.direction === 'short' ? -1 : null;
  if (!c || sensT == null || t.sl == null || t.prixEntree == null || t.prixSortie == null) return null;
  const points = (t.prixSortie - t.prixEntree) * sensT;
  const brut = c.brut ?? (c.net != null ? c.net - (c.commission || 0) - (c.swap || 0) : null);
  if (!points || brut == null) return null;
  const parPoint = brut / points;
  const distance = (t.prixEntree - t.sl) * sensT;
  if (!(parPoint > 0) || !(distance > 0)) return null;
  return Math.round(parPoint * distance * 100) / 100;
}

/** Fabrique la fiche « à compléter » d'un trade groupé. */
export function tradeDepuisGroupe(g, p, { fuseauOuverture = null, devise = null } = {}) {
  const t = nouveauTrade({ partie: 'reel' });
  const { instrument } = instrumentPour(g.symbole, p.symboles);
  Object.assign(t, {
    statut: 'a_completer',
    instrument,
    direction: g.direction,
    entreeLe: g.ouverture,
    sortieLe: g.fermeture,
    killzoneId: killzoneDe(g.ouverture, p.listes.killzones),
    prixEntree: g.prixEntree,
    prixSortie: g.prixSortie != null ? Math.round(g.prixSortie * 100000) / 100000 : null,
    taille: g.quantite,
    risquePct: null,
    risqueUsd: null,
    resultatUsd: g.net,
    compteId: elementsActifs(p.listes.comptes)[0]?.id || null,
    ctrader: {
      ids: g.ids, orderIds: g.orderIds, cle: cleSecours(g), symbole: g.symbole,
      brut: g.brut, commission: g.commission, swap: g.swap, net: g.net, pips: g.pips, soldeAvant: g.soldeAvant,
      devise, fuseau: fuseauOuverture, nbDeals: g.nbDeals, label: g.label, commentaire: g.commentaire,
    },
  });
  return t;
}

/** Fixe le risque $ (SL du plan + taille, sinon risque fixe par défaut) et le % correspondant. */
export function fixerRisque(t, p) {
  const depuisSl = risqueDepuisSl(t);
  if (depuisSl != null) {
    t.risqueUsd = depuisSl;
    t.ctrader.sourceRisque = 'sl';
  } else {
    t.risqueUsd = p.risqueDefautUsd ?? null;
    t.ctrader.sourceRisque = 'defaut';
  }
  if (t.risqueUsd == null) return;
  if (t.ctrader.soldeAvant > 0) {
    t.risquePct = Math.round((t.risqueUsd / t.ctrader.soldeAvant) * 100000) / 1000;
  } else if (p.risqueDefautUsd > 0 && p.risqueDefautPct > 0) {
    t.risquePct = Math.round((t.risqueUsd / p.risqueDefautUsd) * p.risqueDefautPct * 1000) / 1000;
  }
}
