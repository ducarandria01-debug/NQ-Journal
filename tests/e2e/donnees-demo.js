// Journal de démonstration réaliste pour les tests (réel + backtest).
import { journalVide, nouveauTrade, nouvelleSession, nouvelleCampagne } from '../../app/js/modele.js';
import { versUtc } from '../../app/js/temps.js';

const FZ = 'Europe/Paris';

export function journalDemo({ nbReel = 12, nbBacktest = 8 } = {}) {
  const j = journalVide(FZ);
  const p = j.parametres;
  p.fuseauSaisie = FZ;
  p.propFirm.dateDebut = '2026-09-01';
  const camp = Object.assign(nouvelleCampagne(), { nom: 'SB T1 2024', regles: 'NY AM, FVG M1', reglesFigeesLe: '2026-09-01T08:00:00.000Z' });
  j.campagnes.push(camp);
  const resultatsReel = [2, -1, 2.5, -1, -1, 3, -1, 2, -0.5, 1.8, -1, 2.2, -1, 1.5, -1, 2];
  for (let i = 0; i < nbReel; i++) {
    const date = `2026-09-${String(1 + i * 2).padStart(2, '0')}`;
    const s = nouvelleSession({ partie: 'reel', date });
    s.checkin = { energie: 1 + (i % 5), sommeil: 6 + (i % 3), decision: 'trade' };
    s.vision.biais = i % 3 ? 'haussier' : 'baissier';
    j.sessions.push(s);
    const t = nouveauTrade({ partie: 'reel' });
    const r = resultatsReel[i % resultatsReel.length];
    Object.assign(t, {
      sessionId: s.id, compteId: 'compte-principal', direction: i % 4 ? 'long' : 'short',
      entreeLe: versUtc(date, i % 2 ? '15:45' : '16:20', FZ), sortieLe: versUtc(date, '17:05', FZ),
      prixEntree: 21000, sl: 20980, tp: 21050, risquePct: 1, risqueUsd: 1000, resultatUsd: r * 1000,
      setupId: i % 3 ? 'setup-silver-bullet' : 'setup-2022', zone: { typeId: i % 2 ? 'fvg' : 'ob', tf: i % 2 ? 'M1' : 'M5' },
      qualite: ['A', 'B', 'C'][i % 3],
    });
    for (const k of Object.keys(t.checklist)) t.checklist[k] = true;
    if (r < 0) t.checklist.sweep = false;
    for (const regle of p.regles) t.discipline[regle.id] = true;
    if (i % 4 === 1) { t.discipline['r-sl-tp'] = false; t.raisonsViolation['r-sl-tp'] = 'fomo'; }
    j.trades.push(t);
  }
  for (let i = 0; i < nbBacktest; i++) {
    const t = nouveauTrade({ partie: 'backtest' });
    Object.assign(t, {
      campagneId: camp.id, direction: 'long', entreeLe: versUtc(`2024-03-${String(4 + i).padStart(2, '0')}`, '16:10', FZ),
      prixEntree: 18000, sl: 17990, prixSortie: i % 3 ? 18020 : 17990, setupId: 'setup-silver-bullet', zone: { typeId: 'fvg', tf: 'M1' },
      regardeFutur: i === 0,
    });
    j.trades.push(t);
  }
  return j;
}
