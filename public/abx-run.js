export function advanceAbxRunTrial(run, guess, random = Math.random) {
  if (guess === run.xIs) {
    run.correct += 1;
  }

  run.trialIndex += 1;

  if (run.trialIndex >= run.totalTrials) {
    return {
      isComplete: true,
      listeningTarget: null,
      variantId: null,
    };
  }

  run.xIs = random() < 0.5 ? "A" : "B";

  return {
    isComplete: false,
    listeningTarget: "A",
    variantId: run.aId,
  };
}
