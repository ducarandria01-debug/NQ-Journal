// Petits outils d'interface : création d'éléments, champs liés aux données, images, modales.

import { store, urlImage } from './store.js';
import { lireNombre, fmtNombre } from './format.js';

export function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [cle, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (cle === 'class') el.className = Array.isArray(val) ? val.filter(Boolean).join(' ') : val;
    else if (cle === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (cle === 'dataset') Object.assign(el.dataset, val);
    else if (cle.startsWith('on') && typeof val === 'function') el.addEventListener(cle.slice(2), val);
    else if (cle === 'html') el.innerHTML = val;
    else if (val === true) el.setAttribute(cle, '');
    else if (cle in el && !cle.includes('-') && cle !== 'list') el[cle] = val;
    else el.setAttribute(cle, val);
  }
  ajouter(el, enfants);
  return el;
}

function ajouter(el, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e == null || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

export function monter(conteneur, ...enfants) {
  conteneur.replaceChildren();
  ajouter(conteneur, enfants);
  return conteneur;
}

const parDefaut = () => store.changer();

/** Bloc libellé + contrôle. */
export function champ(libelle, controle, { aide, classe } = {}) {
  // <label> seulement autour d'un champ unique : autour d'un groupe de boutons, il brouillerait leurs noms.
  const unique = controle instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(controle.tagName);
  return h(unique ? 'label' : 'div', { class: ['champ', classe], role: unique ? null : 'group' },
    h('span', { class: 'champ-libelle' }, libelle),
    controle,
    aide ? h('span', { class: 'champ-aide' }, aide) : null);
}

export function entreeTexte(obj, cle, { placeholder = '', multiligne = false, notes = false, lignes = 3, apres = parDefaut, lectureSeule = false } = {}) {
  const el = h(multiligne ? 'textarea' : 'input', {
    class: ['entree', notes && 'police-notes'],
    placeholder,
    rows: multiligne ? lignes : null,
    type: multiligne ? null : 'text',
    readOnly: lectureSeule,
  });
  el.value = obj[cle] ?? '';
  el.addEventListener('input', () => { obj[cle] = el.value; apres(obj[cle]); });
  return el;
}

export function entreeNombre(obj, cle, { placeholder = '', apres = parDefaut, min = null, max = null, dec = 5, lectureSeule = false } = {}) {
  const el = h('input', { class: 'entree mono', type: 'text', inputMode: 'decimal', placeholder, readOnly: lectureSeule });
  el.value = obj[cle] == null ? '' : fmtNombre(obj[cle], dec).replace(/[  ]/g, '');
  el.addEventListener('input', () => {
    let n = lireNombre(el.value);
    const invalide = el.value.trim() !== '' && n == null;
    el.classList.toggle('invalide', invalide);
    if (invalide) return;
    if (n != null && min != null && n < min) n = min;
    if (n != null && max != null && n > max) n = max;
    obj[cle] = n;
    apres(n);
  });
  return el;
}

export function entreeDate(obj, cle, { apres = parDefaut } = {}) {
  const el = h('input', { class: 'entree mono', type: 'date', value: obj[cle] || '' });
  el.addEventListener('change', () => { obj[cle] = el.value || null; apres(obj[cle]); });
  return el;
}

export function entreeHeure(obj, cle, { apres = parDefaut } = {}) {
  const el = h('input', { class: 'entree mono', type: 'time', value: obj[cle] || '' });
  el.addEventListener('change', () => { obj[cle] = el.value || null; apres(obj[cle]); });
  return el;
}

/** Boutons à choix unique. Recliquer sur le choix actif le désélectionne (si `vide`). */
export function segment(obj, cle, options, { apres = parDefaut, vide = true, classe = '', desactive = false } = {}) {
  const groupe = h('div', { class: ['segment', classe], role: 'radiogroup' });
  const rendre = () => {
    monter(groupe, options.map((o) => h('button', {
      type: 'button',
      class: ['seg', obj[cle] === o.id && 'actif', o.classe],
      role: 'radio',
      'aria-checked': String(obj[cle] === o.id),
      disabled: desactive,
      title: o.titre || null,
      onclick: () => {
        obj[cle] = obj[cle] === o.id && vide ? null : o.id;
        rendre();
        apres(obj[cle]);
      },
    }, o.nom)));
  };
  rendre();
  return groupe;
}

/** Oui / Non (et vide). */
export function ouiNon(obj, cle, opts = {}) {
  return segment(obj, cle, [
    { id: true, nom: 'Oui', classe: 'oui' },
    { id: false, nom: 'Non', classe: 'non' },
  ], { classe: 'oui-non', ...opts });
}

export function selection(obj, cle, options, { apres = parDefaut, vide = '—' } = {}) {
  const el = h('select', { class: 'entree' },
    vide != null ? h('option', { value: '' }, vide) : null,
    options.map((o) => h('option', { value: o.id }, o.nom)));
  el.value = obj[cle] ?? '';
  el.addEventListener('change', () => { obj[cle] = el.value || null; apres(obj[cle]); });
  return el;
}

export function bouton(texte, action, { classe = '', titre = null, type = 'button', desactive = false } = {}) {
  return h('button', { type, class: ['btn', classe], title: titre, onclick: action, disabled: desactive }, texte);
}

// --- Images ---

function premierFichierImage(liste) {
  for (const f of liste || []) {
    if (f.type?.startsWith('image/')) return f;
    if (f.kind === 'file' && f.type?.startsWith('image/')) return f.getAsFile();
  }
  return null;
}

/**
 * Emplacement d'image : cliquer pour choisir, glisser-déposer, ou coller (Ctrl+V) au survol.
 * `surChangement(chemin | null)` est appelé après l'enregistrement du fichier sur le disque.
 */
export function zoneImage(chemin, surChangement, { libelle = 'Image', compacte = false } = {}) {
  const zone = h('div', { class: ['zone-image', compacte && 'compacte'], tabIndex: 0 });
  const entree = h('input', { type: 'file', accept: 'image/*', hidden: true });

  const envoyer = async (fichier) => {
    if (!fichier) return;
    zone.classList.add('envoi');
    try {
      const nouveau = await store.televerserImage(fichier);
      chemin = nouveau;
      surChangement(nouveau);
      rendre();
    } catch (e) {
      notifier(e.message, 'erreur');
    } finally {
      zone.classList.remove('envoi');
    }
  };

  const rendre = () => {
    if (chemin) {
      monter(zone,
        h('img', { src: urlImage(chemin), alt: libelle, onclick: () => visionneuse(chemin) }),
        h('div', { class: 'zone-image-barre' },
          h('span', {}, libelle),
          h('button', { type: 'button', class: 'btn-icone', title: "Retirer l'image", onclick: (e) => {
            e.stopPropagation();
            chemin = null;
            surChangement(null);
            rendre();
          } }, '✕')),
        entree);
    } else {
      monter(zone,
        h('div', { class: 'zone-image-vide', onclick: () => entree.click() },
          h('span', { class: 'zone-image-titre' }, libelle),
          h('span', { class: 'zone-image-aide' }, compacte ? '+ image' : 'Cliquer, glisser ou coller (Ctrl+V)')),
        entree);
    }
  };

  entree.addEventListener('change', () => envoyer(entree.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('survol'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('survol');
    envoyer(premierFichierImage(e.dataTransfer.files));
  });
  zone.addEventListener('paste', (e) => envoyer(premierFichierImage(e.clipboardData.items)));
  zone.addEventListener('mouseenter', () => zone.focus({ preventScroll: true }));
  rendre();
  return zone;
}

export function visionneuse(chemin) {
  const fond = h('div', { class: 'visionneuse', onclick: () => fond.remove() },
    h('img', { src: urlImage(chemin), alt: '' }));
  const echap = (e) => { if (e.key === 'Escape') { fond.remove(); document.removeEventListener('keydown', echap); } };
  document.addEventListener('keydown', echap);
  document.body.append(fond);
}

// --- Modales et notifications ---

/** Ouvre une modale. `actions` : [{ texte, valeur, classe }]. Résout avec la valeur choisie (null si fermée). */
export function modale({ titre, contenu, actions = [{ texte: 'Fermer', valeur: null }], large = false }) {
  return new Promise((resoudre) => {
    const fermer = (valeur) => {
      fond.remove();
      document.removeEventListener('keydown', echap);
      resoudre(valeur);
    };
    const echap = (e) => { if (e.key === 'Escape') fermer(null); };
    const fond = h('div', { class: 'modale-fond', onmousedown: (e) => { if (e.target === fond) fermer(null); } },
      h('div', { class: ['modale', large && 'large'], role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, titre),
        h('div', { class: 'modale-contenu' }, contenu),
        h('div', { class: 'modale-actions' },
          actions.map((a) => bouton(a.texte, () => fermer(typeof a.valeur === 'function' ? a.valeur() : a.valeur),
            { classe: a.classe || '' })))));
    document.addEventListener('keydown', echap);
    document.body.append(fond);
    fond.querySelector('.modale-actions .principal, .modale-actions .btn:last-child')?.focus();
  });
}

export function confirmer(titre, message, { oui = 'Confirmer', danger = false } = {}) {
  return modale({
    titre,
    contenu: h('p', {}, message),
    actions: [
      { texte: 'Annuler', valeur: false },
      { texte: oui, valeur: true, classe: danger ? 'danger' : 'principal' },
    ],
  });
}

export function notifier(message, type = 'info') {
  let pile = document.querySelector('.notifications');
  if (!pile) {
    pile = h('div', { class: 'notifications', 'aria-live': 'polite' });
    document.body.append(pile);
  }
  const n = h('div', { class: ['notification', type] }, message);
  pile.append(n);
  setTimeout(() => n.remove(), type === 'erreur' ? 7000 : 3500);
}

/** Carte titrée. */
export function carte(titre, ...contenu) {
  return h('section', { class: 'carte' }, titre ? h('h3', { class: 'carte-titre' }, titre) : null, ...contenu);
}

export function vide(texte, ...actions) {
  return h('div', { class: 'vide' }, h('p', {}, texte), actions.length ? h('div', { class: 'actions' }, actions) : null);
}
