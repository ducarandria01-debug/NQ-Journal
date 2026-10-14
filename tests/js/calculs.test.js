import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalVide, nouveauTrade, nouvelleSession } from '../../app/js/modele.js';
import {
  rrPrevu, rrRealise, resultatR, distanceStop, etatDiscipline, suggestionsDiscipline, appliquerSuggestions,
  cumulRAvant, checklistComplete, elementsManquants,
} from '../../app/js/calculs.js';
import { versUtc } from '../../app/js/temps.js';

const FZ = 'Europe/Paris';
const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

function trade(champs = {}) {
  return Object.assign(nouveauTrade({ partie: 'reel' }), champs);
}

test('RR prévu et réalisé, long et short', () => {
  const long = trade({ direction: 'long', prixEntree: 21000, sl: 20980, tp: 21060, prixSortie: 21030 });
  proche(rrPrevu(long), 3);
  proche(rrRealise(long), 1.5);
  const short = trade({ direction: 'short', prixEntree: 21000, sl: 21010, tp: 20975, prixSortie: 21010 });
  proche(rrPrevu(short), 2.5);
  proche(rrRealise(short), -1);
});

test('stop du mauvais côté ou données manquantes : pas de RR', () => {
  assert.equal(distanceStop(trade({ direction: 'long', prixEntree: 100, sl: 105 })), null);
  assert.equal(rrPrevu(trade({ direction: 'long', prixEntree: 100, sl: 95 })), null);
  assert.equal(rrRealise(trade({ prixEntree: 100, sl: 95, prixSortie: 110 })), null);
});

test('résultat en R : manuel > $/risque $ > $/risque par défaut > prix', () => {
  const p = { risqueDefautUsd: 200 };
  const t = trade({ direction: 'long', prixEntree: 100, sl: 90, prixSortie: 120 });
  assert.deepEqual(resultatR(t, p), { valeur: 2, source: 'prix' });
  t.resultatUsd = 300;
  assert.deepEqual(resultatR(t, p), { valeur: 1.5, source: 'usd-defaut' });
  t.risqueUsd = 100;
  assert.deepEqual(resultatR(t, p), { valeur: 3, source: 'usd' });
  t.resultatRManuel = -0.5;
  assert.deepEqual(resultatR(t, p), { valeur: -0.5, source: 'manuel' });
  assert.deepEqual(resultatR(trade(), p), { valeur: null, source: null });
});

test('checklist', () => {
  const t = trade();
  assert.equal(checklistComplete(t), false);
  for (const k of Object.keys(t.checklist)) t.checklist[k] = true;
  assert.equal(checklistComplete(t), true);
  t.checklist.sweep = false;
  assert.deepEqual(elementsManquants(t), ['sweep']);
});

test('conformité : toutes les règles respectées, sinon non conforme, sinon à évaluer', () => {
  const p = journalVide(FZ).parametres;
  const t = trade();
  assert.equal(etatDiscipline(t, p).statut, 'incomplet');
  for (const r of p.regles) t.discipline[r.id] = true;
  assert.equal(etatDiscipline(t, p).statut, 'conforme');
  t.discipline['r-sl-tp'] = false;
  const e = etatDiscipline(t, p);
  assert.equal(e.statut, 'non_conforme');
  assert.deepEqual(e.violees, ['r-sl-tp']);
  // Une règle cassée suffit, même si d'autres ne sont pas renseignées
  t.discipline['r-biais'] = null;
  assert.equal(etatDiscipline(t, p).statut, 'non_conforme');
});

test('règle archivée : ignorée sauf si déjà évaluée sur le trade', () => {
  const p = journalVide(FZ).parametres;
  p.regles.push({ id: 'r-vieille', texte: 'Ancienne règle', archive: true });
  const t = trade();
  for (const r of p.regles.filter((x) => !x.archive)) t.discipline[r.id] = true;
  assert.equal(etatDiscipline(t, p).statut, 'conforme');
  t.discipline['r-vieille'] = false;
  assert.equal(etatDiscipline(t, p).statut, 'non_conforme');
});

test('suggestions : biais, checklist, killzone, risque', () => {
  const j = journalVide(FZ);
  const p = j.parametres;
  const s = nouvelleSession({ partie: 'reel', date: '2026-07-01' });
  j.sessions.push(s);
  const t = trade({ sessionId: s.id, entreeLe: versUtc('2026-07-01', '15:45', FZ), risquePct: 1 });
  let sg = suggestionsDiscipline(j, t, p);
  assert.equal(sg['r-biais'], false, 'session sans biais');
  assert.equal(sg['r-checklist'], null, 'checklist pas encore remplie');
  assert.equal(sg['r-killzone'], true, '09:45 NY = NY AM');
  assert.equal(sg['r-risque'], true);
  assert.equal(sg['r-sl-tp'], null, 'règle manuelle');
  s.vision.biais = 'haussier';
  for (const k of Object.keys(t.checklist)) t.checklist[k] = true;
  t.entreeLe = versUtc('2026-07-01', '18:30', FZ); // 12:30 NY : hors killzone
  t.risquePct = 1.5;
  sg = suggestionsDiscipline(j, t, p);
  assert.equal(sg['r-biais'], true);
  assert.equal(sg['r-checklist'], true);
  assert.equal(sg['r-killzone'], false);
  assert.equal(sg['r-risque'], false, '1,5 % > 1 % + 10 % de tolérance');
  t.risquePct = 1.05;
  assert.equal(suggestionsDiscipline(j, t, p)['r-risque'], true, 'dans la tolérance');
  assert.equal(suggestionsDiscipline(j, trade(), p)['r-biais'], null, 'sans session : inconnu');
});

test('limite de pertes du jour', () => {
  const j = journalVide(FZ);
  const p = j.parametres; // limite : 2 R
  const mk = (heure, r) => {
    const t = trade({ entreeLe: versUtc('2026-07-01', heure, FZ), resultatRManuel: r, compteId: 'compte-principal' });
    j.trades.push(t);
    return t;
  };
  const t1 = mk('15:35', -1);
  const t2 = mk('15:50', -1);
  const t3 = mk('16:10', null);
  mk('16:30', 5); // après t3 : ne compte pas
  assert.equal(cumulRAvant(j, t1, p), 0);
  assert.equal(suggestionsDiscipline(j, t2, p)['r-limite'], true);
  assert.equal(cumulRAvant(j, t3, p), -2);
  assert.equal(suggestionsDiscipline(j, t3, p)['r-limite'], false);
  // Un autre compte n'entre pas dans le cumul
  t1.compteId = 'autre';
  assert.equal(suggestionsDiscipline(j, t3, p)['r-limite'], true);
});

test('appliquer les suggestions ne remplace jamais une réponse déjà donnée', () => {
  const j = journalVide(FZ);
  const p = j.parametres;
  const t = trade({ entreeLe: versUtc('2026-07-01', '15:45', FZ), risquePct: 1 });
  t.discipline['r-killzone'] = false;
  const n = appliquerSuggestions(j, t, p);
  assert.equal(t.discipline['r-killzone'], false);
  assert.equal(t.discipline['r-risque'], true);
  assert.equal(t.discipline['r-sl-tp'], undefined);
  assert.equal(n, 2); // risque + limite
});
