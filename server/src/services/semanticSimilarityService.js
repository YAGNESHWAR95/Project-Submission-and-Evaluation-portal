const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const EMBEDDING_CACHE = new Map();

const TOKEN_SYNONYMS = {
  ai: ['artificial intelligence', 'machine learning', 'ml'],
  'machine learning': ['ml', 'ai', 'artificial intelligence'],
  'natural language processing': ['nlp', 'language processing'],
  'data science': ['analytics', 'statistics'],
  'deep learning': ['neural networks'],
  cybersecurity: ['security', 'network security'],
  'web development': ['react', 'node', 'mern', 'frontend', 'backend'],
  'cloud computing': ['cloud', 'distributed systems'],
  'software engineering': ['system design', 'testing', 'software quality'],
  iot: ['internet of things', 'embedded systems', 'edge computing'],
  database: ['dbms', 'sql', 'database management'],
  'fraud detection': ['fraud analysis', 'anomaly detection', 'suspicious payment detection'],
  'risk scoring': ['credit risk', 'fraud scoring', 'risk analysis'],
  fraudulent: ['fraud', 'suspicious', 'scam'],
  financial: ['finance', 'payment', 'banking'],
  detects: ['identifies', 'finds', 'recognizes'],
  identifies: ['detects', 'finds', 'recognizes'],
  system: ['application', 'platform', 'software'],
  application: ['system', 'platform', 'software'],
  transactions: ['payments', 'payment', 'transactions'],
  payments: ['payment', 'transactions'],
  suspicious: ['fraudulent', 'risky', 'abnormal'],
};

const normalizeText = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const getSemanticSimilarityConfig = () => {
  const rawValue = String(process.env.ENABLE_SEMANTIC_SIMILARITY || '').trim().toLowerCase();
  const enabled = rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
  const modelName = process.env.SEMANTIC_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';

  return {
    enabled,
    modelName,
    mode: enabled ? 'sentence-transformers' : 'tfidf',
    pythonBin: process.env.PYTHON_BIN || 'python',
  };
};

const getEmbeddingCacheKey = (value = '', modelName = getSemanticSimilarityConfig().modelName) => {
  const normalizedText = normalizeText(value);
  return crypto.createHash('sha256').update(`${modelName}|${normalizedText}`).digest('hex');
};

const tokenize = (value = '') => {
  const text = normalizeText(value);
  if (!text) return [];

  const tokens = text.split(/\s+/).filter(Boolean);
  const expanded = [];

  tokens.forEach((token) => {
    expanded.push(token);
    const related = TOKEN_SYNONYMS[token] || TOKEN_SYNONYMS[normalizeText(token)];
    if (related) {
      expanded.push(...related.map((entry) => normalizeText(entry)));
    }
  });

  return [...new Set(expanded.filter(Boolean))];
};

const buildWeightedVector = (text = '') => {
  const vector = {};
  tokenize(text).forEach((token) => {
    const weight = token.length > 3 ? 2 : 1;
    vector[token] = (vector[token] || 0) + weight;
  });
  return vector;
};

const calculateCosineSimilarity = (left = {}, right = {}) => {
  const terms = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  terms.forEach((term) => {
    const leftValue = left[term] || 0;
    const rightValue = right[term] || 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  });

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const calculateLexicalSimilarity = (leftText = '', rightText = '') => {
  const leftVector = buildWeightedVector(leftText);
  const rightVector = buildWeightedVector(rightText);
  return calculateCosineSimilarity(leftVector, rightVector);
};

const calculateSemanticFallbackScore = (leftText = '', rightText = '') => {
  const leftTerms = new Set(tokenize(leftText));
  const rightTerms = new Set(tokenize(rightText));
  const overlap = [...leftTerms].filter((term) => rightTerms.has(term));
  const lexicalSimilarity = calculateLexicalSimilarity(leftText, rightText);
  const overlapRatio = overlap.length > 0
    ? overlap.length / Math.max(1, Math.min(leftTerms.size, rightTerms.size))
    : 0;

  return Math.min(1, Math.max(lexicalSimilarity, overlapRatio * 0.8 + lexicalSimilarity * 0.2));
};

const extractSharedSignals = (leftText = '', rightText = '') => {
  const leftTokens = new Set(tokenize(leftText));
  const rightTokens = new Set(tokenize(rightText));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));

  const aliases = Object.entries(TOKEN_SYNONYMS)
    .map(([key, values]) => ({ key, values: [key, ...values] }))
    .filter(({ key, values }) => {
      const leftHasKey = values.some((value) => normalizeText(leftText).includes(normalizeText(value)));
      const rightHasKey = values.some((value) => normalizeText(rightText).includes(normalizeText(value)));
      return leftHasKey && rightHasKey;
    })
    .map(({ key }) => key);

  return [...new Set([...shared, ...aliases])].map((term) => term.replace(/\b\w/g, (char) => char.toUpperCase())).slice(0, 5);
};

const getCachedEmbedding = (text = '', modelName = getSemanticSimilarityConfig().modelName) => {
  const key = getEmbeddingCacheKey(text, modelName);
  return EMBEDDING_CACHE.get(key) || null;
};

