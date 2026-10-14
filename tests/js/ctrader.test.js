import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalVide, nouveauPlan } from '../../app/js/modele.js';
import {
  lireCsv, analyserReleve, regrouperDeals, decalageEnTete, deviseEnTete, lireMontant, lireDateHeure,
  instrumentPour, dejaImporte, tradeDepuisGroupe, fixerRisque, plansCandidats, risqueDepuisSl, ErreurImport,
} from '../../app/js/ctrader.js';
import { lireXlsx } from '../../app/js/xlsx.js';
import { valeurR } from '../../app/js/calculs.js';

const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

const CSV = `Order ID;Symbol;Opening Direction;Closing Direction;Opening Time (UTC-4);Closing Time (UTC-4);Entry Price;Closing Price;Closing Quantity;Gross EUR;Commission;Swap;Net EUR;Balance EUR;ID
"9001";USTEC.cash;Buy;Sell;10/14/2026 9:45:10;10/14/2026 10:02:00;21000,5;21010,5;1;10;-1;0;9;10009;7001
"9002";USTEC.cash;Sell;Buy;10/14/2026 10:30:00;10/14/2026 10:41:00;21020;21000;1;20;-1;0;19;10028;7002
`;

test('en-têtes : fuseau et devise', () => {
  assert.equal(decalageEnTete('Opening Time (UTC+1)'), 60);
  assert.equal(decalageEnTete('Opening Time (UTC-04:30)'), -270);
  assert.equal(decalageEnTete('Opening Time (UTC)'), 0);
  assert.equal(decalageEnTete('Opening Time'), null);
  assert.equal(deviseEnTete('Net USD'), 'USD');
  assert.equal(deviseEnTete('Gross (EUR)'), 'EUR');
  assert.equal(deviseEnTete('Net'), null);
});

test('montants et dates tolérants', () => {
  assert.equal(lireMontant('1,234.50'), 1234.5);
  assert.equal(lireMontant('21,100.00'), 21100);
  assert.equal(lireMontant('21,450'), 21450);
  assert.equal(lireMontant('1 234,50'), 1234.5);
  assert.equal(lireMontant('12,5'), 12.5);
  assert.equal(lireMontant('-3'), -3);
  assert.equal(lireMontant('(40.00)'), -40);
  assert.equal(lireMontant('$ 12.30'), 12.3);
  assert.equal(lireMontant(''), null);
  assert.equal(lireMontant(7), 7);
  assert.deepEqual(lireDateHeure('14/10/2026 15:41:12.345'), { an: 2026, mois: 10, jour: 14, h: 15, min: 41, s: 12, ms: 345 });
  assert.deepEqual(lireDateHeure('10/14/2026 3:41 PM', { jourDabord: false }), { an: 2026, mois: 10, jour: 14, h: 15, min: 41, s: 0, ms: 0 });
  assert.deepEqual(lireDateHeure('2026-10-14 15:41:12'), { an: 2026, mois: 10, jour: 14, h: 15, min: 41, s: 12, ms: 0 });
  assert.equal(lireDateHeure(46309.5).h, 12, 'numéro de série Excel');
});

test('correspondance des symboles', () => {
  const table = journalVide('UTC').parametres.symboles;
  assert.deepEqual(instrumentPour('US100', table), { instrument: 'NAS100', connu: true });
  assert.deepEqual(instrumentPour('USTEC.cash', table), { instrument: 'NAS100', connu: true });
  assert.deepEqual(instrumentPour('us100', table), { instrument: 'NAS100', connu: true });
  assert.deepEqual(instrumentPour('GER40', table), { instrument: 'GER40', connu: false });
});

test('CSV : séparateur « ; », colonnes dans un autre ordre, dates mois/jour, fuseau UTC-4', () => {
  const r = analyserReleve(lireCsv(CSV));
  assert.equal(r.deals.length, 2);
  assert.equal(r.devise, 'EUR');
  assert.equal(r.fuseau.ouverture, -240);
  assert.equal(r.jourDabord, false);
  const d = r.deals[0];
  assert.equal(d.ouverture, '2026-10-14T13:45:10.000Z');
  assert.equal(d.direction, 'long');
  assert.equal(d.prixEntree, 21000.5);
  assert.equal(d.net, 9);
  assert.equal(d.id, '7001');
  assert.equal(d.orderId, '9001');
  assert.equal(r.deals[1].direction, 'short');
});

