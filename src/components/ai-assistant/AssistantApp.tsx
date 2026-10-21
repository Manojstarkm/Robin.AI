'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Volume2,
  VolumeX,
  Send,
  Trash2,
  Sparkles,
  Globe,
  KeyRound,
  PersonStanding,
  Download,
  X,
  Eye,
  EyeOff,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { buildSystemPrompt } from '@/lib/persona';
import { rollMood, moodDirective } from '@/lib/moods';
import { googleDirectChat, builtinGoogleKey } from '@/lib/google-direct';
import {
  getSpeechRecognition,
  type SpeechRecognitionLike,
  type AssistantState,
} from './AICompanion';

const AICompanion = dynamic(() => import('./AICompanion'), { ssr: false });

const STATE_COLORS: Record<AssistantState, string> = {
  idle: '#22d3ee',
  listening: '#34d399',
  thinking: '#a78bfa',
  speaking: '#fb7185',
};

type LangMode = 'auto' | 'en' | 'ta';
const LANG_CYCLE: LangMode[] = ['auto', 'ta', 'en'];
const LANG_META: Record<LangMode, { label: string; title: string }> = {
  auto: { label: 'Auto', title: 'Language: auto-detect' },
  ta: { label: 'தமிழ்', title: 'Language: Tamil' },
  en: { label: 'EN', title: 'Language: English' },
};
const TAMIL_RE = /[\u0B80-\u0BFF]/;

const API_BASE_PLACEHOLDER = 'https://api.z.ai/api/paas/v4';
const MODEL_PLACEHOLDER = 'glm-4.5-flash';
const GET_KEY_URL = 'https://z.ai/manage-apikey/apikey-list';
const GET_GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

