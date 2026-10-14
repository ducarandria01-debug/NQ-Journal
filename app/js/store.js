// Chargement / enregistrement du journal via le serveur local.
// Chaque modification est enregistrée automatiquement sur le disque (avec un court délai).

import { journalVide, migrer } from './modele.js';
import { fuseauNavigateur } from './temps.js';

const DELAI_ENREGISTREMENT = 500;

class Store {
  constructor() {
    this.journal = null;
    this.etag = null;
    this.etat = {};
    this.dossierDonnees = '';
    this.statut = 'charge'; // charge | modifie | enregistrement | enregistre | erreur | conflit
    this.erreur = null;
    this.minuteur = null;
    this.enCours = null;
    this.ecouteursStatut = new Set();
    this.ecouteursDonnees = new Set();
  }

  get p() {
    return this.journal.parametres;
  }

  async charger() {
    const r = await fetch('/api/journal', { cache: 'no-store' });
    if (!r.ok) throw new Error(`Lecture du journal impossible (${r.status}).`);
    const { journal, etag, etat, dossierDonnees } = await r.json();
    this.etag = etag;
    this.etat = etat || {};
    this.dossierDonnees = dossierDonnees;
    if (journal) {
      this.journal = migrer(journal, fuseauNavigateur());
    } else {
      this.journal = journalVide(fuseauNavigateur());
      await this.enregistrerMaintenant();
    }
    this.statut = 'enregistre';
    this.notifierStatut();
  }

  /** À appeler après toute modification de `journal` : enregistre bientôt sur le disque. */
  changer({ rafraichir = false } = {}) {
    this.statut = 'modifie';
    this.notifierStatut();
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.enregistrerMaintenant(), DELAI_ENREGISTREMENT);
    if (rafraichir) this.notifierDonnees();
  }

  async enregistrerMaintenant({ forcer = false } = {}) {
    clearTimeout(this.minuteur);
    if (this.enCours) {
      await this.enCours.catch(() => {});
    }
    if (this.statut === 'conflit' && !forcer) return;
    this.enCours = this._enregistrer(forcer);
    try {
      await this.enCours;
    } finally {
      this.enCours = null;
    }
  }

  async _enregistrer(forcer) {
    this.statut = 'enregistrement';
    this.notifierStatut();
    try {
      if (forcer) {
        const r = await fetch('/api/journal', { cache: 'no-store' });
        this.etag = (await r.json()).etag;
      }
      const r = await fetch('/api/journal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etagBase: this.etag, journal: this.journal }),
      });
      const corps = await r.json();
      if (r.status === 409) {
        this.statut = 'conflit';
        this.erreur = corps.erreur;
      } else if (!r.ok) {
        throw new Error(corps.erreur || `Erreur ${r.status}`);
      } else {
        this.etag = corps.etag;
        this.statut = 'enregistre';
        this.erreur = null;
      }
    } catch (e) {
      this.statut = 'erreur';
      this.erreur = e.message.includes('fetch')
        ? 'Le serveur du journal ne répond plus. Relance-le puis recharge la page.'
        : e.message;
      // Nouvel essai plus tard : les données restent en mémoire.
      clearTimeout(this.minuteur);
      this.minuteur = setTimeout(() => this.enregistrerMaintenant(), 5000);
    }
    this.notifierStatut();
  }

  get aDesModificationsEnAttente() {
    return ['modifie', 'enregistrement', 'erreur', 'conflit'].includes(this.statut);
  }

  async televerserImage(fichier) {
    const r = await fetch('/api/images', { method: 'POST', body: fichier });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || "Impossible d'enregistrer l'image.");
    return corps.chemin;
  }

  async analyserImport(fichier) {
    const r = await fetch('/api/import/analyse', { method: 'POST', body: fichier });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || 'Import impossible.');
    return corps;
  }

  async appliquerImport(jeton) {
    await this.enregistrerMaintenant();
    const r = await fetch('/api/import/appliquer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jeton }),
    });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || 'Import impossible.');
    await this.charger();
    this.notifierDonnees();
    return corps;
  }

  async rafraichirEtat() {
    const r = await fetch('/api/journal', { cache: 'no-store' });
    const corps = await r.json();
    this.etat = corps.etat || {};
    this.notifierStatut();
  }

  async deplacerImagesOrphelines() {
    await this.enregistrerMaintenant();
    const r = await fetch('/api/images/orphelines', { method: 'POST' });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || 'Nettoyage impossible.');
    return corps;
  }

  surStatut(fn) {
    this.ecouteursStatut.add(fn);
    return () => this.ecouteursStatut.delete(fn);
  }

  surDonnees(fn) {
    this.ecouteursDonnees.add(fn);
    return () => this.ecouteursDonnees.delete(fn);
  }

  notifierStatut() {
    for (const fn of this.ecouteursStatut) fn(this.statut);
  }

  notifierDonnees() {
    for (const fn of this.ecouteursDonnees) fn();
  }
}

export const store = new Store();

// En mode test (fichier HTML autonome), les images vivent en mémoire : le mode test fournit leur adresse.
export const urlImage = (chemin) => {
  if (!chemin) return '';
  return globalThis.NQJ_TEST ? globalThis.NQJ_TEST.urlImage(chemin) : `/donnees/${chemin}`;
};
