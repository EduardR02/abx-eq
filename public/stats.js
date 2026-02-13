function combination(n, k) {
  if (k < 0 || k > n) {
    return 0;
  }

  if (k === 0 || k === n) {
    return 1;
  }

  const m = Math.min(k, n - k);
  let result = 1;

  for (let i = 1; i <= m; i += 1) {
    result = (result * (n - m + i)) / i;
  }

  return result;
}

function binomialProbability(k, n, p) {
  return combination(n, k) * p ** k * (1 - p) ** (n - k);
}

const requiredTrialsCache = new Map();

export function binomialTailProbability(kMin, n, p = 0.5) {
  if (!Number.isFinite(kMin) || !Number.isFinite(n) || n < 0 || kMin < 0) {
    return NaN;
  }
  if (p < 0 || p > 1) {
    return NaN;
  }
  if (kMin > n) {
    return 0;
  }

  let total = 0;
  for (let k = kMin; k <= n; k += 1) {
    total += binomialProbability(k, n, p);
  }

  return total;
}

export function twoSidedBinomialTest(kObserved, n, p = 0.5) {
  if (!Number.isFinite(kObserved) || !Number.isFinite(n) || n < 0 || kObserved < 0) {
    return NaN;
  }
  if (p < 0 || p > 1) {
    return NaN;
  }
  if (kObserved > n) {
    return 0;
  }

  const observed = binomialProbability(kObserved, n, p);
  const epsilon = observed * 1e-12 + 1e-15;

  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    const probability = binomialProbability(k, n, p);
    if (probability <= observed + epsilon) {
      total += probability;
    }
  }

  return Math.min(1, total);
}

export function pairPreferencePValue({ wins, losses }) {
  const safeWins = Number.isFinite(wins) ? Math.max(0, wins) : 0;
  const safeLosses = Number.isFinite(losses) ? Math.max(0, losses) : 0;

  const decisiveOutcomes = safeWins + safeLosses;
  if (decisiveOutcomes <= 0) {
    return 1;
  }

  return twoSidedBinomialTest(safeWins, decisiveOutcomes, 0.5);
}

export function computeRequiredTrials(effectSize, alpha = 0.05, targetPower = 0.8) {
  if (!Number.isFinite(effectSize) || effectSize <= 0 || effectSize >= 1) {
    return NaN;
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    return NaN;
  }
  if (!Number.isFinite(targetPower) || targetPower <= 0 || targetPower > 1) {
    return NaN;
  }
  if (Math.abs(effectSize - 0.5) < Number.EPSILON) {
    return Infinity;
  }

  const adjustedEffectSize = effectSize > 0.5 ? effectSize : 1 - effectSize;
  const cacheKey = `${adjustedEffectSize}|${alpha}|${targetPower}`;
  if (requiredTrialsCache.has(cacheKey)) {
    return requiredTrialsCache.get(cacheKey);
  }

  const maxTrials = 10000;
  for (let n = 1; n <= maxTrials; n += 1) {
    const nullProbabilities = [];
    for (let k = 0; k <= n; k += 1) {
      nullProbabilities.push(binomialProbability(k, n, 0.5));
    }

    let power = 0;
    for (let k = 0; k <= n; k += 1) {
      const observed = nullProbabilities[k];
      const epsilon = observed * 1e-12 + 1e-15;

      let pValue = 0;
      for (let j = 0; j <= n; j += 1) {
        if (nullProbabilities[j] <= observed + epsilon) {
          pValue += nullProbabilities[j];
        }
      }

      if (pValue < alpha) {
        power += binomialProbability(k, n, adjustedEffectSize);
      }
    }

    if (power >= targetPower) {
      requiredTrialsCache.set(cacheKey, n);
      return n;
    }
  }

  return Infinity;
}

export function accuracy(correct, total) {
  if (!total) {
    return 0;
  }
  return correct / total;
}

export function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function isSignificant(pValue, alpha = 0.05) {
  return Number.isFinite(pValue) && pValue < alpha;
}
