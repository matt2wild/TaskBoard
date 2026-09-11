# TaskBoard → Homestead

This repository started as a React kanban prototype (TaskBoard). It is the seed of **Homestead**, a self-hosted home management web app that integrates maintenance, renovation project planning, budgeting, food and pantry management, general storage, tools, and cat health.

## Documents

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — full product requirements document (vision, modules, integration matrix, data model, API, non-functional requirements, self-hosting, delivery plan, test strategy).

## Prototype (current code)

The existing `src/` is a Create React App prototype of the task board module. It runs with:

```
npm install
npm start
```

The requirements document recommends rebuilding on a modern stack (Vite, React 18, Fastify, Drizzle, SQLite) while reusing the board concepts and demo data shapes. See section 26 of the requirements.
