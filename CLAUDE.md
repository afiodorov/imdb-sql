# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-only React SPA that queries an IMDb dataset with SQL directly in the browser via DuckDB-WASM. No backend: the dataset is a parquet file served statically from `public/`. Hosted at https://imdb-sql.fiodorov.es/.

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run lint` — ESLint
- `npm run preview` — serve the production build

There is no test suite.

## Deployment

Static hosting on S3 (`s3://imdb-sql`, eu-west-2) behind CloudFront distribution `E2EYWSVOZPFWUP` (aliases `imdb-sql.fiodorov.es`, `www.imdb-sql.com`):

```sh
npm run build
aws s3 sync dist/ s3://imdb-sql/ --exclude "*.parquet" \
  --exclude "version.json" --exclude "default_query_cache.json" --delete
aws cloudfront create-invalidation --distribution-id E2EYWSVOZPFWUP --paths "/*"
```

This deploys **app code only**. The dataset is owned by the Airflow DAG, not local
deploys — so the excludes are load-bearing:
- `--exclude "*.parquet"`: the 100MB+ parquet in `public/` is copied into `dist/` by Vite with a fresh mtime, so without the exclude `s3 sync` re-uploads it every deploy even though it's unchanged.
- `--exclude "version.json" --exclude "default_query_cache.json"`: these are rewritten on S3 by the DAG (`deploy_data.py`) on every dataset refresh, so the repo's copies drift stale. Without the excludes, an app deploy would **revert the live dataset pointer** to whatever's checked in — silently serving old data. (This bit us once on 2026-06-28.) When the dataset itself changes, the DAG handles it; never publish it from a local app deploy.

Python tooling (data pipeline) uses `uv` with deps from `pyproject.toml`. The
pipeline is split into single-responsibility scripts (so the Airflow DAG can retry
one step without redoing the multi-GB download):

- `uv run fetch_tsv.py` — download + unzip the 3 IMDb dumps we use into `~/data/imdb` (skips files already present)
- `uv run build_parquet.py` — join them into the dated parquet (streamed via `sink_parquet`, low RAM) and write `public/version.json` pointing at it
- `uv run upload_parquet.py` — upload that parquet to S3 (skips if the key already exists)
- `uv run generate_cache.py` — re-run the default query against the parquet named in `version.json` → `public/default_query_cache.json`
- `uv run deploy_data.py` — upload `version.json` + `default_query_cache.json` to S3 (no-cache) and invalidate them on CloudFront
- `uv run cleanup_s3.py` — delete superseded dated parquets from S3, keeping the `KEEP` newest (current named in `version.json` + a grace buffer); needs `s3:DeleteObject`
- `uv run imdb_extract.py` — convenience orchestrator = fetch_tsv + build_parquet + upload_parquet in one shot (for manual local runs)

### Automated dataset refresh (no rebuild needed)

A daily Airflow DAG (`dags/imdb_dataset_update.py`) on the Hetzner box
(`root@167.233.115.172`, `AIRFLOW_HOME=/root/airflow`, repo rsync'd to
`/root/imdb-sql`) runs 04:00 UTC daily as granular tasks:
`prepare → fetch_tsv → build_parquet → upload_parquet → generate_cache → publish → cleanup_s3 → cleanup`.
`prepare` wipes stale inputs (fresh data each run); `cleanup_s3` (after a successful
`publish`) deletes superseded parquets from S3; `cleanup` (`all_done`) frees local
disk afterwards. It needs AWS credentials for boto3 on the box (`~/.aws`, region
`eu-west-2`) — IAM user `imdb-sql-box`, with `s3:ListBucket` + `s3:GetObject`/`PutObject`/`DeleteObject`
on `imdb-sql` and `cloudfront:CreateInvalidation` on `E2EYWSVOZPFWUP`. (`ListBucket`
matters: without it `HeadObject` on a missing key returns 403, not 404. `DeleteObject`
is needed by `cleanup_s3`.)

**The box's Airflow uses Postgres**, configured via env in `/root/airflow/airflow.env`
(not the `sqlite` in `airflow.cfg`). The UI/scheduler are the source of truth; any
`airflow` CLI must `set -a; . /root/airflow/airflow.env; set +a` first, or it hits a
stray SQLite DB the service ignores. Code changes don't auto-propagate — re-rsync
`./` to `/root/imdb-sql/` (excluding `public`) and copy the DAG into `/root/airflow/dags/`.

## Architecture

**Data loading path** (`src/App.tsx`): on first paint the app does *not* load the ~large parquet file. If the current query equals `defaultQuery`, it renders pre-computed results from `public/default_query_cache.json`. Only when the user runs a custom query does it fetch the versioned parquet from `public/`, cache the blob in IndexedDB (`src/cache.ts`) for later visits, and register it as a DuckDB file buffer. The DuckDB-WASM instance comes from React context (`src/duckdb/duckdbContext.tsx`).

**Default query duplication**: the default query string exists in two places that must stay in sync — `src/sql.ts` (`defaultQuery`) and `generate_cache.py`. If you change one, change the other and regenerate `public/default_query_cache.json`.

**Stable vs versioned parquet name**: all SQL refers to the stable logical name `imdb.parquet` (`PARQUET_NAME` in `src/sql.ts`), which is what the DuckDB buffer is registered as — so queries saved in localStorage or shared via URL survive dataset updates. The versioned physical file (`PARQUET_FILE` in `src/sql.ts`, e.g. `imdb12-06-2026.parquet`) is used only as the fetch URL and IndexedDB key, which busts client caches when the dataset changes; old IndexedDB entries are cleaned up after a new file is cached. `migrateQuery` rewrites dated filenames in stored/shared queries from pre-stable-name versions. To update the dataset: run `imdb_extract.py`, change `PARQUET_FILE`, run `generate_cache.py`, then deploy (the extract script uploads the new parquet to S3 itself).

**Two query-authoring UIs that share state via localStorage**:
- An Ace SQL editor (`src/editor.tsx`); running with a text selection executes only the selection.
- A visual `react-querybuilder` (fields defined in `src/fields.ts`, SQL generation customized in `src/custom_sql_rule_processor.ts`). The "Build" button only generates the WHERE clause; `cacheQueryParts` in `src/sql.ts` parses the SELECT / ORDER BY / LIMIT out of whatever SQL the user last typed and stores them in localStorage so Build preserves them.

Query state is also mirrored to the URL (`?query=`) and localStorage, so links are shareable and state survives reload.

**Results**: MUI X DataGrid; the `titleId` column renders as a link to IMDb (`src/imdb.tsx`). Default ranking is a Bayesian average: `(numVotes * averageRating + 700000) / (numVotes + 100000)`.

**MCP servers**: `mcp-server.js` and `mcp-server.py` are standalone stdio MCP servers exposing SQL queries over the same parquet file (found by glob in `public/`, queried as `imdb.parquet`); they are independent of the web app.

## Styling

Plain CSS in `src/index.css` (page layout via a CSS grid with named areas on `.App`, plus an IMDb-yellow theme using CSS variables) and `src/styles.css` (react-querybuilder overrides).
