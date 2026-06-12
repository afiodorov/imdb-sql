import React, {useEffect, useState} from 'react';
import {useDuckDB} from './duckdb/duckdbContext';
import {DataGrid, GridColDef, GridCellParams, GridToolbar} from '@mui/x-data-grid';
import {useSearchParams} from 'react-router-dom';
import {defaultQuery, cacheQueryParts, getCachedSelectColumns, getCachedOrderByClause, getCachedLimitValue, migrateQuery, PARQUET_NAME, PARQUET_FILE} from './sql';
import {Editor} from './editor';
import {ImdbLink} from './imdb';
import {storeParquetInIndexedDB, getParquetFileFromIndexedDB, deleteOtherParquetFiles} from './cache';
import {QueryBuilder, formatQuery, RuleGroupType} from 'react-querybuilder';
import {fields} from './fields';
import {useLocalStorageSetter} from "./storage";
import {customRuleProcessor} from './custom_sql_rule_processor';
import './styles.css';
import 'react-querybuilder/dist/query-builder.scss';

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

    // Initialize the query state with the value from the URL or the default query,
    // rewriting dated parquet filenames from older versions to the stable name
    const [query, setQuery] = useState<string>(() => {
        const stored = migrateQuery(localStorage.getItem('query'));
        if (stored) {
            localStorage.setItem('query', stored);
        }
        return migrateQuery(searchParams.get('query')) || stored || defaultQuery;
    })
    const [lastQuery, setLastQuery] = useState<string>('');
    const [querySelection, setQuerySelection] = useState<string>("");

    const initialBuildQuery: RuleGroupType = {
        "combinator": "and",
        "rules": [
            {
                "field": "region",
                "operator": "null",
                "valueSource": "value",
                "value": "US"
            },
            {
                "field": "numVotes",
                "operator": ">=",
                "valueSource": "value",
                "value": "100000"
            },
            {
                "field": "titleType",
                "operator": "=",
                "valueSource": "value",
                "value": "movie"
            },
            {
                "field": "startYear",
                "operator": ">=",
                "valueSource": "value",
                "value": "2015"
            }
        ]
    }
    const [buildQuery, setBuildQuery] = useState<RuleGroupType>(JSON.parse(localStorage.getItem('buildQuery') || 'null') || initialBuildQuery)

    const setQueryAndStore0 = useLocalStorageSetter(setQuery, 'query', false)
    const setQueryAndStore = (q: string) => {
        cacheQueryParts(q)
        setQueryAndStore0(q)
    }

    const setBuildQueryAndStore = useLocalStorageSetter(setBuildQuery, 'buildQuery', true)

    // Returns whether the parquet is registered; the boolean matters because
    // callers can't observe the parquetLoaded state update within the same call
    const loadParquetFile = async (): Promise<boolean> => {
        if (!db) return false;
        if (parquetLoaded) return true;

        try {
            const parquetBlob: Blob = await getParquetFileFromIndexedDB(PARQUET_FILE);
            const arrayBuffer: ArrayBuffer = await parquetBlob.arrayBuffer();
            if (arrayBuffer.byteLength > 1000) {
                await db.registerFileBuffer(PARQUET_NAME, new Uint8Array(arrayBuffer));
                setParquetLoaded(true);
                return true
            }
        } catch {
            // pass
        }

        try {
            const parquetUrl = `/${PARQUET_FILE}`;
            const response = await fetch(parquetUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch Parquet file: ${response.statusText}`);
            }
            const parquetArrayBuffer = await response.arrayBuffer();
            const parquetBlob: Blob = new Blob([parquetArrayBuffer], {type: 'application/octet-stream'});
            await storeParquetInIndexedDB(PARQUET_FILE, parquetBlob);
            await deleteOtherParquetFiles(PARQUET_FILE);

            await db.registerFileBuffer(PARQUET_NAME, new Uint8Array(parquetArrayBuffer));
            setParquetLoaded(true);
            return true
        } catch (error) {
            console.error('Error loading Parquet file:', error);
            return false
        }
    };


    const fetchCachedData = async () => {
        setLoading(true);
        try {
            const response = await fetch('/default_query_cache.json');
            if (!response.ok) {
                throw new Error('Failed to fetch cached data');
            }
            const cachedRows = await response.json();
            const rows = cachedRows.map((row: any, index: number) => ({...row, id: index}));

            // Define columns based on the cached data
            if (rows.length > 0) {
                const firstRow = rows[0];
                const columnDefs: GridColDef[] = Object.keys(firstRow)
                    .filter(key => key !== 'id')
                    .map((key) => {
                        const colDef: GridColDef = {
                            field: key,
                            headerName: key,
                            width: 150,
                            sortable: true,
                            filterable: true,
                        };

                        if (key === 'titleId') {
                            colDef.renderCell = (params: GridCellParams) => (
                                <ImdbLink titleId={params.value as string} />
                            );
                        }

                        return colDef;
                    });
                setColumns(columnDefs);
            }

            setData(rows);
            setError("");
            setLastQuery(defaultQuery);
        } catch (error) {
            console.error('Error loading cached data:', error);
            setError(`${error}`);
        } finally {
            setLoading(false);
        }
    };

    const fetchData = async (customQuery: string) => {
        // Check if query matches default and we haven't loaded parquet yet
        if (customQuery.trim() === defaultQuery.trim() && !parquetLoaded) {
            await fetchCachedData();
            return;
        }

        // For custom queries, ensure parquet is loaded first
        if (!await loadParquetFile()) return;

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
            setLastQuery(customQuery);
        } catch (error) {
            console.error('Error querying Parquet file:', error);
            setError(`${error}`)
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (db) {
            fetchData(query);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db]);

    const handleQueryRun = () => {
        const queryToRun = querySelection || query;

        fetchData(queryToRun);
        setSearchParams({query: queryToRun});
    };

    const handleBuildQuery = () => {
        const cachedSelectColumns = getCachedSelectColumns() || '* EXCLUDE (titleType, primaryTitle, language)';
        const cachedOrderByClause = getCachedOrderByClause() || '(numVotes * averageRating + 700000) / (numVotes + 100000) DESC';
        const cachedLimitValue = getCachedLimitValue() || '100';

        const whereClause = formatQuery(buildQuery, {
            format: 'sql',
            parseNumbers: true,
            ruleProcessor: customRuleProcessor,
        })
            .replaceAll(' and ', ' and\n')
            .replaceAll(' or ', ' or\n');

        let newQuery = `SELECT ${cachedSelectColumns}
FROM '${PARQUET_NAME}'
WHERE
${whereClause}
`;

        if (cachedOrderByClause) {
            newQuery += `ORDER BY ${cachedOrderByClause}\n`;
        }

        if (cachedLimitValue) {
            newQuery += `LIMIT ${cachedLimitValue}\n`;
        }

        setQueryAndStore(newQuery.trim());
    };

    return (
        <div className="App">
            <div className="header">
                <span className='title'>IMDb SQL BEST MOVIE FINDER</span>
            </div>

            <div className="query">
                {showQuery ? <>

                    <Editor
                        value={query}
                        onChange={setQueryAndStore}
                        setSelection={setQuerySelection}
                    />
                </> : null
                }

            </div>

            <div className="builder">
                {showQuery ? <QueryBuilder fields={fields} query={buildQuery} onQueryChange={setBuildQueryAndStore} /> : null}
            </div>

            <div className="actions">
                <div className="button-wrapper">
                    {showQuery ? <>
                        <button type="button" onClick={handleQueryRun} disabled={
                            lastQuery == (querySelection || query) && error === ''}>Run</button>
                        <button type="button" onClick={handleBuildQuery}>Build</button>
                        <button type="button" onClick={() => {
                            setQueryAndStore(defaultQuery)
                            setBuildQueryAndStore(initialBuildQuery)
                            setError("")
                        }}>Reset</button>
                    </> : null}
                    <button type="button" onClick={() => setShowQuery(!showQuery)}>
                        {showQuery ? "Hide" : "Show Query"}
                    </button>
                </div>
            </div>


            <div className="table">
                {loading ? (
                    <p>Loading...</p>
                ) : (
                    !error ? (<DataGrid rows={data} columns={columns} initialState={{
                        pagination: {
                            paginationModel: {pageSize: 10, page: 0},
                        },
                        density: 'compact',
                    }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        slots={{toolbar: GridToolbar}}
                    />) : (<p className="error">{error}</p>)
                )}
            </div>

            <div className="footer">
                <span className="copyright">All movie data © copyright <a href="https://www.imdb.com">IMDb</a></span>
            </div>
        </div >
    );
};

export default App;
