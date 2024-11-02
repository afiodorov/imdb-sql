import React, {useEffect, useState} from 'react';
import {useDuckDB} from './duckdb/duckdbContext';
import {DataGrid, GridColDef, GridCellParams} from '@mui/x-data-grid';

interface QueryResultRow {
    id: number; // DataGrid requires an 'id' field
    [key: string]: any;
}

const App: React.FC = () => {
    const {db} = useDuckDB();
    const [data, setData] = useState<QueryResultRow[]>([]);
    const [columns, setColumns] = useState<GridColDef[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [query, setQuery] = useState<string>(`SELECT
  titleId,
  title,
  primaryTitle,
  startYear,
  genres,
  averageRating,
  numVotes
FROM 'imdb01-11-2024.parquet'
WHERE
  averageRating >= 7.2 AND
  numVotes > 50000 AND
  startYear > 2010 AND
  titleType IN ('movie', 'tvMovie') AND
  region IS NULL
ORDER BY
  averageRating DESC
LIMIT 100;`);

    const fetchData = async (customQuery: string) => {
        if (!db) return;

        setLoading(true);

        try {
            const parquetUrl = '/imdb01-11-2024.parquet';
            const response = await fetch(parquetUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch Parquet file: ${response.statusText}`);
            }
            const parquetArrayBuffer = await response.arrayBuffer();
            const parquetUint8Array = new Uint8Array(parquetArrayBuffer);
            await db.registerFileBuffer('imdb01-11-2024.parquet', parquetUint8Array);

            const connection = await db.connect();
            const result = await connection.query(customQuery);
            await connection.close();

            let rows = result.toArray() as QueryResultRow[];
            rows = rows.map((row, index) => ({...row, id: index}));


            const columnDefs: GridColDef[] = result.schema.fields.map((field: any) => {
                const colDef: GridColDef = {
                    field: field.name,
                    headerName: field.name,
                    width: 150,
                    sortable: true,
                    filterable: true,
                };

                if (field.name === 'titleId') {
                    colDef.renderCell = (params: GridCellParams) => (
                        <a
                            href={`https://www.imdb.com/title/${params.value}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {params.value as string}
                        </a>
                    );
                }

                return colDef;
            });
            setData(rows);
            setColumns(columnDefs);
        } catch (error) {
            console.error('Error querying Parquet file:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db]);

    const handleQueryChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setQuery(event.target.value);
    };

    const handleQuerySubmit = (event: React.FormEvent) => {
        event.preventDefault();
        fetchData(query);
    };

    return (
        <div style={{padding: '1rem'}}>
            {loading ? (
                <p>Loading...</p>
            ) : (
                <div style={{height: 600, width: '100%'}}>
                    <DataGrid
                        rows={data}
                        columns={columns}
                    />
                </div>
            )}
            <form onSubmit={handleQuerySubmit} style={{marginBottom: '1rem'}}>
                <textarea
                    value={query}
                    onChange={handleQueryChange}
                    style={{
                        width: '80%',
                        height: '150px',
                        padding: '0.5rem',
                        fontSize: '1rem',
                        fontFamily: 'monospace',
                    }}
                    placeholder="Type your SQL query here"
                />
                <br />
                <button type="submit" style={{padding: '0.5rem 1rem', marginTop: '0.5rem'}}>
                    Run Query
                </button>
            </form>
        </div>
    );
};

export default App;
