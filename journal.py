#!/usr/bin/env python3
"""NQ Journal — serveur local.

Sert l'interface (dossier app/) et écrit les données sur le disque
(dossier donnees/). N'écoute que sur 127.0.0.1 : rien ne sort de la machine.

Lancement : python journal.py   (options : --port, --donnees, --sans-navigateur)
"""

import argparse
import datetime as dt
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
import uuid
import webbrowser
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
NOM_APP = "nq-journal"
RACINE = os.path.dirname(os.path.abspath(__file__))
DOSSIER_APP = os.path.join(RACINE, "app")
PORT_DEFAUT = 8765

TAILLE_MAX_IMAGE = 40 * 1024 * 1024
TAILLE_MAX_JOURNAL = 200 * 1024 * 1024
TAILLE_MAX_IMPORT = 4 * 1024 * 1024 * 1024
SAUVEGARDES_GARDEES = 30

# Signatures des formats d'image acceptés.
SIGNATURES_IMAGES = {
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "gif": [b"GIF87a", b"GIF89a"],
    "webp": [b"RIFF"],
}

# Types forcés : sous Windows, le registre peut associer .js ou .css à text/plain,
# ce qui empêcherait le navigateur de charger l'interface.
for _type, _ext in (("text/javascript", ".js"), ("text/css", ".css"), ("text/html", ".html"),
                    ("image/svg+xml", ".svg"), ("font/woff2", ".woff2"), ("image/webp", ".webp"),
                    ("image/png", ".png"), ("image/jpeg", ".jpg"), ("image/gif", ".gif")):
    mimetypes.add_type(_type, _ext)


def maintenant_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ecrire_atomique(chemin, contenu):
    """Écrit dans un fichier temporaire puis remplace : jamais de fichier à moitié écrit."""
    dossier = os.path.dirname(chemin)
    fd, tmp = tempfile.mkstemp(dir=dossier, prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contenu)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, chemin)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def detecter_format_image(debut):
    for ext, signatures in SIGNATURES_IMAGES.items():
        for sig in signatures:
            if debut.startswith(sig):
                if ext == "webp" and debut[8:12] != b"WEBP":
                    continue
                return ext
    return None


def chemin_sur(base, relatif):
    """Résout `relatif` sous `base` en refusant toute sortie du dossier."""
    relatif = relatif.replace("\\", "/").lstrip("/")
    if not relatif or any(p in ("..", "") for p in relatif.split("/")):
        return None
    complet = os.path.realpath(os.path.join(base, relatif))
    base_reelle = os.path.realpath(base)
    if os.path.commonpath([complet, base_reelle]) != base_reelle:
        return None
    return complet


def nom_zip_valide(nom):
    if nom.startswith("/") or "\\" in nom or ":" in nom:
        return False
    parties = nom.split("/")
    if any(p in ("..", ".") for p in parties):
        return False
    if nom in ("journal.json", "manifest.json"):
        return True
    return parties[0] == "images"


