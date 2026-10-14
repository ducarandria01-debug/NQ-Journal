// Dashboard : statistiques en R (Standard / Expert), challenge Prop Firm, revue hebdomadaire.

import { store } from '../store.js';
import { h, monter, carte, segment, selection } from '../ui.js';
import { PARTIES, elementsActifs } from '../modele.js';
import {
  selectionTrades, statsDeBase, tauxDiscipline, parZone, decoupagesExpert, analyseChecklist, conformesVsNon,
  rParRaison, disciplineParEnergie, comparaisonBacktestReel, challengePropFirm,
} from '../stats.js';
import { aujourdhui, ajouterJours } from '../temps.js';
import { fmtR, fmtPct, fmtRatio, fmtUsd, classeSigne } from '../format.js';
import { lirePref, ecrirePref } from '../etat-ui.js';
import { courbeR, barreDivergente, jauge } from './graphiques.js';
import { blocRevueHebdo } from './revue.js';

const PERIODES = [
  { id: 'tout', nom: 'Tout' }, { id: '30j', nom: '30 jours' }, { id: '90j', nom: '90 jours' },
  { id: 'annee', nom: 'Cette année' }, { id: 'perso', nom: 'Personnalisée' },
];
const SEUIL_GROUPE = 10;

function bornesPeriode(f, fz) {
  const auj = aujourdhui(fz);
  switch (f.periode) {
    case '30j': return { debut: ajouterJours(auj, -29), fin: auj };
    case '90j': return { debut: ajouterJours(auj, -89), fin: auj };
    case 'annee': return { debut: `${auj.slice(0, 4)}-01-01`, fin: auj };
    case 'perso': return { debut: f.debut || null, fin: f.fin || null };
    default: return { debut: null, fin: null };
  }
}

const pctOu = (x, dec = 1) => (x == null ? '—' : fmtPct(x * 100, dec));
const pf = (x) => (x === Infinity ? '∞' : fmtRatio(x));

function tuile(libelle, valeur, { detail = null, classe = '' } = {}) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-libelle' }, libelle),
    h('div', { class: ['stat-valeur', classe] }, valeur),
    detail ? h('div', { class: 'stat-detail' }, detail) : null);
}

/** Tableau de découpage : une ligne par groupe, avec barre d'expectancy centrée sur zéro. */
function tableauDecoupage(lignes, { colonneLibelle = '' } = {}) {
  if (!lignes.length) return h('p', { class: 'discret' }, 'Pas de données.');
  const maxAbs = Math.max(...lignes.map((l) => Math.abs(l.expectancy ?? 0)), 0.0001);
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau compact' },
      h('thead', {}, h('tr', {}, h('th', {}, colonneLibelle), h('th', { class: 'num' }, 'Trades'), h('th', { class: 'num' }, 'Winrate'),
        h('th', { class: 'num' }, 'Expectancy'), h('th', { class: 'col-barre' }, ''), h('th', { class: 'num' }, 'Total'))),
      h('tbody', {}, lignes.map((l) => h('tr', { class: l.n < SEUIL_GROUPE ? 'faible' : '', title: l.n < SEUIL_GROUPE ? 'Groupe très petit : à interpréter avec prudence' : null },
        h('td', {}, l.libelle),
        h('td', { class: 'num' }, l.n),
        h('td', { class: 'num' }, pctOu(l.winrate, 0)),
        h('td', { class: ['num', classeSigne(l.expectancy)] }, fmtR(l.expectancy)),
        h('td', { class: 'col-barre' }, barreDivergente(l.expectancy, maxAbs)),
        h('td', { class: ['num', classeSigne(l.totalR)] }, fmtR(l.totalR, 1)))))));
}

