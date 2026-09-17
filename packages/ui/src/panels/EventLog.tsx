import type { CityEvent } from '../../../engine/src/events.js'

/** Une ligne par evenement. C'est la preuve visible que le traducteur marche. */
const LIBELLES: Record<CityEvent['kind'], string> = {
  'session.started': 'entre en scene',
  'agent.thinking': 'reflechit',
  'agent.said': 'dit',
  'agent.reads': 'lit',
  'agent.writes': 'ecrit',
  'agent.runs': 'lance',
  'agent.asks': 'demande la permission',
  'agent.plan': 'propose un plan',
  'agent.answered': 'a recu sa reponse',
  'agent.error': 'a rencontre une erreur',
  'session.ended': 'a fini',
}

function details(e: CityEvent): string {
  if (e.kind === 'agent.said') return e.text
  if (e.kind === 'agent.reads' || e.kind === 'agent.writes') return e.path
  if (e.kind === 'agent.runs') return e.command
  if (e.kind === 'agent.error') return e.message
  if (e.kind === 'session.ended') return `${e.reason}, ${e.durationMs} ms`
  return ''
}

export function EventLog(props: { events: CityEvent[] }) {
  return (
    <section className="journal">
      <h2>Ce que fait l agent</h2>
      <ol>
        {props.events.map((e, i) => (
          <li key={i} data-kind={e.kind}>
            <strong>{LIBELLES[e.kind]}</strong> <span>{details(e)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
