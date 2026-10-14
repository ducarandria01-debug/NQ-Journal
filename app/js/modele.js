// Modèle de données du journal : valeurs par défaut, fabriques et migrations.
// Règle d'or : tout ce qui sert aux stats est une liste fermée référencée par identifiant.
// Un élément de liste n'est jamais supprimé, seulement archivé (les anciens trades le gardent).

export const SCHEMA_VERSION = 1;

export const PARTIES = { reel: 'Réel', backtest: 'Backtest' };

export const CHECKLIST = [
  { id: 'biaisHTF', nom: 'Bias HTF' },
  { id: 'liquidite', nom: 'Liquidité' },
  { id: 'sweep', nom: 'Sweep' },
  { id: 'mss', nom: 'MSS' },
  { id: 'displacement', nom: 'Displacement' },
  { id: 'zoneEntree', nom: "Zone d'entrée" },
];

export const QUALITES = ['A', 'B', 'C'];
export const DIRECTIONS = [{ id: 'long', nom: 'Long' }, { id: 'short', nom: 'Short' }];
export const BIAIS = [
  { id: 'haussier', nom: 'Haussier' },
  { id: 'baissier', nom: 'Baissier' },
  { id: 'neutre', nom: 'Neutre' },
];
export const DECISIONS = [
  { id: 'trade', nom: 'Je trade' },
  { id: 'pas_trade', nom: 'Je ne trade pas' },
];
export const ISSUES_VISION = [
  { id: 'confirmee', nom: 'Confirmée' },
  { id: 'partielle', nom: 'Partielle' },
  { id: 'invalidee', nom: 'Invalidée' },
];
export const STATUTS_PLAN = [
  { id: 'en_attente', nom: 'En attente' },
  { id: 'pris', nom: 'Pris' },
  { id: 'non_pris', nom: 'Non pris' },
  { id: 'annule', nom: 'Annulé' },
];

// Règles dont le journal sait proposer une réponse (tu confirmes ou corriges).
export const VERIFS_AUTO = {
  biais: 'Biais HTF renseigné dans le check-in de la session',
  checklist: 'Les 6 éléments de la checklist cochés',
  killzone: "Heure d'entrée dans une killzone",
  risque: 'Risque proche du risque fixe par défaut',
  limite: 'Limite de pertes du jour non atteinte avant ce trade',
};

