"""Join the IMDb TSVs into a dated parquet and write public/version.json.

Streamed to disk via sink_parquet so the full join never materializes in RAM
(the box that runs this on a schedule is memory-constrained). version.json records
the physical filename so the app discovers it at runtime (no rebuild needed).

Size tuning (measured on the 7.8M-row dataset, ~111MB default Snappy):
  - zstd compression is the only meaningful lever (the `title`/`primaryTitle` string
    columns are ~70% of the bytes). Level 12 -> ~99MB (~10% off Snappy) at near-Snappy
    CPU cost. Level 19 reaches ~89MB but costs ~20x the compression CPU, which on the
    memory-constrained box (7.6GB, swap-prone) thrashes a ~40s build out to 10-15 min —
    not worth the extra ~10MB, so we cap at 12.
  - Downcasting the numeric columns is essentially free in bytes but harmless.
  - Rows are re-sorted by numVotes DESC into 100k-row groups. The app reads the
    parquet over HTTP range requests rather than downloading it, so what matters
    is how much a query has to fetch: with rows in join order every row group spans
    the full numVotes/startYear range and no group can be skipped (the default query
    pulled ~78MB), while sorted the min/max stats prune almost everything for the
    usual `numVotes >= N` filters (~2MB). Costs ~5% in file size
    (~105MB vs ~100MB). The sort runs
    in DuckDB, not Polars, because DuckDB spills to disk instead of materializing
    the whole table in RAM.
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

import duckdb
import polars as pl

from fetch_tsv import DEST_DIR

PUBLIC_DIR = Path(__file__).parent / "public"

CSV_OPTIONS = {
    "separator": "\t",
    "encoding": "utf8",
    "ignore_errors": True,
    "infer_schema_length": 10000,
    "quote_char": None,
    "null_values": ["\\N"],
}


def sort_by_votes(src: Path, dest: Path) -> None:
    """Rewrite src ordered by numVotes DESC so row-group stats are prunable (see module docstring)."""
    spill = DEST_DIR / "duckdb_tmp"
    spill.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    # memory_limit doesn't bound the parquet writer's buffers: at 2GB/all threads
    # peak RSS was ~3.6GB; 512MB/2 threads peaks ~0.9GB for ~11s on 8M rows.
    con.execute("SET memory_limit = '512MB'")
    con.execute("SET threads = 2")
    con.execute(f"SET temp_directory = '{spill}'")
    try:
        con.execute(
            f"COPY (SELECT * FROM read_parquet('{src}') ORDER BY numVotes DESC) TO '{dest}' "
            "(FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 12, ROW_GROUP_SIZE 100000)"
        )
    finally:
        con.close()
        shutil.rmtree(spill, ignore_errors=True)


def build() -> str:
    PUBLIC_DIR.mkdir(exist_ok=True)
    date_str = datetime.now().strftime("%d-%m-%Y")
    dest = PUBLIC_DIR / f"imdb{date_str}.parquet"

    ratings = pl.scan_csv(DEST_DIR / "title.ratings.tsv", **CSV_OPTIONS)
    details = pl.scan_csv(DEST_DIR / "title.akas.tsv", **CSV_OPTIONS).select(
        ["titleId", "title", "region", "language"]
    )
    basics = pl.scan_csv(DEST_DIR / "title.basics.tsv", **CSV_OPTIONS).select(
        ["tconst", "startYear", "genres", "primaryTitle", "titleType"]
    )

    joined = details.join(
        ratings, left_on="titleId", right_on="tconst", how="inner"
    ).join(basics, left_on="titleId", right_on="tconst", how="inner").with_columns(
        # Lossless downcasts (years fit in Int16, votes well within Int32, ratings
        # are 1-decimal so Float32 is exact enough) — cheap and streaming-safe.
        pl.col("averageRating").cast(pl.Float32),
        pl.col("numVotes").cast(pl.Int32),
        pl.col("startYear").cast(pl.Int16),
    )

    # Intermediate lives outside public/: Vite copies public/ into dist/, and the
    # MCP servers glob public/imdb*.parquet.
    unsorted = DEST_DIR / "joined.unsorted.parquet"
    parquet_opts = {"compression": "zstd", "compression_level": 12}
    # Stream the join straight to disk; do NOT fall back to an in-memory
    # collect(). On the memory-constrained box (7.6GB) materializing the full
    # join peaks ~5.5GB and, under any extra pressure, swap-thrashes for the
    # entire execution_timeout instead of failing fast — which is exactly how a
    # build silently burned both retries on 2026-06-30. If the streaming sink
    # genuinely can't run, let it raise so the task retries/alerts.
    joined.sink_parquet(unsorted, engine="streaming", **parquet_opts)
    sort_by_votes(unsorted, dest)
    unsorted.unlink()

    version_path = PUBLIC_DIR / "version.json"
    version_path.write_text(
        json.dumps({"parquet": dest.name, "generated": datetime.now().isoformat()})
    )
    print(f"built {dest} + {version_path.name} -> {dest.name}")
    return dest.name


if __name__ == "__main__":
    build()
