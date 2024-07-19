import { getSession } from "../../model/session.js";

class ICache {
    async get() { throw new Error("NOT_IMPLEMENTED"); }

    async store() { throw new Error("NOT_IMPLEMENTED"); }

    async remove() { throw new Error("NOT_IMPLEMENTED"); }

    async update(path, fn) {
        const data = await this.get(path);
        return this.store(path, fn(data || {}));
    }

    async destroy() { throw new Error("NOT_IMPLEMENTED"); }
}

class InMemoryCache extends ICache {
    constructor() {
        super();
        this.data = {};
    }

    async get(path) {
        return this.data[this._key(path)] || null;
    }

    async store(path, obj) {
        this.data[this._key(path)] = obj;
    }

    async remove(path, exact = true) {
        if (!path) {
            this.data = {};
            return;
        }
        const key = this._key(path);
        if (exact) {
            delete this.data[key];
            return;
        }
        for (const k in this.data) {
            if (k.indexOf(key) === 0) {
                delete this.data[k];
            }
        }
    }

    async destroy() {
        this.data = {};
    }

    _key(path) {
        return currentBackend() + "::" + currentShare() + "::" + path;
    }
};

class IndexDBCache extends ICache {
    DB_VERSION = 5;
    FILE_PATH = "file_path";
    db = null;

    constructor() {
        super();

        const request = indexedDB.open("filestash", this.DB_VERSION);
        request.onupgradeneeded = this._migration.bind(this);

        this.db = new Promise((done, err) => {
            request.onsuccess = (e) => {
                done(e.target.result);
            };
            request.onerror = () => err(new Error("INDEXEDDB_NOT_SUPPORTED"));
        });
    }

    async get(path) {
        const db = await this.db;
        const tx = db.transaction(this.FILE_PATH, "readonly");
        const store = tx.objectStore(this.FILE_PATH);
        const query = store.get(this._key(path));
        return await new Promise((done) => {
            query.onsuccess = (e) => done(query.result || null);
            query.onerror = () => done(null);
        });
    }

    async store(path, value = {}) {
        const db = await this.db;
        const tx = db.transaction(this.FILE_PATH, "readwrite");
        const store = tx.objectStore(this.FILE_PATH);

        const request = store.put({
            ...value,
            backend: currentBackend(),
            share: currentShare(),
            path,
        });
        return await new Promise((done, error) => {
            done(value);
            request.onsuccess = () => done(value);
            request.onerror = error;
        });
    }

    async remove(path, exact = true) {
        const db = await this.db;
        const tx = db.transaction(this.FILE_PATH, "readwrite");
        const store = tx.objectStore(this.FILE_PATH);
        const key = this._key(path);

        if (exact !== true) {
            const request = store.openCursor(IDBKeyRange.bound(
                [key[0], key[1], key[2]],
                [key[0], key[1], key[2]+"\u{FFFF}".repeat(5000)],
                true, true,
            ));
            await new Promise((done, err) => {
                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete([key[0], key[1], cursor.value.path]);
                        cursor.continue();
                        return;
                    }
                    done(null);
                };
                request.onerror = err;
            });
        }

        const req = store.delete(key);
        return await new Promise((done, err) => {
            req.onsuccess = () => done(null);
            req.onerror = err;
        });
    }

    _key(path) {
        return [currentBackend(), currentShare(), path];
    }

    _migration(event) {
        const db = event.target.result;
        if (event.oldVersion === 1) {
            // we've change the schema on v2 adding an index, let's flush
            // to make sure everything will be fine
            db.deleteObjectStore("file_path");
            db.deleteObjectStore("file_content");
        } else if (event.oldVersion === 2) {
            // we've change the primary key to be a (path,share)
            db.deleteObjectStore("file_path");
            db.deleteObjectStore("file_content");
        } else if (event.oldVersion === 3) {
            // we've added a FILE_TAG to store tag related data and update
            // keyPath to have "backend"
            db.deleteObjectStore("file_path");
            db.deleteObjectStore("file_content");
        } else if (event.oldVersion === 4) {
            // we got rid of the idea of offline first file manager so let's get rid of
            // FILE_CONTENT and FILE_TAG
            db.deleteObjectStore("file_path");
            db.deleteObjectStore("file_content");
            db.deleteObjectStore("file_tag");
        }
        const store = db.createObjectStore(this.FILE_PATH, { keyPath: ["backend", "share", "path"] });
        store.createIndex("idx_path", ["backend", "share", "path"], { unique: true });
    }
}

let cache = null;

export async function clearCache(path) { // TODO: remove useless function
    await cache.remove(path, false);
}

export async function init() {
    const setup_cache = () => {
        cache = new InMemoryCache();
        if (!("indexedDB" in window)) return;

        cache = new IndexDBCache();
        return cache.db.catch((err) => {
            if (err.message === "INDEXEDDB_NOT_SUPPORTED") {
                // Firefox in private mode act like if it supports indexedDB but
                // is throwing that string as an error if you try to use it ...
                // so we fallback with our basic ram cache
                cache = new InMemoryCache();
                return;
            }
            throw err;
        });
    };
    const setup_session = async() => {
        if (!backendID) {
            try {
                const session = await getSession().toPromise();
                backendID = session.backendID;
            } catch (err) {}
        }
    };

    return Promise.all([setup_cache(), setup_session()]);
}

export default function() {
    return cache;
};

let backendID = "";
export function currentBackend() {
    return backendID;
}

export function currentShare() {
    return new window.URL(location.href).searchParams.get("share") || "";
}