function blocPropFirm(c) {
  if (!c) return null;
  const partUtilisee = c.drawdownMaxUsd > 0 ? c.drawdownUtiliseUsd / c.drawdownMaxUsd : 0;
  const tonDD = partUtilisee >= 0.8 ? 'perte' : partUtilisee >= 0.5 ? 'alerte' : 'gain';
  const statut = { en_cours: ['En cours', 'contour'], reussi: ['Objectif atteint', 'gain'], echoue: ['Drawdown dépassé', 'perte'] }[c.statut];
  return carte('Challenge Prop Firm',
    h('div', { class: 'pile' },
      h('div', { class: 'ligne' },
        h('span', { class: ['tag', statut[1]] }, statut[0]),
        h('span', { class: 'discret' }, `${c.nbTrades} trade(s) · compte de ${fmtUsd(c.tailleCompte, { dec: 0 })}`),
        c.tradesEstimes ? h('span', { class: 'tag alerte', title: 'Résultat $ manquant : estimé avec R × risque $' }, `${c.tradesEstimes} résultat(s) estimé(s)`) : null),
      h('div', { class: 'grille grille-3' },
        h('div', { class: 'pile-serree' },
          h('div', { class: 'ligne-entre' }, h('span', { class: 'stat-libelle' }, 'Objectif de profit'),
            h('span', { class: 'mono' }, `${fmtUsd(c.pnlUsd, { signe: true, dec: 0 })} / ${fmtUsd(c.objectifUsd, { dec: 0 })}`)),
          jauge(c.progression, 'accent'),
          h('span', { class: 'stat-detail' }, `${pctOu(c.progression, 0)} de l'objectif · ${fmtPct(c.pnlPct, 2, { signe: true })}`)),
        h('div', { class: 'pile-serree' },
          h('div', { class: 'ligne-entre' }, h('span', { class: 'stat-libelle' }, 'Drawdown restant'),
            h('span', { class: ['mono', c.drawdownRestantUsd <= 0 ? 'perte' : ''] }, fmtUsd(c.drawdownRestantUsd, { dec: 0 }))),
          jauge(partUtilisee, tonDD),
          h('span', { class: 'stat-detail' }, `${pctOu(partUtilisee, 0)} du drawdown max (${fmtUsd(c.drawdownMaxUsd, { dec: 0 })}) utilisé`)),
        h('div', { class: 'pile-serree' },
          h('div', { class: 'ligne-entre' }, h('span', { class: 'stat-libelle' }, 'Jours de trading'),
            h('span', { class: 'mono' }, `${c.joursTrading} / ${c.joursMin}`)),
          jauge(c.joursMin ? c.joursTrading / c.joursMin : 1, c.joursTrading >= c.joursMin ? 'gain' : 'accent'),
          h('span', { class: 'stat-detail' }, c.joursTrading >= c.joursMin ? 'Minimum atteint' : `Encore ${c.joursMin - c.joursTrading} jour(s)`)))));
}

