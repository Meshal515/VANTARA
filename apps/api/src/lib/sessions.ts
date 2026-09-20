import { query, queryOne, transaction } from '@vantara/db';
import { identityIdForUsername } from '@vantara/domain';
import { UchiyomiError, type UchiyomiClient } from '@vantara/uchiyomi';
import { decrypt, encrypt, newSessionId } from './crypto.ts';

export const SESSION_COOKIE = 'vantara_session';

const IDENTITY_RENEW_WINDOW_MS = 7 * 86_400_000;

export class IdentityRelinkRequiredError extends Error {
  constructor() {
    super('content_relink_required');
    this.name = 'IdentityRelinkRequiredError';
  }
}

export interface Session {
  id: string;
  /** هوية VANTARA الموحدة، عند الدخول عبر access token v2. */
  identityId?: string;
  /** معرّف Uchiyomi الداخلي؛ Uchiyomi يبقى مالك المحتوى والمكتبة والتقدم. */
  userId: string;
  username: string;
  /** توكن Uchiyomi بعد فكّ التشفير. لا يُسجَّل ولا يُعاد إلى العميل. */
  token: string;
  /** معرّف التوكن الأعلى، مطلوب لإبطاله عند logout. */
  tokenId?: string;
}

interface SessionRow {
  id: string;
  uchiyomi_user_id: string;
  token_encrypted: string;
  token_id: string | null;
  username: string;
}

interface IdentityLinkRow {
  vantara_identity_id: string;
  uchiyomi_user_id: string;
  token_encrypted: string;
  token_id: string | null;
  token_expires_at: string | Date | null;
  token_expiry_authoritative: boolean;
  username: string;
}

export interface SessionStoreOptions {
  key: Buffer;
  ttlDays: number;
  uchiyomi: UchiyomiClient;
}

export class SessionStore {
  readonly #options: SessionStoreOptions;

  constructor(options: SessionStoreOptions) {
    this.#options = options;
  }


