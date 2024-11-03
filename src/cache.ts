let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const dbName = 'ParquetFilesDB';
        const storeName = 'parquetFiles';
        const request: IDBOpenDBRequest = indexedDB.open(dbName, 2); // Incremented version to 2

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };

        request.onsuccess = (event: Event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            resolve(db);
        };

        request.onerror = (event: Event) => {
            reject(`IndexedDB error: ${(event.target as IDBOpenDBRequest).error}`);
        };
    });

    return dbPromise;
}

export const storeParquetInIndexedDB = async (
    fileName: string,
    parquetBlob: Blob
): Promise<void> => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction('parquetFiles', 'readwrite');
        const store = transaction.objectStore('parquetFiles');

        const putRequest = store.put(parquetBlob, fileName);

        await new Promise<void>((resolve, reject) => {
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = (event: Event) =>
                reject(`Error storing file in IndexedDB: ${(event.target as IDBRequest).error}`);
        });
    } catch (error) {
        throw new Error(`Failed to store Parquet file: ${error}`);
    }
};

export const getParquetFileFromIndexedDB = async (
    fileName: string
): Promise<Blob> => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction('parquetFiles', 'readonly');
        const store = transaction.objectStore('parquetFiles');

        const getRequest = store.get(fileName);

        return await new Promise<Blob>((resolve, reject) => {
            getRequest.onsuccess = () => {
                if (getRequest.result) {
                    resolve(getRequest.result as Blob);
                } else {
                    reject(`File ${fileName} not found in IndexedDB.`);
                }
            };
            getRequest.onerror = (event: Event) =>
                reject(`Error retrieving file from IndexedDB: ${(event.target as IDBRequest).error}`);
        });
    } catch (error) {
        throw new Error(`Failed to retrieve Parquet file: ${error}`);
    }
};
