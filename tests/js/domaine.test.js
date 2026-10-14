import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalVide, nouvelleSession, nouveauTrade } from '../../app/js/modele.js';
import {
  sessionPourTrade, dateDeRattachement, disciplineSession, resultatSession, supprimerSession, aCheckin, prochainNumero,
} from '../../app/js/domaine.js';

const FZ = 'Europe/Paris';

function journalAvecSessions() {
  const j = journalVide(FZ);
  const s1 = Object.assign(nouvelleSession({ partie: 'reel', date: '2026-10-14', numero: 1 }), { creeLe: '2026-10-14T12:00:00.000Z' });
  const s2 = Object.assign(nouvelleSession({ partie: 'reel', date: '2026-10-14', numero: 2 }), { creeLe: '2026-10-14T17:00:00.000Z' });
  const b1 = Object.assign(nouvelleSession({ partie: 'backtest', date: '2026-10-14', numero: 1 }), { creeLe: '2026-10-14T08:00:00.000Z' });
  j.sessions.push(s1, s2, b1);
  return { j, s1, s2, b1 };
}

test('un trade réel se rattache à la session de même date et même partie', () => {
  const { j, s1, s2 } = journalAvecSessions();
  const t = nouveauTrade({ partie: 'reel' });
  t.entreeLe = '2026-10-14T13:45:00.000Z'; // 15:45 à Paris, après la session 1, avant la 2
  assert.equal(sessionPourTrade(j, t, FZ).id, s1.id);
  t.entreeLe = '2026-10-14T18:30:00.000Z'; // après l'ouverture de la session 2
  assert.equal(sessionPourTrade(j, t, FZ).id, s2.id);
  t.entreeLe = '2026-10-15T13:45:00.000Z'; // autre jour : pas de session
  assert.equal(sessionPourTrade(j, t, FZ), null);
});

test('un trade de backtest se rattache à la date réelle du replay, pas à la date du marché', () => {
  const { j, b1 } = journalAvecSessions();
  const t = nouveauTrade({ partie: 'backtest' });
  t.creeLe = '2026-10-14T09:10:00.000Z';
  t.entreeLe = '2024-03-05T14:50:00.000Z'; // marché rejoué
  assert.equal(dateDeRattachement(t, FZ), '2026-10-14');
  assert.equal(sessionPourTrade(j, t, FZ).id, b1.id);
});

test('numérotation des sessions du jour', () => {
  const { j } = journalAvecSessions();
  assert.equal(prochainNumero(j, 'reel', '2026-10-14'), 3);
  assert.equal(prochainNumero(j, 'backtest', '2026-10-14'), 2);
  assert.equal(prochainNumero(j, 'reel', '2026-10-15'), 1);
});

test('« je ne trade pas » respecté = victoire de discipline', () => {
  const { j, s1 } = journalAvecSessions();
  s1.checkin.decision = 'pas_trade';
  const d = disciplineSession(j, s1, j.parametres);
  assert.equal(d.victoire, true);
  assert.equal(d.score, 1);
  assert.equal(resultatSession(j, s1, j.parametres), null);
  // Un trade pris malgré tout casse la décision
  const t = nouveauTrade({ partie: 'reel' });
  t.sessionId = s1.id;
  j.trades.push(t);
  const d2 = disciplineSession(j, s1, j.parametres);
  assert.equal(d2.victoire, false);
  assert.equal(d2.decisionRespectee, false);
  assert.equal(d2.score, 0);
});

test('score de discipline de session = part des trades conformes', () => {
  const { j, s1 } = journalAvecSessions();
  s1.checkin.decision = 'trade';
  const regles = j.parametres.regles.map((r) => r.id);
  const conforme = nouveauTrade({ partie: 'reel' });
  const nonConforme = nouveauTrade({ partie: 'reel' });
  const nonEvalue = nouveauTrade({ partie: 'reel' });
  for (const id of regles) { conforme.discipline[id] = true; nonConforme.discipline[id] = true; }
  nonConforme.discipline[regles[2]] = false;
  for (const t of [conforme, nonConforme, nonEvalue]) { t.sessionId = s1.id; j.trades.push(t); }
  conforme.resultatUsd = 200; conforme.risqueUsd = 100;
  nonConforme.resultatUsd = -100; nonConforme.risqueUsd = 100;
  const d = disciplineSession(j, s1, j.parametres);
  assert.equal(d.nbTrades, 3);
  assert.equal(d.evalues, 2);
  assert.equal(d.score, 0.5);
  assert.equal(resultatSession(j, s1, j.parametres), 1);
});

test('supprimer une session garde ses trades, devenus « sans check-in »', () => {
  const { j, s1 } = journalAvecSessions();
  s1.checkin.energie = 4;
  assert.equal(aCheckin(s1), true);
  const t = nouveauTrade({ partie: 'reel' });
  t.sessionId = s1.id;
  j.trades.push(t);
  supprimerSession(j, s1.id);
  assert.equal(j.sessions.some((s) => s.id === s1.id), false);
  assert.equal(j.trades[0].sessionId, null);
  assert.equal(aCheckin(null), false);
});

test('occurrences par setup en backtest : pris + non pris, futur vu à part', async () => {
  const { occurrencesParSetup, supprimerCampagne } = await import('../../app/js/domaine.js');
  const { nouveauSetupNonPris, nouvelleCampagne } = await import('../../app/js/modele.js');
  const j = journalVide(FZ);
  const c1 = nouvelleCampagne();
  const c2 = nouvelleCampagne();
  j.campagnes.push(c1, c2);
  const bt = (setupId, campagneId, futur = false) => {
    const t = nouveauTrade({ partie: 'backtest' });
    Object.assign(t, { setupId, campagneId, regardeFutur: futur });
    j.trades.push(t);
  };
  bt('sb', c1.id); bt('sb', c1.id, true); bt('j', c2.id);
  j.trades.push(Object.assign(nouveauTrade({ partie: 'reel' }), { setupId: 'sb' })); // réel : ignoré
  j.setupsNonPris.push(Object.assign(nouveauSetupNonPris({ campagneId: c1.id }), { setupId: 'sb' }));
  j.setupsNonPris.push(Object.assign(nouveauSetupNonPris({ campagneId: c1.id }), { setupId: 'j' }));
  assert.deepEqual(occurrencesParSetup(j, c1.id), [
    { setupId: 'sb', pris: 2, nonPris: 1, futurVu: 1, total: 3 },
    { setupId: 'j', pris: 0, nonPris: 1, futurVu: 0, total: 1 },
  ]);
  assert.equal(occurrencesParSetup(j).find((l) => l.setupId === 'j').total, 2);
  supprimerCampagne(j, c1.id);
  assert.equal(j.campagnes.length, 1);
  assert.equal(j.trades.filter((t) => t.campagneId === null).length, 3);
});
