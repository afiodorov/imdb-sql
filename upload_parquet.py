"""Upload the parquet named in public/version.json to S3 (skip if already there).

Kept separate from build so a failed/retried upload never re-runs the multi-GB
download + join. Must run before deploy_data.py publishes version.json, so the
app never sees a pointer to a not-yet-uploaded parquet.
"""

import json
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

S3_BUCKET = "imdb-sql"
PUBLIC_DIR = Path(__file__).parent / "public"


def upload() -> None:
    key = json.loads((PUBLIC_DIR / "version.json").read_text())["parquet"]
    src = PUBLIC_DIR / key
    if not src.exists():
        raise FileNotFoundError(f"{src} missing; run build_parquet.py first")

    s3 = boto3.client("s3")
    try:
        s3.head_object(Bucket=S3_BUCKET, Key=key)
        print(f"{key} already on S3; skipping upload")
        return
    except ClientError as e:
        # 404 = not there yet (needs s3:ListBucket, else S3 hides it as 403).
        if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
            raise

    print(f"uploading {key} -> s3://{S3_BUCKET}/{key} ...")
    s3.upload_file(str(src), S3_BUCKET, key)
    print("uploaded")


if __name__ == "__main__":
    upload()
