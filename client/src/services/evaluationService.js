import api from './api';

// Submit grading scores
export const submitEvaluation = async (evaluationData) => {
  const response = await api.post('/evaluations', evaluationData);
  return response.data.evaluation;
};

// Retrieve scores for a project
export const getEvaluationsByProject = async (projectId) => {
  const response = await api.get(`/evaluations/project/${projectId}`);
  return response.data.evaluations;
};
