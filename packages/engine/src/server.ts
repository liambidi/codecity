/**
 * Servir la page et diffuser le flux d'evenements.
 *
 * Intention : une seule session a la fois au jalon 1, c'est assume. Tous les
 * clients connectes voient la meme chose, ce qui permet d'ouvrir la page dans
 * VS Code et dans Chrome en meme temps sans les desynchroniser.
 */
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { scanProjects, type Project } from './projects.js'
import { AgentSession } from './session.js'
import { changedFiles } from './diff.js'
import { writeRuntime } from './store.js'
import { parseClientMessage, type ServerMessage } from './protocol.js'

const TYPES_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export async function startServer(opts: { root: string; port: number }) {
  const racinePage = join(import.meta.dirname, '..', '..', 'ui', 'dist')
  let projets: Project[] = []
  let session: AgentSession | null = null
  let sessionProjet: Project | null = null
  const clients = new Set<WebSocket>()

  const diffuser = (message: ServerMessage) => {
    const charge = JSON.stringify(message)
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(charge)
    }
  }

  const http: Server = createServer(async (requete, reponse) => {
    if (requete.url === '/sante') {
      reponse.writeHead(200, { 'content-type': 'application/json' })
      reponse.end(JSON.stringify({ ok: true, pid: process.pid }))
      return
    }
    // Arret par HTTP, et pas seulement par WebSocket : l'extension VS Code
    // tourne sur un Node dont la WebSocket globale n'est pas garantie.
    if (requete.url === '/arret' && requete.method === 'POST') {
      reponse.writeHead(200, { 'content-type': 'application/json' })
      reponse.end(JSON.stringify({ ok: true }))
      void session?.interrupt().finally(() => setTimeout(() => process.exit(0), 100))
      return
    }
    // Service de la page construite. Le chemin est normalise pour qu'une
    // requete bricolee ne puisse pas remonter hors du dossier de la page.
    const demande = (requete.url ?? '/').split('?')[0] ?? '/'
    const relatif = normalize(demande === '/' ? 'index.html' : demande.slice(1))
    if (relatif.startsWith('..')) { reponse.writeHead(403).end(); return }
    try {
      const contenu = await readFile(join(racinePage, relatif))
      reponse.writeHead(200, {
        'content-type': TYPES_MIME[extname(relatif)] ?? 'application/octet-stream',
      })
      reponse.end(contenu)
    } catch {
      reponse.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      reponse.end('Page absente. Construire l interface avec npm run build.')
    }
  })

  const ws = new WebSocketServer({ server: http, path: '/flux' })

  ws.on('connection', (client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))

    client.on('message', async (brut) => {
      const envoyer = (m: ServerMessage) => client.send(JSON.stringify(m))
      const message = parseClientMessage(brut.toString())
      if (!message) { envoyer({ type: 'error', message: 'Message non reconnu.' }); return }

      switch (message.type) {
        case 'projects.list': {
          projets = await scanProjects(opts.root)
          envoyer({ type: 'projects', projects: projets })
          return
        }
        case 'session.start': {
          if (session) {
            envoyer({ type: 'error', message: 'Une session tourne deja.' })
            return
          }
          if (projets.length === 0) projets = await scanProjects(opts.root)
          const projet = projets.find((p) => p.id === message.projectId)
          if (!projet) {
            envoyer({ type: 'error', message: `Projet inconnu : ${message.projectId}` })
            return
          }
          sessionProjet = projet
          const courante = new AgentSession({
            sessionId: randomUUID(),
            projectId: projet.id,
            projectPath: projet.path,
            task: message.task,
          })
          session = courante
          courante.onEvent((event) => diffuser({ type: 'event', event }))
          // On ne bloque pas la reponse sur la fin de la session.
          void courante.start().finally(() => {
            if (session === courante) session = null
          })
          return
        }
        case 'permission.answer': {
          if (!session?.answerPermission(message.requestId, message.decision, message.reason)) {
            envoyer({ type: 'error', message: 'Cette demande n attend plus de reponse.' })
          }
          return
        }
        case 'session.interrupt': {
          await session?.interrupt()
          return
        }
        case 'diff.request': {
          envoyer({
            type: 'diff',
            changes: sessionProjet ? await changedFiles(sessionProjet.path) : [],
          })
          return
        }
        case 'engine.stop': {
          await session?.interrupt()
          setTimeout(() => process.exit(0), 100)
          return
        }
      }
    })
  })

  const port = await new Promise<number>((resoudre) => {
    http.listen(opts.port, '127.0.0.1', () => {
      const adresse = http.address()
      resoudre(typeof adresse === 'object' && adresse ? adresse.port : opts.port)
    })
  })

  await writeRuntime({ port, pid: process.pid, startedAt: Date.now() })

  return {
    port,
    close: async () => {
      await session?.interrupt()
      for (const client of clients) client.terminate()
      ws.close()
      await new Promise<void>((r) => http.close(() => r()))
    },
  }
}
