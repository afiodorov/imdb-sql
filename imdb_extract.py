"""All-in-one extract for local/manual use: fetch TSVs -> build parquet -> upload.

The Airflow DAG (dags/imdb_dataset_update.py) runs these as separate tasks so a
late failure doesn't redo the multi-GB download; this orchestrator is the
convenient one-shot for running the whole thing by hand. Follow with
generate_cache.py and deploy_data.py to publish.
"""

from build_parquet import build
from fetch_tsv import fetch
from upload_parquet import upload

if __name__ == "__main__":
    fetch()
    build()
    upload()
