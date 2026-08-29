# 0004: Vue 3 for the PWA

Status: accepted, 2026-08-28.

## Context

The remote is a PWA built largely by coding agents under strict rules. Criteria: light runtime, low agent error rate, first-class fit with the VoidZero toolchain. Candidates: Vue 3, Solid, Svelte 5, Lit, Preact/React.

## Decision

Vue 3, Composition API only, `<script setup lang="ts">`.

Rationale: the Composition API has been stable since 2020 and is heavily represented in training data, so agents rarely get it wrong. Vue is the most first-class citizen in the VoidZero stack (Vite, Vitest, Oxlint Vue plugin, Oxfmt SFC formatting). Runtime is ~35 KB, acceptable.

Solid was the runner-up (smallest runtime, excellent reactivity) but agents import React habits (destructuring props, untracked reads) and Oxlint has no Solid plugin to catch them. Svelte 5 rejected because agents mix Svelte 4 and 5 syntax. Lit rejected for shadow DOM and decorator friction and having to hand-roll routing and state. React rejected as heaviest with no offsetting benefit here.

## Consequences

- Vue-specific rules live in `engineering.md`.
- No Pinia, no vue-router at P1; composables and a hand-rolled route switch. Revisit with an ADR.
