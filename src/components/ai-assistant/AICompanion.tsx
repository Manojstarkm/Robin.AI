'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AICompanionProps {
  state: AssistantState;
  onToggle?: () => void;
  /** Live mic amplitude (0..1) — drives the reactive aura while listening */
  audioLevelRef?: { current: number };
  /** When false the girl is a still picture — no loops, no lip-flap, no particles */
  animated?: boolean;
}

const STATE: Record<
  AssistantState,
  { hex: string; rgb: string; aura: number }
> = {
  idle: { hex: '#22d3ee', rgb: '34,211,238', aura: 0.4 },
  listening: { hex: '#34d399', rgb: '52,211,153', aura: 0.6 },
  thinking: { hex: '#a78bfa', rgb: '167,139,250', aura: 0.5 },
  speaking: { hex: '#fb7185', rgb: '251,113,133', aura: 0.65 },
};

// Deterministic particle layout (no Math.random in render → no hydration drift)
const PARTICLES = [
  { left: '12%', top: '22%', size: 4, dur: 7, delay: 0 },
  { left: '82%', top: '18%', size: 3, dur: 9, delay: 1.2 },
  { left: '6%', top: '58%', size: 3, dur: 8, delay: 0.6 },
  { left: '90%', top: '52%', size: 4, dur: 10, delay: 2 },
  { left: '20%', top: '82%', size: 3, dur: 7.5, delay: 1.6 },
  { left: '76%', top: '78%', size: 4, dur: 8.5, delay: 0.3 },
  { left: '42%', top: '10%', size: 3, dur: 9.5, delay: 2.4 },
  { left: '60%', top: '88%', size: 3, dur: 7, delay: 1 },
];

interface Ripple {
  id: number;
  x: number;
  y: number;
}

