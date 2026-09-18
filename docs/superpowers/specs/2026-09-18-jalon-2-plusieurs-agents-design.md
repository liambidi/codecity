# codecity, jalon 2, plusieurs agents en conversation

> Conception validée avec Liam le 2026-09-18, après le jalon 1 dont les onze critères
> sont constatés dans `docs/verifications/2026-09-18-recette-jalon-1.md`.
> La conception d'ensemble reste `docs/superpowers/specs/2026-09-17-codecity-design.md`.
> Ce document ne vaut que pour le jalon 2 et corrige la spec d'origine sur trois points,
> signalés en section 12.

---

## 1. Objectif

Remplacer les fenêtres de chat de VS Code, pas les compléter.

Liam travaille aujourd'hui avec plusieurs sessions Claude Code ouvertes en même temps,
parfois sur le même dépôt, et il passe de l'une à l'autre en changeant de fenêtre. Le
jalon 2 met toutes ces conversations au même endroit, vivantes, pilotables, et rend
visible ce que les fenêtres séparées cachent : qui travaille, qui attend une réponse,
qui touche quel fichier, et combien il reste d'abonnement.

Le jalon 1 a prouvé que la boucle tient sur un agent. Le jalon 2 la met au pluriel. La
mise en scène graphique appartient au jalon 3, elle n'est pas ici.

---

## 2. Décisions arbitrées avec Liam le 2026-09-18

| Sujet | Décision | Conséquence assumée |
|---|---|---|
| Découpage | Trois jalons séparés, la plomberie multi d'abord, la pièce ensuite, les quêtes en dernier | Ce jalon ne change presque rien à l'esthétique de l'écran |
| Codex | Pas d'intégration, mais vérification du vocabulaire contre un enregistrement réel | On apprend si le pari central tient, sans payer le prix de l'intégration |
| Deux agents sur un même projet | Autorisé, c'est le cas d'usage central | Risque d'écrasement réel, rendu visible au lieu d'être interdit |
| Dialogue | Conversation continue, on peut couper la parole à un agent qui travaille | La session ne meurt plus à la fin d'un tour, changement profond du moteur |
| Limite d'abonnement | Jauge visible en permanence, alerte, aucun blocage automatique | Liam peut épuiser sa limite s'il le décide, l'outil informe et ne commande pas |
| Reprise | Complète, dans ce jalon | Le jalon passe d'environ vingt à environ trente tâches |
| Disposition | Une tuile par conversation, clic pour ouvrir | Une tuile deviendra un personnage au jalon 3, sans rien casser |
| Vocabulaire | Un douzième événement, l'agent attend ta réponse | Chaque traducteur futur devra savoir dire douze mots au lieu de onze |
| Où vivent les agents | Un carnet de conversations dans le moteur existant | Le moteur reste un point unique de panne, compensé par la reprise |

---

## 3. Périmètre

### 3.1 Dans le jalon

Plusieurs conversations Claude vivantes en parallèle, sur n'importe quels projets, y
compris plusieurs sur le même. Dialogue continu avec chacune, y compris pendant qu'un
agent travaille. Reprise des conversations après un redémarrage du moteur ou de la
machine. Jauge d'abonnement alimentée par le signal réel du SDK. Attribution des
fichiers modifiés à l'agent qui les a écrits, et signalement des fichiers touchés par
deux agents.

### 3.2 Hors du jalon, explicitement

La pièce dessinée et les personnages, les quêtes, l'intégration de Codex, les copies de
dépôt isolées par session, le terminal de repli, le partage d'une conversation entre
deux machines, le plafond de dépense en dollars.

---

## 4. Étape zéro, bloquante

Aucune ligne de code de production n'est écrite avant que ces deux tests soient passés
et leur résultat consigné dans `docs/verifications/`. C'est le même principe qu'au
jalon 1, où l'étape zéro vérifiait le pari économique avant toute construction.

### 4.1 Test 0a, trois agents tiennent-ils sur l'abonnement

**Question.** Trois sessions Claude Code simultanées sur la machine de Liam
fonctionnent-elles, et à quelle vitesse consomment-elles la limite d'abonnement.

