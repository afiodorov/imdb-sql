import React, {useEffect, useState} from 'react';
import {useDuckDB} from './duckdb/duckdbContext';
import {DataGrid, GridColDef, GridCellParams} from '@mui/x-data-grid';
import {useSearchParams} from 'react-router-dom';

interface QueryResultRow {
    id: number; // DataGrid requires an 'id' field
    [key: string]: any;
}

const App: React.FC = () => {
    const {db} = useDuckDB();
    const [data, setData] = useState<QueryResultRow[]>([]);
    const [columns, setColumns] = useState<GridColDef[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [parquetLoaded, setParquetLoaded] = useState<boolean>(false);
    const [showQuery, setShowQuery] = useState<boolean>(false);


    const [searchParams, setSearchParams] = useSearchParams();

    const defaultQuery = `SELECT
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
LIMIT 100;`;

    // Initialize the query state with the value from the URL or the default query
    const initialQuery = searchParams.get('query') || defaultQuery;
    const [query, setQuery] = useState<string>(initialQuery)

    useEffect(() => {
        if (!db || parquetLoaded) return;

        const loadParquetFile = async () => {
            try {
                const parquetUrl = '/imdb01-11-2024.parquet';
                const response = await fetch(parquetUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch Parquet file: ${response.statusText}`);
                }
                const parquetArrayBuffer = await response.arrayBuffer();
                const parquetUint8Array = new Uint8Array(parquetArrayBuffer);
                await db.registerFileBuffer('imdb01-11-2024.parquet', parquetUint8Array);
                setParquetLoaded(true); // Update the state to indicate the file is loaded
            } catch (error) {
                console.error('Error loading Parquet file:', error);
            }
        };

        loadParquetFile();
    }, [db, parquetLoaded]);

    const fetchData = async (customQuery: string) => {
        if (!db || !parquetLoaded) return;

        setLoading(true);

        try {
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
        if (db && parquetLoaded) {
            fetchData(query);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, parquetLoaded]);

    const handleQueryChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setQuery(event.target.value);
    };

    const handleQuerySubmit = (event: React.FormEvent) => {
        event.preventDefault();
        fetchData(query);
        setSearchParams({query})
    };

    return (
        <div style={{padding: '1rem'}}>
            <form onSubmit={handleQuerySubmit} style={{marginBottom: '1rem'}}>
                {showQuery ? <textarea
                    value={query}
                    onChange={handleQueryChange}
                    style={{
                        width: '80%',
                        height: '350px',
                        padding: '0.5rem',
                        fontSize: '1rem',
                        fontFamily: 'monospace',
                    }}
                    placeholder="Type your SQL query here"
                /> : null}
                <br />
                <button type="button" onClick={() => setShowQuery(!showQuery)}>
                    {showQuery ? "Hide Query" : "Show Query"}
                </button>
                {showQuery ? <button type="submit">
                    Run Query
                </button> : null}
            </form>

            {loading ? (
                <p>Loading...</p>
            ) : (
                <div style={{height: '100%', width: '100%'}}>
                    <DataGrid rows={data} columns={columns} initialState={{
                        pagination: {
                            paginationModel: {pageSize: 25, page: 0},
                        },
                    }} />
                </div>
            )}
        </div>
    );
};

export default App;
