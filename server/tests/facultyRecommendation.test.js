const test = require('node:test');
const assert = require('node:assert/strict');

const { getFacultyRecommendationsForProject } = require('../src/services/facultyRecommendationService');

test('faculty recommendation ranks matching expertise highest and filters inactive or unavailable faculty', () => {
  const project = {
    title: 'AI-based NLP project evaluation portal',
    domain: 'Machine Learning',
    abstract: 'A machine learning and NLP system for evaluating project similarity and faculty alignment.',
    problemStatement: 'We need a system using NLP and machine learning to evaluate project proposals.',
    objectives: 'Improve project similarity detection using NLP and semantic matching.',
    methodology: 'Use NLP, embeddings, and semantic similarity for faculty matching.',
    technologies: 'Node.js, React, MongoDB, NLP, ML',
    expectedOutcome: 'A semantic matching portal for faculty assignments.',
  };

  const faculty = [
    {
      _id: 'f1',
      name: 'Dr. Anitha Rao',
      role: 'faculty',
      department: 'Information Technology',
      isActive: true,
      availability: 'available',
      facultyProfile: {
        qualification: 'Ph.D.',
        specialization: 'Artificial Intelligence',
        expertise: ['Machine Learning', 'NLP', 'Deep Learning', 'Data Science'],
        subjects: ['AI', 'Machine Learning', 'Data Mining'],
        researchAreas: ['Natural Language Processing', 'Educational AI'],
        maxProjects: 8,
      },
      assignedProjectCount: 2,
    },
    {
      _id: 'f2',
      name: 'Dr. Ravi Kumar',
      role: 'faculty',
      department: 'Information Technology',
      isActive: true,
      availability: 'available',
      facultyProfile: {
        qualification: 'M.Tech',
        specialization: 'Web and Cloud Computing',
        expertise: ['React', 'Node.js', 'Cloud Computing', 'Distributed Systems'],
        subjects: ['Web Development', 'Cloud Computing'],
        researchAreas: ['Cloud Applications'],
        maxProjects: 8,
      },
      assignedProjectCount: 1,
    },
    {
      _id: 'f3',
      name: 'Dr. Kiran Rao',
      role: 'faculty',
      department: 'Computer Science',
      isActive: false,
      availability: 'available',
      facultyProfile: {
        qualification: 'M.Tech',
        specialization: 'IoT',
        expertise: ['IoT', 'Embedded Systems', 'Sensors'],
        subjects: ['IoT', 'Embedded Systems'],
        researchAreas: ['Smart Systems'],
        maxProjects: 6,
      },
      assignedProjectCount: 1,
    },
    {
      _id: 'f4',
      name: 'Dr. Suresh Reddy',
      role: 'faculty',
      department: 'Information Technology',
      isActive: true,
      availability: 'unavailable',
      facultyProfile: {
        qualification: 'Ph.D.',
        specialization: 'Cybersecurity',
        expertise: ['Cybersecurity', 'Computer Networks', 'Cryptography'],
        subjects: ['Networks', 'Security'],
        researchAreas: ['Network Security'],
        maxProjects: 6,
      },
      assignedProjectCount: 0,
    },
  ];

  const results = getFacultyRecommendationsForProject(project, faculty);

  assert.ok(results.length >= 2);
  assert.equal(results[0]._id, 'f1');
  assert.ok(results[0].finalScore >= results[1].finalScore);
  assert.ok(results[0].explanation.includes('Machine Learning') || results[0].explanation.includes('NLP'));
  assert.ok(!results.some((item) => item._id === 'f3'));
  assert.ok(!results.some((item) => item._id === 'f4'));
});

const recommendationProject = {
  title: 'AI-Powered Student Academic Performance Prediction and Personalized Learning Recommendation System',
  domain: 'Machine Learning',
  abstract: 'Use machine learning and statistical models to predict student performance and personalize recommendations.',
  objectives: 'Apply machine learning to student performance prediction.',
  methodology: 'Train and evaluate supervised learning models.',
  technologies: 'Python, React, Node.js',
};

const facultyProfile = (name, expertise, extra = {}) => ({
  _id: name,
  name,
  role: 'faculty',
  department: 'Computer Science',
  isActive: true,
  availability: 'available',
  facultyProfile: {
    qualification: 'Ph.D.',
    expertise,
    maxProjects: 6,
    ...extra,
  },
});

