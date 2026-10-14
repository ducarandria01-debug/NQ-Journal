// Onglet « Backtest » : campagnes (règles du test), trades de backtest, setups présents non pris.

import { store } from '../store.js';
import {
  h, monter, carte, champ, entreeTexte, entreeNombre, entreeDate, segment, selection, bouton, zoneImage, confirmer, vide,
} from '../ui.js';
import { DIRECTIONS, elementsActifs, nomDe } from '../modele.js';
import { trouverParId, occurrencesParSetup, supprimerCampagne } from '../domaine.js';
import { depuisUtc, versUtc, dateCourte, dateLongue } from '../temps.js';
import { fmtR, fmtPct, classeSigne } from '../format.js';
import { lirePref, ecrirePref } from '../etat-ui.js';
import { naviguer } from '../navigation.js';
import { creerTrade, creerSetupNonPris, creerCampagne, creerSession } from '../actions.js';
import { tableauTrades, libelleZone, optionsSessions } from './composants-trade.js';
import { rendreFicheTrade } from './fiche-trade.js';

const introuvable = (conteneur, quoi) =>
  conteneur.append(vide(`${quoi} n’existe plus.`, bouton('Retour au backtest', () => naviguer('/backtest'))));

export function rendre(conteneur, segments) {
  const [type, id] = segments;
  if (type === 'trade') {
    const t = trouverParId(store.journal.trades, id);
    if (!t || t.partie !== 'backtest') return introuvable(conteneur, 'Ce trade');
    return rendreFicheTrade(conteneur, t);
  }
  if (type === 'campagne') {
    const c = trouverParId(store.journal.campagnes, id);
    if (!c) return introuvable(conteneur, 'Cette campagne');
    return rendreCampagne(conteneur, c);
  }
  if (type === 'non-pris') {
    const s = trouverParId(store.journal.setupsNonPris, id);
    if (!s) return introuvable(conteneur, 'Ce setup non pris');
    return rendreNonPris(conteneur, s);
  }
  return rendreAccueil(conteneur);
}

const nomCampagne = (c) => c?.nom || 'Campagne sans nom';

// --- Accueil ---

function tableauOccurrences(campagneId) {
  const p = store.p;
  const lignes = occurrencesParSetup(store.journal, campagneId);
  if (!lignes.length) return h('p', { class: 'discret' }, 'Aucune occurrence enregistrée.');
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Setup'), h('th', { class: 'num' }, 'Occurrences'), h('th', { class: 'num' }, 'Pris'),
        h('th', { class: 'num' }, 'Non pris'), h('th', { class: 'num' }, '% pris'), h('th', { class: 'num' }, 'Futur vu'))),
      h('tbody', {}, lignes.map((l) => h('tr', {},
        h('td', {}, l.setupId ? nomDe(p.listes.setups, l.setupId) : 'Sans setup'),
        h('td', { class: 'num' }, l.total),
        h('td', { class: 'num' }, l.pris),
        h('td', { class: 'num' }, l.nonPris),
        h('td', { class: 'num' }, fmtPct((l.pris / l.total) * 100, 0)),
        h('td', { class: ['num', l.futurVu ? 'perte' : ''] }, l.futurVu))))));
}

function tableauNonPris(liste) {
  const p = store.p;
  if (!liste.length) return h('p', { class: 'discret' }, 'Aucun setup non pris enregistré.');
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date du marché'), h('th', {}, 'Heure'), h('th', {}, 'Setup'), h('th', {}, 'Zone'),
        h('th', {}, 'Sens'), h('th', {}, 'Raison'), h('th', { class: 'num' }, 'Résultat hypothétique'))),
      h('tbody', {}, liste.map((s) => {
        const q = depuisUtc(s.marcheLe, p.fuseauSaisie);
        return h('tr', { class: 'cliquable', onclick: () => naviguer(`/backtest/non-pris/${s.id}`) },
          h('td', { class: 'mono' }, q ? dateCourte(q.date) : '—'),
          h('td', { class: 'mono' }, q?.heure || '—'),
          h('td', {}, nomDe(p.listes.setups, s.setupId)),
          h('td', {}, libelleZone(s.zone, p)),
          h('td', {}, nomDe(DIRECTIONS, s.direction)),
          h('td', {}, nomDe(p.listes.raisonsNonPris, s.raisonId)),
          h('td', { class: ['num', classeSigne(s.resultatHypothetiqueR)] }, fmtR(s.resultatHypothetiqueR)));
      }))));
}

