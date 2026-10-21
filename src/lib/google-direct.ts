/* ROBIN → Google Gemini, called DIRECTLY from the phone (browser/WebView).
   WHY CLIENT-SIDE: ROBIN's server runs in Hong Kong, which Google blocks —
   every server-side call to generativelanguage.googleapis.com dies with
   400 "User location is not supported". Phones in India (where ROBIN's
   users are) ARE supported, so Google traffic goes straight from the device.
   This applies BOTH to the user's own Google key and to the built-in key
   provided by Manoj M so everyone can chat for free. */

export const GOOGLE_OPENAI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/openai';

// gemini-2.5-flash / 2.0-flash are retired for NEW Google keys (2026) —
// new keys must use 3.8+. Older keys that still have 2.5/2.0 are kept as
// fallbacks so pre-existing users don't break.
export const GOOGLE_PRIMARY_MODEL = 'gemini-3.8-flash';
const GOOGLE_FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

// Built-in key (provided by Manoj M, founder of Stark Industry) used when
// the user has no key of their own. Stored base64 so the repo isn't
// trivially scrapable by grepping for key prefixes; decoded at runtime.
const BUILTIN_GOOGLE_KEY_B64 =
  'QVEuQWI4Uk42SUNJOFQtcXh6elNES0lMdHJ5c3B5dDVfb213MTZ4OHc0YUU0MnM5Mkp5cWc=';

export function builtinGoogleKey(): string {
  try {
    return atob(BUILTIN_GOOGLE_KEY_B64);
  } catch {
    return '';
  }
}

interface GoogleDirectArgs {
  apiKey: string;
  /** Full system prompt INCLUDING the mood directive (src/lib/persona.ts + moods.ts). */
  systemPrompt: string;
  history: { role: string; content: string }[];
  message: string;
  /** User-pinned model from Settings (optional). */
  modelOverride?: string;
  signal?: AbortSignal;
}

export async function googleDirectChat(args: GoogleDirectArgs): Promise<string> {
  const candidates = args.modelOverride
    ? [args.modelOverride]
    : [GOOGLE_PRIMARY_MODEL, ...GOOGLE_FALLBACK_MODELS];

  const messages = [
    { role: 'system', content: args.systemPrompt },
    ...args.history
      .slice(-20)
      .map((m) => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content,
      })),
    { role: 'user', content: args.message },
  ];

  let lastStatus = 0;
  let lastDetail = '';

  for (let i = 0; i < candidates.length; i++) {
    let res: Response;
    try {
      res = await fetch(`${GOOGLE_OPENAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify({
          model: candidates[i],
          messages,
          temperature: 0.9,
          stream: false,
        }),
        signal: args.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new Error(
        'Could not reach Google Gemini — check your internet connection and try again.'
      );
    }

    const raw = await res.text();
    if (res.ok) {
      try {
        const j = JSON.parse(raw);
        const text: string = j?.choices?.[0]?.message?.content ?? '';
        return text || 'Sorry, I did not catch that.';
      } catch {
        lastStatus = res.status;
        lastDetail = 'Google sent an unreadable response';
        continue;
      }
    }

    lastStatus = res.status;
    lastDetail = raw.slice(0, 300);
    try {
      const j = JSON.parse(raw);
      lastDetail = j?.error?.message || j?.message || lastDetail;
    } catch {
      /* keep raw */
    }

    // A retired/wrong model name is worth retrying with the next candidate;
    // auth, quota and region errors are not.
    const modelIssue =
      res.status === 404 ||
      (res.status === 400 && /model/i.test(lastDetail));
    if (!modelIssue || i === candidates.length - 1) break;
  }

  throw new Error(friendlyGoogleError(lastStatus, lastDetail));
}

function friendlyGoogleError(status: number, detail: string): string {
  if (/location is not supported/i.test(detail)) {
    return "Google Gemini isn't available on this network's region — switch to mobile data (or another Wi-Fi) and try again.";
  }
  if (status === 429) {
    return "ROBIN's free Google quota is used up right now — try again in a minute, or add your own free key from aistudio.google.com/apikey in Settings.";
  }
  if (status === 401 || status === 403) {
    return `Google rejected the API key (${status}): ${detail} — make sure the whole key was pasted and is still active.`;
  }
  if (status === 404 || /model/i.test(detail)) {
    return `Google says the AI model is unavailable right now: ${detail}`;
  }
  return `Google Gemini request failed (${status || 'network'}): ${detail}`;
}
