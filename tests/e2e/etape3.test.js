import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, attendreEnregistrement, lireJournal, PNG_1PX } from './outils.js';

let env;
before(async () => { env = await demarrer(); });
after(async () => { await env?.arreter(); });

const carte = (page, titre) => page.locator('.carte', { has: page.getByRole('heading', { name: titre, exact: true }) });

test('session avec biais puis plan de trade horodaté', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/sessions`);
  await page.getByRole('button', { name: 'Faire le check-in du jour' }).click();
  await carte(page, 'Check-in de début').getByRole('radio', { name: 'Je trade' }).click();
  await carte(page, 'Vision du marché').getByRole('radio', { name: 'Haussier' }).click();
  await page.getByRole('button', { name: '+ Plan de trade' }).click();
  await page.getByRole('heading', { name: 'Plan de trade' }).waitFor();
  assert.match(await page.locator('.tag', { hasText: '🔒' }).textContent(), /\d{2}:\d{2}:\d{2}/);
  const plan = carte(page, 'Le plan');
  await plan.getByRole('radio', { name: 'Long' }).click();
  await plan.locator('.champ', { hasText: 'Setup' }).locator('select').selectOption({ label: 'Silver Bullet' });
  await plan.getByRole('radio', { name: 'A', exact: true }).click();
  await plan.getByRole('radio', { name: 'FVG' }).click();
  await plan.locator('.champ', { hasText: 'Timeframe' }).locator('select').selectOption('M1');
  await plan.locator('textarea').fill('Sweep SSL asiatique, MSS M1, entrée FVG.');
  const niveaux = carte(page, 'Niveaux prévus');
  await niveaux.locator('.champ', { hasText: 'Entrée' }).locator('input').fill('21000');
  await niveaux.locator('.champ', { hasText: 'Stop loss' }).locator('input').fill('20980');
  await niveaux.locator('.champ', { hasText: 'Take profit' }).locator('input').fill('21060');
  assert.equal((await niveaux.locator('.stat-valeur').textContent()).trim(), '3,00');
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), carte(page, "Vision de l'entrée").locator('.zone-image-vide').click()]);
  await selecteur.setFiles({ name: 'e.png', mimeType: 'image/png', buffer: PNG_1PX });
  await carte(page, "Vision de l'entrée").locator('img').waitFor();
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  assert.equal(j.plans.length, 1);
  const p = j.plans[0];
  assert.equal(p.sessionId, j.sessions[0].id);
  assert.equal(p.statut, 'en_attente');
  assert.equal(p.qualite, 'A');
  assert.deepEqual(p.zone, { typeId: 'fvg', tf: 'M1' });
  assert.ok(p.photo.startsWith('images/'));
});

test('prendre le trade depuis le plan : champs préremplis, plan « pris »', async () => {
  const { page, url } = env;
  await page.getByRole('button', { name: 'Prendre le trade' }).click();
  await page.getByRole('heading', { name: /^Long NAS100/ }).waitFor();
  const faits = carte(page, 'Faits');
  assert.equal(await faits.locator('.champ', { hasText: "Prix d'entrée" }).locator('input').inputValue(), '21000');
  assert.equal(await faits.locator('.champ', { hasText: 'Stop loss' }).locator('input').inputValue(), '20980');
  assert.ok(await carte(page, 'Plan vs réalité').isVisible());
  assert.match(await carte(page, 'Plan vs réalité').textContent(), /Plan créé (dans la minute|\d+ min avant)/);
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  const t = j.trades[0];
  assert.equal(t.planId, j.plans[0].id);
  assert.equal(j.plans[0].statut, 'pris');
  assert.equal(j.plans[0].tradeId, t.id);
  assert.equal(t.sessionId, j.sessions[0].id);
  assert.equal(t.setupId, 'setup-silver-bullet');
  assert.equal(t.qualite, 'A');
  assert.equal(t.qualiteAvantResultat, true);
  assert.equal(t.screenshots.avant, j.plans[0].photo);
});

test('saisie du résultat : R calculé, RR réalisé, comparaison au plan', async () => {
  const { page, url } = env;
  const faits = carte(page, 'Faits');
  await faits.locator('.champ', { hasText: 'Prix de sortie' }).locator('input').fill('21045,5');
  await faits.locator('.champ', { hasText: 'Résultat ($)' }).locator('input').fill('227,5');
  const resultat = faits.locator('.stat', { hasText: 'Résultat' }).first();
  assert.equal((await resultat.locator('.stat-valeur').textContent()).replace(/\s/g, ' '), '+2,28 R');
  assert.equal((await faits.locator('.stat', { hasText: 'RR réalisé' }).locator('.stat-valeur').textContent()).trim(), '2,28');
  assert.match(await carte(page, 'Plan vs réalité').textContent(), /76 % de l'objectif/);
  await attendreEnregistrement(page);
  const t = (await lireJournal(url)).trades[0];
  assert.equal(t.prixSortie, 21045.5);
  assert.equal(t.resultatUsd, 227.5);
  assert.equal(t.risqueUsd, 100);
});

test('checklist et discipline : suggestions, règle cassée avec raison', async () => {
  const { page, url } = env;
  const analyse = carte(page, 'Analyse (avant le résultat)');
  const items = analyse.locator('.checklist-item');
  assert.equal(await items.count(), 6);
  for (let i = 0; i < 6; i++) await items.nth(i).getByRole('radio', { name: 'Oui' }).click();
  const disc = carte(page, 'Discipline');
  await disc.getByRole('button', { name: /Appliquer les \d suggestion/ }).click();
  const regleSlTp = disc.locator('.regle', { hasText: 'SL et TP non déplacés' });
  await regleSlTp.getByRole('radio', { name: 'Non' }).click();
  await regleSlTp.locator('select').selectOption({ label: 'FOMO' });
  assert.ok(await page.locator('.titre-vue .tag.perte', { hasText: 'Non conforme' }).isVisible());
  await attendreEnregistrement(page);
  const t = (await lireJournal(url)).trades[0];
  assert.equal(t.discipline['r-checklist'], true);
  assert.equal(t.discipline['r-biais'], true, 'biais défini dans la session');
  assert.equal(t.discipline['r-sl-tp'], false);
  assert.equal(t.raisonsViolation['r-sl-tp'], 'fomo');
  assert.ok(Object.values(t.checklist).every((v) => v === true));
});

test('notes en police Century Gothic, émotions, liste des trades', async () => {
  const { page, url } = env;
  const notes = carte(page, 'Notes');
  await notes.locator('.champ', { hasText: 'Note rapide' }).locator('input').fill('Entrée propre, sortie anticipée.');
  await notes.locator('.champ', { hasText: 'Ce qui a raté' }).locator('textarea').fill('J’ai déplacé mon TP.');
  assert.match(await notes.locator('textarea').first().evaluate((el) => getComputedStyle(el).fontFamily), /Century Gothic/);
  await carte(page, 'État émotionnel').locator('.champ', { hasText: 'Avant' }).locator('select').selectOption({ label: 'Calme' });
  await attendreEnregistrement(page);
  const t = (await lireJournal(url)).trades[0];
  assert.equal(t.noteRapide, 'Entrée propre, sortie anticipée.');
  assert.equal(t.emotions.avant, 'calme');
  await page.goto(`${url}/#/trades`);
  const ligne = page.locator('.tableau tbody tr').first();
  await ligne.waitFor();
  assert.match(await ligne.textContent(), /Silver Bullet.*FVG M1.*Long.*A.*6\/6.*3,00.*\+2,28 R.*Non conforme/);
});

