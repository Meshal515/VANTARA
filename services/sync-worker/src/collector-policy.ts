import type { Env } from './types.ts';

export const COLLECTOR_MODES = ['hybrid', 'manga-local', 'exclusive'] as const;
export type CollectorMode = typeof COLLECTOR_MODES[number];
export type CollectorJob = 'teamx' | 'mangadex-ar' | 'manga-sites' | 'anilist' | 'cinemeta-series' | 'cinemeta-movies';
export function isCollectorMode(value: unknown): value is CollectorMode {
  return COLLECTOR_MODES.some(mode => mode === value);
}
export async function collectorPolicy(env: Env): Promise<{ mode: CollectorMode; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT mode, updated_at FROM collector_policy WHERE id = 1').first<{ mode: unknown; updated_at: number }>();
  if (!row || !isCollectorMode(row.mode)) throw new Error('collector_policy_unavailable');
  return { mode: row.mode, updatedAt: row.updated_at };
}
export async function setCollectorPolicy(env: Env, mode: CollectorMode, now: number) {
  await env.DB.prepare('UPDATE collector_policy SET mode = ?, updated_at = ? WHERE id = 1').bind(mode, now).run();
  return collectorPolicy(env);
}
export function plannedCollectors(mode: CollectorMode, now: number, scheduled = true): CollectorJob[] {
  if (mode === 'exclusive') return [];
  const minute = Math.floor(now / 60_000);
  const jobs: CollectorJob[] = [];
  if (mode === 'hybrid') {
    if (!scheduled || minute % 4 === 0) jobs.push('teamx', 'mangadex-ar');
    if (!scheduled || minute % 2 === 1) jobs.push('manga-sites');
  }
  // Offset independent jobs, so the expensive global collectors do not collide.
  if (!scheduled || minute % 30 === 2) jobs.push('anilist');
  if (!scheduled || minute % 120 === 6) jobs.push('cinemeta-series');
  if (!scheduled || minute % 360 === 10) jobs.push('cinemeta-movies');
  return jobs;
}
