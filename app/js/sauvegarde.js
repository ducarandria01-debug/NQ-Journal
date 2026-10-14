// Export ZIP et réimport.

import { store } from './store.js';
import { h, modale, notifier, bouton } from './ui.js';
import { dateLongue } from './temps.js';

export async function lancerExport() {
  await store.enregistrerMaintenant();
  const lien = h('a', { href: '/api/export', download: '' });
  document.body.append(lien);
  lien.click();
  lien.remove();
  notifier("Export en cours de téléchargement. Range le ZIP en lieu sûr (clé USB, autre disque…).", 'succes');
  // L'heure du dernier export est mise à jour côté serveur ; rafraichirEtat met le bandeau à jour.
  setTimeout(() => store.rafraichirEtat(), 1500);
}

const NOMS_COMPTEURS = {
  sessions: 'sessions', trades: 'trades', plans: 'plans de trade', campagnes: 'campagnes de backtest',
  setupsNonPris: 'setups non pris', revues: 'revues hebdo',
};

export function choisirEtImporter() {
  const entree = h('input', { type: 'file', accept: '.zip,application/zip' });
  entree.addEventListener('change', async () => {
    const fichier = entree.files[0];
    if (!fichier) return;
    let analyse;
    try {
      analyse = await store.analyserImport(fichier);
    } catch (e) {
      await modale({ titre: 'Import impossible', contenu: h('p', {}, e.message) });
      return;
    }
    const { apercu, jeton } = analyse;
    const lignes = Object.entries(apercu.compteurs)
      .filter(([cle]) => NOMS_COMPTEURS[cle])
      .map(([cle, n]) => h('li', {}, h('span', { class: 'mono' }, n), ` ${NOMS_COMPTEURS[cle]}`));
    const ok = await modale({
      titre: 'Réimporter cet export ?',
      contenu: [
        h('p', {}, apercu.exporteLe
          ? `Export du ${dateLongue(apercu.exporteLe.slice(0, 10))}, contenant :`
          : 'Cet export contient :'),
        h('ul', {}, lignes, h('li', {}, h('span', { class: 'mono' }, apercu.nbImages), ' images')),
        apercu.imagesManquantes.length
          ? h('div', { class: 'avertissement' }, `${apercu.imagesManquantes.length} image(s) référencée(s) absente(s) du ZIP.`)
          : null,
        h('div', { class: 'avertissement' },
          'Le journal actuel sera entièrement remplacé. Une sauvegarde complète de ton journal actuel est faite avant, dans donnees/sauvegardes/.'),
      ],
      actions: [
        { texte: 'Annuler', valeur: false },
        { texte: 'Remplacer mon journal', valeur: true, classe: 'danger' },
      ],
    });
    if (!ok) return;
    try {
      const r = await store.appliquerImport(jeton);
      notifier(`Import terminé. Ancien journal sauvegardé dans ${r.sauvegarde}.`, 'succes');
    } catch (e) {
      await modale({ titre: 'Import impossible', contenu: h('p', {}, e.message) });
    }
  });
  entree.click();
}

export function blocSauvegarde() {
  const derniere = store.etat.derniereExport;
  return h('div', { class: 'pile' },
    h('p', {}, derniere
      ? ['Dernier export : ', h('span', { class: 'mono' }, new Date(derniere).toLocaleString('fr-FR'))]
      : "Aucun export pour l'instant."),
    h('p', { class: 'discret' },
      `Tes données sont dans : ${store.dossierDonnees}. Une copie automatique de journal.json est faite chaque jour dans le sous-dossier sauvegardes/ (30 derniers jours).`),
    h('div', { class: 'ligne' },
      bouton('Exporter tout (ZIP)', () => lancerExport(), { classe: 'principal' }),
      bouton('Réimporter un export…', () => choisirEtImporter())));
}
