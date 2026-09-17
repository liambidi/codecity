/**
 * L'enveloppe VS Code, volontairement bete.
 *
 * Intention : aucune logique metier ici. Si ce fichier disparait, codecity
 * reste pleinement utilisable dans un navigateur. L'extension se contente de
 * demarrer le moteur s'il dort, et d'afficher la page.
 */
import * as vscode from 'vscode'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT_PREFERE = 4317

async function portDuMoteur(): Promise<number | null> {
  try {
    const brut = await readFile(join(homedir(), '.codecity', 'runtime.json'), 'utf8')
    const info = JSON.parse(brut) as { port?: number }
    return typeof info.port === 'number' ? info.port : null
  } catch {
    return null
  }
}

async function moteurRepond(port: number): Promise<boolean> {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/sante`)
    return reponse.ok
  } catch {
    return false
  }
}

async function assurerMoteur(racineDepot: string): Promise<number | null> {
  const port = (await portDuMoteur()) ?? PORT_PREFERE
  if (await moteurRepond(port)) return port

  // Le moteur est detache : il doit survivre a la fermeture de VS Code.
  // On lance le JavaScript compile, pas la source, pour ne dependre que de node.
  const enfant = spawn(
    process.execPath,
    [join(racineDepot, 'packages', 'engine', 'dist', 'main.js')],
    { detached: true, stdio: 'ignore', cwd: racineDepot },
  )
  enfant.unref()

  for (let essai = 0; essai < 30; essai += 1) {
    await new Promise((r) => setTimeout(r, 300))
    const nouveau = (await portDuMoteur()) ?? PORT_PREFERE
    if (await moteurRepond(nouveau)) return nouveau
  }
  return null
}

export function activate(contexte: vscode.ExtensionContext) {
  const racineDepot = join(contexte.extensionPath, '..', '..')

  contexte.subscriptions.push(
    vscode.commands.registerCommand('codecity.ouvrir', async () => {
      const port = await assurerMoteur(racineDepot)
      if (port === null) {
        void vscode.window.showErrorMessage(
          'Le moteur codecity ne repond pas. Lancer npm run dev dans le depot.')
        return
      }
      const panneau = vscode.window.createWebviewPanel(
        'codecity', 'codecity', vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      )
      panneau.webview.html = `<!doctype html><html lang="fr"><head>
        <meta charset="utf-8" />
        <style>html,body,iframe{margin:0;height:100%;width:100%;border:0}</style>
        </head><body><iframe src="http://127.0.0.1:${port}/"></iframe></body></html>`
    }),

    vscode.commands.registerCommand('codecity.arreterMoteur', async () => {
      const port = (await portDuMoteur()) ?? PORT_PREFERE
      try {
        await fetch(`http://127.0.0.1:${port}/arret`, { method: 'POST' })
        void vscode.window.showInformationMessage('Moteur codecity arrete.')
      } catch {
        void vscode.window.showWarningMessage('Aucun moteur codecity ne repondait.')
      }
    }),

    vscode.commands.registerCommand('codecity.ouvrirDansChrome', async () => {
      const port = await assurerMoteur(racineDepot)
      if (port !== null) {
        void vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`))
      }
    }),
  )
}

export function deactivate() {
  // Volontairement vide : le moteur doit survivre a la fermeture de VS Code.
}
