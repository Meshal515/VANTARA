import { type FastifyInstance } from 'fastify';
import type { Config } from './lib/config.ts';
import { type AppContext } from './lib/context.ts';
export interface BuiltApp {
    app: FastifyInstance;
    ctx: AppContext;
}
export declare function buildApp(config: Config): Promise<BuiltApp>;
//# sourceMappingURL=app.d.ts.map