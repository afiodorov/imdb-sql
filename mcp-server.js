#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'duckdb-async';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Queries use the stable name 'imdb.parquet'; the actual file in public/ is versioned
const publicDir = join(__dirname, 'public');
const parquetFile = readdirSync(publicDir).find(
  (f) => f.startsWith('imdb') && f.endsWith('.parquet')
);
const PARQUET_PATH = join(publicDir, parquetFile);

class IMDbMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'imdb-sql-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.db = null;
  }

  async initDB() {
    if (!this.db) {
      this.db = await Database.create(':memory:');
    }
    return this.db;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'query_imdb',
          description: 'Execute SQL queries on the IMDb dataset. The dataset contains movie information including titles, ratings, votes, years, genres, etc. The parquet file is located at "imdb.parquet" and can be queried directly in SQL.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'SQL query to execute. Use FROM \'imdb.parquet\' to query the dataset.',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_imdb_schema',
          description: 'Get the schema of the IMDb dataset to see available columns and their types.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'query_imdb') {
        return await this.handleQuery(request.params.arguments);
      } else if (request.params.name === 'get_imdb_schema') {
        return await this.handleGetSchema();
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  async handleQuery(args) {
    try {
      const db = await this.initDB();
      const { query } = args;

      // Security: Read-only queries
      const upperQuery = query.trim().toUpperCase();
      if (
        upperQuery.startsWith('DROP') ||
        upperQuery.startsWith('DELETE') ||
        upperQuery.startsWith('INSERT') ||
        upperQuery.startsWith('UPDATE') ||
        upperQuery.startsWith('CREATE') ||
        upperQuery.startsWith('ALTER')
      ) {
        throw new Error('Only SELECT queries are allowed');
      }

      // Replace stable/dated parquet names with the absolute path
      const modifiedQuery = query.replace(
        /'imdb[^']*\.parquet'/g,
        `'${PARQUET_PATH}'`
      );

      const result = await db.all(modifiedQuery);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing query: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async handleGetSchema() {
    try {
      const db = await this.initDB();
      const schemaQuery = `DESCRIBE SELECT * FROM '${PARQUET_PATH}' LIMIT 0`;
      const schema = await db.all(schemaQuery);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting schema: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('IMDb MCP server running on stdio');
  }
}

const server = new IMDbMCPServer();
server.run().catch(console.error);
