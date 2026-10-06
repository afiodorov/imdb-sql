# Imdb SQL

Query an imdb dataset right inside your browser

Hosted [here](https://imdb-sql.fiodorov.es/)

![Example](./preview.sng)

## Use it from an AI agent (MCP)

The dataset is also available as a remote MCP server at `https://imdb-sql.fiodorov.es/mcp`
(Streamable HTTP, no auth), with tools `query_imdb(sql)` and `get_imdb_schema()`.

- Claude Code: `claude mcp add --transport http imdb-sql https://imdb-sql.fiodorov.es/mcp`
- Claude.ai / ChatGPT: add a custom connector with that URL.

See [`llms.txt`](https://imdb-sql.fiodorov.es/llms.txt) for the schema and query tips.

# Development

Run

`npm run dev`
