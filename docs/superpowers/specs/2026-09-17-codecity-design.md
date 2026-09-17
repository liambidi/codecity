# codecity, conception validée

Date : 2026-09-17
Statut : validée par Liam le 2026-09-17, avant plan d'implémentation
Dépôt : C:\Users\liamb\dev\codecity

---

## 1. Objectif

Piloter Claude Code, Codex et d'autres agents CLI sur n'importe lequel des projets de
Liam, depuis une interface visuelle où chaque agent est un personnage et chaque tâche
restante une quête.

**Critère de réussite du produit.** Liam peut lancer, suivre, interrompre et valider une
session d'agent sur un de ses projets sans ouvrir de terminal, avec les mêmes capacités
que le CLI.

**Critère de réussite du jalon 1**, seul jalon engagé à ce stade : voir la section 8.

---

## 2. Décisions arbitrées avec Liam le 2026-09-17

| Sujet | Décision | Conséquence assumée |
|---|---|---|
| Enveloppe | Extension VS Code, et la même page accessible dans Chrome | Deux surfaces, un seul code d'interface |
| Moteur | Processus séparé, survit à la fermeture de VS Code | Un processus en fond, donc un bouton d'arrêt explicite est obligatoire |
| Pilotage | Événements structurés, pas de terminal embarqué en v1 | Si un agent fait une chose non traduite, elle est invisible au jalon 1 |
| Visuel v1 | Pièce 2D vue de dessus, sprites simples, HTML et CSS ordinaires | Plafond à quelques dizaines de personnages, suffisant |
| Sources de quêtes | TODO du code et saisie manuelle d'abord, GitHub et agent-scanner ensuite, autres sources plus tard | Le tableau se remplit même sans remote GitHub |
| Données | Dans le dossier `.codecity` du profil utilisateur, jamais dans un dépôt de projet | Aucun risque de commit accidentel de l'état |
| Premier jalon | Un agent, un projet, la boucle complète | Tranché par Claude, Liam ne savait pas, correction possible à la livraison |

---

## 3. Architecture, trois modules et leurs frontières

Le dépôt est un espace de travail npm avec trois paquets.

### 3.1 `engine`, le moteur

Programme Node autonome. Lancé par l'extension ou à la main, il continue de tourner
quand VS Code se ferme. Responsabilités :

- tenir le registre des projets,
- lancer et arrêter les sessions d'agent,
- traduire ce que disent les agents vers le vocabulaire de la section 4,
- tenir les quêtes,
- servir l'interface en HTTP et diffuser les événements en WebSocket.

**Ce qu'il ignore** : tout du rendu. Aucun mot de vocabulaire graphique, ni avatar, ni
pièce, ni sprite, n'apparaît dans ce paquet.

### 3.2 `ui`, l'interface

Application web servie par le moteur, construite avec Vite et React. Elle reçoit des
événements et les met en scène. Elle envoie des intentions : démarrer une session,
répondre à une permission, interrompre.

**Ce qu'elle ignore** : tout des agents. Les mots `claude`, `codex`, `sdk` n'apparaissent
nulle part dans ce paquet, sauf comme simple étiquette affichée.

### 3.3 `extension`, l'extension VS Code

Volontairement minimale. Vérifier que le moteur répond, le démarrer sinon, ouvrir un
panneau qui affiche l'URL locale, offrir une commande d'arrêt du moteur.

**Ce qu'elle ignore** : toute la logique métier. Si elle est supprimée, l'outil reste
pleinement utilisable dans Chrome.

### 3.4 Communication

Interface et moteur échangent en WebSocket sur une seule connexion. L'extension ne fait
que du HTTP de santé et d'arrêt. Le moteur écoute par défaut sur le port 4317, et prend
le premier port libre au-dessus si celui-ci est pris, en écrivant le port retenu et son
PID dans `.codecity/runtime.json`.

---

## 4. Le vocabulaire commun, contrat central du projet

Tous les agents, quels qu'ils soient, sont traduits vers cette liste unique. C'est le
seul contrat que l'interface connaît. Ajouter un agent, c'est écrire un traducteur vers
cette liste, et rien d'autre.

| Événement | Charge utile | Mise en scène prévue |
|---|---|---|
| `session.started` | sessionId, agentKind, projectId | le personnage entre |
| `agent.thinking` | sessionId | bulle de pensée |
| `agent.said` | sessionId, text | bulle de dialogue |
| `agent.reads` | sessionId, path | il se tourne vers l'étagère |
| `agent.writes` | sessionId, path | il tape, le fichier entre dans son inventaire |
| `agent.runs` | sessionId, command | animation d'établi |
| `agent.asks` | sessionId, requestId, toolName, summary, detail | il lève la main et attend vraiment |
| `agent.plan` | sessionId, requestId, plan | parchemin, en attente d'accord |
| `agent.answered` | sessionId, requestId, decision | il repart ou renonce |
| `agent.error` | sessionId, message | il s'assied, message visible |
| `session.ended` | sessionId, reason, costUsd, durationMs | il range, le coût s'affiche |

