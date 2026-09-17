/**
 * Le contrat central de codecity.
 *
 * Intention : tous les agents, quels qu'ils soient, sont traduits vers cette
 * liste unique. L'interface ne connait qu'elle. Ajouter un agent, c'est ecrire
 * un traducteur vers cette liste, et rien d'autre.
 *
 * Regle : aucun evenement n'est ajoute ici sans que la scene correspondante
 * soit decidee dans l'interface. Un evenement injouable est un evenement
 * inutile, et le test verrouille leur nombre pour forcer cette discussion.
 */

export const EVENT_KINDS = [
  'session.started',
  'agent.thinking',
  'agent.said',
  'agent.reads',
  'agent.writes',
  'agent.runs',
  'agent.asks',
  'agent.plan',
  'agent.answered',
  'agent.error',
  'session.ended',
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

export type EventPayloads = {
  'session.started': { sessionId: string; agentKind: string; projectId: string }
  'agent.thinking': { sessionId: string }
  'agent.said': { sessionId: string; text: string }
  'agent.reads': { sessionId: string; path: string }
  'agent.writes': { sessionId: string; path: string }
  'agent.runs': { sessionId: string; command: string }
  'agent.asks': {
    sessionId: string
    requestId: string
    toolName: string
    summary: string
    detail: string
  }
  'agent.plan': { sessionId: string; requestId: string; plan: string }
  'agent.answered': { sessionId: string; requestId: string; decision: 'allow' | 'deny' }
  'agent.error': { sessionId: string; message: string }
  'session.ended': {
    sessionId: string
    reason: string
    costUsd: number
    durationMs: number
  }
}

export type CityEvent = {
  [K in EventKind]: { kind: K; at: number } & EventPayloads[K]
}[EventKind]

/** Les evenements qui arretent reellement l'agent tant que Liam n'a pas repondu. */
const BLOCKING: ReadonlySet<EventKind> = new Set(['agent.asks', 'agent.plan'])

export function isBlocking(event: CityEvent): boolean {
  return BLOCKING.has(event.kind)
}

/** Fabrique un evenement horodate. Seul point de creation, pour que rien n'oublie `at`. */
export function newEvent<K extends EventKind>(
  kind: K,
  payload: EventPayloads[K],
): CityEvent {
  return { kind, at: Date.now(), ...payload } as CityEvent
}