**Méthode.** Lancer trois sessions sur trois projets distincts, avec une tâche de lecture
non triviale. Relever, pour chacune, les messages `rate_limit_event` reçus, notamment
`utilization` avant et après, et `rateLimitType`.

**Ce qui fait échouer le test.** Le CLI refuse la deuxième ou la troisième instance, ou
les sessions se corrompent mutuellement, ou la limite est consommée si vite que trois
agents deviennent inutilisables en pratique.

**Si le test échoue**, le jalon est reconçu, pas contourné. Une limite qui tombe au bout
de dix minutes avec trois agents rendrait tout le reste inutile.

### 4.2 Test 0b, le vocabulaire tient-il face à Codex

**Question.** Les douze événements suffisent-ils à décrire une vraie session Codex.

**Méthode.** Enregistrer une session réelle avec `codex exec --json` sur une tâche
comparable à celle du jalon 1 (lire un fichier, lancer une commande, écrire un fichier),
conserver le JSONL comme fixture dans `fixtures/`, et produire un tableau de
correspondance ligne par ligne vers les douze événements.

**Livrable.** Un document dans `docs/verifications/` contenant le tableau et un verdict
écrit : le vocabulaire suffit, ou bien il manque tel événement pour telle raison. Aucun
traducteur n'est écrit, aucun lanceur non plus.

**Si le vocabulaire craque**, la correction se décide à ce moment, avant que la reprise,
la jauge et les tuiles ne soient construites par dessus.

---

## 5. Le vocabulaire, ce qui change

Le contrat passe de onze à douze événements. Le douzième :

| Événement | Charge | Sens |
|---|---|---|
| `agent.awaits` | sessionId | l'agent a fini de parler et attend une réponse |

**Ce qui change dans le sens des événements existants.** Au jalon 1, le message `result`
du SDK était traduit en `session.ended`, et le code tuait la session à ce moment
(`session.ts:90`). Dans une conversation, `result` signifie la fin d'un tour, pas la fin
de la conversation. La traduction devient donc :

| Situation | Avant, jalon 1 | Après, jalon 2 |
|---|---|---|
| Le SDK rend un `result` | `session.ended` | `agent.awaits` |
| Liam ferme la conversation | impossible | `session.ended` |
| Une erreur fatale tue la session | `agent.error` puis rien | `agent.error` puis `session.ended` |

`session.ended` garde donc son sens intuitif, la conversation est close. Les tests et les
fixtures du traducteur écrits au jalon 1 doivent être repris en conséquence, c'est une
tâche à part entière et non un effet de bord.

**Note sur le coût.** `total_cost_usd` est cumulatif par appel et chaque `result` porte
le total courant, d'après `sdk.d.ts`. Avec plusieurs tours, la valeur à afficher est
celle du dernier `result` reçu, jamais une somme des précédents.

---

## 6. Architecture

### 6.1 Le carnet de conversations

Un nouveau module `packages/engine/src/sessions.ts` tient le carnet. Il ne connaît ni le
réseau ni le rendu, il ne fait que créer, retrouver, lister et fermer des conversations.

```
SessionRegistry
  create(projectId, task) -> Conversation
  get(id) -> Conversation | null
  list() -> ApercuConversation[]
  say(id, texte) -> boolean
  interrupt(id) -> Promise<void>
  close(id) -> Promise<void>
  resume(id) -> Promise<Conversation>
  closeAll() -> Promise<void>
```

`closeAll()` existe parce que le bouton d'arrêt du moteur doit tuer toutes les sessions,
et non laisser N programmes `claude` orphelins. Le risque de processus orphelin, déjà
signalé dans la spec d'origine, est multiplié par le nombre d'agents.

### 6.2 Les quatre états d'une conversation

| État | Ce que ça veut dire | Ce que Liam peut faire |
|---|---|---|
| `travaille` | l'agent agit en ce moment | lui écrire pour le rediriger, l'interrompre |
| `attend` | l'agent a fini son tour | lui écrire, la fermer |
| `sommeil` | connue du carnet, pas chargée en mémoire | la réveiller |
| `fermee` | terminée, conservée dans l'historique | rien, elle reste consultable |

