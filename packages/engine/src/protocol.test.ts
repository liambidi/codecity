import { describe, it, expect } from 'vitest'
import { parseClientMessage } from './protocol.js'

describe('lecture des messages du client', () => {
  it('accepte une demande de liste de projets', () => {
    expect(parseClientMessage('{"type":"projects.list"}'))
      .toEqual({ type: 'projects.list' })
  })

  it('accepte un demarrage de session', () => {
    expect(parseClientMessage('{"type":"session.start","projectId":"a","task":"faire"}'))
      .toEqual({ type: 'session.start', projectId: 'a', task: 'faire' })
  })

  it('accepte une reponse de permission avec sa raison', () => {
    expect(parseClientMessage(
      '{"type":"permission.answer","requestId":"r1","decision":"deny","reason":"non"}'))
      .toEqual({ type: 'permission.answer', requestId: 'r1', decision: 'deny', reason: 'non' })
  })

  it('rejette une decision qui n est ni allow ni deny', () => {
    expect(parseClientMessage(
      '{"type":"permission.answer","requestId":"r1","decision":"peut-etre"}')).toBeNull()
  })

  it('rejette un demarrage sans tache', () => {
    expect(parseClientMessage('{"type":"session.start","projectId":"a"}')).toBeNull()
  })

  it('rejette un type inconnu', () => {
    expect(parseClientMessage('{"type":"formate_le_disque"}')).toBeNull()
  })

  it('rejette du JSON invalide sans jeter', () => {
    expect(parseClientMessage('{ceci n est pas du json')).toBeNull()
  })
})