**Règle de conception.** Aucun événement supplémentaire n'est ajouté sans qu'une scène
correspondante soit décidée. Un événement que l'interface ne sait pas jouer est un
événement inutile.

**Règle de repli.** Tout message d'agent non reconnu par un traducteur compte dans un
compteur `untranslated` exposé par le moteur. Ce compteur mesure la dette de traduction,
et sert à décider quand le terminal de repli devient nécessaire.

---

## 5. Les traducteurs

### 5.1 Claude, via `@anthropic-ai/claude-agent-sdk`

Vérifié le 2026-09-17 : paquet présent sur npm en version 0.3.274, CLI `claude` local en
version 2.1.273.

Correspondance retenue :

| Source SDK | Événement produit |
|---|---|
| bloc `thinking` | `agent.thinking` |
| bloc `text` d'un message assistant | `agent.said` |
| `tool_use` nommé Read, Glob ou Grep | `agent.reads` |
| `tool_use` nommé Write ou Edit | `agent.writes` |
| `tool_use` nommé Bash | `agent.runs` |
| appel du rappel `canUseTool` | `agent.asks`, la promesse n'est résolue qu'à la réponse de l'interface |
| `tool_use` nommé ExitPlanMode | `agent.plan` |
| message `result` final | `session.ended`, avec le coût total |

Le blocage réel des permissions repose sur `canUseTool`. Sa signature exacte, relevée
dans `sdk.d.ts` de la version 0.3.274 et non dans la documentation en ligne qui se
trompe sur ce point, est reproduite dans le plan d'implémentation.

### 5.2 Codex, via `codex exec --json`

Vérifié le 2026-09-17 : `codex exec` accepte `--json`, qui écrit les événements en JSONL
sur la sortie standard, ainsi que `resume`, `fork`, `--cd` et les modes de bac à sable.

**La correspondance précise n'est pas établie dans cette spec, et ne doit pas être
devinée.** Première tâche du traducteur Codex : enregistrer une session réelle sur un
projet jouet, sauvegarder le JSONL obtenu comme fixture, et écrire la correspondance à
partir de cet enregistrement. Toute correspondance écrite sans fixture est refusée en
revue.

---

## 6. Modèle de données

    Project  { id, name, path, kind, hasGit }
    Quest    { id, title, projectId, source, status, createdAt, sessionId, notes }
    Session  { id, agentKind, projectId, questId, startedAt, endedAt, costUsd, status }

- `source` d'une quête : `manual`, `scan`, `github`, `agent`.
- `status` d'une quête : `todo`, `doing`, `done`, `abandoned`.
- `kind` d'un projet : `node`, `python`, `web`, `autre`, déduit des fichiers présents.

**Stockage.** Fichiers JSON dans le dossier `.codecity` du profil utilisateur :
`projects.json`, `quests.json`, `runtime.json`. Écriture atomique par fichier temporaire
puis renommage. Pas de base de données tant qu'un fichier JSON suffit, c'est-à-dire tant
que Liam peut l'ouvrir et le corriger à la main.

---

## 7. Jalons

| Jalon | Contenu | État |
|---|---|---|
| 1 | Un agent, un projet, la boucle complète | engagé, détaillé ci-dessous |
| 2 | La pièce, plusieurs agents en parallèle, les quêtes issues du scan et de la saisie | prévu, non spécifié |
| 3 | Gestion du setup local : MCP, skills, réglages | prévu, non spécifié |
| 4 | Montée en fidélité visuelle | prévu, non spécifié |

Chaque jalon reçoit sa propre spec avant d'être construit.

---

## 8. Jalon 1, périmètre exact et critères d'acceptation

### 8.1 Périmètre

Une page unique. Liam choisit un projet dans une liste détectée automatiquement, écrit
une tâche, et suit une session Claude Code du début à la fin. Un seul agent, une seule
session à la fois. Aucune pièce dessinée, aucune quête, aucun Codex.

### 8.2 Étape zéro, bloquante

Avant toute ligne d'interface : constater sur la machine de Liam qu'une session lancée
par le moteur consomme bien son abonnement Claude Code et non une clé API facturée.

