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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function AssistantApp() {
  const [state, setState] = useState<AssistantState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState('');
  const [muted, setMuted] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [lang, setLang] = useState<LangMode>('auto');

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

  // Restore saved language preference
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('aura-lang');
      if (saved === 'auto' || saved === 'en' || saved === 'ta') setLang(saved);
    } catch {
      /* private mode */
    }
  }, []);

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

  // Native browser Tamil voice (high quality on Chrome / Android when installed)
  const speakWithBrowserTamil = useCallback((text: string, token: number) => {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window))
        return false;
      const synth = window.speechSynthesis;
      const voice = synth
        .getVoices()
        .find((v) => v.lang?.toLowerCase().startsWith('ta'));
      if (!voice) return false;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.95;
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
      if (muted || !text.trim()) {
        setState('idle');
        return;
      }
      const token = ++speakTokenRef.current;
      setState('speaking');

      const wantsTamil =
        lang === 'ta' || (lang === 'auto' && TAMIL_RE.test(text));
      if (wantsTamil && speakWithBrowserTamil(text, token)) return;

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: 'tongtong', speed: 1.0 }),
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
          await audioRef.current.play().catch(() => {
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

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userText, history, lang }),
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Chat failed');
        }
        if (ac.signal.aborted) return;
        const aiText: string = data.response;
        const aiMsg: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: aiText,
        };
        setMessages((prev) => [...prev, aiMsg]);
        await speak(aiText);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Failed to respond';
        toast.error('ROBIN hit a snag', { description: msg });
        if (speakTokenRef.current >= 0 && !ac.signal.aborted) setState('idle');
      }
    },
    [messages, speak, lang]
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
      window.localStorage.setItem('aura-lang', next);
    } catch {
      /* private mode */
    }
  };

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
      <header className="relative z-10 px-6 py-5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">ROBIN AI</h1>
            <p className="text-xs text-white/50">Your AI Companion</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleLang}
            className="text-white/70 hover:text-white hover:bg-white/10 gap-1.5 px-3"
            title={LANG_META[lang].title}
          >
            <Globe className="w-4 h-4" />
            <span className="text-xs font-medium">{LANG_META[lang].label}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMuted((m) => !m)}
            className="text-white/70 hover:text-white hover:bg-white/10"
            title={muted ? 'Unmute speaker' : 'Mute speaker'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearChat}
            className="text-white/70 hover:text-white hover:bg-white/10"
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

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
