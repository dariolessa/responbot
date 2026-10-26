# Responbot

Asistente de WhatsApp con agenda para negocios que dan turnos. La especificación está en [docs/SPEC.md](docs/SPEC.md) y las convenciones del repo en [CLAUDE.md](CLAUDE.md).

## Empezar en local

```bash
pnpm install
cp .env.example .env.local   # completá las variables obligatorias
pnpm db:migrate              # crea las tablas en DATABASE_URL
pnpm dev
```

`DATABASE_URL` puede ser una rama de Neon o un Postgres local (`postgres://…@localhost:5432/…`).

## Comandos

`pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.
