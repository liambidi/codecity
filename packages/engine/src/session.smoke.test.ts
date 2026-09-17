import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { AgentSession } from './session.js'
import type { CityEvent } from './events.js'

describe('session reelle, consomme l abonnement', () => {
  it('parcourt la boucle du debut a la fin', async () => {
    const recus: CityEvent[] = []
    const session = new AgentSession({
      sessionId: 'fumee-1',
      projectId: 'projet-jouet',
      projectPath: join(process.cwd(), 'fixtures', 'projet-jouet'),
      task: 'Lis bonjour.txt et dis en une phrase ce qu il contient. N ecris aucun fichier.',
    })
    session.onEvent((e) => recus.push(e))
    await session.start()

    expect(recus[0]?.kind).toBe('session.started')
    expect(recus.some((e) => e.kind === 'agent.reads')).toBe(true)
    const fin = recus.find((e) => e.kind === 'session.ended')
    expect(fin).toBeDefined()
    expect((fin as { durationMs: number }).durationMs).toBeGreaterThan(0)
  }, 180_000)
})
