import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  GraduationCap,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  assignFacultyToProject,
  getFacultyRecommendations,
  getProjectById,
  getProjects,
} from '../../services/projectService';
import { formatDate, getStatusBadgeStyle } from '../../utils/formatters';
import { getSimilarityAlgorithmLabel, getSimilaritySemanticLabel, getSimilaritySectionScore } from '../../utils/similarityDisplay';
import { useAuth } from '../../context/AuthContext';

const AWAITING_STATUSES = new Set(['uniqueness_checked', 'submitted']);

const normalizeList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
};

const getProjectDepartment = (project) =>
  project?.department || project?.leader?.department || 'Not specified';

const getProjectSection = (project) =>
  project?.section || project?.leader?.section || 'Not specified';

const getUniqueness = (project) => {
  const check = project?.uniquenessCheck;
  if (!check) return { status: 'Not checked', score: null, result: null, algorithm: null };

  const result = check.status === 'completed'
    ? check.result || check.status
    : check.status || 'not_checked';
  const savedScore = check.overallScore ?? check.similarityScore;
  const score = check.status === 'completed'
    && savedScore !== null
    && savedScore !== undefined
    && Number.isFinite(Number(savedScore))
    ? Number(savedScore)
    : null;
  const displayResult = result
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return {
    status: displayResult || 'Not checked',
    score,
    result,
    algorithm: getSimilarityAlgorithmLabel(check),
  };
};

