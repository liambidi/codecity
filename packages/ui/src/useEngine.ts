/**
 * L'etat de l'ecran, et la connexion au moteur.
 *
 * Intention : la reduction est une fonction pure, testable sans navigateur ni
 * WebSocket. Le hook se contente de brancher la prise et de rejouer les
 * messages recus dans cette fonction.
 */
import { useEffect, useReducer, useRef, useCallback } from 'react'
import type { CityEvent } from '../../engine/src/events.js'
import type { ClientMessage, ServerMessage } from '../../engine/src/protocol.js'
import type { Project } from '../../engine/src/projects.js'
import type { FileChange } from '../../engine/src/diff.js'

export type PendingAsk = {
  requestId: string; toolName: string; summary: string; detail: string
}

export type EtatEcran = {
  projects: Project[]
  events: CityEvent[]
  pendingAsk: PendingAsk | null
  changes: FileChange[]
  running: boolean
  lastCostUsd: number | null
  error: string | null
}

export const etatInitial: EtatEcran = {
  projects: [], events: [], pendingAsk: null, changes: [],
  running: false, lastCostUsd: null, error: null,
}

export function reduire(etat: EtatEcran, message: ServerMessage): EtatEcran {
  switch (message.type) {
    case 'projects':
      return { ...etat, projects: message.projects }
    case 'diff':
      return { ...etat, changes: message.changes }
    case 'error':
      return { ...etat, error: message.message }
    case 'event': {
      const e = message.event
      const suivant: EtatEcran = { ...etat, events: [...etat.events, e], error: null }
      if (e.kind === 'session.started') {
        return { ...suivant, running: true, changes: [], lastCostUsd: null }
      }
      if (e.kind === 'agent.asks') {
        return { ...suivant, pendingAsk: {
          requestId: e.requestId, toolName: e.toolName,
          summary: e.summary, detail: e.detail } }
      }
      if (e.kind === 'agent.answered') return { ...suivant, pendingAsk: null }
      if (e.kind === 'session.ended') {
        return { ...suivant, running: false, pendingAsk: null, lastCostUsd: e.costUsd }
      }
      return suivant
    }
  }
}

export function useEngine(url: string) {
  const [etat, envoyerAuReducteur] = useReducer(reduire, etatInitial)
  const prise = useRef<WebSocket | null>(null)

  useEffect(() => {
    const connexion = new WebSocket(url)
    prise.current = connexion
    connexion.onopen = () => connexion.send(JSON.stringify({ type: 'projects.list' }))
    connexion.onmessage = (evenement) => {
      try {
        envoyerAuReducteur(JSON.parse(evenement.data) as ServerMessage)
      } catch {
        // Un message illisible ne doit pas casser l'ecran.
      }
    }
    return () => connexion.close()
  }, [url])

  const send = useCallback((message: ClientMessage) => {
    prise.current?.send(JSON.stringify(message))
  }, [])

  return { ...etat, send }
}
