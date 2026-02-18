import { AudioEngine } from "./audio-engine.js";
import { buildHeadToHead, buildStandings } from "./elo.js";
import { buildBradleyTerryStandings } from "./bradley-terry.js";
import { MatchupScheduler } from "./matchup-scheduler.js";
import {
  accuracy,
  binomialTailProbability,
  formatPercent,
  isSignificant,
  pairPreferencePValue,
} from "./stats.js";
import { advanceAbxRunTrial } from "./abx-run.js";
import {
  ROUND_PLAN_TIERS,
  buildRoundPlanSuggestions,
  pairCountForPresetCount,
} from "./round-plan.js";

const STORAGE_KEY = "abxEqState.v1";
const NO_EQ_ID = "__no_eq__";
const TRANSITION_MS = 150;
const ROUND_COMPLETE_MS = 600;
const LOOP_DEFAULT_SECONDS = 10;
const LOOP_MIN_SECONDS = 1;
const PLAYBACK_HIDE_MS = 420;
const SEEK_THUMB_SIZE_CSS_VAR = "--seek-thumb-size";
const SEEK_THUMB_RADIUS_FALLBACK_PX = 6;
const RESET_CONFIRM_MS = 3000;
const RESET_DONE_MS = 1500;
const RESET_SCORES_DEFAULT_TEXT = "Reset All Scores";
const RESET_SCORES_CONFIRM_TEXT = "Confirm Reset?";
const RESET_SCORES_DONE_TEXT = "Scores Cleared";
const DIRECTORY_DETAILS_STORAGE_KEY = "abxEq.directoryDetailsOpen.v1";
const MATRIX_NEUTRAL_WINRATE = 0.5;
const MATRIX_EXTREME_DELTA = 0.2;
const MATRIX_MIN_ALPHA = 0.08;
const MATRIX_MAX_ALPHA = 0.2;
const MATRIX_STRONG_SIGNIFICANCE_P = 0.05;
const MATRIX_MIN_SIGNIFICANCE_SCALE = 0.2;
const MATRIX_NEUTRAL_RGB = [224, 222, 244];
const MATRIX_SUCCESS_RGB = [156, 207, 216];
const MATRIX_DANGER_RGB = [235, 111, 146];
const MATRIX_TEXT_MAX_MIX = 0.82;
const MATRIX_TEXT_MIN_CONFIDENCE_SCALE = 0.62;


const PLAY_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="icon-fill" d="M8 6L18 12L8 18V6Z"></path>
  </svg>
`;

const PAUSE_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect class="icon-fill" x="7" y="6" width="4" height="12" rx="1"></rect>
    <rect class="icon-fill" x="13" y="6" width="4" height="12" rx="1"></rect>
  </svg>
`;

const state = {
  presets: [],
  tracks: [],
  selectedPresetIds: [],
  selectedTrack: "",
  normalizationMode: "earsens",
  mode: null,
  selectionKey: "",

  selectedMatchups: 1,
  selectedRoundPlan: "standard",
  roundPlanSuggestions: {
    quick: 1,
    standard: 1,
    rigorous: 1,
  },

  preferenceScheduler: null,
  currentPreferencePair: null,
  activePreferenceMatches: [],
  isAdvancingPreference: false,

  abxPairs: [],
  abxRun: null,
  abxListeningTarget: "A",

  store: {
    preferenceMatches: [],
    abxRuns: [],
  },

  isSeekDragging: false,
  isLoopHandleDragging: false,
  loopDragHandle: null,
  loopDragPointerId: null,
  prepareToken: 0,
  playbackHideTimer: null,
};

const audio = new AudioEngine();

const dom = {
  backToSetup: document.getElementById("back-to-setup"),
  setupScreen: document.getElementById("setup-screen"),
  loadingScreen: document.getElementById("loading-screen"),
  preferenceScreen: document.getElementById("preference-screen"),
  roundCompleteScreen: document.getElementById("round-complete-screen"),
  abxScreen: document.getElementById("abx-screen"),
  resultsScreen: document.getElementById("results-screen"),
  playbackControls: document.getElementById("playback-controls"),

  setupError: document.getElementById("setup-error"),
  directoriesPanel: document.getElementById("directories-panel"),
  musicDirInput: document.getElementById("music-dir-input"),
  presetsDirInput: document.getElementById("presets-dir-input"),
  musicDirBrowseBtn: document.getElementById("music-dir-browse"),
  presetsDirBrowseBtn: document.getElementById("presets-dir-browse"),
  applyDirectoriesBtn: document.getElementById("apply-directories"),
  directoriesFeedback: document.getElementById("directories-feedback"),
  presetList: document.getElementById("preset-list"),
  setupTrackSelect: document.getElementById("track-select-setup"),
  normalizationMode: document.getElementById("normalization-mode"),
  roundsQuickBtn: document.getElementById("rounds-quick"),
  roundsStandardBtn: document.getElementById("rounds-standard"),
  roundsRigorousBtn: document.getElementById("rounds-rigorous"),
  roundsCustomInput: document.getElementById("rounds-custom"),
  roundsSummary: document.getElementById("rounds-summary"),
  startPreferenceBtn: document.getElementById("start-preference"),
  startAbxBtn: document.getElementById("start-abx"),
  resetScores: document.getElementById("reset-scores"),

  loadingText: document.getElementById("loading-text"),
  loadingBar: document.getElementById("loading-bar"),

  prefTrackSelect: document.getElementById("track-select-preference"),
  preferenceStage: document.getElementById("preference-stage"),
  matchupText: document.getElementById("matchup-text"),
  matchupMeta: document.getElementById("matchup-meta"),
  buttonA: document.getElementById("switch-a"),
  buttonB: document.getElementById("switch-b"),
  preferA: document.getElementById("prefer-a"),
  tie: document.getElementById("prefer-draw"),
  preferB: document.getElementById("prefer-b"),
  prefProgress: document.getElementById("preference-progress"),

  roundCompleteTitle: document.getElementById("round-complete-title"),
  roundCompleteText: document.getElementById("round-complete-text"),

  abxTrackSelect: document.getElementById("track-select-abx"),
  abxPairSelect: document.getElementById("abx-pair-select"),
  abxTrialCount: document.getElementById("abx-trials"),
  abxStartRun: document.getElementById("abx-start-run"),
  abxNowText: document.getElementById("abx-now-text"),
  abxSwitchA: document.getElementById("abx-switch-a"),
  abxSwitchB: document.getElementById("abx-switch-b"),
  abxSwitchX: document.getElementById("abx-switch-x"),
  abxGuessA: document.getElementById("abx-guess-a"),
  abxGuessB: document.getElementById("abx-guess-b"),
  abxProgress: document.getElementById("abx-progress"),
  abxStats: document.getElementById("abx-stats"),

  restartBtn: document.getElementById("restart"),
  rewindBtn: document.getElementById("rewind"),
  playPauseBtn: document.getElementById("play-pause"),
  forwardBtn: document.getElementById("forward"),
  seekSlider: document.getElementById("seek"),
  loopRegion: document.getElementById("loop-region"),
  loopHandleStart: document.getElementById("loop-handle-start"),
  loopHandleEnd: document.getElementById("loop-handle-end"),
  timeLabel: document.getElementById("time-label"),
  loopInfoRow: document.getElementById("loop-info-row"),
  loopTimes: document.getElementById("loop-times"),
  loopToggleBtn: document.getElementById("loop-toggle"),
  volumeSlider: document.getElementById("volume"),

  resultsTitle: document.getElementById("results-title"),
  preferenceTableBody: document.getElementById("preference-table-body"),
  schedulingSummary: document.getElementById("scheduling-summary"),
  schedulingPairs: document.getElementById("scheduling-pairs"),
  significanceSummary: document.getElementById("significance-summary"),
  significanceRecommendation: document.getElementById("significance-recommendation"),
  headToHeadWrap: document.getElementById("head-to-head-wrap"),
  abxResultsSection: document.getElementById("abx-results-section"),
  abxTableBody: document.getElementById("abx-table-body"),
  anotherRoundBtn: document.getElementById("another-round"),
  resultsSetupBtn: document.getElementById("results-to-setup"),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recomputeRoundPlanSuggestions(presetCount) {
  state.roundPlanSuggestions = buildRoundPlanSuggestions(presetCount);
}

function getRoundPlanMatchups(plan) {
  const matchups = state.roundPlanSuggestions[plan];
  if (!Number.isFinite(matchups) || matchups <= 0) {
    return 1;
  }
  return Math.round(matchups);
}

function isPreferenceScreenActive() {
  return state.mode === "preference" && !dom.preferenceScreen.classList.contains("hidden");
}

let saveStoreTimer = null;
let playbackRafId = null;

function saveStore() {
  if (saveStoreTimer) {
    clearTimeout(saveStoreTimer);
  }

  saveStoreTimer = setTimeout(() => {
    saveStoreTimer = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
  }, 300);
}

function loadStore() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      state.store.preferenceMatches = Array.isArray(parsed.preferenceMatches) ? parsed.preferenceMatches : [];
      state.store.abxRuns = Array.isArray(parsed.abxRuns) ? parsed.abxRuns : [];
    }
  } catch {
    state.store.preferenceMatches = [];
    state.store.abxRuns = [];
  }
}

