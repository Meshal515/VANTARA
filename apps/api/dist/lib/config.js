import { z } from 'zod';
/**
 * الإعداد يُتحقق منه عند الإقلاع ويفشل بصوت عالٍ.
 * خدمة تقلع بإعداد ناقص ثم تسقط تحت الحمل أسوأ من خدمة لا تقلع.
 */
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3100),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    UCHIYOMI_URL: z.string().url(),
    /** توكن خدمة `uy_…` بنطاق read+write. النداءات باسم مستخدم تستخدم توكنه. */
    UCHIYOMI_SERVICE_TOKEN: z.string().optional(),
    /** يوقّع كوكي جلسة VANTARA. 32 بايتًا على الأقل. */
    SESSION_SECRET: z.string().min(32),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(60),
    /** VANTARA يقف خلف Cloudflare Access؛ الكوكي Secure إلا في التطوير. */
    COOKIE_SECURE: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    UPLOAD_DIR: z.string().default('/data/uploads'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export function loadConfig(env = process.env) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        throw new Error(`invalid configuration:\n${detail}`);
    }
    return parsed.data;
}
//# sourceMappingURL=config.js.map