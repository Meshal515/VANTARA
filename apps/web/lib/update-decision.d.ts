export type UnitKind = 'chapter' | 'episode' | 'movie';
export interface Unit { season: number | null; number: number; publishedAt: number | null }
export interface Mark { season: number | null; number: number }
export declare const JUMP: Readonly<{ chapter: number; episode: number }>;
export declare function eventId(work: string, kind: UnitKind, season: number | null, number: number | null): string;
export declare function isAbove(u: Mark, m: Mark): boolean;
export declare function decide(report: { kind: UnitKind; units: Unit[] }, mark: Mark | null, now: number): { fresh: Unit[]; mark: Mark | null };
