# codecity, jalon 1, plan d'implémentation

> **Pour les agents exécutants :** SOUS-SKILL REQUIS, utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes
> utilisent des cases à cocher `- [ ]` pour le suivi.

**But :** livrer la boucle complète sur un agent et un projet, tu donnes une tâche à
Claude Code, tu le vois travailler, tu réponds à ses demandes de permission, tu vois le
diff, tu valides, depuis une page web servie par un moteur qui survit à la fermeture de
VS Code.

**Architecture :** trois paquets npm dans un seul dépôt. `engine` lance les agents et
traduit leurs événements, `ui` met ces événements en scène, `extension` affiche la page
dans VS Code. Ils communiquent par un contrat d'événements unique, défini une fois dans
`engine` et importé par `ui`.

**Pile technique :** Node 24, TypeScript, Vitest pour les tests, `ws` pour le
WebSocket, Vite et React pour l'interface, `@anthropic-ai/claude-agent-sdk` 0.3.274
pour piloter Claude.

## Contraintes globales

Ces règles s'appliquent à toutes les tâches, sans être rappelées dans chacune.

- Aucun tiret cadratin, nulle part, code compris. Une virgule ou une reformulation.
- Commentaires en français. Expliquer l'intention d'une fonction avant de l'écrire.
- **Ne jamais passer `--bare`** au CLI Claude, ni `ANTHROPIC_API_KEY` dans
  l'environnement des sessions. Le mode `--bare` n'utilise pas la connexion par
  abonnement, ce qui ferait basculer le projet sur une facturation API.
- Les données locales vont dans le dossier `.codecity` du profil utilisateur, jamais
  dans le dépôt. La variable d'environnement `CODECITY_HOME` peut le déplacer, ce qui
  sert aux tests.
- Aucun paquet natif à compiler. Windows sans outils de build doit suffire.
- Le paquet `ui` ne contient ni le mot `claude` ni le mot `codex`, sauf comme étiquette
  affichée à l'écran.
- Le paquet `engine` ne contient aucun vocabulaire graphique, ni avatar, ni sprite.
- Tests avec Vitest. Un test rouge avant toute implémentation.
- Un commit par tâche terminée, message en français.

## Vérités du SDK, relevées le 2026-09-17 dans `sdk.d.ts` de la version 0.3.274

À ne pas redécouvrir, et à ne pas remplacer par ce qu'en dit la documentation en ligne,
qui est plus approximative sur ces trois points.

    query(_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query

    interface Query extends AsyncGenerator<SDKMessage, void> {
      interrupt(): Promise<SDKControlInterruptResponse | undefined>
      setPermissionMode(mode: PermissionMode): Promise<void>
    }

    type CanUseTool = (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; blockedPath?: string }
    ) => Promise<PermissionResult | null>

    type PermissionResult =
      | { behavior: 'allow';  updatedInput?: Record<string, unknown> }
      | { behavior: 'deny';   message: string; interrupt?: boolean }

Trois conséquences qui décident du code :

1. `canUseTool` reçoit **trois arguments positionnels**, pas un objet de requête.
2. Un refus **exige** un `message`, ce n'est pas optionnel.
3. `interrupt()` n'est disponible qu'en mode entrée continue. Le `prompt` doit donc être
   un `AsyncIterable<SDKUserMessage>`, jamais une simple chaîne, sinon le critère
   d'acceptation 8 est irréalisable.

---

## Carte des fichiers

| Fichier | Responsabilité unique |
|---|---|
| `packages/engine/src/events.ts` | le contrat, les onze événements et leurs gardes |
| `packages/engine/src/store.ts` | lire et écrire les fichiers de `.codecity`, atomiquement |
| `packages/engine/src/projects.ts` | détecter les projets d'un dossier racine |
| `packages/engine/src/permissionGate.ts` | faire attendre une demande de permission jusqu'à la réponse |
| `packages/engine/src/translators/claude.ts` | traduire un message du SDK en événements |
| `packages/engine/src/session.ts` | lancer, nourrir et interrompre une session d'agent |
| `packages/engine/src/diff.ts` | lister les fichiers modifiés d'un projet et leur diff |
| `packages/engine/src/protocol.ts` | les messages échangés avec l'interface |
| `packages/engine/src/server.ts` | HTTP pour la page et la santé, WebSocket pour le flux |
| `packages/engine/src/main.ts` | point d'entrée, assemble tout, choisit le port |
| `packages/ui/src/App.tsx` | l'écran, assemble les panneaux |
| `packages/ui/src/useEngine.ts` | la connexion WebSocket et l'état reçu |
| `packages/ui/src/panels/*.tsx` | un panneau par zone d'écran |
| `packages/extension/src/extension.ts` | démarrer le moteur, ouvrir le panneau, l'arrêter |

---

## Tâche 0 : étape zéro bloquante, constater l'abonnement et récolter les fixtures

Cette tâche décide si le projet garde sa forme actuelle. Elle produit aussi les
enregistrements réels dont la tâche 4 a besoin. Rien d'autre ne commence avant.

**Fichiers :**
- Créer : `fixtures/projet-jouet/bonjour.txt`
- Créer : `fixtures/claude-lecture-commande.jsonl`
- Créer : `docs/verifications/2026-09-17-abonnement.md`

- [ ] **Étape 1 : fabriquer un projet jouet**

```bash
cd /c/Users/liamb/dev/codecity
mkdir -p fixtures/projet-jouet docs/verifications
printf 'Ce fichier existe pour que l agent ait quelque chose a lire.\n' > fixtures/projet-jouet/bonjour.txt
```

- [ ] **Étape 2 : lancer une session réelle et enregistrer son flux**

La commande demande volontairement une lecture de fichier et une commande shell, pour
que l'enregistrement contienne les deux types d'outils dont la tâche 4 a besoin.

```bash
cd /c/Users/liamb/dev/codecity/fixtures/projet-jouet
claude -p "Lis bonjour.txt puis lance la commande echo termine. Ne modifie aucun fichier." \
  --output-format stream-json --verbose \
  --allowedTools "Read,Bash(echo *)" \
  > ../claude-lecture-commande.jsonl
```

Attendu : sortie non vide, une ligne JSON par événement.

- [ ] **Étape 3 : lire le verdict d'authentification**

```bash
cd /c/Users/liamb/dev/codecity
grep -c . fixtures/claude-lecture-commande.jsonl
grep -o '"subtype":"[a-z_]*"' fixtures/claude-lecture-commande.jsonl | sort | uniq -c
grep -iE "authentication_failed|billing_error|credit balance|ANTHROPIC_API_KEY" fixtures/claude-lecture-commande.jsonl | head -3
```

Attendu : au moins une dizaine de lignes, un `"subtype":"success"` en fin de flux, et
**aucune** correspondance sur la troisième commande.

**Si la troisième commande trouve quelque chose, arrêter le plan ici** et rapporter à
Liam. Le projet n'est pas mort, mais son coût change de nature et la décision de
continuer lui appartient.

- [ ] **Étape 4 : vérifier que le flux contient bien les briques attendues**

```bash
cd /c/Users/liamb/dev/codecity
grep -o '"name":"[A-Za-z]*"' fixtures/claude-lecture-commande.jsonl | sort | uniq -c
grep -o '"total_cost_usd":[0-9.]*' fixtures/claude-lecture-commande.jsonl
```

Attendu : au moins un `"name":"Read"` et un `"name":"Bash"`, et un coût chiffré.

Si `Read` ou `Bash` manque, relancer l'étape 2 en reformulant la consigne. Un traducteur
écrit sans fixture correspondante est refusé en revue.

- [ ] **Étape 5 : consigner la vérification**

Créer `docs/verifications/2026-09-17-abonnement.md` :

```markdown
# Vérification de l'étape zéro, 2026-09-17

**Question.** Une session lancée hors mode `--bare` consomme-t-elle l'abonnement Claude
Code de Liam, et non une clé API facturée ?

**Méthode.** Session réelle enregistrée dans `fixtures/claude-lecture-commande.jsonl`,
recherche des marqueurs d'échec d'authentification et de facturation.

**Résultat.** [remplir : constaté, avec le nombre de lignes, les sous-types vus, le coût
rapporté, et l'absence de marqueur d'erreur]

**Conclusion.** [remplir : le projet garde sa forme actuelle, ou bascule sur une
facturation API et la décision revient à Liam]
```

- [ ] **Étape 6 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add fixtures docs/verifications
git commit -m "Etape zero : abonnement constate et fixtures reelles enregistrees"
```

---

## Tâche 1 : squelette de l'espace de travail et contrat d'événements

**Fichiers :**
- Créer : `package.json`, `tsconfig.base.json`, `vitest.config.ts`
- Créer : `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Créer : `packages/engine/src/events.ts`
- Test : `packages/engine/src/events.test.ts`

