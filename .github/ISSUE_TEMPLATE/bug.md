---
name: Bug report
about: Décrire un comportement cassé avec assez de contexte pour le reproduire et le corriger
title: "fix: "
labels: bug
assignees: ""
---

<!-- Supprime les aides entre commentaires avant de publier. -->

## Contexte

<!-- Qui est touché, dans quelle partie de l'app, et quel est l'impact réel ? Ajoute les issues ou changements liés. -->

## Reproduction

<!-- Donne un chemin reproductible, les données d'entrée et l'environnement si cela change le résultat. -->

1.
2.
3.

## Comportement attendu

<!-- Décris le comportement correct, pas seulement l'absence de l'erreur. -->

## Prior art dans le repo

<!-- Cite le code, les tests et les conventions concernés. Indique les changements récents ou la régression suspectée si tu les connais. -->

## Traps worth naming up front

<!-- Note les cas limites, données legacy, permissions, concurrence, erreurs externes, limites et fallbacks à préserver. -->

## Acceptance criteria

- [ ] La reproduction décrite ne se produit plus.
- [ ] Le comportement attendu reste vrai pour le cas nominal et les cas limites pertinents.
- [ ] Un test automatisé protège la régression, ou l'absence de test est justifiée.

## Out of scope

<!-- Délimite les améliorations voisines qui ne font pas partie de la correction. -->
