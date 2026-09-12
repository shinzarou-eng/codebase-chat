# Contributing

Thanks for considering contributing to `dsh-codebase-chat`.

## Before you start

- Open an issue first for large features or refactors.
- Keep changes focused on one topic per PR.


## Setup

```bash
git clone https://github.com/shinzarou-eng/dsh-codebase-chat.git
cd dsh-codebase-chat
pnpm install
```

## Checks

Run before every commit:

```bash
node --check lib/index.js
node --check mcp/index.mjs
node --check lib/client.js
node --check lib/cache.js
```

## Commit message format

```
<prefix>: short description
```

Prefixes: `feat`, `fix`, `tweak`, `style`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`, `revert`, `hotfix`, `init`, `merge`, `wip`, `release`.

## Submitting a PR

1. Branch from `main`.
2. Make your changes.
3. Run the syntax checks.
4. Push and open a PR to `main`.
