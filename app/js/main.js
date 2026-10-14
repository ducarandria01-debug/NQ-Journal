// Point d'entrée : chargement, navigation par onglets, thème, bandeaux.

import { store } from './store.js';
import { h, monter, bouton, notifier } from './ui.js';
import { lancerExport } from './sauvegarde.js';
import * as parametres from './vues/parametres.js';
import * as dashboard from './vues/dashboard.js';
import * as backtest from './vues/backtest.js';
import * as trades from './vues/trades.js';
import * as sessions from './vues/sessions.js';

const VUES = { dashboard, backtest, trades, sessions, parametres };
const conteneur = document.getElementById('vue');

function routeCourante() {
  const segments = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const nom = VUES[segments[0]] ? segments[0] : 'dashboard';
  return { nom, segments: segments.slice(1) };
}

let nettoyageVue = null;

export function afficher() {
  const { nom, segments } = routeCourante();
  for (const a of document.querySelectorAll('[data-onglet]')) {
    a.classList.toggle('actif', a.dataset.onglet === nom);
  }
  if (typeof nettoyageVue === 'function') nettoyageVue();
  nettoyageVue = null;
  conteneur.replaceChildren();
  try {
    nettoyageVue = VUES[nom].rendre(conteneur, segments) || null;
  } catch (e) {
    console.error(e);
    monter(conteneur, h('div', { class: 'bandeau erreur' }, `Erreur d'affichage : ${e.message}`));
  }
  afficherBandeau();
}

// --- Thème ---
function appliquerTheme() {
  const clair = store.p.theme === 'clair';
  document.documentElement.dataset.theme = clair ? 'clair' : 'sombre';
  const b = document.getElementById('bouton-theme');
  b.textContent = clair ? '☾' : '☀';
  b.title = clair ? 'Passer en mode sombre' : 'Passer en mode clair';
}

document.getElementById('bouton-theme').addEventListener('click', () => {
  store.p.theme = store.p.theme === 'clair' ? 'sombre' : 'clair';
  appliquerTheme();
  store.changer();
});

// --- Statut d'enregistrement ---
const TEXTES_STATUT = {
  modifie: 'Modifications…',
  enregistrement: 'Enregistrement…',
  enregistre: 'Enregistré',
  erreur: 'Non enregistré',
  conflit: 'Conflit',
};

function afficherStatut(statut) {
  const el = document.getElementById('statut');
  el.textContent = TEXTES_STATUT[statut] || '';
  el.className = `statut-enregistrement ${statut}`;
  afficherBandeau();
}

// --- Bandeaux (erreur, conflit, rappel de sauvegarde) ---
let rappelMasque = false;
try { rappelMasque = sessionStorage.getItem('rappel-masque') === '1'; } catch { /* stockage indisponible */ }

function joursDepuis(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}

function journalContientDesDonnees() {
  const j = store.journal;
  return j.sessions.length + j.trades.length + j.plans.length + j.campagnes.length > 0;
}

export function afficherBandeau() {
  const zone = document.getElementById('bandeau');
  if (!store.journal) return;
  if (store.statut === 'conflit') {
    monter(zone, h('div', { class: 'bandeau erreur' },
      h('span', {}, 'Le journal a été modifié ailleurs (un autre onglet est peut-être ouvert). '),
      bouton('Recharger depuis le disque', () => location.reload(), { classe: 'petit' }),
      bouton('Garder ma version', () => store.enregistrerMaintenant({ forcer: true }), { classe: 'petit danger' })));
    return;
  }
  if (store.statut === 'erreur') {
    monter(zone, h('div', { class: 'bandeau erreur' }, store.erreur || "Erreur d'enregistrement."));
    return;
  }
  const delai = store.p.rappelSauvegardeJours;
  const jours = joursDepuis(store.etat.derniereExport);
  const enRetard = delai > 0 && journalContientDesDonnees() && (jours == null || jours >= delai);
  if (enRetard && !rappelMasque) {
    monter(zone, h('div', { class: 'bandeau' },
      h('span', {}, jours == null
        ? "Tu n'as encore jamais exporté ton journal."
        : `Dernier export il y a ${jours} jour${jours > 1 ? 's' : ''}.`),
      h('span', { class: 'discret' }, 'Copie le ZIP sur une clé USB ou un autre disque.'),
      bouton('Exporter maintenant', () => lancerExport(), { classe: 'petit principal' }),
      bouton('Plus tard', () => {
        rappelMasque = true;
        try { sessionStorage.setItem('rappel-masque', '1'); } catch { /* stockage indisponible */ }
        afficherBandeau();
      }, { classe: 'petit discret' })));
    return;
  }
  zone.replaceChildren();
}

window.addEventListener('beforeunload', (e) => {
  if (store.aDesModificationsEnAttente) {
    store.enregistrerMaintenant();
    e.preventDefault();
    e.returnValue = '';
  }
});

window.addEventListener('hashchange', afficher);
store.surStatut(afficherStatut);

// Raccourci : Ctrl+S force l'enregistrement immédiat.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    store.enregistrerMaintenant().then(() => notifier('Journal enregistré.', 'succes'));
  }
});

(async function demarrer() {
  try {
    await store.charger();
  } catch (e) {
    monter(conteneur, h('div', { class: 'carte' },
      h('h2', {}, 'Impossible de charger le journal'),
      h('p', {}, e.message),
      h('p', { class: 'discret' }, 'Vérifie que le programme du journal est bien lancé (fenêtre de commande ouverte), puis recharge la page.')));
    return;
  }
  appliquerTheme();
  store.surDonnees(() => { appliquerTheme(); afficher(); });
  afficher();
})();
