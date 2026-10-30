export const getSimilarityDisplayState = (project) => {
  const check = project?.uniquenessCheck;
  const status = check?.status || 'not_checked';

  if (status === 'checking') {
    return { score: null, label: 'Checking...', tone: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' };
  }

  if (status === 'failed') {
    return { score: null, label: 'Check failed', tone: 'bg-red-500/10 text-red-400 border border-red-500/20' };
  }

  if (status === 'insufficient_text') {
    return { score: null, label: 'Insufficient text', tone: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' };
  }

  if (status === 'completed') {
    const hasSavedScore = check.overallScore !== null
      && check.overallScore !== undefined
      && Number.isFinite(Number(check.overallScore));
    if (!hasSavedScore) {
      return { score: null, label: 'Legacy score unavailable', tone: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' };
    }
    const savedScore = Number(check.overallScore);
    return {
      score: savedScore,
      label: `${savedScore}% Text similarity`,
      tone: savedScore > 20 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    };
  }

  return { score: null, label: 'Not checked', tone: 'bg-slate-500/10 text-slate-400 border border-slate-500/20' };
};

export const getSimilaritySemanticLabel = (match) => {
  const score = match?.semanticSimilarity;
  if (match?.semanticStatus === 'available'
    && score !== null
    && score !== undefined
    && Number.isFinite(Number(score))) {
    return `${Number(score)}% Sentence-BERT similarity`;
  }
  if (match?.semanticStatus === 'unavailable') return 'Sentence-BERT score unavailable';
  return 'Semantic score not recorded for this legacy result';
};

export const getSimilarityAlgorithmLabel = (check) => {
  if (!check?.algorithm) return 'Algorithm not recorded';
  if (check.semanticStatus) return check.algorithm;
  if (/optional sentence-bert/i.test(check.algorithm)) {
    return 'Legacy result; Sentence-BERT execution was not recorded';
  }
  return check.algorithm;
};

export const getSimilaritySectionScore = (section) => {
  if (section?.comparable !== true
    || section.similarityScore === null
    || section.similarityScore === undefined
    || !Number.isFinite(Number(section.similarityScore))) {
    return 'Not comparable';
  }
  return `${Number(section.similarityScore)}% text similarity`;
};
