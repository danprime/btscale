---
title: "0005: Sync through the owner's own small server, with one secret token"
date: 2026-10-27
status: accepted
---

# 0005: Sync through the owner's own small server, with one secret token

## Context

Recorded at bootstrap from existing code. The owner wanted settings and the brew log on both a phone and an iPad, with a secure endpoint: no open read or write access.

## Decision

A separate private project, brewlog-server: one Node file with SQLite, behind HTTPS on the owner's server. The app sends records with the time they were last changed; the newest change wins; deletes are sent as markers. One shared bearer token, typed in once per device. The server only answers the app's own web addresses.

## Alternatives

- A hosted backend (Firebase, Supabase): accounts and a third party for one user's data.
- Per-user accounts on the owner's server: more than a single user needs.

## Consequences

Simple and private. Each person would need their own server and token if others ever wanted to sync. The server keeps every brew and backs up daily.

## Links

- `sync.js`
- https://github.com/danprime/brewlog-server (private)
- PR #41