test('Machine Learning expertise ranks ahead of secondary technology overlap', () => {
  const results = getFacultyRecommendationsForProject(recommendationProject, [
    facultyProfile('ML Faculty', ['ML', 'Statistics']),
    facultyProfile('Web Faculty', ['React', 'Node.js']),
  ]);

  assert.equal(results[0].name, 'ML Faculty');
  assert.deepEqual(results[0].matchedCoreExpertise, ['Machine Learning', 'Statistics']);
  assert.deepEqual(results[1].secondarySkills, ['React', 'Node.js']);
  assert.ok(results[0].suitabilityScore > results[1].suitabilityScore);
});

test('Cybersecurity and IoT profiles do not receive Machine Learning matches', () => {
  const results = getFacultyRecommendationsForProject(recommendationProject, [
    facultyProfile('Security Faculty', ['Cybersecurity', 'Computer Networks', 'Cryptography']),
    facultyProfile('IoT Faculty', ['IoT', 'Embedded Systems', 'Sensors']),
  ]);

  assert.equal(results.length, 2);
  assert.ok(results.every((item) => !item.matchedCoreExpertise.includes('Machine Learning')));
  assert.ok(results.every((item) => item.explanation.includes('No documented core expertise match')));
  assert.ok(results.every((item) => !item.explanation.includes('Strong expertise match')));
});

test('missing expertise is reported as unspecified and contributes no expertise match', () => {
  const [result] = getFacultyRecommendationsForProject(recommendationProject, [
    facultyProfile('Unspecified Faculty', []),
  ]);

  assert.deepEqual(result.expertise, []);
  assert.deepEqual(result.matchedCoreExpertise, []);
  assert.deepEqual(result.missingQualifications, []);
  assert.equal(result.evidence.qualification, 'Ph.D.');
  assert.match(result.explanation, /Profile expertise: Not specified/);
});

test('secondary skills contribute to suitability without being described as core expertise', () => {
  const [result] = getFacultyRecommendationsForProject(recommendationProject, [
    facultyProfile('Web Faculty', ['React', 'Node.js']),
  ]);

  assert.deepEqual(result.matchedCoreExpertise, []);
  assert.deepEqual(result.secondarySkills, ['React', 'Node.js']);
  assert.ok(result.expertiseSimilarity > 0);
  assert.ok(result.expertiseSimilarity <= 0.15);
  assert.match(result.explanation, /Relevant secondary skills: React, Node.js/);
});

test('extracted report subjects contribute to faculty expertise matches with report-specific evidence', () => {
  const project = {
    title: 'Student support portal',
    abstract: 'An education platform for course progress.',
    files: {
      reportText: 'The machine learning methodology compares supervised models and validates prediction accuracy for student performance.',
    },
  };
  const results = getFacultyRecommendationsForProject(project, [
    facultyProfile('ML Specialist', ['Machine Learning', 'Statistics']),
    facultyProfile('IoT Specialist', ['IoT', 'Embedded Systems']),
  ]);

  assert.equal(results[0].name, 'ML Specialist');
  assert.ok(results[0].reportMatchedCoreExpertise.includes('Machine Learning'));
  assert.match(results[0].explanation, /Extracted report text supports these subject matches: Machine Learning/);
});

test('generic database mentions count only as secondary technology overlap', () => {
  const project = {
    ...recommendationProject,
    description: 'Build a web portal with database integration for academic records.',
    technologies: 'MongoDB',
  };
  const [result] = getFacultyRecommendationsForProject(project, [
    facultyProfile('Database Faculty', ['Databases', 'SQL']),
  ]);

  assert.ok(!result.matchedCoreExpertise.includes('Database Systems'));
  assert.ok(result.secondarySkills.includes('Database Systems'));
});

test('recommendations preserve availability and workload eligibility limits', () => {
  const results = getFacultyRecommendationsForProject(recommendationProject, [
    facultyProfile('At Capacity', ['Machine Learning'], { maxProjects: 2 }),
    facultyProfile('Available ML Faculty', ['Machine Learning'], { maxProjects: 4 }),
    { ...facultyProfile('Unavailable Faculty', ['Machine Learning']), availability: 'unavailable' },
  ].map((faculty) => faculty.name === 'At Capacity'
    ? { ...faculty, assignedProjectCount: 2 }
    : faculty));

  assert.deepEqual(results.map((item) => item.name), ['Available ML Faculty']);
  assert.deepEqual(results[0].eligibility, {
    eligible: true,
    availability: 'available',
    currentProjects: 0,
    maxProjects: 4,
  });
});
