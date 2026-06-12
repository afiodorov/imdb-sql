#!/usr/bin/env python3
"""IMDb SQL MCP Server"""

import asyncio
import json
import re
import sys
from pathlib import Path

import duckdb
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Queries use the stable name 'imdb.parquet'; the actual file in public/ is versioned
PARQUET_PATH = next((Path(__file__).parent / "public").glob("imdb*.parquet"))

# Create MCP server
app = Server("imdb-sql-server")

# In-memory DuckDB connection
con = None


def get_connection():
    """Get or create DuckDB connection"""
    global con
    if con is None:
        con = duckdb.connect(":memory:")
    return con


@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools"""
    return [
        Tool(
            name="query_imdb",
            description=(
                "Execute SQL queries on the IMDb dataset. "
                "The dataset contains movie information including titles, ratings, "
                "votes, years, genres, etc. "
                "Use FROM 'imdb.parquet' to query the dataset."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "SQL query to execute",
                    }
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="get_imdb_schema",
            description="Get the schema of the IMDb dataset to see available columns and their types",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle tool calls"""
    if name == "query_imdb":
        return await handle_query(arguments)
    elif name == "get_imdb_schema":
        return await handle_get_schema()
    else:
        raise ValueError(f"Unknown tool: {name}")


async def handle_query(arguments: dict) -> list[TextContent]:
    """Execute SQL query"""
    try:
        query = arguments["query"]

        # Security: Read-only queries
        query_upper = query.strip().upper()
        forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "CREATE", "ALTER"]
        if any(query_upper.startswith(cmd) for cmd in forbidden):
            raise ValueError("Only SELECT queries are allowed")

        # Replace stable/dated parquet names with the absolute path
        modified_query = re.sub(
            r"'imdb[^']*\.parquet'", f"'{PARQUET_PATH}'", query
        )

        conn = get_connection()
        result = conn.execute(modified_query).fetchall()
        columns = [desc[0] for desc in conn.description]

        # Convert to list of dicts
        rows = [dict(zip(columns, row)) for row in result]

        return [TextContent(type="text", text=json.dumps(rows, indent=2, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=f"Error executing query: {str(e)}")]


async def handle_get_schema() -> list[TextContent]:
    """Get schema information"""
    try:
        conn = get_connection()
        schema_query = f"DESCRIBE SELECT * FROM '{PARQUET_PATH}' LIMIT 0"
        result = conn.execute(schema_query).fetchall()
        columns = [desc[0] for desc in conn.description]

        # Convert to list of dicts
        schema = [dict(zip(columns, row)) for row in result]

        return [TextContent(type="text", text=json.dumps(schema, indent=2, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=f"Error getting schema: {str(e)}")]


async def main():
    """Run the server"""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
