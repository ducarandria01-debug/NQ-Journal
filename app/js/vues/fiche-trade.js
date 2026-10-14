// Fiche d'un trade (même noyau pour le réel et le backtest).

import { store } from '../store.js';
import {
  h, monter, carte, champ, entreeTexte, entreeNombre, segment, ouiNon, selection, bouton, zoneImage, confirmer, notifier,
} from '../ui.js';
import {
  CHECKLIST, DIRECTIONS, QUALITES, PARTIES, VERIFS_AUTO, elementsActifs, nomDe,
} from '../modele.js';
import {
  rrPrevu, rrRealise, resultatR, SOURCES_R, duree, etatDiscipline, suggestionsDiscipline, appliquerSuggestions, valeurR,
} from '../calculs.js';
import { trouverParId } from '../domaine.js';
import {
  depuisUtc, versUtc, killzoneDe, formaterDuree, dateCourte, FUSEAU_NY,
} from '../temps.js';
import { fmtR, fmtRatio, fmtNombre, classeSigne } from '../format.js';
import { naviguer } from '../navigation.js';
import { tagDiscipline, tagsStatut, optionsSessions } from './composants-trade.js';
import { comparaisonPlan, rattacherPlan, detacherPlan } from './plan-reel.js';
import { routeTrade } from '../actions.js';

const OPTIONS_QUALITE = QUALITES.map((q) => ({ id: q, nom: q }));

/** Champs date + heure liés à un instant ISO stocké dans t[cle], saisis dans le fuseau de l'utilisateur. */
function dateHeure(t, cle, { apres, dateParDefaut = null } = {}) {
  const fz = store.p.fuseauSaisie;
  const local = depuisUtc(t[cle], fz) || { date: '', heure: '' };
  const etat = { date: local.date, heure: local.heure };
  const date = h('input', { class: 'entree mono', type: 'date', value: etat.date });
  const heure = h('input', { class: 'entree mono', type: 'time', value: etat.heure });
  const maj = () => {
    etat.date = date.value || (heure.value ? dateParDefaut?.() : '') || '';
    etat.heure = heure.value;
    if (!date.value && etat.date) date.value = etat.date;
    t[cle] = etat.date && etat.heure ? versUtc(etat.date, etat.heure, fz) : etat.date ? versUtc(etat.date, '00:00', fz) : null;
    apres();
  };
  date.addEventListener('change', maj);
  heure.addEventListener('change', maj);
  return { date, heure };
}

