import { query, queryOne } from '@vantara/db';
import { decrypt, encrypt, newSessionId } from "./crypto.js";
export const SESSION_COOKIE = 'vantara_session';
export class SessionStore {
    options;
    constructor(options) {
        this.options = options;
    }
    /**
     * تسجيل دخول: Uchiyomi يتحقق من كلمة المرور، ثم نصك توكنًا طويل العمر باسم
     * المستخدم ونخزّنه مشفّرًا. VANTARA لا يرى كلمة المرور بعد هذه اللحظة ولا
     * يخزّنها، ولا يحتاج دورة refresh.
     */
    async login(username, password, device) {
        const uchiyomi = this.options.uchiyomi;
        const result = await uchiyomi.login(username, password);
        const expiresInDays = this.options.ttlDays;
        const minted = await uchiyomi.mintToken(result.accessToken, {
            name: `vantara${device ? ` (${device})` : ''}`,
            scopes: ['read', 'write'],
            expiresInDays,
        });
        // الظل الخفيف للمستخدم: اسمه فقط، لتعليق بياناتنا الاجتماعية على معرّفه
        await query(`INSERT INTO vantara_users (uchiyomi_user_id, username)
            VALUES ($1, $2)
       ON CONFLICT (uchiyomi_user_id)
       DO UPDATE SET username = EXCLUDED.username, last_seen_at = now()`, [result.user.id, result.user.username]);
        await query(`INSERT INTO vantara_profiles (uchiyomi_user_id, display_name)
            VALUES ($1, $2)
       ON CONFLICT (uchiyomi_user_id) DO NOTHING`, [result.user.id, result.user.displayName]);
        await query(`INSERT INTO vantara_user_gates (uchiyomi_user_id) VALUES ($1)
       ON CONFLICT (uchiyomi_user_id) DO NOTHING`, [result.user.id]);
        const id = newSessionId();
        await query(`INSERT INTO vantara_sessions
         (id, uchiyomi_user_id, token_encrypted, token_id, device, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`, [
            id,
            result.user.id,
            encrypt(minted.token, this.options.key),
            minted.id,
            device ?? null,
            String(expiresInDays),
        ]);
        return { id, userId: result.user.id, username: result.user.username, token: minted.token };
    }
    /** يُرجع undefined للجلسة المنتهية أو المُبطلة أو غير الموجودة — بلا تمييز. */
    async resolve(sessionId) {
        const row = await queryOne(`SELECT s.id, s.uchiyomi_user_id, s.token_encrypted, u.username
         FROM vantara_sessions s
         JOIN vantara_users u USING (uchiyomi_user_id)
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`, [sessionId]);
        if (!row)
            return undefined;
        let token;
        try {
            token = decrypt(row.token_encrypted, this.options.key);
        }
        catch {
            // مفتاح مختلف أو صف معدَّل: أبطل الجلسة بدل محاولة استخدامها
            await this.revoke(sessionId);
            return undefined;
        }
        return { id: row.id, userId: row.uchiyomi_user_id, username: row.username, token };
    }
    /** لمسة خفيفة لآخر استخدام. لا تُنتظر في مسار الطلب. */
    async touch(sessionId) {
        await query(`UPDATE vantara_sessions SET last_used_at = now()
        WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
    }
    async revoke(sessionId) {
        await query(`UPDATE vantara_sessions SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
    }
    async revokeAllFor(userId) {
        const rows = await query(`UPDATE vantara_sessions SET revoked_at = now()
        WHERE uchiyomi_user_id = $1 AND revoked_at IS NULL
        RETURNING id`, [userId]);
        return rows.length;
    }
    /** تنظيف دوري. الجلسة المنتهية تبقى صفًا ميتًا حتى تُحذف. */
    async purgeExpired() {
        const rows = await query(`DELETE FROM vantara_sessions
        WHERE expires_at < now() - interval '7 days'
           OR revoked_at < now() - interval '7 days'
        RETURNING id`);
        return rows.length;
    }
}
//# sourceMappingURL=sessions.js.map