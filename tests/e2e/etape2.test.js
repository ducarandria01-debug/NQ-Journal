import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { demarrer, attendreEnregistrement, lireJournal, PNG_1PX } from './outils.js';

let env;
before(async () => { env = await demarrer(); });
after(async () => { await env?.arreter(); });

test('check-in du jour : énergie, sommeil, décision', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/sessions`);
  await page.getByRole('button', { name: 'Faire le check-in du jour' }).click();
  await page.getByRole('heading', { name: /session 1/ }).waitFor();
  assert.ok(await page.locator('.tag.alerte', { hasText: 'Check-in à faire' }).isVisible());
  const debut = page.locator('.carte', { has: page.getByRole('heading', { name: 'Check-in de début' }) });
  await debut.getByRole('radio', { name: '4', exact: true }).click();
  await debut.locator('.champ', { hasText: 'Heures de sommeil' }).locator('input').fill('7,5');
  await debut.getByRole('radio', { name: 'Je trade', exact: true }).click();
  assert.equal(await page.locator('.tag.alerte', { hasText: 'Check-in à faire' }).count(), 0);
  await attendreEnregistrement(page);
  const s = (await lireJournal(url)).sessions[0];
  assert.equal(s.partie, 'reel');
  assert.deepEqual(s.checkin, { energie: 4, sommeil: 7.5, decision: 'trade' });
});

test('vision du marché : photo enregistrée sur le disque avec son timeframe, notes', async () => {
  const { page, url } = env;
  const vision = page.locator('.carte', { has: page.getByRole('heading', { name: 'Vision du marché' }) });
  const [selecteur] = await Promise.all([
    page.waitForEvent('filechooser'),
    vision.locator('.zone-image-vide').first().click(),
  ]);
  await selecteur.setFiles({ name: 'h4.png', mimeType: 'image/png', buffer: PNG_1PX });
  await vision.locator('.galerie img').first().waitFor();
  await vision.locator('.galerie select').first().selectOption('H4');
  await vision.getByRole('radio', { name: 'Baissier' }).click();
  await vision.locator('.champ', { hasText: 'Niveaux de liquidité' }).locator('textarea').fill('SSL sous le low de Londres');
  await vision.locator('.champ', { hasText: 'Scénario baissier' }).locator('textarea').fill('Sweep du PDH puis MSS M5');
  // Police des notes
  const police = await vision.locator('.champ', { hasText: 'Scénario baissier' }).locator('textarea')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  assert.match(police, /Century Gothic/);
  await attendreEnregistrement(page);
  const s = (await lireJournal(url)).sessions[0];
  assert.equal(s.vision.photos.length, 1);
  assert.equal(s.vision.photos[0].tf, 'H4');
  assert.ok(existsSync(path.join(env.donnees, s.vision.photos[0].chemin)), 'image écrite dans donnees/images');
  assert.equal(s.vision.biais, 'baissier');
  assert.equal(s.vision.liquidite, 'SSL sous le low de Londres');
});

test('fin de session', async () => {
  const { page, url } = env;
  const fin = page.locator('.carte', { has: page.getByRole('heading', { name: 'Fin de session' }) });
  await fin.getByRole('radio', { name: 'Partielle' }).click();
  await fin.locator('textarea').fill('Bonne lecture, sortie trop tôt.');
  await fin.getByRole('radio', { name: '2', exact: true }).click();
  await attendreEnregistrement(page);
  const s = (await lireJournal(url)).sessions[0];
  assert.deepEqual(s.fin, { vision: 'partielle', note: 'Bonne lecture, sortie trop tôt.', energie: 2 });
});

test('deuxième session le même jour, puis liste', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/sessions`);
  await page.getByRole('button', { name: '+ Deuxième session aujourd’hui' }).click();
  await page.getByRole('heading', { name: /session 2/ }).waitFor();
  const debut = page.locator('.carte', { has: page.getByRole('heading', { name: 'Check-in de début' }) });
  await debut.getByRole('radio', { name: 'Je ne trade pas' }).click();
  await page.getByText('une session sans trade est une victoire de discipline').waitFor();
  await page.goto(`${url}/#/sessions`);
  await page.locator('.tableau tbody tr').nth(1).waitFor();
  assert.equal(await page.locator('.tableau tbody tr').count(), 2);
  assert.ok(await page.getByText('Victoire · pas de trade').isVisible());
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  assert.deepEqual(j.sessions.map((s) => s.numero).sort(), [1, 2]);
});

test('les sessions backtest sont séparées des sessions réelles', async () => {
  const { page, url } = env;
  await page.getByRole('radio', { name: 'Backtest' }).click();
  await page.getByRole('button', { name: 'Démarrer une session de backtest' }).waitFor();
  assert.ok(await page.getByText('Aucune session pour l’instant.').isVisible());
  await page.getByRole('button', { name: 'Démarrer une session de backtest' }).click();
  await page.getByRole('heading', { name: /session 1/ }).waitFor();
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  assert.deepEqual(j.sessions.map((s) => s.partie).sort(), ['backtest', 'reel', 'reel']);
});

test('supprimer une session', async () => {
  const { page, url } = env;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await page.locator('.modale').getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('heading', { name: 'Check-in de session' }).waitFor();
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).sessions.length, 2);
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
