// Import de l'historique cTrader : lecture du fichier, aperçu, rattachements à confirmer, import.

import { store } from '../store.js';
import { h, monter, modale, notifier } from '../ui.js';
import { DIRECTIONS, nomDe } from '../modele.js';
import {
  analyserReleve, regrouperDeals, lireCsv, dejaImporte, tradeDepuisGroupe, plansCandidats, sessionsCandidates,
  fixerRisque, instrumentPour, ErreurImport,
} from '../ctrader.js';
import { lireXlsx } from '../xlsx.js';
import { valeurR } from '../calculs.js';
import { depuisUtc, dateCourte } from '../temps.js';
import { fmtR, fmtNombre, classeSigne } from '../format.js';
import { ecrirePref } from '../etat-ui.js';
import { naviguer } from '../navigation.js';
import { rattacherPlan } from './plan-reel.js';

const AUCUN = '__aucun__';

async function lireFichier(fichier) {
  if (/\.csv$/i.test(fichier.name) || fichier.type === 'text/csv') return lireCsv(await fichier.text());
  try {
    return await lireXlsx(await fichier.arrayBuffer());
  } catch (e) {
    // Certains exports « Excel » sont en réalité du texte
    const texte = await fichier.text();
    if (/opening/i.test(texte.slice(0, 5000))) return lireCsv(texte);
    throw new ErreurImport(`Lecture du fichier impossible : ${e.message}`);
  }
}

