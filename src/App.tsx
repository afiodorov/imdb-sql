import React, {useEffect, useState, useRef} from 'react';
import {useDuckDB} from './duckdb/duckdbContext';
import {DataGrid, GridColDef, GridCellParams} from '@mui/x-data-grid';
import {useSearchParams} from 'react-router-dom';
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/mode-sql";

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
    const [error, setError] = useState<string>("");
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
    const [querySelection, setQuerySelection] = useState<string>("");
    const editorRef = useRef<AceEditor | null>(null);

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
            setError("");
        } catch (error) {
            console.error('Error querying Parquet file:', error);
            setError(`${error}`)
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

    const handleQueryRun = () => {
        const queryToRun = querySelection || query;

        fetchData(queryToRun);
        setSearchParams({query: queryToRun});
    };

    return (
        <div className="App">
            <div className="header"></div>

            <div className="query">
                {showQuery ? <AceEditor
                    name="sql"
                    ref={editorRef}
                    mode="sql"
                    theme="github"
                    value={query}
                    onChange={setQuery}
                    onSelectionChange={() => setQuerySelection(editorRef.current?.editor.getSelectedText() || "")}
                    fontSize={14}
                    showPrintMargin={true}
                    showGutter={false}
                    highlightActiveLine={true}
                    setOptions={{
                        showLineNumbers: false,
                        tabSize: 2,
                        useWorker: false,
                    }}
                    width="100%"
                    height="350px"
                    readOnly={false}
                /> : null}
                <br />
                <button type="button" onClick={() => setShowQuery(!showQuery)}>
                    {showQuery ? "Hide Query" : "Show Query"}
                </button>
                {showQuery ? <button type="button" onClick={handleQueryRun}>
                    Run Query
                </button> : null}
            </div>

            <div className="error">{error ? <p>{error}</p> : null}</div>

            <div className="table">
                {loading ? (
                    <p>Loading...</p>
                ) : (
                    <DataGrid rows={data} columns={columns} initialState={{
                        pagination: {
                            paginationModel: {pageSize: 10, page: 0},
                        },
                    }}
                        pageSizeOptions={[10, 25, 50, 100]}
                    />
                )}
            </div>

            <div className="footer"></div>
        </div>
    );
};

export default App;