function getPresetById(id) {
  return state.presets.find((preset) => preset.id === id) ?? null;
}

function getSelectionKey(ids) {
  return [...ids].sort((a, b) => a.localeCompare(b)).join("|");
}

function normalizeNormalizationMode(value) {
  if (value === "earsens" || value === "treble" || value === "rms" || value === "lufs") {
    return value;
  }
  return "earsens";
}

function listCurrentPresets() {
  return state.selectedPresetIds
    .map((id) => getPresetById(id))
    .filter(Boolean);
}

function showScreen(name) {
  const screens = {
    setup: dom.setupScreen,
    loading: dom.loadingScreen,
    preference: dom.preferenceScreen,
    roundComplete: dom.roundCompleteScreen,
    abx: dom.abxScreen,
    results: dom.resultsScreen,
  };

  for (const [key, element] of Object.entries(screens)) {
    element.classList.toggle("hidden", key !== name);
  }

  const showPlayback = name === "preference" || name === "abx";

  if (showPlayback) {
    if (state.playbackHideTimer) {
      clearTimeout(state.playbackHideTimer);
      state.playbackHideTimer = null;
    }
    dom.playbackControls.classList.remove("hidden");
    requestAnimationFrame(() => {
      dom.playbackControls.classList.add("is-visible");
    });
  } else {
    dom.playbackControls.classList.remove("is-visible");
    if (state.playbackHideTimer) {
      clearTimeout(state.playbackHideTimer);
    }
    state.playbackHideTimer = setTimeout(() => {
      dom.playbackControls.classList.add("hidden");
      state.playbackHideTimer = null;
    }, PLAYBACK_HIDE_MS);
  }

  dom.backToSetup.classList.toggle("hidden", name === "setup");
}

function setSetupError(message) {
  dom.setupError.textContent = message || "";
  dom.setupError.classList.toggle("hidden", !message);
}

function setDirectoryFeedback(message, kind = "info") {
  dom.directoriesFeedback.textContent = message || "";
  dom.directoriesFeedback.classList.toggle("hidden", !message);
  dom.directoriesFeedback.classList.toggle("is-success", kind === "success");
  dom.directoriesFeedback.classList.toggle("is-error", kind === "error");
}

function buildAbxPairs(presetIds) {
  const pairs = [];
  for (let i = 0; i < presetIds.length; i += 1) {
    for (let j = i + 1; j < presetIds.length; j += 1) {
      const aId = presetIds[i];
      const bId = presetIds[j];
      const first = getPresetById(aId);
      const second = getPresetById(bId);
      pairs.push({
        id: `${aId}|${bId}`,
        aId,
        bId,
        label: `${first?.name ?? aId} vs ${second?.name ?? bId}`,
      });
    }
  }
  return pairs;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getLoopMinLength(duration) {
  if (!(duration > 0)) {
    return 0;
  }
  return Math.min(LOOP_MIN_SECONDS, duration);
}

function formatLoopRangeLabel(startTime, endTime) {
  return `Loop: ${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function formatTimeLabel(currentTime, duration) {
  return `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

function clampLoopRange(startTime, endTime, duration) {
  if (!(duration > 0)) {
    return { startTime: 0, endTime: 0 };
  }

  let safeStart = Number.isFinite(startTime) ? startTime : 0;
  let safeEnd = Number.isFinite(endTime) ? endTime : duration;
  if (safeStart > safeEnd) {
    [safeStart, safeEnd] = [safeEnd, safeStart];
  }

  safeStart = Math.min(duration, Math.max(0, safeStart));
  safeEnd = Math.min(duration, Math.max(0, safeEnd));

  const minimumLength = getLoopMinLength(duration);
  if (minimumLength > 0 && (safeEnd - safeStart) < minimumLength) {
    if (safeStart + minimumLength <= duration) {
      safeEnd = safeStart + minimumLength;
    } else {
      safeEnd = duration;
      safeStart = Math.max(0, duration - minimumLength);
    }
  }

  return {
    startTime: safeStart,
    endTime: safeEnd,
  };
}

let seekThumbRadiusPx = null;

function getSeekThumbRadiusPx() {
  if (seekThumbRadiusPx !== null) {
    return seekThumbRadiusPx;
  }

  const thumbSizeRaw = getComputedStyle(dom.seekSlider).getPropertyValue(SEEK_THUMB_SIZE_CSS_VAR).trim();
  const thumbSize = Number.parseFloat(thumbSizeRaw);

  if (Number.isFinite(thumbSize) && thumbSize > 0) {
    seekThumbRadiusPx = thumbSize / 2;
  } else {
    seekThumbRadiusPx = SEEK_THUMB_RADIUS_FALLBACK_PX;
  }

  return seekThumbRadiusPx;
}

function getSeekThumbTravelBounds() {
  const sliderRect = dom.seekSlider.getBoundingClientRect();
  if (!(sliderRect.width > 0)) {
    return null;
  }

  const thumbRadius = Math.min(getSeekThumbRadiusPx(), sliderRect.width / 2);
  const minX = sliderRect.left + thumbRadius;
  const maxX = sliderRect.right - thumbRadius;

  return {
    minX,
    maxX,
  };
}

function getSeekPositionPercent(time, duration) {
  if (!(duration > 0)) {
    return 0;
  }

  const ratio = Math.min(1, Math.max(0, time / duration));
  const bounds = getSeekThumbTravelBounds();
  const containerRect = dom.seekSlider.parentElement?.getBoundingClientRect();
  if (!bounds || !containerRect || !(containerRect.width > 0)) {
    return ratio * 100;
  }

  const travelWidth = bounds.maxX - bounds.minX;
  const centerX = bounds.minX + (travelWidth > 0 ? ratio * travelWidth : 0);
  const localX = Math.min(containerRect.width, Math.max(0, centerX - containerRect.left));
  return (localX / containerRect.width) * 100;
}

function updateLoopUi(duration = audio.getState().duration || 0) {
  const loop = audio.getLoopState();
  const loopActive = loop.enabled && duration > 0;

  dom.loopToggleBtn.classList.toggle("active", loopActive);
  dom.loopRegion.classList.toggle("hidden", !loopActive);
  dom.loopHandleStart.classList.toggle("hidden", !loopActive);
  dom.loopHandleEnd.classList.toggle("hidden", !loopActive);
  dom.loopInfoRow.classList.toggle("is-active", loopActive);
  dom.loopInfoRow.setAttribute("aria-hidden", String(!loopActive));

  if (!loopActive) {
    dom.loopTimes.textContent = "Loop: 0:00 - 0:00";
    return null;
  }

  const range = clampLoopRange(loop.startTime, loop.endTime, duration);
  const startPercent = getSeekPositionPercent(range.startTime, duration);
  const endPercent = getSeekPositionPercent(range.endTime, duration);

  dom.loopRegion.style.left = `${startPercent}%`;
  dom.loopRegion.style.width = `${Math.max(0, endPercent - startPercent)}%`;
  dom.loopHandleStart.style.left = `${startPercent}%`;
  dom.loopHandleEnd.style.left = `${endPercent}%`;
  dom.loopTimes.textContent = formatLoopRangeLabel(range.startTime, range.endTime);
  return range;
}

function updatePlaybackUi() {
  const playback = audio.getState();
  const duration = playback.duration || 0;
  const currentTime = playback.currentTime || 0;

  dom.seekSlider.max = String(duration);
  if (!state.isSeekDragging) {
    dom.seekSlider.value = String(currentTime);
  }

  const playbackState = playback.isPlaying ? "playing" : "paused";
  if (dom.playPauseBtn.dataset.state !== playbackState) {
    dom.playPauseBtn.dataset.state = playbackState;
    dom.playPauseBtn.innerHTML = playback.isPlaying ? PAUSE_ICON_SVG : PLAY_ICON_SVG;
  }
  dom.playPauseBtn.classList.toggle("is-playing", playback.isPlaying);
  updateLoopUi(duration);
  dom.timeLabel.textContent = formatTimeLabel(currentTime, duration);
}

function setActiveButton(button, active) {
  button.classList.toggle("active", active);
}

function clearPreferenceActiveButtons() {
  setActiveButton(dom.buttonA, false);
  setActiveButton(dom.buttonB, false);
}

function setPreferenceButtonsEnabled(enabled) {
  dom.buttonA.disabled = !enabled;
  dom.buttonB.disabled = !enabled;
  dom.preferA.disabled = !enabled;
  dom.tie.disabled = !enabled;
  dom.preferB.disabled = !enabled;
}

function formatPhaseLabel(phase) {
  if (phase === "refinement") {
    return "Refinement phase";
  }
  return "Discovery phase";
}

function updatePreferenceUi() {
  const pair = state.currentPreferencePair;
  const progress = state.preferenceScheduler?.progress ?? {
    done: state.activePreferenceMatches.length,
    total: state.selectedMatchups,
    phase: "discovery",
  };

  if (!pair) {
    dom.matchupText.textContent = "Preference test complete";
    dom.matchupMeta.textContent = "";
    dom.prefProgress.textContent = progress.total > 0
      ? `Completed ${progress.total} of ${progress.total} matchups.`
      : "";
    setPreferenceButtonsEnabled(false);
    return;
  }

  const matchupNumber = progress.done + 1;

  dom.matchupText.textContent = "A vs B";
  dom.matchupMeta.textContent = state.selectedTrack ? `Track: ${state.selectedTrack}` : "";
  dom.prefProgress.textContent = `Matchup ${matchupNumber} of ${progress.total} (${formatPhaseLabel(progress.phase)})`;

  setPreferenceButtonsEnabled(!state.isAdvancingPreference);

  const playback = audio.getState();
  setActiveButton(dom.buttonA, playback.activeVariantId === pair.presetA);
  setActiveButton(dom.buttonB, playback.activeVariantId === pair.presetB);
}

function updateAbxUi() {
  const run = state.abxRun;
  if (!run) {
    dom.abxNowText.textContent = "Choose a pair and start a run.";
    dom.abxProgress.textContent = "";
    dom.abxStats.textContent = "";
    dom.abxGuessA.disabled = true;
    dom.abxGuessB.disabled = true;
    return;
  }

  dom.abxNowText.textContent = "Testing pair: A vs B";

  const completed = run.trialIndex;
  const progressLine = completed >= run.totalTrials
    ? `Completed ${run.totalTrials} of ${run.totalTrials} trials.`
    : `Trial ${completed + 1} of ${run.totalTrials}`;

  const currentAccuracy = accuracy(run.correct, Math.max(completed, 1));
  const pValue = completed > 0 ? binomialTailProbability(run.correct, completed, 0.5) : 1;
  const significance = isSignificant(pValue) ? " (significant)" : "";

  dom.abxProgress.textContent = progressLine;
  dom.abxStats.textContent = `Correct: ${run.correct}/${completed} - Accuracy ${formatPercent(currentAccuracy)} - p=${pValue.toFixed(4)}${significance}`;

  const runDone = completed >= run.totalTrials;
  dom.abxGuessA.disabled = runDone;
  dom.abxGuessB.disabled = runDone;

  setActiveButton(dom.abxSwitchA, state.abxListeningTarget === "A");
  setActiveButton(dom.abxSwitchB, state.abxListeningTarget === "B");
  setActiveButton(dom.abxSwitchX, state.abxListeningTarget === "X");
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMatrixSignedStrength(winRate) {
  if (!Number.isFinite(winRate)) {
    return null;
  }

  const signedStrength = clampNumber(
    (winRate - MATRIX_NEUTRAL_WINRATE) / MATRIX_EXTREME_DELTA,
    -1,
    1,
  );

  return {
    signedStrength,
    directionStrength: Math.abs(signedStrength),
  };
}

function getMatrixSignificanceScale(pValue) {
  const safePValue = Number.isFinite(pValue) ? clampNumber(pValue, 0, 1) : 1;
  if (safePValue <= MATRIX_STRONG_SIGNIFICANCE_P) {
    return 1;
  }

  return clampNumber(
    1 - ((safePValue - MATRIX_STRONG_SIGNIFICANCE_P) / (1 - MATRIX_STRONG_SIGNIFICANCE_P))
      * (1 - MATRIX_MIN_SIGNIFICANCE_SCALE),
    MATRIX_MIN_SIGNIFICANCE_SCALE,
    1,
  );
}

function mixRgb(fromRgb, toRgb, amount) {
  const mixAmount = clampNumber(amount, 0, 1);
  return [
    Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * mixAmount),
    Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * mixAmount),
    Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * mixAmount),
  ];
}