function rendreAccueil(conteneur) {
  const j = store.journal;
  const filtre = { campagneId: lirePref('backtest:campagne', null) };
  if (filtre.campagneId && !trouverParId(j.campagnes, filtre.campagneId)) filtre.campagneId = null;
  const corps = h('div', { class: 'pile' });

  const rendreCorps = () => {
    ecrirePref('backtest:campagne', filtre.campagneId);
    const garder = (x) => !filtre.campagneId || x.campagneId === filtre.campagneId;
    const trades = j.trades.filter((t) => t.partie === 'backtest' && garder(t))
      .sort((a, b) => (b.entreeLe || b.creeLe).localeCompare(a.entreeLe || a.creeLe));
    const nonPris = j.setupsNonPris.filter(garder)
      .sort((a, b) => (b.marcheLe || b.creeLe).localeCompare(a.marcheLe || a.creeLe));
    const campagne = trouverParId(j.campagnes, filtre.campagneId);
    monter(corps,
      campagne?.regles
        ? carte(`Règles du test — ${nomCampagne(campagne)}`, h('p', { class: 'police-notes regles-test' }, campagne.regles))
        : null,
      carte("Compteur d'occurrences par setup", tableauOccurrences(filtre.campagneId)),
      carte('Trades de backtest', tableauTrades(trades, { vide: 'Aucun trade de backtest.' })),
      carte('Setups présents non pris', h('p', { class: 'discret' },
        'Les setups vus mais non pris sont comptés dans les occurrences : ils évitent de gonfler les stats en ne gardant que les beaux trades.'),
      tableauNonPris(nonPris)));
  };

  const listeCampagnes = j.campagnes.slice().sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  conteneur.append(
    h('div', { class: 'titre-vue' },
      h('h1', {}, 'Backtest'),
      bouton('+ Trade de backtest', () => creerTrade('backtest'), { classe: 'principal' }),
      bouton('+ Setup non pris', () => creerSetupNonPris()),
      bouton('Session de backtest', () => creerSession('backtest'), { titre: 'Check-in de session côté backtest (date réelle du replay)' })),
    h('div', { class: 'pile' },
      carte('Campagnes',
        h('div', { class: 'pile' },
          listeCampagnes.length
            ? h('div', { class: 'campagnes' }, listeCampagnes.map((c) => {
              const n = occurrencesParSetup(j, c.id).reduce((s, l) => s + l.total, 0);
              return h('button', {
                type: 'button',
                class: ['campagne', filtre.campagneId === c.id && 'actif'],
                onclick: () => {
                  ecrirePref('backtest:campagne', filtre.campagneId === c.id ? null : c.id);
                  conteneur.replaceChildren();
                  rendreAccueil(conteneur);
                },
                ondblclick: () => naviguer(`/backtest/campagne/${c.id}`),
              },
              h('span', { class: 'campagne-nom' }, nomCampagne(c)),
              h('span', { class: 'discret' }, `${n} occurrence${n > 1 ? 's' : ''}${c.active ? '' : ' · terminée'}`));
            }))
            : h('p', { class: 'discret' }, 'Une campagne regroupe un test : ses règles sont écrites avant de commencer.'),
          h('div', { class: 'ligne' },
            bouton('+ Nouvelle campagne', () => creerCampagne(), { classe: 'petit' }),
            filtre.campagneId ? bouton('Ouvrir la campagne', () => naviguer(`/backtest/campagne/${filtre.campagneId}`), { classe: 'petit' }) : null,
            h('span', { class: 'discret' }, filtre.campagneId ? 'Filtre actif : clique à nouveau pour tout afficher.' : 'Clique sur une campagne pour filtrer.')))),
      corps));

  rendreCorps();
}

