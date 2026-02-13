function clampScore(score) {
  if (score === 1 || score === 0 || score === 0.5) {
    return score;
  }
  return null;
}

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (q <= 0) {
    return sortedValues[0];
  }
  if (q >= 1) {
    return sortedValues[sortedValues.length - 1];
  }

  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function collectMatchData(presets, matches) {
  const ids = presets.map((preset) => preset.id);
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const size = ids.length;

  const wins = new Array(size).fill(0);
  const totals = Array.from({ length: size }, () => new Array(size).fill(0));
  const statsById = new Map(ids.map((id) => [id, {
    wins: 0,
    losses: 0,
    draws: 0,
    total: 0,
    effectiveWins: 0,
  }]));

  for (const match of matches) {
    const i = indexById.get(match.presetA);
    const j = indexById.get(match.presetB);
    const scoreA = clampScore(match.scoreA);

    if (i === undefined || j === undefined || i === j || scoreA === null) {
      continue;
    }

    totals[i][j] += 1;
    totals[j][i] += 1;
    wins[i] += scoreA;
    wins[j] += 1 - scoreA;

    const statsA = statsById.get(match.presetA);
    const statsB = statsById.get(match.presetB);

    if (scoreA === 1) {
      statsA.wins += 1;
      statsB.losses += 1;
      statsA.effectiveWins += 1;
    } else if (scoreA === 0) {
      statsA.losses += 1;
      statsB.wins += 1;
      statsB.effectiveWins += 1;
    } else {
      statsA.draws += 1;
      statsB.draws += 1;
      statsA.effectiveWins += 0.5;
      statsB.effectiveWins += 0.5;
    }

    statsA.total += 1;
    statsB.total += 1;
  }

  return {
    ids,
    indexById,
    wins,
    totals,
    statsById,
  };
}

function fitStrengthsFromData(matchData, {
  maxIterations = 80,
  tolerance = 1e-7,
  epsilon = 1e-9,
} = {}) {
  const { ids, wins, totals } = matchData;
  const size = ids.length;
  const strengths = new Array(size).fill(1);

  if (size === 0) {
    return strengths;
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next = new Array(size).fill(1);

    for (let i = 0; i < size; i += 1) {
      let denominator = 0;

      for (let j = 0; j < size; j += 1) {
        if (i === j || totals[i][j] <= 0) {
          continue;
        }
        denominator += totals[i][j] / (strengths[i] + strengths[j]);
      }

      if (denominator <= 0) {
        next[i] = strengths[i];
      } else {
        next[i] = Math.max(epsilon, (wins[i] + epsilon) / denominator);
      }
    }

    const sum = next.reduce((acc, value) => acc + value, 0);
    if (sum > 0) {
      const targetSum = size;
      for (let i = 0; i < size; i += 1) {
        next[i] = (next[i] / sum) * targetSum;
      }
    }

    let maxRelativeDelta = 0;
    for (let i = 0; i < size; i += 1) {
      const baseline = Math.max(epsilon, strengths[i]);
      const delta = Math.abs(next[i] - strengths[i]) / baseline;
      if (delta > maxRelativeDelta) {
        maxRelativeDelta = delta;
      }
      strengths[i] = next[i];
    }

    if (maxRelativeDelta < tolerance) {
      break;
    }
  }

  return strengths;
}

export function fitBradleyTerry(presets, matches, options = {}) {
  const data = collectMatchData(presets, matches);
  const strengths = fitStrengthsFromData(data, options);
  return new Map(data.ids.map((id, index) => [id, strengths[index]]));
}

export function normalizeBradleyTerryScores(strengthById) {
  const values = [...strengthById.values()];
  const maxStrength = values.length > 0 ? Math.max(...values) : 0;

  if (!(maxStrength > 0)) {
    return new Map([...strengthById.keys()].map((id) => [id, 0]));
  }

  return new Map([...strengthById.entries()].map(([id, strength]) => [id, (strength / maxStrength) * 100]));
}

export function bootstrapBradleyTerryScores(presets, matches, {
  samples = 80,
  random = Math.random,
  fitOptions = {},
} = {}) {
  const baseStrengths = fitBradleyTerry(presets, matches, fitOptions);
  const baseScores = normalizeBradleyTerryScores(baseStrengths);
  const scoreSamples = new Map(presets.map((preset) => [preset.id, []]));

  if (!Array.isArray(matches) || matches.length === 0 || samples <= 0) {
    return new Map(presets.map((preset) => [preset.id, {
      low: baseScores.get(preset.id) ?? 0,
      high: baseScores.get(preset.id) ?? 0,
    }]));
  }

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const resampled = new Array(matches.length);
    for (let i = 0; i < matches.length; i += 1) {
      const pick = Math.floor(random() * matches.length);
      resampled[i] = matches[pick];
    }

    const strengths = fitBradleyTerry(presets, resampled, fitOptions);
    const scores = normalizeBradleyTerryScores(strengths);

    for (const preset of presets) {
      scoreSamples.get(preset.id).push(scores.get(preset.id) ?? 0);
    }
  }

  const confidenceById = new Map();
  for (const preset of presets) {
    const samplesForPreset = scoreSamples.get(preset.id).slice().sort((a, b) => a - b);
    confidenceById.set(preset.id, {
      low: quantile(samplesForPreset, 0.025),
      high: quantile(samplesForPreset, 0.975),
    });
  }

  return confidenceById;
}

export function buildBradleyTerryStandings(presets, matches, {
  confidenceSamples = 80,
  random = Math.random,
  fitOptions = {},
} = {}) {
  const data = collectMatchData(presets, matches);
  const strengthById = fitBradleyTerry(presets, matches, fitOptions);
  const scoreById = normalizeBradleyTerryScores(strengthById);
  const confidenceById = bootstrapBradleyTerryScores(presets, matches, {
    samples: confidenceSamples,
    random,
    fitOptions,
  });

  return presets
    .map((preset) => {
      const stats = data.statsById.get(preset.id);
      const total = stats.total;
      const winRate = total > 0 ? stats.effectiveWins / total : 0;

      return {
        id: preset.id,
        name: preset.name,
        strength: strengthById.get(preset.id) ?? 1,
        btScore: scoreById.get(preset.id) ?? 0,
        btConfidence: confidenceById.get(preset.id) ?? { low: 0, high: 0 },
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        winRate,
      };
    })
    .sort((a, b) => b.strength - a.strength || b.wins - a.wins || a.name.localeCompare(b.name));
}