function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function getWinRateTextColor(winRate, pValue = MATRIX_STRONG_SIGNIFICANCE_P) {
  const strength = getMatrixSignedStrength(winRate);
  if (!strength) {
    return "";
  }

  if (!(strength.directionStrength > 0)) {
    return rgbToCss(MATRIX_NEUTRAL_RGB);
  }

  const significanceScale = getMatrixSignificanceScale(pValue);
  const confidenceScale = MATRIX_TEXT_MIN_CONFIDENCE_SCALE
    + (1 - MATRIX_TEXT_MIN_CONFIDENCE_SCALE) * significanceScale;
  const emphasis = Math.pow(strength.directionStrength, 0.88)
    * MATRIX_TEXT_MAX_MIX
    * confidenceScale;
  const accentRgb = strength.signedStrength >= 0 ? MATRIX_SUCCESS_RGB : MATRIX_DANGER_RGB;
  return rgbToCss(mixRgb(MATRIX_NEUTRAL_RGB, accentRgb, emphasis));
}

function getMatrixCellTint(winRate, pValue) {
  const strength = getMatrixSignedStrength(winRate);
  if (!strength) {
    return "";
  }

  if (!(strength.directionStrength > 0)) {
    return "";
  }

  const significanceScale = getMatrixSignificanceScale(pValue);

  const alphaBase = MATRIX_MIN_ALPHA + (MATRIX_MAX_ALPHA - MATRIX_MIN_ALPHA) * strength.directionStrength;
  const alpha = alphaBase * significanceScale;
  const rgb = strength.signedStrength >= 0 ? MATRIX_SUCCESS_RGB : MATRIX_DANGER_RGB;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
}

function createMatrixEmptyCell({ diagonal = false } = {}) {
  const td = document.createElement("td");
  td.classList.add("cell-empty");
  if (diagonal) {
    td.classList.add("cell-diagonal");
  }

  const marker = document.createElement("span");
  marker.className = "cell-empty";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "—";
  td.appendChild(marker);
  return td;
}

