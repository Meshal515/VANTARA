import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '@vantara/db';
import { requireSession, sessionOf, type AppContext } from '../lib/context.ts';

const patchBody = z.object({
  displayName: z.string().min(1).max(60).nullish(),
  bio: z.string().max(280).nullish(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accent must be #rrggbb')
    .nullish(),
  theme: z.enum(['default', 'midnight', 'paper']).optional(),
  /** Favorite 4: أربعة على الأكثر، بلا تكرار، بالترتيب الذي يختاره المستخدم. */
  favoriteRefs: z.array(z.string().min(1).max(200)).max(4).optional(),
});

interface ProfileRow {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  banner_path: string | null;
  accent: string | null;
  theme: string;
  favorite_refs: string[];
}

function present(row: ProfileRow) {
  return {
    username: row.username,
    displayName: row.display_name ?? row.username,
    bio: row.bio,
    avatar: row.avatar_path,
    banner: row.banner_path,
    accent: row.accent,
    theme: row.theme,
    favoriteRefs: row.favorite_refs,
  };
}

const SELECT_PROFILE = `
  SELECT u.username, p.display_name, p.bio, p.avatar_path, p.banner_path,
         p.accent, p.theme, coalesce(p.favorite_refs, '{}') AS favorite_refs
    FROM vantara_users u
    LEFT JOIN vantara_profiles p USING (uchiyomi_user_id)`;

export async function profileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/profiles/:username', { preHandler: requireSession(ctx) }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const row = await queryOne<ProfileRow>(`${SELECT_PROFILE} WHERE u.username = $1`, [username]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.send(present(row));
  });

  app.get('/v1/profiles', { preHandler: requireSession(ctx) }, async (_request, reply) => {
    const rows = await query<ProfileRow>(`${SELECT_PROFILE} ORDER BY u.first_seen_at`);
    return reply.send({ content: rows.map(present) });
  });

  /**
   * تعديل بروفايل المستخدم نفسه فقط. لا مسار لتعديل بروفايل غيره، ولا للمدير:
   * البروفايل تعبير شخصي، ولا حاجة إدارية لتحريره.
   */
  app.patch('/v1/profiles/me', { preHandler: requireSession(ctx) }, async (request, reply) => {
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', detail: parsed.error.issues });
    }

    const patch = parsed.data;
    if (patch.favoriteRefs) {
      const unique = new Set(patch.favoriteRefs);
      if (unique.size !== patch.favoriteRefs.length) {
        return reply.code(400).send({ error: 'duplicate_favorites' });
      }
    }

    const { userId } = sessionOf(request);

    // COALESCE مع علم صريح لكل حقل: يفرّق بين "لم يُرسل" و"أُرسل null" (مسح)
    const row = await queryOne<ProfileRow & { uchiyomi_user_id: string }>(
      `UPDATE vantara_profiles SET
         display_name  = CASE WHEN $2 THEN $3  ELSE display_name  END,
         bio           = CASE WHEN $4 THEN $5  ELSE bio           END,
         accent        = CASE WHEN $6 THEN $7  ELSE accent        END,
         theme         = coalesce($8, theme),
         favorite_refs = coalesce($9, favorite_refs),
         updated_at    = now()
       WHERE uchiyomi_user_id = $1
       RETURNING uchiyomi_user_id, display_name, bio, avatar_path, banner_path,
                 accent, theme, favorite_refs,
                 (SELECT username FROM vantara_users WHERE uchiyomi_user_id = $1) AS username`,
      [
        userId,
        'displayName' in patch,
        patch.displayName ?? null,
        'bio' in patch,
        patch.bio ?? null,
        'accent' in patch,
        patch.accent ?? null,
        patch.theme ?? null,
        patch.favoriteRefs ?? null,
      ],
    );

    if (!row) return reply.code(404).send({ error: 'not_found' });
    return reply.send(present(row));
  });

  /**
   * بوابة محتوى البالغين.
   *
   * كلمة المرور الحقيقية تُتحقق عند Uchiyomi. عبارة التأكيد ليست أمانًا —
   * التحقق من الهوية هو كلمة المرور، والعبارة إقرار واعٍ فقط.
   */
  app.put('/v1/profiles/me/adult', { preHandler: requireSession(ctx) }, async (request, reply) => {
    const parsed = z
      .object({ enabled: z.boolean(), password: z.string().min(1).max(512) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const session = sessionOf(request);
    try {
      await ctx.uchiyomi.login(session.username, parsed.data.password);
    } catch {
      return reply.code(401).send({ error: 'password_required' });
    }

    const row = await queryOne<{ adult_enabled: boolean; adult_confirmed_at: Date | null }>(
      `UPDATE vantara_user_gates
          SET adult_enabled = $2,
              adult_confirmed_at = CASE WHEN $2 THEN now() ELSE NULL END
        WHERE uchiyomi_user_id = $1
        RETURNING adult_enabled, adult_confirmed_at`,
      [session.userId, parsed.data.enabled],
    );

    await query(
      `INSERT INTO vantara_audit_log (actor_id, action, target, detail)
       VALUES ($1, 'adult_gate.set', $2, $3)`,
      [session.userId, session.username, JSON.stringify({ enabled: parsed.data.enabled })],
    );

    return reply.send({
      adultEnabled: row?.adult_enabled ?? false,
      confirmedAt: row?.adult_confirmed_at ?? null,
    });
  });
}
