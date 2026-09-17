/**
 * Tout ce que codecity garde sur disque.
 *
 * Intention : les donnees vivent dans le dossier `.codecity` du profil
 * utilisateur, jamais dans un depot, pour qu'aucun etat local ne parte dans un
 * commit. L'ecriture passe par un fichier temporaire puis un renommage, pour
 * qu'une coupure de courant ne laisse jamais un JSON a moitie ecrit.
 */
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RuntimeInfo = { port: number; pid: number; startedAt: number }

export function dataDir(): string {
  return process.env.CODECITY_HOME ?? join(homedir(), '.codecity')
}

export async function readJson<T>(nom: string, defaut: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir(), nom), 'utf8')) as T
  } catch {
    // Fichier absent ou illisible : la valeur par defaut vaut mieux qu'un plantage.
    return defaut
  }
}

export async function writeJson(nom: string, valeur: unknown): Promise<void> {
  const dossier = dataDir()
  await mkdir(dossier, { recursive: true })
  const cible = join(dossier, nom)
  const temporaire = `${cible}.${process.pid}.tmp`
  try {
    await writeFile(temporaire, JSON.stringify(valeur, null, 2), 'utf8')
    await rename(temporaire, cible)
  } catch (erreur) {
    await unlink(temporaire).catch(() => {})
    throw erreur
  }
}

export async function writeRuntime(info: RuntimeInfo): Promise<void> {
  await writeJson('runtime.json', info)
}

export async function readRuntime(): Promise<RuntimeInfo | null> {
  const brut = await readJson<unknown>('runtime.json', null)
  if (
    typeof brut !== 'object' || brut === null ||
    typeof (brut as RuntimeInfo).port !== 'number' ||
    typeof (brut as RuntimeInfo).pid !== 'number'
  ) {
    return null
  }
  return brut as RuntimeInfo
}
