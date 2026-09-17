/**
 * Lancer une session d'agent et la raconter en evenements de codecity.
 *
 * Trois points non negociables, releves dans les types du SDK 0.3.274 :
 *
 * 1. Le prompt est un flux asynchrone, pas une chaine. C'est la seule facon
 *    d'avoir droit a `interrupt()`, donc au bouton d'arret.
 * 2. `canUseTool` recoit trois arguments positionnels, pas un objet.
 * 3. Un refus doit porter un `message`, le SDK le rend obligatoire.
 *
 * Ne jamais passer `--bare` ni definir ANTHROPIC_API_KEY ici : la session
 * doit passer par l'abonnement de Liam.
 */
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { newEvent, type CityEvent } from './events.js'
import { translateClaudeMessage } from './translators/claude.js'
import { PermissionGate } from './permissionGate.js'

export type AgentSessionOptions = {
  sessionId: string
  projectId: string
  projectPath: string
  task: string
}

export class AgentSession {
  readonly gate = new PermissionGate()
  private ecoutants: Array<(e: CityEvent) => void> = []
  private controleur = new AbortController()
  private flux: Query | null = null

  constructor(private readonly opts: AgentSessionOptions) {
    // Une demande de permission est elle-meme un evenement a jouer a l'ecran.
    this.gate.onAsk((demande) => {
      this.emettre(newEvent('agent.asks', {
        sessionId: this.opts.sessionId,
        requestId: demande.requestId,
        toolName: demande.toolName,
        summary: demande.summary,
        detail: demande.detail,
      }))
    })
  }

  onEvent(rappel: (e: CityEvent) => void): void {
    this.ecoutants.push(rappel)
  }

  private emettre(evenement: CityEvent): void {
    for (const ecoutant of this.ecoutants) ecoutant(evenement)
  }

  /**
   * Le prompt doit etre un flux. On envoie la tache, puis on laisse le flux
   * ouvert : le fermer trop tot couperait la session avant sa fin.
   */
  private async *entree(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: this.opts.task },
      parent_tool_use_id: null,
      session_id: this.opts.sessionId,
    } as SDKUserMessage
    // On attend l'abandon plutot que de rendre la main, pour garder le mode
    // entree continue actif jusqu'au bout.
    await new Promise<void>((resoudre) => {
      if (this.controleur.signal.aborted) return resoudre()
      this.controleur.signal.addEventListener('abort', () => resoudre(), { once: true })
    })
  }

  async start(): Promise<void> {
    this.emettre(newEvent('session.started', {
      sessionId: this.opts.sessionId,
      agentKind: 'claude',
      projectId: this.opts.projectId,
    }))

    this.flux = query({
      prompt: this.entree(),
      options: {
        cwd: this.opts.projectPath,
        abortController: this.controleur,
        includePartialMessages: false,
        canUseTool: (toolName, input, options) =>
          this.gate.ask(toolName, input, options.signal),
      },
    })

    try {
      for await (const message of this.flux) {
        for (const evenement of translateClaudeMessage(message, this.opts.sessionId)) {
          this.emettre(evenement)
          // La fin de session rendue par le SDK termine aussi notre flux d'entree.
          if (evenement.kind === 'session.ended') this.controleur.abort()
        }
      }
    } catch (erreur) {
      this.emettre(newEvent('agent.error', {
        sessionId: this.opts.sessionId,
        message: erreur instanceof Error ? erreur.message : String(erreur),
      }))
    } finally {
      this.gate.cancelAll('Session terminee.')
    }
  }

  answerPermission(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const accepte = this.gate.answer(requestId, decision, reason)
    if (accepte) {
      this.emettre(newEvent('agent.answered', {
        sessionId: this.opts.sessionId, requestId, decision,
      }))
    }
    return accepte
  }

  async interrupt(): Promise<void> {
    try {
      await this.flux?.interrupt()
    } finally {
      this.gate.cancelAll('Session interrompue par Liam.')
      this.controleur.abort()
    }
  }
}