export function nouvelId(prefixe) {
  const alea = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefixe}_${alea}`;
}

export function maintenantIso() {
  return new Date().toISOString();
}

const el = (id, nom, extra = {}) => ({ id, nom, archive: false, ...extra });

export function parametresParDefaut(fuseau = 'Europe/Paris') {
  return {
    modeStats: 'standard',
    seuilEchantillon: 30,
    theme: 'sombre',
    rappelSauvegardeJours: 7,
    fuseauSaisie: fuseau,
    instrumentParDefaut: 'NAS100',
    risqueDefautPct: 1,
    risqueDefautUsd: 100,
    toleranceRisquePct: 10,
    limitePertesJourR: 2,
    listes: {
      setups: [
        el('setup-silver-bullet', 'Silver Bullet'),
        el('setup-2022', 'ICT 2022 Model'),
        el('setup-judas', 'Judas Swing'),
      ],
      zones: [el('fvg', 'FVG'), el('ob', 'OB')],
      timeframes: ['M1', 'M3', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'].map((tf) => el(tf, tf)),
      killzones: [
        el('ny-am', 'NY AM', { debut: '09:30', fin: '11:00' }),
        el('ny-pm', 'NY PM', { debut: '13:30', fin: '16:00' }),
      ],
      comptes: [el('compte-principal', 'Compte principal')],
      raisonsViolation: [
        el('fatigue', 'Fatigue'), el('fomo', 'FOMO'), el('revenge', 'Revenge trade'),
        el('impatience', 'Impatience'), el('doute', 'Doute'), el('autre', 'Autre'),
      ],
      raisonsNonPris: [
        el('checklist-incomplete', 'Checklist incomplète'),
        el('hors-killzone', 'Hors killzone'),
        el('rr-insuffisant', 'RR insuffisant'),
        el('hesitation', 'Hésitation'),
        el('news', 'News / annonce'),
        el('limite-jour', 'Limite du jour atteinte'),
        el('autre', 'Autre'),
      ],
      emotions: [
        el('calme', 'Calme'), el('concentre', 'Concentré'), el('confiant', 'Confiant'),
        el('impatient', 'Impatient'), el('stresse', 'Stressé'), el('frustre', 'Frustré'),
        el('euphorique', 'Euphorique'), el('fatigue', 'Fatigué'),
      ],
    },
    regles: [
      el('r-biais', 'Biais HTF défini avant l’entrée', { auto: 'biais' }),
      el('r-checklist', 'Checklist complète validée', { auto: 'checklist' }),
      el('r-killzone', 'Trade pris dans la killzone prévue', { auto: 'killzone' }),
      el('r-risque', 'Risque fixe respecté', { auto: 'risque' }),
      el('r-sl-tp', 'SL et TP non déplacés après l’entrée', { auto: null }),
      el('r-limite', 'Pas de trade après la limite de pertes du jour', { auto: 'limite' }),
    ].map(({ nom, ...r }) => ({ ...r, texte: nom })),
    symboles: [
      { source: 'NAS100', cible: 'NAS100' },
      { source: 'US100', cible: 'NAS100' },
      { source: 'USTEC', cible: 'NAS100' },
      { source: 'NDX100', cible: 'NAS100' },
      { source: 'USTECH', cible: 'NAS100' },
    ],
    propFirm: {
      actif: true,
      compteId: 'compte-principal',
      tailleCompte: 100000,
      drawdownMaxPct: 10,
      objectifPct: 10,
      joursMin: 4,
      dateDebut: null,
    },
  };
}

export function journalVide(fuseau) {
  return {
    schemaVersion: SCHEMA_VERSION,
    creeLe: maintenantIso(),
    parametres: parametresParDefaut(fuseau),
    sessions: [],
    plans: [],
    trades: [],
    campagnes: [],
    setupsNonPris: [],
    revues: [],
  };
}

// --- Fabriques ---

export function nouvelleSession({ partie, date, numero = 1, campagneId = null }) {
  return {
    id: nouvelId('ses'),
    partie,
    date,
    numero,
    creeLe: maintenantIso(),
    campagneId,
    checkin: { energie: null, sommeil: null, decision: null },
    vision: { photos: [], biais: null, liquidite: '', scenarioHaussier: '', scenarioBaissier: '' },
    fin: { vision: null, note: '', energie: null },
  };
}

export function nouveauPlan({ sessionId = null, instrument = 'NAS100' } = {}) {
  return {
    id: nouvelId('plan'),
    creeLe: maintenantIso(), // horodatage automatique, jamais modifiable
    sessionId,
    instrument,
    direction: null,
    setupId: null,
    zone: { typeId: null, tf: null },
    qualite: null,
    scenario: '',
    photo: null,
    entree: null,
    sl: null,
    tp: null,
    statut: 'en_attente',
    raisonId: null,
    raisonNote: '',
    tradeId: null,
  };
}

export function nouveauTrade({ partie, sessionId = null, instrument = 'NAS100' }) {
  const t = {
    id: nouvelId('trd'),
    partie,
    statut: 'complet',
    creeLe: maintenantIso(),
    sessionId,
    planId: null,
    campagneId: null,
    instrument,
    direction: null,
    entreeLe: null,
    sortieLe: null,
    killzoneId: null,
    prixEntree: null,
    sl: null,
    tp: null,
    prixSortie: null,
    taille: null,
    risquePct: null,
    risqueUsd: null,
    resultatUsd: null,
    resultatRManuel: null,
    setupId: null,
    zone: { typeId: null, tf: null },
    checklist: Object.fromEntries(CHECKLIST.map((c) => [c.id, null])),
    qualite: null,
    qualiteAvantResultat: null,
    screenshots: { avant: null, entree: null, resultat: null },
    noteRapide: '',
    analyse: { marche: '', rate: '', referais: '' },
    discipline: {},
    raisonsViolation: {},
  };
  if (partie === 'reel') {
    t.compteId = null;
    t.emotions = { avant: null, pendant: null, apres: null };
    t.ctrader = null;
  } else {
    t.regardeFutur = false;
  }
  return t;
}

export function nouvelleCampagne() {
  return {
    id: nouvelId('camp'),
    nom: '',
    regles: '',
    creeLe: maintenantIso(),
    reglesFigeesLe: null,
    periodeDebut: null,
    periodeFin: null,
    setupIds: [],
    active: true,
  };
}

export function nouveauSetupNonPris({ campagneId = null, sessionId = null }) {
  return {
    id: nouvelId('snp'),
    creeLe: maintenantIso(),
    campagneId,
    sessionId,
    marcheLe: null,
    instrument: 'NAS100',
    direction: null,
    setupId: null,
    zone: { typeId: null, tf: null },
    raisonId: null,
    note: '',
    resultatHypothetiqueR: null,
    screenshot: null,
  };
}

export function nouvelleRevue(semaine) {
  return {
    id: nouvelId('rev'),
    semaine,
    creeLe: maintenantIso(),
    bienFait: '',
    aCorriger: '',
    regleId: null,
    note: '',
  };
}

// --- Migrations ---

// MIGRATIONS[n] transforme un journal de version n en version n + 1.
const MIGRATIONS = {};

function estObjet(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Ajoute les clés manquantes (récursivement pour les objets) sans écraser l'existant. */
function completer(cible, defauts) {
  for (const [cle, valeur] of Object.entries(defauts)) {
    if (!(cle in cible) || cible[cle] === undefined) {
      cible[cle] = structuredClone(valeur);
    } else if (estObjet(valeur) && estObjet(cible[cle])) {
      completer(cible[cle], valeur);
    }
  }
  return cible;
}

export class ErreurVersion extends Error {}

/** Met un journal (éventuellement ancien ou incomplet) au format actuel. */
export function migrer(journal, fuseau) {
  if (!estObjet(journal) || !Number.isInteger(journal.schemaVersion)) {
    throw new ErreurVersion('Format de journal inconnu.');
  }
  if (journal.schemaVersion > SCHEMA_VERSION) {
    throw new ErreurVersion(
      `Ce journal vient d'une version plus récente de l'application (format ${journal.schemaVersion}). Mets à jour l'application.`,
    );
  }
  let j = structuredClone(journal);
  while (j.schemaVersion < SCHEMA_VERSION) {
    j = MIGRATIONS[j.schemaVersion](j);
    j.schemaVersion += 1;
  }
  const defaut = journalVide(fuseau);
  completer(j, defaut);
  // Listes de paramètres : ajoute les éléments par défaut manquants seulement s'ils n'ont jamais existé
  // (comparaison par id), pour que les nouvelles valeurs par défaut apparaissent sans doublon.
  for (const [nom, liste] of Object.entries(defaut.parametres.listes)) {
    if (!Array.isArray(j.parametres.listes[nom])) j.parametres.listes[nom] = structuredClone(liste);
  }
  for (const nom of ['sessions', 'plans', 'trades', 'campagnes', 'setupsNonPris', 'revues']) {
    if (!Array.isArray(j[nom])) j[nom] = [];
  }
  for (const t of j.trades) completer(t, nouveauTrade({ partie: t.partie === 'backtest' ? 'backtest' : 'reel' }));
  for (const s of j.sessions) completer(s, nouvelleSession({ partie: s.partie, date: s.date }));
  for (const p of j.plans) completer(p, nouveauPlan());
  return j;
}

// --- Accès aux listes ---

export function elementsActifs(liste, idCourant = null) {
  return (liste || []).filter((e) => !e.archive || e.id === idCourant);
}

export function nomDe(liste, id, defaut = '—') {
  if (id == null) return defaut;
  const e = (liste || []).find((x) => x.id === id);
  return e ? e.nom ?? e.texte : defaut;
}

/** Toutes les références d'images présentes dans le journal. */
export function cheminsImages(valeur, acc = new Set()) {
  if (typeof valeur === 'string') {
    if (valeur.startsWith('images/')) acc.add(valeur);
  } else if (Array.isArray(valeur)) {
    for (const v of valeur) cheminsImages(v, acc);
  } else if (estObjet(valeur)) {
    for (const v of Object.values(valeur)) cheminsImages(v, acc);
  }
  return acc;
}