// Keys pasted on phones often carry invisible junk (zero-width spaces,
// smart quotes, labels like "Key: …"). Strip everything that is not
// printable ASCII, then EXTRACT a known key shape — mirrors the server.
function sanitizeKey(k: string): string {
  return k
    .replace(/[^ -~]/g, '')
    .replace(/["'`]+/g, '')
    .trim();
}

const KEY_SHAPES: { provider: string; re: RegExp }[] = [
  // Google issues two shapes: classic "AIza…" and the newer "AQ.…" keys
  { provider: 'Google Gemini', re: /(AQ\.[0-9A-Za-z_-]{20,})/ },
  { provider: 'Google Gemini', re: /(AIza[0-9A-Za-z_-]{10,})/ },
  { provider: 'OpenRouter', re: /(sk-or-[0-9A-Za-z_-]{10,})/ },
  { provider: 'Anthropic', re: /(sk-ant-[0-9A-Za-z_-]{10,})/ },
  { provider: 'OpenAI', re: /(sk-[0-9A-Za-z_-]{20,})/ },
];

function extractKnownKey(s: string): string | null {
  for (const shape of KEY_SHAPES) {
    const m = s.match(shape.re);
    if (m) return m[1];
  }
  return null;
}

// Mirror of the server-side provider detection — '' means unrecognized
function detectKeyName(k: string): string {
  const s = sanitizeKey(k);
  if (!s) return '';
  for (const shape of KEY_SHAPES) {
    if (shape.re.test(s)) return shape.provider;
  }
  return '';
}

// Sanitize + extract — heals keys saved by older versions with junk around them
function healKey(raw: string): string {
  const s = sanitizeKey(raw);
  return extractKnownKey(s) ?? s;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Shape of /app-version.json — bumped on every APK release
interface AppUpdateInfo {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes?: string;
}

export default function AssistantApp() {
  const [state, setState] = useState<AssistantState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState('');
  const [muted, setMuted] = useState(false);
  const [animated, setAnimated] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const [lang, setLang] = useState<LangMode>('auto');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  // Newer APK available (checked only inside the Android shell)
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  // Guards so an interrupted utterance's onend doesn't clobber a newer state
  const speakTokenRef = useRef(0);

  // Live microphone amplitude (0..1) that drives the audio-reactive avatar.
  const audioLevelRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef(0);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Restore saved language + API settings + chat history
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('robin-lang');
      if (saved === 'auto' || saved === 'en' || saved === 'ta') setLang(saved);
      // Voice + animation preferences survive reloads
      if (window.localStorage.getItem('robin-muted') === '1') setMuted(true);
      if (window.localStorage.getItem('robin-anim') === '0')
        setAnimated(false);
      const k = healKey(window.localStorage.getItem('robin-api-key') || '');
      setApiKey(k);
      setHasKey(!!k);
      // If an older save carried junk around the key, persist the healed copy
      try {
        const stored = window.localStorage.getItem('robin-api-key');
        if (stored !== null && stored !== k)
          window.localStorage.setItem('robin-api-key', k);
      } catch {
        /* private mode */
      }
      setApiBase(window.localStorage.getItem('robin-api-base') || '');
      setModel(window.localStorage.getItem('robin-api-model') || '');
      // Conversation history survives reloads too
      const raw = window.localStorage.getItem('robin-chat');
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed)) {
          setMessages(
            parsed.filter(
              (m) =>
                m &&
                (m.role === 'user' || m.role === 'assistant') &&
                typeof m.content === 'string'
            )
          );
          if (parsed.length) setShowHint(false);
        }
      }
    } catch {
      /* private mode */
    }
  }, []);

  // Persist the conversation (last 50 messages) as it grows
  useEffect(() => {
    try {
      if (messages.length) {
        window.localStorage.setItem(
          'robin-chat',
          JSON.stringify(messages.slice(-50))
        );
      } else {
        window.localStorage.removeItem('robin-chat');
      }
    } catch {
      /* private mode */
    }
  }, [messages]);

  // First-run hint also fades away on its own after 7s
  useEffect(() => {
    if (!showHint) return;
    const t = window.setTimeout(() => setShowHint(false), 7000);
    return () => window.clearTimeout(t);
  }, [showHint]);

  // In-app update check — APK shell only (the shell exposes window.Robin).
  // v1.5.0+ shells report their own version via Robin.getVersion(); older
  // shells don't, so they get the banner as soon as a new release lands.
  useEffect(() => {
    const w = window as unknown as {
      Robin?: { getVersion?: () => string; retry?: () => void };
    };
    if (!w.Robin) return; // running in a normal browser — always up to date
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/app-version.json', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const info = (await res.json()) as AppUpdateInfo;
        if (
          !info ||
          typeof info.versionCode !== 'number' ||
          !info.apkUrl ||
          cancelled
        )
          return;
        const raw = w.Robin?.getVersion?.() || '';
        const m = raw.match(/\((\d+)\)/);
        const current = m ? parseInt(m[1], 10) : 0; // 0 = old unversioned shell
        if (info.versionCode <= current) return;
        try {
          if (
            window.localStorage.getItem('robin-update-dismissed') ===
            String(info.versionCode)
          )
            return; // user already dismissed this release
        } catch {
          /* private mode — still show */
        }
        if (!cancelled) setUpdate(info);
      } catch {
        /* offline / private mode — skip */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tap → hand the APK URL to the shell. v1.5.0+ shells route this through
  // Android's DownloadManager (auto-prompts install when done).
  const applyUpdate = useCallback(() => {
    if (!update) return;
    window.location.href = update.apkUrl;
  }, [update]);

  const dismissUpdate = useCallback(() => {
    if (update) {
      try {
        window.localStorage.setItem(
          'robin-update-dismissed',
          String(update.versionCode)
        );
      } catch {
        /* private mode */
      }
    }
    setUpdate(null);
  }, [update]);

  // Warm up the speech-synthesis voice list (populates async in Chrome)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
    const handler = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () =>
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, state]);

  const setupLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      levelDataRef.current = data;
      audioLevelRef.current = 0;

      const tick = () => {
        if (!analyserRef.current || !levelDataRef.current) return;
        analyserRef.current.getByteFrequencyData(levelDataRef.current);
        let sum = 0;
        for (let i = 0; i < levelDataRef.current.length; i++) {
          sum += levelDataRef.current[i];
        }
        audioLevelRef.current = Math.min(
          1,
          sum / levelDataRef.current.length / 120
        );
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Level metering is cosmetic — never break the voice flow over it.
    }
  }, []);

  const teardownLevelMeter = useCallback(() => {
    cancelAnimationFrame(levelRafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    levelDataRef.current = null;
    audioLevelRef.current = 0;
  }, []);

  /* ---------- Speech output ---------- */

  // TTS-safe text: human chat style includes emojis and markdown marks that
  // voices read out garbage — strip them before anything is spoken
  function cleanForSpeech(t: string): string {
    return t
      .replace(
        /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
        ''
      )
      .replace(/[*_`#>|~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Native browser Tamil voice (high quality on Chrome / Android when installed)
  const speakWithBrowserTamil = useCallback((text: string, token: number) => {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window))
        return false;
      const synth = window.speechSynthesis;
      const taVoices = synth
        .getVoices()
        .filter((v) => v.lang?.toLowerCase().startsWith('ta'));
      // Google's Tamil voice sounds the most natural when present
      const voice =
        taVoices.find((v) => /google/i.test(v.name)) ?? taVoices[0];
      if (!voice) return false;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.9; // slightly slow — Tamil pronunciation needs the room
      u.onstart = () => {
        // Lips move only when the voice is actually audible
        if (speakTokenRef.current === token) setState('speaking');
      };
      u.onend = () => {
        if (speakTokenRef.current === token) setState('idle');
      };
      u.onerror = () => {
        if (speakTokenRef.current === token) setState('idle');
      };
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    speakTokenRef.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setState('idle');
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const spoken = cleanForSpeech(text);
      if (muted || !spoken) {
        setState('idle');
        return;
      }
      const token = ++speakTokenRef.current;
      // NOTE: stay in 'thinking' until audio actually starts playing — the
      // avatar must never move her lips before her voice comes out.

      const wantsTamil =
        lang === 'ta' || (lang === 'auto' && TAMIL_RE.test(spoken));
      if (wantsTamil && speakWithBrowserTamil(spoken, token)) return;

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: spoken, voice: 'tongtong', speed: 1.0 }),
        });
        if (!res.ok) {
          throw new Error('TTS failed');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            if (speakTokenRef.current === token) setState('idle');
          };
          audioRef.current.onerror = () => {
            URL.revokeObjectURL(url);
            if (speakTokenRef.current === token) setState('idle');
          };
          await audioRef.current
            .play()
            .then(() => {
              // Voice is actually audible now — start the talk animation
              if (speakTokenRef.current === token) setState('speaking');
            })
            .catch(() => {
              URL.revokeObjectURL(url);
              if (speakTokenRef.current === token) setState('idle');
            });
        }
      } catch (e) {
        console.error('TTS error:', e);
        if (speakTokenRef.current === token) setState('idle');
      }
    },
    [muted, lang, speakWithBrowserTamil]
  );

  /* ---------- Brain ---------- */

  const askAssistant = useCallback(
    async (userText: string) => {
      if (!userText.trim()) return;
      // A newer question always supersedes an in-flight one
      chatAbortRef.current?.abort();
      const ac = new AbortController();
      chatAbortRef.current = ac;

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: userText,
      };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg]);
      setState('thinking');

      // Shared success path: append ROBIN's reply and speak it
      const deliver = async (aiText: string) => {
        if (ac.signal.aborted) return;
        const aiMsg: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: aiText,
        };
        setMessages((prev) => [...prev, aiMsg]);
        await speak(aiText);
      };
      // Full persona + this request's mood — same recipe the server uses
      const sys = buildSystemPrompt(lang) + moodDirective(rollMood());

      try {
        const detected = apiKey.trim() ? detectKeyName(apiKey) : '';
        const customBase = apiBase.trim().length > 0;

        /* Google keys are called DIRECTLY from this phone: ROBIN's server
           sits in a region Google blocks (HK) — phones in India work. */
        if (detected === 'Google Gemini' && !customBase) {
          const key =
            extractKnownKey(sanitizeKey(apiKey)) ?? sanitizeKey(apiKey);
          const aiText = await googleDirectChat({
            apiKey: key,
            systemPrompt: sys,
            history,
            message: userText,
            modelOverride: model.trim() || undefined,
            signal: ac.signal,
          });
          await deliver(aiText);
          return;
        }

        /* No key at all → use the built-in key (Manoj's gift to every user).
           If Google refuses (quota/region/network), fall back to the server. */
        if (!apiKey.trim() && !customBase) {
          try {
            const aiText = await googleDirectChat({
              apiKey: builtinGoogleKey(),
              systemPrompt: sys,
              history,
              message: userText,
              signal: ac.signal,
            });
            await deliver(aiText);
            return;
          } catch (ge) {
            if (ge instanceof DOMException && ge.name === 'AbortError') return;
            console.warn(
              '[ROBIN] built-in Google brain unavailable → server fallback:',
              ge instanceof Error ? ge.message : ge
            );
            setState('thinking');
          }
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userText,
            history,
            lang,
            apiKey,
            apiBase,
            model,
          }),
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Chat failed');
        }
        await deliver(data.response);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Failed to respond';
        const authIssue =
          /401|403|x-token|unauthorized|api.?key|apikey/i.test(msg);
        toast.error('ROBIN hit a snag', {
          description: authIssue
            ? hasKey
              ? `${msg} — Check your key in Settings (key icon above).`
              : `${msg} — Add your own free API key: tap the key icon above.`
            : msg,
        });
        if (speakTokenRef.current >= 0 && !ac.signal.aborted) setState('idle');
      }
    },
    [messages, speak, lang, apiKey, apiBase, model]
  );

  /* ---------- Voice input ---------- */

  // Browser SpeechRecognition (used for Tamil — server ASR can't handle it)
  const startBrowserListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return false;
    let rec: SpeechRecognitionLike;
    try {
      rec = new SR();
    } catch {
      return false;
    }
    recRef.current = rec;
    let finalText = '';
    rec.lang = 'ta-IN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const result = e.results[e.resultIndex];
      const transcript = result?.[0]?.transcript ?? '';
      if (result?.isFinal && transcript.trim()) {
        finalText = transcript.trim();
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      toast.error('Voice input failed', { description: e.error });
    };
    rec.onend = () => {
      recRef.current = null;
      if (finalText) {
        askAssistant(finalText);
      } else {
        setState((s) => (s === 'listening' ? 'idle' : s));
      }
    };
    try {
      rec.start();
      setState('listening');
      return true;
    } catch {
      recRef.current = null;
      return false;
    }
  }, [askAssistant]);

  const startListening = useCallback(async () => {
    // Tamil mode → try the browser engine first (much better Tamil accuracy)
    if (lang === 'ta' && startBrowserListening()) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setupLevelMeter(stream);
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        teardownLevelMeter();
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, {
          type: 'audio/webm',
        });
        if (audioBlob.size < 1000) {
          setState('idle');
          return;
        }
        setState('thinking');
        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');
          const res = await fetch('/api/asr', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Could not transcribe');
          }
          const transcript: string = data.text;
          await askAssistant(transcript);
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : 'Speech recognition failed';
          toast.error('Could not hear that', { description: msg });
          setState('idle');
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('listening');
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === 'NotAllowedError'
            ? 'Microphone access denied. Please allow mic permissions.'
            : e.message
          : 'Could not access microphone';
      teardownLevelMeter();
      toast.error('Microphone unavailable', { description: msg });
      setState('idle');
    }
  }, [
    lang,
    startBrowserListening,
    askAssistant,
    setupLevelMeter,
    teardownLevelMeter,
  ]);

  const stopListening = useCallback(() => {
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
      return;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  /* ---------- Text input: works even while ROBIN is speaking/thinking ---------- */

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text || state === 'listening') return;
    if (state === 'speaking') stopSpeaking();
    setTextInput('');
    setShowHint(false);
    askAssistant(text);
  };

  // The avatar itself is the button: tap to talk, tap again to send,
  // tap while ROBIN is speaking to interrupt. During 'thinking' the tap
  // is ignored so the current turn can finish.
  const handleCompanionToggle = useCallback(() => {
    setShowHint(false);
    if (state === 'listening') {
      stopListening();
    } else if (state === 'speaking') {
      stopSpeaking();
    } else if (state === 'idle') {
      startListening();
    }
  }, [state, startListening, stopListening, stopSpeaking]);

  const clearChat = () => {
    chatAbortRef.current?.abort();
    speakTokenRef.current += 1;
    setMessages([]);
    setState('idle');
  };

  const cycleLang = () => {
    const next = LANG_CYCLE[(LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length];
    setLang(next);
    try {
      window.localStorage.setItem('robin-lang', next);
    } catch {
      /* private mode */
    }
  };

  /* ---------- Experience toggles (header buttons + Settings switches) ---------- */

  // Voice output ON/OFF — persisted. Turning it off cuts any speech mid-word.
  const applyVoice = useCallback((enabled: boolean) => {
    setMuted(!enabled);
    try {
      window.localStorage.setItem('robin-muted', enabled ? '0' : '1');
    } catch {
      /* private mode */
    }
    if (!enabled) {
      speakTokenRef.current += 1;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      setState((s) => (s === 'speaking' ? 'idle' : s));
    }
  }, []);

  // Girl animation ON/OFF — persisted. Off = still picture, everything else works.
  const applyAnimated = useCallback((v: boolean) => {
    setAnimated(v);
    try {
      window.localStorage.setItem('robin-anim', v ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-b from-[#0a0a1a] via-[#0d1126] to-[#050510] text-white relative overflow-hidden">
      {/* Ambient aurora background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full opacity-20 blur-[120px]"
          animate={{
            backgroundColor: STATE_COLORS[state],
            scale: [1, 1.12, 1],
          }}
          transition={{
            backgroundColor: { duration: 1.2, ease: 'easeInOut' },
            scale: { duration: 9, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
        <motion.div
          className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-violet-600/15 blur-[110px]"
          animate={{ x: [0, 70, -20, 0], y: [0, 50, 10, 0] }}
          transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-48 -right-32 w-[560px] h-[560px] rounded-full bg-cyan-500/10 blur-[120px]"
          animate={{ x: [0, -60, 30, 0], y: [0, -40, 25, 0] }}
          transition={{ duration: 23, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-fuchsia-500/[0.08] blur-[90px]"
          animate={{ x: [0, -40, 20, 0], y: [0, 30, -20, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 px-3 sm:px-6 py-4 sm:py-5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">ROBIN AI</h1>
            <p className="text-xs text-white/50 hidden sm:block">Your AI Companion</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleLang}
            className="text-white/70 hover:text-white hover:bg-white/10 gap-1.5 px-2 sm:px-3"
            title={LANG_META[lang].title}
          >
            <Globe className="w-4 h-4" />
            <span className="text-xs font-medium">{LANG_META[lang].label}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className={cn(
              'hover:bg-white/10 h-8 w-8',
              hasKey
                ? 'text-cyan-300 hover:text-cyan-200'
                : 'text-white/70 hover:text-white'
            )}
            title="API key settings"
          >
            <KeyRound className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => applyAnimated(!animated)}
            className={cn(
              'hover:bg-white/10 h-8 w-8',
              animated
                ? 'text-white/70 hover:text-white'
                : 'text-white/30 hover:text-white/60'
            )}
            title={animated ? 'Girl animation: on' : 'Girl animation: off'}
          >
            <PersonStanding className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => applyVoice(muted)}
            className={cn(
              'hover:bg-white/10 h-8 w-8',
              muted
                ? 'text-rose-300 hover:text-rose-200'
                : 'text-white/70 hover:text-white'
            )}
            title={muted ? 'Voice output: off' : 'Voice output: on'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white hover:bg-white/10 h-8 w-8 hidden sm:inline-flex"
            title="Download Android APK"
            onClick={() => window.open('/robin-ai.apk', '_blank')}
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearChat}
            className="text-white/70 hover:text-white hover:bg-white/10 h-8 w-8"
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Update banner — only appears inside the Android shell when a newer APK exists */}
      <AnimatePresence>
        {update && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 pl-4 pr-2 py-1.5 rounded-full bg-gradient-to-r from-cyan-500/25 to-violet-500/25 border border-cyan-400/40 backdrop-blur-xl shadow-lg shadow-cyan-500/10"
          >
            <button
              onClick={applyUpdate}
              className="flex items-center gap-2 text-xs font-medium text-cyan-100 hover:text-white"
              title={update.notes || 'Download the new APK'}
            >
              <Download className="w-3.5 h-3.5" />
              ROBIN v{update.versionName} ready — tap to update
            </button>
            <button
              onClick={dismissUpdate}
              className="p-1 text-white/40 hover:text-white/80"
              title="Dismiss this update"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row gap-6 px-4 sm:px-6 pb-6 min-h-0">
        {/* Avatar section — the girl herself is the mic button */}
        <section className="flex-1 flex flex-col items-center justify-center min-h-[340px] lg:min-h-0 relative">
          <motion.div
            className="relative w-full max-w-[440px] h-[440px] cursor-pointer"
            animate={{ scale: state === 'listening' ? 1.02 : 1 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          >
            <AICompanion
              state={state}
              onToggle={handleCompanionToggle}
              audioLevelRef={audioLevelRef}
              animated={animated}
            />
          </motion.div>

          {/* First-run hint — vanishes for good after the first interaction */}
          <div className="mt-1 h-10 flex items-start justify-center">
            <AnimatePresence>
              {showHint && state === 'idle' && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12, scale: 0.95 }}
                  transition={{ duration: 0.35 }}
                  className="px-4 py-2 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md"
                >
                  <p className="text-xs text-white/60 tracking-wide text-center">
                    Tap ROBIN to talk — tap again to send · தமிழிலும் பேசலாம்
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Chat panel */}
        <aside className="w-full lg:w-[380px] flex flex-col bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden min-h-[320px] max-h-[60vh] lg:max-h-none">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/90">Conversation</h2>
            <span className="text-[11px] text-white/40">{messages.length} messages</span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scroll">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400/20 to-violet-500/20 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-cyan-300" />
                </div>
                <p className="text-sm font-medium text-white/80 mb-1">
                  Say hello to ROBIN
                </p>
                <p className="text-xs text-white/40 leading-relaxed">
                  Tap ROBIN or type below — ask anything, in English or Tamil.{' '}
                  <span className="block mt-1 text-white/30">
                    ஆங்கிலம் அல்லது தமிழில் எதையும் கேளுங்கள்.
                  </span>
                </p>
                <a
                  href="/robin-ai.apk"
                  download="ROBIN-AI.apk"
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500/20 to-violet-500/20 border border-cyan-400/30 text-xs font-medium text-cyan-200 hover:from-cyan-500/30 hover:to-violet-500/30 hover:text-cyan-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Get the Android app (APK)
                </a>
              </div>
            ) : (
              messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'flex',
                    m.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-gradient-to-br from-cyan-500/80 to-violet-500/80 text-white rounded-br-sm'
                        : 'bg-white/8 text-white/90 border border-white/10 rounded-bl-sm'
                    )}
                  >
                    {m.content}
                  </div>
                </motion.div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Text input — always typeable, even while she is speaking */}
          <form
            onSubmit={handleTextSubmit}
            className="px-3 py-3 border-t border-white/10 flex items-center gap-2"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                state === 'listening'
                  ? 'Listening… (tap ROBIN to finish)'
                  : 'Type anytime — even while she answers…'
              }
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!textInput.trim() || state === 'listening'}
              className="bg-gradient-to-br from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white border-0 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </aside>
      </main>

      {/* ===== Settings modal — bring your own API key ===== */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1126]/95 p-5 shadow-2xl shadow-cyan-500/10"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-cyan-300" />
                  Connect your own AI
                </h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-white/50 hover:text-white"
                  aria-label="Close settings"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-white/45 leading-relaxed mb-4">
                Paste your own API key and ROBIN talks directly through it. Your
                key stays on this device and is only sent with your chat
                requests to this app&apos;s server.
              </p>

              {/* Experience toggles */}
              <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/90 flex items-center gap-2">
                      <PersonStanding className="w-3.5 h-3.5 text-cyan-300" />
                      Girl animation
                    </p>
                    <p className="text-[11px] text-white/40 leading-snug">
                      Poses, blinking &amp; lip-sync. Off = still picture.
                    </p>
                  </div>
                  <Switch
                    checked={animated}
                    onCheckedChange={applyAnimated}
                    className="data-[state=checked]:bg-cyan-500"
                    aria-label="Toggle girl animation"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/90 flex items-center gap-2">
                      {muted ? (
                        <VolumeX className="w-3.5 h-3.5 text-rose-300" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-cyan-300" />
                      )}
                      Voice output
                    </p>
                    <p className="text-[11px] text-white/40 leading-snug">
                      Speak answers out loud. Off = text only.
                    </p>
                  </div>
                  <Switch
                    checked={!muted}
                    onCheckedChange={applyVoice}
                    className="data-[state=checked]:bg-cyan-500"
                    aria-label="Toggle voice output"
                  />
                </div>
              </div>

              <label className="block text-[11px] font-medium text-white/60 mb-1">
                API key
              </label>
              <div className="relative mb-3">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your key here…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 pr-10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {(() => {
                const detected = detectKeyName(apiKey);
                if (detected) {
                  return (
                    <p className="text-[11px] text-emerald-300/80 mb-3 flex items-start gap-1.5">
                      <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        {detected} key detected — ROBIN connects to it
                        automatically, no setup needed.
                      </span>
                    </p>
                  );
                }
                if (apiKey.trim()) {
                  return (
                    <p className="text-[11px] text-amber-300/90 mb-3 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        ROBIN couldn&apos;t identify this key&apos;s provider.
                        A Google Gemini key starts with{' '}
                        <span className="font-mono">AIza</span> or the newer{' '}
                        <span className="font-mono">AQ.</span> — if yours came
                        from Google AI Studio, tap the link below, copy the
                        whole key, and paste it again. Z.ai keys still work.
                      </span>
                    </p>
                  );
                }
                return null;
              })()}

              <label className="block text-[11px] font-medium text-white/60 mb-1">
                API base URL <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="text"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder={API_BASE_PLACEHOLDER}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 mb-3"
              />

              <label className="block text-[11px] font-medium text-white/60 mb-1">
                Model <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={MODEL_PLACEHOLDER}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 mb-2"
              />

              <div className="flex flex-col gap-1 mb-4">
                {detectKeyName(apiKey) === 'Google Gemini' ||
                !detectKeyName(apiKey) ? (
                  <>
                    <a
                      href={GET_GEMINI_KEY_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      Get a free Gemini API key — Google AI Studio
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={GET_KEY_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
                    >
                      Or get a free Z.ai key — GLM-4.5-Flash
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                ) : (
                  <>
                    <a
                      href={GET_KEY_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      Get a free Z.ai API key — GLM-4.5-Flash is free
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={GET_GEMINI_KEY_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
                    >
                      Or get a free Gemini key — Google AI Studio
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>

              <div className="flex gap-2 mt-1">
                <Button
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white border-0"
                  onClick={() => {
                    // Save the healed key: junk stripped, buried key extracted
                    const savedKey = healKey(apiKey);
                    const providerName = detectKeyName(savedKey);
                    try {
                      if (savedKey) {
                        window.localStorage.setItem('robin-api-key', savedKey);
                      } else {
                        window.localStorage.removeItem('robin-api-key');
                      }
                      if (apiBase.trim()) {
                        window.localStorage.setItem(
                          'robin-api-base',
                          apiBase.trim()
                        );
                      } else {
                        window.localStorage.removeItem('robin-api-base');
                      }
                      if (model.trim()) {
                        window.localStorage.setItem(
                          'robin-api-model',
                          model.trim()
                        );
                      } else {
                        window.localStorage.removeItem('robin-api-model');
                      }
                    } catch {
                      /* private mode */
                    }
                    setApiKey(savedKey);
                    setHasKey(!!savedKey);
                    setShowSettings(false);
                    if (savedKey && providerName) {
                      toast.success(
                        `${providerName} key saved — ROBIN will use your own AI now`
                      );
                    } else if (savedKey) {
                      toast('Key saved — but its provider is unrecognized', {
                        description:
                          'A Google Gemini key starts with "AIza" or the newer "AQ.". If yours came from Google AI Studio, re-paste the whole key.',
                      });
                    } else {
                      toast.success(
                        'API key cleared — using the built-in backend'
                      );
                    }
                  }}
                >
                  Save
                </Button>
                {hasKey && (
                  <Button
                    variant="outline"
                    className="border-white/15 bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      setApiKey('');
                      setHasKey(false);
                      try {
                        window.localStorage.removeItem('robin-api-key');
                      } catch {
                        /* private mode */
                      }
                      toast.success(
                        'API key cleared — using the built-in backend'
                      );
                    }}
                  >
                    Clear key
                  </Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={audioRef} className="hidden" />

      <Toaster position="top-center" theme="dark" richColors closeButton />

      <style jsx global>{`
        .custom-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
