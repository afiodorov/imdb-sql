#!/usr/bin/env bash
# Build and deploy the remote MCP Lambda (see handler.py). Idempotent: creates the
# role/function/URL on first run, afterwards just updates code and config.
#
# The CloudFront side (an origin for the function URL + a /mcp behavior) is a
# one-time setup done by hand; see CLAUDE.md.
set -euo pipefail

REGION=eu-west-2
FUNCTION=imdb-sql-mcp
ROLE=imdb-sql-mcp-role
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
BUILD="$ROOT/build/mcp_lambda"

# Match the duckdb the rest of the repo is locked to, and its httpfs build.
DUCKDB_VERSION="$(cd "$ROOT" && uv run python -c 'import duckdb; print(duckdb.__version__)')"

rm -rf "$BUILD" && mkdir -p "$BUILD/pkg"
uv pip install --quiet --target "$BUILD/pkg" --python-platform x86_64-manylinux_2_28 \
  --python-version 3.12 --only-binary=:all: "duckdb==$DUCKDB_VERSION"
curl -sSfL "https://extensions.duckdb.org/v$DUCKDB_VERSION/linux_amd64/httpfs.duckdb_extension.gz" \
  | gunzip > "$BUILD/pkg/httpfs.duckdb_extension"
cp "$HERE/handler.py" "$BUILD/pkg/"
python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])" "$BUILD/function" "$BUILD/pkg"
echo "built $(du -h "$BUILD/function.zip" | cut -f1) zip with duckdb $DUCKDB_VERSION"

if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10  # new roles take a moment before Lambda can assume them
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"

CONFIG=(--runtime python3.12 --handler handler.lambda_handler --memory-size 2048 --timeout 30
        --environment "Variables={SITE=https://imdb-sql.fiodorov.es}")
if aws lambda get-function --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION" --region "$REGION" \
    --zip-file "fileb://$BUILD/function.zip" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FUNCTION" --region "$REGION" \
    --role "$ROLE_ARN" "${CONFIG[@]}" >/dev/null
else
  aws lambda create-function --function-name "$FUNCTION" --region "$REGION" --role "$ROLE_ARN" \
    "${CONFIG[@]}" --architectures x86_64 --zip-file "fileb://$BUILD/function.zip" >/dev/null
fi
aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

if ! aws lambda get-function-url-config --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FUNCTION" --region "$REGION" --auth-type NONE >/dev/null
  # Public URL: both permissions are required for auth-type NONE.
  aws lambda add-permission --function-name "$FUNCTION" --region "$REGION" --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FUNCTION" --region "$REGION" --statement-id public-invoke \
    --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
fi
aws lambda get-function-url-config --function-name "$FUNCTION" --region "$REGION" --query FunctionUrl --output text
