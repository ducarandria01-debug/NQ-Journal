// Outils des tests de bout en bout : lance un serveur sur un dossier temporaire et un navigateur.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function chargerPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return require(path.join(global, 'playwright'));
  }
}

function portLibre() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

export async function demarrer({ dossier } = {}) {
  const donnees = dossier || mkdtempSync(path.join(tmpdir(), 'nqj-e2e-'));
  const port = await portLibre();
  const proc = spawn('python3', ['journal.py', '--port', String(port), '--donnees', donnees, '--sans-navigateur'], {
    cwd: RACINE, stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${url}/api/sante`);
      if (r.ok) break;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const { chromium } = chargerPlaywright();
  const navigateur = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' });
  const contexte = await navigateur.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  return {
    url, page, contexte, navigateur, donnees, erreurs,
    async arreter({ garderDonnees = false } = {}) {
      await navigateur.close();
      proc.kill();
      if (!garderDonnees && !dossier) rmSync(donnees, { recursive: true, force: true });
    },
  };
}

/** Attend que le journal soit écrit sur le disque. */
export async function attendreEnregistrement(page) {
  await page.waitForFunction(() => document.getElementById('statut')?.textContent === 'Enregistré');
}

export async function lireJournal(url) {
  return (await (await fetch(`${url}/api/journal`)).json()).journal;
}

// Image PNG 1×1 valide.
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
