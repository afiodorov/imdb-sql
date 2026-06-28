"""Join the IMDb TSVs into a dated parquet and write public/version.json.

Streamed to disk via sink_parquet so the full join never materializes in RAM
(the box that runs this on a schedule is memory-constrained). version.json records
the physical filename so the app discovers it at runtime (no rebuild needed).
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
    ).join(basics, left_on="titleId", right_on="tconst", how="inner")

    try:
        joined.sink_parquet(dest)
    except Exception as e:
        print(f"Streaming sink_parquet failed ({e}); falling back to collect()")
        joined.collect().write_parquet(dest)

    version_path = PUBLIC_DIR / "version.json"
    version_path.write_text(
        json.dumps({"parquet": dest.name, "generated": datetime.now().isoformat()})
    )
    print(f"built {dest} + {version_path.name} -> {dest.name}")
    return dest.name


if __name__ == "__main__":
    build()
