# codecity

Piloter Claude Code, Codex et d'autres agents CLI depuis une interface visuelle, ou
chaque agent est un personnage et chaque tache restante une quete.

## Etat du projet

Conception validee le 2026-09-17. Aucun code ecrit pour l'instant.

La conception complete, qui fait foi, est dans
[docs/superpowers/specs/2026-09-17-codecity-design.md](docs/superpowers/specs/2026-09-17-codecity-design.md).

## Idee en trois lignes

Un moteur tourne en fond sur la machine, lance les agents sur les projets et traduit ce
qu'ils font en un vocabulaire unique. Une interface web met ce vocabulaire en scene. Une
extension VS Code affiche cette interface dans un panneau, et la meme page s'ouvre aussi
dans un navigateur.

## Outils requis

| Outil | Version constatee le 2026-09-17 |
|---|---|
| Node | 24.16.0 |
| npm | 11.13.0 |
| git | 2.54.0 |
| CLI `claude` | 2.1.273 |
| CLI `codex` | installe |

## Ou vivent les donnees

Dans le dossier `.codecity` du profil utilisateur, jamais dans ce depot ni dans les
depots des projets pilotes. Rien de l'etat local ne peut donc partir dans un commit.