Une conversation passe en `sommeil` au redémarrage du moteur. Elle n'est **jamais**
réveillée automatiquement, parce que réveiller cinq conversations au démarrage
consommerait l'abonnement sans que Liam l'ait demandé.

### 6.3 Ce qui change dans `session.ts`

Trois modifications, chacune une tâche.

1. **Le flux d'entrée devient une file.** Aujourd'hui `entree()` envoie la tâche puis
   attend l'abandon (`session.ts:57-68`). Il doit désormais attendre le prochain message
   poussé par Liam et le rendre, indéfiniment, jusqu'à fermeture.
2. **La fin d'un tour ne tue plus la session.** La ligne qui appelle `abort()` sur
   `session.ended` disparaît au profit de l'émission de `agent.awaits`.
3. **L'identifiant de conversation du CLI est capté et conservé.** Aujourd'hui le moteur
   génère son propre identifiant et ne passe pas `sessionId` à `query()`, donc le CLI en
   choisit un autre de son côté. Sans cet identifiant, aucune reprise n'est possible.

### 6.4 La reprise

Fait vérifié dans `sdk.d.ts:1971-1974` : l'option `resume` accepte un identifiant de
session et recharge l'historique de la conversation. C'est le CLI `claude` qui conserve
les transcriptions sur disque, codecity n'a donc pas à les stocker.

Le carnet persisté ne contient que ce qu'il faut pour retrouver une conversation, jamais
son contenu.

---

## 7. Modèle de données

Fichier `carnet.json`, dans le dossier `.codecity` du profil utilisateur, écrit par le
magasin atomique du jalon 1.

```
{
  "conversations": [
    {
      "id": "conv-3f2a",              identifiant codecity
      "idCli": "uuid du CLI claude",  sert a la reprise
      "projectId": "codecity",
      "titre": "Corriger le panneau de diff",
      "etat": "sommeil",
      "demarreeA": 1758182400000,
      "dernierCoutUsd": 0.2309
    }
  ]
}
```

Le `titre` est les premiers mots de la tâche d'origine, pour que Liam reconnaisse ses
conversations au redémarrage. Aucun contenu de conversation n'est copié ici.

---

## 8. Le protocole

Le protocole change de façon incompatible avec celui du jalon 1. Ce n'est pas un
problème : rien n'est déployé ailleurs que sur la machine de Liam, et le moteur comme
l'interface sont construits ensemble.

### 8.1 Du navigateur vers le moteur

| Message | Nouveau ou modifié | Rôle |
|---|---|---|
| `projects.list` | inchangé | la liste des projets |
| `session.start { projectId, task }` | inchangé | ouvrir une conversation |
| `session.say { sessionId, text }` | nouveau | parler à un agent, qu'il travaille ou qu'il attende |
| `session.interrupt { sessionId }` | modifié | couper le travail en cours, la conversation reste ouverte |
| `session.close { sessionId }` | nouveau | fermer définitivement une conversation |
| `session.resume { sessionId }` | nouveau | réveiller une conversation en sommeil |
| `permission.answer { sessionId, requestId, decision, reason? }` | modifié | répondre au guichet d'un agent précis |
| `diff.request { sessionId }` | modifié | les fichiers modifiés du projet de cette conversation |
| `engine.stop` | inchangé | arrêter le moteur, donc toutes les conversations |

### 8.2 Du moteur vers le navigateur

| Message | Nouveau ou modifié | Rôle |
|---|---|---|
| `projects` | inchangé | la liste des projets |
| `sessions { sessions: ApercuConversation[] }` | nouveau | l'état complet du carnet, envoyé à la connexion et à chaque changement |
| `event { event }` | inchangé | un événement, il porte déjà son `sessionId` |
| `diff { sessionId, changes }` | modifié | chaque fichier porte les agents qui l'ont écrit |
| `quota { ... }` | nouveau | l'état de la limite d'abonnement |
| `error { message, sessionId? }` | modifié | une erreur, rattachée à une conversation quand c'est pertinent |

**Diffusion.** Le serveur envoie à tous les navigateurs connectés, pas seulement à
l'émetteur. Deux onglets ouverts doivent montrer la même chose.

