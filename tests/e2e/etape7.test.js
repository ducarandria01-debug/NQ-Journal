import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, attendreEnregistrement, lireJournal, ecrireJournal } from './outils.js';
import { journalVide, nouvelleSession, nouveauTrade } from '../../app/js/modele.js';
import { aujourdhui, ajouterJours, versUtc, lundiDeSemaine, semaineIso } from '../../app/js/temps.js';

const FZ = 'Europe/Paris';
const AUJ = aujourdhui(FZ);
const LUNDI = lundiDeSemaine(semaineIso(AUJ));
let env;
let jours;

before(async () => {
  env = await demarrer();
  const j = journalVide(FZ);
  j.parametres.fuseauSaisie = FZ;
  const regles = j.parametres.regles.map((r) => r.id);
  // Lundi : 2 trades conformes (+2, -1) ; mardi : 1 conforme +1 et 1 non conforme -1 ; mercredi : « je ne trade pas » respecté
  jours = [LUNDI, ajouterJours(LUNDI, 1), ajouterJours(LUNDI, 2)];
  const session = (date, decision) => {
    const s = nouvelleSession({ partie: 'reel', date });
    s.checkin = { energie: 3, sommeil: 7, decision };
    j.sessions.push(s);
    return s;
  };
  const trade = (s, r, conforme) => {
    const t = nouveauTrade({ partie: 'reel' });
    Object.assign(t, { sessionId: s.id, entreeLe: versUtc(s.date, '15:45', FZ), resultatRManuel: r });
    for (const id of regles) t.discipline[id] = true;
    if (!conforme) t.discipline['r-killzone'] = false;
    j.trades.push(t);
  };
  const s1 = session(jours[0], 'trade'); trade(s1, 2, true); trade(s1, -1, true);
  const s2 = session(jours[1], 'trade'); trade(s2, 1, true); trade(s2, -1, false);
  session(jours[2], 'pas_trade');
  await ecrireJournal(env.url, j);
});
after(async () => { await env?.arreter(); });

test('calendrier : R du jour et couleur selon la discipline', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/sessions`);
  // Se placer sur le mois du lundi de la semaine en cours
  const moisCible = jours[0].slice(0, 7);
  if (AUJ.slice(0, 7) !== moisCible) await page.getByRole('button', { name: '‹' }).click();
  const cellule = (date) => page.locator('.calendrier .jour:not(.hors-mois)').nth(Number(date.slice(8)) - 1);
  for (const d of jours) {
    if (d.slice(0, 7) !== moisCible) return; // semaine à cheval sur deux mois : test partiel
  }
  assert.match(await cellule(jours[0]).getAttribute('class'), /\bconforme\b/);
  assert.match((await cellule(jours[0]).textContent()).replace(/\s/g, ' '), /\+1,0 R/);
  assert.match(await cellule(jours[1]).getAttribute('class'), /partiel/);
  assert.match(await cellule(jours[2]).getAttribute('class'), /victoire/);
  assert.ok(await page.locator('.legende').isVisible());
  await cellule(jours[1]).click();
  await page.getByRole('heading', { name: /session 1/ }).waitFor();
});

test('revue hebdomadaire : chiffres de la semaine et bilan enregistré', async () => {
  const { page, url } = env;
  await page.goto(`${url}/#/dashboard`);
  const revue = page.locator('.carte', { has: page.getByRole('heading', { name: 'Revue hebdomadaire' }) });
  await revue.waitFor();
  const chiffres = (await revue.locator('.revue-chiffres').textContent()).replace(/\s/g, ' ');
  assert.match(chiffres, /Trades4/);
  assert.match(chiffres, /Résultat\+1,0 R/);
  assert.match(chiffres, /Discipline75 %/);
  assert.match(chiffres, /Jours sans trade décidés1/);
  assert.equal((await lireJournal(url)).revues.length, 0, 'pas de revue vide créée');
  await revue.locator('.champ', { hasText: 'Ce que j’ai bien fait' }).locator('textarea').fill('Respecté le no-trade de mercredi.');
  await revue.locator('.champ', { hasText: 'Une chose à corriger' }).locator('textarea').fill('Entrée hors killzone mardi.');
  await revue.locator('.champ', { hasText: 'Une règle à renforcer' }).locator('select').selectOption({ label: 'Trade pris dans la killzone prévue' });
  await attendreEnregistrement(page);
  const r = (await lireJournal(url)).revues;
  assert.equal(r.length, 1);
  assert.equal(r[0].semaine, semaineIso(AUJ));
  assert.equal(r[0].regleId, 'r-killzone');
  assert.equal(r[0].bienFait, 'Respecté le no-trade de mercredi.');
  await page.reload();
  await revue.locator('.tag', { hasText: 'Revue faite' }).waitFor();
});

test('aucune erreur JavaScript', () => {
  assert.deepEqual(env.erreurs, []);
});
