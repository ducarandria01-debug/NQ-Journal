# NQ Journal

Journal de trading personnel (NAS100, méthode ICT, sessions de New York), 100 % local et hors ligne.

## Lancer le journal

1. Installe **Python 3** une seule fois si ce n'est pas déjà fait : <https://www.python.org/downloads/>
   (sous Windows, coche « Add python.exe to PATH » pendant l'installation).
2. Double-clique sur :
   - **Windows** : `Lancer le journal.bat`
   - **macOS** : `Lancer le journal.command` (la première fois : clic droit → Ouvrir)
3. Le navigateur s'ouvre sur `http://127.0.0.1:8765`. Laisse la petite fenêtre noire ouverte pendant que tu
   utilises le journal ; ferme-la (ou Ctrl+C) pour l'arrêter.

En ligne de commande : `python3 journal.py` (options : `--port 8765`, `--donnees <dossier>`, `--sans-navigateur`).

## Où sont mes données ?

Tout est dans le dossier `donnees/` à côté de `journal.py` (jamais envoyé sur Internet, jamais dans Git) :

| Élément | Emplacement |
| --- | --- |
| Toutes les fiches (sessions, trades, plans, paramètres…) | `donnees/journal.json` |
| Screenshots et photos | `donnees/images/AAAA-MM/*.png` |
| Copie automatique quotidienne (30 jours) | `donnees/sauvegardes/` |

- **Export** : Paramètres → « Exporter tout (ZIP) » (ou depuis le bandeau de rappel). Le ZIP contient le journal et toutes
  les images. Range-le sur une clé USB ou un autre disque.
- **Réimport** : Paramètres → « Réimporter un export… ». Ton journal actuel est sauvegardé automatiquement avant d'être remplacé.

## Développement

- Interface : `app/` (HTML/CSS/JS sans framework ni étape de build).
- Serveur : `journal.py` (bibliothèque standard Python uniquement).
- Tests : `npm test` (logique + serveur), `npm run test:e2e` (navigateur, nécessite Playwright).
