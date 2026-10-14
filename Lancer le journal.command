#!/bin/bash
# NQ Journal — double-clique sur ce fichier pour lancer le journal (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 journal.py
fi
echo
echo "Python 3 n'est pas installé sur cet ordinateur."
echo "Installe-le depuis https://www.python.org/downloads/ puis relance ce fichier."
read -r -p "Appuie sur Entrée pour fermer."
