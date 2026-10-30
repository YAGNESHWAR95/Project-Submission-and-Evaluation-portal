const FACULTY_RECOMMENDATION_WEIGHTS = {
  expertiseSimilarity: 0.6,
  departmentMatch: 0.2,
  availability: 0.1,
  workload: 0.1,
};

const CORE_CONCEPTS = [
  { label: 'Artificial Intelligence', aliases: ['artificial intelligence', 'ai'] },
  { label: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { label: 'Natural Language Processing', aliases: ['natural language processing', 'nlp'] },
  { label: 'Deep Learning', aliases: ['deep learning'] },
  { label: 'Data Science', aliases: ['data science'] },
  { label: 'Statistics', aliases: ['statistics', 'statistical', 'statistical analysis'] },
  { label: 'Data Analytics', aliases: ['data analytics', 'analytics'] },
  { label: 'Cybersecurity', aliases: ['cybersecurity', 'cyber security'] },
  { label: 'Network Security', aliases: ['network security'] },
  { label: 'Computer Networks', aliases: ['computer networks', 'networking'] },
  { label: 'Cryptography', aliases: ['cryptography'] },
  { label: 'Internet of Things', aliases: ['internet of things', 'iot'] },
  { label: 'Embedded Systems', aliases: ['embedded systems'] },
  { label: 'Sensors', aliases: ['sensors'] },
  { label: 'Edge Computing', aliases: ['edge computing'] },
  { label: 'Software Engineering', aliases: ['software engineering'] },
  { label: 'Database Systems', aliases: ['database systems', 'dbms'] },
  { label: 'Cloud Computing', aliases: ['cloud computing'] },
  { label: 'Distributed Systems', aliases: ['distributed systems'] },
];

const SECONDARY_CONCEPTS = [
  { label: 'React', aliases: ['react'] },
  { label: 'Node.js', aliases: ['node js', 'node'] },
  { label: 'MERN', aliases: ['mern'] },
  { label: 'Frontend', aliases: ['frontend', 'front end'] },
  { label: 'Backend', aliases: ['backend', 'back end'] },
  { label: 'Cloud Computing', aliases: ['cloud computing', 'cloud'] },
  { label: 'Distributed Systems', aliases: ['distributed systems'] },
  { label: 'SQL', aliases: ['sql'] },
  { label: 'MongoDB', aliases: ['mongodb'] },
  { label: 'Database Systems', aliases: ['database systems', 'database', 'databases', 'dbms'] },
  { label: 'Python', aliases: ['python'] },
  { label: 'Java', aliases: ['java'] },
  { label: 'System Design', aliases: ['system design'] },
  { label: 'Testing', aliases: ['testing', 'software testing'] },
  { label: 'Embeddings', aliases: ['embeddings', 'embedding'] },
];

const normalizeText = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const containsPhrase = (text, phrase) => {
  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  return Boolean(normalizedPhrase) && ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
};

const findConcepts = (text, concepts) => concepts
  .filter((concept) => concept.aliases.some((alias) => containsPhrase(text, alias)))
  .map((concept) => concept.label);

const buildProjectRepresentation = (project) => {
  if (!project) return '';
  return [
    project.title,
    project.domain,
    project.abstract,
    project.problemStatement,
    project.objectives,
    project.proposedSolution,
    project.methodology,
    project.expectedOutcome,
    project.keywords,
    project.description,
    String(project.files?.reportText || '').slice(0, 50000),
  ].filter(Boolean).join(' ');
};

const buildFacultyRepresentation = (faculty) => {
  if (!faculty) return '';

  const facultyProfile = faculty.facultyProfile || {};
  return [
    facultyProfile.qualification,
    facultyProfile.specialization,
    facultyProfile.expertise,
    facultyProfile.subjects,
    facultyProfile.researchAreas,
    faculty.qualification,
    faculty.specialization,
    faculty.expertise,
  ].flat().filter(Boolean).join(' ');
};

const buildFacultySecondaryRepresentation = (faculty) => {
  const facultyProfile = faculty?.facultyProfile || {};
  return [facultyProfile.expertise, facultyProfile.subjects, facultyProfile.specialization,
    facultyProfile.researchAreas, faculty.expertise, faculty.specialization]
    .flat().filter(Boolean).join(' ');
};

const getDepartmentCompatibility = (project, faculty) => {
  if (!project || !faculty) return 0.5;

  const projectDepartment = normalizeText(project.department || project.leader?.department || '');
  const facultyDepartment = normalizeText(faculty.department || '');

  if (!projectDepartment || !facultyDepartment) return 0.7;
  if (projectDepartment === facultyDepartment) return 1;

  const crossDepartmentBoost = {
    'computer science': ['computer science', 'information technology'],
    'information technology': ['information technology', 'computer science'],
  };

  const allowed = crossDepartmentBoost[projectDepartment] || [];
  return allowed.includes(facultyDepartment) ? 0.8 : 0.2;
};

const getFacultyCurrentLoad = (faculty) => {
  if (typeof faculty.assignedProjectCount === 'number') return faculty.assignedProjectCount;
  if (typeof faculty.currentProjects === 'number') return faculty.currentProjects;
  if (typeof faculty.currentProjectCount === 'number') return faculty.currentProjectCount;
  if (faculty.facultyProfile?.currentProjects) return Number(faculty.facultyProfile.currentProjects);
  return 0;
};

const getFacultyMaxProjects = (faculty) => {
  if (typeof faculty.maxProjects === 'number') return faculty.maxProjects;
  if (faculty.facultyProfile?.maxProjects) return Number(faculty.facultyProfile.maxProjects);
  return 6;
};

const buildRecommendationExplanation = (faculty, matchedCoreExpertise, reportMatchedCoreExpertise, secondarySkills, missingCoreExpertise, currentLoad, maxProjects, availability) => {
  const facultyProfile = faculty?.facultyProfile || {};
  const qualification = facultyProfile.qualification || faculty.qualification || 'Not specified';
  const experienceYears = Number(facultyProfile.experienceYears || 0);
  const expertiseSummary = matchedCoreExpertise.length
    ? `Core expertise matches: ${matchedCoreExpertise.join(', ')}.`
    : `No documented core expertise match. Profile expertise: ${facultyProfile.expertise?.length ? facultyProfile.expertise.join(', ') : 'Not specified'}.`;
  const secondarySummary = secondarySkills.length
    ? `Relevant secondary skills: ${secondarySkills.join(', ')}.`
    : '';
  const reportSummary = reportMatchedCoreExpertise.length
    ? `Extracted report text supports these subject matches: ${reportMatchedCoreExpertise.join(', ')}.`
    : '';
  const missingSummary = missingCoreExpertise.length
    ? `Unmatched project areas: ${missingCoreExpertise.join(', ')}.`
    : '';

  return [
    expertiseSummary,
    reportSummary,
    secondarySummary,
    missingSummary,
    `Qualification: ${qualification}.`,
    `Recorded experience: ${experienceYears ? `${experienceYears} years` : 'Not specified'}.`,
    `Workload: ${currentLoad}/${maxProjects} projects; ${availability}.`,
  ].filter(Boolean).join(' ');
};

const getFacultyRecommendationsForProject = (project, facultyList = []) => {
  if (!project) return [];

  const projectText = buildProjectRepresentation(project);
  const projectCoreConcepts = findConcepts(`${project.domain || ''} ${projectText}`, CORE_CONCEPTS);
  const projectSecondaryConcepts = findConcepts(`${projectText} ${project.technologies || ''}`, SECONDARY_CONCEPTS);
  const reportCoreConcepts = findConcepts(String(project.files?.reportText || '').slice(0, 50000), CORE_CONCEPTS);

  const candidates = facultyList.filter((faculty) => {
    if (!faculty || faculty.role !== 'faculty') return false;
    if (faculty.isActive === false) return false;
    const availability = faculty.availability || faculty.facultyProfile?.availability || 'available';
    if (availability === 'unavailable') return false;
    const maxProjects = getFacultyMaxProjects(faculty);
    const currentLoad = getFacultyCurrentLoad(faculty);
    if (currentLoad >= maxProjects) return false;
    return true;
  });

  const recommendations = candidates.map((faculty) => {
    const facultyText = buildFacultyRepresentation(faculty);
    const facultyCoreConcepts = findConcepts(facultyText, CORE_CONCEPTS);
    const facultySecondaryConcepts = findConcepts(buildFacultySecondaryRepresentation(faculty), SECONDARY_CONCEPTS);
    const matchedCoreExpertise = projectCoreConcepts.filter((concept) => facultyCoreConcepts.includes(concept));
    const reportMatchedCoreExpertise = matchedCoreExpertise.filter((concept) => reportCoreConcepts.includes(concept));
    const missingCoreExpertise = projectCoreConcepts.filter((concept) => !facultyCoreConcepts.includes(concept));
    const secondarySkills = projectSecondaryConcepts.filter((concept) => facultySecondaryConcepts.includes(concept));
    const coreMatchRatio = projectCoreConcepts.length ? matchedCoreExpertise.length / projectCoreConcepts.length : 0;
    const secondaryMatchRatio = projectSecondaryConcepts.length ? secondarySkills.length / projectSecondaryConcepts.length : 0;
    const expertiseSimilarity = (coreMatchRatio * 0.85) + (secondaryMatchRatio * 0.15);
    const departmentMatch = getDepartmentCompatibility(project, faculty);
    const availability = (faculty.availability || faculty.facultyProfile?.availability || 'available') === 'available' ? 1 : 0.5;
    const maxProjects = getFacultyMaxProjects(faculty) || 1;
    const currentLoad = getFacultyCurrentLoad(faculty);
    const workload = maxProjects > 0 ? 1 - Math.min(currentLoad / maxProjects, 1) : 0.5;

    const finalScore = (
      expertiseSimilarity * FACULTY_RECOMMENDATION_WEIGHTS.expertiseSimilarity +
      departmentMatch * FACULTY_RECOMMENDATION_WEIGHTS.departmentMatch +
      availability * FACULTY_RECOMMENDATION_WEIGHTS.availability +
      workload * FACULTY_RECOMMENDATION_WEIGHTS.workload
    );

    const availabilityStatus = faculty.availability || faculty.facultyProfile?.availability || 'available';
    const qualification = faculty.facultyProfile?.qualification || faculty.qualification || '';
    const evidence = {
      matchedCoreExpertise,
      reportMatchedCoreExpertise,
      secondarySkills,
      missingCoreExpertise,
      qualification: qualification || 'Not specified',
      technologyMatch: secondarySkills.length ? secondarySkills.join(', ') : 'No direct technology overlap recorded',
      confidence: matchedCoreExpertise.length ? (coreMatchRatio >= 0.5 ? 'high' : 'medium') : 'low',
    };

    return {
      _id: faculty._id,
      name: faculty.name,
      email: faculty.email,
      department: faculty.department,
      facultyId: faculty.facultyId || faculty.facultyProfile?.facultyId || 'N/A',
      expertise: faculty.facultyProfile?.expertise || faculty.expertise || [],
      specialization: faculty.facultyProfile?.specialization || faculty.specialization || '',
      qualification: qualification || 'Not specified',
      availability: availabilityStatus,
      currentProjects: currentLoad,
      maxProjects,
      suitabilityScore: Number((finalScore * 100).toFixed(1)),
      expertiseSimilarity: Number(expertiseSimilarity.toFixed(3)),
      departmentMatch: Number(departmentMatch.toFixed(3)),
      workload: Number(workload.toFixed(3)),
      finalScore: Number((finalScore * 100).toFixed(1)),
      matchedCoreExpertise,
      reportMatchedCoreExpertise,
      secondarySkills,
      missingCoreExpertise,
      missingQualifications: qualification ? [] : ['Qualification not specified'],
      eligibility: {
        eligible: true,
        availability: availabilityStatus,
        currentProjects: currentLoad,
        maxProjects,
      },
      confidence: evidence.confidence,
      evidence,
      explanation: buildRecommendationExplanation(
        faculty,
        matchedCoreExpertise,
        reportMatchedCoreExpertise,
        secondarySkills,
        missingCoreExpertise,
        currentLoad,
        maxProjects,
        availabilityStatus,
      ),
    };
  });

  return recommendations
    .filter((item) => item.finalScore >= 20)
    .sort((a, b) => b.finalScore - a.finalScore);
};

module.exports = {
  FACULTY_RECOMMENDATION_WEIGHTS,
  getFacultyRecommendationsForProject,
  buildProjectRepresentation,
  buildFacultyRepresentation,
};
