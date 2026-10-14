// Paramètres : affichage, risque, règles de discipline, listes fermées, symboles, Prop Firm, sauvegardes.

import { store } from '../store.js';
import {
  h, carte, champ, entreeTexte, entreeNombre, entreeDate, segment, selection, bouton, notifier, confirmer,
} from '../ui.js';
import { nouvelId, VERIFS_AUTO } from '../modele.js';
import { fuseauNavigateur } from '../temps.js';
import { blocSauvegarde } from '../sauvegarde.js';

const FUSEAUX = [
  'Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Luxembourg', 'Europe/London',
  'Africa/Casablanca', 'Africa/Abidjan', 'Africa/Dakar', 'Indian/Reunion', 'America/Martinique',
  'America/Guadeloupe', 'America/Toronto', 'America/New_York', 'UTC',
];

const LISTES = [
  { cle: 'setups', titre: 'Setups', aide: 'Noms de setups utilisés dans les trades, plans et backtests.' },
  { cle: 'zones', titre: "Types de zone d'entrée", aide: 'FVG et OB par défaut. Tu peux en ajouter (Breaker…) sans casser les anciens trades.' },
  { cle: 'timeframes', titre: 'Timeframes', idEgalNom: true },
  { cle: 'killzones', titre: 'Killzones (heure de New York)', killzone: true,
    aide: "Sert à vérifier automatiquement la règle « trade pris dans la killzone » et au découpage horaire des stats." },
  { cle: 'comptes', titre: 'Comptes de trading' },
  { cle: 'raisonsViolation', titre: 'Raisons de règle cassée' },
  { cle: 'raisonsNonPris', titre: 'Raisons de setup / plan non pris' },
  { cle: 'emotions', titre: 'États émotionnels' },
];

function editeurListe(liste, { idEgalNom = false, killzone = false, prefixe = 'el', libelle = 'nom' } = {}) {
  const conteneur = h('div', { class: 'liste-edit' });
  const rendre = () => {
    conteneur.replaceChildren(
      ...liste.map((item) => h('div', { class: ['item', item.archive && 'archive'] },
        entreeTexte(item, libelle, { apres: () => store.changer() }),
        killzone ? h('input', {
          class: 'entree mono court', type: 'time', value: item.debut || '', title: 'Début (heure NY)',
          onchange: (e) => { item.debut = e.target.value; store.changer(); },
        }) : null,
        killzone ? h('input', {
          class: 'entree mono court', type: 'time', value: item.fin || '', title: 'Fin (heure NY)',
          onchange: (e) => { item.fin = e.target.value; store.changer(); },
        }) : null,
        bouton(item.archive ? 'Restaurer' : 'Archiver', () => {
          item.archive = !item.archive;
          store.changer();
          rendre();
        }, { classe: 'petit discret', titre: item.archive ? '' : "Masque l'élément des choix ; les anciens trades le gardent." }))),
      ajout());
  };
  const ajout = () => {
    const entree = h('input', { class: 'entree', placeholder: 'Ajouter…' });
    const valider = () => {
      const nom = entree.value.trim();
      if (!nom) return;
      const id = idEgalNom ? nom.toUpperCase() : nouvelId(prefixe);
      if (liste.some((x) => x.id === id || (x[libelle] || '').toLowerCase() === nom.toLowerCase())) {
        notifier('Cet élément existe déjà (éventuellement archivé).', 'erreur');
        return;
      }
      const item = { id, [libelle]: idEgalNom ? id : nom, archive: false };
      if (killzone) Object.assign(item, { debut: '09:30', fin: '11:00' });
      liste.push(item);
      store.changer();
      rendre();
      conteneur.querySelector('.item:last-of-type input')?.focus();
    };
    entree.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
    return h('div', { class: 'item' }, entree, bouton('Ajouter', valider, { classe: 'petit' }));
  };
  rendre();
  return conteneur;
}

function editeurRegles(regles) {
  const conteneur = h('div', { class: 'liste-edit' });
  const optionsAuto = Object.entries(VERIFS_AUTO).map(([id, nom]) => ({ id, nom }));
  const rendre = () => {
    conteneur.replaceChildren(
      ...regles.map((r) => h('div', { class: ['item', r.archive && 'archive'] },
        entreeTexte(r, 'texte'),
        h('div', { style: { minWidth: '200px', maxWidth: '240px' } },
          selection(r, 'auto', optionsAuto, { vide: 'Vérification manuelle' })),
        bouton(r.archive ? 'Restaurer' : 'Archiver', () => {
          r.archive = !r.archive;
          store.changer();
          rendre();
        }, { classe: 'petit discret' }))),
      h('div', { class: 'item' },
        bouton('+ Ajouter une règle', () => {
          regles.push({ id: nouvelId('r'), texte: 'Nouvelle règle', auto: null, archive: false });
          store.changer();
          rendre();
          const champs = conteneur.querySelectorAll('.item input');
          champs[champs.length - 1]?.select();
        }, { classe: 'petit' })));
  };
  rendre();
  return conteneur;
}

function editeurSymboles(symboles) {
  const conteneur = h('div', { class: 'liste-edit' });
  const rendre = () => {
    conteneur.replaceChildren(
      h('div', { class: 'item discret', style: { fontSize: '12px' } },
        h('span', { style: { flex: 1 } }, 'Symbole cTrader'), h('span', { style: { flex: 1 } }, 'Instrument du journal'), h('span', { style: { width: '70px' } })),
      ...symboles.map((s, i) => h('div', { class: 'item' },
        entreeTexte(s, 'source', { placeholder: 'ex. US100' }),
        entreeTexte(s, 'cible', { placeholder: 'ex. NAS100' }),
        bouton('Retirer', () => { symboles.splice(i, 1); store.changer(); rendre(); }, { classe: 'petit discret' }))),
      h('div', { class: 'item' }, bouton('+ Ajouter', () => {
        symboles.push({ source: '', cible: store.p.instrumentParDefaut });
        store.changer();
        rendre();
      }, { classe: 'petit' })));
  };
  rendre();
  return conteneur;
}

