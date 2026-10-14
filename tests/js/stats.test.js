import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalVide, nouveauTrade, nouvelleSession } from '../../app/js/modele.js';
import {
  selectionTrades, statsDeBase, tauxDiscipline, parZone, decoupagesExpert, analyseChecklist, conformesVsNon,
  rParRaison, disciplineParEnergie, comparaisonBacktestReel, challengePropFirm, trancheHoraire, alignementBiais,
} from '../../app/js/stats.js';
import { versUtc } from '../../app/js/temps.js';

const FZ = 'America/New_York';
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≠ ${b}`);

function journal() {
  const j = journalVide(FZ);
  j.parametres.fuseauSaisie = FZ;
  return j;
}

let minute = 0;
function ajouter(j, partie, r, champs = {}) {
  const t = nouveauTrade({ partie });
  minute += 1;
  t.entreeLe = versUtc(champs.date || '2026-10-05', champs.heure || `09:${String(30 + (minute % 29)).padStart(2, '0')}`, FZ);
  t.resultatRManuel = r;
  delete champs.date; delete champs.heure;
  Object.assign(t, champs);
  j.trades.push(t);
  return t;
}

const toutConforme = (j, t) => { for (const r of j.parametres.regles) t.discipline[r.id] = true; return t; };

test('stats de base : winrate, RR moyen, expectancy, total, drawdown, profit factor, séries', () => {
  const j = journal();
  // Séquence : +2, -1, -1, -1, +3, 0, +1
  for (const r of [2, -1, -1, -1, 3, 0, 1]) ajouter(j, 'reel', r);
  const { trades } = selectionTrades(j, j.parametres, { partie: 'reel' });
  const s = statsDeBase(trades, j.parametres);
  assert.equal(s.n, 7);
  assert.equal(s.gagnants, 3);
  assert.equal(s.perdants, 3);
  assert.equal(s.nuls, 1);
  proche(s.winrate, 3 / 7);
  proche(s.gainMoyen, 2);
  proche(s.perteMoyenne, -1);
  proche(s.rrMoyen, 2);
  proche(s.expectancy, 3 / 7);
  proche(s.totalR, 3);
  proche(s.totalPct, 3, 'risque par défaut 1 %');
  proche(s.drawdownMaxR, 3, 'pic +2 → creux -1');
  proche(s.profitFactor, 2);
  assert.equal(s.seriePertesMax, 3);
  assert.equal(s.serieGainsMax, 1);
  assert.deepEqual(s.courbe.map((c) => c.cumul), [2, 1, 0, -1, 2, 2, 3]);
});

test('drawdown depuis le départ si on commence par perdre ; % avec risques variables', () => {
  const j = journal();
  ajouter(j, 'reel', -1, { risquePct: 0.5 });
  ajouter(j, 'reel', -2, { risquePct: 1 });
  ajouter(j, 'reel', 4, { risquePct: 1 });
  const s = statsDeBase(selectionTrades(j, j.parametres).trades, j.parametres);
  proche(s.drawdownMaxR, 3);
  proche(s.drawdownMaxPct, 2.5);
  proche(s.totalPct, 1.5);
});

test('sélection : partie, futur vu exclu, sans résultat exclu, période, setup', () => {
  const j = journal();
  ajouter(j, 'reel', 1, { setupId: 'a' });
  ajouter(j, 'reel', null);
  ajouter(j, 'reel', 2, { date: '2026-09-01', setupId: 'b' });
  ajouter(j, 'backtest', 5, { regardeFutur: true });
  ajouter(j, 'backtest', -1, { regardeFutur: false });
  const p = j.parametres;
  const reel = selectionTrades(j, p, { partie: 'reel' });
  assert.equal(reel.trades.length, 2);
  assert.equal(reel.exclus.sansResultat, 1);
  const bt = selectionTrades(j, p, { partie: 'backtest' });
  assert.equal(bt.trades.length, 1);
  assert.equal(bt.exclus.futurVu, 1);
  assert.equal(selectionTrades(j, p, { partie: 'reel', debut: '2026-10-01' }).trades.length, 1);
  assert.equal(selectionTrades(j, p, { partie: 'reel', setupId: 'b' }).trades.length, 1);
  assert.deepEqual(reel.trades.map((t) => t.resultatRManuel), [2, 1], 'triés par date');
});

test('taux de discipline et FVG vs OB', () => {
  const j = journal();
  const p = j.parametres;
  toutConforme(j, ajouter(j, 'reel', 2, { zone: { typeId: 'fvg', tf: 'M1' } }));
  toutConforme(j, ajouter(j, 'reel', -1, { zone: { typeId: 'fvg', tf: 'M5' } }));
  const casse = toutConforme(j, ajouter(j, 'reel', -1, { zone: { typeId: 'ob', tf: 'M1' } }));
  casse.discipline['r-killzone'] = false;
  ajouter(j, 'reel', 1); // discipline non renseignée
  const { trades } = selectionTrades(j, p);
  assert.deepEqual(tauxDiscipline(trades, p), { conformes: 2, evalues: 3, taux: 2 / 3 });
  const zones = parZone(trades, p);
  assert.deepEqual(zones.map((z) => [z.libelle, z.n, z.totalR]), [['FVG', 2, 1], ['OB', 1, -1], ['Zone non renseignée', 1, 1]]);
  proche(zones[0].winrate, 0.5);
});

test('découpages expert : killzone, tranche horaire, biais, qualité, jour, sens', () => {
  const j = journal();
  const p = j.parametres;
  const s = nouvelleSession({ partie: 'reel', date: '2026-10-05' });
  s.vision.biais = 'haussier';
  s.checkin.energie = 4;
  j.sessions.push(s);
  ajouter(j, 'reel', 2, { heure: '09:40', direction: 'long', sessionId: s.id, qualite: 'A' });
  ajouter(j, 'reel', -1, { heure: '10:10', direction: 'short', sessionId: s.id, qualite: 'B' });
  ajouter(j, 'reel', -1, { heure: '14:00', direction: 'long', date: '2026-10-06' });
  ajouter(j, 'reel', 1, { heure: '12:00', direction: 'long', date: '2026-10-07' });
  const { trades } = selectionTrades(j, p);
  const d = Object.fromEntries(decoupagesExpert(j, trades, p).map((x) => [x.titre, x.lignes]));
  assert.deepEqual(d['Session (killzone)'].map((l) => [l.libelle, l.n]), [['NY AM', 2], ['NY PM', 1], ['Hors killzone', 1]]);
  assert.deepEqual(d['Tranche horaire (heure NY)'].map((l) => l.libelle), ['09:30–10:00', '10:00–10:30', '12:00–12:30', '14:00–14:30']);
  assert.deepEqual(d['Biais HTF'].map((l) => [l.cle, l.n]), [['avec', 1], ['contre', 1], ['inconnu', 2]]);
  assert.deepEqual(d['Qualité'].map((l) => l.libelle), ['A', 'B', 'Non notée']);
  assert.deepEqual(d['Jour de la semaine'].map((l) => l.libelle), ['Lundi', 'Mardi', 'Mercredi']);
  assert.deepEqual(d['Long vs short'].map((l) => [l.libelle, l.n]), [['Long', 3], ['Short', 1]]);
  assert.equal(trancheHoraire({ entreeLe: versUtc('2026-01-05', '09:59', FZ) }), '09:30–10:00');
  assert.equal(alignementBiais(j, trades[0]), 'avec');
});

test('checklist : élément qui manque le plus dans les pertes', () => {
  const j = journal();
  const p = j.parametres;
  const tc = (r, manque) => {
    const t = ajouter(j, 'reel', r);
    for (const k of Object.keys(t.checklist)) t.checklist[k] = true;
    for (const k of manque) t.checklist[k] = false;
  };
  tc(-1, ['sweep']); tc(-1, ['sweep', 'mss']); tc(-1, []); tc(2, ['mss']);
  const a = analyseChecklist(selectionTrades(j, p).trades, p);
  assert.equal(a[0].id, 'sweep');
  proche(a[0].manquantPertes, 2 / 3);
  proche(a[0].manquantGains, 0);
  assert.equal(a.find((x) => x.id === 'mss').manquantGains, 1);
});

test('conformes vs non conformes, R perdus hors règles, R par raison', () => {
  const j = journal();
  const p = j.parametres;
  toutConforme(j, ajouter(j, 'reel', 2));
  toutConforme(j, ajouter(j, 'reel', -1));
  const fomo = toutConforme(j, ajouter(j, 'reel', -1));
  fomo.discipline['r-killzone'] = false; fomo.raisonsViolation['r-killzone'] = 'fomo';
  const revenge = toutConforme(j, ajouter(j, 'reel', -2));
  revenge.discipline['r-limite'] = false; revenge.raisonsViolation['r-limite'] = 'revenge';
  revenge.discipline['r-risque'] = false; revenge.raisonsViolation['r-risque'] = 'revenge';
  const chanceux = toutConforme(j, ajouter(j, 'reel', 1));
  chanceux.discipline['r-sl-tp'] = false;
  const { trades } = selectionTrades(j, p);
  const c = conformesVsNon(trades, p);
  proche(c.conformes.expectancy, 0.5);
  proche(c.nonConformes.expectancy, -2 / 3);
  proche(c.rPerdusHorsRegles, 3);
  proche(c.rNetHorsRegles, -2);
  const raisons = rParRaison(trades, p);
  assert.deepEqual(raisons.map((r) => [r.libelle, r.n, r.totalR]),
    [['Revenge trade', 1, -2], ['FOMO', 1, -1], ['Raison non précisée', 1, 1]]);
});

test('discipline selon l’énergie : trades sans check-in exclus', () => {
  const j = journal();
  const p = j.parametres;
  const s = nouvelleSession({ partie: 'reel', date: '2026-10-05' });
  s.checkin.energie = 2;
  j.sessions.push(s);
  toutConforme(j, ajouter(j, 'reel', 1, { sessionId: s.id }));
  const t = toutConforme(j, ajouter(j, 'reel', -1, { sessionId: s.id }));
  t.discipline['r-biais'] = false;
  toutConforme(j, ajouter(j, 'reel', 3));
  const r = disciplineParEnergie(j, selectionTrades(j, p).trades, p);
  assert.equal(r.sansCheckin, 1);
  const e2 = r.lignes.find((l) => l.energie === 2);
  assert.equal(e2.n, 2);
  proche(e2.tauxDiscipline, 0.5);
  proche(e2.expectancy, 0);
  assert.equal(r.lignes.find((l) => l.energie === 5).n, 0);
});

test('comparaison backtest vs réel par setup', () => {
  const j = journal();
  const p = j.parametres;
  ajouter(j, 'reel', 1, { setupId: 'sb' });
  ajouter(j, 'reel', -1, { setupId: 'sb' });
  ajouter(j, 'backtest', 2, { setupId: 'sb' });
  ajouter(j, 'backtest', 2, { setupId: 'sb' });
  ajouter(j, 'backtest', -1, { setupId: 'j' });
  const c = comparaisonBacktestReel(j, p);
  const sb = c.find((x) => x.setupId === 'sb');
  assert.equal(sb.reel.n, 2);
  assert.equal(sb.backtest.n, 2);
  proche(sb.ecartExpectancy, -2);
  assert.equal(c.find((x) => x.setupId === 'j').ecartExpectancy, null);
});

test('challenge Prop Firm : objectif, drawdown restant, jours de trading', () => {
  const j = journal();
  const p = j.parametres; // 100 000 $, DD 10 %, objectif 10 %, 4 jours
  p.propFirm.dateDebut = '2026-10-01';
  ajouter(j, 'reel', -1, { resultatUsd: -3000, date: '2026-10-01', compteId: 'compte-principal' });
  ajouter(j, 'reel', 2, { resultatUsd: 5000, date: '2026-10-02', compteId: 'compte-principal' });
  ajouter(j, 'reel', 1, { resultatUsd: null, risqueUsd: 1000, date: '2026-10-02', compteId: 'compte-principal' });
  ajouter(j, 'reel', 9, { resultatUsd: 9000, date: '2026-09-15', compteId: 'compte-principal' }); // avant le début
  ajouter(j, 'reel', 9, { resultatUsd: 9000, date: '2026-10-03', compteId: 'autre' }); // autre compte
  const c = challengePropFirm(j, p);
  assert.equal(c.pnlUsd, 3000);
  assert.equal(c.tradesEstimes, 1);
  proche(c.progression, 0.3);
  assert.equal(c.joursTrading, 2);
  assert.equal(c.drawdownMaxUsd, 10000);
  assert.equal(c.drawdownUtiliseUsd, 0);
  assert.equal(c.plusBasUsd, -3000);
  assert.equal(c.statut, 'en_cours');
  ajouter(j, 'reel', -5, { resultatUsd: -14000, date: '2026-10-04', compteId: 'compte-principal' });
  const c2 = challengePropFirm(j, p);
  assert.equal(c2.drawdownRestantUsd, -1000);
  assert.equal(c2.statut, 'echoue');
  p.propFirm.actif = false;
  assert.equal(challengePropFirm(j, p), null);
});
