"""Weekly IMDb dataset refresh, as granular tasks.

prepare -> fetch_tsv -> build_parquet -> upload_parquet -> generate_cache -> publish -> cleanup

Split so a late failure (e.g. an S3/CloudFront hiccup) retries only that step
instead of redoing the multi-GB download + join. `prepare` wipes stale inputs at
the start (fresh data every weekly run); `fetch_tsv` skips files already present
(cheap within-run retries); `cleanup` frees disk afterwards regardless of outcome.

Because the app discovers the parquet filename at runtime from version.json, this
needs no frontend rebuild/deploy.

Prereqs on the box:
  - repo rsync'd to /root/imdb-sql
  - uv at /root/.local/bin/uv (deps installed on first `uv run`)
  - AWS credentials for boto3 (~/.aws, region eu-west-2) with s3:ListBucket +
    s3:GetObject/PutObject on `imdb-sql` and cloudfront:CreateInvalidation on
    E2EYWSVOZPFWUP
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.providers.standard.operators.bash import BashOperator
from airflow.task.trigger_rule import TriggerRule

REPO = "/root/imdb-sql"
UV = "/root/.local/bin/uv"
RUN = f"cd {REPO} && PYTHONUNBUFFERED=1 {UV} run python -u"
WIPE = f"rm -rf ~/data/imdb {REPO}/public/imdb*.parquet"

default_args = {
    "owner": "imdb-sql",
    "retries": 1,
    "retry_delay": timedelta(minutes=10),
}

with DAG(
    dag_id="imdb_dataset_update",
    description="Weekly IMDb parquet rebuild + S3/CloudFront publish",
    schedule="0 4 * * 1",            # 04:00 UTC every Monday
    start_date=datetime(2026, 6, 28),
    catchup=False,
    max_active_runs=1,
    default_args=default_args,
    tags=["imdb-sql"],
) as dag:
    # Clean slate so each weekly run pulls fresh dumps even if a prior cleanup
    # didn't run. Separate from fetch so retrying a later task never re-wipes.
    prepare = BashOperator(task_id="prepare", bash_command=WIPE)

    fetch = BashOperator(
        task_id="fetch_tsv",
        bash_command=f"{RUN} fetch_tsv.py",
        execution_timeout=timedelta(hours=1),
    )
    build = BashOperator(
        task_id="build_parquet",
        bash_command=f"{RUN} build_parquet.py",
        execution_timeout=timedelta(hours=1),
    )
    upload = BashOperator(
        task_id="upload_parquet",
        bash_command=f"{RUN} upload_parquet.py",
        execution_timeout=timedelta(minutes=30),
    )
    generate_cache = BashOperator(
        task_id="generate_cache",
        bash_command=f"{RUN} generate_cache.py",
        execution_timeout=timedelta(minutes=30),
    )
    publish = BashOperator(
        task_id="publish",
        bash_command=f"{RUN} deploy_data.py",
        execution_timeout=timedelta(minutes=15),
    )
    # Free the multi-GB TSVs + local parquet (already on S3) no matter what.
    cleanup = BashOperator(
        task_id="cleanup",
        bash_command=WIPE,
        trigger_rule=TriggerRule.ALL_DONE,
    )

    prepare >> fetch >> build >> upload >> generate_cache >> publish >> cleanup
