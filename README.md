# NQ Journal

Journal de trading personnel pour le NAS100 (méthode ICT, sessions de New York, M1 à M5).
100 % local et hors ligne : aucun compte, aucun serveur distant, tout reste sur ton ordinateur.

Objectif : mesurer si ton edge existe, et séparer les problèmes de **stratégie** des problèmes de **discipline**.

---

## 1. Lancer le journal

1. Installe **Python 3** une seule fois si ce n'est pas déjà fait : <https://www.python.org/downloads/>
   (sous Windows, coche « Add python.exe to PATH » pendant l'installation).
2. Double-clique sur :
   - **Windows** : `Lancer le journal.bat`
   - **macOS** : `Lancer le journal.command` (la première fois : clic droit → Ouvrir)
3. Le navigateur s'ouvre sur `http://127.0.0.1:8765`. Laisse la petite fenêtre de commande ouverte pendant
   que tu utilises le journal ; ferme-la (ou Ctrl+C) pour l'arrêter.

Relancer le fichier alors que le journal tourne déjà rouvre simplement l'onglet.
En ligne de commande : `python3 journal.py` (options : `--port 8765`, `--donnees <dossier>`, `--sans-navigateur`).

> Le petit programme Python n'écoute que ton ordinateur (`127.0.0.1`). Il sert uniquement à écrire tes
> fichiers sur le disque, ce qu'un navigateur ne sait pas faire de façon fiable tout seul.

---

## 2. Tes données

Tout est dans le dossier `donnees/` à côté de `journal.py` (jamais envoyé sur Internet, jamais dans Git) :

| Élément | Emplacement |
| --- | --- |
| Toutes les fiches (sessions, plans, trades, backtests, revues, paramètres) | `donnees/journal.json` |
| Screenshots et photos (de vrais fichiers image) | `donnees/images/AAAA-MM/` |
| Copie automatique quotidienne (30 derniers jours) | `donnees/sauvegardes/` |
| Images retirées des fiches, après nettoyage | `donnees/corbeille/` |

- **Enregistrement automatique** : chaque modification est écrite sur le disque une demi-seconde après
  (« Enregistré » en haut à droite). Ctrl+S force l'enregistrement.
- **Export en un clic** : Paramètres → « Exporter tout (ZIP) », ou le bouton du bandeau de rappel.
  Le ZIP contient le journal et toutes les images. Range-le sur une clé USB ou un autre disque.
- **Rappel** : un bandeau apparaît quand ton dernier export a plus de 7 jours (réglable).
- **Réimport** : Paramètres → « Réimporter un export… ». Un aperçu s'affiche ; ton journal actuel est
  sauvegardé (ZIP complet dans `donnees/sauvegardes/`) avant d'être remplacé.
- **Changer d'ordinateur** : exporte, copie le dossier de l'application sur le nouvel ordinateur, lance-le,
  puis réimporte le ZIP.
- **Mettre à jour l'application** : remplace tous les fichiers **sauf** le dossier `donnees/`.

---

## 3. Routine de trading (réel)

1. **Check-in de session** → « Faire le check-in du jour » : énergie (1 à 5), heures de sommeil,
   décision (« je trade » / « je ne trade pas »).
   « Je ne trade pas » respecté = **victoire de discipline**, même sans aucun trade.
2. **Vision du marché** : ajoute tes photos (clic, glisser-déposer ou **Ctrl+V** après une capture),
   avec leur timeframe ; biais HTF, liquidité visée, scénarios haussier et baissier.
3. **Juste avant d'entrer** → « + Plan de trade » : photo de l'entrée, scénario en une ou deux lignes,
   entrée / SL / TP, qualité A/B/C. L'horodatage est automatique et verrouillé 🔒 : c'est la preuve
   que le plan existait avant l'entrée.
4. **Tu prends le trade** → « Prendre le trade » : la fiche se préremplit depuis le plan. Plan non pris
   ou annulé ? Indique la raison. Un plan tranché est verrouillé (une correction reste possible, mais elle est signalée).
5. **Après le trade** : résultat, checklist (Bias HTF, Liquidité, Sweep, MSS, Displacement, zone d'entrée),
   discipline (le journal **propose** des réponses pour le biais, la checklist, la killzone, le risque
   et la limite de pertes du jour ; tu confirmes). Pour chaque règle cassée, choisis une raison.
6. **Notes** en deux temps : une ligne rapide pendant la session, l'analyse (ce qui a marché, ce qui a raté,
   ce que je referais) plus tard.
7. **Fin de session** : vision confirmée / partielle / invalidée, note générale, énergie de fin.

Un trade est **conforme** seulement si **toutes** les règles sont respectées. Un trade sans check-in est marqué
« sans check-in » : il compte dans les stats normales, pas dans celles liées à l'énergie.

### Import cTrader

Onglet **Trades** → « Importer cTrader… » : choisis l'export **Statement** de l'onglet **History**
(Excel ou CSV, plateforme en anglais, toutes les colonnes cochées).

- Les fermetures partielles (plusieurs lignes pour un même trade) sont regroupées.
- Réimporter le même fichier ne crée aucun doublon (contrôle par ID / Order ID).
- Le journal propose le plan et la session correspondants ; s'il y a plusieurs possibilités, il te demande de choisir.
- Le R est calculé avec le SL du plan et la taille ; à défaut, avec ton risque fixe par défaut.
- Les trades importés sont marqués « à compléter » (checklist, qualité, discipline, notes).
- Symboles : la correspondance (NAS100, US100, USTEC…) se règle dans Paramètres.

> ⚠ Le format exact de l'export cTrader reste à confirmer avec un vrai fichier : le parseur est
> volontairement tolérant en attendant.

---

## 4. Backtest (Forex Tester Online)

1. Onglet **Backtest** → « + Nouvelle campagne » : nom, période de marché, setups testés et **règles du
   test écrites avant de commencer**, puis « Figer les règles et commencer ».
2. « Session de backtest » : la session porte la **date réelle** du replay.
3. « + Trade de backtest » : chaque trade garde la **date du marché rejoué**. Coche « Regardé le futur »
   si c'est le cas : le trade est alors exclu des statistiques.
4. « + Setup non pris » : un setup présent que tu n'as pas pris (avec la raison). Il entre dans le
   **compteur d'occurrences**, pour ne pas gonfler les stats en ne gardant que les beaux trades.

Le backtest et le réel sont deux parties séparées, mais avec le même noyau de champs : le Dashboard les compare.

---

## 5. Dashboard

Tout est mesuré **en R**, pour comparer backtest et réel. Choisis Réel ou Backtest, la période, le compte
ou la campagne, et le setup.

- **Standard** : nombre de trades, winrate, RR moyen, expectancy, résultat en R et en %, drawdown max,
  taux de discipline, FVG vs OB, courbe des R cumulés, challenge Prop Firm (réel).
- **Expert** : en plus, profit factor, séries max, découpages (killzone, tranche horaire NY, setup,
  timeframe de zone, biais HTF, qualité, jour, long/short), éléments de checklist qui manquent le plus
  dans les pertes, expectancy conformes vs non conformes, R perdus hors règles (et par raison),
  discipline selon l'énergie, backtest vs réel par setup.
- Un **avertissement** s'affiche sous 30 trades (seuil réglable) : ne conclus rien trop vite.
- **Revue hebdomadaire** en bas : ce que j'ai bien fait, une chose à corriger, une règle à renforcer.

Le **calendrier** (onglet Check-in de session) montre chaque jour avec son résultat en R et sa couleur de discipline.

---

## 6. Paramètres utiles

- **Fuseau horaire** de saisie (les killzones restent toujours en heure de New York).
- **Risque fixe par défaut** (en % et en $), tolérance, **limite de pertes du jour** (en R).
- **Règles de discipline** : modifiables ; une règle archivée disparaît des nouveaux trades mais reste sur les anciens.
- **Listes fermées** : setups, types de zone (FVG, OB… extensible), timeframes, killzones, comptes, raisons.
- **Challenge Prop Firm** : taille du compte, drawdown max, objectif, jours minimum, date de début.
  Le drawdown est calculé de façon statique (pertes sous le capital de départ).

---

## Développement

- Interface : `app/` (HTML/CSS/JS sans framework ni étape de build). Logique pure testable :
  `modele.js`, `calculs.js`, `domaine.js`, `stats.js`, `ctrader.js`, `xlsx.js`, `temps.js`.
- Serveur : `journal.py` (bibliothèque standard Python uniquement).
- Tests : `npm test` (logique JS + serveur Python), `npm run test:e2e` (navigateur, nécessite Playwright).
- Fichier Excel cTrader synthétique pour les tests : `tests/fixtures/generer_xlsx.py`.
