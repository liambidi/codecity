# codecity, conception validee

Date : 2026-09-17
Statut : valide par Liam le 2026-09-17, avant plan d'implementation
Depot : C:\Users\liamb\dev\codecity

---

## 1. Objectif

Piloter Claude Code, Codex et d'autres agents CLI sur n'importe lequel des projets de
Liam, depuis une interface visuelle ou chaque agent est un personnage et chaque tache
restante une quete.

**Critere de reussite du produit.** Liam peut lancer, suivre, interrompre et valider une
session d'agent sur un de ses projets sans ouvrir de terminal, avec les memes capacites
que le CLI.

**Critere de reussite du jalon 1**, seul jalon engage a ce stade : voir la section 8.

---

## 2. Decisions arbitrees avec Liam le 2026-09-17

| Sujet | Decision | Consequence assumee |
|---|---|---|
| Enveloppe | Extension VS Code, et la meme page accessible dans Chrome | Deux surfaces, un seul code d'interface |
| Moteur | Processus separe, survit a la fermeture de VS Code | Un processus en fond, donc un bouton d'arret explicite est obligatoire |
| Pilotage | Evenements structures, pas de terminal embarque en v1 | Si un agent fait une chose non traduite, elle est invisible au jalon 1 |
| Visuel v1 | Piece 2D vue de dessus, sprites simples, HTML et CSS ordinaires | Plafond a quelques dizaines de personnages, suffisant |
| Sources de quetes | TODO du code et saisie manuelle d'abord, GitHub et agent-scanner ensuite, autres sources plus tard | Le tableau se remplit meme sans remote GitHub |
| Donnees | Dans le dossier `.codecity` du profil utilisateur, jamais dans un depot de projet | Aucun risque de commit accidentel de l'etat |
| Premier jalon | Un agent, un projet, la boucle complete | Tranche par Claude, Liam ne savait pas, correction possible a la livraison |

---

## 3. Architecture, trois modules et leurs frontieres

Le depot est un espace de travail npm avec trois paquets.

### 3.1 `engine`, le moteur

Programme Node autonome. Lance par l'extension ou a la main, il continue de tourner
quand VS Code se ferme. Responsabilites :

- tenir le registre des projets,
- lancer et arreter les sessions d'agent,
- traduire ce que disent les agents vers le vocabulaire de la section 4,
- tenir les quetes,
- servir l'interface en HTTP et diffuser les evenements en WebSocket.

**Ce qu'il ignore** : tout du rendu. Aucun mot de vocabulaire graphique, ni avatar, ni
piece, ni sprite, n'apparait dans ce paquet.

### 3.2 `ui`, l'interface

Application web servie par le moteur, construite avec Vite et React. Elle recoit des
evenements et les met en scene. Elle envoie des intentions : demarrer une session,
repondre a une permission, interrompre.

**Ce qu'elle ignore** : tout des agents. Les mots `claude`, `codex`, `sdk` n'apparaissent
nulle part dans ce paquet, sauf comme simple etiquette affichee.

### 3.3 `extension`, l'extension VS Code

Volontairement minimale. Verifier que le moteur repond, le demarrer sinon, ouvrir un
panneau qui affiche l'URL locale, offrir une commande d'arret du moteur.

**Ce qu'elle ignore** : toute la logique metier. Si elle est supprimee, l'outil reste
pleinement utilisable dans Chrome.

### 3.4 Communication

Interface et moteur echangent en WebSocket sur une seule connexion. L'extension ne fait
que du HTTP de sante. Le moteur ecoute par defaut sur le port 4317, et prend le premier
port libre au-dessus si celui-ci est pris, en ecrivant le port retenu et son PID dans
`.codecity/runtime.json`.

---

## 4. Le vocabulaire commun, contrat central du projet

Tous les agents, quels qu'ils soient, sont traduits vers cette liste unique. C'est le
seul contrat que l'interface connait. Ajouter un agent, c'est ecrire un traducteur vers
cette liste, et rien d'autre.

| Evenement | Charge utile | Mise en scene prevue |
|---|---|---|
| `session.started` | sessionId, agentKind, projectId, startedAt | le personnage entre |
| `agent.thinking` | sessionId | bulle de pensee |
| `agent.said` | sessionId, text | bulle de dialogue |
| `agent.reads` | sessionId, path | il se tourne vers l'etagere |
| `agent.writes` | sessionId, path, changeId | il tape, le fichier entre dans son inventaire |
| `agent.runs` | sessionId, command | animation d'etabli |
| `agent.asks` | sessionId, requestId, toolName, summary, detail | il leve la main et attend vraiment |
| `agent.plan` | sessionId, requestId, plan | parchemin, en attente d'accord |
| `agent.answered` | sessionId, requestId, decision | il repart ou renonce |
| `agent.error` | sessionId, message | il s'assied, message visible |
| `session.ended` | sessionId, reason, costUsd, durationMs | il range, le cout s'affiche |

