// Lecture minimale d'un fichier Excel (.xlsx) sans bibliothèque externe :
// décompression ZIP (DecompressionStream) + lecture du XML de la première feuille.
// Retourne un tableau de lignes (tableaux de valeurs : chaînes ou nombres).

function u16(v, o) { return v.getUint16(o, true); }
function u32(v, o) { return v.getUint32(o, true); }

/** Liste les fichiers d'une archive ZIP : { nom → { methode, taille, debut, tailleCompressee } }. */
function lireRepertoireZip(octets) {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65558); i--) {
    if (u32(v, i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("Ce fichier n'est pas un Excel valide (.xlsx).");
  const nb = u16(v, fin + 10);
  let p = u32(v, fin + 16);
  const fichiers = {};
  const decodeur = new TextDecoder();
  for (let i = 0; i < nb; i++) {
    if (u32(v, p) !== 0x02014b50) break;
    const methode = u16(v, p + 10);
    const tailleCompressee = u32(v, p + 20);
    const lgNom = u16(v, p + 28);
    const lgExtra = u16(v, p + 30);
    const lgCommentaire = u16(v, p + 32);
    const local = u32(v, p + 42);
    const nom = decodeur.decode(octets.subarray(p + 46, p + 46 + lgNom));
    const debut = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    fichiers[nom] = { methode, debut, tailleCompressee };
    p += 46 + lgNom + lgExtra + lgCommentaire;
  }
  return fichiers;
}

async function extraire(octets, entree) {
  const donnees = octets.subarray(entree.debut, entree.debut + entree.tailleCompressee);
  if (entree.methode === 0) return new TextDecoder().decode(donnees);
  if (entree.methode !== 8) throw new Error('Compression Excel non prise en charge.');
  const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flux).text();
}

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decoderXml(texte) {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITES[e] ?? m;
  });
}

/** Texte d'un élément pouvant contenir plusieurs <t> (texte enrichi). */
function texteDe(xml) {
  let t = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += m[1];
  return decoderXml(t);
}

function indexColonne(ref) {
  const lettres = ref.replace(/\d+/g, '');
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function lireXlsx(tampon) {
  const octets = tampon instanceof Uint8Array ? tampon : new Uint8Array(tampon);
  const fichiers = lireRepertoireZip(octets);
  const chaines = [];
  if (fichiers['xl/sharedStrings.xml']) {
    const xml = await extraire(octets, fichiers['xl/sharedStrings.xml']);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) chaines.push(texteDe(m[1]));
  }
  // Première feuille : celle du classeur, sinon sheet1.xml
  let cheminFeuille = 'xl/worksheets/sheet1.xml';
  if (fichiers['xl/workbook.xml'] && fichiers['xl/_rels/workbook.xml.rels']) {
    const classeur = await extraire(octets, fichiers['xl/workbook.xml']);
    const rels = await extraire(octets, fichiers['xl/_rels/workbook.xml.rels']);
    const rid = classeur.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
    const cible = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
      || rid && rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    if (cible) cheminFeuille = cible.startsWith('/') ? cible.slice(1) : `xl/${cible.replace(/^\.\//, '')}`;
  }
  if (!fichiers[cheminFeuille]) {
    cheminFeuille = Object.keys(fichiers).find((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  }
  if (!cheminFeuille) throw new Error('Aucune feuille trouvée dans ce fichier Excel.');
  const feuille = await extraire(octets, fichiers[cheminFeuille]);

  const lignes = [];
  for (const mLigne of feuille.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const ligne = [];
    for (const mCell of mLigne[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mCell[1];
      const contenu = mCell[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1] || 'n';
      const brut = contenu.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valeur = '';
      if (type === 's') valeur = chaines[Number(brut)] ?? '';
      else if (type === 'inlineStr') valeur = texteDe(contenu);
      else if (type === 'str' || type === 'e') valeur = decoderXml(brut ?? '');
      else if (type === 'b') valeur = brut === '1';
      else if (brut != null && brut !== '') valeur = Number(brut);
      const i = ref ? indexColonne(ref) : ligne.length;
      while (ligne.length < i) ligne.push('');
      ligne[i] = valeur;
    }
    lignes.push(ligne);
  }
  return lignes;
}
