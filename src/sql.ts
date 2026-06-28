// Stable logical name queries refer to; the versioned physical file is
// registered under this name so stored/shared queries survive dataset updates.
export const PARQUET_NAME = 'imdb.parquet';

// Fallback physical filename, used only if version.json can't be fetched
// (e.g. a stale CDN edge or offline first load).
export const FALLBACK_PARQUET_FILE = 'imdb12-06-2026.parquet';

// The current physical parquet filename is discovered at runtime from
// public/version.json (rewritten by the data pipeline on each dataset update),
// so a new dataset ships without an app rebuild. The dated name still serves as
// the fetch URL and IndexedDB cache key, busting client caches automatically.
// Cached as a single in-flight promise so concurrent callers share one fetch.
let parquetFilePromise: Promise<string> | null = null;
export function getParquetFile(): Promise<string> {
    if (!parquetFilePromise) {
        parquetFilePromise = fetch(`/version.json?t=${Date.now()}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no version.json'))))
            .then((j) => (j.parquet as string) || FALLBACK_PARQUET_FILE)
            .catch(() => FALLBACK_PARQUET_FILE);
    }
    return parquetFilePromise;
}

// Rewrite queries saved before the stable name existed (dated filenames).
export function migrateQuery(q: string | null): string | null {
    return q && q.replace(/imdb\d{2}-\d{2}-\d{4}\.parquet/g, PARQUET_NAME);
}

export const defaultQuery = `SELECT * EXCLUDE (titleType, primaryTitle, language)
FROM '${PARQUET_NAME}'
WHERE
(region is null and
numVotes >= 100000 and
titleType = 'movie' and
startYear >= 2015)
ORDER BY (numVotes * averageRating + 700000) / (numVotes + 100000) DESC
LIMIT 100`;



export function cacheQueryParts(query: string): void {
    // Cache SELECT columns
    const selectRegex = /^SELECT\s+([\s\S]+?)\s+FROM\b/i;
    const selectMatch = query.match(selectRegex);
    if (selectMatch) {
        const selectColumns = selectMatch[1].trim();
        localStorage.setItem('selectColumns', selectColumns);
    }

    // Cache ORDER BY and LIMIT
    // Updated regex
    const orderByRegex = /ORDER\s+BY\s+([\s\S]*?)(?=\s+LIMIT\s+\d+|\s*$)/i;
    const orderByMatch = query.match(orderByRegex);
    if (orderByMatch) {
        const orderByClause = orderByMatch[1].trim();
        localStorage.setItem('orderByClause', orderByClause);
    } else {
        // If no ORDER BY found, remove stored value
        localStorage.removeItem('orderByClause');
    }

    // Cache LIMIT
    const limitRegex = /\bLIMIT\s+(\d+)\s*$/i;
    const limitMatch = query.match(limitRegex);
    if (limitMatch) {
        const limitValue = limitMatch[1].trim();
        localStorage.setItem('limitValue', limitValue);
    } else {
        // If no LIMIT found, remove stored value
        localStorage.removeItem('limitValue');
    }
}

export function getCachedSelectColumns(): string | null {
    return localStorage.getItem('selectColumns');
}

export function getCachedOrderByClause(): string | null {
    return localStorage.getItem('orderByClause');
}

export function getCachedLimitValue(): string | null {
    return localStorage.getItem('limitValue');
}