const setCachedEmbedding = (text = '', vector, modelName = getSemanticSimilarityConfig().modelName) => {
  const key = getEmbeddingCacheKey(text, modelName);
  EMBEDDING_CACHE.set(key, vector);
  return vector;
};

const runSentenceTransformer = (texts, modelName, pythonBin) => {
  const script = `
import json
import os
import sys

try:
    from sentence_transformers import SentenceTransformer

    model_name = os.getenv('SEMANTIC_MODEL', 'sentence-transformers/all-MiniLM-L6-v2')
    payload = json.loads(sys.argv[1])
    model = SentenceTransformer(model_name)
    embeddings = model.encode(payload, normalize_embeddings=True, convert_to_numpy=True)
    print(json.dumps({
        'ok': True,
        'embeddings': [[float(value) for value in row] for row in embeddings.tolist()]
    }))
except Exception as exc:
    print(json.dumps({
        'ok': False,
        'error': str(exc)
    }))
`;

  const result = spawnSync(pythonBin, ['-c', script, JSON.stringify(texts)], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      SEMANTIC_MODEL: modelName,
    },
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  try {
    return JSON.parse(result.stdout.trim() || '{}');
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
};

const getEmbeddingForText = (text = '', modelName = getSemanticSimilarityConfig().modelName, pythonBin = getSemanticSimilarityConfig().pythonBin) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return null;

  const cachedEmbedding = getCachedEmbedding(normalizedText, modelName);
  if (cachedEmbedding) return cachedEmbedding;

  const payload = runSentenceTransformer([normalizedText], modelName, pythonBin);
  if (!payload.ok || !Array.isArray(payload.embeddings) || !payload.embeddings[0]) {
    return null;
  }

  const vector = payload.embeddings[0];
  return setCachedEmbedding(normalizedText, vector, modelName);
};

const cosineSimilarityBetweenEmbeddings = (left = [], right = []) => {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

const computeSemanticSimilarity = (leftText = '', rightText = '') => {
  const config = getSemanticSimilarityConfig();
  const left = normalizeText(leftText);
  const right = normalizeText(rightText);
  const fallbackScore = calculateSemanticFallbackScore(left, right);

  if (!left || !right) {
    return {
      enabled: false,
      semanticAvailable: false,
      attempted: false,
      status: 'unavailable',
      score: null,
      fallbackScore: 0,
      reason: 'No meaningful text available to compare.',
      evidence: 'Missing project text prevented semantic comparison.',
      sharedSignals: [],
    };
  }

  if (!config.enabled) {
    return {
      enabled: false,
      semanticAvailable: false,
      attempted: false,
      status: 'unavailable',
      score: null,
      fallbackScore,
      reason: 'Sentence-BERT is disabled; no semantic score was computed.',
      evidence: 'Text similarity was computed separately using the TF-IDF + cosine baseline.',
      sharedSignals: extractSharedSignals(left, right),
    };
  }

  const leftEmbedding = getEmbeddingForText(left, config.modelName, config.pythonBin);
  const rightEmbedding = getEmbeddingForText(right, config.modelName, config.pythonBin);

  if (!leftEmbedding || !rightEmbedding) {
    return {
      enabled: true,
      semanticAvailable: false,
      attempted: true,
      status: 'unavailable',
      score: null,
      fallbackScore,
      reason: 'Sentence-BERT was unavailable; no semantic score was computed.',
      evidence: 'Text similarity was computed separately using the TF-IDF + cosine baseline.',
      sharedSignals: extractSharedSignals(left, right),
    };
  }

  const semanticScore = cosineSimilarityBetweenEmbeddings(leftEmbedding, rightEmbedding);
  return {
    enabled: true,
    semanticAvailable: true,
    attempted: true,
    status: 'available',
    score: Math.min(1, Math.max(0, Number(semanticScore) || 0)),
    fallbackScore,
    reason: 'Sentence-BERT semantic comparison was used to compare project meaning.',
    evidence: 'Embeddings were generated from the relevant project text and compared by cosine similarity.',
    sharedSignals: extractSharedSignals(left, right),
  };
};

const buildTextSimilarityExplanation = ({ textSimilarity, semanticSimilarity, sharedSignals = [], evidence = '' } = {}) => {
  const textScore = Number(textSimilarity ?? 0);
  const parts = [
    `Text similarity: ${Math.round(textScore)}%.`,
  ];

  if (semanticSimilarity !== null && semanticSimilarity !== undefined && Number.isFinite(Number(semanticSimilarity))) {
    parts.push(`Semantic similarity: ${Math.round(Number(semanticSimilarity))}%.`);
  }

  if (sharedSignals.length > 0) {
    parts.push(`Shared signals: ${sharedSignals.slice(0, 3).join(', ')}.`);
  }

  if (evidence) {
    parts.push(`Evidence: ${evidence}`);
  }

  return parts.join(' ');
};

module.exports = {
  EMBEDDING_CACHE,
  getSemanticSimilarityConfig,
  computeSemanticSimilarity,
  buildTextSimilarityExplanation,
  getEmbeddingCacheKey,
  calculateLexicalSimilarity,
};