/* --- Minimal typings for the Web Speech API (Tamil voice input) --- */
interface SRResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface SRErrorEvent {
  error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function AICompanion({
  state,
  onToggle,
  audioLevelRef,
  animated = true,
}: AICompanionProps) {
  const [blink, setBlink] = useState(false);
  const [talking, setTalking] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const voiceGlowRef = useRef<HTMLDivElement>(null);

  const conf = STATE[state];

  /* --- Blink loop: natural random blinks every 2.6–5.8s --- */
  useEffect(() => {
    if (!animated) return;
    let alive = true;
    let t1 = 0;
    let t2 = 0;
    const schedule = () => {
      if (!alive) return;
      t1 = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = window.setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          schedule();
        }, 150);
      }, 2600 + Math.random() * 3200);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [animated]);

  /* --- Talk loop: alternate two mouth shapes while she is speaking --- */
  useEffect(() => {
    if (state !== 'speaking' || !animated) return;
    let alive = true;
    let t = 0;
    const flip = () => {
      if (!alive) return;
      setTalking((v) => !v);
      t = window.setTimeout(flip, 130 + Math.random() * 150);
    };
    t = window.setTimeout(flip, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [state, animated]);

  /* --- Audio-reactive listening: mic level drives the voice-glow layer --- */
  useEffect(() => {
    if (state !== 'listening' || !audioLevelRef || !animated) return;
    let raf = 0;
    const tick = () => {
      const el = voiceGlowRef.current;
      if (el) {
        const lvl = Math.min(1, audioLevelRef.current);
        el.style.opacity = String(0.18 + lvl * 0.55);
        el.style.transform = `translate(-50%, -50%) scale(${1 + lvl * 0.28})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      const el = voiceGlowRef.current;
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    };
  }, [state, audioLevelRef]);

  /* --- Mouse parallax (damped) --- */
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rotX = useSpring(rawX, { stiffness: 55, damping: 14, mass: 0.6 });
  const rotY = useSpring(rawY, { stiffness: 55, damping: 14, mass: 0.6 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!animated) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    rawX.set(-ny * 7);
    rawY.set(nx * 9);
  };

  const handleDown = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const id = Date.now() + Math.random();
      setRipples((r) => [
        ...r.slice(-4),
        { id, x: e.clientX - rect.left, y: e.clientY - rect.top },
      ]);
    }
    onToggle?.();
  };

  const maskStyle: React.CSSProperties = {
    WebkitMaskImage:
      'radial-gradient(ellipse 72% 64% at 50% 40%, black 50%, transparent 78%)',
    maskImage:
      'radial-gradient(ellipse 72% 64% at 50% 40%, black 50%, transparent 78%)',
  };

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      aria-label="ROBIN — tap to talk"
      className="group relative h-full w-full cursor-pointer select-none outline-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        rawX.set(0);
        rawY.set(0);
      }}
      onPointerDown={handleDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle?.();
        }
      }}
    >
      {/*
        ===== Layer 3: the girl — 6-frame animation system =====
        base (idle/breathing) · blink · listening pose · thinking pose ·
        two alternating talk frames (real lip-flap while audio plays)
      */}
      {/* ===== Layer 1: state aura glow ===== */}
      {animated ? (
        <motion.div
          className="absolute left-1/2 top-[40%] h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          animate={{
            backgroundColor: `rgba(${conf.rgb},${conf.aura})`,
            scale: [1, 1.12],
          }}
          transition={{
            backgroundColor: { duration: 1.1, ease: 'easeInOut' },
            scale: { duration: 4.5, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
      ) : (
        <div
          className="absolute left-1/2 top-[40%] h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-colors duration-1000"
          style={{ backgroundColor: `rgba(${conf.rgb},${conf.aura})` }}
        />
      )}
      {/* voice-reactive glow (mic amplitude while listening) */}
      {animated && (
        <div
          ref={voiceGlowRef}
          className="absolute left-1/2 top-[40%] h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-2xl"
          style={{
            backgroundColor: 'rgba(52,211,153,0.85)',
          }}
        />
      )}

      {/* ===== Layer 2: orbital rings ===== */}
      {animated ? (
        <>
          <div
            className="absolute left-1/2 top-[40%] h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed opacity-40 transition-colors duration-1000"
            style={{
              borderColor: conf.hex,
              animation: 'aura-spin 14s linear infinite',
            }}
          />
          <div
            className="absolute left-1/2 top-[40%] h-[92%] w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-20 transition-colors duration-1000"
            style={{
              borderColor: conf.hex,
              animation: 'aura-spin 22s linear infinite reverse',
            }}
          />
        </>
      ) : (
        <div
          className="absolute left-1/2 top-[40%] h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 opacity-30 transition-colors duration-1000"
          style={{ borderColor: conf.hex }}
        />
      )}

      {/* Listening sonar rings */}
      {animated && state === 'listening' && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute left-1/2 top-[40%] h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              style={{ borderColor: 'rgba(52,211,153,0.55)' }}
              animate={{ scale: [1, 1.55], opacity: [0.6, 0] }}
              transition={{
                duration: 1.7,
                repeat: Infinity,
                delay: i * 0.55,
                ease: 'easeOut',
              }}
            />
          ))}
        </>
      )}

      {/* Speaking pulse rings */}
      {animated && state === 'speaking' && (
        <>
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              className="absolute left-1/2 top-[40%] h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ boxShadow: `0 0 40px 6px rgba(251,113,133,0.35)` }}
              animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
              transition={{
                duration: 1.3,
                repeat: Infinity,
                delay: i * 0.65,
                ease: 'easeOut',
              }}
            />
          ))}
        </>
      )}

      {/* Thinking orbit dots */}
      {animated && state === 'thinking' && (
        <div
          className="absolute left-1/2 top-[13%] h-16 w-16 -translate-x-1/2"
          style={{ animation: 'aura-spin 2.4s linear infinite' }}
        >
          {[0, 120, 240].map((deg) => (
            <span
              key={deg}
              className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-violet-300 shadow-[0_0_10px_2px_rgba(167,139,250,0.8)]"
              style={{
                transform: `rotate(${deg}deg) translateY(-26px)`,
                transformOrigin: 'center center',
              }}
            />
          ))}
        </div>
      )}

      {/* ===== Layer 3: the girl (base / blink / talk crossfading frames) ===== */}
      {animated ? (
      <motion.div
        className="absolute inset-0"
        style={{
          rotateX: rotX,
          rotateY: rotY,
          transformPerspective: 900,
        }}
      >
        <motion.div
          className="absolute inset-0"
          animate={{
            y: [0, -9, 0],
            scaleY: [1, 1.012, 1],
          }}
          transition={{
            y: { duration: 5.5, repeat: Infinity, ease: 'easeInOut' },
            scaleY: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <img
            src="/robin-girl.png"
            alt="ROBIN"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top transition-[filter] duration-1000 group-hover:brightness-110"
            style={maskStyle}
          />
          {/* listening pose (distinct artwork) */}
          <img
            src="/robin-girl-listen.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              ...maskStyle,
              opacity: state === 'listening' ? 1 : 0,
              transition: 'opacity 180ms ease-out',
            }}
          />
          {/* thinking pose (distinct artwork) */}
          <img
            src="/robin-girl-think.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              ...maskStyle,
              opacity: state === 'thinking' ? 1 : 0,
              transition: 'opacity 180ms ease-out',
            }}
          />
          {/* blink frame (idle only) */}
          <img
            src="/robin-girl-blink.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              ...maskStyle,
              opacity: blink && state === 'idle' ? 1 : 0,
              transition: 'opacity 70ms linear',
            }}
          />
          {/* talking frame A (mouth open shape 1) */}
          <img
            src="/robin-girl-talk-a.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              ...maskStyle,
              opacity: talking && state === 'speaking' ? 1 : 0,
              transition: 'opacity 60ms linear',
            }}
          />
          {/* talking frame B (mouth open shape 2) — alternates with A */}
          <img
            src="/robin-girl-talk-b.png"
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              ...maskStyle,
              opacity: !talking && state === 'speaking' ? 1 : 0,
              transition: 'opacity 60ms linear',
            }}
          />
          {/* listening: emerald tint wash */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-700"
            style={{
              ...maskStyle,
              backgroundColor: 'rgba(52,211,153,0.14)',
              opacity: state === 'listening' ? 1 : 0,
            }}
          />
          {/* thinking: violet tint wash */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-700"
            style={{
              ...maskStyle,
              backgroundColor: 'rgba(167,139,250,0.13)',
              opacity: state === 'thinking' ? 1 : 0,
            }}
          />
          {/* speaking: rose tint wash */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-700"
            style={{
              ...maskStyle,
              backgroundColor: 'rgba(251,113,133,0.15)',
              opacity: state === 'speaking' ? 1 : 0,
            }}
          />
        </motion.div>
      </motion.div>
      ) : (
        <div className="absolute inset-0">
          <img
            src="/robin-girl.png"
            alt="ROBIN"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={maskStyle}
          />
          {/* single state tint wash — the only "live" thing left in static mode */}
          <div
            className="pointer-events-none absolute inset-0 transition-colors duration-1000"
            style={{
              ...maskStyle,
              backgroundColor: `rgba(${conf.rgb},0.14)`,
            }}
          />
        </div>
      )}

      {/* ===== Layer 4: floating particles ===== */}
      {animated &&
        PARTICLES.map((p, i) => (
          <span
            key={i}
            className="pointer-events-none absolute rounded-full transition-colors duration-1000"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              backgroundColor: conf.hex,
              opacity: 0.55,
              boxShadow: `0 0 ${p.size * 3}px ${conf.hex}`,
              animation: `aura-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
            }}
          />
        ))}

      {/* ===== Layer 5: click ripples ===== */}
      {ripples.map((r) => (
        <motion.span
          key={r.id}
          className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: r.x, top: r.y, borderColor: conf.hex }}
          initial={{ scale: 0, opacity: 0.8 }}
          animate={{ scale: 2.8, opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          onAnimationComplete={() =>
            setRipples((list) => list.filter((x) => x.id !== r.id))
          }
        />
      ))}

      <style jsx global>{`
        @keyframes aura-spin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        @keyframes aura-float {
          0%,
          100% {
            transform: translate(0, 0);
            opacity: 0.25;
          }
          50% {
            transform: translate(6px, -18px);
            opacity: 0.75;
          }
        }
      `}</style>
    </div>
  );
}
