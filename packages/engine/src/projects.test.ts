import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProjects } from './projects.js'

let racine: string

async function creerDossier(nom: string, fichiers: string[]) {
  const chemin = join(racine, nom)
  await mkdir(chemin, { recursive: true })
  for (const f of fichiers) {
    await mkdir(join(chemin, f, '..'), { recursive: true }).catch(() => {})
    await writeFile(join(chemin, f), '', 'utf8')
  }
  return chemin
}

beforeEach(async () => { racine = await mkdtemp(join(tmpdir(), 'codecity-scan-')) })
afterEach(async () => { await rm(racine, { recursive: true, force: true }) })

describe('registre de projets', () => {
  it('reconnait un projet node a son package.json', async () => {
    await creerDossier('mon-site', ['package.json'])
    const projets = await scanProjects(racine)
    expect(projets.map((p) => p.kind)).toEqual(['node'])
  })

  it('reconnait un projet python a son requirements.txt', async () => {
    await creerDossier('mon-script', ['requirements.txt'])
    expect((await scanProjects(racine))[0]?.kind).toBe('python')
  })

  it('reconnait un projet web a son index.html', async () => {
    await creerDossier('ma-page', ['index.html'])
    expect((await scanProjects(racine))[0]?.kind).toBe('web')
  })

  it('signale la presence d un depot git', async () => {
    const chemin = await creerDossier('avec-git', ['package.json'])
    await mkdir(join(chemin, '.git'), { recursive: true })
    await creerDossier('sans-git', ['package.json'])
    const projets = await scanProjects(racine)
    expect(projets.find((p) => p.name === 'avec-git')?.hasGit).toBe(true)
    expect(projets.find((p) => p.name === 'sans-git')?.hasGit).toBe(false)
  })

  it('ignore les fichiers isoles et les dossiers vides', async () => {
    await writeFile(join(racine, 'note.pdf'), '', 'utf8')
    await mkdir(join(racine, 'dossier-vide'), { recursive: true })
    expect(await scanProjects(racine)).toEqual([])
  })

  it('ignore node_modules et les dossiers caches', async () => {
    await creerDossier('node_modules', ['package.json'])
    await creerDossier('.cache', ['package.json'])
    expect(await scanProjects(racine)).toEqual([])
  })

  it('rend une liste triee par nom, pour que l ordre ne bouge pas d une fois sur l autre', async () => {
    await creerDossier('zebre', ['package.json'])
    await creerDossier('abeille', ['package.json'])
    expect((await scanProjects(racine)).map((p) => p.name)).toEqual(['abeille', 'zebre'])
  })

  it('rend une liste vide plutot que de jeter si la racine n existe pas', async () => {
    expect(await scanProjects(join(racine, 'inexistant'))).toEqual([])
  })
})