const formatScore = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Math.round(Number(value))}%`;
};

const getRecommendationScore = (recommendation) => {
  const score = Number(recommendation?.finalScore ?? recommendation?.recommendationScore ?? recommendation?.score);
  return Number.isFinite(score) ? Math.round(score) : null;
};

export default function FacultyAssignmentPage() {
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectDetails, setProjectDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState(null);
  const [recommendationProject, setRecommendationProject] = useState(null);
  const [assignmentProject, setAssignmentProject] = useState(null);
  const [assignmentFacultyId, setAssignmentFacultyId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getProjects();
      setProjects(data || []);
    } catch (err) {
      setError('Unable to load projects. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const awaitingProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const isAwaiting = AWAITING_STATUSES.has(project.status) && !project.assignedFaculty;
      if (!isAwaiting) return false;
      if (!query) return true;
      return [
        project.title,
        project.leader?.name,
        getProjectDepartment(project),
        getProjectSection(project),
        project.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [projects, search]);

  const refreshAfterAssignment = async () => {
    const refreshed = await getProjects();
    setProjects(refreshed || []);
  };

  const openProjectDetails = async (project) => {
    setSelectedProject(project);
    setProjectDetails(null);
    setDetailsError(null);
    setDetailsLoading(true);
    try {
      setProjectDetails(await getProjectById(project._id));
    } catch (err) {
      setDetailsError('Unable to load project details. Please try again.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedProject(null);
    setProjectDetails(null);
    setDetailsError(null);
  };

  const openRecommendations = async (project) => {
    setRecommendationProject(project);
    setRecommendations([]);
    setRecommendationsError(null);
    setRecommendationsLoading(true);
    try {
      const data = await getFacultyRecommendations(project._id);
      setRecommendations(Array.isArray(data) ? data : []);
    } catch (err) {
      setRecommendationsError('Unable to generate faculty recommendations.');
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const closeRecommendations = () => {
    setRecommendationProject(null);
    setRecommendations([]);
    setRecommendationsError(null);
  };

  const openAssignmentConfirmation = (project, recommendation) => {
    setAssignmentProject(project);
    setAssignmentFacultyId(recommendation._id);
    setAssignmentError(null);
  };

  const handleAssignFaculty = async () => {
    if (!assignmentProject || !assignmentFacultyId) return;
    setAssigning(true);
    setAssignmentError(null);
    try {
      const result = await assignFacultyToProject(assignmentProject._id, assignmentFacultyId);
      setSuccessMessage(`Faculty assigned successfully for “${result?.title || assignmentProject.title}”.`);
      setAssignmentProject(null);
      setAssignmentFacultyId('');
      await refreshAfterAssignment();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setAssignmentError(err.response?.data?.message || 'Unable to assign faculty. Please try again.');
    } finally {
      setAssigning(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="glass-panel p-8 rounded-2xl text-center">
        <ShieldCheck className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold">Admin access required</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Faculty assignment controls are available to administrators only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="glass-panel p-6 rounded-2xl bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border-blue-500/10">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-blue-400 mb-2">
              <GraduationCap className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-[0.16em]">Faculty Assignment</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Projects Awaiting Faculty Assignment</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Review project readiness, rank suitable faculty, and assign a guide through the existing backend workflow.
            </p>
          </div>
          <button
            onClick={fetchProjects}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/5 text-sm font-semibold flex items-center gap-2 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshIcon loading={loading} />
            Refresh
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="glass-panel p-4 rounded-xl border-emerald-500/25 bg-emerald-500/10 text-emerald-300 flex items-start gap-3" role="status">
          <Check className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="text-sm">{successMessage}</span>
        </div>
      )}

      <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search project, leader, department, or section..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950/30 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <FileSearch className="w-4 h-4" />
          {awaitingProjects.length} project{awaitingProjects.length === 1 ? '' : 's'} awaiting assignment
        </div>
      </div>

      {loading ? (
        <div className="glass-panel p-10 rounded-2xl text-center">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="font-medium">Loading projects...</p>
        </div>
      ) : error ? (
        <div className="glass-panel p-6 rounded-2xl border-red-500/25 bg-red-500/5 text-red-300 flex items-center gap-3" role="alert">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold">Unable to load projects. Please try again.</p>
            <button onClick={fetchProjects} className="mt-2 text-xs font-semibold underline">Retry</button>
          </div>
        </div>
      ) : awaitingProjects.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl text-center">
          <div className="mx-auto w-14 h-14 mb-4 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <Check className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold">No projects are currently awaiting faculty assignment.</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Projects will appear here after they are submitted and ready for faculty guidance.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {awaitingProjects.map((project) => {
            const uniqueness = getUniqueness(project);
            const teamMembers = Array.isArray(project.teamMembers) ? project.teamMembers : [];
            const assignedFaculty = project.assignedFaculty || null;
            const assignmentStatus = assignedFaculty ? 'Assigned' : 'Awaiting assignment';

            return (
              <article key={project._id} className="glass-panel rounded-2xl p-5 md:p-6 overflow-hidden transition hover:border-blue-500/20">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${getStatusBadgeStyle(project.status)}`}>
                        {String(project.status || 'unknown').replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300">
                        {assignmentStatus}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold leading-snug break-words">{project.title}</h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      Team Leader: <strong className="text-slate-200">{project.leader?.name || 'Unknown leader'}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full xl:w-auto xl:min-w-[420px]">
                    <Metric label="Department" value={getProjectDepartment(project)} />
                    <Metric label="Section" value={getProjectSection(project)} />
                    <Metric label="Team size" value={String(teamMembers.length)} />
                    <Metric label="Uniqueness" value={uniqueness.status} />
                    <Metric label="Similarity" value={uniqueness.score === null ? 'N/A' : `${uniqueness.score}%`} />
                    <Metric label="Assigned faculty" value={assignedFaculty?.name || 'None'} />
                  </div>
                </div>

                <div className="mt-5 grid gap-4 border-t border-slate-200 dark:border-slate-800 pt-5 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-slate-300">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Recommended Faculty
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Open recommendations to view ranked faculty from the backend.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => openProjectDetails(project)}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/5 text-xs font-semibold hover:bg-white/10 transition"
                    >
                      View Details
                    </button>
                    <button
                      type="button"
                      onClick={() => openRecommendations(project)}
                      className="px-4 py-2.5 rounded-xl border border-blue-500/25 bg-blue-500/10 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 transition"
                    >
                      View Recommendations
                    </button>
                    <button
                      type="button"
                      onClick={() => openRecommendations(project)}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      Assign Faculty
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedProject && (
        <ModalShell
          title="Project Details"
          onClose={closeDetails}
          loading={detailsLoading}
          error={detailsError}
        >
          {projectDetails && (
            <div className="space-y-6">
              <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Project</p>
                <h3 className="text-lg font-bold mt-1">{projectDetails.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">{projectDetails.description || 'No description provided.'}</p>
              </div>

              <SectionCard title="Project information" icon={<BookOpen className="w-4 h-4" />}>
                <DetailGrid items={[
                  ['Department', getProjectDepartment(projectDetails)],
                  ['Section', getProjectSection(projectDetails)],
                  ['Team leader', projectDetails.leader?.name || 'Not specified'],
                  ['Created date', formatDate(projectDetails.createdAt)],
                  ['Current status', formatStatus(projectDetails.status)],
                  ['Team members', String((projectDetails.teamMembers || []).length)],
                ]} />
              </SectionCard>

              <SectionCard title="Uniqueness information" icon={<ShieldCheck className="w-4 h-4" />}>
                <DetailGrid items={[
                  ['Check status', getUniqueness(projectDetails).status],
                  ['Similarity score', getUniqueness(projectDetails).score === null ? 'N/A' : `${getUniqueness(projectDetails).score}%`],
                  ['Result', getUniqueness(projectDetails).result?.replace(/_/g, ' ') || 'Not available'],
                  ['Algorithm', getUniqueness(projectDetails).algorithm || 'Not available'],
                ]} />
                <p className="mt-3 text-xs text-[var(--text-secondary)]">
                  Similarity measures overlap in these project records. It is not a probability of plagiarism or a plagiarism finding.
                </p>
                {projectDetails.uniquenessCheck?.scoreMethod && (
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    Score method: {projectDetails.uniquenessCheck.scoreMethod}
                  </p>
                )}
                {Array.isArray(projectDetails.uniquenessCheck?.matches) && projectDetails.uniquenessCheck.matches.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold mb-2">Similar projects</p>
                    <div className="space-y-2">
                      {projectDetails.uniquenessCheck.matches.slice(0, 5).map((match, matchIndex) => (
                        <div key={match.projectId || match.title || matchIndex} className="rounded-lg bg-slate-950/30 p-3 text-xs">
                          <div className="flex justify-between gap-3">
                            <span className="font-semibold truncate">{match.title || 'Historical project'}</span>
                            <span className="font-semibold text-amber-300">{match.similarityScore ?? 'N/A'}% overall</span>
                          </div>
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[var(--text-secondary)]">
                            <span>Text: {match.scoreBreakdown?.textSimilarity ?? match.textSimilarity ?? 'N/A'}% × {match.scoreBreakdown?.textWeight ?? 'N/A'}%</span>
                            <span>{getSimilaritySemanticLabel(match)}</span>
                            <span>Combined: {match.scoreBreakdown?.combinedSimilarity ?? match.similarityScore ?? 'N/A'}%</span>
                          </div>
                          <p className="mt-2 text-[var(--text-secondary)]">{match.explanation || match.evidence || 'No comparison explanation was recorded.'}</p>
                          {Array.isArray(match.sectionComparisons) && match.sectionComparisons.length > 0 ? (
                            <div className="mt-3 space-y-2 border-t border-slate-800 pt-2">
                              {match.sectionComparisons.map((section) => (
                                <div key={section.field} className="grid grid-cols-[minmax(7rem,0.7fr)_auto_1.5fr] gap-2 items-start">
                                  <span className="font-medium">{section.label || section.field}</span>
                                  <span>{getSimilaritySectionScore(section)}</span>
                                  <span>{section.matchingTerms?.length ? `Shared terms: ${section.matchingTerms.join(', ')}. ` : ''}{section.explanation || 'No section evidence recorded.'}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 border-t border-slate-800 pt-2 text-[var(--text-secondary)]">Section evidence was not recorded for this legacy result.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Faculty information" icon={<UserCheck className="w-4 h-4" />}>
                <DetailGrid items={[
                  ['Assigned faculty', projectDetails.assignedFaculty?.name || 'None'],
                  ['Assignment status', projectDetails.assignedFaculty ? 'Assigned' : 'Awaiting assignment'],
                  ['Assigned at', formatDate(projectDetails.facultyAssignedAt)],
                ]} />
              </SectionCard>
            </div>
          )}
        </ModalShell>
      )}

      {recommendationProject && (
        <ModalShell
          title={`${recommendationProject.title} · AI Faculty Recommendations`}
          onClose={closeRecommendations}
          loading={recommendationsLoading}
          error={recommendationsError}
        >
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
            <strong className="block mb-1">AI recommendation is advisory. Final assignment is controlled by Admin.</strong>
            Faculty suitability is based on the existing backend recommendation service.
          </div>
          {recommendations.length === 0 && !recommendationsLoading && !recommendationsError && (
            <div className="p-6 text-center text-sm text-[var(--text-secondary)]">No suitable faculty recommendations are available.</div>
          )}
          <div className="space-y-3">
            {recommendations.map((recommendation, index) => (
              <div key={recommendation._id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-7 h-7 rounded-full bg-blue-500/10 text-blue-300 text-xs font-bold flex items-center justify-center">{index + 1}</span>
                      <h3 className="font-bold">{recommendation.name}</h3>
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                        {formatScore(getRecommendationScore(recommendation))}% match
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">{recommendation.department || 'Department not specified'} · {recommendation.facultyId || 'Faculty ID unavailable'}</p>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <InfoRow label="Expertise" value={normalizeList(recommendation.expertise).join(', ') || 'Not specified'} />
                      <InfoRow label="Availability" value={recommendation.availability || 'available'} />
                      <InfoRow label="Current workload" value={`${recommendation.currentProjects ?? 0} / ${recommendation.maxProjects ?? 6}`} />
                      <InfoRow label="Recommendation" value={recommendation.explanation || 'Backend recommendation details unavailable'} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAssignmentConfirmation(recommendationProject, recommendation)}
                    className="px-4 py-2.5 self-start rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 transition"
                  >
                    Assign
                  </button>
                </div>
              </div>
            ))}
          </div>
        </ModalShell>
      )}

      {assignmentProject && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="assignment-dialog-title">
          <div className="glass-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Confirm assignment</p>
                <h2 id="assignment-dialog-title" className="text-lg font-bold mt-1">Assign faculty guide</h2>
              </div>
              <button type="button" onClick={() => setAssignmentProject(null)} className="p-2 rounded-lg hover:bg-white/10" aria-label="Close assignment confirmation">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950/30 p-4">
              <p className="text-sm font-semibold">{assignmentProject.title}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">Assigning faculty will update project status and notify the selected faculty member.</p>
            </div>
            <div className="mt-4">
              <label htmlFor="assignment-faculty" className="text-xs font-semibold mb-2 block">Faculty member</label>
              <select
                id="assignment-faculty"
                value={assignmentFacultyId}
                onChange={(event) => setAssignmentFacultyId(event.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-950/30 text-sm"
              >
                <option value="">Select faculty</option>
                {recommendations.map((recommendation) => (
                  <option key={recommendation._id} value={recommendation._id}>
                    {recommendation.name} · {recommendation.department}
                  </option>
                ))}
              </select>
            </div>
            {assignmentError && <p className="text-xs text-red-300 mt-3" role="alert">{assignmentError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAssignmentProject(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-white/5">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignFaculty}
                disabled={assigning || !assignmentFacultyId}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {assigning ? 'Assigning faculty...' : 'Confirm assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RefreshIcon({ loading }) {
  return loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />;
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950/20 p-3">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-slate-200">{value || 'N/A'}</p>
    </div>
  );
}

function SectionCard({ title, icon, children }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold mb-4">
        <span className="text-blue-400">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function DetailGrid({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-950/25 p-3">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
          <dd className="mt-1 text-xs font-medium break-words text-slate-200">{value || 'Not available'}</dd>
        </div>
      ))}
    </dl>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xs break-words text-slate-300">{value || 'Not available'}</p>
    </div>
  );
}

function ModalShell({ title, onClose, loading, error, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="glass-panel w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-[var(--bg-card)] px-5 py-4 backdrop-blur-xl">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Admin workflow</p>
            <h2 id="modal-title" className="truncate text-lg font-bold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Close dialog">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-3" />
              <p className="font-medium">Loading details...</p>
            </div>
          ) : error ? (
            <div className="p-5 text-sm text-red-300" role="alert">{error}</div>
          ) : children}
        </div>
      </div>
    </div>
  );
}

function formatStatus(status) {
  return String(status || 'unknown').replace(/_/g, ' ').toUpperCase();
}
