// Onglet « Check-in de session » : liste des sessions et fiche d'une session.

import { store } from '../store.js';
import {
  h, monter, carte, champ, entreeTexte, entreeNombre, segment, selection, bouton, zoneImage, confirmer, vide, notifier,
} from '../ui.js';
import {
  PARTIES, BIAIS, DECISIONS, ISSUES_VISION, elementsActifs, nomDe,
} from '../modele.js';
import { sessionsDu, trouverParId, supprimerSession, aCheckin } from '../domaine.js';
import { aujourdhui, dateLongue, dateCourte } from '../temps.js';
import { lirePref, ecrirePref } from '../etat-ui.js';
import { naviguer } from '../navigation.js';
import { creerSession } from '../actions.js';
import { blocTradesDeSession, resumeSession, celluleDiscipline } from './session-trades.js';
import { blocCalendrier } from './calendrier.js';

const ENERGIES = [1, 2, 3, 4, 5].map((n) => ({ id: n, nom: String(n) }));

export function partieCourante() {
  return lirePref('sessions:partie', 'reel');
}

export function rendre(conteneur, segments) {
  if (segments[0]) {
    const session = trouverParId(store.journal.sessions, segments[0]);
    if (!session) {
      conteneur.append(vide('Cette session n’existe plus.', bouton('Retour aux sessions', () => naviguer('/sessions'))));
      return;
    }
    return rendreFiche(conteneur, session);
  }
  return rendreListe(conteneur);
}

// --- Liste ---

function rendreListe(conteneur) {
  const etat = { partie: partieCourante() };
  const corps = h('div', { class: 'pile' });

  const rendreCorps = () => {
    const date = aujourdhui(store.p.fuseauSaisie);
    const duJour = sessionsDu(store.journal, etat.partie, date);
    const toutes = store.journal.sessions
      .filter((s) => s.partie === etat.partie)
      .sort((a, b) => b.date.localeCompare(a.date) || b.numero - a.numero);

    const dateAutre = { valeur: date };
    monter(corps,
      carte(`Aujourd'hui — ${dateLongue(date)}`,
        duJour.length
          ? h('div', { class: 'ligne' },
            duJour.map((s) => bouton(`Ouvrir la session ${s.numero}${aCheckin(s) ? '' : ' (check-in à faire)'}`,
              () => naviguer(`/sessions/${s.id}`), { classe: 'principal' })),
            bouton('+ Deuxième session aujourd’hui', () => creerSession(etat.partie)))
          : h('div', { class: 'ligne' },
            bouton(etat.partie === 'reel' ? 'Faire le check-in du jour' : 'Démarrer une session de backtest',
              () => creerSession(etat.partie), { classe: 'principal' }),
            h('span', { class: 'discret' }, etat.partie === 'backtest'
              ? 'La session porte la date réelle du replay ; chaque trade garde la date du marché rejoué.'
              : 'Énergie, sommeil, décision du jour, puis ta vision du marché.')),
        h('div', { class: 'ligne', style: { marginTop: '12px' } },
          h('span', { class: 'discret' }, 'Session d’un autre jour :'),
          h('input', { class: 'entree mono', type: 'date', value: date, style: { width: 'auto' },
            onchange: (e) => { dateAutre.valeur = e.target.value; } }),
          bouton('Créer', () => dateAutre.valeur && creerSession(etat.partie, dateAutre.valeur), { classe: 'petit' }))),
      blocCalendrier(etat.partie),
      toutes.length ? tableauSessions(toutes) : vide('Aucune session pour l’instant.'));
  };

  conteneur.append(
    h('div', { class: 'titre-vue' },
      h('h1', {}, 'Check-in de session'),
      segment(etat, 'partie', Object.entries(PARTIES).map(([id, nom]) => ({ id, nom })), {
        vide: false,
        apres: (v) => { ecrirePref('sessions:partie', v); rendreCorps(); },
      })),
    corps);
  rendreCorps();
}

function tableauSessions(sessions) {
  const p = store.p;
  return h('div', { class: 'tableau-conteneur' },
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Date'), h('th', { class: 'num' }, 'N°'), h('th', { class: 'num' }, 'Énergie'),
        h('th', { class: 'num' }, 'Sommeil'), h('th', {}, 'Décision'), h('th', {}, 'Biais HTF'),
        h('th', {}, 'Vision'), h('th', { class: 'num' }, 'Trades'), h('th', { class: 'num' }, 'Résultat'),
        h('th', {}, 'Discipline'))),
      h('tbody', {}, sessions.map((s) => {
        const r = resumeSession(store.journal, s, p);
        return h('tr', { class: 'cliquable', onclick: () => naviguer(`/sessions/${s.id}`) },
          h('td', { class: 'mono' }, dateCourte(s.date)),
          h('td', { class: 'num' }, s.numero),
          h('td', { class: 'num' }, s.checkin.energie ?? '—'),
          h('td', { class: 'num' }, s.checkin.sommeil != null ? `${String(s.checkin.sommeil).replace('.', ',')} h` : '—'),
          h('td', {}, aCheckin(s) ? nomDe(DECISIONS, s.checkin.decision) : h('span', { class: 'tag alerte' }, 'Check-in à faire')),
          h('td', {}, nomDe(BIAIS, s.vision.biais)),
          h('td', {}, nomDe(ISSUES_VISION, s.fin.vision)),
          h('td', { class: 'num' }, r.nbTrades),
          h('td', { class: ['num', r.classeR] }, r.texteR),
          h('td', {}, celluleDiscipline(r.discipline)));
      }))));
}