// --- Campagne ---

function rendreCampagne(conteneur, c) {
  const j = store.journal;
  const p = store.p;
  const zoneRegles = h('div');
  const rendreRegles = (deverrouille = false) => {
    const figees = c.reglesFigeesLe && !deverrouille;
    monter(zoneRegles, h('div', { class: 'pile' },
      figees
        ? h('p', { class: 'police-notes regles-test' }, c.regles || '—')
        : entreeTexte(c, 'regles', {
          multiligne: true, notes: true, lignes: 8,
          placeholder: 'ex. NAS100, NY AM uniquement, Silver Bullet 10h-11h, entrée FVG M1 après MSS, SL sous le swing, TP 2R, max 2 trades/jour…',
          apres: () => { if (c.reglesFigeesLe) c.reglesModifieesLe = new Date().toISOString(); store.changer(); },
        }),
      h('div', { class: 'ligne' },
        c.reglesFigeesLe
          ? h('span', { class: 'tag contour' }, `🔒 Figées le ${dateCourte(depuisUtc(c.reglesFigeesLe, p.fuseauSaisie).date)}`)
          : bouton('Figer les règles et commencer', () => { c.reglesFigeesLe = new Date().toISOString(); store.changer(); rendreRegles(); }, { classe: 'principal petit' }),
        c.reglesModifieesLe ? h('span', { class: 'tag perte' }, 'Règles modifiées après le début') : null,
        figees ? bouton('Modifier (sera signalé)', () => rendreRegles(true), { classe: 'petit discret' }) : null)));
  };
  rendreRegles();

  const setupsTestes = h('div', { class: 'segment' });
  const rendreSetups = () => monter(setupsTestes, elementsActifs(p.listes.setups).map((s) => h('button', {
    type: 'button',
    class: ['seg', c.setupIds.includes(s.id) && 'actif'],
    'aria-pressed': String(c.setupIds.includes(s.id)),
    onclick: () => {
      c.setupIds = c.setupIds.includes(s.id) ? c.setupIds.filter((x) => x !== s.id) : [...c.setupIds, s.id];
      store.changer();
      rendreSetups();
    },
  }, s.nom)));
  rendreSetups();

  const trades = j.trades.filter((t) => t.partie === 'backtest' && t.campagneId === c.id)
    .sort((a, b) => (b.entreeLe || b.creeLe).localeCompare(a.entreeLe || a.creeLe));
  const nonPris = j.setupsNonPris.filter((s) => s.campagneId === c.id);

  conteneur.append(
    h('div', { class: 'fil' }, h('a', { href: '#/backtest' }, 'Backtest'), ' › Campagne'),
    h('div', { class: 'titre-vue' },
      h('h1', {}, nomCampagne(c)),
      h('span', { class: 'tag contour mono' }, `créée le ${dateCourte(depuisUtc(c.creeLe, p.fuseauSaisie).date)}`),
      bouton('Supprimer', async () => {
        if (!(await confirmer('Supprimer cette campagne ?', 'Ses trades et setups non pris sont conservés, sans campagne.', { oui: 'Supprimer', danger: true }))) return;
        supprimerCampagne(j, c.id);
        store.changer();
        naviguer('/backtest');
      }, { classe: 'petit danger' })),
    h('div', { class: 'pile' },
      h('div', { class: 'grille grille-2' },
        carte('Campagne',
          h('div', { class: 'pile' },
            champ('Nom', entreeTexte(c, 'nom', { placeholder: 'ex. Silver Bullet NY AM — T1 2024' })),
            h('div', { class: 'grille grille-2' },
              champ('Période du marché : début', entreeDate(c, 'periodeDebut')),
              champ('Période du marché : fin', entreeDate(c, 'periodeFin'))),
            champ('Setups testés', setupsTestes),
            champ('Statut', segment(c, 'active', [{ id: true, nom: 'En cours' }, { id: false, nom: 'Terminée' }], { vide: false })))),
        carte('Règles du test (écrites avant de commencer)', zoneRegles)),
      h('div', { class: 'ligne' },
        bouton('+ Trade de backtest', () => {
          const t = creerTrade('backtest', { ouvrir: false });
          t.campagneId = c.id;
          naviguer(`/backtest/trade/${t.id}`);
        }, { classe: 'principal' }),
        bouton('+ Setup non pris', () => creerSetupNonPris({ campagneId: c.id }))),
      carte("Compteur d'occurrences par setup", tableauOccurrences(c.id)),
      carte('Trades', tableauTrades(trades, { vide: 'Aucun trade dans cette campagne.' })),
      carte('Setups présents non pris', tableauNonPris(nonPris))));
}

