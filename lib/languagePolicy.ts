import { normalizeThaiText } from "./thaiSpellcheck";

/** Exact target identities; variants never silently expand the permitted alphabet. */
export const LANGUAGE_POLICY_VERSION = "strict-script-v1";
export interface TargetLanguageProfile { id: string; label: string; aliases: string[]; scripts: string[]; fixture: string }
type Row = [string, string, string, string, string];
const rows: Row[] = [
  ["th", "Thai", "tha|th-TH|ไทย|ภาษาไทย", "Thai", "สวัสดี"],
  ["en", "English", "eng|en-US|en-GB|en-AU|en-CA", "Latin", "Hello"],
  ["fr", "French", "fra|fre|fr-FR|fr-CA|fr-BE", "Latin", "Bonjour"],
  ["de", "German", "deu|ger|de-DE|de-AT|de-CH", "Latin", "Grüße"],
  ["es", "Spanish", "spa|es-ES|es-MX|es-AR", "Latin", "¡Hola!"],
  ["pt", "Portuguese", "por|pt-PT|pt-BR", "Latin", "Olá"],
  ["it", "Italian", "ita|it-IT", "Latin", "Ciao"],
  ["nl", "Dutch", "nld|dut|nl-NL|nl-BE", "Latin", "Hallo"],
  ["sv", "Swedish", "swe|sv-SE", "Latin", "Hej"],
  ["no", "Norwegian", "nor|nb|nb-NO|nn|nn-NO|no-NO", "Latin", "Hei"],
  ["da", "Danish", "dan|da-DK", "Latin", "Hej"],
  ["fi", "Finnish", "fin|fi-FI", "Latin", "Hei"],
  ["is", "Icelandic", "isl|ice|is-IS", "Latin", "Halló"],
  ["pl", "Polish", "pol|pl-PL", "Latin", "Cześć"],
  ["cs", "Czech", "ces|cze|cs-CZ", "Latin", "Ahoj"],
  ["sk", "Slovak", "slk|slo|sk-SK", "Latin", "Ahoj"],
  ["sl", "Slovenian", "slv|sl-SI", "Latin", "Živjo"],
  ["hr", "Croatian", "hrv|hr-HR", "Latin", "Bok"],
  ["ro", "Romanian", "ron|rum|ro-RO", "Latin", "Bună"],
  ["hu", "Hungarian", "hun|hu-HU", "Latin", "Szia"],
  ["tr", "Turkish", "tur|tr-TR", "Latin", "Merhaba"],
  ["vi", "Vietnamese", "vie|vi-VN", "Latin", "Xin chào"],
  ["id", "Indonesian", "ind|id-ID", "Latin", "Halo"],
  ["ms-Latn", "Malay (Latin)", "ms|msa|may|ms-MY|Malay|Malay Latin", "Latin", "Helo"],
  ["ms-Arab", "Malay (Jawi)", "Malay Jawi|Jawi", "Arabic", "سلام"],
  ["tl", "Filipino", "fil|tgl|Tagalog|tl-PH|fil-PH", "Latin", "Kumusta"],
  ["sw", "Swahili", "swa|sw-KE|sw-TZ", "Latin", "Habari"],
  ["af", "Afrikaans", "afr|af-ZA", "Latin", "Hallo"],
  ["ca", "Catalan", "cat|ca-ES", "Latin", "Hola"],
  ["eu", "Basque", "eus|baq|eu-ES", "Latin", "Kaixo"],
  ["gl", "Galician", "glg|gl-ES", "Latin", "Ola"],
  ["ga", "Irish", "gle|ga-IE", "Latin", "Dia dhuit"],
  ["cy", "Welsh", "cym|wel|cy-GB", "Latin", "Helo"],
  ["et", "Estonian", "est|et-EE", "Latin", "Tere"],
  ["lv", "Latvian", "lav|lv-LV", "Latin", "Sveiki"],
  ["lt", "Lithuanian", "lit|lt-LT", "Latin", "Labas"],
  ["sq", "Albanian", "sqi|alb|sq-AL", "Latin", "Përshëndetje"],
  ["ru", "Russian", "rus|ru-RU", "Cyrillic", "Привет"],
  ["uk", "Ukrainian", "ukr|uk-UA", "Cyrillic", "Привіт"],
  ["bg", "Bulgarian", "bul|bg-BG", "Cyrillic", "Здравей"],
  ["be", "Belarusian", "bel|be-BY", "Cyrillic", "Вітаю"],
  ["mk", "Macedonian", "mkd|mac|mk-MK", "Cyrillic", "Здраво"],
  ["sr-Cyrl", "Serbian (Cyrillic)", "Serbian Cyrillic|sr-Cyrl-RS", "Cyrillic", "Здраво"],
  ["sr-Latn", "Serbian (Latin)", "Serbian Latin|sr-Latn-RS", "Latin", "Zdravo"],
  ["az-Latn", "Azerbaijani (Latin)", "Azerbaijani Latin|az-Latn-AZ", "Latin", "Salam"],
  ["az-Cyrl", "Azerbaijani (Cyrillic)", "Azerbaijani Cyrillic", "Cyrillic", "Салам"],
  ["az-Arab", "Azerbaijani (Arabic)", "Azerbaijani Arabic", "Arabic", "سلام"],
  ["uz-Latn", "Uzbek (Latin)", "Uzbek Latin|uz-Latn-UZ", "Latin", "Salom"],
  ["uz-Cyrl", "Uzbek (Cyrillic)", "Uzbek Cyrillic|uz-Cyrl-UZ", "Cyrillic", "Салом"],
  ["kk-Cyrl", "Kazakh (Cyrillic)", "kk|kaz|Kazakh|kk-KZ", "Cyrillic", "Сәлем"],
  ["kk-Latn", "Kazakh (Latin)", "Kazakh Latin", "Latin", "Sälem"],
  ["ky", "Kyrgyz", "kir|ky-KG", "Cyrillic", "Салам"],
  ["mn-Cyrl", "Mongolian (Cyrillic)", "mn|mon|Mongolian|mn-MN", "Cyrillic", "Сайн"],
  ["mn-Mong", "Mongolian (Traditional)", "Mongolian Traditional|Traditional Mongolian", "Mongolian", "ᠮᠣᠩᠭᠣᠯ"],
  ["el", "Greek", "ell|gre|el-GR", "Greek", "Γεια"],
  ["he", "Hebrew", "heb|iw|he-IL", "Hebrew", "שָׁלוֹם"],
  ["ar", "Arabic", "ara|ar-SA|ar-EG|ar-AE", "Arabic", "مَرْحَبًا"],
  ["fa", "Persian", "fas|per|Farsi|fa-IR", "Arabic", "سلام"],
  ["ur", "Urdu", "urd|ur-PK|ur-IN", "Arabic", "سلام"],
  ["ps", "Pashto", "pus|ps-AF", "Arabic", "سلام"],
  ["ku-Latn", "Kurdish (Latin)", "Kurmanji|Kurdish Latin|kmr", "Latin", "Silav"],
  ["ku-Arab", "Kurdish (Arabic)", "Sorani|Kurdish Arabic|ckb", "Arabic", "سڵاو"],
  ["lo", "Lao", "lao|lo-LA", "Lao", "ສະບາຍດີ"],
  ["km", "Khmer", "khm|Cambodian|km-KH", "Khmer", "សួស្តី"],
  ["my", "Burmese", "mya|bur|Myanmar|my-MM", "Myanmar", "မင်္ဂလာပါ"],
  ["ja", "Japanese", "jpn|ja-JP|日本語", "Han|Hiragana|Katakana", "こんにちは日本"],
  ["zh-Hans", "Chinese (Simplified)", "Simplified Chinese|zh-CN|zh-SG|zh-Hans-CN|中文简体", "Han", "你好"],
  ["zh-Hant", "Chinese (Traditional)", "Traditional Chinese|zh-TW|zh-HK|zh-MO|zh-Hant-TW|中文繁體", "Han", "你好"],
  ["ko", "Korean", "kor|ko-KR|한국어", "Hangul|Han", "안녕하세요"],
  ["hi", "Hindi", "hin|hi-IN", "Devanagari", "नमस्ते"],
  ["mr", "Marathi", "mar|mr-IN", "Devanagari", "नमस्कार"],
  ["ne", "Nepali", "nep|ne-NP", "Devanagari", "नमस्ते"],
  ["sa-Deva", "Sanskrit (Devanagari)", "sa|san|Sanskrit|Sanskrit Devanagari", "Devanagari", "नमस्ते"],
  ["bn", "Bengali", "ben|Bangla|bn-BD|bn-IN", "Bengali", "নমস্কার"],
  ["as", "Assamese", "asm|as-IN", "Bengali", "নমস্কাৰ"],
  ["pa-Guru", "Punjabi (Gurmukhi)", "Punjabi Gurmukhi|pa-IN|pa-Guru-IN", "Gurmukhi", "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ"],
  ["pa-Arab", "Punjabi (Shahmukhi)", "Punjabi Shahmukhi|pa-PK|pa-Arab-PK", "Arabic", "سلام"],
  ["gu", "Gujarati", "guj|gu-IN", "Gujarati", "નમસ્તે"],
  ["or", "Odia", "ori|Oriya|or-IN", "Oriya", "ନମସ୍କାର"],
  ["ta", "Tamil", "tam|ta-IN|ta-LK", "Tamil", "வணக்கம்"],
  ["te", "Telugu", "tel|te-IN", "Telugu", "నమస్తే"],
  ["kn", "Kannada", "kan|kn-IN", "Kannada", "ನಮಸ್ಕಾರ"],
  ["ml", "Malayalam", "mal|ml-IN", "Malayalam", "നമസ്കാരം"],
  ["si", "Sinhala", "sin|si-LK", "Sinhala", "ආයුබෝවන්"],
  ["bo", "Tibetan", "bod|tib|bo-CN", "Tibetan", "བཀྲ་ཤིས"],
  ["hy", "Armenian", "hye|arm|hy-AM", "Armenian", "Բարեւ"],
  ["ka", "Georgian", "kat|geo|ka-GE", "Georgian", "გამარჯობა"],
  ["am", "Amharic", "amh|am-ET", "Ethiopic", "ሰላም"],
  ["ti", "Tigrinya", "tir|ti-ER|ti-ET", "Ethiopic", "ሰላም"],
];
export const TARGET_LANGUAGES: readonly TargetLanguageProfile[] = rows.map(([id,label,aliases,scripts,fixture]) => ({id,label,aliases:aliases.split("|"),scripts:scripts.split("|"),fixture}));
function aliasKey(value: string) { return value.trim().toLowerCase().replace(/_/g, "-"); }
const aliases = new Map<string, TargetLanguageProfile | null>();
for (const profile of TARGET_LANGUAGES) for (const alias of [profile.id,profile.label,...profile.aliases]) {
  const key = aliasKey(alias);
  const prior = aliases.get(key);
  aliases.set(key, prior && prior.id !== profile.id ? null : profile);
}
export type TargetResolution = {status:"resolved";profile:TargetLanguageProfile} | {status:"blocked";reason:"unknown-target"|"ambiguous-target";message:string};
export function resolveTargetLanguage(target?: string | null): TargetResolution {
  const key = aliasKey(target ?? "");
  const profile = aliases.get(key);
  if (profile) return {status:"resolved",profile};
  const ambiguous = ["chinese","zh","zho","chi","serbian","sr","sr-rs","srp","punjabi","pa","pan","kurdish","ku","kur","azerbaijani","az","aze","uzbek","uz","uzb"].includes(key) || aliases.has(key);
  return {status:"blocked",reason:ambiguous ? "ambiguous-target":"unknown-target",message:ambiguous ? "Choose an explicit writing-system variant." : "Choose a supported target language."};
}
const scriptPatterns = new Map<string, RegExp>();
function scriptMatches(character: string, script: string) {
  let pattern = scriptPatterns.get(script);
  if (!pattern) { pattern = new RegExp(`\\p{Script_Extensions=${script}}`,"u"); scriptPatterns.set(script,pattern); }
  return pattern.test(character);
}
const letter = /\p{L}/u, mark = /\p{M}/u, number = /\p{N}/u, decimal = /\p{Nd}/u;
const emoji = /\p{Extended_Pictographic}/u;
const inherited = /\p{Script=Inherited}/u;
const joinerScripts = new Set(["Arabic","Devanagari","Bengali","Gurmukhi","Gujarati","Oriya","Tamil","Telugu","Kannada","Malayalam","Sinhala","Myanmar","Khmer","Mongolian"]);
/** Numeric blocks are discovered from the runtime's Unicode Nd property, not a script blacklist. */
let decimalZeroes: number[] | undefined;
function decimalValue(character: string): number | undefined {
  if (!decimalZeroes) {
    decimalZeroes = [];
    for (let cp=0;cp<=0x10ffff;cp++) {
      if (!decimal.test(String.fromCodePoint(cp))) continue;
      // Consecutive mathematical digit alphabets occupy one 50-character run.
      decimalZeroes.push(cp); cp += 9;
    }
  }
  const cp=character.codePointAt(0)!;
  const zero=decimalZeroes.find(value=>cp>=value&&cp<value+10);
  return zero === undefined ? undefined : cp-zero;
}
function normalizeThaiNumeral(character: string): string {
  if (/^[0-9๐-๙]$/u.test(character)) return character;
  if (decimal.test(character)) { const value=decimalValue(character); if(value!==undefined)return String(value); }
  if (number.test(character)) {
    const compatible=character.normalize("NFKC");
    if (/^[0-9]+(?:⁄[0-9]+)?$/u.test(compatible)) return compatible;
  }
  return character;
}
export interface TargetTextInspection {
  status:"eligible"|"blocked"; targetId?:string; policyVersion:string; normalizedText:string;
  offendingCharacters:string[]; reason?:"unknown-target"|"ambiguous-target"|"excluded-script";
}
/** Bound diagnostic display while making invisible/unsupported characters identifiable. */
export function formatOffendingCharacters(characters: readonly string[], limit = 24): string {
  const unique = [...new Set(characters)];
  const shown = unique.slice(0, limit);
  const visible = shown.filter(character => !/[\p{C}\p{M}]/u.test(character)).join("");
  const codes = shown.map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4,"0")}`).join(" ");
  return [visible, codes ? `[${codes}]` : "", unique.length > shown.length ? `(+${unique.length-shown.length})` : ""].filter(Boolean).join(" ");
}
export function inspectTargetText(text: string, target?: string | null): TargetTextInspection {
  const resolved=resolveTargetLanguage(target);
  const base={policyVersion:LANGUAGE_POLICY_VERSION,normalizedText:text,offendingCharacters:[] as string[]};
  if(resolved.status==="blocked")return {...base,status:"blocked",reason:resolved.reason};
  const {profile}=resolved;
  const chars=Array.from(text);
  const allowed=(char:string|undefined)=>!!char && profile.scripts.some(script=>scriptMatches(char,script));
  const bad=new Set<string>();
  const normalized:string[]=[];
  for(let index=0;index<chars.length;index++) {
    const char=chars[index], previous=chars[index-1], next=chars[index+1];
    const numeric=profile.id==="th" ? normalizeThaiNumeral(char) : char;
    normalized.push(numeric);
    if(numeric!==char)continue;
    const emojiMark=(char==="\uFE0F"||char==="\uFE0E") && !!previous && (emoji.test(previous)||/^[0-9#*]$/.test(previous));
    const emojiJoiner=char==="\u200D" && !!next && emoji.test(next) && !!previous && (emoji.test(previous)||previous==="\uFE0F"||/\p{Emoji_Modifier}/u.test(previous));
    const emojiKeycap=char==="\u20E3" && !!previous && (/^[0-9#*]$/.test(previous)||(previous==="\uFE0F"&&/^[0-9#*]$/.test(chars[index-2]??"")));
    // Unicode ideographic variation sequences require an immediately preceding Han base.
    const hanVariation=/^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u.test(char) && profile.scripts.includes("Han") && !!previous && letter.test(previous) && scriptMatches(previous,"Han");
    const rtlMark=["\u061C","\u200F"].includes(char) && profile.scripts.some(script=>["Arabic","Hebrew"].includes(script)) && (allowed(previous)||allowed(next));
    if(emojiMark||emojiJoiner||emojiKeycap||hanVariation||rtlMark)continue;
    if(char==="\u200C"||char==="\u200D") {
      if(!allowed(previous)||!allowed(next)||!profile.scripts.some(script=>joinerScripts.has(script)))bad.add(char);
      continue;
    }
    // Compatibility characters can conceal enclosed or mathematical letters.
    const compatibility=char.normalize("NFKC");
    if(compatibility!==char && Array.from(compatibility).some(part=>letter.test(part)&&!allowed(part))) {bad.add(char);continue;}
    if(letter.test(char)) {if(!allowed(char))bad.add(char);continue;}
    if(mark.test(char)) {
      const nativeMark=allowed(char) && allowed(previous);
      const sharedAccent=inherited.test(char) && scriptMatches(char,"Inherited") && /^[\u0300-\u036F]$/u.test(char) && allowed(previous) && profile.scripts.some(script=>["Latin","Greek","Cyrillic"].includes(script));
      if(!nativeMark&&!sharedAccent)bad.add(char);
      continue;
    }
    if(number.test(char)) {
      if(profile.id!=="th" && scriptMatches(char,"Common") && /^[0-9]+(?:⁄[0-9]+)?$/u.test(char.normalize("NFKC")))continue;
      if(profile.id==="th"&&!/^[0-9๐-๙]$/u.test(char))bad.add(char);
      else if(!/^[0-9]$/.test(char)&&!allowed(char))bad.add(char);
      continue;
    }
    // Only known punctuation, symbols, spacing and explicit formatting can fall through.
    // Runtime Unicode tables cannot verify unassigned/private-use/surrogate characters.
    if(/[\p{P}\p{S}\p{Z}]/u.test(char)||/^[\t\n\r]$/u.test(char)||["\u200B","\uFEFF"].includes(char))continue;
    bad.add(char);
  }
  return {...base,status:bad.size ? "blocked":"eligible",targetId:profile.id,normalizedText:normalized.join(""),offendingCharacters:[...bad],...(bad.size ? {reason:"excluded-script" as const}:{})};
}

/** Never clean away evidence of contamination; Thai cleanup follows raw inspection. */
export function normalizeTargetTranslationPayload<T extends { bubbles?: unknown[] }>(payload:T, target:string):T {
  if (!payload || !Array.isArray(payload.bubbles)) return payload;
  return {
    ...payload,
    bubbles:payload.bubbles.map((bubble:unknown)=> {
      if (typeof bubble!=="object" || bubble===null) {
        throw new Error("Malformed bubble element in translation response");
      }
      const row=bubble as {t?:unknown};
      if(typeof row.t!=="string")return {...row};
      const inspection=inspectTargetText(row.t,target);
      const text=inspection.status==="eligible" && inspection.targetId==="th"
        ? normalizeThaiText(inspection.normalizedText)
        : row.t;
      return {...row,t:text};
    }),
  };
}
