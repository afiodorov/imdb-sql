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
aws s3 sync dist/ s3://imdb-sql/ --exclude "*.parquet" --delete
aws cloudfront create-invalidation --distribution-id E2EYWSVOZPFWUP --paths "/*"
```

`--exclude "*.parquet"` matters: the 104MB parquet in `public/` is copied into `dist/` by Vite with a fresh mtime, so without the exclude `s3 sync` re-uploads it every deploy even though it's unchanged. When the dataset itself changes, upload it explicitly (`aws s3 cp public/<new>.parquet s3://imdb-sql/`).

Python tooling (data pipeline) uses `uv` with deps from `pyproject.toml`:

- `uv run imdb_extract.py` — download IMDb TSV dumps to `~/data/imdb`, join them into the parquet dataset
- `uv run generate_cache.py` — re-run the default query against the parquet and write `public/default_query_cache.json`

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