test('plan non pris avec raison', async () => {
  const { page, url } = env;
  await page.getByRole('button', { name: '+ Plan de trade' }).click();
  await page.getByRole('heading', { name: 'Plan de trade' }).waitFor();
  await carte(page, 'Le plan').getByRole('radio', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'Non pris' }).click();
  await carte(page, 'Statut').locator('.champ', { hasText: 'Raison' }).locator('select').selectOption({ label: 'Hésitation' });
  // Une fois tranché, le plan est verrouillé
  assert.equal(await page.locator('fieldset.formulaire').evaluate((el) => el.disabled), true);
  assert.equal(await carte(page, 'Niveaux prévus').locator('input').first().isDisabled(), true);
  await attendreEnregistrement(page);
  const plans = (await lireJournal(url)).plans;
  assert.equal(plans[1].statut, 'non_pris');
  assert.equal(plans[1].raisonId, 'hesitation');
  assert.equal(plans[1].direction, 'short');
});

test('supprimer le trade remet son plan en attente', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/trades`);
  await page.locator('.tableau tbody tr').first().click();
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await page.locator('.modale').getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('heading', { name: 'Trades', exact: true }).waitFor();
  await page.getByText('Plans en attente').waitFor();
  await attendreEnregistrement(page);
  const j = await lireJournal(url);
  assert.equal(j.trades.length, 0);
  assert.equal(j.plans[0].statut, 'en_attente');
  assert.equal(j.plans[0].tradeId, null);
});

test('trade sans session : marqué « sans check-in »', async () => {
  const { page, url } = env;
  // Supprime la session puis crée un trade : il n'a plus de session
  const j = await lireJournal(url);
  await page.goto(`${url}/#/sessions/${j.sessions[0].id}`);
  await page.getByRole('button', { name: 'Supprimer' }).first().click();
  await page.locator('.modale').getByRole('button', { name: 'Supprimer' }).click();
  await page.goto(`${url}/#/trades`);
  await page.getByRole('button', { name: '+ Trade', exact: true }).click();
  await page.locator('.titre-vue .tag', { hasText: 'Sans check-in' }).waitFor();
  await attendreEnregistrement(page);
  assert.equal((await lireJournal(url)).trades[0].sessionId, null);
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
