export const defaultQuery = `SELECT * EXCLUDE (titleType, primaryTitle, language)
FROM 'imdb01-11-2024.parquet'
WHERE
(region is null and
numVotes >= 100000 and
titleType = 'movie' and
startYear >= 2015)
ORDER BY
  averageRating DESC
LIMIT 100`;


export function cacheSelectColumns(query: string): void {
    const selectRegex = /^SELECT\s+([\s\S]+?)\s+FROM\b/i;
    const match = query.match(selectRegex);
    if (match) {
        const selectColumns = match[1].trim();
        localStorage.setItem('selectColumns', selectColumns);
    }
}

export function getCachedSelectColumns(): string | null {
    return localStorage.getItem('selectColumns');
}
