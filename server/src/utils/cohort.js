const departmentCodes = {
  'computer science': 'CSE',
  'information technology': 'IT',
};

const getCohortId = ({ department, section, batch } = {}) => {
  if (!department || !section || !batch) return null;

  const departmentName = department.trim().replace(/\s+/g, ' ').toLowerCase();
  const departmentCode = departmentCodes[departmentName]
    || department.trim().split(/\s+/).map((word) => word[0]).join('').toUpperCase();
  const batchMatch = batch.trim().match(/^(20\d{2})\s*-\s*(20\d{2})$/);
  const batchStartYear = batchMatch?.[1];
  const normalizedSection = section.trim().toUpperCase();

  if (!departmentCode || !batchStartYear || Number(batchMatch[2]) <= Number(batchStartYear) || !normalizedSection) return null;
  return `${departmentCode}-${batchStartYear}-${normalizedSection}`;
};

const formatCohort = ({ department, section, batch } = {}) => {
  const cohortId = getCohortId({ department, section, batch });
  if (!cohortId) return null;
  const code = cohortId.split('-')[0];
  return `${code}-${section.trim().toUpperCase()} (batch ${batch.trim()})`;
};

module.exports = { getCohortId, formatCohort };