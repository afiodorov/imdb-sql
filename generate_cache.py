import json
from pathlib import Path
import duckdb

# Path to the parquet file
parquet_path = Path.home() / "data" / "imdb" / "imdb04-10-2025.parquet"

# Default query from the app
default_query = """SELECT * EXCLUDE (titleType, primaryTitle, language)
FROM 'imdb04-10-2025.parquet'
WHERE
(region is null and
numVotes >= 100000 and
titleType = 'movie' and
startYear >= 2015)
ORDER BY (numVotes * averageRating + 700000) / (numVotes + 100000) DESC
LIMIT 100"""

# Connect to DuckDB and run the query
con = duckdb.connect()
con.execute(f"CREATE OR REPLACE VIEW parquet_data AS SELECT * FROM '{parquet_path}'")

# Update query to use the view
query = default_query.replace("'imdb04-10-2025.parquet'", "parquet_data")
result = con.execute(query).fetchdf()

# Convert to JSON
output_path = Path(__file__).parent / "public" / "default_query_cache.json"
output_path.parent.mkdir(exist_ok=True, parents=True)

# Convert DataFrame to list of dicts for JSON serialization
data = result.to_dict(orient='records')
with open(output_path, 'w') as f:
    json.dump(data, f)

print(f"Generated cache with {len(data)} rows at {output_path}")
print(f"File size: {output_path.stat().st_size / 1024:.2f} KB")
