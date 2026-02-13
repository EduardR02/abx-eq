export const ROUND_PLAN_TIERS = {
  quick: {
    label: "Quick",
  },
  standard: {
    label: "Standard",
  },
  rigorous: {
    label: "Rigorous",
  },
};

export function pairCountForPresetCount(presetCount) {
  if (!Number.isFinite(presetCount) || presetCount < 2) {
    return 0;
  }
  return (presetCount * (presetCount - 1)) / 2;
}

export function buildRoundPlanSuggestions(presetCount) {
  if (!Number.isFinite(presetCount) || presetCount < 2) {
    return {
      quick: 1,
      standard: 1,
      rigorous: 1,
    };
  }

  const roundedPresetCount = Math.floor(presetCount);
  const pairCount = pairCountForPresetCount(roundedPresetCount);

  return {
    quick: Math.max(pairCount, Math.floor(5 * roundedPresetCount)),
    standard: Math.max(pairCount, Math.floor(7.5 * roundedPresetCount)),
    rigorous: Math.max(pairCount, Math.floor(12 * roundedPresetCount)),
  };
}
