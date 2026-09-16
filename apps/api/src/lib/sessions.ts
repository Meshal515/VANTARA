import { query, queryOne } from '@vantara/db';
import type { UchiyomiClient } from '@vantara/uchiyomi';
import { decrypt, encrypt, newSessionId } from './crypto.ts';

export const SESSION_COOKIE = 'vantara_session';

export interface Session {
  id: string;
  userId: string;
  username: string;
  /** توكن Uchiyomi بعد فكّ التشفير. لا يُسجَّل ولا يُعاد إلى العميل. */
  token: string;
}

interface SessionRow {
  id: string;
  uchiyomi_user_id: string;
  token_encrypted: string;
  username: string;
}

export interface SessionStoreOptions {
  key: Buffer;
  ttlDays: number;
  uchiyomi: UchiyomiClient;
}

export class SessionStore {
  // مكتوب صريحًا لا كـparameter property: `node --experimental-strip-types`
  // لا يدعمها، وسكربت التطوير يشغّل الـTypeScript مباشرة.
  readonly #options: SessionStoreOptions;

  constructor(options: SessionStoreOptions) {
    this.#options = options;
  }

  /**
   * تسجيل دخول: Uchiyomi يتحقق من كلمة المرور، ثم نصك توكنًا طويل العمر باسم
   * المستخدم ونخزّنه مشفّرًا. VANTARA لا يرى كلمة المرور بعد هذه اللحظة ولا
   * يخزّنها، ولا يحتاج دورة refresh.
   */
  async login(username: string, password: string, device?: string): Promise<Session> {
    const uchiyomi = this.#options.uchiyomi;
    const result = await uchiyomi.login(username, password);

    const expiresInDays = this.#options.ttlDays;
    const minted = await uchiyomi.mintToken(result.accessToken, {
      name: `vantara${device ? ` (${device})` : ''}`,
      scopes: ['read', 'write'],
      expiresInDays,
    });

    // الظل الخفيف للمستخدم: اسمه فقط، لتعليق بياناتنا الاجتماعية على معرّفه
    await query(
      `INSERT INTO vantara_users (uchiyomi_user_id, username)
            VALUES ($1, $2)
       ON CONFLICT (uchiyomi_user_id)
       DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()`,
      [result.user.id, result.user.username],
    );
    await query(
      `INSERT INTO vantara_profiles (uchiyomi_user_id, display_name)
            VALUES ($1, $2)
       ON CONFLICT (uchiyomi_user_id) DO NOTHING`,
      [result.user.id, result.user.displayName],
    );
    await query(
      `INSERT INTO vantara_user_gates (uchiyomi_user_id) VALUES ($1)
       ON CONFLICT (uchiyomi_user_id) DO NOTHING`,
      [result.user.id],
    );

    const id = newSessionId();
    await query(
      `INSERT INTO vantara_sessions
         (id, uchiyomi_user_id, token_encrypted, token_id, device, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`,
      [
        id,
        result.user.id,
        encrypt(minted.token, this.#options.key),
        minted.id,
        device ?? null,
        String(expiresInDays),
      ],
    );

    return { id, userId: result.user.id, username: result.user.username, token: minted.token };
  }

  /** يُرجع undefined للجلسة المنتهية أو المُبطلة أو غير الموجودة — بلا تمييز. */
  async resolve(sessionId: string): Promise<Session | undefined> {
    const row = await queryOne<SessionRow>(
      `SELECT s.id, s.uchiyomi_user_id, s.token_encrypted, u.username
         FROM vantara_sessions s
         JOIN vantara_users u USING (uchiyomi_user_id)
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [sessionId],
    );
    if (!row) return undefined;

    let token: string;
    try {
      token = decrypt(row.token_encrypted, this.#options.key);
    } catch {
      // مفتاح مختلف أو صف معدَّل: أبطل الجلسة بدل محاولة استخدامها
      await this.revoke(sessionId);
      return undefined;
    }

    return { id: row.id, userId: row.uchiyomi_user_id, username: row.username, token };
  }

  /** لمسة خفيفة لآخر استخدام. لا تُنتظر في مسار الطلب. */
  async touch(sessionId: string): Promise<void> {
    await query(
      `UPDATE vantara_sessions SET last_used_at = now()
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await query(
      `UPDATE vantara_sessions SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async revokeAllFor(userId: string): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE vantara_sessions SET revoked_at = now()
        WHERE uchiyomi_user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [userId],
    );
    return rows.length;
  }

  /** تنظيف دوري. الجلسة المنتهية تبقى صفًا ميتًا حتى تُحذف. */
  async purgeExpired(): Promise<number> {
    const rows = await query<{ id: string }>(
      `DELETE FROM vantara_sessions
        WHERE expires_at < now() - interval '7 days'
           OR revoked_at < now() - interval '7 days'
        RETURNING id`,
    );
    return rows.length;
  }
}
