import { describe, it, expect } from 'vitest'
import { EVENT_KINDS, isBlocking, newEvent } from './events.js'

describe('contrat des evenements', () => {
  it('compte exactement onze evenements, ni plus ni moins', () => {
    // Le nombre est volontairement fige : ajouter un evenement oblige a
    // decider la scene correspondante dans l'interface.
    expect(EVENT_KINDS).toHaveLength(11)
  })

  it('bloque la session sur une demande de permission et sur un plan', () => {
    expect(isBlocking(newEvent('agent.asks', {
      sessionId: 's1', requestId: 'r1', toolName: 'Bash',
      summary: 'echo bonjour', detail: 'echo bonjour',
    }))).toBe(true)
    expect(isBlocking(newEvent('agent.plan', {
      sessionId: 's1', requestId: 'r2', plan: 'un plan',
    }))).toBe(true)
  })

  it('ne bloque pas sur une lecture de fichier', () => {
    expect(isBlocking(newEvent('agent.reads', {
      sessionId: 's1', path: 'bonjour.txt',
    }))).toBe(false)
  })

  it('horodate chaque evenement', () => {
    const e = newEvent('agent.said', { sessionId: 's1', text: 'bonjour' })
    expect(typeof e.at).toBe('number')
  })
})
