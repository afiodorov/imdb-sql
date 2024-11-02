import React, {createContext, useContext, useEffect, useState} from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

type DuckDBContextType = {
    db: duckdb.AsyncDuckDB | null;
};

const DuckDBContext = createContext<DuckDBContextType>({db: null});

export const useDuckDB = () => useContext(DuckDBContext);

export const DuckDBProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
    const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);

    useEffect(() => {
        let isMounted = true;

        (async () => {
            try {
                const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
                    mvp: {
                        mainModule: duckdb_wasm,
                        mainWorker: mvp_worker,
                    },
                    eh: {
                        mainModule: duckdb_wasm_eh,
                        mainWorker: eh_worker,
                    },
                };

                const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

                const worker = new Worker(bundle.mainWorker!, {type: 'module'});
                const logger = new duckdb.ConsoleLogger();
                const db = new duckdb.AsyncDuckDB(logger, worker);
                await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

                if (isMounted) {
                    setDb(db);
                }
            } catch (error) {
                console.error('Error initializing DuckDB:', error);
            }
        })();

        return () => {
            isMounted = false;
        };
    }, []);

    return <DuckDBContext.Provider value={{db}}>{children}</DuckDBContext.Provider>;
};
