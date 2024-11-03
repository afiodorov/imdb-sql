export const defaultQuery = `SELECT
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
LIMIT 100;`
