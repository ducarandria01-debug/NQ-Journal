// Revue hebdomadaire : petit bilan de la semaine (ce que j'ai bien fait, une chose à corriger, une règle à renforcer).

import { store } from '../store.js';
import { h, monter, carte, champ, entreeTexte, selection, bouton } from '../ui.js';
import { nouvelleRevue, elementsActifs } from '../modele.js';
import { selectionTrades, statsDeBase, tauxDiscipline } from '../stats.js';
import { resumeParJour } from '../domaine.js';
import { aujourdhui, depuisUtc, semaineIso, lundiDeSemaine, ajouterJours, dateCourte } from '../temps.js';
import { fmtR, fmtPct, classeSigne } from '../format.js';

function semaineVoisine(semaine, n) {
  return semaineIso(ajouterJours(lundiDeSemaine(semaine), 7 * n));
}

/** Chiffres de la semaine (réel), calculés automatiquement. */
export function resumeSemaine(journal, p, semaine) {
  const debut = lundiDeSemaine(semaine);
  const fin = ajouterJours(debut, 6);
  const { trades } = selectionTrades(journal, p, { partie: 'reel', debut, fin });
  const s = statsDeBase(trades, p);
  const d = tauxDiscipline(trades, p);
  const jours = [...resumeParJour(journal, 'reel', p).values()].filter((j) => j.date >= debut && j.date <= fin);
  const backtest = journal.trades.filter((t) => t.partie === 'backtest'
    && semaineIso(depuisUtc(t.creeLe, p.fuseauSaisie).date) === semaine).length;
  return {
    debut, fin, n: s.n, totalR: s.totalR, winrate: s.winrate, discipline: d.taux,
    sessions: jours.reduce((a, j) => a + j.sessions.length, 0),
    victoires: jours.filter((j) => j.etat === 'victoire').length,
    backtest,
  };
}

export function blocRevueHebdo() {
  const p = store.p;
  const courante = semaineIso(aujourdhui(p.fuseauSaisie));
  const etat = { semaine: courante };
  const zone = h('div');

  const rendre = () => {
    const j = store.journal;
    const existante = j.revues.find((r) => r.semaine === etat.semaine);
    // La revue n'est créée qu'à la première saisie (pas de fiche vide).
    const revue = existante || nouvelleRevue(etat.semaine);
    const enregistrer = () => {
      if (!j.revues.includes(revue)) j.revues.push(revue);
      store.changer();
    };
    const r = resumeSemaine(j, p, etat.semaine);
    const precedente = semaineVoisine(courante, -1);
    const manquePrecedente = etat.semaine === courante && !j.revues.some((x) => x.semaine === precedente)
      && resumeSemaine(j, p, precedente).n > 0;
    const faites = j.revues.filter((x) => x.semaine !== etat.semaine && (x.bienFait || x.aCorriger || x.regleId))
      .sort((a, b) => b.semaine.localeCompare(a.semaine)).slice(0, 8);
    const chiffre = (libelle, valeur, classe = '') => h('div', { class: 'revue-chiffre' },
      h('span', { class: 'stat-libelle' }, libelle), h('span', { class: ['mono', classe] }, valeur));

    monter(zone, carte('Revue hebdomadaire',
      h('div', { class: 'pile' },
        h('div', { class: 'calendrier-tete' },
          bouton('‹', () => { etat.semaine = semaineVoisine(etat.semaine, -1); rendre(); }, { classe: 'petit', titre: 'Semaine précédente' }),
          h('h3', { class: 'calendrier-titre' }, `Semaine du ${dateCourte(r.debut)} au ${dateCourte(r.fin)}`),
          bouton('›', () => { etat.semaine = semaineVoisine(etat.semaine, 1); rendre(); }, { classe: 'petit', titre: 'Semaine suivante', desactive: etat.semaine >= courante }),
          etat.semaine !== courante ? bouton('Cette semaine', () => { etat.semaine = courante; rendre(); }, { classe: 'petit discret' }) : null,
          existante ? h('span', { class: 'tag gain' }, 'Revue faite') : null),
        manquePrecedente
          ? h('div', { class: 'avertissement' }, 'La revue de la semaine dernière n’est pas faite. ',
            bouton('La faire maintenant', () => { etat.semaine = precedente; rendre(); }, { classe: 'petit' }))
          : null,
        h('div', { class: 'revue-chiffres' },
          chiffre('Trades', String(r.n)),
          chiffre('Résultat', fmtR(r.totalR, 1), classeSigne(r.totalR)),
          chiffre('Winrate', r.winrate == null ? '—' : fmtPct(r.winrate * 100, 0)),
          chiffre('Discipline', r.discipline == null ? '—' : fmtPct(r.discipline * 100, 0)),
          chiffre('Sessions', String(r.sessions)),
          chiffre('Jours sans trade décidés', String(r.victoires)),
          chiffre('Trades de backtest', String(r.backtest))),
        h('div', { class: 'grille grille-3' },
          champ('Ce que j’ai bien fait', entreeTexte(revue, 'bienFait', { multiligne: true, notes: true, lignes: 3, apres: enregistrer })),
          champ('Une chose à corriger', entreeTexte(revue, 'aCorriger', { multiligne: true, notes: true, lignes: 3, apres: enregistrer })),
          h('div', { class: 'pile' },
            champ('Une règle à renforcer', selection(revue, 'regleId',
              elementsActifs(p.regles, revue.regleId).map((x) => ({ id: x.id, nom: x.texte })), { vide: '—', apres: enregistrer })),
            champ('Comment ?', entreeTexte(revue, 'note', { notes: true, apres: enregistrer, placeholder: 'ex. relire la checklist avant chaque entrée' })))),
        faites.length
          ? h('div', { class: 'ligne' }, h('span', { class: 'discret' }, 'Revues précédentes :'),
            faites.map((x) => bouton(dateCourte(lundiDeSemaine(x.semaine)), () => { etat.semaine = x.semaine; rendre(); }, { classe: 'petit discret' })))
          : null)));
  };
  rendre();
  return zone;
}
