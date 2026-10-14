// Calendrier des sessions : un mois, résultat en R par jour, couleur selon la discipline.

import { store } from '../store.js';
import { h, monter, carte, bouton } from '../ui.js';
import { resumeParJour } from '../domaine.js';
import { aujourdhui, NOMS_MOIS, ajouterJours } from '../temps.js';
import { fmtR, fmtPct } from '../format.js';
import { lirePref, ecrirePref } from '../etat-ui.js';
import { naviguer } from '../navigation.js';

const ETATS = {
  victoire: { libelle: 'Victoire (pas de trade, comme décidé)', icone: '✓', classe: 'victoire' },
  conforme: { libelle: 'Tous les trades conformes', icone: '✓', classe: 'conforme' },
  partiel: { libelle: 'Une partie des trades conformes', icone: '~', classe: 'partiel' },
  non_conforme: { libelle: 'Aucun trade conforme / décision non respectée', icone: '✕', classe: 'non-conforme' },
};

function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function blocCalendrier(partie) {
  const p = store.p;
  const auj = aujourdhui(p.fuseauSaisie);
  const etat = { mois: lirePref(`calendrier:${partie}`, auj.slice(0, 7)) };
  const zone = h('div');

  const rendre = () => {
    ecrirePref(`calendrier:${partie}`, etat.mois);
    const jours = resumeParJour(store.journal, partie, p);
    const premier = `${etat.mois}-01`;
    const [a, m] = etat.mois.split('-').map(Number);
    const jsPremier = new Date(Date.UTC(a, m - 1, 1)).getUTCDay() || 7;
    const debutGrille = ajouterJours(premier, -(jsPremier - 1));
    let totalMois = null;
    let joursTrades = 0;
    const cellules = [];
    for (let i = 0; i < 42; i++) {
      const date = ajouterJours(debutGrille, i);
      if (i >= 35 && date.slice(0, 7) !== etat.mois) break;
      const dansMois = date.slice(0, 7) === etat.mois;
      const j = jours.get(date);
      if (dansMois && j?.totalR != null) { totalMois = (totalMois ?? 0) + j.totalR; joursTrades += 1; }
      const info = j?.etat ? ETATS[j.etat] : null;
      const cliquable = !!j?.sessions.length;
      cellules.push(h(cliquable ? 'button' : 'div', {
        type: cliquable ? 'button' : null,
        class: ['jour', !dansMois && 'hors-mois', date === auj && 'aujourdhui', info?.classe, cliquable && 'cliquable'],
        title: j ? [info?.libelle, j.score != null ? `Discipline : ${fmtPct(j.score * 100, 0)}` : null,
          `${j.trades.length} trade(s), ${j.sessions.length} session(s)`].filter(Boolean).join('\n') : null,
        onclick: cliquable ? () => naviguer(`/sessions/${j.sessions[0].id}`) : null,
      },
      h('span', { class: 'jour-num' }, String(Number(date.slice(8)))),
      info ? h('span', { class: 'jour-icone', 'aria-label': info.libelle }, info.icone) : null,
      j?.totalR != null ? h('span', { class: 'jour-r mono' }, fmtR(j.totalR, 1)) : null,
      j && j.trades.length ? h('span', { class: 'jour-nb' }, `${j.trades.length} tr.`) : j?.sessions.length ? h('span', { class: 'jour-nb' }, 'session') : null));
    }
    monter(zone, carte(null,
      h('div', { class: 'calendrier-tete' },
        bouton('‹', () => { etat.mois = decalerMois(etat.mois, -1); rendre(); }, { classe: 'petit', titre: 'Mois précédent' }),
        h('h3', { class: 'calendrier-titre' }, `${NOMS_MOIS[m - 1].replace(/^./, (c) => c.toUpperCase())} ${a}`),
        bouton('›', () => { etat.mois = decalerMois(etat.mois, 1); rendre(); }, { classe: 'petit', titre: 'Mois suivant' }),
        etat.mois !== auj.slice(0, 7) ? bouton("Aujourd'hui", () => { etat.mois = auj.slice(0, 7); rendre(); }, { classe: 'petit discret' }) : null,
        h('span', { class: 'espace' }),
        h('span', { class: 'discret' }, 'Mois :'),
        h('span', { class: 'mono' }, fmtR(totalMois, 1)),
        h('span', { class: 'discret' }, `· ${joursTrades} jour(s) tradé(s)`)),
      h('div', { class: 'calendrier' },
        ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((j) => h('div', { class: 'jour-entete' }, j)),
        cellules),
      h('div', { class: 'legende' },
        Object.values(ETATS).map((e) => h('span', { class: 'legende-item' },
          h('span', { class: ['pastille', e.classe] }, e.icone), e.libelle)))));
  };
  rendre();
  return zone;
}