**Interfaces :**
- Produit : le type `CityEvent`, la constante `EVENT_KINDS`, la fonction
  `isBlocking(event: CityEvent): boolean`, la fonction
  `newEvent<K>(kind: K, payload): CityEvent`. Toutes les tâches suivantes importent
  depuis ce fichier.

- [ ] **Étape 1 : installer le socle**

```bash
cd /c/Users/liamb/dev/codecity
npm init -y
npm pkg set name="codecity" private=true type="module"
npm pkg set workspaces[0]="packages/engine" workspaces[1]="packages/ui" workspaces[2]="packages/extension"
npm install -D typescript vitest @types/node tsx
mkdir -p packages/engine/src
```

`tsx` sert à lancer le TypeScript sans étape de compilation pendant le
développement. Ne pas compter sur le retrait de types natif de Node : il ne réécrit pas
les imports en `.js` vers les fichiers `.ts` correspondants, ce que tout le code fait.

- [ ] **Étape 2 : écrire le test qui échoue**

Créer `packages/engine/src/events.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { EVENT_KINDS, isBlocking, newEvent } from './events.js'

describe('contrat des evenements', () => {
  it('compte exactement onze evenements, ni plus ni moins', () => {
    // Le nombre est volontairement fige : ajouter un evenement oblige a
    // decider la scene correspondante dans l'interface.
    expect(EVENT_KINDS).toHaveLength(11)
  })

  it('bloque la session sur une demande de permission et sur un plan', () => {
    expect(isBlocking(newEvent('agent.asks', {
      sessionId: 's1', requestId: 'r1', toolName: 'Bash',
      summary: 'echo bonjour', detail: 'echo bonjour',
    }))).toBe(true)
    expect(isBlocking(newEvent('agent.plan', {
      sessionId: 's1', requestId: 'r2', plan: 'un plan',
    }))).toBe(true)
  })

  it('ne bloque pas sur une lecture de fichier', () => {
    expect(isBlocking(newEvent('agent.reads', {
      sessionId: 's1', path: 'bonjour.txt',
    }))).toBe(false)
  })

  it('horodate chaque evenement', () => {
    const e = newEvent('agent.said', { sessionId: 's1', text: 'bonjour' })
    expect(typeof e.at).toBe('number')
  })
})
```

- [ ] **Étape 3 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/events.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./events.js"`.

- [ ] **Étape 4 : écrire l'implémentation minimale**

Créer `packages/engine/src/events.ts` :

```typescript
/**
 * Le contrat central de codecity.
 *
 * Intention : tous les agents, quels qu'ils soient, sont traduits vers cette
 * liste unique. L'interface ne connait qu'elle. Ajouter un agent, c'est ecrire
 * un traducteur vers cette liste, et rien d'autre.
 *
 * Regle : aucun evenement n'est ajoute ici sans que la scene correspondante
 * soit decidee dans l'interface. Un evenement injouable est un evenement
 * inutile, et le test verrouille leur nombre pour forcer cette discussion.
 */

export const EVENT_KINDS = [
  'session.started',
  'agent.thinking',
  'agent.said',
  'agent.reads',
  'agent.writes',
  'agent.runs',
  'agent.asks',
  'agent.plan',
  'agent.answered',
  'agent.error',
  'session.ended',
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

export type EventPayloads = {
  'session.started': { sessionId: string; agentKind: string; projectId: string }
  'agent.thinking': { sessionId: string }
  'agent.said': { sessionId: string; text: string }
  'agent.reads': { sessionId: string; path: string }
  'agent.writes': { sessionId: string; path: string }
  'agent.runs': { sessionId: string; command: string }
  'agent.asks': {
    sessionId: string
    requestId: string
    toolName: string
    summary: string
    detail: string
  }
  'agent.plan': { sessionId: string; requestId: string; plan: string }
  'agent.answered': { sessionId: string; requestId: string; decision: 'allow' | 'deny' }
  'agent.error': { sessionId: string; message: string }
  'session.ended': {
    sessionId: string
    reason: string
    costUsd: number
    durationMs: number
  }
}

export type CityEvent = {
  [K in EventKind]: { kind: K; at: number } & EventPayloads[K]
}[EventKind]

/** Les evenements qui arretent reellement l'agent tant que Liam n'a pas repondu. */
const BLOCKING: ReadonlySet<EventKind> = new Set(['agent.asks', 'agent.plan'])

export function isBlocking(event: CityEvent): boolean {
  return BLOCKING.has(event.kind)
}

/** Fabrique un evenement horodate. Seul point de creation, pour que rien n'oublie `at`. */
export function newEvent<K extends EventKind>(
  kind: K,
  payload: EventPayloads[K],
): CityEvent {
  return { kind, at: Date.now(), ...payload } as CityEvent
}
```

Créer `packages/engine/package.json` :

```json
{
  "name": "@codecity/engine",
  "private": true,
  "type": "module",
  "main": "src/main.ts"
}
```

Créer `tsconfig.base.json` à la racine :

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

Créer `packages/engine/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Étape 5 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/events.test.ts
```

Attendu : 4 tests passent.

- [ ] **Étape 6 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Contrat des onze evenements, verrouille par test"
```

---

## Tâche 2 : le magasin de fichiers

**Fichiers :**
- Créer : `packages/engine/src/store.ts`
- Test : `packages/engine/src/store.test.ts`

**Interfaces :**
- Produit : `dataDir(): string`, `readJson<T>(nom: string, defaut: T): Promise<T>`,
  `writeJson(nom: string, valeur: unknown): Promise<void>`,
  `writeRuntime(info: RuntimeInfo): Promise<void>`,
  `readRuntime(): Promise<RuntimeInfo | null>`, et le type
  `RuntimeInfo = { port: number; pid: number; startedAt: number }`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/engine/src/store.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir, readJson, writeJson, writeRuntime, readRuntime } from './store.js'

let maison: string

beforeEach(async () => {
  maison = await mkdtemp(join(tmpdir(), 'codecity-test-'))
  process.env.CODECITY_HOME = maison
})

afterEach(async () => {
  delete process.env.CODECITY_HOME
  await rm(maison, { recursive: true, force: true })
})

describe('magasin de fichiers', () => {
  it('obeit a CODECITY_HOME', () => {
    expect(dataDir()).toBe(maison)
  })

  it('rend la valeur par defaut quand le fichier n existe pas', async () => {
    expect(await readJson('projects.json', [])).toEqual([])
  })

  it('relit ce qu il a ecrit', async () => {
    await writeJson('projects.json', [{ id: 'a', name: 'projet a' }])
    expect(await readJson('projects.json', [])).toEqual([{ id: 'a', name: 'projet a' }])
  })

  it('ne laisse aucun fichier temporaire derriere lui', async () => {
    await writeJson('projects.json', [{ id: 'a' }])
    const restes = (await readdir(maison)).filter((f) => f.includes('.tmp'))
    expect(restes).toEqual([])
  })

  it('rend null quand aucun moteur ne tourne', async () => {
    expect(await readRuntime()).toBeNull()
  })

  it('relit le port et le pid du moteur', async () => {
    await writeRuntime({ port: 4317, pid: 1234, startedAt: 1 })
    expect(await readRuntime()).toEqual({ port: 4317, pid: 1234, startedAt: 1 })
  })

  it('rend null plutot que de jeter quand runtime.json est illisible', async () => {
    await writeJson('runtime.json', 'ceci n est pas un objet runtime')
    // Intention : un fichier corrompu ne doit jamais empecher le moteur de demarrer.
    expect(await readRuntime()).toBeNull()
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/store.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./store.js"`.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/engine/src/store.ts` :

```typescript
/**
 * Tout ce que codecity garde sur disque.
 *
 * Intention : les donnees vivent dans le dossier `.codecity` du profil
 * utilisateur, jamais dans un depot, pour qu'aucun etat local ne parte dans un
 * commit. L'ecriture passe par un fichier temporaire puis un renommage, pour
 * qu'une coupure de courant ne laisse jamais un JSON a moitie ecrit.
 */
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RuntimeInfo = { port: number; pid: number; startedAt: number }

export function dataDir(): string {
  return process.env.CODECITY_HOME ?? join(homedir(), '.codecity')
}

export async function readJson<T>(nom: string, defaut: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir(), nom), 'utf8')) as T
  } catch {
    // Fichier absent ou illisible : la valeur par defaut vaut mieux qu'un plantage.
    return defaut
  }
}

export async function writeJson(nom: string, valeur: unknown): Promise<void> {
  const dossier = dataDir()
  await mkdir(dossier, { recursive: true })
  const cible = join(dossier, nom)
  const temporaire = `${cible}.${process.pid}.tmp`
  try {
    await writeFile(temporaire, JSON.stringify(valeur, null, 2), 'utf8')
    await rename(temporaire, cible)
  } catch (erreur) {
    await unlink(temporaire).catch(() => {})
    throw erreur
  }
}

