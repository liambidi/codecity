/**
 * L'ecran du jalon 1.
 *
 * Intention : laid mais vrai. Chaque zone correspond a un critere d'acceptation,
 * et aucune n'est decorative. Le decor viendra au jalon 2, une fois qu'on saura
 * que la boucle tient.
 */
import { useState } from 'react'
import { useEngine } from './useEngine.js'
import { ProjectPicker } from './panels/ProjectPicker.js'
import { EventLog } from './panels/EventLog.js'
import { PermissionPrompt } from './panels/PermissionPrompt.js'
import { DiffPanel } from './panels/DiffPanel.js'

export function App() {
  const moteur = useEngine(`ws://${location.host}/flux`)
  const [projectId, setProjectId] = useState('')
  const [task, setTask] = useState('')

  return (
    <main className="ecran">
      <header>
        <h1>codecity</h1>
        <button
          className="danger"
          onClick={() => moteur.send({ type: 'engine.stop' })}
        >
          Arreter le moteur
        </button>
      </header>

      <section className="lancement">
        <ProjectPicker
          projects={moteur.projects}
          value={projectId}
          onChange={setProjectId}
        />
        <textarea
          value={task}
          placeholder="Que doit faire l agent ?"
          onChange={(e) => setTask(e.target.value)}
        />
        <button
          disabled={moteur.running || !projectId || !task.trim()}
          onClick={() => moteur.send({ type: 'session.start', projectId, task })}
        >
          Lancer
        </button>
        <button disabled={!moteur.running}
          onClick={() => moteur.send({ type: 'session.interrupt' })}>
          Interrompre
        </button>
      </section>

      {moteur.error && <p className="erreur">{moteur.error}</p>}

      {moteur.pendingAsk && (
        <PermissionPrompt
          ask={moteur.pendingAsk}
          onAnswer={(decision) => moteur.send({
            type: 'permission.answer',
            requestId: moteur.pendingAsk!.requestId,
            decision,
          })}
        />
      )}

      <EventLog events={moteur.events} />

      <DiffPanel
        changes={moteur.changes}
        onRefresh={() => moteur.send({ type: 'diff.request' })}
      />

      {moteur.lastCostUsd !== null && (
        <footer>Session terminee, cout estime {moteur.lastCostUsd.toFixed(4)} dollars.</footer>
      )}
    </main>
  )
}