function renderResults() {
  const currentPresets = listCurrentPresets();
  const ids = new Set(currentPresets.map((preset) => preset.id));
  const nameById = new Map(currentPresets.map((preset) => [preset.id, preset.name]));

  const relevantPreference = state.store.preferenceMatches.filter((match) => (
    match.selectionKey === state.selectionKey
    && ids.has(match.presetA)
    && ids.has(match.presetB)
  ));

  let discoveryCount = 0;
  let refinementCount = 0;
  let legacyCount = 0;

  const pairCounts = new Map();
  for (const match of relevantPreference) {
    if (match.phase === "discovery") {
      discoveryCount += 1;
    } else if (match.phase === "refinement") {
      refinementCount += 1;
    } else {
      legacyCount += 1;
    }

    const key = match.presetA < match.presetB
      ? `${match.presetA}|${match.presetB}`
      : `${match.presetB}|${match.presetA}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  if (relevantPreference.length === 0) {
    dom.schedulingSummary.textContent = "No matchups recorded for this preset set yet.";
    dom.schedulingPairs.textContent = "";
  } else {
    const label = legacyCount > 0
      ? `Scheduling: ${discoveryCount} discovery + ${refinementCount} refinement (${legacyCount} legacy round-based).`
      : `Scheduling: ${discoveryCount} discovery + ${refinementCount} refinement.`;
    dom.schedulingSummary.textContent = label;

    const mostCompared = [...pairCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([key, count]) => {
        const [firstId, secondId] = key.split("|");
        const firstName = nameById.get(firstId) ?? firstId;
        const secondName = nameById.get(secondId) ?? secondId;
        return `${firstName} vs ${secondName} (${count})`;
      });

    dom.schedulingPairs.textContent = mostCompared.length > 0
      ? `Most compared pairs: ${mostCompared.join(", ")}`
      : "";
  }

  const eloStandings = buildStandings(currentPresets, relevantPreference, 32);
  const eloById = new Map(eloStandings.map((row) => [row.id, row.rating]));
  const btStandings = buildBradleyTerryStandings(currentPresets, relevantPreference, {
    confidenceSamples: 0,
    fitOptions: { maxIterations: 70 },
  });

  dom.preferenceTableBody.innerHTML = "";
  for (let i = 0; i < btStandings.length; i += 1) {
    const row = btStandings[i];
    const tr = document.createElement("tr");
    const standingsWinRateColor = getWinRateTextColor(row.winRate);
    const standingsWinRateStyle = standingsWinRateColor ? ` style="color: ${standingsWinRateColor}"` : "";
    if (i < 3) {
      tr.classList.add(`rank-${i + 1}`);
    }
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.name}</td>
      <td>${row.btScore.toFixed(1)}</td>
      <td>${(eloById.get(row.id) ?? 1500).toFixed(1)}</td>
      <td>${row.wins}</td>
      <td>${row.losses}</td>
      <td>${row.draws}</td>
      <td><span class="standings-winrate"${standingsWinRateStyle}>${formatPercent(row.winRate)}</span></td>
    `;
    dom.preferenceTableBody.appendChild(tr);
  }

  const matrix = buildHeadToHead(currentPresets, relevantPreference);
  const matrixTable = document.createElement("table");
  matrixTable.className = "matrix";

  const matrixHead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const cornerHeader = document.createElement("th");
  cornerHeader.scope = "col";
  cornerHeader.className = "matrix-corner";
  cornerHeader.textContent = "Preset";
  headerRow.appendChild(cornerHeader);

  for (const preset of currentPresets) {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "matrix-col-header";
    th.title = preset.name;

    const label = document.createElement("span");
    label.className = "matrix-header-label";
    label.textContent = preset.name;
    th.appendChild(label);

    headerRow.appendChild(th);
  }

  matrixHead.appendChild(headerRow);
  matrixTable.appendChild(matrixHead);

  const matrixBody = document.createElement("tbody");

  let testedPairs = 0;
  let significantPairs = 0;

  for (let rowIndex = 0; rowIndex < currentPresets.length; rowIndex += 1) {
    const rowPreset = currentPresets[rowIndex];
    const tr = document.createElement("tr");

    const rowHeader = document.createElement("th");
    rowHeader.scope = "row";
    rowHeader.className = "matrix-row-header";
    rowHeader.title = rowPreset.name;

    const rowLabel = document.createElement("span");
    rowLabel.className = "matrix-header-label";
    rowLabel.textContent = rowPreset.name;
    rowHeader.appendChild(rowLabel);
    tr.appendChild(rowHeader);

    for (let colIndex = 0; colIndex < currentPresets.length; colIndex += 1) {
      const colPreset = currentPresets[colIndex];

      if (rowPreset.id === colPreset.id) {
        tr.appendChild(createMatrixEmptyCell({ diagonal: true }));
        continue;
      }

      const td = document.createElement("td");

      const cell = matrix.get(rowPreset.id).get(colPreset.id);
      const decisiveOutcomes = cell.wins + cell.losses;
      const totalOutcomes = decisiveOutcomes + cell.draws;
      const hasDecisiveOutcomes = decisiveOutcomes > 0;
      const hasOutcomes = totalOutcomes > 0;
      const pValue = hasDecisiveOutcomes ? pairPreferencePValue(cell) : 1;
      const pText = hasDecisiveOutcomes ? `p=${pValue.toFixed(4)}` : "p=--";
      const significant = hasDecisiveOutcomes && isSignificant(pValue);

      if (colIndex > rowIndex && hasDecisiveOutcomes) {
        testedPairs += 1;
        if (significant) {
          significantPairs += 1;
        }
      }

      if (!hasOutcomes) {
        tr.appendChild(createMatrixEmptyCell());
        continue;
      }

      const winRate = hasDecisiveOutcomes ? cell.wins / decisiveOutcomes : null;
      const winRateText = Number.isFinite(winRate) ? `${Math.round(winRate * 100)}%` : "—";
      const recordText = `${cell.wins}-${cell.losses}-${cell.draws}`;

      const content = document.createElement("div");
      content.className = "cell-content";

      const winRateEl = document.createElement("div");
      winRateEl.className = "cell-winrate";
      if (!hasDecisiveOutcomes) {
        winRateEl.classList.add("is-empty");
      }
      winRateEl.textContent = winRateText;
      content.appendChild(winRateEl);

      const recordEl = document.createElement("div");
      recordEl.className = "cell-record";
      recordEl.textContent = recordText;
      content.appendChild(recordEl);

      const pValueEl = document.createElement("div");
      pValueEl.className = "cell-pvalue";
      if (significant) {
        pValueEl.classList.add("is-significant");
      }
      pValueEl.textContent = pText;
      content.appendChild(pValueEl);

      if (hasDecisiveOutcomes && Number.isFinite(winRate)) {
        const matrixTint = getMatrixCellTint(winRate, pValue);
        if (matrixTint) {
          td.style.background = matrixTint;
        }

        const matrixWinRateColor = getWinRateTextColor(winRate, pValue);
        if (matrixWinRateColor) {
          winRateEl.style.color = matrixWinRateColor;
        }
      }

      td.appendChild(content);
      tr.appendChild(td);
    }

    matrixBody.appendChild(tr);
  }

  matrixTable.appendChild(matrixBody);

  dom.headToHeadWrap.innerHTML = "";
  dom.headToHeadWrap.appendChild(matrixTable);

  if (testedPairs === 0) {
    dom.significanceSummary.textContent = "No pairwise data yet for significance testing.";
    dom.significanceRecommendation.textContent = "";
  } else {
    dom.significanceSummary.textContent = `${significantPairs} of ${testedPairs} pairs reached statistical significance.`;
    const coverage = significantPairs / testedPairs;
    dom.significanceRecommendation.textContent = coverage < 0.5 ? "Run more total matchups to improve confidence." : "";
  }

  const relevantAbx = state.store.abxRuns
    .filter((run) => run.selectionKey === state.selectionKey)
    .slice()
    .reverse();

  dom.abxResultsSection.classList.toggle("hidden", relevantAbx.length === 0);
  dom.abxTableBody.innerHTML = "";
  for (const run of relevantAbx) {
    const pair = state.abxPairs.find((item) => item.id === run.pairId);
    const runAccuracy = accuracy(run.correct, run.totalTrials);
    const pValue = binomialTailProbability(run.correct, run.totalTrials, 0.5);

    const tr = document.createElement("tr");
    tr.classList.toggle("significant", isSignificant(pValue));
    tr.innerHTML = `
      <td>${pair?.label ?? run.pairId}</td>
      <td>${run.correct}/${run.totalTrials}</td>
      <td>${formatPercent(runAccuracy)}</td>
      <td>${pValue.toFixed(4)}</td>
      <td>${new Date(run.timestamp).toLocaleString()}</td>
    `;
    dom.abxTableBody.appendChild(tr);
  }

  dom.resultsTitle.textContent = `Results for ${currentPresets.length} presets`;
}

function getSelectedPresetIdsFromSetup() {
  return [...dom.presetList.querySelectorAll(".preset-chip.is-selected")]
    .map((chip) => chip.dataset.presetId)
    .filter(Boolean);
}

function inferRoundPlanFromValue(value) {
  if (value === getRoundPlanMatchups("quick")) {
    return "quick";
  }
  if (value === getRoundPlanMatchups("standard")) {
    return "standard";
  }
  if (value === getRoundPlanMatchups("rigorous")) {
    return "rigorous";
  }
  return "custom";
}

