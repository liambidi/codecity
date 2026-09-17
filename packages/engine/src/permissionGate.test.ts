import { describe, it, expect, vi } from 'vitest'
import { PermissionGate } from './permissionGate.js'

describe('guichet de permissions', () => {
  it('ne resout rien tant que personne n a repondu', async () => {
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Bash', { command: 'rm -rf /' }, new AbortController().signal)
    const temoin = vi.fn()
    promesse.then(temoin)
    // On laisse tourner la boucle d evenements sans repondre.
    await new Promise((r) => setTimeout(r, 20))
    expect(temoin).not.toHaveBeenCalled()
    expect(guichet.pending()).toHaveLength(1)
  })

  it('resout en autorisation quand on repond allow', async () => {
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Bash', { command: 'echo a' }, new AbortController().signal)
    const id = guichet.pending()[0]!.requestId
    expect(guichet.answer(id, 'allow')).toBe(true)
    expect(await promesse).toEqual({ behavior: 'allow' })
  })

  it('resout en refus avec un message, car le SDK l exige', async () => {
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Bash', { command: 'echo a' }, new AbortController().signal)
    guichet.answer(guichet.pending()[0]!.requestId, 'deny', 'Liam a refuse')
    expect(await promesse).toEqual({ behavior: 'deny', message: 'Liam a refuse' })
  })

  it('fournit un message de refus par defaut si aucun n est donne', async () => {
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Bash', {}, new AbortController().signal)
    guichet.answer(guichet.pending()[0]!.requestId, 'deny')
    const reponse = await promesse
    expect(reponse.behavior).toBe('deny')
    expect((reponse as { message: string }).message.length).toBeGreaterThan(0)
  })

  it('vide la file une fois la reponse donnee', async () => {
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Read', {}, new AbortController().signal)
    guichet.answer(guichet.pending()[0]!.requestId, 'allow')
    await promesse
    expect(guichet.pending()).toHaveLength(0)
  })

  it('ignore une reponse a un identifiant inconnu', () => {
    expect(new PermissionGate().answer('jamais-vu', 'allow')).toBe(false)
  })

  it('refuse quand la session est interrompue par le signal', async () => {
    const controleur = new AbortController()
    const guichet = new PermissionGate()
    const promesse = guichet.ask('Bash', { command: 'echo a' }, controleur.signal)
    controleur.abort()
    const reponse = await promesse
    expect(reponse.behavior).toBe('deny')
    expect(guichet.pending()).toHaveLength(0)
  })

  it('refuse tout ce qui attend quand on annule tout', async () => {
    const guichet = new PermissionGate()
    const a = guichet.ask('Bash', {}, new AbortController().signal)
    const b = guichet.ask('Read', {}, new AbortController().signal)
    guichet.cancelAll('moteur arrete')
    expect((await a).behavior).toBe('deny')
    expect((await b).behavior).toBe('deny')
    expect(guichet.pending()).toHaveLength(0)
  })

  it('previent l ecoutant des qu une demande arrive', () => {
    const guichet = new PermissionGate()
    const vu: string[] = []
    guichet.onAsk((demande) => vu.push(demande.toolName))
    guichet.ask('Bash', { command: 'echo a' }, new AbortController().signal)
    expect(vu).toEqual(['Bash'])
  })

  it('resume une commande Bash lisiblement dans summary', () => {
    const guichet = new PermissionGate()
    guichet.ask('Bash', { command: 'npm run build' }, new AbortController().signal)
    expect(guichet.pending()[0]!.summary).toContain('npm run build')
  })
})
