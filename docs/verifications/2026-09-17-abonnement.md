# Vérification de l'étape zéro, 2026-09-17

**Question.** Une session lancée hors mode `--bare` consomme-t-elle l'abonnement Claude
Code de Liam, et non une clé API facturée ?

**Méthode.** Session réelle enregistrée dans `fixtures/claude-lecture-commande.jsonl`,
recherche des marqueurs d'échec d'authentification et de facturation.

Commande lancée depuis `fixtures/projet-jouet` (sans `--bare`, sans `ANTHROPIC_API_KEY`
dans l'environnement, vérifié par `env | grep -i anthropic` avant lancement, aucune
correspondance) :

```
claude -p "Lis bonjour.txt puis lance la commande echo termine. Ne modifie aucun fichier." \
  --output-format stream-json --verbose \
  --allowedTools "Read,Bash(echo *)" \
  > ../claude-lecture-commande.jsonl
```

**Résultat.** Constaté :

- Le flux enregistré contient **26 lignes** JSON (`grep -c .`), au-dessus de la dizaine
  attendue.
- Répartition des sous-types (`grep -o '"subtype":"[a-z_]*"' | sort | uniq -c`) :
  `hook_progress` (1), `hook_response` (4), `hook_started` (4), `init` (1), `success` (1),
  `thinking_tokens` (5). Un `"subtype":"success"` est bien présent en fin de flux, avec
  `"api_error_status":null`.
- La recherche des marqueurs d'échec (`grep -iE "authentication_failed|billing_error|credit
  balance|ANTHROPIC_API_KEY"`) ne retourne **aucune correspondance** (code de sortie 1,
  vérifié séparément de tout pipe).
- Les deux outils attendus apparaissent dans le flux (`grep -o '"name":"[A-Za-z]*"' | sort
  | uniq -c`) : `"name":"Read"` (1) et `"name":"Bash"` (1), confirmant que la commande a
  bien exercé les deux briques dont la tâche 4 a besoin.
- Un coût est rapporté par le CLI : `"total_cost_usd":0.226588`. C'est une estimation
  informative que Claude Code calcule systématiquement, y compris sous abonnement ; ce
  chiffre ne signifie pas une facturation API réelle, il est cohérent avec l'absence de
  tout marqueur d'échec de facturation ou d'authentification ci-dessus.
- La réponse finale du modèle confirme le déroulé attendu : lecture de `bonjour.txt`,
  exécution de `echo termine`, aucun fichier modifié.

**Conclusion.** Le projet garde sa forme actuelle : la session a tourné sous l'abonnement
Claude Code de Liam, sans mode `--bare` et sans clé API dans l'environnement, et aucun
marqueur de facturation ou d'échec d'authentification n'apparaît dans le flux enregistré.
Le pari économique du projet tient. Le fichier `fixtures/claude-lecture-commande.jsonl`
est conservé comme fixture réelle pour la tâche 4 (traducteur Claude).
