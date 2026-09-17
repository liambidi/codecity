import { describe, it, expect } from 'vitest'
import { reduire, etatInitial } from './useEngine.js'

describe('etat de l interface', () => {
  it('range les projets recus', () => {
    const e = reduire(etatInitial, { type: 'projects', projects: [
      { id: 'a', name: 'a', path: '/a', kind: 'node', hasGit: true }] })
    expect(e.projects).toHaveLength(1)
  })

  it('empile les evenements dans l ordre d arrivee', () => {
    let e = reduire(etatInitial, { type: 'event',
      event: { kind: 'agent.said', at: 1, sessionId: 's', text: 'un' } })
    e = reduire(e, { type: 'event',
      event: { kind: 'agent.reads', at: 2, sessionId: 's', path: 'a.txt' } })
    expect(e.events.map((x) => x.kind)).toEqual(['agent.said', 'agent.reads'])
  })

  it('retient la demande de permission en cours', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'agent.asks', at: 1, sessionId: 's', requestId: 'r1',
      toolName: 'Bash', summary: 'echo a', detail: '{}' } })
    expect(e.pendingAsk?.requestId).toBe('r1')
  })

  it('efface la demande une fois repondue', () => {
    let e = reduire(etatInitial, { type: 'event', event: {
      kind: 'agent.asks', at: 1, sessionId: 's', requestId: 'r1',
      toolName: 'Bash', summary: 'echo a', detail: '{}' } })
    e = reduire(e, { type: 'event', event: {
      kind: 'agent.answered', at: 2, sessionId: 's', requestId: 'r1', decision: 'allow' } })
    expect(e.pendingAsk).toBeNull()
  })

  it('marque la session terminee et retient le cout', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'session.ended', at: 1, sessionId: 's', reason: 'success',
      costUsd: 0.02, durationMs: 1000 } })
    expect(e.running).toBe(false)
    expect(e.lastCostUsd).toBe(0.02)
  })

  it('marque la session en cours au demarrage', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'session.started', at: 1, sessionId: 's',
      agentKind: 'claude', projectId: 'a' } })
    expect(e.running).toBe(true)
  })
})