**Validation.** `parseClientMessage` valide les nouveaux messages avec la même règle
qu'au jalon 1 : tout ce qui vient du navigateur est suspect, la forme est vérifiée une
fois, et un message inconnu est rejeté. La vérification d'origine du WebSocket et de la
route d'arrêt, ajoutée au jalon 1 après une revue de sécurité, reste en place sans
changement.

---

## 9. La jauge d'abonnement

Un nouveau module `packages/engine/src/quota.ts`.

Fait vérifié dans `sdk.d.ts:5296-5331` : chaque session reçoit des messages
`rate_limit_event` portant `status` (`allowed`, `allowed_warning`, `rejected`),
`utilization` en pourcentage, `resetsAt` en horodatage, et `rateLimitType`.

**Règle.** La limite appartient au compte, pas à une conversation. Le module conserve
donc le dernier message reçu, toutes conversations confondues, et le diffuse à tous les
navigateurs. Le traducteur cesse de jeter ces messages.

**Traduction des types de limite en français.**

| Valeur du SDK | Affichage |
|---|---|
| `five_hour` | limite des cinq dernières heures |
| `seven_day` | limite de la semaine |
| `seven_day_sonnet` | limite Sonnet de la semaine |
| `seven_day_opus` | limite Opus de la semaine |
| `seven_day_overage_included`, `overage`, absent | hors abonnement |

**Affichage.** Pourcentage, libellé de la limite, heure locale de réinitialisation. Trois
niveaux visuels selon `status`. Aucun blocage n'est jamais opposé à Liam.

---

## 10. L'attribution des fichiers modifiés

**Le problème.** Le panneau du jalon 1 lit l'état du dépôt entier et ne sait pas qui a
fait quoi. Avec deux agents sur un projet, il devient trompeur.

**La solution.** Chaque conversation tient la liste des chemins qu'elle a écrits, déduite
de ses propres événements `agent.writes`, qui portent déjà le chemin du fichier. Le
moteur n'a donc rien à observer de neuf, il conserve ce qu'il émet déjà.

**Ce que le panneau affiche.** Chaque fichier modifié porte le nom des agents qui l'ont
écrit. Un fichier écrit par deux agents distincts est signalé comme un conflit, de façon
visible. Un fichier modifié sans qu'aucun agent ne l'ait écrit est attribué à Liam,
puisque c'est lui qui édite à la main.

**Ce que la solution ne fait pas.** Elle ne prévient pas l'écrasement, elle le rend
visible après coup. Empêcher réellement deux agents d'écrire le même fichier demanderait
des copies de dépôt isolées, explicitement hors périmètre.

---

## 11. L'interface

Toujours laide et vraie, la mise en scène est au jalon 3. Quatre zones.

**La jauge**, en haut, toujours visible, quel que soit l'écran affiché.

**Le lancement**, choisir un projet et écrire une tâche, comme au jalon 1.

**La grille de tuiles**, une tuile par conversation, y compris celles en sommeil, en
grisé. Une tuile montre le nom du projet, l'état, les deux ou trois dernières lignes, et
un signal fort quand une permission attend une réponse. Une tuile est le brouillon du
personnage du jalon 3.

**La conversation ouverte**, au clic sur une tuile : le journal complet, le champ de
saisie, les boutons interrompre et fermer, le guichet de permission s'il y en a un, et le
panneau des fichiers modifiés.

**Règle de vocabulaire, inchangée.** Le paquet `engine` ne contient aucun mot de
vocabulaire graphique. Le mot tuile n'existe que dans `ui`.

---

## 12. Corrections apportées à la spec d'origine

| Point | Spec du 2026-09-17 | Correction du 2026-09-18 | Raison |
|---|---|---|---|
| Plafond de dépense | « compteur visible et plafond de dépense par session, réglable » | jauge d'abonnement sans plafond en dollars | Sous abonnement, le coût en dollars ne correspond à aucune facture. La vraie limite est celle du compte, et le SDK la donne. |
| Périmètre du jalon 2 | « la pièce, plusieurs agents, les quêtes » en un jalon | trois jalons distincts | Trois chantiers indépendants, environ trente tâches chacun mis ensemble |
| Nombre d'événements | onze | douze | Une conversation qui attend n'est pas une conversation finie |

