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
