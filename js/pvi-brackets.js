// =============================================================================
// pvi-brackets.js — PVI scoring brackets (per-portfolio, per-metric)
// =============================================================================
// Bracket format: sorted descending by gt (greater-than threshold).
// lookupPVIScore returns the score of the first bracket where ratio > gt.
// Returns 0 if ratio = 0 (no bracket matches).
// =============================================================================

(function () {

  // Onboard: score 2 = 0-10%, score 3 = >10-15%, ..., score 10 = >45%
  function onboardBrackets() {
    return [
      { gt: 0.45, score: 10 },
      { gt: 0.40, score: 9  },
      { gt: 0.35, score: 8  },
      { gt: 0.30, score: 7  },
      { gt: 0.25, score: 6  },
      { gt: 0.20, score: 5  },
      { gt: 0.15, score: 4  },
      { gt: 0.10, score: 3  },
      { gt: -1,   score: 2  }
    ];
  }

  // Adopt: score 5 = 0-3%, score 6 = >3-6%, ..., score 10 = >15%
  function adoptBrackets() {
    return [
      { gt: 0.15, score: 10 },
      { gt: 0.12, score: 9  },
      { gt: 0.09, score: 8  },
      { gt: 0.06, score: 7  },
      { gt: 0.03, score: 6  },
      { gt: -1,   score: 5  }
    ];
  }

  // Per-portfolio brackets — kept separate so they can diverge in the future
  var BRACKETS = {
    "Networking": {
      "Onboard": onboardBrackets(),
      "Adopt":   adoptBrackets()
    },
    "Security": {
      "Onboard": onboardBrackets(),
      "Adopt":   adoptBrackets()
    },
    "Cloud + AI Infrastructure": {
      "Onboard": onboardBrackets(),
      "Adopt":   adoptBrackets()
    }
  };

  // Returns score for given portfolio + metric + ratio.
  // Brackets are sorted descending; first match where ratio > gt wins.
  function lookupPVIScore(portfolio, metric, ratio) {
    if (ratio === null || ratio === undefined || isNaN(ratio)) return null;
    var domainBrackets = BRACKETS[portfolio];
    if (!domainBrackets) return null;
    var brackets = domainBrackets[metric];
    if (!brackets) return null;
    for (var i = 0; i < brackets.length; i++) {
      if (ratio > brackets[i].gt) return brackets[i].score;
    }
    return 0; // ratio = 0 exactly
  }

  window.lookupPVIScore = lookupPVIScore;
  window.PVI_BRACKETS   = BRACKETS;
})();
