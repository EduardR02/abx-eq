# abx-eq

Blind pairwise preference testing for headphone EQ presets — find your actual optimum, not your placebo.

## What this is

A local web tool for rigorously comparing parametric EQ presets through blind A/B preference testing. It uses the Web Audio API to render EQ filters offline, loudness-matches all variants via K-weighted LUFS, and plays them simultaneously with gain-node gating for perfectly instant, gapless switching. Results are ranked with the Bradley-Terry model and adaptive pair scheduling.

## Why this exists

Choosing between EQ presets by switching back and forth in your EQ software is hopelessly biased: loudness differences, placebo effects, and knowing which preset you're hearing contaminate every judgment. This tool eliminates all of that with blind, loudness-matched, statistically rigorous testing.

## Features

- Blind A/B preference test with randomized assignment
- ABX identification test (can you even hear the difference?)
- Real-time EQ rendering via exact Robert Bristow-Johnson biquad cookbook formulas
- K-weighted loudness matching across all variants
- Instant, gapless switching (all variants play simultaneously via gain-node gating)
- Loop mode with draggable region selection for focused A/B comparison
- Adaptive pair scheduling (uncertainty sampling after initial round-robin)
- Bradley-Terry ranking (order-independent, unlike ELO)
- Per-pair statistical significance (binomial sign test)
- Supports EqualizerAPO / AutoEQ preset format
- Zero dependencies — Bun server + vanilla JS + Web Audio API
- Everything runs locally, nothing uploaded

## Quick start

```bash
# Clone
git clone https://github.com/edrantsevich/abx-eq.git
cd abx-eq

# Add your files
mkdir music presets_for_shootout
# Drop .wav files into music/
# Drop EqualizerAPO .txt presets into presets_for_shootout/

# Run
bun run server.ts
# Open http://localhost:3000
```

## EQ preset format

```txt
Preamp: -5.9 dB
Filter 1: ON LSC Fc 60 Hz Gain 5.55 dB Q 0.858
Filter 2: ON PK Fc 350 Hz Gain -1.57 dB Q 0.599
Filter 3: ON PK Fc 2204 Hz Gain 1.73 dB Q 1.414
```

Supports `LSC` (low shelf), `PK` (peaking), and `HSC` (high shelf).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| 1 / A | Switch to A |
| 2 / B | Switch to B |
| Space | Play / Pause |
| ← → | Rewind / Skip 5s |
| Z | Vote A |
| X | Vote Tie |
| C | Vote B |
| L | Toggle loop |
| [ | Set loop start |
| ] | Set loop end |

## How it works

- Each track is rendered offline through each EQ preset's filter chain, then loudness-normalized.
- All rendered variants play simultaneously; only the active variant's gain node is non-zero.
- Switching swaps gain values with a 5 ms crossfade: zero gap, zero click, sample-locked sync.
- Pairs are scheduled adaptively: first round-robin for coverage, then uncertainty sampling targets the closest-ranked presets.

## License

MIT
