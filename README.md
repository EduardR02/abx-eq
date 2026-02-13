# abx-eq

Blind preference testing for headphone EQ presets. Find your actual optimum, not your placebo.

## What / Why

Switching between EQ presets in your EQ software is hopelessly biased — loudness differences, placebo, and knowing which preset you're hearing contaminate every judgment. This tool removes all of that.

Drop your `.wav` tracks and EqualizerAPO `.txt` presets into the right folders, start the server, and run a proper blind shootout. The tool renders each track through each EQ preset offline, loudness-matches via K-weighting, and plays all variants simultaneously with gain-node gating — switching is instant, gapless, and sample-locked. You never see preset names during the test.

Pairs are scheduled adaptively (round-robin first, then uncertainty sampling on the closest-ranked presets). Rankings use the Bradley-Terry model, which is order-independent unlike ELO. There's also an ABX mode if you just want to check whether you can hear a difference at all.

## Features

- Blind A/B preference test with randomized assignment
- ABX identification test
- EQ rendering via Robert Bristow-Johnson biquad cookbook (not Web Audio BiquadFilterNode — exact coefficient match with EqualizerAPO)
- K-weighted loudness matching
- Instant switching — all variants play simultaneously, gain-node crossfade in 5ms
- Loop mode with draggable region selection
- Adaptive pair scheduling (uncertainty sampling after initial round-robin)
- Bradley-Terry ranking + per-pair significance testing (binomial sign test)
- EqualizerAPO / AutoEQ preset format
- Zero dependencies — Bun + vanilla JS + Web Audio API
- Fully local, nothing leaves your machine

## Quick start

```bash
git clone https://github.com/EduardR02/abx-eq.git
cd abx-eq

mkdir music presets_for_shootout
# drop .wav files into music/
# drop EqualizerAPO .txt presets into presets_for_shootout/

bun run server.ts
# http://localhost:3000
```

## Preset format

Standard EqualizerAPO format:

```
Preamp: -5.9 dB
Filter 1: ON LSC Fc 60 Hz Gain 5.55 dB Q 0.858
Filter 2: ON PK Fc 350 Hz Gain -1.57 dB Q 0.599
Filter 3: ON PK Fc 2204 Hz Gain 1.73 dB Q 1.414
```

`LSC` = low shelf, `PK` = peaking, `HSC` = high shelf.

## How it works

1. Each track is rendered offline through each preset's biquad filter chain, then loudness-normalized
2. All rendered variants play simultaneously — only the active variant's gain node is non-zero
3. Switching = swapping gain values with a 5ms crossfade. Zero gap, zero click.
4. Pairs scheduled adaptively: round-robin for initial coverage, then uncertainty sampling focuses on the closest-ranked presets

## Built with

Coded in ~15 minutes using [opencode](https://github.com/nichochar/opencode) with Claude, GPT, and Gemini. The EQ presets and music are personal — the tool itself is general purpose.

---

<details>
<summary><strong>AI context</strong> (for LLMs / agents reading this repo)</summary>

### Setup

- Runtime: [Bun](https://bun.sh) (no Node — uses Bun's native test runner and HTTP server)
- No `npm install` needed — zero dependencies
- Start: `bun run server.ts` → serves on `http://localhost:3000`
- Tests: `bun test` (36 tests)

### Structure

```
server.ts                  Bun HTTP server — serves static files + API
public/
  index.html               SPA shell
  style.css                Dark theme styles
  app.js                   Main application logic, UI flow, state management
  audio-engine.js          Web Audio API: offline EQ rendering, LUFS measurement,
                           loudness normalization, simultaneous playback, gain-node switching
  eq-parser.js             EqualizerAPO format parser
  bradley-terry.js         Bradley-Terry model (MLE ranking from pairwise preferences)
  elo.js                   ELO rating (secondary ranking)
  matchup-scheduler.js     Adaptive pair scheduling (round-robin + uncertainty sampling)
  stats.js                 Binomial sign test, p-values, power calculations
  round-plan.js            Matchup budget suggestions
  abx-run.js               ABX trial state management
tests/                     Bun test files (*.test.js / *.test.ts)
music/                     User's .wav files (gitignored)
presets_for_shootout/      User's EqualizerAPO .txt presets (gitignored)
```

### API

- `GET /api/presets` — parsed preset list from `presets_for_shootout/`
- `GET /api/tracks` — track filenames from `music/`
- `GET /music/:filename` — serves WAV files (supports range requests)

</details>

## License

MIT
