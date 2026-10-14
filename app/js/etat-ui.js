// Préférences d'affichage propres à ce navigateur (onglet choisi, filtres…).
// Simple confort : si le stockage du navigateur est indisponible, on garde les valeurs en mémoire.

const memoire = {};

export function lirePref(cle, defaut) {
  try {
    const v = localStorage.getItem(`nqj:${cle}`);
    if (v != null) return JSON.parse(v);
  } catch { /* stockage indisponible */ }
  return cle in memoire ? memoire[cle] : defaut;
}

export function ecrirePref(cle, valeur) {
  memoire[cle] = valeur;
  try { localStorage.setItem(`nqj:${cle}`, JSON.stringify(valeur)); } catch { /* stockage indisponible */ }
}