function rendreStats(zone, f) {
  const j = store.journal;
  const p = store.p;
  const { debut, fin } = bornesPeriode(f, p.fuseauSaisie);
  const filtres = { partie: f.partie, debut, fin, setupId: f.setupId,
    compteId: f.partie === 'reel' ? f.compteId : null, campagneId: f.partie === 'backtest' ? f.campagneId : null };
  const { trades, exclus } = selectionTrades(j, p, filtres);
  const s = statsDeBase(trades, p);
  const d = tauxDiscipline(trades, p);
  const expert = p.modeStats === 'expert';

  const avertissements = [];
  if (s.n < p.seuilEchantillon) {
    avertissements.push(h('div', { class: 'avertissement' },
      `Échantillon trop petit : ${s.n} trade${s.n > 1 ? 's' : ''} (seuil ${p.seuilEchantillon}). Les chiffres peuvent encore beaucoup bouger : ne conclus rien trop vite.`));
  }
  const infos = [];
  if (exclus.futurVu) infos.push(`${exclus.futurVu} trade(s) « futur vu » exclu(s)`);
  if (exclus.sansResultat) infos.push(`${exclus.sansResultat} trade(s) sans résultat ignoré(s)`);

  const tuiles = [
    tuile('Trades', String(s.n), { detail: `${s.gagnants} gagnants · ${s.perdants} perdants${s.nuls ? ` · ${s.nuls} nuls` : ''}` }),
    tuile('Winrate', pctOu(s.winrate)),
    tuile('RR moyen', fmtRatio(s.rrMoyen), { detail: `gain moyen ÷ perte moyenne · prévu ${fmtRatio(s.rrPrevuMoyen)}` }),
    tuile('Expectancy', fmtR(s.expectancy), { classe: classeSigne(s.expectancy), detail: 'R moyen par trade' }),
    tuile('Résultat', fmtR(s.totalR, 1), { classe: classeSigne(s.totalR), detail: s.totalPct != null ? fmtPct(s.totalPct, 2, { signe: true }) : '% indisponible' }),
    tuile('Drawdown max', s.n ? fmtR(-s.drawdownMaxR, 1) : '—', { detail: s.drawdownMaxPct != null && s.n ? fmtPct(-s.drawdownMaxPct, 2) : null }),
    tuile('Discipline', pctOu(d.taux, 0), { detail: `${d.conformes} conforme(s) sur ${d.evalues} évalué(s)` }),
  ];
  if (expert) {
    tuiles.push(
      tuile('Profit factor', pf(s.profitFactor)),
      tuile('Série de gains max', String(s.serieGainsMax)),
      tuile('Série de pertes max', String(s.seriePertesMax)));
  }

  const blocs = [
    ...avertissements,
    infos.length ? h('p', { class: 'discret' }, infos.join(' · ')) : null,
    h('div', { class: 'grille grille-tuiles' }, tuiles),
    h('div', { class: 'grille grille-2-1' },
      carte('Courbe des R cumulés', courbeR(s.courbe, { fuseau: p.fuseauSaisie })),
      carte('FVG vs OB', tableauDecoupage(parZone(trades, p), { colonneLibelle: 'Zone' }))),
  ];
  if (f.partie === 'reel') blocs.push(blocPropFirm(challengePropFirm(j, p)));

  if (expert) {
    const c = conformesVsNon(trades, p);
    const raisons = rParRaison(trades, p);
    const energie = disciplineParEnergie(j, trades, p);
    const checklist = analyseChecklist(trades, p);
    const comparaison = comparaisonBacktestReel(j, p, { debut, fin, setupId: f.setupId });
    blocs.push(
      h('h2', { class: 'titre-section' }, 'Analyse expert'),
      h('div', { class: 'grille grille-2' },
        decoupagesExpert(j, trades, p).map((dc) => carte(dc.titre, tableauDecoupage(dc.lignes)))),
      h('div', { class: 'grille grille-2' },
        carte('Discipline : conformes vs non conformes',
          h('div', { class: 'pile' },
            h('div', { class: 'grille grille-2' },
              tuile('Expectancy conformes', fmtR(c.conformes.expectancy), { classe: classeSigne(c.conformes.expectancy), detail: `${c.conformes.n} trade(s)` }),
              tuile('Expectancy non conformes', fmtR(c.nonConformes.expectancy), { classe: classeSigne(c.nonConformes.expectancy), detail: `${c.nonConformes.n} trade(s)` })),
            h('div', { class: 'grille grille-2' },
              tuile('R perdus hors règles', c.rPerdusHorsRegles ? fmtR(-c.rPerdusHorsRegles, 1) : fmtR(0, 1), { classe: c.rPerdusHorsRegles ? 'perte' : '', detail: 'somme des pertes des trades non conformes' }),
              tuile('Bilan net hors règles', fmtR(c.rNetHorsRegles, 1), { classe: classeSigne(c.rNetHorsRegles) })),
            raisons.length
              ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau compact' },
                h('thead', {}, h('tr', {}, h('th', {}, 'Raison'), h('th', { class: 'num' }, 'Trades'), h('th', { class: 'num' }, 'Total'))),
                h('tbody', {}, raisons.map((r) => h('tr', {}, h('td', {}, r.libelle), h('td', { class: 'num' }, r.n),
                  h('td', { class: ['num', classeSigne(r.totalR)] }, fmtR(r.totalR, 1)))))))
              : h('p', { class: 'discret' }, 'Aucune règle cassée sur la période.'))),
        carte('Checklist : ce qui manque dans les pertes',
          h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau compact' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Élément'), h('th', { class: 'num' }, 'Absent des pertes'), h('th', { class: 'num' }, 'Absent des gains'))),
            h('tbody', {}, checklist.map((l, i) => h('tr', {},
              h('td', {}, l.nom, i === 0 && l.manquantPertes ? h('span', { class: 'tag alerte', style: { marginLeft: '6px' } }, 'le plus fréquent') : null),
              h('td', { class: 'num' }, pctOu(l.manquantPertes, 0)),
              h('td', { class: 'num' }, pctOu(l.manquantGains, 0))))))))),
      h('div', { class: 'grille grille-2' },
        carte("Discipline selon l'énergie du check-in",
          h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau compact' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Énergie'), h('th', { class: 'num' }, 'Trades'), h('th', { class: 'num' }, 'Discipline'), h('th', { class: 'num' }, 'Expectancy'))),
            h('tbody', {}, energie.lignes.map((l) => h('tr', { class: l.n ? '' : 'faible' },
              h('td', { class: 'mono' }, `${l.energie} / 5`),
              h('td', { class: 'num' }, l.n),
              h('td', { class: 'num' }, pctOu(l.tauxDiscipline, 0)),
              h('td', { class: ['num', classeSigne(l.expectancy)] }, fmtR(l.expectancy))))))),
          energie.sansCheckin ? h('p', { class: 'discret', style: { marginTop: '8px' } }, `${energie.sansCheckin} trade(s) sans check-in non comptés ici.`) : null),
        carte('Backtest vs réel, par setup',
          comparaison.length
            ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau compact' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Setup'), h('th', { class: 'num' }, 'Backtest'), h('th', { class: 'num' }, 'Réel'), h('th', { class: 'num' }, 'Écart'))),
              h('tbody', {}, comparaison.map((l) => h('tr', {},
                h('td', {}, l.libelle),
                h('td', { class: 'num' }, h('div', {}, fmtR(l.backtest.expectancy)), h('div', { class: 'discret' }, `${l.backtest.n} tr. · ${pctOu(l.backtest.winrate, 0)}`)),
                h('td', { class: 'num' }, h('div', {}, fmtR(l.reel.expectancy)), h('div', { class: 'discret' }, `${l.reel.n} tr. · ${pctOu(l.reel.winrate, 0)}`)),
                h('td', { class: ['num', classeSigne(l.ecartExpectancy)] }, l.ecartExpectancy == null ? '—' : fmtR(l.ecartExpectancy)))))))
            : h('p', { class: 'discret' }, 'Pas encore de données.'),
          h('p', { class: 'discret', style: { marginTop: '8px' } }, 'Expectancy par trade. Un écart négatif = le réel fait moins bien que le backtest (exécution, discipline…).'))));
  }
  monter(zone, ...blocs);
}

