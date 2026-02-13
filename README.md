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

Coded in ~15 minutes using [opencode](https://github.com/anomalyco/opencode) with Claude, GPT, and Gemini. The EQ presets and music are personal — the tool itself is general purpose.

---

<details>
<summary><strong>For AI agents</strong></summary>

Key things you won't get from reading the code:

- **Runtime is Bun, not Node.** `bun run server.ts` to start, `bun test` to test. No install step — zero dependencies.
- **User content goes in `music/` and `presets_for_shootout/`** (both gitignored). The app reads these directories on the fly via API.
- **The core architectural invariant:** all EQ variants are pre-rendered into separate `AudioBuffer`s, loudness-normalized, then played simultaneously through per-variant `GainNode`s. Switching active preset = setting one gain to 1 and the rest to 0. This is what makes switching instant. Don't break this — if you make variants play sequentially or recreate sources on switch, you'll get gaps.
- **EQ math uses manual RBJ biquad coefficients**, not Web Audio `BiquadFilterNode`, to avoid shelf filter Q-mapping ambiguity with EqualizerAPO. The implementation is in `audio-engine.js`.
- **API routes:** `GET /api/presets` (parsed from `presets_for_shootout/`), `GET /api/tracks` (from `music/`), `GET /music/:filename` (WAV serving with range support).

</details>

## License

MIT
