import type { Project } from '../../../engine/src/projects.js'

export function ProjectPicker(props: {
  projects: Project[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">Choisir un projet</option>
      {props.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.kind}{p.hasGit ? ', git' : ''})
        </option>
      ))}
    </select>
  )
}
