/**
 * Lister ce que l'agent a change, et le montrer.
 *
 * Intention : Liam doit pouvoir juger sur piece sans ouvrir son IDE. On passe
 * par git plutot que par une surveillance du systeme de fichiers, parce que git
 * sait deja distinguer un changement reel d'un fichier simplement touche.
 *
 * Piege evite : `git add --intent-to-add` est indispensable, sinon `git diff`
 * ignore silencieusement les fichiers nouveaux, et Liam ne verrait jamais un
 * fichier cree par l'agent.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const lancer = promisify(execFile)

export type FileChange = { path: string; status: string; diff: string }

export async function changedFiles(projectPath: string): Promise<FileChange[]> {
  try {
    await lancer('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath })
  } catch {
    // Pas de depot git : on ne sait rien dire, et ce n'est pas une erreur.
    return []
  }

  // Rendre les fichiers nouveaux visibles pour git diff, sans les mettre en index.
  await lancer('git', ['add', '--intent-to-add', '--all'], { cwd: projectPath })
    .catch(() => {})

  const { stdout: etat } = await lancer(
    'git', ['status', '--porcelain'], { cwd: projectPath })

  const changements: FileChange[] = []
  for (const ligne of etat.split('\n')) {
    if (!ligne.trim()) continue
    const status = ligne.slice(0, 2).trim()
    const chemin = ligne.slice(3).trim()
    const { stdout: diff } = await lancer(
      'git', ['diff', '--', chemin],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    ).catch(() => ({ stdout: '' }))
    changements.push({ path: chemin, status, diff })
  }
  return changements
}
