"""Tests du serveur local : stockage, images, export, réimport, sécurité."""

import datetime as dt
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import journal as serveur  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


class BaseServeur(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix="nqj-test-")
        self.srv = serveur.creer_serveur(self.dossier, 0)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        shutil.rmtree(self.dossier, ignore_errors=True)

    def requete(self, methode, chemin, corps=None, entetes=None, json_corps=None):
        url = f"http://127.0.0.1:{self.port}{chemin}"
        if json_corps is not None:
            corps = json.dumps(json_corps).encode()
            entetes = {**(entetes or {}), "Content-Type": "application/json"}
        req = urllib.request.Request(url, data=corps, method=methode, headers=entetes or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def json(self, methode, chemin, **kw):
        code, corps, _ = self.requete(methode, chemin, **kw)
        return code, json.loads(corps)

    def ecrire(self, journal, etag):
        return self.json("PUT", "/api/journal", json_corps={"etagBase": etag, "journal": journal})


class TestJournal(BaseServeur):
    def test_sante(self):
        code, corps = self.json("GET", "/api/sante")
        self.assertEqual(code, 200)
        self.assertEqual(corps["app"], "nq-journal")

    def test_journal_vide_puis_ecriture(self):
        code, corps = self.json("GET", "/api/journal")
        self.assertEqual(code, 200)
        self.assertIsNone(corps["journal"])
        self.assertEqual(corps["etag"], "vide")
        code, r = self.ecrire({"schemaVersion": 1, "trades": [{"id": "t1"}]}, "vide")
        self.assertEqual(code, 200)
        code, corps = self.json("GET", "/api/journal")
        self.assertEqual(corps["journal"]["trades"][0]["id"], "t1")
        self.assertEqual(corps["etag"], r["etag"])

    def test_conflit_si_etag_perime(self):
        _, r1 = self.ecrire({"schemaVersion": 1, "n": 1}, "vide")
        _, r2 = self.ecrire({"schemaVersion": 1, "n": 2}, r1["etag"])
        code, corps = self.ecrire({"schemaVersion": 1, "n": 3}, r1["etag"])
        self.assertEqual(code, 409)
        self.assertEqual(corps["etag"], r2["etag"])
        _, lu = self.json("GET", "/api/journal")
        self.assertEqual(lu["journal"]["n"], 2)

    def test_refuse_journal_invalide(self):
        code, _ = self.ecrire({"pas": "de version"}, "vide")
        self.assertEqual(code, 400)
        code, _ = self.ecrire([1, 2], "vide")
        self.assertEqual(code, 400)

    def test_sauvegarde_quotidienne(self):
        _, r1 = self.ecrire({"schemaVersion": 1, "n": 1}, "vide")
        sauvegardes = os.path.join(self.dossier, "sauvegardes")
        self.assertEqual(os.listdir(sauvegardes), [])  # rien à sauvegarder avant la 1re écriture
        _, r2 = self.ecrire({"schemaVersion": 1, "n": 2}, r1["etag"])
        self.ecrire({"schemaVersion": 1, "n": 3}, r2["etag"])
        fichiers = os.listdir(sauvegardes)
        self.assertEqual(fichiers, [f"journal-{dt.date.today().isoformat()}.json"])
        with open(os.path.join(sauvegardes, fichiers[0])) as f:
            self.assertEqual(json.load(f)["n"], 1)  # état d'avant la première modification du jour

    def test_rotation_des_sauvegardes(self):
        sauvegardes = os.path.join(self.dossier, "sauvegardes")
        for i in range(35):
            jour = dt.date(2025, 1, 1) + dt.timedelta(days=i)
            with open(os.path.join(sauvegardes, f"journal-{jour.isoformat()}.json"), "w") as f:
                f.write("{}")
        _, r1 = self.ecrire({"schemaVersion": 1}, "vide")
        self.ecrire({"schemaVersion": 1, "x": 1}, r1["etag"])
        restants = sorted(os.listdir(sauvegardes))
        self.assertEqual(len(restants), serveur.SAUVEGARDES_GARDEES)
        self.assertIn(f"journal-{dt.date.today().isoformat()}.json", restants)

    def test_ecriture_atomique_sans_fichier_temporaire_restant(self):
        self.ecrire({"schemaVersion": 1}, "vide")
        restes = [n for n in os.listdir(self.dossier) if n.startswith(".tmp-")]
        self.assertEqual(restes, [])


class TestImages(BaseServeur):
    def test_enregistre_et_sert_une_image(self):
        code, corps = self.json("POST", "/api/images", corps=PNG)
        self.assertEqual(code, 200)
        chemin = corps["chemin"]
        self.assertRegex(chemin, r"^images/\d{4}-\d{2}/[0-9a-f]{32}\.png$")
        self.assertTrue(os.path.isfile(os.path.join(self.dossier, chemin)))
        code, contenu, entetes = self.requete("GET", "/donnees/" + chemin)
        self.assertEqual(code, 200)
        self.assertEqual(contenu, PNG)
        self.assertEqual(entetes["Content-Type"], "image/png")

    def test_detecte_le_format(self):
        _, corps = self.json("POST", "/api/images", corps=JPG)
        self.assertTrue(corps["chemin"].endswith(".jpg"))

    def test_refuse_un_fichier_qui_nest_pas_une_image(self):
        code, corps = self.json("POST", "/api/images", corps=b"<script>alert(1)</script>")
        self.assertEqual(code, 400)
        self.assertIn("image", corps["erreur"])

    def test_bloque_la_sortie_du_dossier(self):
        with open(os.path.join(self.dossier, "journal.json"), "w") as f:
            f.write('{"schemaVersion":1}')
        for chemin in ("/donnees/images/../journal.json", "/donnees/images/%2e%2e/journal.json",
                       "/donnees/../journal.py", "/../journal.py"):
            code, _, _ = self.requete("GET", chemin)
            self.assertEqual(code, 404, chemin)

    def test_deplace_les_images_orphelines(self):
        _, a = self.json("POST", "/api/images", corps=PNG)
        _, b = self.json("POST", "/api/images", corps=PNG)
        self.ecrire({"schemaVersion": 1, "trades": [{"screenshots": {"avant": a["chemin"]}}]}, "vide")
        code, corps = self.json("POST", "/api/images/orphelines")
        self.assertEqual(code, 200)
        self.assertEqual(corps["deplacees"], [b["chemin"]])
        self.assertTrue(os.path.isfile(os.path.join(self.dossier, a["chemin"])))
        self.assertFalse(os.path.exists(os.path.join(self.dossier, b["chemin"])))
        self.assertTrue(os.path.isfile(os.path.join(self.dossier, corps["corbeille"], b["chemin"])))


class TestSecurite(BaseServeur):
    def test_refuse_un_autre_hote(self):
        code, _, _ = self.requete("GET", "/api/journal", entetes={"Host": "attaquant.example:8765"})
        self.assertEqual(code, 403)

    def test_refuse_une_autre_origine(self):
        code, _, _ = self.requete("PUT", "/api/journal", json_corps={"etagBase": "vide", "journal": {"schemaVersion": 1}},
                                  entetes={"Origin": "https://attaquant.example"})
        self.assertEqual(code, 403)
        self.assertFalse(os.path.exists(os.path.join(self.dossier, "journal.json")))

    def test_sert_l_interface(self):
        code, contenu, entetes = self.requete("GET", "/")
        self.assertEqual(code, 200)
        self.assertIn(b"NQ Journal", contenu)
        code, _, entetes = self.requete("GET", "/js/main.js")
        self.assertEqual(code, 200)
        self.assertIn("javascript", entetes["Content-Type"])


class TestExportImport(BaseServeur):
    def preparer(self):
        _, img = self.json("POST", "/api/images", corps=PNG)
        journal = {"schemaVersion": 1, "trades": [{"id": "t1", "screenshots": {"avant": img["chemin"]}}],
                   "sessions": [{"id": "s1"}, {"id": "s2"}]}
        self.ecrire(journal, "vide")
        return journal, img["chemin"]

    def exporter(self):
        code, contenu, entetes = self.requete("GET", "/api/export")
        self.assertEqual(code, 200)
        self.assertIn("attachment", entetes["Content-Disposition"])
        return contenu

    def test_export_contient_journal_et_images(self):
        journal, chemin = self.preparer()
        contenu = self.exporter()
        with zipfile.ZipFile(io.BytesIO(contenu)) as z:
            noms = z.namelist()
            self.assertIn("journal.json", noms)
            self.assertIn("manifest.json", noms)
            self.assertIn(chemin, noms)
            self.assertEqual(json.loads(z.read("journal.json")), journal)
            self.assertEqual(z.read(chemin), PNG)
        _, lu = self.json("GET", "/api/journal")
        self.assertIn("derniereExport", lu["etat"])
        self.assertEqual(os.listdir(os.path.join(self.dossier, "tmp")), [])

    def test_aller_retour_export_import(self):
        journal, chemin = self.preparer()
        contenu = self.exporter()
        # On modifie le journal puis on réimporte l'export : on doit retrouver l'état exporté.
        _, lu = self.json("GET", "/api/journal")
        self.ecrire({"schemaVersion": 1, "trades": []}, lu["etag"])
        os.remove(os.path.join(self.dossier, chemin))
        code, analyse = self.json("POST", "/api/import/analyse", corps=contenu)
        self.assertEqual(code, 200)
        self.assertEqual(analyse["apercu"]["compteurs"], {"trades": 1, "sessions": 2})
        self.assertEqual(analyse["apercu"]["nbImages"], 1)
        self.assertEqual(analyse["apercu"]["imagesManquantes"], [])
        code, r = self.json("POST", "/api/import/appliquer", json_corps={"jeton": analyse["jeton"]})
        self.assertEqual(code, 200)
        _, lu = self.json("GET", "/api/journal")
        self.assertEqual(lu["journal"], journal)
        self.assertEqual(lu["etag"], r["etag"])
        self.assertTrue(os.path.isfile(os.path.join(self.dossier, chemin)))
        # Sauvegarde de l'état d'avant l'import
        sauvegarde = os.path.join(self.dossier, r["sauvegarde"])
        with zipfile.ZipFile(sauvegarde) as z:
            self.assertEqual(json.loads(z.read("journal.json"))["trades"], [])

    def test_jeton_a_usage_unique(self):
        self.preparer()
        contenu = self.exporter()
        _, analyse = self.json("POST", "/api/import/analyse", corps=contenu)
        self.json("POST", "/api/import/appliquer", json_corps={"jeton": analyse["jeton"]})
        code, corps = self.json("POST", "/api/import/appliquer", json_corps={"jeton": analyse["jeton"]})
        self.assertEqual(code, 400)

    def zip_de(self, fichiers):
        tampon = io.BytesIO()
        with zipfile.ZipFile(tampon, "w") as z:
            for nom, contenu in fichiers.items():
                z.writestr(nom, contenu)
        return tampon.getvalue()

    def test_refuse_un_zip_sans_journal(self):
        code, corps = self.json("POST", "/api/import/analyse", corps=self.zip_de({"autre.txt": "x"}))
        self.assertEqual(code, 400)

    def test_refuse_un_zip_avec_chemin_dangereux(self):
        contenu = self.zip_de({"journal.json": '{"schemaVersion":1}', "../../evil.txt": "x"})
        code, corps = self.json("POST", "/api/import/analyse", corps=contenu)
        self.assertEqual(code, 400)
        self.assertIn("inattendus", corps["erreur"])

    def test_refuse_un_fichier_qui_nest_pas_un_zip(self):
        code, corps = self.json("POST", "/api/import/analyse", corps=b"bonjour")
        self.assertEqual(code, 400)
        self.assertIn("ZIP", corps["erreur"])

    def test_refuse_un_journal_sans_version(self):
        code, _ = self.json("POST", "/api/import/analyse", corps=self.zip_de({"journal.json": '{"trades":[]}'}))
        self.assertEqual(code, 400)

    def test_signale_les_images_manquantes(self):
        contenu = self.zip_de({"journal.json": json.dumps({"schemaVersion": 1, "trades": [{"a": "images/2026-01/x.png"}]})})
        code, analyse = self.json("POST", "/api/import/analyse", corps=contenu)
        self.assertEqual(code, 200)
        self.assertEqual(analyse["apercu"]["imagesManquantes"], ["images/2026-01/x.png"])



class TestLancement(BaseServeur):
    def test_detecte_un_journal_deja_lance(self):
        self.assertTrue(serveur.journal_deja_lance(self.port))
        self.assertFalse(serveur.port_libre(self.port))

    def test_second_lancement_ne_demarre_pas_un_autre_serveur(self):
        import contextlib
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie):
            code = serveur.main(["--port", str(self.port), "--donnees", self.dossier, "--sans-navigateur"])
        self.assertEqual(code, 0)
        self.assertIn("tourne déjà", sortie.getvalue())


if __name__ == "__main__":
    unittest.main()