function setSelectedMatchups(matchups, explicitPlan = null) {
  const pairCount = pairCountForPresetCount(getSelectedPresetIdsFromSetup().length);
  const minimumMatchups = pairCount > 0 ? pairCount : 1;
  const safeMatchups = Number.isFinite(matchups) && matchups > 0
    ? Math.round(matchups)
    : getRoundPlanMatchups("standard");
  state.selectedMatchups = Math.max(minimumMatchups, safeMatchups);
  state.selectedRoundPlan = explicitPlan ?? inferRoundPlanFromValue(state.selectedMatchups);
  dom.roundsCustomInput.value = String(state.selectedMatchups);
  updateRoundSelectorUi();
}

function updateRoundSelectorUi() {
  const selectedPresetCount = getSelectedPresetIdsFromSetup().length;
  const pairCount = pairCountForPresetCount(selectedPresetCount);
  recomputeRoundPlanSuggestions(selectedPresetCount);

  if (state.selectedRoundPlan !== "custom") {
    const planMatchups = getRoundPlanMatchups(state.selectedRoundPlan);
    state.selectedMatchups = planMatchups;
  }

  const minimumMatchups = pairCount > 0 ? pairCount : 1;
  state.selectedMatchups = Math.max(minimumMatchups, state.selectedMatchups);
  dom.roundsCustomInput.min = String(minimumMatchups);
  dom.roundsCustomInput.value = String(state.selectedMatchups);

  const quickMatchups = getRoundPlanMatchups("quick");
  const standardMatchups = getRoundPlanMatchups("standard");
  const rigorousMatchups = getRoundPlanMatchups("rigorous");

  const describeTier = (tier, totalMatchups) => `${ROUND_PLAN_TIERS[tier].label} - ${totalMatchups} matchups`;

  dom.roundsQuickBtn.textContent = describeTier("quick", quickMatchups);
  dom.roundsStandardBtn.textContent = describeTier("standard", standardMatchups);
  dom.roundsRigorousBtn.textContent = describeTier("rigorous", rigorousMatchups);

  dom.roundsQuickBtn.classList.toggle("is-selected", state.selectedRoundPlan === "quick");
  dom.roundsStandardBtn.classList.toggle("is-selected", state.selectedRoundPlan === "standard");
  dom.roundsRigorousBtn.classList.toggle("is-selected", state.selectedRoundPlan === "rigorous");

  if (pairCount === 0) {
    dom.roundsSummary.textContent = "Select at least two presets to estimate matchups.";
    return;
  }

  dom.roundsSummary.textContent = `First ${pairCount} matchups cover all pairs once. Remaining matchups adaptively target the closest-ranked presets for maximum information.`;
}

function renderPresetChecklist() {
  dom.presetList.innerHTML = "";

  for (const preset of state.presets) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.dataset.presetId = preset.id;
    chip.textContent = preset.name;

    const selectedByDefault = preset.id !== NO_EQ_ID;
    chip.classList.toggle("is-selected", selectedByDefault);
    chip.setAttribute("aria-pressed", selectedByDefault ? "true" : "false");

    chip.addEventListener("click", () => {
      const nextSelected = !chip.classList.contains("is-selected");
      chip.classList.toggle("is-selected", nextSelected);
      chip.setAttribute("aria-pressed", nextSelected ? "true" : "false");
      state.selectedPresetIds = getSelectedPresetIdsFromSetup();
      updateRoundSelectorUi();
    });

    dom.presetList.appendChild(chip);
  }

  state.selectedPresetIds = getSelectedPresetIdsFromSetup();
  updateRoundSelectorUi();
}

function syncTrackSelects() {
  dom.setupTrackSelect.value = state.selectedTrack;
  dom.prefTrackSelect.value = state.selectedTrack;
  dom.abxTrackSelect.value = state.selectedTrack;
}

function renderTrackSelects() {
  const selectNodes = [dom.setupTrackSelect, dom.prefTrackSelect, dom.abxTrackSelect];

  for (const select of selectNodes) {
    select.innerHTML = "";
    for (const track of state.tracks) {
      const option = document.createElement("option");
      option.value = track;
      option.textContent = track;
      select.appendChild(option);
    }
  }

  if (!state.selectedTrack && state.tracks.length > 0) {
    state.selectedTrack = state.tracks[0];
  }

  syncTrackSelects();
}

function renderAbxPairSelect() {
  dom.abxPairSelect.innerHTML = "";
  for (const pair of state.abxPairs) {
    const option = document.createElement("option");
    option.value = pair.id;
    option.textContent = pair.label;
    dom.abxPairSelect.appendChild(option);
  }
}

async function prepareTrackForSelection() {
  const token = state.prepareToken + 1;
  state.prepareToken = token;

  const activePresets = listCurrentPresets();
  if (activePresets.length < 2) {
    throw new Error("Select at least two presets.");
  }
  if (!state.selectedTrack) {
    throw new Error("Select a track first.");
  }

  audio.stop();
  showScreen("loading");
  dom.loadingText.textContent = "Preparing audio...";
  dom.loadingBar.style.width = "0%";

  const trackUrl = `/music/${encodeURIComponent(state.selectedTrack)}`;
  const result = await audio.prepareTrack({
    trackUrl,
    presets: activePresets,
    normalizationMode: state.normalizationMode,
    onProgress: ({ done, total, message }) => {
      if (token !== state.prepareToken) {
        return;
      }
      const ratio = total > 0 ? done / total : 0;
      dom.loadingBar.style.width = `${Math.round(ratio * 100)}%`;
      dom.loadingText.textContent = `${message} (${done}/${total})`;
    },
  });

  if (token !== state.prepareToken) {
    return;
  }

  audio.setVariants(result.variants);
}

function loadCurrentPair({ autoPlay = false } = {}) {
  const pair = state.currentPreferencePair;
  if (!pair) {
    return;
  }

  audio.setActiveVariant(pair.presetA);
  setActiveButton(dom.buttonA, true);
  setActiveButton(dom.buttonB, false);
  if (autoPlay) {
    audio.play();
  }
  updatePreferenceUi();
}

async function showPreferenceCompleteInterstitial() {
  dom.roundCompleteTitle.textContent = "Preference Test Complete";
  dom.roundCompleteText.textContent = "Calculating results...";

  showScreen("roundComplete");
  await delay(ROUND_COMPLETE_MS);
  if (state.mode !== "preference") {
    return;
  }

  audio.stop();
  renderResults();
  showScreen("results");
}

function persistPreferenceMatch(choice, pair) {
  const scoreA = choice === "A" ? 1 : choice === "B" ? 0 : 0.5;
  const phase = state.preferenceScheduler?.progress.phase === "refinement" ? "refinement" : "discovery";
  const matchupNumber = state.activePreferenceMatches.length + 1;
  const match = {
    selectionKey: state.selectionKey,
    presetA: pair.presetA,
    presetB: pair.presetB,
    scoreA,
    choice,
    track: state.selectedTrack,
    phase,
    matchupNumber,
    timestamp: Date.now(),
  };

  state.store.preferenceMatches.push(match);
  state.activePreferenceMatches.push(match);
  saveStore();
}

async function advancePreference(choice, selectedButton) {
  const pair = state.currentPreferencePair;
  if (!pair || state.isAdvancingPreference) {
    return;
  }

  state.isAdvancingPreference = true;
  setPreferenceButtonsEnabled(false);
  persistPreferenceMatch(choice, pair);

  if (selectedButton) {
    selectedButton.classList.add("verdict-flash");
  }

  try {
    await delay(120);
    if (!isPreferenceScreenActive()) {
      return;
    }

    if (selectedButton) {
      selectedButton.classList.remove("verdict-flash");
    }

    clearPreferenceActiveButtons();
    dom.preferenceStage.classList.add("is-fading");
    await delay(TRANSITION_MS);
    if (!isPreferenceScreenActive()) {
      return;
    }

    const nextPair = state.preferenceScheduler?.next(state.activePreferenceMatches) ?? null;
    state.currentPreferencePair = nextPair;

    if (!nextPair) {
      dom.preferenceStage.classList.remove("is-fading");
      await showPreferenceCompleteInterstitial();
      return;
    }

    audio.setActiveVariant(nextPair.presetA);
    setActiveButton(dom.buttonA, true);
    setActiveButton(dom.buttonB, false);
    updatePreferenceUi();
    dom.preferenceStage.classList.remove("is-fading");
    await delay(TRANSITION_MS);
    if (!isPreferenceScreenActive()) {
      return;
    }
    updatePreferenceUi();
  } finally {
    state.isAdvancingPreference = false;
    dom.preferenceStage.classList.remove("is-fading");
    if (selectedButton) {
      selectedButton.classList.remove("verdict-flash");
    }
    if (isPreferenceScreenActive()) {
      updatePreferenceUi();
    }
  }
}