export async function writeRuntime(info: RuntimeInfo): Promise<void> {
  await writeJson('runtime.json', info)
}

export async function readRuntime(): Promise<RuntimeInfo | null> {
  const brut = await readJson<unknown>('runtime.json', null)
  if (
    typeof brut !== 'object' || brut === null ||
    typeof (brut as RuntimeInfo).port !== 'number' ||
    typeof (brut as RuntimeInfo).pid !== 'number'
  ) {
    return null
  }
  return brut as RuntimeInfo
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/store.test.ts
```

Attendu : 7 tests passent.

- [ ] **Étape 5 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Magasin de fichiers atomique dans .codecity"
```

---

## Tâche 3 : le registre de projets

Couvre le critère d'acceptation 1.

**Fichiers :**
- Créer : `packages/engine/src/projects.ts`
- Test : `packages/engine/src/projects.test.ts`

**Interfaces :**
- Consomme : rien des tâches précédentes.
- Produit : le type
  `Project = { id: string; name: string; path: string; kind: 'node' | 'python' | 'web' | 'autre'; hasGit: boolean }`
  et `scanProjects(racine: string): Promise<Project[]>`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/engine/src/projects.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProjects } from './projects.js'

let racine: string

async function creerDossier(nom: string, fichiers: string[]) {
  const chemin = join(racine, nom)
  await mkdir(chemin, { recursive: true })
  for (const f of fichiers) {
    await mkdir(join(chemin, f, '..'), { recursive: true }).catch(() => {})
    await writeFile(join(chemin, f), '', 'utf8')
  }
  return chemin
}

beforeEach(async () => { racine = await mkdtemp(join(tmpdir(), 'codecity-scan-')) })
afterEach(async () => { await rm(racine, { recursive: true, force: true }) })

