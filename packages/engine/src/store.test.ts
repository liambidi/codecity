import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir, readJson, writeJson, writeRuntime, readRuntime } from './store.js'

let maison: string

beforeEach(async () => {
  maison = await mkdtemp(join(tmpdir(), 'codecity-test-'))
  process.env.CODECITY_HOME = maison
})

afterEach(async () => {
  delete process.env.CODECITY_HOME
  await rm(maison, { recursive: true, force: true })
})

describe('magasin de fichiers', () => {
  it('obeit a CODECITY_HOME', () => {
    expect(dataDir()).toBe(maison)
  })

  it('rend la valeur par defaut quand le fichier n existe pas', async () => {
    expect(await readJson('projects.json', [])).toEqual([])
  })

  it('relit ce qu il a ecrit', async () => {
    await writeJson('projects.json', [{ id: 'a', name: 'projet a' }])
    expect(await readJson('projects.json', [])).toEqual([{ id: 'a', name: 'projet a' }])
  })

  it('ne laisse aucun fichier temporaire derriere lui', async () => {
    await writeJson('projects.json', [{ id: 'a' }])
    const restes = (await readdir(maison)).filter((f) => f.includes('.tmp'))
    expect(restes).toEqual([])
  })

  it('nettoie le fichier temporaire en cas d echec d ecriture ou renommage', async () => {
    // Intention : si rename() echoue (par exemple, la cible est un repertoire),
    // le fichier temporaire doit etre supprime et l'erreur doit etre relancee.
    // On cree un repertoire a la place du fichier cible pour forcer l'echec.
    const nomFichier = 'projects.json'
    const cheminCible = join(maison, nomFichier)
    await mkdir(cheminCible, { recursive: true })

    // Tenter d'ecrire doit echouer (EISDIR: cannot rename file to directory)
    // et doit nettoyer le fichier temporaire.
    let erreurCapturee = false
    try {
      await writeJson(nomFichier, [{ id: 'a' }])
    } catch (e) {
      erreurCapturee = true
    }

    expect(erreurCapturee).toBe(true)

    // Verifier que aucun fichier temporaire ne reste.
    const restes = (await readdir(maison)).filter((f) => f.includes('.tmp'))
    expect(restes).toEqual([])
  })

  it('rend null quand aucun moteur ne tourne', async () => {
    expect(await readRuntime()).toBeNull()
  })

  it('relit le port et le pid du moteur', async () => {
    await writeRuntime({ port: 4317, pid: 1234, startedAt: 1 })
    expect(await readRuntime()).toEqual({ port: 4317, pid: 1234, startedAt: 1 })
  })

  it('rend null plutot que de jeter quand runtime.json est illisible', async () => {
    await writeJson('runtime.json', 'ceci n est pas un objet runtime')
    // Intention : un fichier corrompu ne doit jamais empecher le moteur de demarrer.
    expect(await readRuntime()).toBeNull()
  })
})
