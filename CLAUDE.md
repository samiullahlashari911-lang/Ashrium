@AGENTS.md

## Claude Code: how to work here

Follow the `decide-and-ship` skill on every build, fix or change request: size the task, decide without hedging, verify before saying done.

Skills to reach for (they load on demand; don't load ones the task doesn't need):

| Work | Skill |
|---|---|
| Bug, failing test, wrong drape/fit output | `systematic-debugging` |
| New feature or large change (see decide-and-ship sizing) | `brainstorming` → `writing-plans` → `executing-plans` |
| Before claiming done / committing | `verification-before-completion` |
| Three.js viewport, mirror view, shaders, textures, WebGL perf | `threejs-*` (fundamentals, shaders, textures, performance, …) |
| Next.js / React pages and components | `react-best-practices` |
| Supabase queries, RLS, migrations, auth | `supabase`, `supabase-postgres-best-practices` |
| Slow or expensive production routes | `vercel-optimize` |
| UI design or polish | `impeccable` |
