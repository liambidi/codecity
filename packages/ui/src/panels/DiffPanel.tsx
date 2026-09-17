import type { FileChange } from '../../../engine/src/diff.js'

export function DiffPanel(props: { changes: FileChange[]; onRefresh: () => void }) {
  return (
    <section className="diff">
      <h2>Fichiers modifies</h2>
      <button onClick={props.onRefresh}>Rafraichir</button>
      {props.changes.length === 0 && <p>Aucune modification pour l instant.</p>}
      {props.changes.map((c) => (
        <details key={c.path}>
          <summary>{c.status} {c.path}</summary>
          <pre>{c.diff}</pre>
        </details>
      ))}
    </section>
  )
}
