"""Download + unzip the IMDb TSV dumps we use into ~/data/imdb.

Only the three dumps the join needs (akas/basics/ratings); skips files already
present so a within-run retry of a later step never re-downloads. Fresh data
across runs is guaranteed by the DAG's `prepare` task wiping the dir first.
"""

import gzip
import shutil
from pathlib import Path

import requests

# Only the dumps build_parquet.py actually joins.
LINKS = ["title.akas.tsv.gz", "title.basics.tsv.gz", "title.ratings.tsv.gz"]
DEST_DIR = Path.home() / "data" / "imdb"


def fetch() -> None:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    for fname in LINKS:
        gz = DEST_DIR / fname
        if not gz.exists():
            url = f"https://datasets.imdbws.com/{fname}"
            resp = requests.get(url, allow_redirects=True)
            resp.raise_for_status()
            gz.write_bytes(resp.content)
            print(f"downloaded {fname}")

        tsv = DEST_DIR / gz.stem  # strip .gz
        if not tsv.exists():
            with gzip.open(gz, "rb") as f_in, tsv.open("wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            print(f"unzipped {tsv.name}")


if __name__ == "__main__":
    fetch()