  async #finishMintAttempt(name: string, tokenId: string | null): Promise<void> {
    await query(
      `UPDATE vantara_token_mint_attempts
          SET token_id = COALESCE($2, token_id), resolved_at = now()
        WHERE name = $1 AND resolved_at IS NULL`,
      [name, tokenId],
    );
  }

  async #reconcilePendingMintAttempts(
    authToken: string,
    userId: string,
    onlyName?: string,
  ): Promise<void> {
    const pending = await query<{ name: string }>(
      `SELECT name
         FROM vantara_token_mint_attempts
        WHERE uchiyomi_user_id = $1
          AND resolved_at IS NULL
          AND ($2::text IS NULL OR name = $2)
        ORDER BY created_at
        LIMIT 100`,
      [userId, onlyName ?? null],
    );
    if (pending.length === 0) return;

    // A durable attempt is cleanup intent, not permission to revoke blindly.
    // Protect credentials already adopted by a live identity or cookie session.
    const protectedRows = await query<{ token_id: string }>(
      `SELECT token_id
         FROM vantara_identity_links
        WHERE revoked_at IS NULL AND token_id IS NOT NULL
       UNION
       SELECT token_id
         FROM vantara_sessions
        WHERE revoked_at IS NULL AND expires_at > now() AND token_id IS NOT NULL`,
    );
    const protectedIds = new Set(protectedRows.map((row) => row.token_id));
    const tokens = await this.#options.uchiyomi.listTokens(authToken);

    for (const attempt of pending) {
      const matches = tokens.filter((token) => token.name === attempt.name);
      for (const token of matches) {
        if (!protectedIds.has(token.id)) {
          await this.#options.uchiyomi.revokeToken(authToken, token.id);
        }
      }
      await this.#finishMintAttempt(attempt.name, matches[0]?.id ?? null);
    }
  }

  async #authoritativeTokenExpiry(authToken: string, tokenId: string): Promise<string> {
    const tokens = await this.#options.uchiyomi.listTokens(authToken);
    const metadata = tokens.find((token) => token.id === tokenId);
    if (!metadata || metadata.expired || !metadata.expiresAt) {
      throw new Error('upstream_token_metadata_unavailable');
    }

    const expiresAt = Date.parse(metadata.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('upstream_token_expired');
    }
    return new Date(expiresAt).toISOString();
  }

  async #mintTrackedToken(
    authToken: string,
    userId: string,
    name: string,
  ): Promise<{ id: string; token: string; expiresAt: string; attemptName: string }> {
    // The intent is durable BEFORE the non-idempotent upstream POST. If both the
    // create response and immediate reconciliation are lost, a later valid
    // credential can still find this exact name and revoke it.
    await query(
      `INSERT INTO vantara_token_mint_attempts (name, uchiyomi_user_id)
       VALUES ($1, $2)`,
      [name, userId],
    );

    let minted: { id: string; token: string };
    try {
      minted = await this.#options.uchiyomi.mintToken(authToken, {
        name,
        scopes: ['read', 'write'],
        expiresInDays: this.#options.ttlDays,
        reconcileAmbiguousFailure: true,
      });
    } catch (createError) {
      const definitelyRejected =
        createError instanceof UchiyomiError &&
        createError.path === '/api/tokens' &&
        createError.status >= 400 &&
        createError.status < 500;

      if (definitelyRejected) {
        await this.#finishMintAttempt(name, null);
        throw createError;
      }

      try {
        await this.#reconcilePendingMintAttempts(authToken, userId, name);
      } catch (reconcileError) {
        throw new AggregateError(
          [createError, reconcileError],
          'ambiguous upstream token mint remains durably tracked',
        );
      }
      throw createError;
    }

    let expiresAt: string;
    try {
      expiresAt = await this.#authoritativeTokenExpiry(authToken, minted.id);
    } catch (metadataError) {
      try {
        // The newly minted credential has write scope and the repository's live
        // probe already verifies self-revocation.
        await this.#options.uchiyomi.revokeToken(minted.token, minted.id);
        await this.#finishMintAttempt(name, minted.id);
      } catch (cleanupError) {
        throw new AggregateError(
          [metadataError, cleanupError],
          'minted token metadata could not be verified and cleanup failed',
        );
      }
      throw metadataError;
    }

    return { ...minted, expiresAt, attemptName: name };
  }

  /**
   * Legacy/owner linking path. كلمة المرور لا تدخل شاشة الحساب اليومية. عند
   * نجاح الربط نحفظ توكن Uchiyomi مشفّرًا تحت VANTARA identity الثابتة حتى
   * يستطيع access token v2 فتح المحتوى من دون Login ثانٍ.
   */
  async login(username: string, password: string, device?: string): Promise<Session> {
    const uchiyomi = this.#options.uchiyomi;
    const result = await uchiyomi.login(username, password);

    const expiresInDays = this.#options.ttlDays;
    const id = newSessionId();
    const tokenName = `vantara-${id}`;
    const minted = await this.#mintTrackedToken(
      result.accessToken,
      result.user.id,
      tokenName,
    );

    const encrypted = encrypt(minted.token, this.#options.key);
    const identityId = identityIdForUsername(result.user.username);

    try {
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO vantara_users (uchiyomi_user_id, username)
                VALUES ($1, $2)
           ON CONFLICT (uchiyomi_user_id)
           DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()`,
          [result.user.id, result.user.username],
        );

        if (identityId) {
          await client.query(
            `INSERT INTO vantara_identity_links
               (vantara_identity_id, uchiyomi_user_id, token_encrypted, token_id,
                token_expires_at, token_expiry_authoritative, revoked_at)
             VALUES ($1, $2, $3, $4, $5, true, NULL)
             ON CONFLICT (vantara_identity_id) DO UPDATE SET
               uchiyomi_user_id = EXCLUDED.uchiyomi_user_id,
               token_encrypted = EXCLUDED.token_encrypted,
               token_id = EXCLUDED.token_id,
               token_expires_at = EXCLUDED.token_expires_at,
               token_expiry_authoritative = true,
               linked_at = now(),
               last_used_at = now(),
               revoked_at = NULL`,
            [identityId, result.user.id, encrypted, minted.id, minted.expiresAt],
          );
        }

        await client.query(
          `INSERT INTO vantara_sessions
             (id, uchiyomi_user_id, token_encrypted, token_id, device, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`,
          [id, result.user.id, encrypted, minted.id, device ?? null, String(expiresInDays)],
        );

        await client.query(
          `UPDATE vantara_token_mint_attempts
              SET token_id = $2, resolved_at = now()
            WHERE name = $1 AND resolved_at IS NULL`,
          [minted.attemptName, minted.id],
        );
      });
    } catch (dbError) {
      try {
        await uchiyomi.revokeToken(minted.token, minted.id);
        await this.#finishMintAttempt(minted.attemptName, minted.id);
      } catch (cleanupError) {
        throw new AggregateError(
          [dbError, cleanupError],
          'login persistence and cleanup both failed',
        );
      }
      throw dbError;
    }

    // A previous ambiguous attempt may have survived an upstream outage.
    // It is already durable, so failure to sweep it must not turn this newly
    // committed login into a false failure.
    void this.#reconcilePendingMintAttempts(result.accessToken, result.user.id).catch(() => {});

    return {
      id,
      ...(identityId ? { identityId } : {}),
      userId: result.user.id,
      username: result.user.username,
      token: minted.token,
      tokenId: minted.id,
    };
  }

  /** يُرجع undefined للجلسة المنتهية أو المُبطلة أو غير الموجودة — بلا تمييز. */
  async resolve(sessionId: string): Promise<Session | undefined> {
    const row = await queryOne<SessionRow>(
      `SELECT s.id, s.uchiyomi_user_id, s.token_encrypted, s.token_id, u.username
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
      await this.revoke(sessionId);
      return undefined;
    }

    return {
      id: row.id,
      userId: row.uchiyomi_user_id,
      username: row.username,
      token,
      ...(row.token_id ? { tokenId: row.token_id } : {}),
    };
  }

  /**
   * يحول VANTARA identity الموقعة إلى جلسة محتوى؛ التوكن الحقيقي يبقى على
   * الخادم. deviceId يدخل id التشخيصي فقط، والـWorker هو من يثبت الجهاز.
   */
  async resolveIdentity(identityId: string, deviceId: string): Promise<Session | undefined> {
    const row = await queryOne<IdentityLinkRow>(
      `SELECT l.vantara_identity_id, l.uchiyomi_user_id, l.token_encrypted, l.token_id,
              l.token_expires_at, l.token_expiry_authoritative, u.username
         FROM vantara_identity_links l
         JOIN vantara_users u USING (uchiyomi_user_id)
        WHERE l.vantara_identity_id = $1 AND l.revoked_at IS NULL`,
      [identityId],
    );
    if (!row) return undefined;

    let token: string;
    try {
      token = decrypt(row.token_encrypted, this.#options.key);
    } catch {
      await query(
        `UPDATE vantara_identity_links SET revoked_at = now()
          WHERE vantara_identity_id = $1 AND revoked_at IS NULL`,
        [identityId],
      );
      return undefined;
    }

    let expiresAt = row.token_expires_at
      ? new Date(row.token_expires_at).getTime()
      : Number.NaN;

    // 0007 only knew linked_at + historical TTL. Existing links reconcile once
    // with the metadata owner before that estimate is trusted.
    if (!row.token_expiry_authoritative || !Number.isFinite(expiresAt)) {
      try {
        if (!row.token_id) throw new IdentityRelinkRequiredError();
        const exactExpiry = await this.#authoritativeTokenExpiry(token, row.token_id);
        expiresAt = Date.parse(exactExpiry);
        await query(
          `UPDATE vantara_identity_links
              SET token_expires_at = $2,
                  token_expiry_authoritative = true,
                  last_used_at = now()
            WHERE vantara_identity_id = $1
              AND token_id IS NOT DISTINCT FROM $3
              AND revoked_at IS NULL`,
          [identityId, exactExpiry, row.token_id],
        );
      } catch (error) {
        const relink =
          error instanceof IdentityRelinkRequiredError ||
          (error instanceof UchiyomiError && (error.status === 401 || error.status === 403)) ||
          (error instanceof Error &&
            /upstream_token_(?:metadata_unavailable|expired)/.test(error.message));
        if (!relink) throw error;

        await query(
          `UPDATE vantara_identity_links SET revoked_at = now()
            WHERE vantara_identity_id = $1 AND revoked_at IS NULL`,
          [identityId],
        );
        throw new IdentityRelinkRequiredError();
      }
    }

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await query(
        `UPDATE vantara_identity_links SET revoked_at = now()
          WHERE vantara_identity_id = $1 AND revoked_at IS NULL`,
        [identityId],
      );
      throw new IdentityRelinkRequiredError();
    }

    let activeToken = token;
    let activeTokenId = row.token_id;

    if (expiresAt - Date.now() <= IDENTITY_RENEW_WINDOW_MS && row.token_id) {
      const renewed = await this.#mintTrackedToken(
        token,
        row.uchiyomi_user_id,
        `vantara-${newSessionId()}`,
      ).catch((error) => {
        // A transient proactive-renewal failure cannot make a still-valid
        // current credential unavailable.
        if (expiresAt > Date.now()) return undefined;
        throw error;
      });

      if (renewed) {
        const renewedEncrypted = encrypt(renewed.token, this.#options.key);
        let won = false;

        try {
          won = await transaction(async (client) => {
            const rotated = await client.query<{ token_id: string }>(
              `UPDATE vantara_identity_links
                  SET token_encrypted = $1,
                      token_id = $2,
                      token_expires_at = $3,
                      token_expiry_authoritative = true,
                      linked_at = now(),
                      last_used_at = now()
                WHERE vantara_identity_id = $4
                  AND token_id = $5
                  AND revoked_at IS NULL
                RETURNING token_id`,
              [renewedEncrypted, renewed.id, renewed.expiresAt, identityId, row.token_id],
            );
            if (rotated.rows.length !== 1) return false;

            await client.query(
              `UPDATE vantara_token_mint_attempts
                  SET token_id = $2, resolved_at = now()
                WHERE name = $1 AND resolved_at IS NULL`,
              [renewed.attemptName, renewed.id],
            );
            return true;
          });
        } catch (dbError) {
          try {
            await this.#options.uchiyomi.revokeToken(renewed.token, renewed.id);
            await this.#finishMintAttempt(renewed.attemptName, renewed.id);
          } catch (cleanupError) {
            throw new AggregateError(
              [dbError, cleanupError],
              'identity rotation persistence and cleanup both failed',
            );
          }
          throw dbError;
        }

        if (won) {
          activeToken = renewed.token;
          activeTokenId = renewed.id;
        } else {
          // Another request rotated first. Never leave our losing credential active.
          await this.#options.uchiyomi.revokeToken(renewed.token, renewed.id);
          await this.#finishMintAttempt(renewed.attemptName, renewed.id);

          const latest = await queryOne<IdentityLinkRow>(
            `SELECT l.vantara_identity_id, l.uchiyomi_user_id, l.token_encrypted, l.token_id,
                    l.token_expires_at, l.token_expiry_authoritative, u.username
               FROM vantara_identity_links l
               JOIN vantara_users u USING (uchiyomi_user_id)
              WHERE l.vantara_identity_id = $1 AND l.revoked_at IS NULL`,
            [identityId],
          );
          if (!latest) throw new IdentityRelinkRequiredError();
          activeToken = decrypt(latest.token_encrypted, this.#options.key);
          activeTokenId = latest.token_id;
        }
      }
    } else {
      void query(
        `UPDATE vantara_identity_links SET last_used_at = now()
          WHERE vantara_identity_id = $1 AND revoked_at IS NULL`,
        [identityId],
      ).catch(() => {});
    }

    // Exact-name reconciliation is safe because protected token ids are excluded.
    void this.#reconcilePendingMintAttempts(activeToken, row.uchiyomi_user_id).catch(() => {});

    return {
      id: `identity:${identityId}:${deviceId}`,
      identityId: row.vantara_identity_id,
      userId: row.uchiyomi_user_id,
      username: row.username,
      token: activeToken,
      ...(activeTokenId ? { tokenId: activeTokenId } : {}),
    };
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

  /**
   * إغلاق جلسة الـcookie القديمة بلا كسر ربط الهوية الحديثة.
   *
   * مسار الربط يخزّن credential Uchiyomi طويل العمر في `vantara_identity_links`
   * كي يستطيع Bearer v2 فتح المحتوى بلا كلمة مرور. وقد تحمل جلسة cookie التي
   * أنشأت الربط **نفس** token_id؛ إبطاله عند خروج الكوكي يترك صف الهوية نشطًا
   * لكنه يشير إلى credential ميت، فتتحول كل طلبات Bearer إلى 500/401.
   *
   * لذلك:
   * - Bearer identity ليست جلسة قابلة للإبطال هنا؛ الجهاز يُلغى عند الـWorker
   *   والتوكن القصير ينتهي خلال 15 دقيقة.
   * - cookie session تُغلق محليًا دائمًا.
   * - credential الأعلى يُلغى فقط إذا لم يعد يحمي ربط Identity نشطًا.
   */
  async logout(session: Session): Promise<void> {
    if (session.identityId) return;

    let revokeError: unknown;
    try {
      let backsActiveIdentity = false;
      if (session.tokenId) {
        const linked = await queryOne<{ active: number }>(
          `SELECT 1 AS active
             FROM vantara_identity_links
            WHERE token_id = $1 AND revoked_at IS NULL
            LIMIT 1`,
          [session.tokenId],
        );
        backsActiveIdentity = linked !== undefined;
      }

      if (session.tokenId && !backsActiveIdentity) {
        await this.#options.uchiyomi.revokeToken(session.token, session.tokenId);
      }
    } catch (error) {
      // عند الشك لا نقتل credential قد يكون هو ربط الهوية الوحيد.
      revokeError = error;
    } finally {
      await this.revoke(session.id);
    }

    if (revokeError) throw revokeError;
  }

  async revokeAllFor(userId: string): Promise<number> {
    const sessions = await query<{
      id: string;
      token_encrypted: string;
      token_id: string | null;
    }>(
      `SELECT id, token_encrypted, token_id
         FROM vantara_sessions
        WHERE uchiyomi_user_id = $1
          AND revoked_at IS NULL`,
      [userId],
    );

    // بعض جلسات cookie قد تحمل نفس credential الذي يحمي Identity v2.
    // هذا credential لا يُلغى هنا؛ Worker يملك logout-all للأجهزة الحديثة.
    const linked = await query<{ token_id: string }>(
      `SELECT token_id
         FROM vantara_identity_links
        WHERE uchiyomi_user_id = $1
          AND revoked_at IS NULL
          AND token_id IS NOT NULL`,
      [userId],
    );
    const protectedIds = new Set(linked.map((row) => row.token_id));
    const attempted = new Set<string>();
    let revokeError: unknown;

    try {
      for (const session of sessions) {
        const tokenId = session.token_id;
        if (!tokenId || protectedIds.has(tokenId) || attempted.has(tokenId)) continue;
        attempted.add(tokenId);

        try {
          const token = decrypt(session.token_encrypted, this.#options.key);
          await this.#options.uchiyomi.revokeToken(token, tokenId);
        } catch (error) {
          // نكمل تنظيف بقية credentials ولا نترك جلسة محلية حية بسبب فشل واحد.
          revokeError ??= error;
        }
      }
    } finally {
      await query(
        `UPDATE vantara_sessions SET revoked_at = now()
          WHERE uchiyomi_user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    }

    if (revokeError) throw revokeError;
    return sessions.length;
  }

  /**
   * تنظيف دوري مع إلغاء credential المنبع قبل فقد آخر مرجع محلي له.
   *
   * حذف الصف أولًا كان يترك توكن Uchiyomi طويل العمر صالحًا حتى 60 يومًا
   * بلا token_id/token_encrypted يمكن الرجوع إليهما. إذا فشل الإلغاء نحتفظ
   * بالصف ونفشل المهمة كي تعيد المحاولة لاحقًا.
   */
  async purgeExpired(): Promise<number> {
    const candidates = await query<{
      id: string;
      token_encrypted: string;
      token_id: string | null;
    }>(
      `SELECT id, token_encrypted, token_id
         FROM vantara_sessions
        WHERE expires_at < now() - interval '7 days'
           OR revoked_at < now() - interval '7 days'`,
    );
    if (candidates.length === 0) return 0;

    const linked = await query<{ token_id: string }>(
      `SELECT token_id
         FROM vantara_identity_links
        WHERE revoked_at IS NULL
          AND token_id IS NOT NULL`,
    );
    const protectedIds = new Set(linked.map((row) => row.token_id));
    const revokedIds = new Set<string>();

    for (const session of candidates) {
      const tokenId = session.token_id;
      if (!tokenId || protectedIds.has(tokenId) || revokedIds.has(tokenId)) continue;

      const token = decrypt(session.token_encrypted, this.#options.key);
      await this.#options.uchiyomi.revokeToken(token, tokenId);
      revokedIds.add(tokenId);
    }

    const rows = await query<{ id: string }>(
      `DELETE FROM vantara_sessions
        WHERE expires_at < now() - interval '7 days'
           OR revoked_at < now() - interval '7 days'
        RETURNING id`,
    );
    return rows.length;
  }
}