function libelleDecalage(min) {
  if (min == null) return 'inconnu (UTC supposé)';
  const signe = min >= 0 ? '+' : '−';
  const a = Math.abs(min);
  return `UTC${signe}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/** Prépare les lignes de l'aperçu à partir du relevé. */
export function preparerImport(journal, p, lignes) {
  const releve = analyserReleve(lignes);
  const groupes = regrouperDeals(releve.deals);
  const nouveaux = [];
  let doublons = 0;
  for (const g of groupes) {
    if (dejaImporte(journal, g)) { doublons += 1; continue; }
    const t = tradeDepuisGroupe(g, p, { devise: releve.devise, fuseauOuverture: releve.fuseau.ouverture });
    const plans = plansCandidats(journal, t, p.fuseauSaisie);
    const sessions = sessionsCandidates(journal, t, p.fuseauSaisie);
    nouveaux.push({
      t,
      symboleConnu: instrumentPour(g.symbole, p.symboles).connu,
      plans,
      sessions,
      // Choix : id, AUCUN, ou '' (à confirmer)
      planId: plans.length === 1 ? plans[0].id : plans.length ? '' : AUCUN,
      sessionId: sessions.length === 1 ? sessions[0].id : sessions.length ? '' : AUCUN,
      importer: true,
    });
  }
  return { releve, groupes, nouveaux, doublons };
}

/** Trade tel qu'il sera importé, avec le plan choisi (pour estimer le R). */
function apercuTrade(ligne, journal, p) {
  const t = structuredClone(ligne.t);
  const plan = journal.plans.find((x) => x.id === ligne.planId);
  if (plan) {
    t.sl = plan.sl;
    t.tp = plan.tp;
  }
  fixerRisque(t, p);
  return t;
}

/** Applique l'import : crée les fiches, rattache plans et sessions. Retourne le nombre de trades créés. */
export function appliquerImport(journal, p, lignes) {
  let n = 0;
  for (const l of lignes) {
    if (!l.importer) continue;
    const t = l.t;
    const plan = journal.plans.find((x) => x.id === l.planId);
    if (plan) rattacherPlan(t, plan);
    t.sessionId = l.sessionId && l.sessionId !== AUCUN ? l.sessionId : null;
    if (!t.sessionId && plan?.sessionId) t.sessionId = plan.sessionId;
    fixerRisque(t, p);
    journal.trades.push(t);
    n += 1;
  }
  return n;
}

export function ouvrirImportCtrader() {
  const entree = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  entree.addEventListener('change', async () => {
    const fichier = entree.files[0];
    if (!fichier) return;
    let prep;
    try {
      prep = preparerImport(store.journal, store.p, await lireFichier(fichier));
    } catch (e) {
      await modale({ titre: 'Import cTrader impossible', contenu: h('p', {}, e.message) });
      return;
    }
    afficherApercu(prep, fichier.name);
  });
  entree.click();
}

async function afficherApercu(prep, nomFichier) {
  const j = store.journal;
  const p = store.p;
  const fz = p.fuseauSaisie;
  const { releve, groupes, nouveaux, doublons } = prep;
  const inconnus = [...new Set(nouveaux.filter((l) => !l.symboleConnu).map((l) => l.t.ctrader.symbole))];
  const corps = h('tbody');
  const resume = h('div', { class: 'ligne' });
  let boutonImporter = null;

  const aConfirmer = () => nouveaux.filter((l) => l.importer && (l.planId === '' || l.sessionId === '')).length;
  const majResume = () => {
    const nb = nouveaux.filter((l) => l.importer).length;
    const restant = aConfirmer();
    monter(resume,
      h('span', {}, `${nb} trade(s) à importer`),
      restant ? h('span', { class: 'tag alerte' }, `${restant} rattachement(s) à confirmer`) : null);
    if (boutonImporter) {
      boutonImporter.disabled = !nb || restant > 0;
      boutonImporter.textContent = `Importer ${nb} trade(s)`;
    }
  };

  const optionsSelect = (choix, liste, libelle) => {
    const sel = h('select', { class: ['entree', choix === '' && 'invalide'] },
      choix === '' ? h('option', { value: '' }, '— à confirmer —') : null,
      h('option', { value: AUCUN }, 'Aucun'),
      liste.map((x) => h('option', { value: x.id }, libelle(x))));
    sel.value = choix;
    return sel;
  };

  const rendreLignes = () => monter(corps, nouveaux.map((l) => {
    const t = l.t;
    const q = depuisUtc(t.entreeLe, fz);
    const apercu = apercuTrade(l, j, p);
    const r = valeurR(apercu, p);
    const selPlan = optionsSelect(l.planId, l.plans, (pl) => {
      const d = depuisUtc(pl.creeLe, fz);
      return `${d.heure} · ${nomDe(p.listes.setups, pl.setupId, 'plan')}${pl.qualite ? ` ${pl.qualite}` : ''}`;
    });
    selPlan.addEventListener('change', () => { l.planId = selPlan.value; rendreLignes(); majResume(); });
    const selSession = optionsSelect(l.sessionId, l.sessions, (s) => `Session ${s.numero}`);
    selSession.addEventListener('change', () => { l.sessionId = selSession.value; rendreLignes(); majResume(); });
    const caseImport = h('input', { type: 'checkbox', checked: l.importer, title: 'Importer ce trade' });
    caseImport.addEventListener('change', () => { l.importer = caseImport.checked; majResume(); });
    return h('tr', { class: l.importer ? '' : 'faible' },
      h('td', {}, caseImport),
      h('td', { class: 'mono' }, q ? `${dateCourte(q.date)} ${q.heure}` : '—'),
      h('td', {}, t.ctrader.symbole, t.instrument !== t.ctrader.symbole ? h('span', { class: 'discret' }, ` → ${t.instrument}`) : null,
        l.symboleConnu ? null : h('span', { class: 'tag alerte', style: { marginLeft: '4px' } }, 'inconnu')),
      h('td', {}, nomDe(DIRECTIONS, t.direction)),
      h('td', { class: 'num' }, `${fmtNombre(t.prixEntree, 2)} → ${fmtNombre(t.prixSortie, 2)}`),
      h('td', { class: 'num' }, t.ctrader.nbDeals),
      h('td', { class: ['num', classeSigne(t.resultatUsd)] }, `${fmtNombre(t.resultatUsd, 2, { signe: true })}`),
      h('td', {}, l.plans.length ? selPlan : h('span', { class: 'discret' }, 'aucun plan')),
      h('td', {}, l.sessions.length ? selSession : h('span', { class: 'discret' }, 'sans check-in')),
      h('td', { class: ['num', classeSigne(r)], title: apercu.ctrader.sourceRisque === 'sl' ? 'Risque déduit du SL du plan et de la taille' : 'Risque fixe par défaut' },
        fmtR(r), h('div', { class: 'discret' }, apercu.ctrader.sourceRisque === 'sl' ? 'SL du plan' : 'risque défaut')));
  }));

  rendreLignes();
  const contenu = [
    h('p', { class: 'discret' }, `${nomFichier} · ${releve.deals.length} deal(s) lu(s) → ${groupes.length} trade(s) après regroupement des fermetures partielles.`),
    h('div', { class: 'ligne' },
      h('span', { class: 'tag contour' }, `Fuseau : ${libelleDecalage(releve.fuseau.ouverture)}`),
      h('span', { class: 'tag contour' }, `Devise : ${releve.devise || 'inconnue'}`),
      h('span', { class: 'tag contour' }, `Dates lues ${releve.jourDabord ? 'jour/mois' : 'mois/jour'}`),
      doublons ? h('span', { class: 'tag' }, `${doublons} déjà importé(s), ignoré(s)`) : null),
    ...releve.avertissements.map((a) => h('div', { class: 'avertissement' }, a)),
    inconnus.length
      ? h('div', { class: 'avertissement' }, `Symbole(s) sans correspondance : ${inconnus.join(', ')}. Ajoute-les dans Paramètres › Correspondance des symboles, ou ils seront importés tels quels.`)
      : null,
    nouveaux.length
      ? h('div', { class: 'tableau-conteneur import-apercu' },
        h('table', { class: 'tableau compact' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Entrée'), h('th', {}, 'Symbole'), h('th', {}, 'Sens'),
            h('th', { class: 'num' }, 'Prix'), h('th', { class: 'num' }, 'Deals'), h('th', { class: 'num' }, `Net ${releve.devise || ''}`),
            h('th', {}, 'Plan'), h('th', {}, 'Session'), h('th', { class: 'num' }, 'R estimé'))),
          corps))
      : h('div', { class: 'info' }, 'Aucun nouveau trade dans ce fichier : tout est déjà dans le journal.'),
    h('p', { class: 'discret' }, 'Les trades importés sont marqués « à compléter » : il restera la checklist, la qualité, la discipline et les notes.'),
    resume,
  ];

  const promesse = modale({
    titre: 'Import cTrader',
    large: true,
    contenu,
    actions: nouveaux.length
      ? [{ texte: 'Annuler', valeur: false }, { texte: 'Importer', valeur: true, classe: 'principal' }]
      : [{ texte: 'Fermer', valeur: false }],
  });
  boutonImporter = [...document.querySelectorAll('.modale-actions .btn')].find((b) => b.textContent === 'Importer') || null;
  majResume();
  if (!(await promesse)) return;
  const n = appliquerImport(j, p, nouveaux);
  store.changer();
  notifier(`${n} trade(s) importé(s), à compléter.`, 'succes');
  ecrirePref('trades:filtres', { statut: 'a_completer', compteId: null, setupId: null });
  naviguer('/trades');
}

