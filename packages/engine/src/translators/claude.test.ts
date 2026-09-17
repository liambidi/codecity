import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  translateClaudeMessage,
  countUntranslated,
  resetUntranslated,
} from './claude.js'

function messageAssistant(blocs: unknown[]) {
  return { type: 'assistant', message: { content: blocs }, session_id: 'x' }
}

beforeEach(() => resetUntranslated())

describe('traducteur Claude, cas unitaires', () => {
  it('traduit un bloc de texte en agent.said', () => {
    const e = translateClaudeMessage(
      messageAssistant([{ type: 'text', text: 'bonjour' }]), 's1')
    expect(e).toEqual([expect.objectContaining({ kind: 'agent.said', text: 'bonjour' })])
  })

  it('traduit un bloc de reflexion en agent.thinking', () => {
    const e = translateClaudeMessage(
      messageAssistant([{ type: 'thinking', thinking: '' }]), 's1')
    expect(e[0]?.kind).toBe('agent.thinking')
  })

  it('traduit Read, Glob et Grep en agent.reads', () => {
    for (const nom of ['Read', 'Glob', 'Grep']) {
      const e = translateClaudeMessage(messageAssistant([
        { type: 'tool_use', name: nom, input: { file_path: 'a.txt' } }]), 's1')
      expect(e[0]?.kind).toBe('agent.reads')
    }
  })

  it('traduit Write et Edit en agent.writes avec le chemin', () => {
    const e = translateClaudeMessage(messageAssistant([
      { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } }]), 's1')
    expect(e[0]).toMatchObject({ kind: 'agent.writes', path: 'src/a.ts' })
  })

  it('traduit Bash en agent.runs avec la commande', () => {
    const e = translateClaudeMessage(messageAssistant([
      { type: 'tool_use', name: 'Bash', input: { command: 'echo termine' } }]), 's1')
    expect(e[0]).toMatchObject({ kind: 'agent.runs', command: 'echo termine' })
  })

  it('traduit ExitPlanMode en agent.plan', () => {
    const e = translateClaudeMessage(messageAssistant([
      { type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: { plan: 'mon plan' } }]), 's1')
    expect(e[0]).toMatchObject({ kind: 'agent.plan', plan: 'mon plan' })
  })

  it('traduit le resultat final en session.ended avec le cout et la duree', () => {
    const e = translateClaudeMessage({
      type: 'result', subtype: 'success', total_cost_usd: 0.0123,
      duration_ms: 4567, is_error: false,
    }, 's1')
    expect(e[0]).toMatchObject({
      kind: 'session.ended', reason: 'success', costUsd: 0.0123, durationMs: 4567,
    })
  })

  it('traduit un resultat en erreur sans perdre la raison', () => {
    const e = translateClaudeMessage({
      type: 'result', subtype: 'error_during_execution',
      total_cost_usd: 0, duration_ms: 12, is_error: true,
    }, 's1')
    expect(e[0]).toMatchObject({ kind: 'session.ended', reason: 'error_during_execution' })
  })

  it('traduit plusieurs blocs d un meme message en plusieurs evenements', () => {
    const e = translateClaudeMessage(messageAssistant([
      { type: 'text', text: 'je lis' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'a.txt' } },
    ]), 's1')
    expect(e.map((x) => x.kind)).toEqual(['agent.said', 'agent.reads'])
  })

  it('ignore un message inconnu et incremente le compteur de dette', () => {
    expect(translateClaudeMessage({ type: 'zoinx_inconnu' }, 's1')).toEqual([])
    expect(countUntranslated()).toBe(1)
  })

  it('ne jette jamais sur une entree malformee', () => {
    expect(() => translateClaudeMessage(null, 's1')).not.toThrow()
    expect(() => translateClaudeMessage({ type: 'assistant' }, 's1')).not.toThrow()
  })

  it('porte le sessionId de codecity, pas celui du SDK', () => {
    const e = translateClaudeMessage(messageAssistant([{ type: 'text', text: 'a' }]), 'mien')
    expect(e[0]?.sessionId).toBe('mien')
  })
})

describe('traducteur Claude, contre la session reelle enregistree', () => {
  const chemin = join(process.cwd(), 'fixtures', 'claude-lecture-commande.jsonl')
  const lignes = readFileSync(chemin, 'utf8').split('\n').filter((l) => l.trim())
  const evenements = lignes.flatMap((l) => translateClaudeMessage(JSON.parse(l), 'reel'))

  it('produit au moins une lecture de fichier', () => {
    expect(evenements.some((e) => e.kind === 'agent.reads')).toBe(true)
  })

  it('produit au moins une commande lancee', () => {
    expect(evenements.some((e) => e.kind === 'agent.runs')).toBe(true)
  })

  it('produit exactement une fin de session, avec un cout chiffre', () => {
    const fins = evenements.filter((e) => e.kind === 'session.ended')
    expect(fins).toHaveLength(1)
    expect(typeof (fins[0] as { costUsd: number }).costUsd).toBe('number')
  })

  it('laisse moins de 20 pour cent du flux non traduit', () => {
    // Intention : ce seuil mesure la dette de traduction. S'il est depasse un
    // jour, c'est que le format a change, et c'est ce test qui le dira avant
    // que Liam ne s'en apercoive a l'usage.
    expect(countUntranslated()).toBeLessThan(lignes.length * 0.2)
  })
})
