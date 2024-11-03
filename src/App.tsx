import React, {useEffect, useState} from 'react';
import {useDuckDB} from './duckdb/duckdbContext';
import {DataGrid, GridColDef, GridCellParams} from '@mui/x-data-grid';
import {useSearchParams} from 'react-router-dom';
import {defaultQuery} from './sql';
import {Editor} from './editor';
import {ImdbLink} from './imdb';

import {QueryBuilder, formatQuery, RuleGroupType} from 'react-querybuilder';
import {fields} from './fields';
import 'react-querybuilder/dist/query-builder.scss';
import './styles.css';


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

    // Initialize the query state with the value from the URL or the default query
    const initialQuery = searchParams.get('query') || defaultQuery;
    const [query, setQuery] = useState<string>(initialQuery)
    const [querySelection, setQuerySelection] = useState<string>("");

    const initialBuildQuery: RuleGroupType = {combinator: 'and', rules: []};
    const [buildQuery, setBuildQuery] = useState<RuleGroupType>(initialBuildQuery)

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
                        <ImdbLink titleId={params.value as string} />
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

    const handleBuildQuery = () => {
        setQuery(`SELECT * EXCLUDE (region, titleType)
FROM 'imdb01-11-2024.parquet'
WHERE
${formatQuery(buildQuery, {'format': 'sql', parseNumbers: true})}
ORDER BY
  averageRating DESC
LIMIT 100
`)
    }

    return (
        <div className="App">
            <div className="header"></div>

            <div className="query">
                {showQuery ? <Editor
                    value={query}
                    onChange={setQuery}
                    setSelection={setQuerySelection}
                /> : null}
                <br />
                {showQuery ? <button type="button" onClick={handleQueryRun}>
                    Run Query
                </button> : null}
                {showQuery ? <button type="button" onClick={handleBuildQuery}>
                    Build Query
                </button> : null}
                <button type="button" onClick={() => setShowQuery(!showQuery)}>
                    {showQuery ? "Hide Query" : "Show Query"}
                </button>
            </div>

            <div className="builder">
                {showQuery ? <QueryBuilder fields={fields} query={buildQuery} onQueryChange={setBuildQuery} /> : null}
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
