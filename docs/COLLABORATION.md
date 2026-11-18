# Developing DuoQ Lab together

## What the repository contains

This repository now includes both the GitHub Pages dashboard and the complete shared-library backend. A collaborator can clone, inspect, edit, build and run both applications without access to the original developer's computer.

The `backend/` directory includes the running API's routes and validation, database schema and SQL migrations, framework and Worker entrypoints, package lockfile, local development tools and independent Cloudflare deployment commands. Its [README](../backend/README.md) is the starting point.

## Permissions are separate

| Access | What it grants | How to obtain it |
| --- | --- | --- |
| GitHub collaborator | Read/write source, branches, pull requests and repository collaboration | Repository owner invites the GitHub user; user accepts |
| GitHub Pages workflow | Publication of the frontend when reviewed changes reach `main` | Existing repository workflow and GitHub permissions |
| Sites editor | Edit and publish later versions of the existing API | Site owner grants supported editor access within the same workspace |
| External Sites visitor | Open/use a shared Site | Visitor invitation; this is not editor access |
| Own Cloudflare hosting | Manage a separate Worker and D1 database | Appropriate permissions in your team's Cloudflare account |

The public API is already usable by visitors. That fact, and the public project ID in `.openai/hosting.json`, do not grant control of the running service or its database. GitHub collaborator access does not reveal your ChatGPT account, local files or private browser-only imports.

## First clone

```sh
git clone https://github.com/thePl4yer/duoq-lab.git
cd duoq-lab
npm install --ignore-scripts
npm test
npm run build
npm run dev
```

In another terminal:

```sh
cd duoq-lab/backend
npm ci --ignore-scripts --include=dev --include=optional
npm run db:migrate:local
npm run dev
```

Use Node.js 24. The frontend and backend have separate dependency files and development servers. The backend uses an independent local D1 database, so local work does not modify the running library.

For local end-to-end work, point a local copy of `src/shared-library.js` at the printed backend URL followed by `/api/replays`. Keep a reviewed production endpoint in the version merged to `main`.

## Review and publish

1. Create a branch for each change and open a pull request.
2. Run the frontend tests/build and, for backend changes, `npm run typecheck`, `npm run db:migrate:local` and `npm run build` from `backend/`.
3. Review data definitions and any SQL migration as part of the change.
4. Merge the reviewed frontend changes to `main` to publish them on GitHub Pages.
5. Publish backend changes separately, following [DEPLOYMENT.md](../backend/DEPLOYMENT.md). The backend GitHub workflow checks source and build; it does not publish the existing Sites service.

Never commit authentication tokens, `.env`/`.dev.vars` files, local databases, replay files, exports or checkout-local runtime state. Relevant ignore rules are included. Use personal accounts and the hosting platform's collaboration controls to grant access.

## Choose a hosting arrangement

To maintain the existing service together, use the supported Sites editor controls if both maintainers belong to the same workspace. To manage hosting outside that workspace, deploy the included backend to a team-controlled Cloudflare account, transfer the public summaries, and switch the frontend endpoint after verification. Both paths are documented; adding source files alone does not perform either permission change or migration.
