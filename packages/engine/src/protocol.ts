/**
 * Les seuls messages qui traversent le WebSocket.
 *
 * Intention : tout ce qui vient du navigateur est suspect, meme sur une machine
 * personnelle. On valide la forme ici, une fois, et le reste du moteur peut
 * faire confiance aux valeurs qu'il recoit.
 */
import type { CityEvent } from './events.js'
import type { Project } from './projects.js'
import type { FileChange } from './diff.js'

export type ClientMessage =
  | { type: 'projects.list' }
  | { type: 'session.start'; projectId: string; task: string }
  | { type: 'permission.answer'; requestId: string; decision: 'allow' | 'deny'; reason?: string }
  | { type: 'session.interrupt' }
  | { type: 'diff.request' }
  | { type: 'engine.stop' }

export type ServerMessage =
  | { type: 'projects'; projects: Project[] }
  | { type: 'event'; event: CityEvent }
  | { type: 'diff'; changes: FileChange[] }
  | { type: 'error'; message: string }

const chaine = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function parseClientMessage(brut: string): ClientMessage | null {
  let m: Record<string, unknown>
  try {
    const analyse = JSON.parse(brut)
    if (typeof analyse !== 'object' || analyse === null) return null
    m = analyse as Record<string, unknown>
  } catch {
    return null
  }

  switch (m.type) {
    case 'projects.list':
    case 'session.interrupt':
    case 'diff.request':
    case 'engine.stop':
      return { type: m.type }
    case 'session.start':
      return chaine(m.projectId) && chaine(m.task)
        ? { type: 'session.start', projectId: m.projectId, task: m.task }
        : null
    case 'permission.answer':
      if (!chaine(m.requestId)) return null
      if (m.decision !== 'allow' && m.decision !== 'deny') return null
      return {
        type: 'permission.answer',
        requestId: m.requestId,
        decision: m.decision,
        ...(chaine(m.reason) ? { reason: m.reason } : {}),
      }
    default:
      return null
  }
}
