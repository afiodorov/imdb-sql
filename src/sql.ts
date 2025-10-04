export const defaultQuery = `SELECT * EXCLUDE (titleType, primaryTitle, language)
FROM 'imdb04-10-2025.parquet'
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
