import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { startServer } from './server.js'

let racine: string
let serveur: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), 'codecity-srv-'))
  process.env.CODECITY_HOME = await mkdtemp(join(tmpdir(), 'codecity-home-'))
  await mkdir(join(racine, 'projet-test'), { recursive: true })
  await writeFile(join(racine, 'projet-test', 'package.json'), '{}', 'utf8')
  serveur = await startServer({ root: racine, port: 0 })
})

afterAll(async () => {
  await serveur.close()
  delete process.env.CODECITY_HOME
  await rm(racine, { recursive: true, force: true })
})

function demander(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    const prise = new WebSocket(`ws://127.0.0.1:${serveur.port}/flux`)
    const minuteur = setTimeout(() => { prise.close(); rejeter(new Error('delai depasse')) }, 5000)
    prise.on('open', () => prise.send(JSON.stringify(message)))
    prise.on('message', (donnees) => {
      clearTimeout(minuteur)
      prise.close()
      resoudre(JSON.parse(donnees.toString()))
    })
    prise.on('error', rejeter)
  })
}

describe('serveur', () => {
  it('repond a la sonde de sante', async () => {
    const reponse = await fetch(`http://127.0.0.1:${serveur.port}/sante`)
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).ok).toBe(true)
  })

  it('rend la liste des projets par le WebSocket', async () => {
    const reponse = await demander({ type: 'projects.list' })
    expect(reponse.type).toBe('projects')
    expect((reponse.projects as Array<{ name: string }>)[0]?.name).toBe('projet-test')
  })

  it('renvoie une erreur lisible sur un message inconnu', async () => {
    const reponse = await demander({ type: 'formate_le_disque' })
    expect(reponse.type).toBe('error')
  })

  it('renvoie une erreur si on demarre une session sur un projet inconnu', async () => {
    const reponse = await demander({
      type: 'session.start', projectId: 'jamais-vu', task: 'faire' })
    expect(reponse.type).toBe('error')
  })

  it('a ecrit son port et son pid dans runtime.json', async () => {
    const { readRuntime } = await import('./store.js')
    const info = await readRuntime()
    expect(info?.port).toBe(serveur.port)
    expect(info?.pid).toBe(process.pid)
  })
})