La documentation officielle l'affirme en creux, à propos du mode `--bare` : *bare mode
doesn't use your subscription login*. Cela reste un fait documenté, pas un fait constaté
ici. Si la constatation échoue, le projet ne s'arrête pas, mais son coût change de
nature et la décision de continuer revient à Liam.

### 8.3 Critères d'acceptation, vérifiables un par un

1. La liste des projets de `C:\Users\liamb\dev` s'affiche, avec pour chacun son type et
   la présence ou non d'un dépôt git.
2. Une tâche lancée sur un projet produit une session visible et un flux d'événements
   qui défile. Un personnage figure la session, sans décor autour de lui.
3. Une lecture de fichier par l'agent produit un `agent.reads` affiché à l'écran.
4. Une commande lancée par l'agent produit un `agent.runs` affiché à l'écran.
5. Une demande de permission arrête réellement l'agent, qui ne reprend qu'après le clic.
   Vérifié en constatant qu'aucun événement ne progresse pendant l'attente.
6. Un refus de permission est transmis à l'agent, qui en tient compte.
7. Les fichiers modifiés sont listés, et leur diff est consultable dans la page.
8. Le bouton d'interruption arrête la session en cours.
9. La fin de session affiche une durée et un coût.
10. La fermeture de VS Code n'interrompt pas une session en cours, et la page reste
    consultable dans Chrome.
11. Un bouton d'arrêt du moteur existe et fonctionne, sans avoir à chercher un processus.

### 8.4 Hors périmètre du jalon 1

Codex, plusieurs sessions simultanées, les quêtes, la pièce dessinée, la gestion des MCP
et des skills, le terminal de repli, la reprise de session.

---

## 9. Vérification

Liam ne relit ni le code ni les chiffres. Deux filets complémentaires, aucun n'est
optionnel.

**Filet automatique.** Les traducteurs de la section 5 sont des fonctions pures, testées
avec Vitest contre des enregistrements réels de sessions, conservés comme fixtures dans
le dépôt. Une évolution du format d'un CLI se manifeste par un test rouge, avant que
Liam ne s'en aperçoive à l'usage.

**Filet visuel.** Tout critère d'acceptation visible est constaté en pilotant Chrome,
avec capture d'écran à l'appui, jamais annoncé sur la foi du code écrit.

**Règle de langage.** Un critère est dit satisfait seulement après exécution constatée.
Tout le reste est annoncé comme déduit ou supposé.

---

## 10. Risques identifiés

| Risque | Gravité | Réponse |
|---|---|---|
| Le pilotage n'utilise pas l'abonnement | tue le projet sous sa forme actuelle | testé en étape zéro du jalon 1, avant tout le reste |
| Le format des événements des CLI change | élevé, silencieux | traducteurs isolés, fixtures, tests |
| Dépense parallèle non maîtrisée au jalon 2 | moyen | compteur visible et plafond de dépense par session, réglable |
| Processus moteur orphelin en fond | moyen, agaçant | port et PID dans `runtime.json`, bouton d'arrêt, commande VS Code dédiée |
| Interface trop étroite dans le panneau VS Code | faible | la même page s'ouvre en plein écran dans Chrome, par construction |

---

## 11. Conventions du dépôt

- Interface et moteur en TypeScript, commentaires en français.
- Aucun tiret cadratin, dans le code comme dans les textes.
- Le français des documents porte ses accents. Les identifiants de code, les noms de
  fichiers et les messages de commit restent sans accents, pour ne pas dépendre de
  l'encodage du terminal Windows.
- Un `README.md` court à la racine, outils requis listés dedans.
- Expliquer l'intention d'une fonction avant de l'écrire, pas seulement son résultat.

---

## Annexe, faits vérifiés le 2026-09-17

| Fait | Source |
|---|---|
| Node 24.16.0, npm 11.13.0, Python 3.13.13, git 2.54.0 | commandes `--version` |
| `claude` 2.1.273 et `codex` installés dans le npm global de l'utilisateur | `where`, `claude --version` |
| `@anthropic-ai/claude-agent-sdk` en 0.3.274 | `npm view` |
| `codex exec` accepte `--json`, `resume`, `fork`, `--cd` | `codex exec --help` |
| Une session non `--bare` utilise la connexion par abonnement | documentation officielle, page Run Claude Code programmatically |
| `canUseTool` reçoit trois arguments positionnels et rend `{ behavior: 'allow' }` ou `{ behavior: 'deny', message }` | `sdk.d.ts` du paquet installé, version 0.3.274 |
| `interrupt()` n'existe qu'en mode entrée continue | `sdk.d.ts`, interface `Query` |
| Aucun dépôt git n'englobe `C:\Users\liamb\dev` | `git rev-parse --show-toplevel` |
