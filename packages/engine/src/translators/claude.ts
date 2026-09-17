/**
 * Traduire ce que dit Claude vers le vocabulaire de codecity.
 *
 * Intention : isoler ici, et nulle part ailleurs, la connaissance du format du
 * SDK. Le jour ou ce format change, c'est ce seul fichier qui bouge, et ce sont
 * ses tests qui previennent.
 *
 * Regle : cette fonction ne jette jamais. Un flux mal forme doit degrader
 * l'affichage, pas tuer la session.
 *
 * Piege verifie contre fixtures/claude-lecture-commande.jsonl (tache 0) : le
 * flux --verbose reel d'une session contient bien plus que des messages
 * assistant/result. On y trouve des messages system de cycle de vie des hooks
 * (hook_started, hook_response, hook_progress, init, thinking_tokens), des
 * evenements de limite de debit (rate_limit_event), et des messages user qui
 * ne sont que le retour d'un outil vers l'agent (tool_result). Sur cette
 * fixture ils comptent pour 19 lignes sur 26, bien plus que les 20% de dette
 * toleree si on les comptait comme "non traduits" au meme titre qu'un type
 * vraiment inconnu. Ce ne sont pourtant pas des trous dans la traduction :
 * ce sont des messages reconnus, dont on sait deja qu'ils ne se jouent pas a
 * l'ecran au jalon 1. La dette ne doit mesurer que l'inattendu : un message
 * dont on ne sait pas quoi faire parce que le format a change. D'ou la liste
 * ci-dessous, qui les nomme explicitement pour les exclure du compteur.
 */
import { newEvent, type CityEvent } from '../events.js'

/** Outils classes par ce qu'ils font, du point de vue de la mise en scene. */
const LECTURE = new Set(['Read', 'Glob', 'Grep', 'NotebookRead'])
const ECRITURE = new Set(['Write', 'Edit', 'NotebookEdit'])

/**
 * Types de message de premier niveau que le SDK emet et qui sont de la pure
 * plomberie : jamais rien a rejouer a l'ecran au jalon 1, donc jamais de la
 * dette quand on les rencontre. Une entree ici est une decision documentee,
 * pas un oubli.
 */
const TYPES_CONNUS_SANS_SCENE = new Set(['system', 'user', 'rate_limit_event', 'stream_event'])

let nonTraduits = 0
export function countUntranslated(): number { return nonTraduits }
export function resetUntranslated(): void { nonTraduits = 0 }

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : ''
}

function traduireBloc(bloc: unknown, sessionId: string): CityEvent | null {
  if (typeof bloc !== 'object' || bloc === null) return null
  const b = bloc as Record<string, unknown>

  if (b.type === 'text') {
    const contenu = texte(b.text).trim()
    return contenu ? newEvent('agent.said', { sessionId, text: contenu }) : null
  }

  if (b.type === 'thinking') {
    return newEvent('agent.thinking', { sessionId })
  }

  if (b.type === 'tool_use') {
    const nom = texte(b.name)
    const entree = (typeof b.input === 'object' && b.input !== null
      ? b.input : {}) as Record<string, unknown>

    if (nom === 'ExitPlanMode') {
      return newEvent('agent.plan', {
        sessionId,
        requestId: texte(b.id) || `plan-${Date.now()}`,
        plan: texte(entree.plan),
      })
    }
    if (nom === 'Bash') {
      return newEvent('agent.runs', { sessionId, command: texte(entree.command) })
    }
    if (ECRITURE.has(nom)) {
      return newEvent('agent.writes', { sessionId, path: texte(entree.file_path) })
    }
    if (LECTURE.has(nom)) {
      return newEvent('agent.reads', {
        sessionId,
        path: texte(entree.file_path) || texte(entree.pattern) || texte(entree.path),
      })
    }
    // Tout autre outil reste une action visible, faute de mieux. On ne
    // classe jamais sur la seule presence d'une cle "name" : on est ici
    // uniquement parce que le bloc est structurellement un tool_use dans un
    // message assistant, jamais parce qu'un objet quelconque porte "name"
    // (voir par exemple les entrees mcp_servers du message system "init" de
    // la fixture reelle, qui ne sont jamais atteintes par ce chemin).
    return newEvent('agent.runs', { sessionId, command: nom })
  }

  return null
}

export function translateClaudeMessage(message: unknown, sessionId: string): CityEvent[] {
  if (typeof message !== 'object' || message === null) {
    nonTraduits += 1
    return []
  }
  const m = message as Record<string, unknown>

  if (m.type === 'assistant') {
    const enveloppe = (typeof m.message === 'object' && m.message !== null
      ? m.message : {}) as Record<string, unknown>
    const blocs = Array.isArray(enveloppe.content) ? enveloppe.content : []
    const sortie = blocs
      .map((bloc) => traduireBloc(bloc, sessionId))
      .filter((e): e is CityEvent => e !== null)
    if (sortie.length === 0) nonTraduits += 1
    return sortie
  }

  if (m.type === 'result') {
    return [newEvent('session.ended', {
      sessionId,
      reason: texte(m.subtype) || 'inconnu',
      costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0,
      durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : 0,
    })]
  }

  if (TYPES_CONNUS_SANS_SCENE.has(texte(m.type))) {
    // Connu, attendu, et deliberement muet au jalon 1 : ce n'est pas de la
    // dette, c'est un choix de mise en scene.
    return []
  }

  // Type reellement inconnu : c'est ce compteur qui alerte si le format du
  // SDK a change de facon significative.
  nonTraduits += 1
  return []
}
