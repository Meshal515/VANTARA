// يُحصر CSS نموذج v35 تحت `.v35` فتُنقل الشاشات إليه واحدةً واحدة دون أن
// تصطدم أسماؤه العامة (`.page` مخفيّة ما لم تكن `active`، `.card`، `body`)
// بشاشات لم تُنقل بعد. `:root` و`html`/`body` تصير `.v35` نفسها.
//
//   node tools/scope-css.mjs <in.css> <out.css>
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const css = readFileSync(input, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return s;
      if (s === ':root' || s === 'html' || s === 'body') return '.v35';
      if (/^(html|body)\b/.test(s)) return s.replace(/^(html|body)/, '.v35');
      return `.v35 ${s}`;
    })
    .join(',');
}

let out = '';
let i = 0;
function block(stop) {
  let text = '';
  while (i < css.length) {
    if (css[i] === '}') { i++; return text; }
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', i);
    if (open === -1 || (close !== -1 && close < open)) { i = close + 1; return text; }
    const head = css.slice(i, open).trim();
    i = open + 1;
    if (head.startsWith('@keyframes') || head.startsWith('@font-face')) {
      // جسمٌ لا يُحصر: خطوات الحركة ليست محدِّدات
      let depth = 1; const start = i;
      while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
      text += `${head}{${css.slice(start, i - 1)}}\n`;
    } else if (head.startsWith('@media') || head.startsWith('@supports')) {
      text += `${head}{\n${block()}}\n`;
    } else {
      const end = css.indexOf('}', i);
      text += `${scopeSelector(head)}{${css.slice(i, end)}}\n`;
      i = end + 1;
    }
  }
  return text;
}
out = block();
writeFileSync(output, `/* مولَّد من نموذج v35 بـtools/scope-css.mjs — لا يُحرَّر يدويًّا */\n${out}`);
console.log(`scoped ${css.length} → ${out.length} chars`);
