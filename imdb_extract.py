import shutil
import gzip
from pathlib import Path
from datetime import datetime

import requests
import polars as pl
import boto3
from botocore.exceptions import ClientError

links = """name.basics.tsv.gz
title.akas.tsv.gz
title.basics.tsv.gz
title.crew.tsv.gz
title.episode.tsv.gz
title.principals.tsv.gz
title.ratings.tsv.gz""".split()

to_download = [f"https://datasets.imdbws.com/{l}" for l in links]
dest_dir = Path.home() / "data" / "imdb"

for fname, url in zip(links, to_download):
    dest = dest_dir / fname
    if dest.exists():
        continue

    dest.parent.mkdir(exist_ok=True, parents=True)

    response = requests.get(url, allow_redirects=True)
    response.raise_for_status()

    with dest.open(mode="wb") as f:
        f.write(response.content)


for filename in dest_dir.glob("*.tsv.gz"):
    dest_file = dest_dir / filename.stem
    if dest_file.exists():
        continue

    with gzip.open(filename, "rb") as f_in, dest_file.open(mode="wb") as f_out:
        shutil.copyfileobj(f_in, f_out)


date_str = datetime.now().strftime("%d-%m-%Y")
dest_joined = dest_dir / f"imdb{date_str}.parquet"
s3_bucket = "imdb-sql"
s3_key = f"imdb{date_str}.parquet"

# Check if file already exists in S3
s3_client = boto3.client('s3')
try:
    s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
    print(f"File {s3_key} already exists in S3 bucket {s3_bucket}. Skipping.")
    exit(0)
except ClientError as e:
    if e.response['Error']['Code'] != '404':
        raise
    print(f"File not found in S3. Proceeding with download and processing...")

if not dest_joined.exists():
    csv_options = {
        "separator": "\t",
        "encoding": "utf8",
        "ignore_errors": True,
        "infer_schema_length": 10000,
        "quote_char": None,
        'null_values': ['\\N'],
    }

    ratings = pl.scan_csv(dest_dir / "title.ratings.tsv", **csv_options)

    details = pl.scan_csv(dest_dir / "title.akas.tsv", **csv_options).select(
        ["titleId", "title", "region", "language"]
    )

    basics = pl.scan_csv(dest_dir / "title.basics.tsv", **csv_options).select(
        ["tconst", "startYear", "genres", "primaryTitle", "titleType"]
    )

    # Perform lazy joins
    joined = details.join(
        ratings,
        left_on="titleId",
        right_on="tconst",
        how="inner",
    ).join(basics, left_on="titleId", right_on="tconst", how="inner")

    joined.collect().write_parquet(dest_joined)

print(f"Done! Created {dest_joined}")

# Upload to S3
print(f"Uploading {dest_joined} to s3://{s3_bucket}/{s3_key}...")
s3_client.upload_file(str(dest_joined), s3_bucket, s3_key)
print(f"Successfully uploaded to S3!")
