/**
 * محركات العائلات المتاحة للـPWA. تعريف مصدر يختار واحدًا منها باسمه
 * (`engine` في defs.json)؛ محرك غير مسجّل هنا ⇒ التعريف مرفوض.
 */
import { madara } from './madara.js';

export const ENGINES = Object.freeze({
  [madara.kind]: madara,
});