test('Excel : lignes d’information avant l’en-tête, fermeture partielle regroupée, ligne de total ignorée', async () => {
  const lignes = await lireXlsx(readFileSync(new URL('../fixtures/ctrader-exemple.xlsx', import.meta.url)));
  const r = analyserReleve(lignes);
  assert.equal(r.deals.length, 3);
  assert.equal(r.ignorees, 1);
  assert.equal(r.devise, 'USD');
  assert.equal(r.fuseau.ouverture, 60);
  const groupes = regrouperDeals(r.deals);
  assert.equal(groupes.length, 2);
  const [g1, g2] = groupes;
  assert.equal(g1.nbDeals, 2);
  assert.deepEqual(g1.ids, ['1001', '1002']);
  assert.deepEqual(g1.orderIds, ['5001', '5002']);
  assert.equal(g1.ouverture, '2026-10-14T14:41:12.345Z');
  assert.equal(g1.fermeture, '2026-10-14T15:10:44.001Z');
  assert.equal(g1.net, 87);
  assert.equal(g1.brut, 90);
  assert.equal(g1.commission, -3);
  assert.equal(g1.quantite, 2);
  proche(g1.prixSortie, 21045.5);
  proche(g1.soldeAvant, 100000);
  assert.equal(g2.direction, 'short');
  assert.equal(g2.prixEntree, 21100);
  assert.equal(g2.net, -43);
});

test('message clair si une colonne essentielle manque', () => {
  const sansNet = 'ID,Symbol,Opening Direction,Opening Time (UTC+1),Entry Price,Closing Price,Commission\n1,US100,Buy,14/10/2026 15:00,1,2,0\n';
  assert.throws(() => analyserReleve(lireCsv(sansNet)), (e) => e instanceof ErreurImport && /Net/.test(e.message) && /Colonnes trouvées/.test(e.message));
  assert.throws(() => analyserReleve(lireCsv('a,b,c\n1,2,3\n')), (e) => e instanceof ErreurImport && /en-tête/.test(e.message));
  // Pas de Net mais un Gross : accepté avec avertissement
  const avecGross = 'ID,Symbol,Opening Direction,Opening Time (UTC+1),Entry Price,Closing Price,Gross USD\n1,US100,Buy,14/10/2026 15:00,1,2,5\n';
  const r = analyserReleve(lireCsv(avecGross));
  assert.equal(r.deals[0].net, 5);
  assert.match(r.avertissements[0], /Gross/);
});

test('fiche « à compléter », anti-doublon, risque déduit du SL du plan, R', async () => {
  const j = journalVide('Europe/Paris');
  const p = j.parametres;
  const lignes = await lireXlsx(readFileSync(new URL('../fixtures/ctrader-exemple.xlsx', import.meta.url)));
  const [g1, g2] = regrouperDeals(analyserReleve(lignes).deals);
  const t = tradeDepuisGroupe(g1, p, { devise: 'USD', fuseauOuverture: 60 });
  assert.equal(t.statut, 'a_completer');
  assert.equal(t.instrument, 'NAS100');
  assert.equal(t.resultatUsd, 87);
  // Sans SL : risque fixe par défaut (100 $) → 0,87 R
  fixerRisque(t, p);
  assert.equal(t.ctrader.sourceRisque, 'defaut');
  proche(valeurR(t, p), 0.87);
  // Avec le SL du plan : 2 lots, brut 90 $ pour 45 points → 2 $/point ; SL à 20 points → 40 $
  t.sl = 20980.5;
  assert.equal(risqueDepuisSl(t), 40);
  fixerRisque(t, p);
  assert.equal(t.ctrader.sourceRisque, 'sl');
  proche(valeurR(t, p), 87 / 40);
  proche(t.risquePct, 0.04);
  j.trades.push(t);
  assert.equal(dejaImporte(j, g1), t);
  assert.equal(dejaImporte(j, g2), null);
  // Réimport : un deal déjà connu suffit à reconnaître le trade
  assert.equal(dejaImporte(j, { ...g1, ids: ['1002'], orderIds: [] }), t);
});

test('plans candidats : même date, instrument, sens, créés avant l’entrée', () => {
  const j = journalVide('Europe/Paris');
  const t = { entreeLe: '2026-10-14T14:41:12.345Z', instrument: 'NAS100', direction: 'long' };
  const plan = (creeLe, direction = 'long', instrument = 'NAS100') =>
    Object.assign(nouveauPlan(), { creeLe, direction, instrument });
  const bon = plan('2026-10-14T14:38:00.000Z');
  const apres = plan('2026-10-14T14:50:00.000Z');
  const autreSens = plan('2026-10-14T14:30:00.000Z', 'short');
  const autreJour = plan('2026-10-13T14:30:00.000Z');
  const pris = Object.assign(plan('2026-10-14T14:20:00.000Z'), { statut: 'pris' });
  j.plans.push(bon, apres, autreSens, autreJour, pris);
  assert.deepEqual(plansCandidats(j, t, 'Europe/Paris'), [bon]);
  const second = plan('2026-10-14T14:10:00.000Z');
  j.plans.push(second);
  assert.deepEqual(plansCandidats(j, t, 'Europe/Paris'), [bon, second], 'ambigu : à confirmer');
});