// --- Fiche ---

function galeriePhotos(session) {
  const grille = h('div', { class: 'galerie' });
  const tfs = elementsActifs(store.p.listes.timeframes);
  const rendreGalerie = () => {
    monter(grille,
      session.vision.photos.map((photo, i) => h('div', { class: 'photo' },
        zoneImage(photo.chemin, (chemin) => {
          if (!chemin) {
            session.vision.photos.splice(i, 1);
            rendreGalerie();
          } else {
            photo.chemin = chemin;
          }
          store.changer();
        }, { libelle: photo.tf || 'Photo' }),
        selection(photo, 'tf', tfs, { vide: 'Timeframe (optionnel)', apres: () => { store.changer(); rendreGalerie(); } }))),
      h('div', { class: 'photo' },
        zoneImage(null, (chemin) => {
          if (!chemin) return;
          session.vision.photos.push({ chemin, tf: null });
          store.changer();
          rendreGalerie();
        }, { libelle: 'Ajouter une photo' })));
  };
  rendreGalerie();
  return grille;
}

function rendreFiche(conteneur, s) {
  const autres = sessionsDu(store.journal, s.partie, s.date).filter((x) => x.id !== s.id);
  const enTete = h('div', {});
  const rendreEnTete = () => monter(enTete,
    h('div', { class: 'fil' }, h('a', { href: '#/sessions' }, 'Check-in de session'), ` › ${PARTIES[s.partie]}`),
    h('div', { class: 'titre-vue' },
      h('h1', {}, `${dateLongue(s.date)} — session ${s.numero}`),
      h('span', { class: ['tag', s.partie === 'reel' ? 'accent' : 'contour'] }, PARTIES[s.partie]),
      aCheckin(s) ? null : h('span', { class: 'tag alerte' }, 'Check-in à faire'),
      autres.map((x) => bouton(`Session ${x.numero}`, () => naviguer(`/sessions/${x.id}`), { classe: 'petit discret' })),
      bouton('Supprimer', async () => {
        const ok = await confirmer('Supprimer cette session ?',
          'Les trades et plans rattachés sont conservés mais deviennent « sans check-in ».', { oui: 'Supprimer', danger: true });
        if (!ok) return;
        supprimerSession(store.journal, s.id);
        store.changer();
        notifier('Session supprimée.');
        naviguer('/sessions');
      }, { classe: 'petit danger' })));
  rendreEnTete();
  const zoneTrades = h('div');
  const rendreTrades = () => monter(zoneTrades, blocTradesDeSession(s));
  rendreTrades();
  const apresCheckin = () => { store.changer(); rendreEnTete(); rendreTrades(); };

  conteneur.append(
    enTete,
    h('div', { class: 'pile' },
      h('div', { class: 'grille grille-2' },
        carte('Check-in de début',
          h('div', { class: 'pile' },
            champ('Énergie', segment(s.checkin, 'energie', ENERGIES, { apres: apresCheckin, classe: 'echelle' }),
              { aide: '1 = épuisé · 5 = en pleine forme' }),
            champ('Heures de sommeil', entreeNombre(s.checkin, 'sommeil', { min: 0, max: 24, dec: 1, placeholder: 'ex. 7,5', apres: apresCheckin })),
            champ('Décision du jour', segment(s.checkin, 'decision', DECISIONS, { apres: apresCheckin })),
            s.partie === 'backtest' ? champCampagne(s) : null)),
        carte('Fin de session',
          h('div', { class: 'pile' },
            champ('Ma vision du marché était…', segment(s.fin, 'vision', ISSUES_VISION)),
            champ('Note générale', entreeTexte(s.fin, 'note', { multiligne: true, notes: true, lignes: 4, placeholder: 'Comment s’est passée la session ?' })),
            champ('Énergie de fin (optionnel)', segment(s.fin, 'energie', ENERGIES, { classe: 'echelle' }))))),

      carte('Vision du marché',
        h('div', { class: 'pile' },
          galeriePhotos(s),
          h('div', { class: 'grille grille-2' },
            champ('Biais HTF', segment(s.vision, 'biais', BIAIS)),
            champ('Niveaux de liquidité visés', entreeTexte(s.vision, 'liquidite', { multiligne: true, notes: true, lignes: 2, placeholder: 'ex. PDH 21 450, BSL au-dessus de l’asiatique…' }))),
          h('div', { class: 'grille grille-2' },
            champ('Scénario haussier', entreeTexte(s.vision, 'scenarioHaussier', { multiligne: true, notes: true })),
            champ('Scénario baissier', entreeTexte(s.vision, 'scenarioBaissier', { multiligne: true, notes: true }))))),

      zoneTrades));
}

function champCampagne(s) {
  const campagnes = store.journal.campagnes.filter((c) => c.active || c.id === s.campagneId)
    .map((c) => ({ id: c.id, nom: c.nom || 'Campagne sans nom' }));
  if (!campagnes.length) {
    return h('p', { class: 'discret' }, 'Crée une campagne de backtest (onglet Backtest) pour y rattacher cette session.');
  }
  return champ('Campagne de backtest', selection(s, 'campagneId', campagnes, { vide: 'Aucune' }));
}
