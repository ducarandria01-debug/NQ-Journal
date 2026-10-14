import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, attendreEnregistrement, lireJournal } from './outils.js';

let env;
before(async () => { env = await demarrer(); });
after(async () => { await env?.arreter(); });

const carte = (page, titre) => page.locator('.carte', { has: page.getByRole('heading', { name: titre, exact: true }) });

test('campagne : nom, règles écrites avant de commencer puis figées', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/backtest`);
  await page.getByRole('button', { name: '+ Nouvelle campagne' }).click();
  await page.getByRole('heading', { name: 'Campagne sans nom' }).waitFor();
  const c = carte(page, 'Campagne');
  await c.locator('.champ', { hasText: 'Nom' }).locator('input').fill('Silver Bullet T1 2024');
  await c.getByRole('button', { name: 'Silver Bullet' }).click();
  const regles = carte(page, 'Règles du test (écrites avant de commencer)');
  await regles.locator('textarea').fill('NY AM 10h-11h, FVG M1 après MSS, TP 2R.');
  await regles.getByRole('button', { name: 'Figer les règles et commencer' }).click();
  await regles.getByText('🔒 Figées le').waitFor();
  assert.equal(await regles.locator('textarea').count(), 0);
  await attendreEnregistrement(page);
  const camp = (await lireJournal(url)).campagnes[0];
  assert.equal(camp.nom, 'Silver Bullet T1 2024');
  assert.deepEqual(camp.setupIds, ['setup-silver-bullet']);
  assert.ok(camp.reglesFigeesLe);
});

test('session de backtest à la date réelle, trade avec la date du marché rejoué', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/backtest`);
  await page.getByRole('button', { name: 'Session de backtest' }).click();
  await page.getByRole('heading', { name: /session 1/ }).waitFor();
  await page.getByRole('button', { name: '+ Trade de backtest' }).click();
  const faits = carte(page, 'Faits');
  await faits.locator('.champ', { hasText: 'Date du marché rejoué' }).locator('input').fill('2024-03-05');
  await faits.locator('.champ', { hasText: "Heure d'entrée" }).locator('input').fill('10:15');
  await faits.locator('.champ', { hasText: "Heure d'entrée" }).locator('input').blur();
  await carte(page, 'Contexte').getByRole('radio', { name: 'Short' }).click();
  await faits.locator('.champ', { hasText: "Prix d'entrée" }).locator('input').fill('18000');
  await faits.locator('.champ', { hasText: 'Stop loss' }).locator('input').fill('18010');
  await faits.locator('.champ', { hasText: 'Prix de sortie' }).locator('input').fill('17980');
  await carte(page, 'Analyse (avant le résultat)').locator('.champ', { hasText: 'Setup' }).locator('select').selectOption({ label: 'Silver Bullet' });
  assert.match(await faits.locator('.stat').first().textContent(), /\+2,00 R/);
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  const t = j.trades[0];
  const s = j.sessions[0];
  assert.equal(t.partie, 'backtest');
  assert.equal(s.partie, 'backtest');
  assert.equal(t.sessionId, s.id);
  assert.equal(s.campagneId, j.campagnes[0].id);
  assert.equal(t.campagneId, j.campagnes[0].id);
  assert.match(t.entreeLe, /^2024-03-05T/);
  assert.notEqual(s.date, '2024-03-05');
});

test('« j\'ai regardé le futur » est enregistré et signalé', async () => {
  const { page, url } = env;
  await carte(page, 'Contexte').locator('.champ', { hasText: 'Regardé le futur' }).getByRole('radio', { name: 'Oui' }).click();
  await page.locator('.titre-vue .tag', { hasText: 'Futur vu' }).waitFor();
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).trades[0].regardeFutur, true);
});

test('setup présent non pris avec raison, compté dans les occurrences', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/backtest`);
  await page.getByRole('button', { name: '+ Setup non pris' }).click();
  await page.getByRole('heading', { name: 'Setup présent non pris' }).waitFor();
  const setup = carte(page, 'Le setup');
  await setup.locator('.champ', { hasText: 'Setup' }).last().locator('select').selectOption({ label: 'Silver Bullet' });
  await setup.locator('.champ', { hasText: 'Date du marché' }).locator('input').fill('2024-03-06');
  await setup.locator('.champ', { hasText: 'Date du marché' }).locator('input').blur();
  const pourquoi = carte(page, 'Pourquoi non pris ?');
  await pourquoi.locator('.champ', { hasText: 'Raison' }).locator('select').selectOption({ label: 'Hésitation' });
  await pourquoi.locator('.champ', { hasText: 'Résultat hypothétique' }).locator('input').fill('3');
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  const snp = j.setupsNonPris[0];
  assert.equal(snp.setupId, 'setup-silver-bullet');
  assert.equal(snp.raisonId, 'hesitation');
  assert.equal(snp.resultatHypothetiqueR, 3);
  assert.equal(snp.campagneId, j.campagnes[0].id);
  assert.equal(snp.sessionId, j.sessions[0].id);
  await page.goto(`${url}/#/backtest`);
  const ligne = carte(page, "Compteur d'occurrences par setup").locator('tbody tr').first();
  await ligne.waitFor();
  const cellules = (await ligne.locator('td').allTextContents()).map((c) => c.replace(/\s+/g, ' '));
  assert.deepEqual(cellules, ['Silver Bullet', '2', '1', '1', '50 %', '1']);
});

test('les données backtest et réelles sont séparées', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/trades`);
  await page.getByText('Aucun trade réel pour l’instant.', { exact: false }).waitFor();
  await page.goto(`${url}/#/backtest`);
  await carte(page, 'Trades de backtest').locator('tbody tr').first().waitFor();
  assert.equal(await carte(page, 'Trades de backtest').locator('tbody tr').count(), 1);
});

test('filtrer par campagne', async () => {
  const { page } = env;
  await page.locator('.campagne').first().click();
  await page.locator('.campagne.actif').waitFor();
  await page.getByRole('heading', { name: /Règles du test — Silver Bullet T1 2024/ }).waitFor();
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
