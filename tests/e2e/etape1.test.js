import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { demarrer, attendreEnregistrement, lireJournal } from './outils.js';

let env;
before(async () => { env = await demarrer(); });
after(async () => { await env?.arreter(); });

test('premier lancement : le journal est créé, 4 onglets en français', async () => {
  const { page, url } = env;
  await page.goto(url);
  await attendreEnregistrement(page);
  const onglets = await page.locator('.onglets a').allTextContents();
  assert.deepEqual(onglets, ['Dashboard', 'Backtest', 'Trades', 'Check-in de session']);
  const j = await lireJournal(url);
  assert.equal(j.schemaVersion, 1);
  assert.ok(j.parametres.fuseauSaisie);
});

test('navigation entre les onglets', async () => {
  const { page } = env;
  for (const nom of ['backtest', 'trades', 'sessions', 'dashboard']) {
    await page.click(`.onglets a[data-onglet="${nom}"]`);
    await page.locator(`.onglets a.actif[data-onglet="${nom}"]`).waitFor();
    assert.equal(await page.locator('.onglets a.actif').count(), 1);
  }
});

test('le thème clair est mémorisé dans le journal', async () => {
  const { page, url } = env;
  assert.equal(await page.getAttribute('html', 'data-theme'), 'sombre');
  await page.click('#bouton-theme');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'clair');
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).parametres.theme, 'clair');
  await page.reload();
  await attendreEnregistrement(page);
  assert.equal(await page.getAttribute('html', 'data-theme'), 'clair');
  await page.click('#bouton-theme');
  await attendreEnregistrement(page);
});

test('paramètres : modifier une liste et une règle est enregistré', async () => {
  const { page, url } = env;
  await page.click('a[data-onglet="parametres"]');
  await page.getByRole('heading', { name: 'Paramètres' }).waitFor();
  // Mode expert
  await page.getByRole('radio', { name: 'Expert' }).click();
  // Ajout d'un setup
  const carteSetups = page.locator('.carte', { has: page.getByRole('heading', { name: 'Setups', exact: true }) });
  await carteSetups.getByPlaceholder('Ajouter…').fill('Unicorn');
  await carteSetups.getByRole('button', { name: 'Ajouter' }).click();
  // Archiver la zone OB
  const carteZones = page.locator('.carte', { has: page.getByRole('heading', { name: "Types de zone d'entrée" }) });
  await carteZones.locator('.item').nth(1).getByRole('button', { name: 'Archiver' }).click();
  await attendreEnregistrement(page);
  const p = (await lireJournal(url)).parametres;
  assert.equal(p.modeStats, 'expert');
  assert.ok(p.listes.setups.some((s) => s.nom === 'Unicorn'));
  assert.equal(p.listes.zones.find((z) => z.id === 'ob').archive, true);
});

test('rappel de sauvegarde puis export ZIP en un clic', async () => {
  const { page, url } = env;
  // Le rappel n'apparaît que s'il y a des données : on ajoute une session directement.
  const j = await lireJournal(url);
  j.sessions.push({ id: 'ses_test', partie: 'reel', date: '2026-10-14', numero: 1 });
  const etag = (await (await fetch(`${url}/api/journal`)).json()).etag;
  await fetch(`${url}/api/journal`, { method: 'PUT', body: JSON.stringify({ etagBase: etag, journal: j }), headers: { 'Content-Type': 'application/json' } });
  await page.reload();
  await attendreEnregistrement(page);
  const bandeau = page.locator('#bandeau .bandeau');
  await bandeau.waitFor();
  assert.match(await bandeau.textContent(), /jamais exporté/);
  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    bandeau.getByRole('button', { name: 'Exporter maintenant' }).click(),
  ]);
  assert.match(telechargement.suggestedFilename(), /^NQ-Journal-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const chemin = path.join(env.donnees, 'export-test.zip');
  await telechargement.saveAs(chemin);
  assert.ok(existsSync(chemin));
  await page.locator('#bandeau .bandeau').waitFor({ state: 'detached' });
  env.zip = chemin;
});

test('réimport depuis l’export : aperçu puis remplacement', async () => {
  const { page, url } = env;
  // On modifie le journal après l'export…
  await page.click('a[data-onglet="parametres"]');
  await page.locator('.champ', { hasText: 'Seuil' }).locator('input').fill('99');
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).parametres.seuilEchantillon, 99);
  // …puis on réimporte l'export : le seuil revient à 30.
  const [selecteur] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Réimporter un export…' }).click(),
  ]);
  await selecteur.setFiles(env.zip);
  const modale = page.locator('.modale');
  await modale.waitFor();
  assert.match(await modale.textContent(), /1 sessions/);
  await modale.getByRole('button', { name: 'Remplacer mon journal' }).click();
  await page.locator('.notification.succes', { hasText: 'Import terminé' }).waitFor();
  const j = await lireJournal(url);
  assert.equal(j.parametres.seuilEchantillon, 30);
  assert.equal(await page.locator('.champ', { hasText: 'Seuil' }).locator('input').inputValue(), '30');
  assert.ok(readFileSync(path.join(env.donnees, 'etat.json'), 'utf8').includes('derniereExport'));
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
