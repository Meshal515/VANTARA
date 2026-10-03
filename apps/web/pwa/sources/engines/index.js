/**
 * محركات العائلات المتاحة للـPWA. تعريف مصدر يختار واحدًا منها باسمه
 * (`engine` في defs.json)؛ محرك غير مسجّل هنا ⇒ التعريف مرفوض.
 */
import { madara } from './madara.js';
import { zeistmanga } from './zeistmanga.js';
import { mangathemesia } from './mangathemesia.js';
import { iken } from './iken.js';
import { mangadex } from './mangadex.js';
import { mangaswat } from './mangaswat.js';
import { teamx } from './teamx.js';
import { witanime } from './witanime.js';
import { shahiid } from './shahiid.js';
import { arabseed } from './arabseed.js';
import { tuktuk } from './tuktuk.js';
import { akwam } from './akwam.js';
import { egydead } from './egydead.js';
import { ristoanime } from './ristoanime.js';

export const ENGINES = Object.freeze(Object.fromEntries([madara, zeistmanga, mangathemesia, iken, mangadex, mangaswat, teamx, witanime, shahiid, arabseed, tuktuk, akwam, egydead, ristoanime].map((e) => [e.kind, e])));
