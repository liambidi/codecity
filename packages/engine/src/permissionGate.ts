/**
 * Faire attendre l'agent jusqu'a ce que Liam reponde.
 *
 * Intention : c'est la piece qui transforme une demande de permission en un
 * vrai arret. Le SDK appelle `ask`, qui rend une promesse non resolue. Tant que
 * l'interface n'a pas appele `answer`, l'agent ne bouge pas. Aucune expiration
 * automatique : un delai qui refuserait tout seul serait pire que l'attente,
 * parce que Liam croirait avoir le temps de reflechir.
 */
import { randomUUID } from 'node:crypto'

export type PendingAsk = {
  requestId: string
  toolName: string
  summary: string
  detail: string
}

export type PermissionAnswer =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string }

type Attente = {
  demande: PendingAsk
  resoudre: (reponse: PermissionAnswer) => void
}

/** Resume court d'une demande, pour l'affichage synthetique dans l'interface. */
function resumer(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return `${toolName} : ${input.command}`
  if (typeof input.file_path === 'string') return `${toolName} : ${input.file_path}`
  return toolName
}

export class PermissionGate {
  private attentes = new Map<string, Attente>()
  private ecoutants: Array<(demande: PendingAsk) => void> = []

  onAsk(rappel: (demande: PendingAsk) => void): void {
    this.ecoutants.push(rappel)
  }

  ask(
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionAnswer> {
    const demande: PendingAsk = {
      requestId: randomUUID(),
      toolName,
      summary: resumer(toolName, input),
      detail: JSON.stringify(input, null, 2),
    }

    return new Promise<PermissionAnswer>((resoudre) => {
      this.attentes.set(demande.requestId, { demande, resoudre })

      // Une interruption de session doit liberer l'attente, sinon le moteur
      // garderait une promesse pendante pour toujours.
      const surAbandon = () => {
        if (this.attentes.delete(demande.requestId)) {
          resoudre({ behavior: 'deny', message: 'Session interrompue.' })
        }
      }
      if (signal.aborted) { surAbandon(); return }
      signal.addEventListener('abort', surAbandon, { once: true })

      for (const ecoutant of this.ecoutants) ecoutant(demande)
    })
  }

  answer(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const attente = this.attentes.get(requestId)
    if (!attente) return false
    this.attentes.delete(requestId)
    attente.resoudre(
      decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: reason ?? 'Refuse par Liam depuis codecity.' },
    )
    return true
  }

  pending(): PendingAsk[] {
    return [...this.attentes.values()].map((a) => a.demande)
  }

  cancelAll(raison: string): void {
    for (const [, attente] of this.attentes) {
      attente.resoudre({ behavior: 'deny', message: raison })
    }
    this.attentes.clear()
  }
}