// --- Setup non pris ---

function rendreNonPris(conteneur, s) {
  const j = store.journal;
  const p = store.p;
  const fz = p.fuseauSaisie;
  const local = depuisUtc(s.marcheLe, fz) || { date: '', heure: '' };
  const quand = { date: local.date, heure: local.heure };
  const majQuand = () => {
    s.marcheLe = quand.date ? versUtc(quand.date, quand.heure || '00:00', fz) : null;
    store.changer();
  };
  const session = trouverParId(j.sessions, s.sessionId);
  conteneur.append(
    h('div', { class: 'fil' }, h('a', { href: '#/backtest' }, 'Backtest'), ' › Setup présent non pris'),
    h('div', { class: 'titre-vue' },
      h('h1', {}, 'Setup présent non pris'),
      session ? h('span', { class: 'tag contour' }, `Replay du ${dateLongue(session.date)}`) : null,
      bouton('Supprimer', async () => {
        if (!(await confirmer('Supprimer ce setup non pris ?', 'Il ne sera plus compté dans les occurrences.', { oui: 'Supprimer', danger: true }))) return;
        j.setupsNonPris = j.setupsNonPris.filter((x) => x.id !== s.id);
        store.changer();
        naviguer('/backtest');
      }, { classe: 'petit danger' })),
    h('div', { class: 'grille grille-2' },
      carte('Le setup',
        h('div', { class: 'pile' },
          h('div', { class: 'grille grille-2' },
            champ('Campagne', selection(s, 'campagneId', j.campagnes.map((c) => ({ id: c.id, nom: nomCampagne(c) })), { vide: 'Aucune' })),
            champ('Session (date réelle du replay)', selection(s, 'sessionId', optionsSessions('backtest', s.sessionId), { vide: 'Sans session' }))),
          h('div', { class: 'grille grille-2' },
            champ('Date du marché rejoué', h('input', { class: 'entree mono', type: 'date', value: quand.date,
              onchange: (e) => { quand.date = e.target.value; majQuand(); } })),
            champ('Heure', h('input', { class: 'entree mono', type: 'time', value: quand.heure,
              onchange: (e) => { quand.heure = e.target.value; majQuand(); } }))),
          h('div', { class: 'grille grille-2' },
            champ('Setup', selection(s, 'setupId', elementsActifs(p.listes.setups, s.setupId), { vide: '—' })),
            champ('Direction', segment(s, 'direction', DIRECTIONS))),
          h('div', { class: 'grille grille-2' },
            champ("Zone d'entrée", segment(s.zone, 'typeId', elementsActifs(p.listes.zones, s.zone.typeId))),
            champ('Timeframe de la zone', selection(s.zone, 'tf', elementsActifs(p.listes.timeframes), { vide: '—' }))))),
      carte('Pourquoi non pris ?',
        h('div', { class: 'pile' },
          champ('Raison', selection(s, 'raisonId', elementsActifs(p.listes.raisonsNonPris, s.raisonId), { vide: '—' })),
          champ('Note', entreeTexte(s, 'note', { multiligne: true, notes: true })),
          champ('Résultat hypothétique (R)', entreeNombre(s, 'resultatHypothetiqueR'),
            { aide: "Optionnel : ce qu'aurait donné le setup. N'entre pas dans les statistiques." }),
          zoneImage(s.screenshot, (chemin) => { s.screenshot = chemin; store.changer(); }, { libelle: 'Screenshot' })))));
}
