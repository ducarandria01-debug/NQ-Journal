// Construit un fichier HTML autonome (mode test) : tout le code, les styles et les polices dans un seul fichier.
// Usage : npm install --no-save esbuild && node outils/construire-fichier-test.mjs [sortie.html]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(RACINE, 'app');
const sortie = process.argv[2] || path.join(RACINE, 'dist', 'NQ-Journal-test.html');

const esbuild = await import('esbuild');
const { outputFiles } = await esbuild.build({
  entryPoints: [path.join(APP, 'js', 'mode-test.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});
const code = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const css = readFileSync(path.join(APP, 'styles.css'), 'utf8').replace(/url\('(vendor\/polices\/[^']+\.woff2)'\)/g, (_, fichier) =>
  `url('data:font/woff2;base64,${readFileSync(path.join(APP, fichier)).toString('base64')}')`);

let html = readFileSync(path.join(APP, 'index.html'), 'utf8');
html = html.replace('<title>NQ Journal</title>', '<title>NQ Journal — mode test</title>');
html = html.replace(/<link rel="stylesheet" href="styles.css">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script type="module">\n${code}\n</script>`);
if (html.includes('src="js/main.js"') || html.includes('href="styles.css"')) throw new Error('Remplacement incomplet du HTML.');

mkdirSync(path.dirname(sortie), { recursive: true });
writeFileSync(sortie, html);
console.log(`Fichier de test : ${sortie} (${Math.round(html.length / 1024)} Ko)`);
