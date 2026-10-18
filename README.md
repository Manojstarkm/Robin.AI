# ROBIN AI — Your Voice AI Companion

ROBIN AI is a real-time, browser-based voice assistant with an animated
holographic girl avatar. Tap the avatar to speak (or type — even while ROBIN
is answering), ask anything in English or Tamil, and hear the answer spoken
back to you instantly.

## Features

- **Tap-to-talk avatar** — click the animated companion to start the mic, tap
  again (or press send) to deliver the question
- **3-frame character animation** — idle breathing, random blinking and a
  talking lip-flap frame, driven by assistant state (idle / listening /
  thinking / speaking), each with its own glow color and orbital rings
- **Talk while she speaks** — the text input is never locked; sending a new
  question interrupts playback and cancels in-flight requests
- **English + Tamil** — auto language detection plus a manual
  Auto / தமிழ் / English switch; Tamil uses native browser voices when
  available, with a server-side TTS fallback
- **Bring your own API key** — paste a Z.ai (or any OpenAI-compatible) key
  in Settings (key icon); ROBIN then calls the model directly with your key
  (`glm-4.5-flash` is free) instead of relying on the shared backend
- **6-pose avatar animation** — distinct listening and thinking poses plus
  two alternating talk frames, and the lip animation starts only when the
  voice is actually audible
- **Ask anything** — configured for open, direct answers across topics
- **Android app** — signed WebView-shell APK with a cyber-robin launcher icon

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript |
| Styling | Tailwind CSS 4 · shadcn/ui |
| Animation | framer-motion (layered avatar, parallax, particles) |
| AI services | z-ai-web-dev-sdk — chat completions, ASR, TTS |
| Database | Prisma + SQLite (local data) |
| Voice I/O | Web Speech API (SpeechRecognition / speechSynthesis) + server TTS |
| Android | WebView shell APK built with aapt2 / d8 / apksigner |

## Getting Started

### Prerequisites

- Node.js 20+ (or Bun)
- A Z.ai environment / credentials for `z-ai-web-dev-sdk` — the chat, ASR and
  TTS routes call this SDK server-side, so clone-and-run requires your own
  access to it

### Install and run

```bash
# 1. install dependencies
bun install        # or: npm install

# 2. configure environment
cp .env.example .env

# 3. create the local SQLite database
bun run db:push    # or: npm run db:push

# 4. start the dev server
bun run dev        # or: npm run dev
```

Open http://localhost:3000, allow microphone access, then tap ROBIN to talk.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Chat completions with history + language hint (`auto` / `en` / `ta`) |
| `/api/asr` | POST | Server-side speech-to-text fallback |
| `/api/tts` | POST | Server-side text-to-speech fallback (900-char chunking) |

## Language Support

The header button cycles **Auto → தமிழ் → English** (stored in
`localStorage`). In Auto mode ROBIN replies in whichever language you write
in. For Tamil voice:

- **Output**: the app prefers a native `ta-IN` browser voice via
  `speechSynthesis`; if none is installed it falls back to the server TTS
- **Input**: browser `SpeechRecognition` runs with `ta-IN` first and falls
  back to the server ASR endpoint

## Android APK

`scripts/build-apk.sh` assembles and signs the APK (launcher label
**ROBIN AI**, versionName 1.2.0) with a raw aapt2 → javac → d8 → zipalign →
apksigner pipeline:

```bash
./scripts/build-apk.sh         # outputs download/ROBIN-AI.apk
python3 scripts/verify-apk.py  # structure + signature + URL sanity check
```

Requirements: JDK 21, Android build-tools 34 with the android-34 platform
jar, and a standalone D8 jar (`r8-new.jar`). Adjust the `TOOLS` paths at the
top of the script for your machine.

## Repository Hygiene

- No API keys or credentials are committed — `.env` is gitignored and only
  ever held a local SQLite path
- Sandbox and build artifacts (agent worklogs, sandbox scripts, local
  databases, generated APKs, test screenshots/audio) are excluded via
  `.gitignore`
- History is a single clean snapshot commit

## License

MIT — see [LICENSE](LICENSE).
