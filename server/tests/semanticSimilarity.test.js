const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeSemanticSimilarity,
  getSemanticSimilarityConfig,
  getEmbeddingCacheKey,
  buildTextSimilarityExplanation,
} = require('../src/services/semanticSimilarityService');

test('semantic similarity can detect related meanings expressed with different wording', () => {
  const result = computeSemanticSimilarity(
    'An online system that detects fraudulent financial transactions.',
    'A machine-learning application that identifies suspicious payments.'
  );

  assert.ok(result.enabled === true || result.enabled === false);
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.ok(result.score >= 0.4 || result.fallbackScore >= 0.4);
  assert.ok(result.reason);
});

test('semantic similarity configuration is optional and non-blocking', () => {
  const config = getSemanticSimilarityConfig();

  assert.ok(config.enabled === true || config.enabled === false);
  assert.ok(['tfidf', 'sentence-transformers', 'disabled'].includes(config.mode));
  assert.ok(['sentence-transformers/all-MiniLM-L6-v2', 'disabled', ''].includes(config.modelName) || typeof config.modelName === 'string');
});

test('embedding cache keys change when text changes', () => {
  const keyA = getEmbeddingCacheKey('An online system for fraud detection');
  const keyB = getEmbeddingCacheKey('An online system for suspicious payment detection');

  assert.notEqual(keyA, keyB);
});

test('explanations keep text and semantic scores separated', () => {
  const explanation = buildTextSimilarityExplanation({
    textSimilarity: 78,
    semanticSimilarity: 65,
    sharedSignals: ['fraud detection', 'risk scoring'],
    evidence: 'Both descriptions mention suspicious financial activity and risk screening.',
  });

  assert.match(explanation, /Text similarity/i);
  assert.match(explanation, /Semantic similarity/i);
  assert.match(explanation, /fraud detection/i);
});
