import type { PendingAsk } from '../useEngine.js'

/** La bulle qui arrete tout. Volontairement impossible a rater. */
export function PermissionPrompt(props: {
  ask: PendingAsk
  onAnswer: (decision: 'allow' | 'deny') => void
}) {
  return (
    <section className="permission">
      <h2>L agent demande la permission</h2>
      <p className="resume">{props.ask.summary}</p>
      <details>
        <summary>Voir le detail complet</summary>
        <pre>{props.ask.detail}</pre>
      </details>
      <button onClick={() => props.onAnswer('allow')}>Autoriser</button>
      <button onClick={() => props.onAnswer('deny')}>Refuser</button>
    </section>
  )
}
