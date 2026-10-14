import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  versUtc, depuisUtc, killzoneDe, semaineIso, lundiDeSemaine, ajouterJours, dureeMinutes,
  formaterDuree, dateLongue, aujourdhui, decalageMinutes,
} from '../../app/js/temps.js';

const KZ = [
  { id: 'ny-am', debut: '09:30', fin: '11:00' },
  { id: 'ny-pm', debut: '13:30', fin: '16:00' },
  { id: 'old', debut: '00:00', fin: '23:59', archive: true },
];

test('conversion heure murale ↔ UTC, été et hiver', () => {
  // Paris : UTC+2 en été, UTC+1 en hiver
  assert.equal(versUtc('2026-07-01', '15:30', 'Europe/Paris'), '2026-07-01T13:30:00.000Z');
  assert.equal(versUtc('2026-01-15', '15:30', 'Europe/Paris'), '2026-01-15T14:30:00.000Z');
  // New York : UTC-4 en été, UTC-5 en hiver
  assert.equal(versUtc('2026-07-01', '09:30', 'America/New_York'), '2026-07-01T13:30:00.000Z');
  assert.equal(versUtc('2026-01-15', '09:30', 'America/New_York'), '2026-01-15T14:30:00.000Z');
  assert.deepEqual(depuisUtc('2026-01-15T14:30:00.000Z', 'Europe/Paris'),
    { date: '2026-01-15', heure: '15:30', minutes: 930, jourSemaine: 4 });
});

test('aller-retour autour des changements d’heure', () => {
  for (const [date, heure] of [['2026-03-29', '03:30'], ['2026-10-25', '01:30'], ['2026-03-08', '12:00'], ['2026-11-01', '10:00']]) {
    for (const fz of ['Europe/Paris', 'America/New_York']) {
      const iso = versUtc(date, heure, fz);
      const retour = depuisUtc(iso, fz);
      assert.equal(retour.date, date, `${date} ${heure} ${fz}`);
      assert.equal(retour.heure, heure, `${date} ${heure} ${fz}`);
    }
  }
});

test('décalage entre Paris et New York pendant la période où les deux changements d’heure diffèrent', () => {
  // Mi-mars : New York est déjà à l'heure d'été, pas Paris → 5 h d'écart au lieu de 6
  const iso = versUtc('2026-03-16', '15:30', 'Europe/Paris');
  assert.equal(depuisUtc(iso, 'America/New_York').heure, '10:30');
  assert.equal(decalageMinutes(iso, 'America/New_York'), -240);
});

test('killzone toujours évaluée en heure de New York', () => {
  assert.equal(killzoneDe(versUtc('2026-07-01', '15:45', 'Europe/Paris'), KZ), 'ny-am'); // 09:45 NY
  assert.equal(killzoneDe(versUtc('2026-03-16', '15:45', 'Europe/Paris'), KZ), 'ny-am'); // 10:45 NY
  assert.equal(killzoneDe(versUtc('2026-07-01', '11:00', 'America/New_York'), KZ), null); // fin exclue
  assert.equal(killzoneDe(versUtc('2026-07-01', '14:00', 'America/New_York'), KZ), 'ny-pm');
  assert.equal(killzoneDe(versUtc('2026-07-01', '03:00', 'America/New_York'), KZ), null); // archivée ignorée
  assert.equal(killzoneDe(null, KZ), null);
});

test('semaines ISO', () => {
  assert.equal(semaineIso('2026-10-14'), '2026-W42');
  assert.equal(semaineIso('2027-01-01'), '2026-W53');
  assert.equal(semaineIso('2024-12-30'), '2025-W01');
  assert.equal(lundiDeSemaine('2026-W42'), '2026-10-12');
  assert.equal(lundiDeSemaine('2025-W01'), '2024-12-30');
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
});

test('durées et dates lisibles', () => {
  assert.equal(dureeMinutes('2026-01-01T10:00:00Z', '2026-01-01T11:25:00Z'), 85);
  assert.equal(dureeMinutes('2026-01-01T10:00:00Z', null), null);
  assert.equal(dureeMinutes('2026-01-01T11:00:00Z', '2026-01-01T10:00:00Z'), null);
  assert.equal(formaterDuree(85), '1 h 25');
  assert.equal(formaterDuree(12), '12 min');
  assert.equal(formaterDuree(120), '2 h');
  assert.equal(dateLongue('2026-10-14'), 'mercredi 14 octobre 2026');
  assert.equal(aujourdhui('Europe/Paris', new Date('2026-10-14T23:30:00Z')), '2026-10-15');
});