**Regle de conception.** Aucun evenement supplementaire n'est ajoute sans qu'une scene
correspondante soit decidee. Un evenement que l'interface ne sait pas jouer est un
evenement inutile.

**Regle de repli.** Tout message d'agent non reconnu par un traducteur est conserve tel
quel dans le journal de session sur disque, et compte dans un compteur `untranslated`
expose par le moteur. Ce compteur mesure la dette de traduction, et sert a decider quand
le terminal de repli devient necessaire.

---

## 5. Les traducteurs

### 5.1 Claude, via `@anthropic-ai/claude-agent-sdk`

Verifie le 2026-09-17 : paquet present sur npm en version 0.3.274, CLI `claude` local en
version 2.1.273.

Correspondance retenue :

| Source SDK | Evenement produit |
|---|---|
| bloc `thinking` | `agent.thinking` |
| bloc `text` d'un message assistant | `agent.said` |
| `tool_use` nomme Read, Glob ou Grep | `agent.reads` |
| `tool_use` nomme Write ou Edit | `agent.writes` |
| `tool_use` nomme Bash | `agent.runs` |
| appel du rappel `canUseTool` | `agent.asks`, la promesse n'est resolue qu'a la reponse de l'interface |
| `tool_use` nomme ExitPlanMode | `agent.plan` |
| message `result` final | `session.ended`, avec le cout total |

Le blocage reel des permissions repose sur `canUseTool`, dont la doc precise qu'il n'est
appele que lorsque le flux de permission aboutirait a une invite. Les regles
d'auto-approbation restent donc respectees.

### 5.2 Codex, via `codex exec --json`

Verifie le 2026-09-17 : `codex exec` accepte `--json`, qui ecrit les evenements en JSONL
sur la sortie standard, ainsi que `resume`, `fork`, `--cd` et les modes de bac a sable.

**La correspondance precise n'est pas etablie dans cette spec, et ne doit pas etre
devinee.** Premiere tache du traducteur Codex : enregistrer une session reelle sur un
projet jouet, sauvegarder le JSONL obtenu comme fixture, et ecrire la correspondance a
partir de cet enregistrement. Toute correspondance ecrite sans fixture est refusee en
revue.

---

## 6. Modele de donnees

    Project  { id, name, path, kind, hasGit, remote, lastSeenAt }
    Quest    { id, title, projectId, source, status, createdAt, sessionId, notes }
    Session  { id, agentKind, projectId, questId, startedAt, endedAt, costUsd, status }

- `source` d'une quete : `manual`, `scan`, `github`, `agent`.
- `status` d'une quete : `todo`, `doing`, `done`, `abandoned`.
- `kind` d'un projet : `node`, `python`, `web`, `autre`, deduit des fichiers presents.

**Stockage.** Fichiers JSON dans le dossier `.codecity` du profil utilisateur :
`projects.json`, `quests.json`, `runtime.json`, et un journal par session sous
`sessions/<id>.jsonl`. Ecriture atomique par fichier temporaire puis renommage. Pas de
base de donnees tant qu'un fichier JSON suffit, c'est-a-dire tant que Liam peut l'ouvrir
et le corriger a la main.

---

## 7. Jalons

| Jalon | Contenu | Etat |
|---|---|---|
| 1 | Un agent, un projet, la boucle complete | engage, detaille ci-dessous |
| 2 | La piece, plusieurs agents en parallele, les quetes issues du scan et de la saisie | prevu, non specifie |
| 3 | Gestion du setup local : MCP, skills, reglages | prevu, non specifie |
| 4 | Montee en fidelite visuelle | prevu, non specifie |

Chaque jalon recoit sa propre spec avant d'etre construit.

---

## 8. Jalon 1, perimetre exact et criteres d'acceptation

### 8.1 Perimetre

Une page unique. Liam choisit un projet dans une liste detectee automatiquement, ecrit
une tache, et suit une session Claude Code du debut a la fin. Un seul agent, une seule
session a la fois. Aucune piece dessinee, aucune quete, aucun Codex.

