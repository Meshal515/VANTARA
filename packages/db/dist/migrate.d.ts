export interface MigrateResult {
    applied: string[];
    skipped: string[];
}
export declare function migrate(connectionString: string, opts?: {
    dryRun?: boolean;
    log?: (msg: string) => void;
}): Promise<MigrateResult>;
//# sourceMappingURL=migrate.d.ts.map