"""Delete superseded dated parquet files from S3, keeping the most recent few.

Each dataset refresh uploads a new dated parquet (imdb<DD-MM-YYYY>.parquet) under
a fresh key, so old ones accumulate forever otherwise — a real concern once the
refresh runs more often than weekly. We keep KEEP newest files: the current one
(named in version.json) plus a small grace buffer of prior versions, so any client
that cached an older version.json before the CDN invalidation can still fetch its
parquet for a while. Everything older is deleted.

Runs after publish in the DAG. Needs s3:ListBucket + s3:DeleteObject on the bucket.
"""

import json
import re
from pathlib import Path

import boto3

S3_BUCKET = "imdb-sql"
PUBLIC_DIR = Path(__file__).parent / "public"
KEEP = 2  # current + 1 previous (grace buffer for in-flight clients)

PARQUET_RE = re.compile(r"^imdb\d{2}-\d{2}-\d{4}\.parquet$")


def cleanup() -> None:
    current = json.loads((PUBLIC_DIR / "version.json").read_text())["parquet"]
    s3 = boto3.client("s3")

    objs = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET):
        for o in page.get("Contents", []):
            if PARQUET_RE.match(o["Key"]):
                objs.append(o)

    # Newest first by upload time; force the live file to the front so it's never
    # a deletion candidate even if its mtime looks old.
    objs.sort(key=lambda o: o["LastModified"], reverse=True)
    objs.sort(key=lambda o: o["Key"] != current)

    keep = {o["Key"] for o in objs[:KEEP]}
    keep.add(current)  # belt and suspenders

    stale = [o["Key"] for o in objs if o["Key"] not in keep]
    if not stale:
        print(f"nothing to delete; {len(objs)} parquet(s) on S3, keeping all")
        return

    for key in stale:
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        print(f"deleted s3://{S3_BUCKET}/{key}")
    print(f"kept {sorted(keep)}")


if __name__ == "__main__":
    cleanup()
