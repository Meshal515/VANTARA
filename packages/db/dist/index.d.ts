import pg from 'pg';
export type { PoolClient, QueryResult } from 'pg';
export interface DbConfig {
    connectionString: string;
    max?: number;
}
export declare function createPool(config: DbConfig): pg.Pool;
/** المسبح المشترك للعملية. يُهيّأ مرة واحدة عند الإقلاع. */
export declare function initPool(config: DbConfig): pg.Pool;
export declare function getPool(): pg.Pool;
export declare function closePool(): Promise<void>;
export declare function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<T[]>;
/** صف واحد أو undefined. يرمي إذا رجع أكثر من صف — استعلام هوية يجب أن يكون هوية. */
export declare function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<T | undefined>;
export declare function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
//# sourceMappingURL=index.d.ts.map