class Stockage:
    """Toutes les opérations sur le dossier de données."""

    def __init__(self, dossier):
        self.dossier = os.path.abspath(dossier)
        self.fichier_journal = os.path.join(self.dossier, "journal.json")
        self.fichier_etat = os.path.join(self.dossier, "etat.json")
        self.dossier_images = os.path.join(self.dossier, "images")
        self.dossier_sauvegardes = os.path.join(self.dossier, "sauvegardes")
        self.dossier_tmp = os.path.join(self.dossier, "tmp")
        self.verrou = threading.RLock()
        for d in (self.dossier, self.dossier_images, self.dossier_sauvegardes, self.dossier_tmp):
            os.makedirs(d, exist_ok=True)
        self._nettoyer_tmp()

    def _nettoyer_tmp(self):
        for nom in os.listdir(self.dossier_tmp):
            chemin = os.path.join(self.dossier_tmp, nom)
            try:
                if os.path.isdir(chemin):
                    shutil.rmtree(chemin)
                else:
                    os.remove(chemin)
            except OSError:
                pass

    # --- état (dates d'export, etc.) ---
    def lire_etat(self):
        try:
            with open(self.fichier_etat, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def maj_etat(self, **valeurs):
        with self.verrou:
            etat = self.lire_etat()
            etat.update(valeurs)
            ecrire_atomique(self.fichier_etat, json.dumps(etat, ensure_ascii=False, indent=2).encode("utf-8"))
            return etat

    # --- journal ---
    def lire_journal(self):
        with self.verrou:
            if not os.path.exists(self.fichier_journal):
                return None, "vide"
            with open(self.fichier_journal, "rb") as f:
                brut = f.read()
            return json.loads(brut.decode("utf-8")), self._etag(brut)

    @staticmethod
    def _etag(brut):
        return hashlib.sha256(brut).hexdigest()[:20]

    def etag_actuel(self):
        if not os.path.exists(self.fichier_journal):
            return "vide"
        with open(self.fichier_journal, "rb") as f:
            return self._etag(f.read())

    def ecrire_journal(self, journal, etag_base):
        """Retourne (nouvel_etag, None) ou (None, etag_actuel) en cas de conflit."""
        if not isinstance(journal, dict) or not isinstance(journal.get("schemaVersion"), int):
            raise ValueError("Le journal doit être un objet avec un schemaVersion entier.")
        brut = json.dumps(journal, ensure_ascii=False, indent=1).encode("utf-8")
        with self.verrou:
            actuel = self.etag_actuel()
            if etag_base != actuel:
                return None, actuel
            self._sauvegarde_du_jour()
            ecrire_atomique(self.fichier_journal, brut)
            return self._etag(brut), None

    def _sauvegarde_du_jour(self):
        if not os.path.exists(self.fichier_journal):
            return
        jour = dt.date.today().isoformat()
        cible = os.path.join(self.dossier_sauvegardes, f"journal-{jour}.json")
        if os.path.exists(cible):
            return
        shutil.copy2(self.fichier_journal, cible)
        self.maj_etat(derniereSauvegardeAuto=maintenant_iso())
        anciennes = sorted(n for n in os.listdir(self.dossier_sauvegardes)
                           if re.fullmatch(r"journal-\d{4}-\d{2}-\d{2}\.json", n))
        for nom in anciennes[:-SAUVEGARDES_GARDEES]:
            os.remove(os.path.join(self.dossier_sauvegardes, nom))

    # --- images ---
    def enregistrer_image(self, contenu):
        ext = detecter_format_image(contenu[:16])
        if ext is None:
            raise ValueError("Format d'image non reconnu (PNG, JPG, GIF ou WEBP attendu).")
        mois = dt.date.today().strftime("%Y-%m")
        dossier = os.path.join(self.dossier_images, mois)
        os.makedirs(dossier, exist_ok=True)
        nom = f"{uuid.uuid4().hex}.{ext}"
        ecrire_atomique(os.path.join(dossier, nom), contenu)
        return f"images/{mois}/{nom}"

    def lister_images(self):
        resultat = []
        for dossier, _, fichiers in os.walk(self.dossier_images):
            for nom in fichiers:
                if nom.startswith("."):
                    continue
                complet = os.path.join(dossier, nom)
                resultat.append(os.path.relpath(complet, self.dossier).replace(os.sep, "/"))
        return sorted(resultat)

    def deplacer_orphelines(self, references):
        """Déplace dans donnees/corbeille/ les images non référencées par le journal."""
        refs = set(references)
        corbeille = os.path.join(self.dossier, "corbeille", dt.datetime.now().strftime("%Y-%m-%d_%H%M%S"))
        deplacees = []
        with self.verrou:
            for rel in self.lister_images():
                if rel not in refs:
                    cible = os.path.join(corbeille, rel)
                    os.makedirs(os.path.dirname(cible), exist_ok=True)
                    shutil.move(os.path.join(self.dossier, rel), cible)
                    deplacees.append(rel)
        return deplacees, (corbeille if deplacees else None)

    # --- export / import ---
    def creer_zip(self, destination):
        with self.verrou:
            journal, _ = self.lire_journal()
            images = self.lister_images()
            manifeste = {
                "app": NOM_APP,
                "versionApp": VERSION,
                "exporteLe": maintenant_iso(),
                "schemaVersion": (journal or {}).get("schemaVersion"),
                "nbImages": len(images),
            }
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("manifest.json", json.dumps(manifeste, ensure_ascii=False, indent=2))
                if journal is not None:
                    z.write(self.fichier_journal, "journal.json")
                for rel in images:
                    # Les images sont déjà compressées : on les stocke telles quelles.
                    z.write(os.path.join(self.dossier, rel), rel, compress_type=zipfile.ZIP_STORED)
        return manifeste

    def exporter(self):
        fd, chemin = tempfile.mkstemp(dir=self.dossier_tmp, suffix=".zip")
        os.close(fd)
        self.creer_zip(chemin)
        self.maj_etat(derniereExport=maintenant_iso())
        return chemin

    def analyser_import(self, chemin_zip):
        """Vérifie un ZIP d'export et retourne un aperçu. Lève ValueError si invalide."""
        if not zipfile.is_zipfile(chemin_zip):
            raise ValueError("Ce fichier n'est pas un ZIP valide.")
        with zipfile.ZipFile(chemin_zip) as z:
            noms = [i.filename for i in z.infolist() if not i.is_dir()]
            invalides = [n for n in noms if not nom_zip_valide(n)]
            if invalides:
                raise ValueError("Le ZIP contient des fichiers inattendus : " + ", ".join(invalides[:5]))
            if "journal.json" not in noms:
                raise ValueError("Le ZIP ne contient pas de journal.json : ce n'est pas un export du journal.")
            try:
                journal = json.loads(z.read("journal.json").decode("utf-8"))
            except ValueError:
                raise ValueError("Le fichier journal.json du ZIP est illisible.")
            if not isinstance(journal, dict) or not isinstance(journal.get("schemaVersion"), int):
                raise ValueError("Le journal.json du ZIP n'a pas le bon format (schemaVersion manquant).")
            manifeste = {}
            if "manifest.json" in noms:
                try:
                    manifeste = json.loads(z.read("manifest.json").decode("utf-8"))
                except ValueError:
                    manifeste = {}
            images = [n for n in noms if n.startswith("images/")]
            erreur = z.testzip()
            if erreur:
                raise ValueError(f"Le ZIP est corrompu (fichier {erreur}).")
        compteurs = {k: len(v) for k, v in journal.items() if isinstance(v, list)}
        return {
            "schemaVersion": journal["schemaVersion"],
            "exporteLe": manifeste.get("exporteLe"),
            "compteurs": compteurs,
            "nbImages": len(images),
            "imagesManquantes": sorted(set(chemins_images(journal)) - set(images))[:20],
        }

    def appliquer_import(self, chemin_zip):
        self.analyser_import(chemin_zip)
        with self.verrou:
            horodatage = dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
            sauvegarde = os.path.join(self.dossier_sauvegardes, f"avant-import-{horodatage}.zip")
            self.creer_zip(sauvegarde)
            extraction = tempfile.mkdtemp(dir=self.dossier_tmp, prefix="import-")
            with zipfile.ZipFile(chemin_zip) as z:
                for info in z.infolist():
                    if info.is_dir() or not nom_zip_valide(info.filename):
                        continue
                    cible = chemin_sur(extraction, info.filename)
                    if cible is None:
                        continue
                    os.makedirs(os.path.dirname(cible), exist_ok=True)
                    with z.open(info) as src, open(cible, "wb") as dst:
                        shutil.copyfileobj(src, dst)
            nouvelles_images = os.path.join(extraction, "images")
            os.makedirs(nouvelles_images, exist_ok=True)
            anciennes = os.path.join(self.dossier_tmp, f"anciennes-images-{horodatage}")
            os.replace(self.dossier_images, anciennes)
            os.replace(nouvelles_images, self.dossier_images)
            with open(os.path.join(extraction, "journal.json"), "rb") as f:
                ecrire_atomique(self.fichier_journal, f.read())
            shutil.rmtree(anciennes, ignore_errors=True)
            shutil.rmtree(extraction, ignore_errors=True)
            return self.etag_actuel(), sauvegarde


def chemins_images(valeur):
    """Toutes les chaînes 'images/...' présentes dans le journal (où qu'elles soient)."""
    if isinstance(valeur, str):
        if valeur.startswith("images/"):
            yield valeur
    elif isinstance(valeur, dict):
        for v in valeur.values():
            yield from chemins_images(v)
    elif isinstance(valeur, list):
        for v in valeur:
            yield from chemins_images(v)


class Gestionnaire(BaseHTTPRequestHandler):
    server_version = "NQJournal/" + VERSION
    stockage: Stockage = None  # défini au démarrage
    imports_en_attente = {}

    def log_message(self, format, *args):
        if os.environ.get("NQ_JOURNAL_LOG"):
            super().log_message(format, *args)

    # --- utilitaires ---
    def _hote_autorise(self):
        """Refuse les requêtes venant d'un autre site (protection DNS rebinding / CSRF)."""
        hote = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if hote not in ("127.0.0.1", "localhost"):
            return False
        origine = self.headers.get("Origin")
        if origine:
            hote_origine = urllib.parse.urlparse(origine).hostname
            if hote_origine not in ("127.0.0.1", "localhost"):
                return False
        return True

    def _json(self, code, donnees):
        brut = json.dumps(donnees, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(brut)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(brut)

    def _erreur(self, code, message):
        self._json(code, {"erreur": message})

    def _lire_corps(self, limite):
        longueur = int(self.headers.get("Content-Length") or 0)
        if longueur > limite:
            raise ValueError("Fichier trop volumineux.")
        return self.rfile.read(longueur)

    def _lire_corps_vers_fichier(self, limite):
        longueur = int(self.headers.get("Content-Length") or 0)
        if longueur <= 0:
            raise ValueError("Fichier vide.")
        if longueur > limite:
            raise ValueError("Fichier trop volumineux.")
        fd, chemin = tempfile.mkstemp(dir=self.stockage.dossier_tmp, suffix=".zip")
        restant = longueur
        with os.fdopen(fd, "wb") as f:
            while restant > 0:
                bloc = self.rfile.read(min(1024 * 1024, restant))
                if not bloc:
                    break
                f.write(bloc)
                restant -= len(bloc)
        return chemin

    def _envoyer_fichier(self, chemin, type_contenu=None, nom_telechargement=None):
        if not chemin or not os.path.isfile(chemin):
            self._erreur(HTTPStatus.NOT_FOUND, "Introuvable.")
            return
        taille = os.path.getsize(chemin)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", type_contenu or mimetypes.guess_type(chemin)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(taille))
        self.send_header("Cache-Control", "no-store")
        if nom_telechargement:
            self.send_header("Content-Disposition", f'attachment; filename="{nom_telechargement}"')
        self.end_headers()
        with open(chemin, "rb") as f:
            shutil.copyfileobj(f, self.wfile)

    # --- routes ---
    def do_GET(self):
        if not self._hote_autorise():
            return self._erreur(HTTPStatus.FORBIDDEN, "Hôte non autorisé.")
        url = urllib.parse.urlparse(self.path)
        chemin = urllib.parse.unquote(url.path)
        try:
            if chemin == "/api/sante":
                return self._json(200, {"app": NOM_APP, "version": VERSION})
            if chemin == "/api/journal":
                journal, etag = self.stockage.lire_journal()
                return self._json(200, {"journal": journal, "etag": etag, "etat": self.stockage.lire_etat(),
                                        "dossierDonnees": self.stockage.dossier})
            if chemin == "/api/export":
                fichier = self.stockage.exporter()
                try:
                    nom = f"NQ-Journal-export-{dt.date.today().isoformat()}.zip"
                    self._envoyer_fichier(fichier, "application/zip", nom)
                finally:
                    os.remove(fichier)
                return
            if chemin.startswith("/donnees/images/"):
                cible = chemin_sur(self.stockage.dossier, chemin[len("/donnees/"):])
                return self._envoyer_fichier(cible)
            if chemin == "/" or chemin == "":
                chemin = "/index.html"
            return self._envoyer_fichier(chemin_sur(DOSSIER_APP, chemin))
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_PUT(self):
        if not self._hote_autorise():
            return self._erreur(HTTPStatus.FORBIDDEN, "Hôte non autorisé.")
        if urllib.parse.urlparse(self.path).path != "/api/journal":
            return self._erreur(HTTPStatus.NOT_FOUND, "Introuvable.")
        try:
            corps = json.loads(self._lire_corps(TAILLE_MAX_JOURNAL).decode("utf-8"))
            etag, conflit = self.stockage.ecrire_journal(corps.get("journal"), corps.get("etagBase"))
        except ValueError as e:
            return self._erreur(HTTPStatus.BAD_REQUEST, str(e))
        if conflit:
            return self._json(HTTPStatus.CONFLICT, {"erreur": "Le journal a été modifié ailleurs (autre onglet ?).",
                                                    "etag": conflit})
        return self._json(200, {"etag": etag})

    def do_POST(self):
        if not self._hote_autorise():
            return self._erreur(HTTPStatus.FORBIDDEN, "Hôte non autorisé.")
        chemin = urllib.parse.urlparse(self.path).path
        try:
            if chemin == "/api/images":
                contenu = self._lire_corps(TAILLE_MAX_IMAGE)
                return self._json(200, {"chemin": self.stockage.enregistrer_image(contenu)})
            if chemin == "/api/import/analyse":
                fichier = self._lire_corps_vers_fichier(TAILLE_MAX_IMPORT)
                try:
                    apercu = self.stockage.analyser_import(fichier)
                except Exception:
                    os.remove(fichier)
                    raise
                jeton = uuid.uuid4().hex
                self.imports_en_attente[jeton] = fichier
                return self._json(200, {"jeton": jeton, "apercu": apercu})
            if chemin == "/api/import/appliquer":
                corps = json.loads(self._lire_corps(10_000).decode("utf-8"))
                fichier = self.imports_en_attente.pop(corps.get("jeton"), None)
                if not fichier or not os.path.exists(fichier):
                    return self._erreur(HTTPStatus.BAD_REQUEST, "Import expiré : sélectionne à nouveau le fichier.")
                try:
                    etag, sauvegarde = self.stockage.appliquer_import(fichier)
                finally:
                    if os.path.exists(fichier):
                        os.remove(fichier)
                return self._json(200, {"etag": etag, "sauvegarde": os.path.relpath(sauvegarde, self.stockage.dossier)})
            if chemin == "/api/images/orphelines":
                journal, _ = self.stockage.lire_journal()
                deplacees, corbeille = self.stockage.deplacer_orphelines(chemins_images(journal or {}))
                return self._json(200, {"deplacees": deplacees,
                                        "corbeille": corbeille and os.path.relpath(corbeille, self.stockage.dossier)})
        except ValueError as e:
            return self._erreur(HTTPStatus.BAD_REQUEST, str(e))
        return self._erreur(HTTPStatus.NOT_FOUND, "Introuvable.")


def journal_deja_lance(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sante", timeout=1) as r:
            return json.load(r).get("app") == NOM_APP
    except Exception:
        return False


def port_libre(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def creer_serveur(dossier_donnees, port):
    Gestionnaire.stockage = Stockage(dossier_donnees)
    Gestionnaire.imports_en_attente = {}
    serveur = ThreadingHTTPServer(("127.0.0.1", port), Gestionnaire)
    serveur.daemon_threads = True
    return serveur


def main(argv=None):
    p = argparse.ArgumentParser(description="NQ Journal — journal de trading local.")
    p.add_argument("--port", type=int, default=PORT_DEFAUT)
    p.add_argument("--donnees", default=os.environ.get("NQ_JOURNAL_DONNEES", os.path.join(RACINE, "donnees")),
                   help="Dossier des données (par défaut : donnees/ à côté de ce fichier).")
    p.add_argument("--sans-navigateur", action="store_true", help="Ne pas ouvrir le navigateur.")
    args = p.parse_args(argv)

    port = args.port
    if journal_deja_lance(port):
        print(f"Le journal tourne déjà : http://127.0.0.1:{port}")
        if not args.sans_navigateur:
            webbrowser.open(f"http://127.0.0.1:{port}")
        return 0
    for essai in range(port, port + 20):
        if port_libre(essai):
            port = essai
            break
    else:
        print("Aucun port libre trouvé.", file=sys.stderr)
        return 1

    serveur = creer_serveur(args.donnees, port)
    url = f"http://127.0.0.1:{port}"
    print("NQ Journal est lancé.")
    print(f"  Adresse : {url}")
    print(f"  Données : {Gestionnaire.stockage.dossier}")
    print("Laisse cette fenêtre ouverte pendant que tu utilises le journal. Ctrl+C pour arrêter.")
    if not args.sans_navigateur:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nJournal arrêté.")
    finally:
        serveur.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
