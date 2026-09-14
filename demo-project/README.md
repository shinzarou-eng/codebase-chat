# demo-petstore

A small Express API used to demonstrate `codebase-chat`.

It intentionally contains a few issues so audits have something to find:

- a hardcoded API key in `src/config.ts`
- a `TODO` and a `console.log` in `src/auth.ts`
- loose `any` typing in `src/pets.ts`

Try:

```bash
npx codebase-chat --project demo-project --stats
npx codebase-chat --project demo-project --search "jwt token"
npx codebase-chat --project demo-project --file src/auth.ts
npx codebase-chat --project demo-project --ask "is there a hardcoded secret?" --lang en
```