function getModeStartSetup() {
  setSetupError("");

  const selectedPresetIds = getSelectedPresetIdsFromSetup();
  const selectedTrack = dom.setupTrackSelect.value;
  const normalizationMode = normalizeNormalizationMode(dom.normalizationMode.value || "earsens");

  state.selectedPresetIds = selectedPresetIds;
  state.selectedTrack = selectedTrack;
  state.normalizationMode = normalizationMode;

  if (selectedPresetIds.length < 2) {
    setSetupError("Select at least two presets.");
    return null;
  }

  return {
    selectedPresetIds,
    selectedTrack,
    normalizationMode,
  };
}

async function startPreferenceMode() {
  const setup = getModeStartSetup();
  if (!setup) {
    return;
  }

  const { selectedPresetIds } = setup;

  const requestedMatchups = Number.parseInt(dom.roundsCustomInput.value, 10);
  const pairCount = pairCountForPresetCount(selectedPresetIds.length);
  recomputeRoundPlanSuggestions(selectedPresetIds.length);
  state.selectedMatchups = Number.isFinite(requestedMatchups) && requestedMatchups > 0
    ? requestedMatchups
    : getRoundPlanMatchups("standard");
  state.selectedMatchups = Math.max(pairCount, state.selectedMatchups);
  dom.roundsCustomInput.value = String(state.selectedMatchups);
  state.selectedRoundPlan = inferRoundPlanFromValue(state.selectedMatchups);

  state.selectionKey = getSelectionKey(selectedPresetIds);
  state.mode = "preference";
  state.preferenceScheduler = new MatchupScheduler(selectedPresetIds, state.selectedMatchups);
  state.activePreferenceMatches = [];
  state.currentPreferencePair = state.preferenceScheduler.next(state.activePreferenceMatches);
  state.abxPairs = buildAbxPairs(selectedPresetIds);
  state.isAdvancingPreference = false;

  syncTrackSelects();

  await prepareTrackForSelection();
  showScreen("preference");
  loadCurrentPair({ autoPlay: true });
}

async function startAbxMode() {
  const setup = getModeStartSetup();
  if (!setup) {
    return;
  }

  const { selectedPresetIds } = setup;

  state.selectionKey = getSelectionKey(selectedPresetIds);
  state.mode = "abx";
  state.abxPairs = buildAbxPairs(selectedPresetIds);
  state.abxRun = null;
  state.abxListeningTarget = "A";

  renderAbxPairSelect();
  syncTrackSelects();

  await prepareTrackForSelection();
  showScreen("abx");
  updateAbxUi();
}

function switchPreferenceSide(side) {
  if (state.isAdvancingPreference) {
    return;
  }

  const pair = state.currentPreferencePair;
  if (!pair) {
    return;
  }

  if (side === "A") {
    audio.setActiveVariant(pair.presetA);
  } else {
    audio.setActiveVariant(pair.presetB);
  }
}

function startAbxRun() {
  const pairId = dom.abxPairSelect.value;
  const pair = state.abxPairs.find((item) => item.id === pairId);
  if (!pair) {
    return;
  }

  const parsedTrials = Number.parseInt(dom.abxTrialCount.value, 10);
  const totalTrials = Number.isFinite(parsedTrials) && parsedTrials > 0 ? parsedTrials : 16;
  dom.abxTrialCount.value = String(totalTrials);

  state.abxRun = {
    pairId,
    aId: pair.aId,
    bId: pair.bId,
    totalTrials,
    trialIndex: 0,
    correct: 0,
    xIs: Math.random() < 0.5 ? "A" : "B",
  };

  state.abxListeningTarget = "A";
  audio.setActiveVariant(pair.aId);
  audio.play();
  updateAbxUi();
}

function listenAbx(target, autoPlay = false) {
  const run = state.abxRun;
  if (!run) {
    return;
  }

  state.abxListeningTarget = target;

  if (target === "A") {
    audio.setActiveVariant(run.aId);
  } else if (target === "B") {
    audio.setActiveVariant(run.bId);
  } else {
    audio.setActiveVariant(run.xIs === "A" ? run.aId : run.bId);
  }

  if (autoPlay) {
    audio.play();
  }
  updateAbxUi();
}

function guessAbx(guess) {
  const run = state.abxRun;
  if (!run || run.trialIndex >= run.totalTrials) {
    return;
  }

  const nextStep = advanceAbxRunTrial(run, guess);

  if (nextStep.isComplete) {
    state.store.abxRuns.push({
      selectionKey: state.selectionKey,
      pairId: run.pairId,
      aId: run.aId,
      bId: run.bId,
      track: state.selectedTrack,
      correct: run.correct,
      totalTrials: run.totalTrials,
      timestamp: Date.now(),
    });
    saveStore();
  } else {
    state.abxListeningTarget = nextStep.listeningTarget;
    audio.setActiveVariant(nextStep.variantId);
  }

  updateAbxUi();
}

async function handleTrackChange(track) {
  if (!track || track === state.selectedTrack) {
    return;
  }

  const shouldResume = audio.getState().isPlaying;

  state.selectedTrack = track;
  syncTrackSelects();

  try {
    await prepareTrackForSelection();
    if (state.mode === "preference") {
      loadCurrentPair({ autoPlay: shouldResume });
      showScreen("preference");
    } else if (state.mode === "abx") {
      if (state.abxRun) {
        listenAbx(state.abxListeningTarget, shouldResume);
      }
      showScreen("abx");
      updateAbxUi();
    }
  } catch (error) {
    setSetupError(error instanceof Error ? error.message : String(error));
    showScreen("setup");
  }
}

function applyDefaultLoopRegion() {
  const playback = audio.getState();
  const duration = playback.duration || 0;
  if (!(duration > 0)) {
    return;
  }

  const current = playback.currentTime || 0;
  const startTime = Math.max(0, Math.min(duration, current));
  const endTime = Math.min(duration, startTime + LOOP_DEFAULT_SECONDS);
  const range = clampLoopRange(startTime, endTime, duration);
  audio.setLoopRegion(range.startTime, range.endTime);
}

function toggleLoopEnabled() {
  const loop = audio.getLoopState();
  if (loop.enabled) {
    audio.setLoopEnabled(false);
    return;
  }

  applyDefaultLoopRegion();
  audio.setLoopEnabled(true);
}

function getSeekTimeForClientX(clientX) {
  const duration = audio.getState().duration || 0;
  if (!(duration > 0)) {
    return 0;
  }

  const bounds = getSeekThumbTravelBounds();
  if (!bounds) {
    return 0;
  }

  const travelWidth = bounds.maxX - bounds.minX;
  if (!(travelWidth > 0)) {
    return 0;
  }

  const clampedX = Math.min(bounds.maxX, Math.max(bounds.minX, clientX));
  const clampedRatio = (clampedX - bounds.minX) / travelWidth;
  return clampedRatio * duration;
}

function setLoopBoundary(handle, rawTime) {
  const duration = audio.getState().duration || 0;
  if (!(duration > 0)) {
    return;
  }

  const loop = audio.getLoopState();
  const currentRange = clampLoopRange(loop.startTime, loop.endTime, duration);
  const minimumLength = getLoopMinLength(duration);

  let nextStart = currentRange.startTime;
  let nextEnd = currentRange.endTime;

  if (handle === "start") {
    const upperBound = Math.max(0, nextEnd - minimumLength);
    nextStart = Math.min(Math.max(0, rawTime), upperBound);
  } else {
    const lowerBound = Math.min(duration, nextStart + minimumLength);
    nextEnd = Math.max(Math.min(duration, rawTime), lowerBound);
  }

  audio.setLoopRegion(nextStart, nextEnd);
}

function setLoopBoundaryFromCurrentTime(handle) {
  const playback = audio.getState();
  const duration = playback.duration || 0;
  if (!(duration > 0)) {
    return;
  }

  const loop = audio.getLoopState();
  const currentTime = Math.max(0, Math.min(duration, playback.currentTime || 0));
  if (!loop.enabled) {
    applyDefaultLoopRegion();
    audio.setLoopEnabled(true);
  }

  setLoopBoundary(handle, currentTime);
}