describe('registre de projets', () => {
  it('reconnait un projet node a son package.json', async () => {
    await creerDossier('mon-site', ['package.json'])
    const projets = await scanProjects(racine)
    expect(projets.map((p) => p.kind)).toEqual(['node'])
  })

  it('reconnait un projet python a son requirements.txt', async () => {
    await creerDossier('mon-script', ['requirements.txt'])
    expect((await scanProjects(racine))[0]?.kind).toBe('python')
  })

  it('reconnait un projet web a son index.html', async () => {
    await creerDossier('ma-page', ['index.html'])
    expect((await scanProjects(racine))[0]?.kind).toBe('web')
  })

  it('signale la presence d un depot git', async () => {
    const chemin = await creerDossier('avec-git', ['package.json'])
    await mkdir(join(chemin, '.git'), { recursive: true })
    await creerDossier('sans-git', ['package.json'])
    const projets = await scanProjects(racine)
    expect(projets.find((p) => p.name === 'avec-git')?.hasGit).toBe(true)
    expect(projets.find((p) => p.name === 'sans-git')?.hasGit).toBe(false)
  })

  it('ignore les fichiers isoles et les dossiers vides', async () => {
    await writeFile(join(racine, 'note.pdf'), '', 'utf8')
    await mkdir(join(racine, 'dossier-vide'), { recursive: true })
    expect(await scanProjects(racine)).toEqual([])
  })

  it('ignore node_modules et les dossiers caches', async () => {
    await creerDossier('node_modules', ['package.json'])
    await creerDossier('.cache', ['package.json'])
    expect(await scanProjects(racine)).toEqual([])
  })

  it('rend une liste triee par nom, pour que l ordre ne bouge pas d une fois sur l autre', async () => {
    await creerDossier('zebre', ['package.json'])
    await creerDossier('abeille', ['package.json'])
    expect((await scanProjects(racine)).map((p) => p.name)).toEqual(['abeille', 'zebre'])
  })

  it('rend une liste vide plutot que de jeter si la racine n existe pas', async () => {
    expect(await scanProjects(join(racine, 'inexistant'))).toEqual([])
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/projects.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./projects.js"`.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/engine/src/projects.ts` :

```typescript
/**
 * Detecter les projets presents dans un dossier racine.
 *
 * Intention : Liam ne doit rien declarer a la main. On regarde le premier niveau
 * de dossiers, et un dossier compte comme projet s'il porte un marqueur connu.
 * On ne descend pas plus bas, pour que le scan reste instantane meme sur un
 * dossier dev bien rempli.
 */
import { readdir, access } from 'node:fs/promises'
import { join } from 'node:path'

export type Project = {
  id: string
  name: string
  path: string
  kind: 'node' | 'python' | 'web' | 'autre'
  hasGit: boolean
}

/** Marqueurs testes dans l'ordre : le premier trouve decide du type. */
const MARQUEURS: ReadonlyArray<[string, Project['kind']]> = [
  ['package.json', 'node'],
  ['requirements.txt', 'python'],
  ['pyproject.toml', 'python'],
  ['index.html', 'web'],
]

async function existe(chemin: string): Promise<boolean> {
  try {
    await access(chemin)
    return true
  } catch {
    return false
  }
}

export async function scanProjects(racine: string): Promise<Project[]> {
  let entrees
  try {
    entrees = await readdir(racine, { withFileTypes: true })
  } catch {
    // Racine absente ou illisible : aucune raison de faire tomber le moteur.
    return []
  }

  const projets: Project[] = []
  for (const entree of entrees) {
    if (!entree.isDirectory()) continue
    if (entree.name.startsWith('.') || entree.name === 'node_modules') continue

    const chemin = join(racine, entree.name)
    let kind: Project['kind'] | null = null
    for (const [fichier, type] of MARQUEURS) {
      if (await existe(join(chemin, fichier))) { kind = type; break }
    }

    const hasGit = await existe(join(chemin, '.git'))
    // Un dossier sans marqueur mais avec un depot git reste un projet : c'est le
    // cas de beaucoup de depots de Liam qui ne sont ni node ni python.
    if (kind === null && !hasGit) continue

    projets.push({
      id: entree.name,
      name: entree.name,
      path: chemin,
      kind: kind ?? 'autre',
      hasGit,
    })
  }

  return projets.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/projects.test.ts
```

Attendu : 8 tests passent.

- [ ] **Étape 5 : constater sur le vrai dossier de Liam**

```bash
cd /c/Users/liamb/dev/codecity
npx tsx -e "import('./packages/engine/src/projects.js').then(async m => console.table(await m.scanProjects('C:/Users/liamb/dev')))"
```

Attendu : un tableau listant `codecity`, `innerlib`, `portfolio`, `premiers-mots-jeux`,
et les autres, avec leur type et leur colonne git. Vérifier de l'œil qu'aucun projet
connu ne manque.

- [ ] **Étape 6 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Detection des projets du dossier dev"
```

---

## Tâche 4 : le traducteur Claude

La pièce la plus cassable du projet, donc la plus testée. Couvre les critères 3 et 4.

**Fichiers :**
- Créer : `packages/engine/src/translators/claude.ts`
- Test : `packages/engine/src/translators/claude.test.ts`
- Lit : `fixtures/claude-lecture-commande.jsonl`, produit par la tâche 0

**Interfaces :**
- Consomme : `CityEvent`, `newEvent` de `../events.js`.
- Produit : `translateClaudeMessage(message: unknown, sessionId: string): CityEvent[]`
  et `countUntranslated(): number`, plus `resetUntranslated(): void` pour les tests.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/engine/src/translators/claude.test.ts` :

```typescript
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
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/translators/claude.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./claude.js"`.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/engine/src/translators/claude.ts` :

```typescript
/**
 * Traduire ce que dit Claude vers le vocabulaire de codecity.
 *
 * Intention : isoler ici, et nulle part ailleurs, la connaissance du format du
 * SDK. Le jour ou ce format change, c'est ce seul fichier qui bouge, et ce sont
 * ses tests qui previennent.
 *
 * Regle : cette fonction ne jette jamais. Un flux mal forme doit degrader
 * l'affichage, pas tuer la session.
 */
import { newEvent, type CityEvent } from '../events.js'

/** Outils classes par ce qu'ils font, du point de vue de la mise en scene. */
const LECTURE = new Set(['Read', 'Glob', 'Grep', 'NotebookRead'])
const ECRITURE = new Set(['Write', 'Edit', 'NotebookEdit'])

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
    // Tout autre outil reste une action visible, faute de mieux.
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

  // Les messages system, user et les evenements de flux ne se jouent pas a
  // l'ecran au jalon 1. Ils comptent dans la dette, sans bruit.
  nonTraduits += 1
  return []
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/translators/claude.test.ts
```

Attendu : 16 tests passent. Si le bloc « contre la session réelle » échoue, ne pas
toucher au test, relire la fixture de la tâche 0 et corriger le traducteur.

- [ ] **Étape 5 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Traducteur Claude, teste contre une session reelle"
```

---

## Tâche 5 : le guichet de permissions

Le mécanisme qui fait réellement attendre l'agent. Couvre les critères 5 et 6.

**Fichiers :**
- Créer : `packages/engine/src/permissionGate.ts`
- Test : `packages/engine/src/permissionGate.test.ts`

**Interfaces :**
- Produit : la classe `PermissionGate` avec
  `ask(toolName: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionAnswer>`,
  `answer(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean`,
  `pending(): PendingAsk[]`, `cancelAll(raison: string): void`, et l'événement
  `onAsk(rappel: (ask: PendingAsk) => void): void`.
- Types :
  `PendingAsk = { requestId: string; toolName: string; summary: string; detail: string }`,
  `PermissionAnswer = { behavior: 'allow' } | { behavior: 'deny'; message: string }`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/engine/src/permissionGate.test.ts` :

```typescript
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
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/permissionGate.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./permissionGate.js"`.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/engine/src/permissionGate.ts` :

```typescript
/**
 * Faire attendre l'agent jusqu'a ce que Liam reponde.
 *
 * Intention : c'est la piece qui transforme une demande de permission en un
 * vrai arret. Le SDK appelle `ask`, qui rend une promesse non resolue. Tant que
 * l'interface n'a pas appele `answer`, l'agent ne bouge pas. Aucune expiration
 * automatique : un delai qui refuserait tout seul serait pire que l'attente,
 * parce que Liam croirait avoir le temps de reflechir.
 */
import { randomUUID } from 'node:crypto'

export type PendingAsk = {
  requestId: string
  toolName: string
  summary: string
  detail: string
}

export type PermissionAnswer =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string }

type Attente = {
  demande: PendingAsk
  resoudre: (reponse: PermissionAnswer) => void
}

/** Resume court d'une demande, pour la bulle affichee au-dessus du personnage. */
function resumer(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return `${toolName} : ${input.command}`
  if (typeof input.file_path === 'string') return `${toolName} : ${input.file_path}`
  return toolName
}

export class PermissionGate {
  private attentes = new Map<string, Attente>()
  private ecoutants: Array<(demande: PendingAsk) => void> = []

  onAsk(rappel: (demande: PendingAsk) => void): void {
    this.ecoutants.push(rappel)
  }

  ask(
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionAnswer> {
    const demande: PendingAsk = {
      requestId: randomUUID(),
      toolName,
      summary: resumer(toolName, input),
      detail: JSON.stringify(input, null, 2),
    }

    return new Promise<PermissionAnswer>((resoudre) => {
      this.attentes.set(demande.requestId, { demande, resoudre })

      // Une interruption de session doit liberer l'attente, sinon le moteur
      // garderait une promesse pendante pour toujours.
      const surAbandon = () => {
        if (this.attentes.delete(demande.requestId)) {
          resoudre({ behavior: 'deny', message: 'Session interrompue.' })
        }
      }
      if (signal.aborted) { surAbandon(); return }
      signal.addEventListener('abort', surAbandon, { once: true })

      for (const ecoutant of this.ecoutants) ecoutant(demande)
    })
  }

  answer(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const attente = this.attentes.get(requestId)
    if (!attente) return false
    this.attentes.delete(requestId)
    attente.resoudre(
      decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: reason ?? 'Refuse par Liam depuis codecity.' },
    )
    return true
  }

  pending(): PendingAsk[] {
    return [...this.attentes.values()].map((a) => a.demande)
  }

  cancelAll(raison: string): void {
    for (const [, attente] of this.attentes) {
      attente.resoudre({ behavior: 'deny', message: raison })
    }
    this.attentes.clear()
  }
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/permissionGate.test.ts
```

Attendu : 10 tests passent.

- [ ] **Étape 5 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Guichet de permissions, l agent attend vraiment"
```

---

## Tâche 6 : le lanceur de session

Couvre les critères 2, 8 et 9.

**Fichiers :**
- Créer : `packages/engine/src/session.ts`
- Test : `packages/engine/src/session.smoke.test.ts`

**Interfaces :**
- Consomme : `CityEvent` et `newEvent` de `./events.js`, `translateClaudeMessage` de
  `./translators/claude.js`, `PermissionGate` de `./permissionGate.js`.
- Produit : la classe `AgentSession` avec le constructeur
  `new AgentSession(opts: { sessionId: string; projectId: string; projectPath: string; task: string })`,
  et les membres `start(): Promise<void>`, `answerPermission(requestId, decision, reason?): boolean`,
  `interrupt(): Promise<void>`, `onEvent(rappel: (e: CityEvent) => void): void`,
  `readonly gate: PermissionGate`.

- [ ] **Étape 1 : installer le SDK**

```bash
cd /c/Users/liamb/dev/codecity
npm install --workspace @codecity/engine @anthropic-ai/claude-agent-sdk@0.3.274
```

- [ ] **Étape 2 : écrire le test de fumée, qui échoue**

Ce test lance une vraie session, donc il consomme un peu de l'abonnement. Il est isolé
dans son propre fichier pour pouvoir être exclu de la boucle rapide.

Créer `packages/engine/src/session.smoke.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { AgentSession } from './session.js'
import type { CityEvent } from './events.js'

describe('session reelle, consomme l abonnement', () => {
  it('parcourt la boucle du debut a la fin', async () => {
    const recus: CityEvent[] = []
    const session = new AgentSession({
      sessionId: 'fumee-1',
      projectId: 'projet-jouet',
      projectPath: join(process.cwd(), 'fixtures', 'projet-jouet'),
      task: 'Lis bonjour.txt et dis en une phrase ce qu il contient. N ecris aucun fichier.',
    })
    session.onEvent((e) => recus.push(e))
    await session.start()

    expect(recus[0]?.kind).toBe('session.started')
    expect(recus.some((e) => e.kind === 'agent.reads')).toBe(true)
    const fin = recus.find((e) => e.kind === 'session.ended')
    expect(fin).toBeDefined()
    expect((fin as { durationMs: number }).durationMs).toBeGreaterThan(0)
  }, 180_000)
})
```

- [ ] **Étape 3 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/session.smoke.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./session.js"`.

- [ ] **Étape 4 : écrire l'implémentation**

Créer `packages/engine/src/session.ts` :

```typescript
/**
 * Lancer une session d'agent et la raconter en evenements de codecity.
 *
 * Trois points non negociables, releves dans les types du SDK 0.3.274 :
 *
 * 1. Le prompt est un flux asynchrone, pas une chaine. C'est la seule facon
 *    d'avoir droit a `interrupt()`, donc au bouton d'arret.
 * 2. `canUseTool` recoit trois arguments positionnels, pas un objet.
 * 3. Un refus doit porter un `message`, le SDK le rend obligatoire.
 *
 * Ne jamais passer `--bare` ni definir ANTHROPIC_API_KEY ici : la session
 * doit passer par l'abonnement de Liam.
 */
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { newEvent, type CityEvent } from './events.js'
import { translateClaudeMessage } from './translators/claude.js'
import { PermissionGate } from './permissionGate.js'

export type AgentSessionOptions = {
  sessionId: string
  projectId: string
  projectPath: string
  task: string
}

export class AgentSession {
  readonly gate = new PermissionGate()
  private ecoutants: Array<(e: CityEvent) => void> = []
  private controleur = new AbortController()
  private flux: Query | null = null

  constructor(private readonly opts: AgentSessionOptions) {
    // Une demande de permission est elle-meme un evenement a jouer a l'ecran.
    this.gate.onAsk((demande) => {
      this.emettre(newEvent('agent.asks', {
        sessionId: this.opts.sessionId,
        requestId: demande.requestId,
        toolName: demande.toolName,
        summary: demande.summary,
        detail: demande.detail,
      }))
    })
  }

  onEvent(rappel: (e: CityEvent) => void): void {
    this.ecoutants.push(rappel)
  }

  private emettre(evenement: CityEvent): void {
    for (const ecoutant of this.ecoutants) ecoutant(evenement)
  }

  /**
   * Le prompt doit etre un flux. On envoie la tache, puis on laisse le flux
   * ouvert : le fermer trop tot couperait la session avant sa fin.
   */
  private async *entree(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: this.opts.task },
      parent_tool_use_id: null,
      session_id: this.opts.sessionId,
    } as SDKUserMessage
    // On attend l'abandon plutot que de rendre la main, pour garder le mode
    // entree continue actif jusqu'au bout.
    await new Promise<void>((resoudre) => {
      if (this.controleur.signal.aborted) return resoudre()
      this.controleur.signal.addEventListener('abort', () => resoudre(), { once: true })
    })
  }

  async start(): Promise<void> {
    this.emettre(newEvent('session.started', {
      sessionId: this.opts.sessionId,
      agentKind: 'claude',
      projectId: this.opts.projectId,
    }))

    this.flux = query({
      prompt: this.entree(),
      options: {
        cwd: this.opts.projectPath,
        abortController: this.controleur,
        includePartialMessages: false,
        canUseTool: (toolName, input, options) =>
          this.gate.ask(toolName, input, options.signal),
      },
    })

    try {
      for await (const message of this.flux) {
        for (const evenement of translateClaudeMessage(message, this.opts.sessionId)) {
          this.emettre(evenement)
          // La fin de session rendue par le SDK termine aussi notre flux d'entree.
          if (evenement.kind === 'session.ended') this.controleur.abort()
        }
      }
    } catch (erreur) {
      this.emettre(newEvent('agent.error', {
        sessionId: this.opts.sessionId,
        message: erreur instanceof Error ? erreur.message : String(erreur),
      }))
    } finally {
      this.gate.cancelAll('Session terminee.')
    }
  }

  answerPermission(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const accepte = this.gate.answer(requestId, decision, reason)
    if (accepte) {
      this.emettre(newEvent('agent.answered', {
        sessionId: this.opts.sessionId, requestId, decision,
      }))
    }
    return accepte
  }

  async interrupt(): Promise<void> {
    try {
      await this.flux?.interrupt()
    } finally {
      this.gate.cancelAll('Session interrompue par Liam.')
      this.controleur.abort()
    }
  }
}
```

- [ ] **Étape 5 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/session.smoke.test.ts
```

Attendu : le test passe en moins de trois minutes, et le terminal montre que l'agent a
lu le fichier.

- [ ] **Étape 6 : séparer la boucle rapide du test coûteux**

Créer `vitest.config.ts` à la racine :

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Intention : `npm test` doit rester gratuit et instantane. Les tests qui
    // consomment l abonnement portent le suffixe .smoke et se lancent a part.
    exclude: ['**/node_modules/**', '**/*.smoke.test.ts'],
  },
})
```

```bash
cd /c/Users/liamb/dev/codecity
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:smoke="vitest run --config vitest.smoke.config.ts"
```

Créer `vitest.smoke.config.ts` :

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['**/*.smoke.test.ts'], testTimeout: 180_000 },
})
```

- [ ] **Étape 7 : vérifier que la boucle rapide reste verte et gratuite**

```bash
cd /c/Users/liamb/dev/codecity
npm test
```

Attendu : tous les tests des tâches 1 à 5 passent, le test de fumée n'est pas exécuté.

- [ ] **Étape 8 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Lanceur de session, entree continue et interruption"
```

---

## Tâche 7 : les fichiers modifiés et leur diff

Couvre le critère 7.

**Fichiers :**
- Créer : `packages/engine/src/diff.ts`
- Test : `packages/engine/src/diff.test.ts`

**Interfaces :**
- Produit : le type `FileChange = { path: string; status: string; diff: string }` et
  `changedFiles(projectPath: string): Promise<FileChange[]>`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `packages/engine/src/diff.test.ts` :

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles } from './diff.js'

