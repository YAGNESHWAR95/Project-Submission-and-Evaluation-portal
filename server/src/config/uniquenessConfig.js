module.exports = {
  algorithm: 'TF-IDF + Cosine Similarity',
  thresholds: {
    likelyUniqueMax: 39,
    needsAttentionMax: 69,
  },
  statuses: {
    notChecked: 'not_checked',
    checking: 'checking',
    completed: 'completed',
    failed: 'failed',
    insufficientText: 'insufficient_text',
  },
  results: {
    likelyUnique: 'likely_unique',
    needsAttention: 'needs_attention',
    highSimilarity: 'high_similarity',
    insufficientText: 'insufficient_text',
  },
  comparisonFields: [
    'title',
    'domain',
    'abstract',
    'problemStatement',
    'objectives',
    'methodology',
    'description',
    'proposedSolution',
    'technologies',
    'expectedOutcome',
    'keywords',
  ],
};
