# abx-eq

Your headphones could sound better. EQ fixes that — congrats, you're now smarter than most youtube "reviewers". The problem is picking the right preset when you have ten of them and no way to compare without bias creeping in.

This is a blind A/B testing tool for EQ presets. Drop in your music, drop in your presets, and just pick whichever sounds better. You never see which is which. At the end you get a nice ranking. That's it.
If you don't know where to start, you can use [PEQDB](https://peqdb.com) to get an initial target that's much better than Harman.

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

# optional: open Setup -> Directories in the web UI
# and switch to custom music/preset folders
```

## Configuration

By default, the app reads tracks from `music/` and presets from `presets_for_shootout/`.

You can change both at runtime from the web UI:

1. Open **Setup**
2. Expand **Directories**
3. Enter project-relative paths for music and presets
4. Click **Apply** to validate and reload presets/tracks

The server validates both directories before accepting the change.

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

## Loudness normalization

Fair comparison needs loudness matching — otherwise you'll just prefer whichever version is louder. The question is *how* to measure loudness, and the answer depends on what you're comparing.

The tool offers four normalization modes (selectable in Setup before starting a test):

**Ear sensitivity 1–4 kHz (default, recommended)**
Measures RMS energy only in the 1–4 kHz band — where your ear is most sensitive (ear canal resonance peaks around 2.7 kHz) — and normalizes all presets to match there. Everything outside that band is untouched. This means if one preset boosts bass and another boosts treble sparkle, both differences are fully preserved — only the "perceived volume" is matched.

This is the right choice for most EQ comparisons because EQ presets rarely differ in the 1–4 kHz region (most differences are in bass and 8 kHz+ air/sparkle), so the normalization doesn't eat real differences.

**Treble-matched 2–10 kHz**
Same idea but wider band. Matches the full treble region. Less accurate — if two presets differ in sparkle or sibilance, this partially absorbs those differences into the gain correction.

**Flat RMS**
Unweighted RMS across the full spectrum. Treats bass and treble energy equally. Works OK when presets have similar tonal balance, but if one preset boosts bass heavily, the treble ends up quieter (which is the whole problem we were trying to solve).

**K-weighted LUFS (ITU-R BS.1770-4)**
The broadcast standard. Uses a +4 dB high-shelf above 1.5 kHz and a highpass at 38 Hz. Originally designed for broadcast loudness compliance, not EQ comparison. The K-weighting actually makes the problem worse for our use case: it overvalues treble energy and undervalues bass, so a bass-boosted preset sounds quieter than it should after normalization.

### How we got here

The original implementation used K-weighted LUFS — the "correct" standard. But in practice, comparing a bass-boosting EQ preset against flat/no-EQ, the flat version consistently sounded "more detailed" and "clearer" simply because its treble was louder after normalization. The bass energy was being discounted by K-weighting.

Flat RMS helped but didn't fully solve it. The key insight: when you listen to music and adjust the volume, you're matching the 1–4 kHz region — where your ear is most sensitive. Bass isn't perceived as "loudness" in the same way. So the fairest normalization matches energy in that sensitivity band and lets bass/treble differences speak for themselves.

This is still an evolving area. The 1–4 kHz default works well for typical headphone EQ comparisons but isn't perfect for every scenario — hence the four options.

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
- **API routes:** `GET /api/config` (current directory config), `POST /api/config` (update `musicDir` / `presetsDir`), `GET /api/presets`, `GET /api/tracks`, `GET /music/:filename` (WAV serving with range support).

</details>

## License

MIT
