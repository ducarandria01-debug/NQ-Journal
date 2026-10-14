import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { demarrer, attendreEnregistrement, lireJournal, ecrireJournal } from './outils.js';
import { journalVide, nouvelleSession, nouveauPlan } from '../../app/js/modele.js';

const FICHIER = fileURLToPath(new URL('../fixtures/ctrader-exemple.xlsx', import.meta.url));
let env;

before(async () => {
  env = await demarrer();
  const j = journalVide('Europe/Paris');
  j.parametres.fuseauSaisie = 'Europe/Paris';
  const s = nouvelleSession({ partie: 'reel', date: '2026-10-14' });
  s.checkin = { energie: 4, sommeil: 7, decision: 'trade' };
  j.sessions.push(s);
  // Deux plans valides le même jour : rattachement ambigu, à confirmer
  const plan = (creeLe, setupId) => Object.assign(nouveauPlan(), {
    creeLe, sessionId: s.id, instrument: 'NAS100', direction: 'long', setupId, qualite: 'A',
    entree: 21000.5, sl: 20980.5, tp: 21060.5, zone: { typeId: 'fvg', tf: 'M1' },
  });
  j.plans.push(plan('2026-10-14T14:35:00.000Z', 'setup-silver-bullet'), plan('2026-10-14T14:20:00.000Z', 'setup-2022'));
  await ecrireJournal(env.url, j);
});
after(async () => { await env?.arreter(); });

async function choisirFichier(page) {
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importer cTrader…' }).click()]);
  await selecteur.setFiles(FICHIER);
  await page.locator('.modale').waitFor();
  return page.locator('.modale');
}

test('aperçu : regroupement, fuseau, devise, rattachement ambigu à confirmer', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/trades`);
  const m = await choisirFichier(page);
  const texte = await m.textContent();
  assert.match(texte, /3 deal\(s\) lu\(s\) → 2 trade\(s\)/);
  assert.match(texte, /Fuseau : UTC\+1/);
  assert.match(texte, /Devise : USD/);
  assert.equal(await m.locator('tbody tr').count(), 2);
  const importer = m.getByRole('button', { name: /^Importer \d/ });
  assert.equal(await importer.isDisabled(), true, 'bloqué tant que le plan ambigu n’est pas confirmé');
  assert.match(texte, /1 rattachement\(s\) à confirmer/);
  const premiere = m.locator('tbody tr').first();
  await premiere.locator('td').nth(7).locator('select').selectOption({ label: '16:35 · Silver Bullet A' });
  assert.equal(await importer.isDisabled(), false);
  // R estimé avec le SL du plan : 2 lots, 90 $ brut / 45 pts → 2 $/pt × 20 pts = 40 $ ; net 87 $ → 2,18 R
  assert.match((await premiere.textContent()).replace(/\s/g, ' '), /\+2,18 R.*SL du plan/);
  await importer.click();
  await page.locator('.notification.succes', { hasText: '2 trade(s) importé(s)' }).waitFor();
});

test('trades créés « à compléter », plan et session rattachés, R calculé', async () => {
  const { page, url } = env;
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  assert.equal(j.trades.length, 2);
  const [t1, t2] = j.trades;
  assert.equal(t1.statut, 'a_completer');
  assert.equal(t1.instrument, 'NAS100');
  assert.equal(t1.entreeLe, '2026-10-14T14:41:12.345Z');
  assert.equal(t1.resultatUsd, 87);
  assert.equal(t1.risqueUsd, 40);
  assert.equal(t1.sl, 20980.5, 'SL repris du plan');
  assert.equal(t1.setupId, 'setup-silver-bullet');
  assert.equal(t1.sessionId, j.sessions[0].id);
  assert.equal(j.plans.find((p) => p.setupId === 'setup-silver-bullet').statut, 'pris');
  assert.equal(j.plans.find((p) => p.setupId === 'setup-2022').statut, 'en_attente');
  assert.deepEqual(t1.ctrader.ids, ['1001', '1002']);
  assert.equal(t2.sessionId, null, 'pas de session le 15/10 : sans check-in');
  assert.equal(t2.risqueUsd, 100, 'pas de plan : risque fixe par défaut');
  assert.equal(await page.locator('.tableau tbody tr').count(), 2, 'liste filtrée sur « à compléter »');
});

test('réimport du même fichier : aucun doublon', async () => {
  const { page, url } = env;
  const m = await choisirFichier(page);
  assert.match(await m.textContent(), /2 déjà importé\(s\), ignoré\(s\)/);
  assert.match(await m.textContent(), /Aucun nouveau trade/);
  await m.getByRole('button', { name: 'Fermer' }).click();
  assert.equal((await lireJournal(url)).trades.length, 2);
});

test('fichier invalide : message clair', async () => {
  const { page } = env;
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importer cTrader…' }).click()]);
  await selecteur.setFiles({ name: 'mauvais.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Montant\n2026-01-01,5\n') });
  const m = page.locator('.modale');
  await m.waitFor();
  assert.match(await m.textContent(), /Import cTrader impossible.*en-tête/s);
  await m.getByRole('button', { name: 'Fermer' }).click();
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
