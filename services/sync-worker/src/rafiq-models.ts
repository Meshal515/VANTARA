/**
 * «رفيق» — سجل النماذج وتوجيهها.
 *
 * لا افتراض أن الأغلى أذكى: كل نموذج بقدراته وسعره، والمهمة تختار الأرخص الذي يكفيها.
 * الأسعار من صفحة DeepSeek الرسمية (دولار لكل مليون توكن)، ووقت الذروة ضعف غيره:
 * أيام العمل 01:00–04:00 و06:00–10:00 UTC.
 *
 * الطبقات:
 *   A  بلا نموذج (من قاعدة البيانات)
 *   B  Flash بلا تفكير: فهم الطلب، تلخيص، رد بسيط على بيانات مرتّبة
 *   C  Flash تفكير low/high: توصية شخصية، مقارنة، «أكمل ولا أوقف؟»
 *   D  Flash تفكير max: تحليل الذوق، بحث عميق — عند الطلب الصريح
 * Pro لا يُستعمل تلقائيًا: فقط إن طُلب صراحة أو أثبت القياس أنه أفضل لمهمة.
 */

export type Effort = 'none' | 'low' | 'high' | 'max';
export type Tier = 'A' | 'B' | 'C' | 'D';

export interface ModelInfo {
  id: string;
  vision: boolean;
  tools: boolean;
  contextWindow: number;
  /** دولار لكل مليون توكن خارج الذروة (الذروة ضعفها). */
  price: { hit: number; miss: number; out: number };
  latency: 'fast' | 'normal' | 'slow';
}

export const MODELS: Record<string, ModelInfo> = {
  'deepseek-flash': { id: 'deepseek-flash', vision: true, tools: true, contextWindow: 1_000_000, price: { hit: 0.003, miss: 0.15, out: 0.6 }, latency: 'fast' },
  'deepseek-v4-pro': { id: 'deepseek-v4-pro', vision: false, tools: true, contextWindow: 1_000_000, price: { hit: 0.022, miss: 0.66, out: 1.98 }, latency: 'normal' },
};

export const DEFAULT_MODEL = 'deepseek-flash';

/** نموذج مضبوط في البيئة غير معروف لنا: يُحسب بسعر Pro احتياطًا (لا نقلّل التقدير). */
export const modelInfo = (id: string): ModelInfo => MODELS[id] ?? { ...MODELS['deepseek-v4-pro']!, id };

/** ساعات الذروة بتوقيت UTC في أيام العمل (الاثنين–الجمعة). */
export function isPeak(now: number): boolean {
  const d = new Date(now);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export function costOf(usage: Usage | undefined, model: string, now: number): number {
  if (!usage) return 0;
  const p = modelInfo(model).price;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens ?? 0) - hit);
  const base = (hit * p.hit + miss * p.miss + (usage.completion_tokens ?? 0) * p.out) / 1_000_000;
  return isPeak(now) ? base * 2 : base;
}

export interface Route {
  model: string;
  effort: Effort;
}

/**
 * الطبقة ← النموذج والتفكير. تحت ضغط الميزانية (أقل من 30% باقٍ) ينخفض التفكير
 * درجة للمهام العادية، لكن المهمة الصعبة الصريحة (D) لا تُقتل.
 */
export function route(tier: Tier, opts: { model?: string; budgetLeft?: number } = {}): Route {
  const model = opts.model && MODELS[opts.model] ? opts.model : DEFAULT_MODEL;
  const tight = (opts.budgetLeft ?? 1) < 0.3;
  switch (tier) {
    case 'A':
    case 'B':
      return { model, effort: 'none' };
    case 'C':
      return { model, effort: tight ? 'low' : 'high' };
    case 'D':
      return { model, effort: tight ? 'high' : 'max' };
  }
}

/** معاملات الطلب لـDeepSeek (صيغة OpenAI): التفكير يُطفأ صراحة حين لا يلزم. */
export function thinkingParams(effort: Effort): Record<string, unknown> {
  if (effort === 'none') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}
