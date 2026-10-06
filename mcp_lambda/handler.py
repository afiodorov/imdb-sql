"""Remote MCP server for the IMDb dataset, as an AWS Lambda behind CloudFront.

Served at https://imdb-sql.fiodorov.es/mcp (CloudFront routes /mcp to this
function's URL; everything else is the static app on S3). Any MCP client
(Claude, ChatGPT, Cursor, ...) can connect to that URL directly. No auth.

Transport: Streamable HTTP, stateless, JSON responses only (no SSE, no
sessions). That is a small JSON-RPC surface, so it's implemented here directly
rather than through the MCP SDK, whose ASGI session manager wants a long-lived
task group a Lambda invocation doesn't have.

Data: like the browser app, DuckDB reads the public parquet over HTTP range
requests from CloudFront; nothing is bundled or downloaded whole. The current
file is discovered from version.json, so dataset refreshes need no redeploy.

Arbitrary SQL from the internet is sandboxed in layers:
  - only a single SELECT/EXPLAIN statement is accepted (DuckDB classifies
    DESCRIBE, SUMMARIZE, PRAGMA and CTEs as SELECT);
  - external access is off except for the one parquet URL (no local files,
    other URLs, COPY, ATTACH, INSTALL/LOAD), and the config is locked;
  - memory/threads/rows/time are capped, and spilling to disk is disabled.
"""

import json
import os
import re
import threading
import time
import urllib.request

import duckdb

SITE = os.environ.get("SITE", "https://imdb-sql.fiodorov.es")
HTTPFS = os.environ.get("HTTPFS_EXTENSION", os.path.join(os.path.dirname(__file__), "httpfs.duckdb_extension"))
VERSION_TTL = 300  # seconds between version.json checks on a warm instance
QUERY_TIMEOUT = 20  # seconds; the Lambda itself times out at 30
MAX_ROWS = 500
MAX_CHARS = 200_000

PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "imdb-sql", "title": "IMDb SQL", "version": "1.0.0"}

ABOUT = """\
SQL (DuckDB dialect) over IMDb's public dataset, refreshed daily: ~8M rows covering \
every rated title (movies, series, episodes, shorts, games...). Query the table as \
FROM 'imdb.parquet'. Try it in a browser at https://imdb-sql.fiodorov.es/."""

SCHEMA_NOTES = """\
Columns of 'imdb.parquet' (one row per title per regional/alternate title):
- titleId VARCHAR: IMDb id, e.g. tt0133093; page is https://www.imdb.com/title/<titleId>/
- title VARCHAR: the title as known in `region`
- region VARCHAR: country code of that alternate title; NULL marks the original-title row
- language VARCHAR: language of the alternate title, often NULL
- primaryTitle VARCHAR: the main (usually English) title, same on every row of a title
- titleType VARCHAR: movie, tvSeries, tvMiniSeries, tvEpisode, tvMovie, tvSpecial, tvShort, short, video, videoGame
- startYear SMALLINT: release year (first-air year for series)
- genres VARCHAR: comma-separated, e.g. 'Action,Sci-Fi'; filter with LIKE '%Horror%'
- averageRating FLOAT: IMDb rating 1-10; numVotes INTEGER: number of ratings

Tips:
- Add `region IS NULL` to get ~one row per title (otherwise each title repeats per country).
- Filtering on numVotes (e.g. numVotes >= 10000) is the fastest filter: rows are sorted by it.
- A good "best of" ranking is the Bayesian average used by the website:
  ORDER BY (numVotes * averageRating + 700000) / (numVotes + 100000) DESC
- Example: SELECT primaryTitle, startYear, averageRating, numVotes FROM 'imdb.parquet'
  WHERE region IS NULL AND titleType = 'movie' AND numVotes >= 50000 AND genres LIKE '%Horror%'
  ORDER BY averageRating DESC LIMIT 20"""

