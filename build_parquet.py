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
  - We deliberately do NOT sort: the natural join order already clusters rows by
    title (each title's regional akas rows are contiguous), so re-sorting scatters
    the dominant string columns and *grows* the file — and a global sort would
    force a full in-memory materialization, defeating the low-RAM streaming sink.
"""

import json
from datetime import datetime
from pathlib import Path

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

    parquet_opts = {"compression": "zstd", "compression_level": 12}
    try:
        joined.sink_parquet(dest, **parquet_opts)
    except Exception as e:
        print(f"Streaming sink_parquet failed ({e}); falling back to collect()")
        joined.collect().write_parquet(dest, **parquet_opts)

    version_path = PUBLIC_DIR / "version.json"
    version_path.write_text(
        json.dumps({"parquet": dest.name, "generated": datetime.now().isoformat()})
    )
    print(f"built {dest} + {version_path.name} -> {dest.name}")
    return dest.name


if __name__ == "__main__":
    build()