function handleLoopHandlePointerMove(event) {
  if (!state.isLoopHandleDragging || !state.loopDragHandle) {
    return;
  }

  if (state.loopDragPointerId !== null && event.pointerId !== state.loopDragPointerId) {
    return;
  }

  event.preventDefault();
  const nextTime = getSeekTimeForClientX(event.clientX);
  setLoopBoundary(state.loopDragHandle, nextTime);
}

function stopLoopHandleDrag(event) {
  if (state.loopDragPointerId !== null && event?.pointerId !== undefined && event.pointerId !== state.loopDragPointerId) {
    return;
  }

  state.isLoopHandleDragging = false;
  state.loopDragHandle = null;
  state.loopDragPointerId = null;
  dom.loopHandleStart.classList.remove("is-dragging");
  dom.loopHandleEnd.classList.remove("is-dragging");
  window.removeEventListener("pointermove", handleLoopHandlePointerMove);
  window.removeEventListener("pointerup", stopLoopHandleDrag);
  window.removeEventListener("pointercancel", stopLoopHandleDrag);
}

function startLoopHandleDrag(event) {
  const handle = event.currentTarget?.dataset?.handle;
  if (handle !== "start" && handle !== "end") {
    return;
  }

  if (state.isLoopHandleDragging) {
    stopLoopHandleDrag();
  }

  if (!audio.getLoopState().enabled) {
    return;
  }

  event.preventDefault();
  state.isLoopHandleDragging = true;
  state.loopDragHandle = handle;
  state.loopDragPointerId = event.pointerId;
  dom.loopHandleStart.classList.toggle("is-dragging", handle === "start");
  dom.loopHandleEnd.classList.toggle("is-dragging", handle === "end");

  window.addEventListener("pointermove", handleLoopHandlePointerMove);
  window.addEventListener("pointerup", stopLoopHandleDrag);
  window.addEventListener("pointercancel", stopLoopHandleDrag);

  setLoopBoundary(handle, getSeekTimeForClientX(event.clientX));
}

function handleKeyboard(event) {
  const target = event.target;
  if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === " " || key === "spacebar") {
    event.preventDefault();
    if (audio.getState().isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    return;
  }

  if (key === "arrowleft") {
    event.preventDefault();
    audio.skip(-5);
    return;
  }

  if (key === "arrowright") {
    event.preventDefault();
    audio.skip(5);
    return;
  }

  if (key === "l") {
    event.preventDefault();
    toggleLoopEnabled();
    return;
  }

  if (event.key === "[") {
    event.preventDefault();
    setLoopBoundaryFromCurrentTime("start");
    return;
  }

  if (event.key === "]") {
    event.preventDefault();
    setLoopBoundaryFromCurrentTime("end");
    return;
  }

  if (state.mode === "preference" && !dom.preferenceScreen.classList.contains("hidden")) {
    if (key === "1" || key === "a") {
      switchPreferenceSide("A");
    } else if (key === "2" || key === "b") {
      switchPreferenceSide("B");
    } else if (key === "z") {
      advancePreference("A", dom.preferA);
    } else if (key === "x") {
      advancePreference("draw", dom.tie);
    } else if (key === "c") {
      advancePreference("B", dom.preferB);
    }
    return;
  }

  if (state.mode === "abx" && !dom.abxScreen.classList.contains("hidden")) {
    if (key === "1" || key === "a") {
      listenAbx("A");
    } else if (key === "2" || key === "b") {
      listenAbx("B");
    } else if (key === "3" || key === "x") {
      listenAbx("X");
    } else if (key === "z") {
      guessAbx("A");
    } else if (key === "c") {
      guessAbx("B");
    }
  }
}

async function loadInitialData() {
  const previousTrack = state.selectedTrack;
  const [presetsResponse, tracksResponse] = await Promise.all([
    fetch("/api/presets"),
    fetch("/api/tracks"),
  ]);

  if (!presetsResponse.ok) {
    const body = await presetsResponse.json().catch(() => ({}));
    throw new Error(body.error || "Failed to load presets.");
  }

  if (!tracksResponse.ok) {
    const body = await tracksResponse.json().catch(() => ({}));
    throw new Error(body.error || "Failed to load tracks.");
  }

  const presets = await presetsResponse.json();
  const tracks = await tracksResponse.json();

  const noEqPreset = {
    id: NO_EQ_ID,
    name: "No EQ",
    filename: "no-eq",
    preampDb: 0,
    filters: [],
  };

  state.presets = [
    ...presets.map((preset) => ({
      ...preset,
      id: preset.filename,
    })),
    noEqPreset,
  ];
  state.tracks = tracks;
  state.selectedTrack = tracks.includes(previousTrack) ? previousTrack : tracks[0] ?? "";
  dom.normalizationMode.value = state.normalizationMode;

  renderPresetChecklist();
  renderTrackSelects();
  setSelectedMatchups(getRoundPlanMatchups("standard"), "standard");
}

async function loadDirectoryConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to load directory config.");
  }

  const config = await response.json();
  dom.musicDirInput.value = config.musicDir || "music";
  dom.presetsDirInput.value = config.presetsDir || "presets_for_shootout";
}

function setBrowseButtonsDisabled(disabled) {
  dom.musicDirBrowseBtn.disabled = disabled;
  dom.presetsDirBrowseBtn.disabled = disabled;
}

function setDirectoryActionsDisabled(disabled) {
  dom.applyDirectoriesBtn.disabled = disabled;
  setBrowseButtonsDisabled(disabled);
}

