/**
 * Detecter les projets presents dans un dossier racine.
 *
 * Intention : Liam ne doit rien declarer a la main. On regarde le premier niveau
 * de dossiers, et un dossier compte comme projet s'il porte un marqueur connu.
 * On ne descend pas plus bas, pour que le scan reste instantane meme sur un
 * dossier dev bien rempli.
 */
import { readdir, access } from 'node:fs/promises'
import { join } from 'node:path'

export type Project = {
  id: string
  name: string
  path: string
  kind: 'node' | 'python' | 'web' | 'autre'
  hasGit: boolean
}

/** Marqueurs testes dans l'ordre : le premier trouve decide du type. */
const MARQUEURS: ReadonlyArray<[string, Project['kind']]> = [
  ['package.json', 'node'],
  ['requirements.txt', 'python'],
  ['pyproject.toml', 'python'],
  ['index.html', 'web'],
]

async function existe(chemin: string): Promise<boolean> {
  try {
    await access(chemin)
    return true
  } catch {
    return false
  }
}

export async function scanProjects(racine: string): Promise<Project[]> {
  let entrees
  try {
    entrees = await readdir(racine, { withFileTypes: true })
  } catch {
    // Racine absente ou illisible : aucune raison de faire tomber le moteur.
    return []
  }

  const projets: Project[] = []
  for (const entree of entrees) {
    if (!entree.isDirectory()) continue
    if (entree.name.startsWith('.') || entree.name === 'node_modules') continue

    const chemin = join(racine, entree.name)
    let kind: Project['kind'] | null = null
    for (const [fichier, type] of MARQUEURS) {
      if (await existe(join(chemin, fichier))) { kind = type; break }
    }

    const hasGit = await existe(join(chemin, '.git'))
    // Un dossier sans marqueur mais avec un depot git reste un projet : c'est le
    // cas de beaucoup de depots de Liam qui ne sont ni node ni python.
    if (kind === null && !hasGit) continue

    projets.push({
      id: entree.name,
      name: entree.name,
      path: chemin,
      kind: kind ?? 'autre',
      hasGit,
    })
  }

  return projets.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
