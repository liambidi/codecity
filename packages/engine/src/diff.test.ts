import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles } from './diff.js'

const lancer = promisify(execFile)
let depot: string

beforeEach(async () => {
  depot = await mkdtemp(join(tmpdir(), 'codecity-diff-'))
  await lancer('git', ['init', '-b', 'main'], { cwd: depot })
  await lancer('git', ['config', 'user.email', 'test@local'], { cwd: depot })
  await lancer('git', ['config', 'user.name', 'test'], { cwd: depot })
  await writeFile(join(depot, 'a.txt'), 'ligne un\n', 'utf8')
  await lancer('git', ['add', '.'], { cwd: depot })
  await lancer('git', ['commit', '-m', 'depart'], { cwd: depot })
})

afterEach(async () => { await rm(depot, { recursive: true, force: true }) })

describe('fichiers modifies', () => {
  it('ne rapporte rien sur un depot propre', async () => {
    expect(await changedFiles(depot)).toEqual([])
  })

  it('rapporte un fichier modifie avec son diff', async () => {
    await writeFile(join(depot, 'a.txt'), 'ligne un\nligne deux\n', 'utf8')
    const changements = await changedFiles(depot)
    expect(changements).toHaveLength(1)
    expect(changements[0]?.path).toBe('a.txt')
    expect(changements[0]?.diff).toContain('ligne deux')
  })

  it('rapporte un fichier nouveau, que git diff ignorerait sans -N', async () => {
    await writeFile(join(depot, 'nouveau.txt'), 'contenu neuf\n', 'utf8')
    const changements = await changedFiles(depot)
    expect(changements.map((c) => c.path)).toContain('nouveau.txt')
    expect(changements.find((c) => c.path === 'nouveau.txt')?.diff).toContain('contenu neuf')
  })

  it('rend une liste vide sur un dossier sans depot git, sans jeter', async () => {
    const sansGit = await mkdtemp(join(tmpdir(), 'codecity-nogit-'))
    try {
      expect(await changedFiles(sansGit)).toEqual([])
    } finally {
      await rm(sansGit, { recursive: true, force: true })
    }
  })
})
