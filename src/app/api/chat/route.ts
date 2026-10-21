import { NextRequest, NextResponse } from 'next/server';
import { buildSystemPrompt } from '@/lib/persona';
import { rollMood, moodDirective } from '@/lib/moods';

export const runtime = 'nodejs';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Defaults for user-supplied keys (Z.ai's OpenAI-compatible endpoint)
const DEFAULT_API_BASE = 'https://api.z.ai/api/paas/v4';
const DEFAULT_MODEL = 'glm-4.5-flash';

/* ---------- Key sanitizing + provider auto-detection ----------
   Keys are pasted by hand on phone keyboards and often arrive surrounded
   by junk: zero-width spaces, smart quotes, newlines, labels like
   "Key: …" or "API key: …". That junk breaks the Authorization header
   (fetch throws instantly) and hides the key's prefix from detection.
   So: keep printable ASCII only, then EXTRACT a known key shape. */
interface ProviderPreset {
  name: string;
  base: string;
  model: string;
  fallbackModels: string[];
}

const PRESETS: Record<string, ProviderPreset> = {
  'Google Gemini': {
    name: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // 2.5/2.0 are retired for NEW Google keys (2026) — 3.8 is the new default.
    model: 'gemini-3.8-flash',
    fallbackModels: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  OpenRouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.0-flash-exp:free',
    fallbackModels: ['meta-llama/llama-3.3-70b-instruct:free'],
  },
  Anthropic: {
    name: 'Anthropic',
    base: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest',
    fallbackModels: [],
  },
  OpenAI: {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    fallbackModels: ['gpt-4.1-mini'],
  },
  'Z.ai': {
    name: 'Z.ai',
    base: DEFAULT_API_BASE,
    model: DEFAULT_MODEL,
    fallbackModels: [],
  },
};

const KEY_SHAPES: { provider: string; re: RegExp }[] = [
  // Google issues two shapes: classic "AIza…" and the newer "AQ.…" keys
  // (AI Studio migrated to the AQ. format in 2026). Both are Gemini keys.
  { provider: 'Google Gemini', re: /(AQ\.[0-9A-Za-z_-]{20,})/ },
  { provider: 'Google Gemini', re: /(AIza[0-9A-Za-z_-]{10,})/ },
  { provider: 'OpenRouter', re: /(sk-or-[0-9A-Za-z_-]{10,})/ },
  { provider: 'Anthropic', re: /(sk-ant-[0-9A-Za-z_-]{10,})/ },
  { provider: 'OpenAI', re: /(sk-[0-9A-Za-z_-]{20,})/ },
];

function sanitizeKey(raw: string): string {
  return raw
    .replace(/[^ -~]/g, '') // printable ASCII only — kills zero-width chars, BOMs, smart quotes, control chars
    .replace(/^["'`]+|["'`]+$/g, '') // wrapping quotes
    .trim();
}

function extractKnownKey(s: string): { key: string; provider: string } | null {
  for (const shape of KEY_SHAPES) {
    const m = s.match(shape.re);
    if (m) return { key: m[1], provider: shape.provider };
  }
  return null;
}

function sanitizeBase(raw: string): string {
  let b = sanitizeKey(raw);
  if (b && !/^https?:\/\//i.test(b)) b = `https://${b}`;
  return b.replace(/\/+$/, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      history = [],
      lang = 'auto',
      apiKey = '',
      apiBase = '',
      model = '',
    }: {
      message: string;
      history?: ChatMessage[];
      lang?: 'auto' | 'en' | 'ta';
      apiKey?: string;
      apiBase?: string;
      model?: string;
    } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    /* ROBIN's human persona — a friend with moods, not an assistant.
       Lives in src/lib/persona.ts (shared with the client's direct-Google path).
       The mood directive is appended per-request by src/lib/moods.ts. */
    const systemPrompt = buildSystemPrompt(lang);

    // Roll this request's mood (never two dramatic moods in a row)
    const mood = rollMood();
    console.log(`[ROBIN] mood=${mood}`);
    const fullPrompt = systemPrompt + moodDirective(mood);

    /* ---------- Path 1: user-supplied API key (OpenAI-compatible) ---------- */
    const key = sanitizeKey(typeof apiKey === 'string' ? apiKey : '');
    if (key) {
      const known = extractKnownKey(key);
      const provider = PRESETS[known?.provider ?? 'Z.ai'];
      const effectiveKey = known?.key ?? key;
      const keyFP = `${effectiveKey.slice(0, 6)}…(len ${effectiveKey.length})`;
      const userBase = sanitizeBase(typeof apiBase === 'string' ? apiBase : '');
      const userModel = sanitizeKey(typeof model === 'string' ? model : '');
      const base = userBase || provider.base;
      // An old Z.ai model name left in Settings would break other providers — drop it
      const mdl =
        userModel && !(provider.name !== 'Z.ai' && /^glm-/i.test(userModel))
          ? userModel
          : provider.model;
      // If the user picked the model themselves, respect it exactly;
      // otherwise walk the provider's fallback list if a model name 404s.
      const candidates = userModel ? [mdl] : [mdl, ...provider.fallbackModels];

      const upstreamMessages = [
        { role: 'system', content: fullPrompt },
        ...history.slice(-20).map((m) => ({
          role: (m.role === 'system' ? 'user' : m.role) as ChatMessage['role'],
          content: m.content,
        })),
        { role: 'user' as const, content: message },
      ];

      let raw = '';
      let solved = false;
      let lastStatus = 0;
      let lastDetail = '';

      for (let i = 0; i < candidates.length; i++) {
        let res: Response;
        try {
          res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${effectiveKey}`,
            },
            body: JSON.stringify({
              model: candidates[i],
              messages: upstreamMessages,
              temperature: 0.9,
              stream: false,
            }),
            signal: req.signal,
          });
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') throw e;
          console.error(
            `[BYOK] network failure → ${provider.name} base=${base} key=${keyFP}:`,
            e instanceof Error ? e.message : e
          );
          return NextResponse.json(
            {
              success: false,
              error: `Could not reach ${provider.name} at ${base} — check the API base URL in Settings.`,
            },
            { status: 502 }
          );
        }

        raw = await res.text();
        if (res.ok) {
          solved = true;
          break;
        }

        lastStatus = res.status;
        lastDetail = raw.slice(0, 300);
        try {
          const j = JSON.parse(raw);
          lastDetail = j?.error?.message || j?.message || lastDetail;
        } catch {
          /* keep raw */
        }

        // A wrong model name is worth retrying with the next candidate;
        // auth/permission errors are not.
        const modelIssue =
          res.status === 404 ||
          (res.status === 400 && /model/i.test(lastDetail));
        if (!modelIssue || i === candidates.length - 1) break;
      }

      if (!solved) {
        const authIssue = lastStatus === 401 || lastStatus === 403;
        console.error(
          `[BYOK] rejected by ${provider.name} key=${keyFP} status=${lastStatus}: ${lastDetail}`
        );
        let error: string;
        if (provider.name === 'Z.ai') {
          // No known key shape matched — most likely a mis-pasted Google key
          error =
            `This key wasn't recognized (Z.ai answered: ${lastDetail}). ` +
            `A Google Gemini key starts with "AIza" or the newer "AQ." format — ` +
            `get one free at aistudio.google.com/apikey, copy the whole key, and ` +
            `paste it alone (no labels or spaces) in Settings.`;
        } else {
          error =
            `Your ${provider.name} API key was rejected (${lastStatus}): ${lastDetail}` +
            (authIssue
              ? ' — make sure the whole key was pasted and is still active.'
              : '') +
            (provider.name === 'Google Gemini' && lastStatus === 403
              ? ' If the key has API restrictions, create a new one without them.'
              : '') +
            (/location is not supported/i.test(lastDetail)
              ? ' NOTE: ROBIN\'s server region is blocked by Google — reopen the app so ROBIN calls Google directly from your phone instead.'
              : '');
        }
        return NextResponse.json(
          { success: false, error },
          { status: 502 }
        );
      }

      let responseText = '';
      try {
        const j = JSON.parse(raw);
        responseText = j?.choices?.[0]?.message?.content ?? '';
      } catch {
        /* keep empty */
      }
      return NextResponse.json({
        success: true,
        response: responseText || 'Sorry, I did not catch that.',
      });
    }

    /* ---------- Path 2: built-in sandbox key ---------- */
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const messages: ChatMessage[] = [
      { role: 'assistant', content: fullPrompt },
      ...history.slice(-20).map((m) => ({
        role: m.role === 'system' ? 'assistant' : m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const completion = await zai.chat.completions.create({
      messages,
      temperature: 0.9,
      thinking: { type: 'disabled' },
    });

    const responseText =
      completion?.choices?.[0]?.message?.content ?? 'Sorry, I did not catch that.';

    return NextResponse.json({
      success: true,
      response: responseText,
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get AI response. Please try again.',
      },
      { status: 500 }
    );
  }
}
