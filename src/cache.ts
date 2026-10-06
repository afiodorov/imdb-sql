// Earlier versions downloaded the whole parquet into IndexedDB; it's now read
// over HTTP range requests instead. Free the ~100MB returning visitors still
// have stored. Best-effort: deleting a database that doesn't exist is a no-op.
export const dropLegacyParquetCache = (): void => {
    try {
        indexedDB.deleteDatabase('ParquetFilesDB');
    } catch (error) {
        console.warn(`Failed to drop legacy parquet cache: ${error}`);
    }
};
