"""Publish the small, stable-named data files and bust the CDN cache.

The parquet itself has a dated filename (a fresh URL each update), so it needs no
invalidation. But version.json and default_query_cache.json live at stable URLs,
so we upload them with no-cache headers and invalidate them on CloudFront. Run
this after imdb_extract.py + generate_cache.py.
"""

import time
from pathlib import Path

import boto3

S3_BUCKET = "imdb-sql"
CLOUDFRONT_DISTRIBUTION_ID = "E2EYWSVOZPFWUP"

# Stable-named files the app fetches fresh on every load.
STABLE_FILES = ["version.json", "default_query_cache.json"]

public_dir = Path(__file__).parent / "public"
s3 = boto3.client("s3")

paths = []
for name in STABLE_FILES:
    src = public_dir / name
    if not src.exists():
        raise FileNotFoundError(f"{src} missing; run imdb_extract.py + generate_cache.py first")
    s3.upload_file(
        str(src),
        S3_BUCKET,
        name,
        ExtraArgs={
            "ContentType": "application/json",
            "CacheControl": "no-cache, max-age=0",
        },
    )
    print(f"Uploaded {name} -> s3://{S3_BUCKET}/{name}")
    paths.append(f"/{name}")

cf = boto3.client("cloudfront")
resp = cf.create_invalidation(
    DistributionId=CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch={
        "Paths": {"Quantity": len(paths), "Items": paths},
        "CallerReference": str(int(time.time())),
    },
)
print(f"Created CloudFront invalidation {resp['Invalidation']['Id']} for {paths}")
