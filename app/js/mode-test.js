// Mode test : version autonome du journal dans un seul fichier HTML, sans le serveur Python.
// Le serveur est simulé dans le navigateur : le journal est gardé dans le stockage du navigateur,
// les images restent en mémoire (perdues à la fermeture de l'onglet). Pour un usage réel, lance
// « Lancer le journal » : les données vont alors dans des fichiers sur le disque.

const CLE = 'nqj-test:journal';
const CLE_ETAT = 'nqj-test:etat';
const images = new Map();
let journal = null;
let etat = {};
let etag = 1;

try { journal = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch { journal = null; }
try { etat = JSON.parse(localStorage.getItem(CLE_ETAT) || '{}'); } catch { etat = {}; }

function persister() {
  try {
    localStorage.setItem(CLE, JSON.stringify(journal));
    localStorage.setItem(CLE_ETAT, JSON.stringify(etat));
  } catch { /* stockage indisponible : le journal reste en mémoire */ }
}

const reponse = (code, corps) => new Response(JSON.stringify(corps), {
  status: code, headers: { 'Content-Type': 'application/json' },
});

const IMAGE_ABSENTE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="100%" height="100%" fill="#29211c"/>'
  + '<text x="50%" y="50%" fill="#b7a99b" font-family="sans-serif" font-size="13" text-anchor="middle">Image non conservée en mode test</text></svg>')}`;

async function formatImage(blob) {
  const t = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (t[0] === 0x89 && t[1] === 0x50) return 'png';
  if (t[0] === 0xff && t[1] === 0xd8) return 'jpg';
  if (t[0] === 0x47 && t[1] === 0x49) return 'gif';
  if (t[8] === 0x57 && t[9] === 0x45) return 'webp';
  return null;
}

const fetchReel = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (url, options = {}) => {
  const chemin = new URL(String(url), 'http://mode-test.local').pathname;
  const methode = (options.method || 'GET').toUpperCase();
  if (chemin === '/api/journal' && methode === 'GET') {
    return reponse(200, { journal, etag: journal ? String(etag) : 'vide', etat, dossierDonnees: 'mode test (navigateur)' });
  }
  if (chemin === '/api/journal' && methode === 'PUT') {
    const corps = JSON.parse(options.body);
    const actuel = journal ? String(etag) : 'vide';
    if (corps.etagBase !== actuel) return reponse(409, { erreur: 'Conflit.', etag: actuel });
    journal = corps.journal;
    etag += 1;
    persister();
    return reponse(200, { etag: String(etag) });
  }
  if (chemin === '/api/images' && methode === 'POST') {
    const blob = options.body instanceof Blob ? options.body : new Blob([options.body]);
    const ext = await formatImage(blob);
    if (!ext) return reponse(400, { erreur: "Format d'image non reconnu (PNG, JPG, GIF ou WEBP attendu)." });
    const nom = `images/test/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
    images.set(nom, URL.createObjectURL(blob));
    return reponse(200, { chemin: nom });
  }
  if (chemin === '/api/images/orphelines') return reponse(200, { deplacees: [], corbeille: null });
  if (chemin.startsWith('/api/import')) {
    return reponse(400, { erreur: "Le réimport d'un export n'est pas disponible en mode test. Lance le vrai journal (« Lancer le journal ») pour l'utiliser." });
  }
  if (fetchReel && !chemin.startsWith('/api/')) return fetchReel(url, options);
  return reponse(404, { erreur: 'Introuvable.' });
};

globalThis.NQJ_TEST = {
  urlImage: (c) => images.get(c) || IMAGE_ABSENTE,
  exporter(j) {
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' }));
    lien.download = `NQ-Journal-test-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(lien);
    lien.click();
    lien.remove();
    etat.derniereExport = new Date().toISOString();
    persister();
  },
};

const bandeau = document.createElement('div');
bandeau.className = 'bandeau-test';
bandeau.textContent = 'MODE TEST — le journal est gardé dans ce navigateur, les images sont perdues à la fermeture de l’onglet. '
  + 'Pour ton vrai journal (fichiers sur le disque, export ZIP), lance « Lancer le journal ».';
document.body.prepend(bandeau);

await import('./main.js');