export function rendre(conteneur) {
  const p = store.p;
  const fuseaux = [...new Set([fuseauNavigateur(), ...FUSEAUX, p.fuseauSaisie])].map((f) => ({ id: f, nom: f }));

  conteneur.append(
    h('div', { class: 'titre-vue' }, h('h1', {}, 'Paramètres')),
    h('div', { class: 'pile' },
      carte('Sauvegardes et données', blocSauvegarde(),
        h('hr', { class: 'sections-sep', style: { margin: '14px 0' } }),
        h('div', { class: 'ligne' },
          h('span', { class: 'discret' }, 'Images retirées des fiches mais encore sur le disque :'),
          bouton('Déplacer les images inutilisées vers la corbeille', async () => {
            const ok = await confirmer('Nettoyer les images',
              "Les images qui ne sont plus utilisées par aucune fiche seront déplacées dans donnees/corbeille/ (rien n'est supprimé définitivement).",
              { oui: 'Déplacer' });
            if (!ok) return;
            try {
              const r = await store.deplacerImagesOrphelines();
              notifier(r.deplacees.length ? `${r.deplacees.length} image(s) déplacée(s) dans ${r.corbeille}.` : 'Aucune image inutilisée.', 'succes');
            } catch (e) {
              notifier(e.message, 'erreur');
            }
          }, { classe: 'petit' }))),

      h('div', { class: 'grille grille-2' },
        carte('Affichage et statistiques',
          h('div', { class: 'pile' },
            champ('Niveau des statistiques', segment(p, 'modeStats', [
              { id: 'standard', nom: 'Standard' }, { id: 'expert', nom: 'Expert' }], { vide: false }),
            { aide: "S'applique au réel et au backtest." }),
            champ('Seuil « échantillon trop petit » (trades)', entreeNombre(p, 'seuilEchantillon', { min: 1, dec: 0 })),
            champ('Thème', segment(p, 'theme', [{ id: 'sombre', nom: 'Sombre' }, { id: 'clair', nom: 'Clair' }], {
              vide: false,
              apres: () => store.changer({ rafraichir: true }),
            })),
            champ('Rappel d’export tous les … jours', entreeNombre(p, 'rappelSauvegardeJours', { min: 0, dec: 0 }),
              { aide: '0 = pas de rappel.' }),
            champ('Fuseau horaire de saisie et d’affichage', selection(p, 'fuseauSaisie', fuseaux, { vide: null }),
              { aide: 'Les heures que tu tapes sont dans ce fuseau. Les killzones restent en heure de New York.' }))),

        carte('Risque',
          h('div', { class: 'pile' },
            champ('Instrument par défaut', entreeTexte(p, 'instrumentParDefaut')),
            h('div', { class: 'grille grille-2' },
              champ('Risque fixe par défaut (%)', entreeNombre(p, 'risqueDefautPct', { min: 0 })),
              champ('Risque fixe par défaut ($)', entreeNombre(p, 'risqueDefautUsd', { min: 0 }))),
            champ('Tolérance sur le risque fixe (%)', entreeNombre(p, 'toleranceRisquePct', { min: 0 }),
              { aide: 'Ex. 10 % : un risque de 110 $ pour 100 $ prévus reste « respecté ».' }),
            champ('Limite de pertes du jour (R)', entreeNombre(p, 'limitePertesJourR', { min: 0 }),
              { aide: 'Au-delà, tout nouveau trade du jour casse la règle « limite de pertes ».' })))),

      carte('Règles de discipline',
        h('p', { class: 'discret' },
          "Chaque règle se coche oui/non sur chaque trade. Un trade est conforme seulement si toutes ses règles sont respectées. La vérification automatique propose une réponse, tu confirmes."),
        editeurRegles(p.regles)),

      h('div', { class: 'grille grille-2' },
        ...LISTES.map((l) => carte(l.titre,
          l.aide ? h('p', { class: 'discret' }, l.aide) : null,
          editeurListe(p.listes[l.cle], { idEgalNom: l.idEgalNom, killzone: l.killzone, prefixe: l.cle.slice(0, 4) })))),

      h('div', { class: 'grille grille-2' },
        carte('Challenge Prop Firm (réel)',
          h('div', { class: 'pile' },
            champ('Suivi du challenge', segment(p.propFirm, 'actif', [{ id: true, nom: 'Activé' }, { id: false, nom: 'Désactivé' }], { vide: false })),
            champ('Compte concerné', selection(p.propFirm, 'compteId', p.listes.comptes.filter((c) => !c.archive), { vide: 'Tous les comptes' })),
            h('div', { class: 'grille grille-2' },
              champ('Taille du compte ($)', entreeNombre(p.propFirm, 'tailleCompte', { min: 0 })),
              champ('Date de début', entreeDate(p.propFirm, 'dateDebut')),
              champ('Drawdown max (%)', entreeNombre(p.propFirm, 'drawdownMaxPct', { min: 0 })),
              champ('Objectif de profit (%)', entreeNombre(p.propFirm, 'objectifPct', { min: 0 })),
              champ('Jours de trading minimum', entreeNombre(p.propFirm, 'joursMin', { min: 0, dec: 0 }))))),
        carte('Correspondance des symboles (import cTrader)',
          h('p', { class: 'discret' }, 'La comparaison ignore majuscules et suffixes (.cash, .r…).'),
          editeurSymboles(p.symboles))),
    ),
  );
}