### 8.2 Etape zero, bloquante

Avant toute ligne d'interface : constater sur la machine de Liam qu'une session lancee
par le moteur consomme bien son abonnement Claude Code et non une cle API facturee.

La doc officielle l'affirme en creux, a propos du mode `--bare` : *bare mode doesn't use
your subscription login*. Cela reste un fait documente, pas un fait constate ici. Si la
constatation echoue, le projet ne s'arrete pas, mais son cout change de nature et la
decision de continuer revient a Liam.

### 8.3 Criteres d'acceptation, verifiables un par un

1. La liste des projets de `C:\Users\liamb\dev` s'affiche, avec pour chacun son type et
   la presence ou non d'un depot git.
2. Une tache lancee sur un projet produit une session visible et un flux d'evenements
   qui defile. Un personnage figure la session, sans decor autour de lui.
3. Une lecture de fichier par l'agent produit un `agent.reads` affiche a l'ecran.
4. Une commande lancee par l'agent produit un `agent.runs` affiche a l'ecran.
5. Une demande de permission arrete reellement l'agent, qui ne reprend qu'apres le clic.
   Verifie en constatant qu'aucun evenement ne progresse pendant l'attente.
6. Un refus de permission est transmis a l'agent, qui en tient compte.
7. Les fichiers modifies sont listes, et leur diff est consultable dans la page.
8. Le bouton d'interruption arrete la session en cours.
9. La fin de session affiche une duree et un cout.
10. La fermeture de VS Code n'interrompt pas une session en cours, et la page reste
    consultable dans Chrome.
11. Un bouton d'arret du moteur existe et fonctionne, sans avoir a chercher un processus.

### 8.4 Hors perimetre du jalon 1

Codex, plusieurs sessions simultanees, les quetes, la piece dessinee, la gestion des MCP
et des skills, le terminal de repli, la reprise de session.

---

## 9. Verification

Liam ne relit ni le code ni les chiffres. Deux filets complementaires, aucun n'est
optionnel.

**Filet automatique.** Les traducteurs de la section 5 sont des fonctions pures, testees
avec Vitest contre des enregistrements reels de sessions, conserves comme fixtures dans
le depot. Une evolution du format d'un CLI se manifeste par un test rouge, avant que
Liam ne s'en apercoive a l'usage.

**Filet visuel.** Tout critere d'acceptation visible est constate en pilotant Chrome, avec
capture d'ecran a l'appui, jamais annonce sur la foi du code ecrit.

**Regle de langage.** Un critere est dit satisfait seulement apres execution constatee.
Tout le reste est annonce comme deduit ou suppose.

---

## 10. Risques identifies

| Risque | Gravite | Reponse |
|---|---|---|
| Le pilotage n'utilise pas l'abonnement | tue le projet sous sa forme actuelle | teste en etape zero du jalon 1, avant tout le reste |
| Le format des evenements des CLI change | eleve, silencieux | traducteurs isoles, fixtures, tests |
| Depense parallele non maitrisee au jalon 2 | moyen | compteur visible et plafond de depense par session, reglable |
| Processus moteur orphelin en fond | moyen, agacant | port et PID dans `runtime.json`, bouton d'arret, commande VS Code dediee |
| Interface trop etroite dans le panneau VS Code | faible | la meme page s'ouvre en plein ecran dans Chrome, par construction |

---

## 11. Conventions du depot

- Interface et moteur en TypeScript, commentaires en francais.
- Aucun tiret cadratin, dans le code comme dans les textes.
- Un `README.md` court a la racine, outils requis listes dedans.
- Expliquer l'intention d'une fonction avant de l'ecrire, pas seulement son resultat.

---

## Annexe, faits verifies le 2026-09-17

| Fait | Source |
|---|---|
| Node 24.16.0, npm 11.13.0, Python 3.13.13, git 2.54.0 | commandes `--version` |
| `claude` 2.1.273 et `codex` installes dans le npm global de l'utilisateur | `where`, `claude --version` |
| `@anthropic-ai/claude-agent-sdk` en 0.3.274 | `npm view` |
| `codex exec` accepte `--json`, `resume`, `fork`, `--cd` | `codex exec --help` |
| Une session non `--bare` utilise la connexion par abonnement | doc officielle, page Run Claude Code programmatically |
| `canUseTool` n'est appele que si le flux aboutirait a une invite | doc officielle, reference TypeScript du SDK |
| Aucun depot git n'englobe `C:\Users\liamb\dev` | `git rev-parse --show-toplevel` |