const lancer = promisify(execFile)
let depot: string

beforeEach(async () => {
  depot = await mkdtemp(join(tmpdir(), 'codecity-diff-'))
  await lancer('git', ['init', '-b', 'main'], { cwd: depot })
  await lancer('git', ['config', 'user.email', 'test@local'], { cwd: depot })
  await lancer('git', ['config', 'user.name', 'test'], { cwd: depot })
  await writeFile(join(depot, 'a.txt'), 'ligne un\n', 'utf8')
  await lancer('git', ['add', '.'], { cwd: depot })
  await lancer('git', ['commit', '-m', 'depart'], { cwd: depot })
})

afterEach(async () => { await rm(depot, { recursive: true, force: true }) })

describe('fichiers modifies', () => {
  it('ne rapporte rien sur un depot propre', async () => {
    expect(await changedFiles(depot)).toEqual([])
  })

  it('rapporte un fichier modifie avec son diff', async () => {
    await writeFile(join(depot, 'a.txt'), 'ligne un\nligne deux\n', 'utf8')
    const changements = await changedFiles(depot)
    expect(changements).toHaveLength(1)
    expect(changements[0]?.path).toBe('a.txt')
    expect(changements[0]?.diff).toContain('ligne deux')
  })

  it('rapporte un fichier nouveau, que git diff ignorerait sans -N', async () => {
    await writeFile(join(depot, 'nouveau.txt'), 'contenu neuf\n', 'utf8')
    const changements = await changedFiles(depot)
    expect(changements.map((c) => c.path)).toContain('nouveau.txt')
    expect(changements.find((c) => c.path === 'nouveau.txt')?.diff).toContain('contenu neuf')
  })

  it('rend une liste vide sur un dossier sans depot git, sans jeter', async () => {
    const sansGit = await mkdtemp(join(tmpdir(), 'codecity-nogit-'))
    try {
      expect(await changedFiles(sansGit)).toEqual([])
    } finally {
      await rm(sansGit, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/diff.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./diff.js"`.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/engine/src/diff.ts` :

```typescript
/**
 * Lister ce que l'agent a change, et le montrer.
 *
 * Intention : Liam doit pouvoir juger sur piece sans ouvrir son IDE. On passe
 * par git plutot que par une surveillance du systeme de fichiers, parce que git
 * sait deja distinguer un changement reel d'un fichier simplement touche.
 *
 * Piege evite : `git add --intent-to-add` est indispensable, sinon `git diff`
 * ignore silencieusement les fichiers nouveaux, et Liam ne verrait jamais un
 * fichier cree par l'agent.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const lancer = promisify(execFile)

export type FileChange = { path: string; status: string; diff: string }

export async function changedFiles(projectPath: string): Promise<FileChange[]> {
  try {
    await lancer('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath })
  } catch {
    // Pas de depot git : on ne sait rien dire, et ce n'est pas une erreur.
    return []
  }

  // Rendre les fichiers nouveaux visibles pour git diff, sans les mettre en index.
  await lancer('git', ['add', '--intent-to-add', '--all'], { cwd: projectPath })
    .catch(() => {})

  const { stdout: etat } = await lancer(
    'git', ['status', '--porcelain'], { cwd: projectPath })

  const changements: FileChange[] = []
  for (const ligne of etat.split('\n')) {
    if (!ligne.trim()) continue
    const status = ligne.slice(0, 2).trim()
    const chemin = ligne.slice(3).trim()
    const { stdout: diff } = await lancer(
      'git', ['diff', '--', chemin],
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
    ).catch(() => ({ stdout: '' }))
    changements.push({ path: chemin, status, diff })
  }
  return changements
}
```

- [ ] **Étape 4 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/diff.test.ts
```

Attendu : 4 tests passent.

- [ ] **Étape 5 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Liste des fichiers modifies et leur diff"
```

---

## Tâche 8 : le protocole et le serveur

Couvre les critères 10 et 11.

**Fichiers :**
- Créer : `packages/engine/src/protocol.ts`, `packages/engine/src/server.ts`,
  `packages/engine/src/main.ts`
- Test : `packages/engine/src/protocol.test.ts`, `packages/engine/src/server.test.ts`

**Interfaces :**
- Consomme : `scanProjects`, `AgentSession`, `changedFiles`, `writeRuntime`, `CityEvent`.
- Produit : les types `ClientMessage` et `ServerMessage`,
  `parseClientMessage(brut: string): ClientMessage | null`,
  `startServer(opts: { root: string; port: number }): Promise<{ port: number; close(): Promise<void> }>`.

Protocole retenu, volontairement court :

| Sens | Message |
|---|---|
| client vers serveur | `{ type: 'projects.list' }` |
| client vers serveur | `{ type: 'session.start', projectId, task }` |
| client vers serveur | `{ type: 'permission.answer', requestId, decision, reason? }` |
| client vers serveur | `{ type: 'session.interrupt' }` |
| client vers serveur | `{ type: 'diff.request' }` |
| client vers serveur | `{ type: 'engine.stop' }` |
| serveur vers client | `{ type: 'projects', projects }` |
| serveur vers client | `{ type: 'event', event }` |
| serveur vers client | `{ type: 'diff', changes }` |
| serveur vers client | `{ type: 'error', message }` |

- [ ] **Étape 1 : écrire le test du protocole, qui échoue**

Créer `packages/engine/src/protocol.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { parseClientMessage } from './protocol.js'

describe('lecture des messages du client', () => {
  it('accepte une demande de liste de projets', () => {
    expect(parseClientMessage('{"type":"projects.list"}'))
      .toEqual({ type: 'projects.list' })
  })

  it('accepte un demarrage de session', () => {
    expect(parseClientMessage('{"type":"session.start","projectId":"a","task":"faire"}'))
      .toEqual({ type: 'session.start', projectId: 'a', task: 'faire' })
  })

  it('accepte une reponse de permission avec sa raison', () => {
    expect(parseClientMessage(
      '{"type":"permission.answer","requestId":"r1","decision":"deny","reason":"non"}'))
      .toEqual({ type: 'permission.answer', requestId: 'r1', decision: 'deny', reason: 'non' })
  })

  it('rejette une decision qui n est ni allow ni deny', () => {
    expect(parseClientMessage(
      '{"type":"permission.answer","requestId":"r1","decision":"peut-etre"}')).toBeNull()
  })

  it('rejette un demarrage sans tache', () => {
    expect(parseClientMessage('{"type":"session.start","projectId":"a"}')).toBeNull()
  })

  it('rejette un type inconnu', () => {
    expect(parseClientMessage('{"type":"formate_le_disque"}')).toBeNull()
  })

  it('rejette du JSON invalide sans jeter', () => {
    expect(parseClientMessage('{ceci n est pas du json')).toBeNull()
  })
})
```

- [ ] **Étape 2 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/protocol.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./protocol.js"`.

- [ ] **Étape 3 : écrire le protocole**

Créer `packages/engine/src/protocol.ts` :

```typescript
/**
 * Les seuls messages qui traversent le WebSocket.
 *
 * Intention : tout ce qui vient du navigateur est suspect, meme sur une machine
 * personnelle. On valide la forme ici, une fois, et le reste du moteur peut
 * faire confiance aux valeurs qu'il recoit.
 */
import type { CityEvent } from './events.js'
import type { Project } from './projects.js'
import type { FileChange } from './diff.js'

export type ClientMessage =
  | { type: 'projects.list' }
  | { type: 'session.start'; projectId: string; task: string }
  | { type: 'permission.answer'; requestId: string; decision: 'allow' | 'deny'; reason?: string }
  | { type: 'session.interrupt' }
  | { type: 'diff.request' }
  | { type: 'engine.stop' }

export type ServerMessage =
  | { type: 'projects'; projects: Project[] }
  | { type: 'event'; event: CityEvent }
  | { type: 'diff'; changes: FileChange[] }
  | { type: 'error'; message: string }

const chaine = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function parseClientMessage(brut: string): ClientMessage | null {
  let m: Record<string, unknown>
  try {
    const analyse = JSON.parse(brut)
    if (typeof analyse !== 'object' || analyse === null) return null
    m = analyse as Record<string, unknown>
  } catch {
    return null
  }

  switch (m.type) {
    case 'projects.list':
    case 'session.interrupt':
    case 'diff.request':
    case 'engine.stop':
      return { type: m.type }
    case 'session.start':
      return chaine(m.projectId) && chaine(m.task)
        ? { type: 'session.start', projectId: m.projectId, task: m.task }
        : null
    case 'permission.answer':
      if (!chaine(m.requestId)) return null
      if (m.decision !== 'allow' && m.decision !== 'deny') return null
      return {
        type: 'permission.answer',
        requestId: m.requestId,
        decision: m.decision,
        ...(chaine(m.reason) ? { reason: m.reason } : {}),
      }
    default:
      return null
  }
}
```

- [ ] **Étape 4 : lancer le test du protocole pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/protocol.test.ts
```

Attendu : 7 tests passent.

- [ ] **Étape 5 : écrire le test du serveur, qui échoue**

```bash
cd /c/Users/liamb/dev/codecity
npm install --workspace @codecity/engine ws
npm install -D --workspace @codecity/engine @types/ws
```

Créer `packages/engine/src/server.test.ts` :

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { startServer } from './server.js'

let racine: string
let serveur: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), 'codecity-srv-'))
  process.env.CODECITY_HOME = await mkdtemp(join(tmpdir(), 'codecity-home-'))
  await mkdir(join(racine, 'projet-test'), { recursive: true })
  await writeFile(join(racine, 'projet-test', 'package.json'), '{}', 'utf8')
  serveur = await startServer({ root: racine, port: 0 })
})

afterAll(async () => {
  await serveur.close()
  delete process.env.CODECITY_HOME
  await rm(racine, { recursive: true, force: true })
})

function demander(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resoudre, rejeter) => {
    const prise = new WebSocket(`ws://127.0.0.1:${serveur.port}/flux`)
    const minuteur = setTimeout(() => { prise.close(); rejeter(new Error('delai depasse')) }, 5000)
    prise.on('open', () => prise.send(JSON.stringify(message)))
    prise.on('message', (donnees) => {
      clearTimeout(minuteur)
      prise.close()
      resoudre(JSON.parse(donnees.toString()))
    })
    prise.on('error', rejeter)
  })
}

describe('serveur', () => {
  it('repond a la sonde de sante', async () => {
    const reponse = await fetch(`http://127.0.0.1:${serveur.port}/sante`)
    expect(reponse.status).toBe(200)
    expect((await reponse.json()).ok).toBe(true)
  })

  it('rend la liste des projets par le WebSocket', async () => {
    const reponse = await demander({ type: 'projects.list' })
    expect(reponse.type).toBe('projects')
    expect((reponse.projects as Array<{ name: string }>)[0]?.name).toBe('projet-test')
  })

  it('renvoie une erreur lisible sur un message inconnu', async () => {
    const reponse = await demander({ type: 'formate_le_disque' })
    expect(reponse.type).toBe('error')
  })

  it('renvoie une erreur si on demarre une session sur un projet inconnu', async () => {
    const reponse = await demander({
      type: 'session.start', projectId: 'jamais-vu', task: 'faire' })
    expect(reponse.type).toBe('error')
  })

  it('a ecrit son port et son pid dans runtime.json', async () => {
    const { readRuntime } = await import('./store.js')
    const info = await readRuntime()
    expect(info?.port).toBe(serveur.port)
    expect(info?.pid).toBe(process.pid)
  })
})
```

- [ ] **Étape 6 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/server.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./server.js"`.

- [ ] **Étape 7 : écrire le serveur**

Créer `packages/engine/src/server.ts` :

```typescript
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
```

Créer `packages/engine/src/main.ts` :

```typescript
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
```

- [ ] **Étape 8 : lancer les tests du serveur pour les voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/engine/src/server.test.ts
```

Attendu : 5 tests passent.

- [ ] **Étape 9 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Protocole valide et serveur HTTP plus WebSocket"
```

---

## Tâche 9 : l'interface

Couvre visuellement les critères 1 à 9.

**Fichiers :**
- Créer : `packages/ui/package.json`, `packages/ui/vite.config.ts`,
  `packages/ui/index.html`, `packages/ui/src/main.tsx`, `packages/ui/src/App.tsx`,
  `packages/ui/src/useEngine.ts`, `packages/ui/src/styles.css`
- Créer : `packages/ui/src/panels/ProjectPicker.tsx`, `EventLog.tsx`,
  `PermissionPrompt.tsx`, `DiffPanel.tsx`
- Test : `packages/ui/src/useEngine.test.ts`

**Interfaces :**
- Consomme : les types `CityEvent`, `ClientMessage`, `ServerMessage` du paquet `engine`,
  importés en `import type` seulement.
- Produit : le hook `useEngine(url: string)` rendant
  `{ projects, events, pendingAsk, changes, connected, send }`.

- [ ] **Étape 1 : monter le paquet**

```bash
cd /c/Users/liamb/dev/codecity
mkdir -p packages/ui/src/panels
npm install --workspace @codecity/ui react react-dom
npm install -D --workspace @codecity/ui vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react
```

- [ ] **Étape 2 : écrire le test de l'état, qui échoue**

Créer `packages/ui/src/useEngine.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { reduire, etatInitial } from './useEngine.js'

describe('etat de l interface', () => {
  it('range les projets recus', () => {
    const e = reduire(etatInitial, { type: 'projects', projects: [
      { id: 'a', name: 'a', path: '/a', kind: 'node', hasGit: true }] })
    expect(e.projects).toHaveLength(1)
  })

  it('empile les evenements dans l ordre d arrivee', () => {
    let e = reduire(etatInitial, { type: 'event',
      event: { kind: 'agent.said', at: 1, sessionId: 's', text: 'un' } })
    e = reduire(e, { type: 'event',
      event: { kind: 'agent.reads', at: 2, sessionId: 's', path: 'a.txt' } })
    expect(e.events.map((x) => x.kind)).toEqual(['agent.said', 'agent.reads'])
  })

  it('retient la demande de permission en cours', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'agent.asks', at: 1, sessionId: 's', requestId: 'r1',
      toolName: 'Bash', summary: 'echo a', detail: '{}' } })
    expect(e.pendingAsk?.requestId).toBe('r1')
  })

  it('efface la demande une fois repondue', () => {
    let e = reduire(etatInitial, { type: 'event', event: {
      kind: 'agent.asks', at: 1, sessionId: 's', requestId: 'r1',
      toolName: 'Bash', summary: 'echo a', detail: '{}' } })
    e = reduire(e, { type: 'event', event: {
      kind: 'agent.answered', at: 2, sessionId: 's', requestId: 'r1', decision: 'allow' } })
    expect(e.pendingAsk).toBeNull()
  })

  it('marque la session terminee et retient le cout', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'session.ended', at: 1, sessionId: 's', reason: 'success',
      costUsd: 0.02, durationMs: 1000 } })
    expect(e.running).toBe(false)
    expect(e.lastCostUsd).toBe(0.02)
  })

  it('marque la session en cours au demarrage', () => {
    const e = reduire(etatInitial, { type: 'event', event: {
      kind: 'session.started', at: 1, sessionId: 's',
      agentKind: 'claude', projectId: 'a' } })
    expect(e.running).toBe(true)
  })
})
```

- [ ] **Étape 3 : lancer le test pour le voir échouer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/ui/src/useEngine.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./useEngine.js"`.

- [ ] **Étape 4 : écrire l'état et le hook**

Créer `packages/ui/src/useEngine.ts` :

```typescript
/**
 * L'etat de l'ecran, et la connexion au moteur.
 *
 * Intention : la reduction est une fonction pure, testable sans navigateur ni
 * WebSocket. Le hook se contente de brancher la prise et de rejouer les
 * messages recus dans cette fonction.
 */
import { useEffect, useReducer, useRef, useCallback } from 'react'
import type { CityEvent } from '../../engine/src/events.js'
import type { ClientMessage, ServerMessage } from '../../engine/src/protocol.js'
import type { Project } from '../../engine/src/projects.js'
import type { FileChange } from '../../engine/src/diff.js'

export type PendingAsk = {
  requestId: string; toolName: string; summary: string; detail: string
}

export type EtatEcran = {
  projects: Project[]
  events: CityEvent[]
  pendingAsk: PendingAsk | null
  changes: FileChange[]
  running: boolean
  lastCostUsd: number | null
  error: string | null
}

export const etatInitial: EtatEcran = {
  projects: [], events: [], pendingAsk: null, changes: [],
  running: false, lastCostUsd: null, error: null,
}

export function reduire(etat: EtatEcran, message: ServerMessage): EtatEcran {
  switch (message.type) {
    case 'projects':
      return { ...etat, projects: message.projects }
    case 'diff':
      return { ...etat, changes: message.changes }
    case 'error':
      return { ...etat, error: message.message }
    case 'event': {
      const e = message.event
      const suivant: EtatEcran = { ...etat, events: [...etat.events, e], error: null }
      if (e.kind === 'session.started') {
        return { ...suivant, running: true, changes: [], lastCostUsd: null }
      }
      if (e.kind === 'agent.asks') {
        return { ...suivant, pendingAsk: {
          requestId: e.requestId, toolName: e.toolName,
          summary: e.summary, detail: e.detail } }
      }
      if (e.kind === 'agent.answered') return { ...suivant, pendingAsk: null }
      if (e.kind === 'session.ended') {
        return { ...suivant, running: false, pendingAsk: null, lastCostUsd: e.costUsd }
      }
      return suivant
    }
  }
}

export function useEngine(url: string) {
  const [etat, envoyerAuReducteur] = useReducer(reduire, etatInitial)
  const prise = useRef<WebSocket | null>(null)

  useEffect(() => {
    const connexion = new WebSocket(url)
    prise.current = connexion
    connexion.onopen = () => connexion.send(JSON.stringify({ type: 'projects.list' }))
    connexion.onmessage = (evenement) => {
      try {
        envoyerAuReducteur(JSON.parse(evenement.data) as ServerMessage)
      } catch {
        // Un message illisible ne doit pas casser l'ecran.
      }
    }
    return () => connexion.close()
  }, [url])

  const send = useCallback((message: ClientMessage) => {
    prise.current?.send(JSON.stringify(message))
  }, [])

  return { ...etat, send }
}
```

- [ ] **Étape 5 : lancer le test pour le voir passer**

```bash
cd /c/Users/liamb/dev/codecity
npx vitest run packages/ui/src/useEngine.test.ts
```

Attendu : 6 tests passent.

- [ ] **Étape 6 : écrire l'écran**

Créer `packages/ui/src/App.tsx` :

```tsx
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
```

Créer `packages/ui/src/panels/PermissionPrompt.tsx` :

```tsx
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
```

Créer `packages/ui/src/panels/EventLog.tsx` :

```tsx
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
```

Créer `packages/ui/src/panels/ProjectPicker.tsx` :

```tsx
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
```

Créer `packages/ui/src/panels/DiffPanel.tsx` :

```tsx
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
```

Créer `packages/ui/src/main.tsx` :

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

createRoot(document.getElementById('racine')!).render(<App />)
```

Créer `packages/ui/index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codecity</title>
  </head>
  <body>
    <div id="racine"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Créer `packages/ui/src/styles.css` :

```css
/* Feuille volontairement minimale. Le soin visuel arrive au jalon 4. */
:root { color-scheme: light dark; --fond: #12131a; --texte: #e8e8ef; --accent: #7aa2f7; }
body { margin: 0; background: var(--fond); color: var(--texte);
  font: 15px/1.5 system-ui, sans-serif; }
.ecran { max-width: 60rem; margin: 0 auto; padding: 1rem 16px; }
header { display: flex; justify-content: space-between; align-items: center; }
.lancement { display: grid; gap: .5rem; margin: 1rem 0; }
textarea { min-height: 5rem; font: inherit; padding: .5rem; }
button { font: inherit; padding: .4rem .8rem; cursor: pointer; }
button.danger { background: #b4293b; color: white; border: 0; }
.permission { border: 2px solid var(--accent); padding: 1rem; margin: 1rem 0; }
.permission .resume { font-family: ui-monospace, monospace; font-size: 1.05rem; }
.erreur { color: #ff8f8f; }
.journal ol { list-style: none; padding: 0; }
.journal li { padding: .25rem 0; border-bottom: 1px solid #ffffff14; }
.journal strong { color: var(--accent); margin-right: .5rem; }
pre { overflow-x: auto; background: #00000040; padding: .5rem; }
@media (max-width: 40rem) { .ecran { padding: 1rem 16px; } }
```

Créer `packages/ui/vite.config.ts` :

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
```

Créer `packages/ui/package.json` :

```json
{
  "name": "@codecity/ui",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite"
  }
}
```

- [ ] **Étape 7 : construire l'interface et lancer le moteur**

```bash
cd /c/Users/liamb/dev/codecity
npm run build --workspace @codecity/ui
npm pkg set scripts.dev="tsx packages/engine/src/main.ts"
npm pkg set scripts.build="npm run build --workspace @codecity/ui && tsc -p packages/engine"
```

Le script `build` produit `packages/engine/dist/main.js`, dont l'extension VS Code a
besoin : elle lance le moteur détaché avec `node`, sans dépendre de `tsx`.

- [ ] **Étape 8 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Interface du jalon 1, laide mais complete"
```

---

## Tâche 10 : l'extension VS Code

Couvre le critère 11 depuis VS Code, et la moitié du critère 10.

**Fichiers :**
- Créer : `packages/extension/package.json`, `packages/extension/src/extension.ts`,
  `packages/extension/tsconfig.json`

**Interfaces :**
- Consomme : le moteur par HTTP, sur `/sante`, et `readRuntime()` du paquet engine pour
  connaître le port.
- Produit : trois commandes VS Code, `codecity.ouvrir`, `codecity.arreterMoteur`,
  `codecity.ouvrirDansChrome`.

- [ ] **Étape 1 : monter le paquet**

```bash
cd /c/Users/liamb/dev/codecity
mkdir -p packages/extension/src
npm install -D --workspace @codecity/extension @types/vscode
```

- [ ] **Étape 2 : écrire le manifeste**

Créer `packages/extension/package.json` :

```json
{
  "name": "codecity-extension",
  "displayName": "codecity",
  "private": true,
  "version": "0.1.0",
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      { "command": "codecity.ouvrir", "title": "codecity : ouvrir le panneau" },
      { "command": "codecity.arreterMoteur", "title": "codecity : arreter le moteur" },
      { "command": "codecity.ouvrirDansChrome", "title": "codecity : ouvrir dans le navigateur" }
    ]
  }
}
```

- [ ] **Étape 3 : écrire l'extension**

Créer `packages/extension/src/extension.ts` :

```typescript
/**
 * L'enveloppe VS Code, volontairement bete.
 *
 * Intention : aucune logique metier ici. Si ce fichier disparait, codecity
 * reste pleinement utilisable dans un navigateur. L'extension se contente de
 * demarrer le moteur s'il dort, et d'afficher la page.
 */
import * as vscode from 'vscode'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT_PREFERE = 4317

async function portDuMoteur(): Promise<number | null> {
  try {
    const brut = await readFile(join(homedir(), '.codecity', 'runtime.json'), 'utf8')
    const info = JSON.parse(brut) as { port?: number }
    return typeof info.port === 'number' ? info.port : null
  } catch {
    return null
  }
}

async function moteurRepond(port: number): Promise<boolean> {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/sante`)
    return reponse.ok
  } catch {
    return false
  }
}

