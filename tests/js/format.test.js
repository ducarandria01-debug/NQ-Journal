import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtR, fmtPct, fmtUsd, fmtNombre, lireNombre, classeSigne } from '../../app/js/format.js';

const sansEspaces = (s) => s.replace(/[  ]/g, ' ');

test('mise en forme française', () => {
  assert.equal(fmtR(1.5), '+1,50 R');
  assert.equal(fmtR(-1), '-1,00 R');
  assert.equal(fmtR(0), '0,00 R');
  assert.equal(fmtR(null), '—');
  assert.equal(fmtPct(55.55), '55,6 %');
  assert.equal(sansEspaces(fmtUsd(-1234.5)), '-1 234,50 $');
  assert.equal(fmtNombre(Infinity), '—');
});

test('lecture des nombres saisis', () => {
  assert.equal(lireNombre('1,5'), 1.5);
  assert.equal(lireNombre('1.5'), 1.5);
  assert.equal(lireNombre('1 234,5'), 1234.5);
  assert.equal(lireNombre('-0,25'), -0.25);
  assert.equal(lireNombre(''), null);
  assert.equal(lireNombre('abc'), null);
  assert.equal(lireNombre(null), null);
});

test('classe selon le signe', () => {
  assert.equal(classeSigne(2), 'gain');
  assert.equal(classeSigne(-2), 'perte');
  assert.equal(classeSigne(0), 'neutre');
  assert.equal(classeSigne(undefined), 'neutre');
});
