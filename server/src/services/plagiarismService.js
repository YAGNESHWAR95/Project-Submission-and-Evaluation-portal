const PlagiarismResult = require('../models/PlagiarismResult');
const Project = require('../models/Project');
const logger = require('../utils/logger');

/**
 * SHA-256 hash-based plagiarism checking.
 * Compares the file hashes of the submitting project against all other submitted projects.
 * Exact hash matches indicate identical files (100% similarity for that file type).
 * Returns a weighted similarity score and detailed matching sections.
 */
const runPlagiarismCheck = async (projectId) => {
  try {
    const project = await Project.findById(projectId);
    if (!project) {
      logger.error(`[PLAGIARISM] Project ${projectId} not found`);
      return null;
    }

    // Find all other submitted/evaluated projects to compare against
    const otherProjects = await Project.find({
      _id: { $ne: projectId },
      status: { $in: ['submitted', 'under_review', 'evaluated'] },
    });

    let highestScore = 0;
    let highestMatchProject = null;
    const matchingSections = [];

    for (const otherProject of otherProjects) {
      let matchCount = 0;
      let totalChecked = 0;

      // Compare report hash
      if (project.files.reportHash && otherProject.files.reportHash) {
        totalChecked++;
        if (project.files.reportHash === otherProject.files.reportHash) {
          matchCount++;
          matchingSections.push({
            fileType: 'report',
            detail: `Exact report match with project "${otherProject.title}"`,
          });
        }
      }

      // Compare PPT hash
      if (project.files.pptHash && otherProject.files.pptHash) {
        totalChecked++;
        if (project.files.pptHash === otherProject.files.pptHash) {
          matchCount++;
          matchingSections.push({
            fileType: 'presentation',
            detail: `Exact presentation match with project "${otherProject.title}"`,
          });
        }
      }

      // Compare source code ZIP hash
      if (project.files.codeZipHash && otherProject.files.codeZipHash) {
        totalChecked++;
        if (project.files.codeZipHash === otherProject.files.codeZipHash) {
          matchCount++;
          matchingSections.push({
            fileType: 'source',
            detail: `Exact source code match with project "${otherProject.title}"`,
          });
        }
      }

      if (totalChecked > 0) {
        const score = Math.round((matchCount / totalChecked) * 100);
        if (score > highestScore) {
          highestScore = score;
          highestMatchProject = otherProject._id;
        }
      }
    }

    // Determine similarity level
    let similarityLevel = 'low';
    if (highestScore >= 80) similarityLevel = 'critical';
    else if (highestScore >= 50) similarityLevel = 'high';
    else if (highestScore >= 20) similarityLevel = 'moderate';

    // If no other projects exist, score stays 0 (no matches possible)
    const result = await PlagiarismResult.create({
      project: projectId,
      comparedProject: highestMatchProject,
      similarityScore: highestScore,
      similarityLevel,
      matchingSections,
      checkedAt: new Date(),
      status: 'completed',
    });

    logger.info(`[PLAGIARISM] Check completed for project ${projectId}: score=${highestScore}%, level=${similarityLevel}`);
    return result;
  } catch (error) {
    logger.error(`[PLAGIARISM] Check failed for project ${projectId}: ${error.message}`);

    // Create a failed result record
    const failedResult = await PlagiarismResult.create({
      project: projectId,
      similarityScore: 0,
      similarityLevel: 'low',
      matchingSections: [],
      checkedAt: new Date(),
      status: 'failed',
    });

    return failedResult;
  }
};

module.exports = {
  runPlagiarismCheck,
};
