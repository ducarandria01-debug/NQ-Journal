import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, attendreEnregistrement, lireJournal, ecrireJournal } from './outils.js';
import { journalDemo } from './donnees-demo.js';

let env;
before(async () => {
  env = await demarrer();
  await ecrireJournal(env.url, journalDemo());
});
after(async () => { await env?.arreter(); });

const tuile = (page, libelle) => page.locator('.stat', { has: page.locator('.stat-libelle', { hasText: new RegExp(`^${libelle}$`) }) }).locator('.stat-valeur');
const txt = async (loc) => (await loc.textContent()).replace(/[  ]/g, ' ').trim();

test('mode Standard : tuiles en R, avertissement échantillon, courbe, FVG vs OB, Prop Firm', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/dashboard`);
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  // 12 trades réels : 2, -1, 2.5, -1, -1, 3, -1, 2, -0.5, 1.8, -1, 2.2 → total 8 R
  assert.equal(await txt(tuile(page, 'Trades')), '12');
  assert.equal(await txt(tuile(page, 'Résultat')), '+8,0 R');
  assert.equal(await txt(tuile(page, 'Winrate')), '50,0 %');
  assert.equal(await txt(tuile(page, 'Expectancy')), '+0,67 R');
  assert.equal(await txt(tuile(page, 'Discipline')), '75 %');
  assert.match(await txt(page.locator('.avertissement').first()), /Échantillon trop petit : 12 trades \(seuil 30\)/);
  assert.ok(await page.locator('.svg-courbe .trace').isVisible());
  const zones = page.locator('.carte', { has: page.getByRole('heading', { name: 'FVG vs OB' }) });
  assert.deepEqual(await zones.locator('tbody td:first-child').allTextContents(), ['FVG', 'OB']);
  const prop = page.locator('.carte', { has: page.getByRole('heading', { name: 'Challenge Prop Firm' }) });
  assert.match(await txt(prop), /\+8 000 \$ \/ 10 000 \$/);
  assert.match(await txt(prop), /12 \/ 4/);
  assert.equal(await page.getByRole('heading', { name: 'Analyse expert' }).count(), 0);
});

test('survol de la courbe : réticule et bulle', async () => {
  const { page } = env;
  const cible = page.locator('.graphique-cible');
  const box = await cible.boundingBox();
  await page.mouse.move(box.x + box.width * 0.99, box.y + box.height / 2);
  const bulle = page.locator('.bulle');
  await bulle.waitFor();
  assert.match(await txt(bulle), /\+8,00 R.*Trade n° 12/);
});

test('mode Expert : découpages, checklist, discipline, énergie, backtest vs réel', async () => {
  const { page, url } = env;
  await page.locator('.barre-filtres').getByRole('radio', { name: 'Expert' }).click();
  await page.getByRole('heading', { name: 'Analyse expert' }).waitFor();
  for (const titre of ['Session (killzone)', 'Tranche horaire (heure NY)', 'Timeframe de la zone', 'Biais HTF', 'Qualité',
    'Jour de la semaine', 'Long vs short', 'Checklist : ce qui manque dans les pertes', "Discipline selon l'énergie du check-in",
    'Backtest vs réel, par setup', 'Discipline : conformes vs non conformes']) {
    assert.ok(await page.getByRole('heading', { name: titre, exact: true }).isVisible(), titre);
  }
  assert.equal(await txt(tuile(page, 'Profit factor')), '2,45');
  const checklist = page.locator('.carte', { has: page.getByRole('heading', { name: 'Checklist : ce qui manque dans les pertes' }) });
  assert.match(await txt(checklist.locator('tbody tr').first()), /^Sweep.*le plus fréquent.*100 %/);
  const raisons = page.locator('.carte', { has: page.getByRole('heading', { name: 'Discipline : conformes vs non conformes' }) });
  assert.match(await txt(raisons), /FOMO/);
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).parametres.modeStats, 'expert', 'réglage global enregistré');
});

test('backtest : trade « futur vu » exclu, filtres', async () => {
  const { page } = env;
  await page.locator('.barre-filtres').getByRole('radio', { name: 'Backtest' }).click();
  await page.getByText('1 trade(s) « futur vu » exclu(s)').waitFor();
  assert.equal(await txt(tuile(page, 'Trades')), '7');
  assert.equal(await page.getByRole('heading', { name: 'Challenge Prop Firm' }).count(), 0, 'Prop Firm côté réel seulement');
  await page.locator('.barre-filtres select').first().selectOption('30j');
  assert.equal(await txt(tuile(page, 'Trades')), '0', 'les trades de backtest datent de 2024');
  await page.locator('.barre-filtres select').first().selectOption('tout');
});

test('mode clair : la page se rend sans erreur', async () => {
  const { page } = env;
  await page.click('#bouton-theme');
  await page.locator('html[data-theme="clair"]').waitFor();
  await page.click('#bouton-theme');
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