---

## 13. Critères d'acceptation

Quinze critères, vérifiables un par un. La règle du jalon 1 s'applique sans changement :
**un critère n'est dit satisfait qu'après exécution constatée**, capture d'écran ou
sortie de commande à l'appui. Rien n'est déduit du code écrit.

| Nº | Critère |
|---|---|
| 1 | Trois conversations tournent en même temps, chacune avec sa tuile et son état juste |
| 2 | Deux conversations sur le même projet travaillent en même temps, chacune recevant ses propres événements, sans que l une attende l autre |
| 3 | Un second message à un agent qui attend relance le travail dans la même conversation, et l'agent se souvient du contexte précédent |
| 4 | Un message envoyé pendant que l'agent travaille le redirige sans fermer la conversation |
| 5 | Une demande de permission d'un agent n'empêche ni les autres de travailler ni Liam de les piloter |
| 6 | Interrompre une conversation laisse les autres intactes |
| 7 | Fermer une conversation la retire des conversations actives, les autres continuent |
| 8 | La jauge affiche un pourcentage réel, le libellé de la limite en cours et l'heure de réinitialisation |
| 9 | Le journal d'un agent qui a fini son tour affiche qu'il attend une réponse, et non qu'il a fini |
| 10 | Après arrêt et relance du moteur, les conversations de la veille apparaissent en sommeil avec leur titre |
| 11 | Une conversation réveillée se souvient de ce qui a été dit avant le redémarrage |
| 12 | Le panneau des fichiers modifiés dit quel agent a écrit quel fichier |
| 13 | Un fichier écrit par deux agents est signalé visiblement comme un conflit |
| 14 | Le bouton d'arrêt du moteur ferme toutes les conversations, aucun programme `claude` ne survit |
| 15 | Le rapport du test 0b existe et conclut par un verdict écrit sur le vocabulaire face à Codex |

Le critère 8 ne peut pas être forcé jusqu au niveau d alerte : atteindre le seuil
d'avertissement dépend de la consommation réelle. L'alerte visuelle est donc vérifiée par
un test automatique sur le module, et la jauge elle-même est constatée à l'écran avec sa
valeur réelle du moment.

---

## 14. Risques

| Risque | Gravité | Réponse |
|---|---|---|
| Trois agents épuisent la limite trois fois plus vite | élevé, c'est le risque du jalon | mesuré en test 0a avant toute construction, puis rendu visible en permanence par la jauge |
| Deux agents s'écrasent sur un même projet | moyen, perte de travail réelle | signalé visiblement, non empêché, choix assumé par Liam |
| La reprise échoue si le CLI a purgé son historique | moyen, frustrant | message clair plutôt qu'un échec muet, la conversation reste consultable mais non réveillable |
| Le traducteur change de sémantique et casse les tests du jalon 1 | certain, pas un risque mais un coût | tâche dédiée, fixtures rejouées |
| Programmes `claude` orphelins multipliés par le nombre d'agents | moyen, agaçant | `closeAll()` sur l'arrêt du moteur, et critère d'acceptation 14 |
| Le jalon est trop gros et s'enlise | moyen | le plan sépare une première vague constatable (conversations multiples et dialogue) d'une seconde (reprise, jauge, attribution) |

---

## 15. Vérification

Les deux filets du jalon 1 s'appliquent sans changement.

**Filet automatique.** Les modules purs, traducteur, carnet, jauge, attribution, sont
testés avec Vitest. La suite rapide reste gratuite et sans appel réseau. Les tests qui
consomment l'abonnement restent isolés dans la configuration `smoke`.

**Filet visuel.** Les quinze critères visibles sont constatés en pilotant Chrome, avec
capture d'écran. Leçon du jalon 1, consignée : piloter une interface React demande les
outils natifs de clic et de frappe, les événements JavaScript simulés ne sont pas vus par
React.

---

## 16. Dette repérée, à traiter dans ce jalon

Le `README.md` annonce encore « Aucun code écrit pour l'instant » alors que le jalon 1
est livré et constaté. Une tâche de mise à jour, sans rapport avec le reste.