export function rendre(conteneur) {
  const p = store.p;
  const f = lirePref('dashboard:filtres', { partie: 'reel', periode: 'tout', debut: null, fin: null, compteId: null, campagneId: null, setupId: null });
  const zone = h('div', { class: 'pile' });
  const barre = h('div', { class: 'barre-filtres' });
  const maj = () => { ecrirePref('dashboard:filtres', f); rendreBarre(); rendreStats(zone, f); };

  const rendreBarre = () => monter(barre,
    segment(f, 'partie', Object.entries(PARTIES).map(([id, nom]) => ({ id, nom })), { vide: false, apres: maj }),
    h('div', { class: 'filtre' }, selection(f, 'periode', PERIODES, { vide: null, apres: maj })),
    f.periode === 'perso' ? h('input', { class: 'entree mono filtre-date', type: 'date', value: f.debut || '', title: 'Du', onchange: (e) => { f.debut = e.target.value || null; maj(); } }) : null,
    f.periode === 'perso' ? h('input', { class: 'entree mono filtre-date', type: 'date', value: f.fin || '', title: 'Au', onchange: (e) => { f.fin = e.target.value || null; maj(); } }) : null,
    f.partie === 'reel'
      ? h('div', { class: 'filtre' }, selection(f, 'compteId', elementsActifs(p.listes.comptes, f.compteId), { vide: 'Tous les comptes', apres: maj }))
      : h('div', { class: 'filtre' }, selection(f, 'campagneId', store.journal.campagnes.map((c) => ({ id: c.id, nom: c.nom || 'Campagne sans nom' })), { vide: 'Toutes les campagnes', apres: maj })),
    h('div', { class: 'filtre' }, selection(f, 'setupId', elementsActifs(p.listes.setups, f.setupId), { vide: 'Tous les setups', apres: maj })),
    h('span', { class: 'espace' }),
    segment(p, 'modeStats', [{ id: 'standard', nom: 'Standard' }, { id: 'expert', nom: 'Expert' }], {
      vide: false, apres: () => { store.changer(); maj(); },
    }));

  conteneur.append(
    h('div', { class: 'titre-vue' }, h('h1', {}, 'Dashboard'), h('span', { class: 'sous-titre' }, 'Tout est mesuré en R.')),
    barre,
    zone);
  const revue = blocRevueHebdo();
  if (revue) conteneur.append(revue);
  rendreBarre();
  rendreStats(zone, f);
}

