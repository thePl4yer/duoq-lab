# Backend deployment and ownership

## Current production service

- Dashboard: https://thepl4yer.github.io/duoq-lab/
- Shared API: https://duoq-lab-library-tk.fairy-cat-9312.chatgpt.site/api/replays
- Sites project identity: see `.openai/hosting.json`.

The frontend deploys through GitHub Actions. The existing API deploys through Sites and uses a platform-managed D1 database. A GitHub push does not update that running API. Repository access does not grant Site editor access, database administration or a Cloudflare account membership.

The current API accepts public replay-statistics submissions, not original replay files. Making the service public lets visitors use it; it does not give them source or deployment permissions.

## Update the existing Sites service

An authorised editor can use the Sites plugin in ChatGPT or Codex. Sites collaboration currently requires an active member of the same workspace. An external visitor invitation provides viewing access rather than editor access.

1. Grant the collaborator **Can edit** on the existing Site when that option is available. Confirm the person is in the same workspace and has accepted any required membership invitation.
2. Open the existing Site with its current project identity and source repository, using the Sites plugin's source workflow. Preserve its audience, D1 binding and project ID.
3. Copy the reviewed contents of this `backend/` directory into that Site source checkout. Keep the authorised Site checkout's identity and local runtime state. The GitHub repository root contains the frontend, so it is not itself the backend source root.
4. Build the backend, save the exact pushed source version with its build archive, then deploy that saved version through Sites. The source helper handles authentication and packaging; do not place its short-lived credentials in GitHub.
5. Verify `GET /api/replays` and a normal dashboard load. Commit corresponding source changes here so the two source repositories stay in sync.

The required runtime binding is `DB` (D1). No R2 bucket or custom runtime secret is required by the current API. Sites applies the included Drizzle migration during deployment. Use the supported Sites workflow to preserve the existing database; do not create a replacement Site for a routine update.

## Deploy independently to Cloudflare

This path gives your team control over its own Worker and D1 database without a ChatGPT hosting dependency. It creates a separate service and database; it does not grant access to or move the existing Sites database automatically.

Use an account in which the intended maintainers have appropriate Cloudflare permissions. From `backend/`:

```sh
npm ci --ignore-scripts --include=dev --include=optional
npm run typecheck
npm run build
npx wrangler login
npx wrangler d1 create duoq-library
```

Copy the database UUID returned by Cloudflare. Configure the build for that database:

```sh
npm run cloudflare:prepare -- --database-id YOUR-D1-UUID --database-name duoq-library --worker-name duoq-library
npm run db:migrate:remote
npm run deploy:cloudflare
```

The preparation command writes an ignored `.cloudflare/wrangler.json` from the actual build output. It preserves the generated Worker module and static-asset configuration, replaces the local placeholder D1 binding with your database, and points migrations at `drizzle/`. It does not create resources, apply migrations or deploy anything by itself. Re-run it after rebuilding or changing your deployment target.

Wrangler authenticates with your own Cloudflare account. For CI, use your team's appropriately scoped credentials stored in the CI provider's secret store. The repository intentionally contains no production token, account credential or database contents.

## Transfer public replay statistics

Export all summaries exposed by the existing public API:

```sh
node scripts/library-transfer.mjs export --file backups/library.json
```

The output file is ignored by Git. Existing output files are not overwritten. This exports the public summary records; it is not a full SQL/database-administration backup and does not include private browser data. The bundled initial dataset remains in `../data/seed.json`.

After creating and migrating your new service, import the exported summaries:

```sh
node scripts/library-transfer.mjs import --file backups/library.json --api https://YOUR-WORKER.workers.dev/api/replays
```

The import uses the target's public POST API and can be resumed: existing match IDs do not create another game. Replay records retain precedence; a full replay can upgrade an earlier live-only record. The server revalidates each summary and sets new import timestamps. The command requires an explicit target URL so it does not write back to production by default.

To include the bundled initial dataset in a new database, the same import command accepts `../data/seed.json` as its input file. Alternatively, keep serving the seed with the frontend as before.

## Connect the dashboard to another API

1. Finish deploying and testing the new backend.
2. If needed, import the exported public summaries into it.
3. Update `LIBRARY_API` in `../src/shared-library.js` to its `/api/replays` URL.
4. Test a replay import, reload and duplicate import against the intended service.
5. Review and merge the frontend change to publish it through GitHub Pages.

Keep the previous endpoint available until the new one has been verified. Local development can point a local copy of the frontend at the printed local backend URL; a loopback address is not a usable public production endpoint.

## References

- [Sites publishing and editor access](https://learn.chatgpt.com/docs/sites/publishing-and-sharing)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