async function browseDirectoryIntoInput(input) {
  setDirectoryActionsDisabled(true);
  setDirectoryFeedback("Opening folder picker...");

  try {
    const response = await fetch("/api/browse", {
      method: "POST",
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Failed to open folder picker.");
    }

    if (body.cancelled) {
      setDirectoryFeedback("Folder selection cancelled.");
      return;
    }

    if (typeof body.path !== "string" || !body.path.trim()) {
      throw new Error("Folder picker returned an invalid path.");
    }

    input.value = body.path;
    setDirectoryFeedback("Folder selected. Click Apply to use it.", "success");
  } catch (error) {
    setDirectoryFeedback(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setDirectoryActionsDisabled(false);
  }
}

async function applyDirectoryConfig() {
  const payload = {
    musicDir: dom.musicDirInput.value.trim(),
    presetsDir: dom.presetsDirInput.value.trim(),
  };

  setDirectoryActionsDisabled(true);
  setDirectoryFeedback("Applying directory config...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Failed to apply directory config.");
    }

    dom.musicDirInput.value = body.musicDir || payload.musicDir;
    dom.presetsDirInput.value = body.presetsDir || payload.presetsDir;

    try {
      await loadInitialData();
      setSetupError("");
      setDirectoryFeedback("Directories updated. Presets and tracks reloaded.", "success");
    } catch (reloadError) {
      const message = reloadError instanceof Error ? reloadError.message : String(reloadError);
      setSetupError(message);
      setDirectoryFeedback(`Directories updated, but reload failed: ${message}`, "error");
    }
  } catch (error) {
    setDirectoryFeedback(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setDirectoryActionsDisabled(false);
  }
}

function restoreDirectoryPanelState() {
  const saved = localStorage.getItem(DIRECTORY_DETAILS_STORAGE_KEY);
  if (saved === "open") {
    dom.directoriesPanel.open = true;
  } else if (saved === "closed") {
    dom.directoriesPanel.open = false;
  }
}

let resetConfirmTimeout = null;
let resetDoneTimeout = null;

function resetScoresButtonToDefault() {
  dom.resetScores.classList.remove("is-confirming", "is-done");
  dom.resetScores.textContent = RESET_SCORES_DEFAULT_TEXT;
}

function enterResetConfirmState() {
  if (resetDoneTimeout) {
    clearTimeout(resetDoneTimeout);
    resetDoneTimeout = null;
  }

  dom.resetScores.classList.remove("is-done");
  dom.resetScores.classList.add("is-confirming");
  dom.resetScores.textContent = RESET_SCORES_CONFIRM_TEXT;

  if (resetConfirmTimeout) {
    clearTimeout(resetConfirmTimeout);
  }

  resetConfirmTimeout = setTimeout(() => {
    resetConfirmTimeout = null;
    resetScoresButtonToDefault();
  }, RESET_CONFIRM_MS);
}

function clearAllScores() {
  if (resetConfirmTimeout) {
    clearTimeout(resetConfirmTimeout);
    resetConfirmTimeout = null;
  }

  if (resetDoneTimeout) {
    clearTimeout(resetDoneTimeout);
  }

  state.store.preferenceMatches = [];
  state.store.abxRuns = [];
  saveStore();

  dom.resetScores.classList.remove("is-confirming");
  dom.resetScores.classList.add("is-done");
  dom.resetScores.textContent = RESET_SCORES_DONE_TEXT;

  resetDoneTimeout = setTimeout(() => {
    resetDoneTimeout = null;
    resetScoresButtonToDefault();
  }, RESET_DONE_MS);
}

function resetToSetup() {
  audio.stop();
  state.mode = null;
  state.preferenceScheduler = null;
  state.currentPreferencePair = null;
  state.activePreferenceMatches = [];
  showScreen("setup");
}

async function withAudioContext(startFn) {
  try {
    await audio.ensureContext();
    await startFn();
  } catch (error) {
    setSetupError(error instanceof Error ? error.message : String(error));
    showScreen("setup");
  }
}

function getTrackFromSelectEvent(event) {
  if (!(event.target instanceof HTMLSelectElement)) {
    return null;
  }
  return event.target.value;
}

function handleModeTrackSelectChange(event) {
  const nextTrack = getTrackFromSelectEvent(event);
  if (nextTrack === null) {
    return;
  }
  handleTrackChange(nextTrack);
}

function handleSetupTrackSelectChange(event) {
  const nextTrack = getTrackFromSelectEvent(event);
  if (nextTrack === null) {
    return;
  }

  state.selectedTrack = nextTrack;
  syncTrackSelects();
}

function attachEvents() {
  dom.applyDirectoriesBtn.addEventListener("click", () => {
    applyDirectoryConfig();
  });

  const browseButtonBindings = [
    [dom.musicDirBrowseBtn, dom.musicDirInput],
    [dom.presetsDirBrowseBtn, dom.presetsDirInput],
  ];

  for (const [button, input] of browseButtonBindings) {
    button.addEventListener("click", () => {
      browseDirectoryIntoInput(input);
    });
  }

  dom.musicDirInput.addEventListener("input", () => setDirectoryFeedback(""));
  dom.presetsDirInput.addEventListener("input", () => setDirectoryFeedback(""));

  dom.directoriesPanel.addEventListener("toggle", () => {
    localStorage.setItem(DIRECTORY_DETAILS_STORAGE_KEY, dom.directoriesPanel.open ? "open" : "closed");
  });

  dom.startPreferenceBtn.addEventListener("click", () => {
    withAudioContext(startPreferenceMode);
  });

  dom.startAbxBtn.addEventListener("click", () => {
    withAudioContext(startAbxMode);
  });

  dom.resetScores.addEventListener("click", () => {
    if (dom.resetScores.classList.contains("is-confirming")) {
      clearAllScores();
      return;
    }

    if (dom.resetScores.classList.contains("is-done")) {
      return;
    }

    enterResetConfirmState();
  });

  const roundPlanButtons = [
    [dom.roundsQuickBtn, "quick"],
    [dom.roundsStandardBtn, "standard"],
    [dom.roundsRigorousBtn, "rigorous"],
  ];

  for (const [button, plan] of roundPlanButtons) {
    button.addEventListener("click", () => {
      setSelectedMatchups(getRoundPlanMatchups(plan), plan);
    });
  }

  dom.roundsCustomInput.addEventListener("input", () => {
    const parsed = Number.parseInt(dom.roundsCustomInput.value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    setSelectedMatchups(parsed);
  });

  dom.backToSetup.addEventListener("click", () => {
    resetToSetup();
  });

  for (const select of [dom.prefTrackSelect, dom.abxTrackSelect]) {
    select.addEventListener("change", handleModeTrackSelectChange);
  }

  dom.setupTrackSelect.addEventListener("change", handleSetupTrackSelectChange);

  dom.normalizationMode.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) {
      state.normalizationMode = "earsens";
      return;
    }
    state.normalizationMode = normalizeNormalizationMode(event.target.value || "earsens");
  });

  dom.buttonA.addEventListener("click", () => switchPreferenceSide("A"));
  dom.buttonB.addEventListener("click", () => switchPreferenceSide("B"));
  dom.preferA.addEventListener("click", () => advancePreference("A", dom.preferA));
  dom.tie.addEventListener("click", () => advancePreference("draw", dom.tie));
  dom.preferB.addEventListener("click", () => advancePreference("B", dom.preferB));

  dom.abxStartRun.addEventListener("click", () => startAbxRun());
  dom.abxSwitchA.addEventListener("click", () => listenAbx("A"));
  dom.abxSwitchB.addEventListener("click", () => listenAbx("B"));
  dom.abxSwitchX.addEventListener("click", () => listenAbx("X"));
  dom.abxGuessA.addEventListener("click", () => guessAbx("A"));
  dom.abxGuessB.addEventListener("click", () => guessAbx("B"));

  dom.restartBtn.addEventListener("click", () => audio.restart());
  dom.rewindBtn.addEventListener("click", () => audio.skip(-5));
  dom.forwardBtn.addEventListener("click", () => audio.skip(5));
  dom.playPauseBtn.addEventListener("click", () => {
    if (audio.getState().isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  });

  dom.loopToggleBtn.addEventListener("click", () => {
    toggleLoopEnabled();
  });

  dom.loopHandleStart.addEventListener("pointerdown", startLoopHandleDrag);
  dom.loopHandleEnd.addEventListener("pointerdown", startLoopHandleDrag);

  dom.seekSlider.addEventListener("pointerdown", () => {
    state.isSeekDragging = true;
  });

  dom.seekSlider.addEventListener("pointerup", () => {
    state.isSeekDragging = false;
    audio.seek(Number(dom.seekSlider.value));
  });

  dom.seekSlider.addEventListener("input", () => {
    if (state.isSeekDragging) {
      const value = Number(dom.seekSlider.value);
      const duration = Number(dom.seekSlider.max) || 0;
      updateLoopUi(duration);
      dom.timeLabel.textContent = formatTimeLabel(value, duration);
    } else {
      audio.seek(Number(dom.seekSlider.value));
    }
  });

  dom.volumeSlider.addEventListener("input", () => {
    audio.setVolume(Number(dom.volumeSlider.value));
  });

  dom.anotherRoundBtn.addEventListener("click", () => {
    if (state.selectedPresetIds.length < 2) {
      showScreen("setup");
      return;
    }

    state.mode = "preference";
    state.preferenceScheduler = new MatchupScheduler(state.selectedPresetIds, state.selectedMatchups);
    state.activePreferenceMatches = [];
    state.currentPreferencePair = state.preferenceScheduler.next(state.activePreferenceMatches);
    state.isAdvancingPreference = false;
    showScreen("preference");
    loadCurrentPair({ autoPlay: true });
  });

  dom.resultsSetupBtn.addEventListener("click", () => {
    resetToSetup();
  });

  audio.addEventListener("state", () => {
    updatePlaybackUi();
    if (audio.isPlaying && playbackRafId === null) {
      startRenderLoop();
    }
    if (state.mode === "preference") {
      updatePreferenceUi();
    }
    if (state.mode === "abx") {
      updateAbxUi();
    }
  });

  document.addEventListener("keydown", handleKeyboard);
}

function startRenderLoop() {
  if (playbackRafId !== null) {
    return;
  }

  function frame() {
    updatePlaybackUi();
    if (!audio.isPlaying) {
      playbackRafId = null;
      return;
    }
    playbackRafId = requestAnimationFrame(frame);
  }

  playbackRafId = requestAnimationFrame(frame);
}

async function init() {
  loadStore();
  restoreDirectoryPanelState();
  attachEvents();
  updatePlaybackUi();
  showScreen("setup");

  try {
    await loadDirectoryConfig();
  } catch (error) {
    setDirectoryFeedback(error instanceof Error ? error.message : String(error), "error");
  }

  try {
    await loadInitialData();
  } catch (error) {
    setSetupError(error instanceof Error ? error.message : String(error));
  }

}

init();