TOOLS = [
    {
        "name": "query_imdb",
        "title": "Query IMDb with SQL",
        "description": (
            f"Run one read-only DuckDB SQL query against the IMDb dataset and get rows back as JSON "
            f"(at most {MAX_ROWS} rows; add LIMIT). Query the table as FROM 'imdb.parquet'.\n\n{SCHEMA_NOTES}"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"sql": {"type": "string", "description": "A single SELECT query."}},
            "required": ["sql"],
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "get_imdb_schema",
        "title": "IMDb dataset schema",
        "description": "Columns, types and query tips for 'imdb.parquet', plus which dataset build is live.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]

# Per warm instance: (parquet url, sandboxed connection), re-made when version.json
# changes, since the sandbox's allowed path is locked into the connection.
_state: dict = {"checked": 0.0, "url": None, "con": None, "version": None}


def _current_version() -> dict:
    with urllib.request.urlopen(f"{SITE}/version.json?t={int(time.time())}", timeout=5) as r:
        return json.load(r)


def _connection() -> tuple[duckdb.DuckDBPyConnection, str]:
    now = time.time()
    if _state["con"] is None or now - _state["checked"] > VERSION_TTL:
        version = _current_version()
        url = f"{SITE}/{version['parquet']}"
        _state["checked"] = now
        if url != _state["url"]:
            con = duckdb.connect(config={"autoinstall_known_extensions": "false", "autoload_known_extensions": "false"})
            con.execute(f"LOAD '{HTTPFS}'")
            con.execute(f"SET allowed_paths = ['{url}']")
            con.execute("SET enable_external_access = false")
            con.execute("SET memory_limit = '1200MB'")
            con.execute("SET threads = 2")
            con.execute("SET max_temp_directory_size = '0B'")
            con.execute("SET lock_configuration = true")
            if _state["con"] is not None:
                _state["con"].close()
            _state.update(con=con, url=url, version=version)
    return _state["con"], _state["url"]


def _check_sql(sql: str) -> None:
    statements = duckdb.extract_statements(sql)
    if len(statements) != 1:
        raise ValueError("Send exactly one SQL statement.")
    if statements[0].type not in (duckdb.StatementType.SELECT, duckdb.StatementType.EXPLAIN):
        raise ValueError("Only read-only SELECT queries are allowed.")


def _clean(v):
    # averageRating is FLOAT (float32): 9.3 would otherwise print as 9.300000190734863.
    return float(f"{v:.6g}") if isinstance(v, float) else v


def run_query(sql: str) -> dict:
    _check_sql(sql)
    con, url = _connection()
    # Queries name the stable 'imdb.parquet' (also accept old dated names, as the app does).
    sql = re.sub(r"'imdb[^'/]*\.parquet'", f"'{url}'", sql)
    cur = con.cursor()
    timer = threading.Timer(QUERY_TIMEOUT, cur.interrupt)
    timer.start()
    try:
        cur.execute(sql)
        columns = [d[0] for d in cur.description]
        rows = cur.fetchmany(MAX_ROWS + 1)
    except duckdb.InterruptException:
        raise ValueError(f"Query exceeded {QUERY_TIMEOUT}s; filter more (e.g. on numVotes) or add LIMIT.")
    finally:
        timer.cancel()
        cur.close()
    truncated = len(rows) > MAX_ROWS
    return {
        "columns": columns,
        "rows": [[_clean(v) for v in r] for r in rows[:MAX_ROWS]],
        "rowCount": min(len(rows), MAX_ROWS),
        "truncated": truncated,
    }


def call_tool(name: str, args: dict) -> dict:
    try:
        if name == "query_imdb":
            sql = args.get("sql") or args.get("query")
            if not isinstance(sql, str) or not sql.strip():
                raise ValueError("Missing 'sql' argument.")
            result = run_query(sql)
            text = json.dumps(result, default=str)
            if len(text) > MAX_CHARS:
                text = text[:MAX_CHARS] + "\n... (output cut; select fewer columns or add LIMIT)"
            return {"content": [{"type": "text", "text": text}], "isError": False}
        if name == "get_imdb_schema":
            _connection()
            v = _state["version"]
            text = f"{SCHEMA_NOTES}\n\nLive dataset: {v.get('parquet')} (built {v.get('generated', 'unknown')})."
            return {"content": [{"type": "text", "text": text}], "isError": False}
        raise LookupError(name)
    except LookupError:
        raise
    except Exception as e:  # SQL and validation errors go back to the model, not as protocol errors
        msg = str(e).splitlines()[0] if str(e) else type(e).__name__
        return {"content": [{"type": "text", "text": f"Error: {msg}"}], "isError": True}


def _ok(id_, result):
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _err(id_, code, message):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def handle_message(msg: dict) -> dict | None:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return _err(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid Request")
    if "id" not in msg:
        return None  # notification, e.g. notifications/initialized
    id_, method, params = msg["id"], msg["method"], msg.get("params") or {}
    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
        return _ok(id_, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": f"{ABOUT}\n\nUse get_imdb_schema for columns and tips, then query_imdb.",
        })
    if method == "ping":
        return _ok(id_, {})
    if method == "tools/list":
        return _ok(id_, {"tools": TOOLS})
    if method == "tools/call":
        try:
            return _ok(id_, call_tool(params.get("name"), params.get("arguments") or {}))
        except LookupError:
            return _err(id_, -32602, f"Unknown tool: {params.get('name')}")
    return _err(id_, -32601, f"Method not found: {method}")


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
}


def _http(status: int, body=None, content_type="application/json") -> dict:
    headers = dict(CORS)
    if body is not None:
        headers["Content-Type"] = content_type
        body = body if isinstance(body, str) else json.dumps(body, default=str)
    return {"statusCode": status, "headers": headers, "body": body or ""}


def lambda_handler(event, context):
    """Lambda Function URL (payload v2) entry point."""
    method = event.get("requestContext", {}).get("http", {}).get("method", "POST")
    if method == "OPTIONS":
        return _http(204)
    if method == "GET":
        # No server-initiated SSE stream in stateless mode; a plain browser visit gets a pointer.
        accept = (event.get("headers") or {}).get("accept", "")
        if "text/event-stream" in accept:
            return _http(405, _err(None, -32000, "SSE stream not supported; POST JSON-RPC instead"))
        return _http(200, f"IMDb SQL MCP server (Streamable HTTP). POST JSON-RPC here.\n\n{ABOUT}\n", "text/plain; charset=utf-8")
    if method != "POST":
        return _http(405, _err(None, -32000, "Method not allowed"))

    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body).decode()
    try:
        payload = json.loads(body)
    except ValueError:
        return _http(400, _err(None, -32700, "Parse error"))

    if isinstance(payload, list):  # JSON-RPC batch (pre-2025-06-18 clients)
        responses = [r for r in (handle_message(m) for m in payload) if r is not None]
        return _http(200, responses) if responses else _http(202)
    response = handle_message(payload)
    return _http(200, response) if response is not None else _http(202)
