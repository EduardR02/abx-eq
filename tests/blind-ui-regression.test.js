import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const adaptersSource = readFileSync(join(import.meta.dir, "..", "public", "source-adapters.js"), "utf8");
const htmlSource = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");
const styleSource = readFileSync(join(import.meta.dir, "..", "public", "style.css"), "utf8");

describe("blind UI regression checks", () => {
  test("preference screen keeps matchup labels blinded", () => {
    expect(appSource).not.toContain("dom.matchupMeta.textContent = `A:");
  });

  test("preference screen includes reveal controls and post-reveal actions", () => {
    expect(htmlSource).toContain('id="reveal-area"');
    expect(htmlSource).toContain('id="reveal-btn"');
    expect(htmlSource).toContain('id="reveal-confirm"');
    expect(htmlSource).toContain('id="reveal-yes"');
    expect(htmlSource).toContain('id="reveal-cancel"');
    expect(htmlSource).toContain('id="verdict-row"');
    expect(htmlSource).toContain('id="revealed-actions"');
    expect(htmlSource).toContain('id="revealed-results"');
    expect(htmlSource).toContain('id="revealed-setup"');
  });

  test("reveal flow preserves A/B listening and ends only voting", () => {
    expect(appSource).toContain("isRevealed: false,");
    expect(appSource).toContain("function revealPresets() {");
    expect(appSource).toContain("dom.verdictRow.classList.add(\"hidden\");");
    expect(appSource).toContain("dom.revealedActions.classList.remove(\"hidden\");");
    expect(appSource).toContain("dom.revealArea.classList.add(\"hidden\");");
    expect(appSource).toContain("switchEnabled: !state.isAdvancingPreference,");
    expect(appSource).toContain("verdictEnabled: !state.isAdvancingPreference && !state.isRevealed,");
    expect(appSource).toContain("if (!pair || state.isAdvancingPreference || state.isRevealed) {");
    expect(appSource).toContain("!state.isRevealed && key === \"z\"");
    expect(appSource).toContain("!state.isRevealed && key === \"x\"");
    expect(appSource).toContain("!state.isRevealed && key === \"c\"");
  });

  test("reveal controls use rose pine visual tokens", () => {
    expect(styleSource).toContain(".reveal-area");
    expect(styleSource).toContain(".reveal-link");
    expect(styleSource).toContain(".reveal-confirm");
    expect(styleSource).toContain(".reveal-warning");
    expect(styleSource).toContain(".reveal-action");
    expect(styleSource).toContain(".revealed-names");
    expect(styleSource).toContain(".revealed-names .preset-label");
  });

  test("ABX run screen keeps pair labels blinded", () => {
    expect(appSource).toContain('dom.abxNowText.textContent = "Testing pair: A vs B";');
  });

  test("tie terminology is consistent in controls and hints", () => {
    expect(appSource).toContain("tie: document.getElementById(\"prefer-draw\")");
    expect(appSource).not.toContain("No preference");
    expect(htmlSource).toContain("It's a tie");
    // Updated for new shortcut legend design
    expect(htmlSource).toContain("<kbd>X</kbd> Tie");
  });

  test("new preference matchup starts with A visually active", () => {
    expect(appSource).toContain("audio.setActiveVariant(pair.presetA);");
    expect(appSource).toContain("setActiveButton(dom.buttonA, true);");
    expect(appSource).toContain("setActiveButton(dom.buttonB, false);");
  });

  test("background gradients stay seamless during scrolling", () => {
    expect(styleSource).toContain("radial-gradient(circle at 12% 10%");
    expect(styleSource).toContain("radial-gradient(circle at 88% 0%");
    expect(styleSource).toContain("rgba(196, 167, 231, 0.14)");
    expect(styleSource).toContain("rgba(235, 111, 146, 0.12)");
    expect(styleSource).toContain("background-attachment: fixed;");
    expect(styleSource).toContain("background-color: transparent;");
  });

  test("setup includes configurable directories controls", () => {
    expect(htmlSource).toContain('id="directories-panel"');
    expect(htmlSource).toContain('id="music-dir-input"');
    expect(htmlSource).toContain('id="music-dir-browse"');
    expect(htmlSource).toContain('id="presets-dir-input"');
    expect(htmlSource).toContain('id="presets-dir-browse"');
    expect(htmlSource).toContain('id="apply-directories"');
    expect(appSource).toContain("state.source.supportsDirectoryConfig");
    expect(adaptersSource).toContain('fetch("/api/config"');
    expect(adaptersSource).toContain('"/api/browse"');
    expect(adaptersSource).toContain('"/api/presets"');
    expect(adaptersSource).toContain('"/api/tracks"');
  });

  test("setup includes local file loading controls for static mode", () => {
    expect(htmlSource).toContain('id="local-file-area"');
    expect(htmlSource).toContain('id="drop-zone"');
    expect(htmlSource).toContain('id="file-picker-btn"');
    expect(htmlSource).toContain('id="file-picker-input"');
    expect(htmlSource).toContain('id="local-file-list"');
    expect(appSource).toContain("function renderLocalFileList()");
    expect(styleSource).toContain(".drop-zone");
    expect(styleSource).toContain(".drop-zone.is-dragover");
  });

  test("loop range uses a dedicated animated playback row", () => {
    expect(htmlSource).toContain('id="loop-info-row"');
    expect(htmlSource).toContain('id="loop-times"');
    expect(htmlSource.indexOf('id="loop-info-row"')).toBeLessThan(htmlSource.indexOf('class="controls-row"'));
    expect(appSource).toContain("function formatLoopRangeLabel(startTime, endTime)");
    expect(appSource).toContain('return `Loop: ${formatTime(startTime)} - ${formatTime(endTime)}`;');
    expect(appSource).toContain("dom.loopInfoRow.classList.toggle(\"is-active\", loopActive);");
    expect(appSource).toContain("dom.timeLabel.textContent = formatTimeLabel(currentTime, duration);");
    expect(styleSource).toContain(".loop-info-row");
    expect(styleSource).toContain("transition: max-height 0.3s ease");
    expect(styleSource).toContain("min-width: max-content;");
  });

  test("loop handles follow the range thumb travel path", () => {
    expect(styleSource).toContain("--seek-thumb-size: 12px;");
    expect(styleSource).toContain("width: var(--seek-thumb-size);");
    expect(styleSource).toContain("height: var(--seek-thumb-size);");
    expect(appSource).toContain("function getSeekThumbTravelBounds() {");
    expect(appSource).toContain("const minX = sliderRect.left + thumbRadius;");
    expect(appSource).toContain("const maxX = sliderRect.right - thumbRadius;");
    expect(appSource).toContain("const startPercent = getSeekPositionPercent(range.startTime, duration);");
    expect(appSource).toContain("const endPercent = getSeekPositionPercent(range.endTime, duration);");
    expect(appSource).toContain("const clampedX = Math.min(bounds.maxX, Math.max(bounds.minX, clientX));");
  });

  test("preference progress only uses inline text, not toast popups", () => {
    const toastReferenceCount = appSource.match(/showPreferenceToast\(/g)?.length ?? 0;
    expect(toastReferenceCount).toBe(0);
    expect(appSource).toContain('dom.prefProgress.textContent = `Matchup ${matchupNumber} of ${progress.total} (${formatPhaseLabel(progress.phase)})`;');
  });

  test("playback transport uses SVG icons", () => {
    expect(htmlSource).toContain('id="play-pause" class="icon-btn play-main"');
    expect(htmlSource).toContain("<svg viewBox=\"0 0 24 24\"");
    expect(appSource).toContain("dom.playPauseBtn.innerHTML = playback.isPlaying ? PAUSE_ICON_SVG : PLAY_ICON_SVG;");
  });

  test("setup screen includes an inline reset scores action", () => {
    const setupActions = '<div class="actions stacked">';
    const resetButton = '<button id="reset-scores" class="reset-scores" type="button">Reset All Scores</button>';

    expect(htmlSource).toContain(setupActions);
    expect(htmlSource).toContain(resetButton);
    expect(htmlSource.indexOf(resetButton)).toBeLessThan(htmlSource.indexOf(setupActions));
    expect(styleSource).toContain(".reset-scores {");
    expect(styleSource).toContain(".reset-scores.is-confirming {");
    expect(styleSource).toContain(".reset-scores.is-done {");
  });

  test("reset scores flow uses integrated confirmation and clears stored runs", () => {
    expect(appSource).toContain('resetScores: document.getElementById("reset-scores"),');
    expect(appSource).toContain('dom.resetScores.addEventListener("click", () => {');
    expect(appSource).toContain('dom.resetScores.classList.contains("is-confirming")');
    expect(appSource).toContain("state.store.preferenceMatches = [];");
    expect(appSource).toContain("state.store.abxRuns = [];");
    expect(appSource).toContain("saveStore();");
    expect(appSource).toContain("setTimeout(() => {");
    expect(appSource).not.toContain("window.confirm(");
  });

  test("head-to-head matrix cells prioritize winrate with layered metadata", () => {
    expect(appSource).toContain("const winRate = hasDecisiveOutcomes ? cell.wins / decisiveOutcomes : null;");
    expect(appSource).toContain("const winRateText = Number.isFinite(winRate) ? `${Math.round(winRate * 100)}%` : \"—\";");
    expect(appSource).toContain("content.className = \"cell-content\";");
    expect(appSource).toContain("winRateEl.className = \"cell-winrate\";");
    expect(appSource).toContain("recordEl.className = \"cell-record\";");
    expect(appSource).toContain("pValueEl.className = \"cell-pvalue\";");
    expect(appSource).toContain("const matrixWinRateColor = getWinRateTextColor(winRate, pValue);");
    expect(appSource).toContain("winRateEl.style.color = matrixWinRateColor;");
    expect(appSource).toContain("td.style.background = matrixTint;");
  });

  test("standings win rate uses the same value-based color cue", () => {
    expect(appSource).toContain("const standingsWinRateColor = getWinRateTextColor(row.winRate);");
    expect(appSource).toContain('<span class="standings-winrate"');
    expect(styleSource).toContain(".standings-winrate");
  });

  test("head-to-head matrix uses dedicated rose pine table styling", () => {
    expect(styleSource).toContain(".matrix .cell-winrate");
    expect(styleSource).toContain(".matrix .cell-record");
    expect(styleSource).toContain(".matrix .cell-pvalue");
    expect(styleSource).toContain(".matrix td.cell-empty");
    expect(styleSource).toContain(".matrix .matrix-header-label");
  });
});
