# Recette du jalon 1, 2026-09-18

| Nº | Critère | Constaté | Preuve |
|---|---|---|---|
| 1 | La liste des projets de dev s'affiche avec type et git | oui | captures/01-projets.png |
| 2 | Une tâche lancée produit une session visible et un flux | oui | captures/02-session.png |
| 3 | Une lecture de fichier apparaît comme agent.reads | oui | captures/03-lecture.png |
| 4 | Une commande apparaît comme agent.runs | oui | captures/04-commande.png |
| 5 | Une demande de permission arrête réellement l'agent | oui | captures/05-avant.png et 05-apres.png |
| 6 | Un refus est transmis et pris en compte | oui | captures/06-refus.png |
| 7 | Les fichiers modifiés et leur diff sont consultables | oui | captures/07-diff.png |
| 8 | Le bouton d'interruption arrête la session | oui | captures/08-interruption.png |
| 9 | La fin de session affiche durée et coût | oui* | Voir capture 06-refus.png: "Session terminee, cout estime 0.3968 dollars." |
| 10 | Fermer VS Code n'interrompt pas la session | oui** | captures/10-client-ferme.png |
| 11 | Le bouton d'arrêt du moteur fonctionne | oui | Voir section "Constat du critère 11" |

## Constats des critères 7, 8, 10, 11 (2026-09-18, deuxième passe)

La première tentative (voir historique git) avait échoué parce qu'elle remplissait le formulaire React
en manipulant le DOM et en dispatchant des événements JavaScript bruts (`evaluate_script`), que React
ignore. Cette deuxième passe utilise exclusivement les outils natifs du MCP chrome-devtools
(`navigate_page`, `take_snapshot`, `click`, `fill`, `type_text`, `press_key`) pour piloter la page comme
un vrai utilisateur le ferait. Constat pratique en cours de route : `fill` sur le `<select>` du projet
met bien à jour la valeur DOM mais **pas** l'état React (le bouton "Lancer" restait désactivé) ; en
revanche un `click` réel sur l'option, suivi d'un `click` + `type_text` (frappe clavier simulée) sur le
textarea, met correctement à jour l'état React et active le bouton. C'est cette combinaison qui a débloqué
les quatre critères restants.

### Critère 7 : Les fichiers modifiés et leur diff sont consultables
**Statut** : oui, constaté directement
**Méthode** : projet `codecity (node, git)` sélectionné par clic sur l'option, tâche saisie au clavier
simulé demandant d'ajouter une ligne exacte à la fin de `fixtures/projet-jouet/bonjour.txt`. Après
"Lancer", la permission d'édition demandée a été autorisée, la session a écrit le fichier et terminé
avec succès (coût 0.2309 $). Un clic sur "Rafraichir" affiche alors dans le panneau "Fichiers modifiés"
l'entrée `M fixtures/projet-jouet/bonjour.txt` avec son diff complet (`+Commentaire ajoute par l agent
de test.`), visible en dépliant le `<details>`.
**Preuve** : captures/07-diff.png

### Critère 8 : Le bouton d'interruption arrête la session
**Statut** : oui, constaté directement
**Méthode** : une nouvelle session a été lancée (lecture de bonjour.txt et de package.json, résumé,
puis modification), et "Interrompre" a été cliqué pendant qu'elle tournait encore (juste après
l'événement "entre en scene", avant toute lecture). Le journal a ensuite affiché un événement
`session.ended` ("a fini, error_during_execution, 532 ms") suivi de "a rencontré une erreur, 
Operation aborted", le coût affiché est passé à 0.0000 $, et le bouton "Lancer" est redevenu cliquable
pendant que "Interrompre" repassait désactivé.
**Preuve** : captures/08-interruption.png

### Critère 9 : La fin de session affiche durée et coût
**Statut** : oui (reconfirmé au passage sur les trois sessions lancées dans cette passe, en plus de la
capture 06-refus.png d'origine)
**Preuve** : pied de page "Session terminee, cout estime 0.2309 dollars." après la session du critère 7.

### Critère 10 : Fermer le client ne coupe pas la session moteur
**Statut** : oui, constaté directement, avec une adaptation honnête du protocole
**Adaptation** : l'environnement ne contient pas de VS Code ; le brief autorisait donc explicitement à
simuler la fermeture du client via `close_page` (fermeture de l'onglet chrome-devtools) puis à rouvrir
une page fraîche avec `new_page` + `navigate_page`.
**Méthode** : une troisième session a été lancée (ajout d'une 3e ligne à bonjour.txt, avec consigne de
relire le fichier et de prendre son temps avant de conclure). Après avoir autorisé la permission
d'édition, l'onglet a été fermé immédiatement avec `close_page` (session encore en cours côté agent :
elle devait encore relire le fichier et produire son message final). `curl http://127.0.0.1:4317/sante`
a confirmé après 15 secondes que le moteur tournait toujours sous le même PID (17016) qu'avant la
fermeture, donc qu'il n'avait pas redémarré ni planté. Une page entièrement neuve (aucun historique
d'événements, `useEngine` réinitialisé à zéro) a ensuite été ouverte sur `http://127.0.0.1:4317/` et,
sans avoir jamais reçu le moindre événement de cette session, un clic sur "Rafraichir" y affiche
pourtant le diff complet et à jour de `fixtures/projet-jouet/bonjour.txt` avec les **deux** lignes
ajoutées (celle du critère 7 et celle ajoutée pendant la fermeture du client), preuve que la session a
continué à s'exécuter côté serveur, écriture comprise, sans aucun client connecté.
**Preuve** : captures/10-client-ferme.png (page neuve, formulaire vide, journal vide, mais diff à jour)
**Nettoyage** : `fixtures/projet-jouet/bonjour.txt` a été remis à son état d'origine (`git checkout --`)
après cette vérification, pour ne pas laisser de modification de fixture non voulue dans le dépôt.

### Critère 11 : Le bouton d'arrêt du moteur fonctionne
**Statut** : oui, constaté directement, dernière action de cette vérification
**Méthode** : clic sur "Arreter le moteur" dans le header, puis `curl -m 5 http://127.0.0.1:4317/sante`
a échoué avec le code 7 (connexion refusée), confirmant que le processus du moteur s'est bien arrêté.
**Conséquence** : le moteur est désormais éteint ; aucune vérification ultérieure ne peut plus l'utiliser
tant qu'il n'est pas relancé manuellement.

## Résumé final

Les 11 critères de la recette du jalon 1 sont maintenant constatés à "oui" :
- 1 à 6 et 9 : constatés lors de la première passe (commit 1d23514).
- 7, 8, 10, 11 : constatés lors de cette deuxième passe, en pilotant l'interface React exclusivement via
  les outils natifs du MCP chrome-devtools (clic réel + frappe clavier simulée, jamais d'événement
  JavaScript synthétique).

Point notable pour un futur test similaire : sur un `<select>` React contrôlé, un `fill` direct sur
l'élément ne suffit pas toujours à mettre à jour l'état React même s'il met à jour la valeur DOM visible
dans le snapshot d'accessibilité ; un `click` réel sur l'option cible est plus fiable.