async function assurerMoteur(racineDepot: string): Promise<number | null> {
  const port = (await portDuMoteur()) ?? PORT_PREFERE
  if (await moteurRepond(port)) return port

  // Le moteur est detache : il doit survivre a la fermeture de VS Code.
  // On lance le JavaScript compile, pas la source, pour ne dependre que de node.
  const enfant = spawn(
    process.execPath,
    [join(racineDepot, 'packages', 'engine', 'dist', 'main.js')],
    { detached: true, stdio: 'ignore', cwd: racineDepot },
  )
  enfant.unref()

  for (let essai = 0; essai < 30; essai += 1) {
    await new Promise((r) => setTimeout(r, 300))
    const nouveau = (await portDuMoteur()) ?? PORT_PREFERE
    if (await moteurRepond(nouveau)) return nouveau
  }
  return null
}

export function activate(contexte: vscode.ExtensionContext) {
  const racineDepot = join(contexte.extensionPath, '..', '..')

  contexte.subscriptions.push(
    vscode.commands.registerCommand('codecity.ouvrir', async () => {
      const port = await assurerMoteur(racineDepot)
      if (port === null) {
        void vscode.window.showErrorMessage(
          'Le moteur codecity ne repond pas. Lancer npm run dev dans le depot.')
        return
      }
      const panneau = vscode.window.createWebviewPanel(
        'codecity', 'codecity', vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      )
      panneau.webview.html = `<!doctype html><html lang="fr"><head>
        <meta charset="utf-8" />
        <style>html,body,iframe{margin:0;height:100%;width:100%;border:0}</style>
        </head><body><iframe src="http://127.0.0.1:${port}/"></iframe></body></html>`
    }),

    vscode.commands.registerCommand('codecity.arreterMoteur', async () => {
      const port = (await portDuMoteur()) ?? PORT_PREFERE
      try {
        await fetch(`http://127.0.0.1:${port}/arret`, { method: 'POST' })
        void vscode.window.showInformationMessage('Moteur codecity arrete.')
      } catch {
        void vscode.window.showWarningMessage('Aucun moteur codecity ne repondait.')
      }
    }),

    vscode.commands.registerCommand('codecity.ouvrirDansChrome', async () => {
      const port = await assurerMoteur(racineDepot)
      if (port !== null) {
        void vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`))
      }
    }),
  )
}

export function deactivate() {
  // Volontairement vide : le moteur doit survivre a la fermeture de VS Code.
}
```

- [ ] **Étape 4 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Extension VS Code, enveloppe minimale et moteur detache"
```

---

## Tâche 11 : la recette des onze critères

Aucun critère n'est déclaré satisfait sans exécution constatée. Cette tâche produit la
preuve, et c'est elle qui autorise à dire que le jalon 1 est fini.

**Fichiers :**
- Créer : `docs/verifications/2026-09-17-recette-jalon-1.md`
- Créer : `docs/verifications/captures/` avec une capture par critère visuel

- [ ] **Étape 1 : démarrer le moteur et ouvrir la page**

```bash
cd /c/Users/liamb/dev/codecity
npm run build
npm run dev
```

Attendu : `codecity ecoute sur http://127.0.0.1:4317`. Le `npm run build` compile
l'interface et le moteur, ce dernier étant nécessaire au critère 10, qui passe par
l'extension VS Code.

- [ ] **Étape 2 : passer les onze critères un par un**

Piloter le navigateur avec les outils Chrome DevTools, et pour chaque critère prendre
une capture. Le scénario qui les couvre tous, dans l'ordre :

1. Ouvrir la page, vérifier que la liste des projets de `dev` est peuplée. **Critère 1.**
2. Choisir `fixtures/projet-jouet` par son entrée dans la liste, saisir « Lis
   bonjour.txt, puis lance la commande echo termine, puis ajoute une ligne au fichier »,
   lancer. **Critère 2.**
3. Vérifier qu'une ligne « lit bonjour.txt » apparaît. **Critère 3.**
4. Vérifier qu'une ligne « lance echo termine » apparaît. **Critère 4.**
5. À la demande de permission, **ne rien faire pendant trente secondes**, et vérifier
   qu'aucun nouvel événement n'arrive dans le journal. Capturer le journal avant et
   après l'attente, les deux captures doivent être identiques. **Critère 5.**
6. Refuser la permission, vérifier que l'agent en tient compte et ne relance pas la
   même commande. **Critère 6.**
7. Relancer une session qui modifie le fichier, autoriser, puis cliquer « Rafraichir »
   dans le panneau des diffs et vérifier que le contenu ajouté s'affiche. **Critère 7.**
8. Lancer une tâche longue, cliquer « Interrompre », vérifier l'arrêt. **Critère 8.**
9. Vérifier qu'une durée et un coût s'affichent en fin de session. **Critère 9.**
10. Lancer une tâche longue, fermer VS Code, rouvrir `http://127.0.0.1:4317` dans
    Chrome, vérifier que la session a continué. **Critère 10.**
11. Cliquer « Arreter le moteur », puis vérifier que la page ne répond plus et
    qu'aucun processus node de codecity ne subsiste :

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4317/sante || echo "moteur arrete"
```

**Critère 11.**

- [ ] **Étape 3 : écrire la recette**

Créer `docs/verifications/2026-09-17-recette-jalon-1.md` avec exactement cette forme,
une ligne par critère :

```markdown
# Recette du jalon 1, 2026-09-17

| Nº | Critère | Constaté | Preuve |
|---|---|---|---|
| 1 | La liste des projets de dev s'affiche avec type et git | oui / non | captures/01-projets.png |
| 2 | Une tâche lancée produit une session visible et un flux | oui / non | captures/02-session.png |
| 3 | Une lecture de fichier apparaît comme agent.reads | oui / non | captures/03-lecture.png |
| 4 | Une commande apparaît comme agent.runs | oui / non | captures/04-commande.png |
| 5 | Une demande de permission arrête réellement l'agent | oui / non | captures/05-avant.png et 05-apres.png |
| 6 | Un refus est transmis et pris en compte | oui / non | captures/06-refus.png |
| 7 | Les fichiers modifiés et leur diff sont consultables | oui / non | captures/07-diff.png |
| 8 | Le bouton d'interruption arrête la session | oui / non | captures/08-interruption.png |
| 9 | La fin de session affiche durée et coût | oui / non | captures/09-cout.png |
| 10 | Fermer VS Code n'interrompt pas la session | oui / non | captures/10-survie.png |
| 11 | Le bouton d'arrêt du moteur fonctionne | oui / non | sortie de la commande curl |

## Ce qui n'a pas été constaté

[une ligne par critère non constaté, avec ce qui bloque]
```

Un critère non constaté s'écrit « non », jamais « devrait marcher ». Le jalon 1 n'est
déclaré fini que lorsque les onze lignes portent « oui ».

- [ ] **Étape 4 : commit**

```bash
cd /c/Users/liamb/dev/codecity
git add -A
git commit -m "Recette du jalon 1, onze criteres constates"
```

---

## Couverture de la spec par les tâches

| Exigence de la spec | Tâche |
|---|---|
| Étape zéro, abonnement constaté (8.2) | 0 |
| Contrat des onze événements (4) | 1 |
| Compteur de dette de traduction (4) | 4 |
| Stockage dans `.codecity`, écriture atomique (6) | 2 |
| `runtime.json` avec port et PID (3.4) | 2, 8 |
| Registre de projets, critère 1 | 3 |
| Traducteur Claude, critères 3 et 4 (5.1) | 4 |
| Permissions bloquantes, critères 5 et 6 | 5, 6, 9 |
| Session, critères 2, 8, 9 | 6 |
| Diff, critère 7 | 7 |
| Serveur, protocole, arrêt du moteur, critère 11 | 8 |
| Interface, mise en scène des événements | 9 |
| Extension VS Code, critère 10 | 10 |
| Filet visuel, recette des onze critères (9) | 11 |
| Traducteur Codex (5.2) | hors jalon 1, assumé |
