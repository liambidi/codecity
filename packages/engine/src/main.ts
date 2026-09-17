/**
 * Point d'entree du moteur.
 *
 * Intention : un port stable, 4317, pour que l'adresse ne change pas d'une
 * session a l'autre. Si ce port est pris, on prend le suivant plutot que
 * d'echouer, et l'adresse retenue est ecrite dans runtime.json.
 */
import { startServer } from './server.js'

const PORT_PREFERE = Number(process.env.CODECITY_PORT ?? 4317)
const RACINE = process.env.CODECITY_ROOT ?? 'C:/Users/liamb/dev'

async function demarrer() {
  for (let port = PORT_PREFERE; port < PORT_PREFERE + 10; port += 1) {
    try {
      const serveur = await startServer({ root: RACINE, port })
      console.log(`codecity ecoute sur http://127.0.0.1:${serveur.port}`)
      const arreter = async () => { await serveur.close(); process.exit(0) }
      process.on('SIGINT', arreter)
      process.on('SIGTERM', arreter)
      return
    } catch (erreur) {
      const code = (erreur as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE') throw erreur
    }
  }
  throw new Error(`Aucun port libre entre ${PORT_PREFERE} et ${PORT_PREFERE + 9}.`)
}

void demarrer()
