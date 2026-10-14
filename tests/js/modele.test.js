import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  journalVide, migrer, SCHEMA_VERSION, ErreurVersion, nouveauTrade, cheminsImages, nomDe, elementsActifs,
} from '../../app/js/modele.js';

test('journal vide : structure complète et sérialisable', () => {
  const j = journalVide('Europe/Paris');
  assert.equal(j.schemaVersion, SCHEMA_VERSION);
  for (const cle of ['sessions', 'plans', 'trades', 'campagnes', 'setupsNonPris', 'revues']) {
    assert.deepEqual(j[cle], []);
  }
  assert.equal(j.parametres.seuilEchantillon, 30);
  assert.equal(j.parametres.regles.length, 6);
  assert.deepEqual(j.parametres.listes.zones.map((z) => z.nom), ['FVG', 'OB']);
  assert.deepEqual(JSON.parse(JSON.stringify(j)), j);
});

test('migrer complète un journal incomplet sans écraser les valeurs existantes', () => {
  const ancien = {
    schemaVersion: 1,
    parametres: { seuilEchantillon: 50, listes: { setups: [{ id: 's1', nom: 'Mon setup' }] } },
    trades: [{ id: 't1', partie: 'reel', resultatUsd: 120 }],
  };
  const j = migrer(ancien, 'Europe/Paris');
  assert.equal(j.parametres.seuilEchantillon, 50);
  assert.equal(j.parametres.modeStats, 'standard');
  assert.deepEqual(j.parametres.listes.setups, [{ id: 's1', nom: 'Mon setup' }]);
  assert.equal(j.parametres.listes.zones.length, 2);
  assert.equal(j.trades[0].id, 't1');
  assert.equal(j.trades[0].resultatUsd, 120);
  assert.deepEqual(j.trades[0].screenshots, { avant: null, entree: null, resultat: null });
  assert.deepEqual(j.sessions, []);
  assert.equal(ancien.parametres.modeStats, undefined, "l'original n'est pas modifié");
});

test('migrer refuse un format inconnu ou plus récent', () => {
  assert.throws(() => migrer({ schemaVersion: SCHEMA_VERSION + 1 }), ErreurVersion);
  assert.throws(() => migrer({}), ErreurVersion);
  assert.throws(() => migrer(null), ErreurVersion);
});

test('trades réel et backtest ont le même noyau et leurs champs propres', () => {
  const r = nouveauTrade({ partie: 'reel' });
  const b = nouveauTrade({ partie: 'backtest' });
  const noyau = (t) => Object.keys(t).filter((k) => !['compteId', 'emotions', 'ctrader', 'regardeFutur'].includes(k));
  assert.deepEqual(noyau(r), noyau(b));
  assert.ok('emotions' in r && !('regardeFutur' in r));
  assert.ok('regardeFutur' in b && !('emotions' in b));
  assert.notEqual(r.id, b.id);
});

test('outils de listes et images', () => {
  const liste = [{ id: 'a', nom: 'A' }, { id: 'b', nom: 'B', archive: true }];
  assert.equal(nomDe(liste, 'b'), 'B');
  assert.equal(nomDe(liste, 'x'), '—');
  assert.deepEqual(elementsActifs(liste).map((e) => e.id), ['a']);
  assert.deepEqual(elementsActifs(liste, 'b').map((e) => e.id), ['a', 'b']);
  const j = { trades: [{ screenshots: { avant: 'images/2026-10/a.png', entree: null } }], sessions: [{ vision: { photos: [{ chemin: 'images/2026-10/b.jpg' }] } }], note: 'pas une image' };
  assert.deepEqual([...cheminsImages(j)].sort(), ['images/2026-10/a.png', 'images/2026-10/b.jpg']);
});
