export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function applyMatch(ratings, stats, presetA, presetB, scoreA, kFactor = 32) {
  if (!ratings.has(presetA) || !ratings.has(presetB)) {
    throw new Error("Unknown preset in ELO update");
  }

  const scoreB = 1 - scoreA;
  const ratingA = ratings.get(presetA);
  const ratingB = ratings.get(presetB);

  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);

  ratings.set(presetA, ratingA + kFactor * (scoreA - expectedA));
  ratings.set(presetB, ratingB + kFactor * (scoreB - expectedB));

  const statsA = stats.get(presetA);
  const statsB = stats.get(presetB);

  if (scoreA === 1) {
    statsA.wins += 1;
    statsB.losses += 1;
  } else if (scoreA === 0) {
    statsA.losses += 1;
    statsB.wins += 1;
  } else {
    statsA.draws += 1;
    statsB.draws += 1;
  }
}

export function buildStandings(presets, matches, kFactor = 32) {
  const ratings = new Map();
  const stats = new Map();

  for (const preset of presets) {
    ratings.set(preset.id, 1500);
    stats.set(preset.id, {
      wins: 0,
      losses: 0,
      draws: 0,
    });
  }

  for (const match of matches) {
    if (!ratings.has(match.presetA) || !ratings.has(match.presetB)) {
      continue;
    }
    applyMatch(ratings, stats, match.presetA, match.presetB, match.scoreA, kFactor);
  }

  return presets
    .map((preset) => {
      const rowStats = stats.get(preset.id);
      return {
        id: preset.id,
        name: preset.name,
        rating: ratings.get(preset.id),
        wins: rowStats.wins,
        losses: rowStats.losses,
        draws: rowStats.draws,
      };
    })
    .sort((a, b) => b.rating - a.rating);
}

export function buildHeadToHead(presets, matches) {
  const presetIds = presets.map((preset) => preset.id);
  const matrix = new Map();

  for (const rowId of presetIds) {
    matrix.set(rowId, new Map());
    for (const colId of presetIds) {
      matrix.get(rowId).set(colId, { wins: 0, losses: 0, draws: 0, total: 0 });
    }
  }

  for (const match of matches) {
    if (!matrix.has(match.presetA) || !matrix.has(match.presetB)) {
      continue;
    }

    const aVsB = matrix.get(match.presetA).get(match.presetB);
    const bVsA = matrix.get(match.presetB).get(match.presetA);

    if (match.scoreA === 1) {
      aVsB.wins += 1;
      bVsA.losses += 1;
    } else if (match.scoreA === 0) {
      aVsB.losses += 1;
      bVsA.wins += 1;
    } else {
      aVsB.draws += 1;
      bVsA.draws += 1;
    }

    aVsB.total += 1;
    bVsA.total += 1;
  }

  return matrix;
}
