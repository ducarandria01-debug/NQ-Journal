// Navigation par l'URL (#/onglet/...). main.js écoute « hashchange » et affiche la vue.

export function naviguer(chemin) {
  if (location.hash === `#${chemin}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = chemin;
}