export function rendreFicheTrade(conteneur, t) {
  const j = store.journal;
  const p = store.p;
  const fz = p.fuseauSaisie;
  const backtest = t.partie === 'backtest';
  const racine = backtest ? '/backtest' : '/trades';

  // Zones rafraîchies après chaque modification
  const enTete = h('div');
  const calculs = h('div', { class: 'grille grille-4' });
  const discipline = h('div', { class: 'pile' });
  const zoneComparaison = h('div');

  const majQualite = () => {
    if (t.qualite != null && t.qualiteAvantResultat == null) {
      t.qualiteAvantResultat = valeurR(t, p) == null;
    }
    if (t.qualite == null) t.qualiteAvantResultat = null;
  };

  const tout = () => {
    store.changer();
    rendreEnTete();
    rendreCalculs();
    rendreDiscipline();
    rendreComparaison();
  };

  const rendreEnTete = () => {
    const quand = depuisUtc(t.entreeLe, fz);
    const titre = [
      t.direction ? nomDe(DIRECTIONS, t.direction) : 'Trade',
      t.instrument,
      quand ? `— ${dateCourte(quand.date)} ${quand.heure}` : '',
    ].join(' ');
    monter(enTete,
      h('div', { class: 'fil' }, h('a', { href: `#${racine}` }, PARTIES[t.partie]), ' › Trade'),
      h('div', { class: 'titre-vue' },
        h('h1', {}, titre),
        tagDiscipline(t, p),
        tagsStatut(t, j),
        t.statut === 'a_completer'
          ? bouton('Marquer comme complet', () => { t.statut = 'complet'; tout(); }, { classe: 'petit principal' })
          : null,
        bouton('Supprimer', async () => {
          if (!(await confirmer('Supprimer ce trade ?', 'Cette action est définitive (les images restent sur le disque).', { oui: 'Supprimer', danger: true }))) return;
          supprimerTrade(t);
          notifier('Trade supprimé.');
          naviguer(racine);
        }, { classe: 'petit danger' })));
  };

  const rendreCalculs = () => {
    const r = resultatR(t, p);
    const kz = t.entreeLe ? killzoneDe(t.entreeLe, p.listes.killzones) : null;
    const ny = depuisUtc(t.entreeLe, FUSEAU_NY);
    const stat = (libelle, valeur, detail, classe = '') => h('div', { class: 'stat' },
      h('div', { class: 'stat-libelle' }, libelle),
      h('div', { class: ['stat-valeur', classe] }, valeur),
      detail ? h('div', { class: 'stat-detail' }, detail) : null);
    monter(calculs,
      stat('Résultat', fmtR(r.valeur), r.source ? SOURCES_R[r.source] : 'renseigne le résultat ou le prix de sortie', classeSigne(r.valeur)),
      stat('RR prévu', fmtRatio(rrPrevu(t)), 'TP / SL'),
      stat('RR réalisé', fmtRatio(rrRealise(t)), 'sortie / SL'),
      stat('Durée', formaterDuree(duree(t)),
        ny ? `${ny.heure} NY · ${kz ? nomDe(p.listes.killzones, kz) : 'hors killzone'}` : null));
  };

  const rendreDiscipline = () => {
    const sugg = suggestionsDiscipline(j, t, p);
    const etat = etatDiscipline(t, p);
    const regles = p.regles.filter((r) => !r.archive || t.discipline[r.id] != null);
    const nbSugg = regles.filter((r) => t.discipline[r.id] == null && sugg[r.id] != null).length;
    monter(discipline,
      h('div', { class: 'ligne' },
        tagDiscipline(t, p),
        h('span', { class: 'mono' }, `${etat.total - etat.violees.length - etat.manquantes.length}/${etat.total}`),
        h('span', { class: 'discret' }, etat.statut === 'incomplet'
          ? `règles respectées · ${etat.manquantes.length} à renseigner` : 'règles respectées'),
        h('span', { class: 'espace' }),
        nbSugg ? bouton(`Appliquer les ${nbSugg} suggestion(s)`, () => { appliquerSuggestions(j, t, p); tout(); }, { classe: 'petit' }) : null),
      regles.map((r) => {
        const s = sugg[r.id];
        const casse = t.discipline[r.id] === false;
        return h('div', { class: ['regle', casse && 'casse'] },
          h('div', { class: 'regle-texte' },
            h('span', {}, r.texte),
            r.auto && s != null
              ? h('span', { class: ['suggestion', s === t.discipline[r.id] ? 'discret' : (s ? 'gain' : 'perte')], title: VERIFS_AUTO[r.auto] },
                `Vérification : ${s ? 'oui' : 'non'}`)
              : null),
          ouiNon(t.discipline, r.id, { apres: tout }),
          casse
            ? h('div', { class: 'regle-raison' },
              selection(t.raisonsViolation, r.id, elementsActifs(p.listes.raisonsViolation, t.raisonsViolation[r.id]),
                { vide: 'Pourquoi ? (raison)', apres: tout }))
            : null);
      }));
  };

  const rendreComparaison = () => {
    const plan = !backtest && t.planId ? trouverParId(j.plans, t.planId) : null;
    monter(zoneComparaison, plan ? comparaisonPlan(plan, t) : null);
  };

  const entree = dateHeure(t, 'entreeLe', {
    apres: () => {
      t.killzoneId = t.entreeLe ? killzoneDe(t.entreeLe, p.listes.killzones) : null;
      tout();
    },
  });
  const sortie = dateHeure(t, 'sortieLe', {
    apres: tout,
    dateParDefaut: () => depuisUtc(t.entreeLe, fz)?.date || null,
  });

  const zonesTf = elementsActifs(p.listes.timeframes);
  const contexte = carte('Contexte',
    h('div', { class: 'pile' },
      champ(backtest ? 'Session de backtest (date réelle du replay)' : 'Session',
        selection(t, 'sessionId', optionsSessions(t.partie, t.sessionId), { vide: 'Sans check-in', apres: tout })),
      backtest
        ? champ('Campagne', selection(t, 'campagneId', j.campagnes.map((c) => ({ id: c.id, nom: c.nom || 'Campagne sans nom' })), { vide: 'Aucune', apres: tout }))
        : champ('Compte', selection(t, 'compteId', elementsActifs(p.listes.comptes, t.compteId), { vide: '—' })),
      backtest ? null : champ('Plan de trade', selection({ v: t.planId }, 'v', optionsPlans(t), {
        vide: 'Aucun plan',
        apres: (id) => {
          if (t.planId) detacherPlan(t);
          const plan = trouverParId(j.plans, id);
          if (plan) rattacherPlan(t, plan);
          store.changer();
          naviguer(routeTrade(t));
        },
      }), { aide: 'Rattacher le plan préremplit les champs encore vides.' }),
      h('div', { class: 'grille grille-2' },
        champ('Instrument', entreeTexte(t, 'instrument')),
        champ('Direction', segment(t, 'direction', DIRECTIONS, { apres: tout }))),
      backtest
        ? champ('Regardé le futur ?', ouiNon(t, 'regardeFutur', { vide: false, apres: tout }),
          { aide: 'Si oui, ce trade est exclu des statistiques (biais de connaissance du résultat).' })
        : null));

  const analyse = carte('Analyse (avant le résultat)',
    h('div', { class: 'pile' },
      h('div', { class: 'grille grille-2' },
        champ('Setup', selection(t, 'setupId', elementsActifs(p.listes.setups, t.setupId), { vide: '—', apres: tout })),
        champ('Qualité A / B / C', segment(t, 'qualite', OPTIONS_QUALITE, {
          apres: () => { t.qualiteAvantResultat = null; majQualite(); tout(); },
        }), { aide: t.qualiteAvantResultat === false ? 'Donnée après le résultat.' : 'À donner avant de voir le résultat.' })),
      h('div', { class: 'grille grille-2' },
        champ("Zone d'entrée", segment(t.zone, 'typeId', elementsActifs(p.listes.zones, t.zone.typeId), { apres: tout })),
        champ('Timeframe de la zone', selection(t.zone, 'tf', zonesTf, { vide: '—', apres: tout }))),
      h('div', { class: 'checklist' },
        CHECKLIST.map((c) => h('div', { class: 'checklist-item' },
          h('span', {}, c.nom),
          ouiNon(t.checklist, c.id, { apres: tout }))))));

  const faits = carte('Faits',
    h('div', { class: 'pile' },
      h('div', { class: 'grille grille-4' },
        champ(backtest ? 'Date du marché rejoué' : "Date d'entrée", entree.date),
        champ("Heure d'entrée", entree.heure, { aide: `Fuseau : ${fz}` }),
        champ('Date de sortie', sortie.date),
        champ('Heure de sortie', sortie.heure)),
      h('div', { class: 'grille grille-4' },
        champ("Prix d'entrée", entreeNombre(t, 'prixEntree', { apres: tout })),
        champ('Stop loss', entreeNombre(t, 'sl', { apres: tout })),
        champ('Take profit', entreeNombre(t, 'tp', { apres: tout })),
        champ('Prix de sortie', entreeNombre(t, 'prixSortie', { apres: tout }))),
      h('div', { class: 'grille grille-4' },
        champ('Taille (lots)', entreeNombre(t, 'taille', { apres: tout })),
        champ('Risque (%)', entreeNombre(t, 'risquePct', { apres: tout })),
        champ('Risque ($)', entreeNombre(t, 'risqueUsd', { apres: tout })),
        champ('Résultat ($)', entreeNombre(t, 'resultatUsd', { apres: () => { majQualite(); tout(); } }),
          { aide: backtest ? 'Optionnel en backtest.' : 'Net (frais compris).' })),
      h('div', { class: 'grille grille-4' },
        champ('Résultat en R (forcer)', entreeNombre(t, 'resultatRManuel', { apres: () => { majQualite(); tout(); }, placeholder: 'calculé' }),
          { aide: 'Laisse vide pour le calcul automatique.' })),
      calculs));

  const discAvecTitre = carte('Discipline', discipline);

  const captures = carte('Screenshots',
    h('div', { class: 'grille grille-3' },
      [['avant', 'Avant'], ['entree', 'Entrée'], ['resultat', 'Résultat']].map(([cle, libelle]) =>
        zoneImage(t.screenshots[cle], (chemin) => { t.screenshots[cle] = chemin; store.changer(); }, { libelle }))));

  const notes = carte('Notes',
    h('div', { class: 'pile' },
      champ('Note rapide (pendant la session)', entreeTexte(t, 'noteRapide', { notes: true, placeholder: 'Une ligne…' })),
      h('div', { class: 'grille grille-3' },
        champ('Ce qui a marché', entreeTexte(t.analyse, 'marche', { multiligne: true, notes: true, lignes: 4 })),
        champ('Ce qui a raté', entreeTexte(t.analyse, 'rate', { multiligne: true, notes: true, lignes: 4 })),
        champ('Ce que je referais', entreeTexte(t.analyse, 'referais', { multiligne: true, notes: true, lignes: 4 })))));

  const emotions = !backtest
    ? carte('État émotionnel',
      h('div', { class: 'grille grille-3' },
        ['avant', 'pendant', 'apres'].map((moment) => champ(
          { avant: 'Avant', pendant: 'Pendant', apres: 'Après' }[moment],
          selection(t.emotions, moment, elementsActifs(p.listes.emotions, t.emotions[moment]), { vide: '—' })))))
    : null;

  const ctrader = !backtest && t.ctrader ? carte('Données cTrader',
    h('div', { class: 'grille grille-4' },
      [['Brut', t.ctrader.brut], ['Commission', t.ctrader.commission], ['Swap', t.ctrader.swap], ['Net', t.ctrader.net]]
        .map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'stat-libelle' }, l),
          h('div', { class: ['stat-valeur', classeSigne(v)] }, `${fmtNombre(v, 2)} ${t.ctrader.devise || ''}`)))),
    h('p', { class: 'discret', style: { marginTop: '10px' } },
      `IDs : ${(t.ctrader.ids || []).join(', ')} · Order IDs : ${(t.ctrader.orderIds || []).join(', ')}`)) : null;

  rendreEnTete();
  rendreCalculs();
  rendreDiscipline();
  rendreComparaison();

  conteneur.append(enTete,
    h('div', { class: 'pile' },
      zoneComparaison,
      h('div', { class: 'grille grille-2' }, contexte, analyse),
      faits,
      h('div', { class: 'grille grille-2' }, discAvecTitre, h('div', { class: 'pile' }, emotions, captures)),
      notes,
      ctrader));
}

/** Plans proposés pour un trade réel : en attente ou déjà liés à ce trade, du plus proche au plus lointain. */
function optionsPlans(t) {
  const fz = store.p.fuseauSaisie;
  const ref = Date.parse(t.entreeLe || t.creeLe);
  return store.journal.plans
    .filter((pl) => pl.statut === 'en_attente' || pl.id === t.planId)
    .sort((a, b) => Math.abs(Date.parse(a.creeLe) - ref) - Math.abs(Date.parse(b.creeLe) - ref))
    .slice(0, 30)
    .map((pl) => {
      const q = depuisUtc(pl.creeLe, fz);
      return { id: pl.id, nom: `${dateCourte(q.date)} ${q.heure} · ${nomDe(DIRECTIONS, pl.direction)} · ${nomDe(store.p.listes.setups, pl.setupId)}` };
    });
}

export function supprimerTrade(t) {
  const j = store.journal;
  j.trades = j.trades.filter((x) => x.id !== t.id);
  for (const plan of j.plans) {
    if (plan.tradeId === t.id) {
      plan.tradeId = null;
      plan.statut = 'en_attente';
    }
  }
  store.changer();
}
