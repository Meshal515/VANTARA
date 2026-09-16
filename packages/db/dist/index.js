import pg from 'pg';
let pool;
export function createPool(config) {
    return new pg.Pool({
        connectionString: config.connectionString,
        max: config.max ?? 10,
        // الـworker والـapi كلاهما يتكلم مع نفس القاعدة؛ اتصال معلّق يخنق pg-boss
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });
}
/** المسبح المشترك للعملية. يُهيّأ مرة واحدة عند الإقلاع. */
export function initPool(config) {
    pool ??= createPool(config);
    return pool;
}
export function getPool() {
    if (!pool)
        throw new Error('db pool not initialised — call initPool() at startup');
    return pool;
}
export async function closePool() {
    await pool?.end();
    pool = undefined;
}
export async function query(text, values) {
    const result = await getPool().query(text, values);
    return result.rows;
}
/** صف واحد أو undefined. يرمي إذا رجع أكثر من صف — استعلام هوية يجب أن يكون هوية. */
export async function queryOne(text, values) {
    const rows = await query(text, values);
    if (rows.length > 1) {
        throw new Error(`queryOne matched ${rows.length} rows`);
    }
    return rows[0];
}
export async function transaction(fn) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=index.js.map