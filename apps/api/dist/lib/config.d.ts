import { z } from 'zod';
/**
 * الإعداد يُتحقق منه عند الإقلاع ويفشل بصوت عالٍ.
 * خدمة تقلع بإعداد ناقص ثم تسقط تحت الحمل أسوأ من خدمة لا تقلع.
 */
declare const schema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    PORT: z.ZodDefault<z.ZodNumber>;
    HOST: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodString;
    UCHIYOMI_URL: z.ZodString;
    /** توكن خدمة `uy_…` بنطاق read+write. النداءات باسم مستخدم تستخدم توكنه. */
    UCHIYOMI_SERVICE_TOKEN: z.ZodOptional<z.ZodString>;
    /** يوقّع كوكي جلسة VANTARA. 32 بايتًا على الأقل. */
    SESSION_SECRET: z.ZodString;
    SESSION_TTL_DAYS: z.ZodDefault<z.ZodNumber>;
    /** VANTARA يقف خلف Cloudflare Access؛ الكوكي Secure إلا في التطوير. */
    COOKIE_SECURE: z.ZodEffects<z.ZodDefault<z.ZodEnum<["true", "false"]>>, boolean, "true" | "false" | undefined>;
    UPLOAD_DIR: z.ZodDefault<z.ZodString>;
    MAX_UPLOAD_BYTES: z.ZodDefault<z.ZodNumber>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["fatal", "error", "warn", "info", "debug", "trace"]>>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    HOST: string;
    DATABASE_URL: string;
    UCHIYOMI_URL: string;
    SESSION_SECRET: string;
    SESSION_TTL_DAYS: number;
    COOKIE_SECURE: boolean;
    UPLOAD_DIR: string;
    MAX_UPLOAD_BYTES: number;
    LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    UCHIYOMI_SERVICE_TOKEN?: string | undefined;
}, {
    DATABASE_URL: string;
    UCHIYOMI_URL: string;
    SESSION_SECRET: string;
    NODE_ENV?: "development" | "test" | "production" | undefined;
    PORT?: number | undefined;
    HOST?: string | undefined;
    UCHIYOMI_SERVICE_TOKEN?: string | undefined;
    SESSION_TTL_DAYS?: number | undefined;
    COOKIE_SECURE?: "true" | "false" | undefined;
    UPLOAD_DIR?: string | undefined;
    MAX_UPLOAD_BYTES?: number | undefined;
    LOG_LEVEL?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | undefined;
}>;
export type Config = z.infer<typeof schema>;
export declare function loadConfig(env?: NodeJS.ProcessEnv): Config;
export {};
//# sourceMappingURL=config.d.ts.map