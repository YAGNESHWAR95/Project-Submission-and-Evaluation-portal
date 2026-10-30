import React, { useEffect, useRef, useState } from 'react';
import useAuth from '../hooks/useAuth';
import {
  getProjectMessages,
  sendProjectMessage,
  updateProject,
  resubmitProjectRevision,
  uploadProjectFile,
  requestProjectRevisionAccess,
} from '../services/projectService';
import { getRevisionPermissions, hasActiveRevisionAccess, hasRevisionPermissionItems } from '../utils/revisionAccess';
import AuthenticatedFileDownload from './AuthenticatedFileDownload';
import ReportOriginalityPanel from './ReportOriginalityPanel';
import { AlertCircle, Loader2, MessageSquare, Send } from 'lucide-react';

const revisionFieldLabels = {
  title: 'Project title',
  abstract: 'Abstract',
  problemStatement: 'Problem statement',
  objectives: 'Objectives',
  methodology: 'Methodology',
  technologies: 'Technologies',
  expectedOutcome: 'Expected outcome',
  description: 'Description',
  keywords: 'Keywords',
  domain: 'Domain',
  proposedSolution: 'Proposed solution',
};

export default function ProjectWorkspace({ project, allowRevisionEditing = false, onChanged, autoEditRevision = false }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [revisionValues, setRevisionValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingRevision, setEditingRevision] = useState(false);
  const [accessRequestReason, setAccessRequestReason] = useState('');
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [accessRequestStatus, setAccessRequestStatus] = useState(project?.revisionAccessRequest?.status || 'none');
  const revisionFormRef = useRef(null);

  const revision = project?.revisionRequest;
  const revisionAccessOpen = hasActiveRevisionAccess(revision);
  const revisionPermissions = getRevisionPermissions(revisionAccessOpen ? revision : null);
  const allowedFields = revisionPermissions.fields.filter((field) => revisionFieldLabels[field]);
  const allowedFileTypes = revisionPermissions.fileTypes;
  const hasAuthorizedItems = hasRevisionPermissionItems(revisionAccessOpen ? revision : null);
  const isLeader = String(project?.leader?._id || project?.leader) === String(user?._id || user?.id);
  const revisionFieldsLabel = allowedFields.map((field) => revisionFieldLabels[field]);
  const revisionFilesLabel = allowedFileTypes.map((type) => (type === 'source' ? 'Source ZIP' : type));

  useEffect(() => {
    if (autoEditRevision && isLeader && allowedFields.length + allowedFileTypes.length > 0) {
      setEditingRevision(true);
      requestAnimationFrame(() => revisionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [autoEditRevision, isLeader, allowedFields.length, allowedFileTypes.length]);

  useEffect(() => {
    let active = true;
    const loadMessages = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await getProjectMessages(project._id);
        if (active) setMessages(result || []);
      } catch (err) {
        if (active) setError(err.response?.data?.message || 'Unable to load project discussion.');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadMessages();
    return () => { active = false; };
  }, [project._id]);

  useEffect(() => {
    const initialValues = {};
    allowedFields.forEach((field) => { initialValues[field] = project[field] || ''; });
    setRevisionValues(initialValues);
  }, [project, allowedFields.join('|')]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setError('');
    try {
      const message = await sendProjectMessage(project._id, content.trim());
      setMessages((current) => [...current, message]);
      setContent('');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleRequestRevisionAccess = async (event) => {
    event.preventDefault();
    if (!accessRequestReason.trim()) return;
    setAccessRequestBusy(true);
    setError('');
    try {
      const request = await requestProjectRevisionAccess(project._id, accessRequestReason.trim());
      setAccessRequestStatus(request.status);
      setAccessRequestReason('');
      setSuccess('Revision permission request sent to your assigned faculty guide.');
      await onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to request revision permission.');
    } finally {
      setAccessRequestBusy(false);
    }
  };

  const handleSaveRevision = async (event) => {
    event.preventDefault();
    setSavingRevision(true);
    setError('');
    setSuccess('');
    try {
      const updated = await updateProject(project._id, revisionValues);
      setSuccess('Approved project sections saved.');
      if (onChanged) await onChanged(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save revision changes.');
    } finally {
      setSavingRevision(false);
    }
  };

  const handleResubmit = async () => {
    setSavingRevision(true);
    setError('');
    setSuccess('');
    try {
      if (allowedFields.length > 0) {
        await updateProject(project._id, revisionValues);
      }
      const updated = await resubmitProjectRevision(project._id);
      setSuccess('Project resubmitted. Revision access is now closed.');
      if (onChanged) await onChanged(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to resubmit this project.');
    } finally {
      setSavingRevision(false);
    }
  };

  const handleRevisionFile = async (event, purpose) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSavingRevision(true);
    setError('');
    setSuccess('');
    try {
      await uploadProjectFile(project._id, file, purpose);
      setSuccess(`${purpose} file uploaded.`);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to upload the approved revision file.');
    } finally {
      setSavingRevision(false);
      event.target.value = '';
    }
  };

  return (
    <section className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      {allowRevisionEditing && user?.role === 'student' && !revisionAccessOpen && (
        <section className="rounded-lg border border-slate-700 p-4">
          <h3 className="font-semibold">Request revision permission</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Describe the correction needed. Faculty must select the fields or files you may edit; no access is granted by this request alone.</p>
          {accessRequestStatus === 'pending' && <p className="mt-2 text-sm text-amber-300">Your request is awaiting faculty review.</p>}
          {accessRequestStatus === 'denied' && <p className="mt-2 text-sm text-red-300">Your previous request was denied. You may submit a new request with more detail.</p>}
          {accessRequestStatus !== 'pending' && (
            <form onSubmit={handleRequestRevisionAccess} className="mt-3 space-y-2">
              <textarea
                value={accessRequestReason}
                onChange={(event) => setAccessRequestReason(event.target.value)}
                maxLength={2000}
                rows={3}
                required
                aria-label="Reason for revision permission request"
                placeholder="Explain which correction you need to make and why."
                className="w-full rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm"
              />
              <button type="submit" disabled={accessRequestBusy || !accessRequestReason.trim()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {accessRequestBusy ? 'Sending request...' : 'Request faculty permission'}
              </button>
            </form>
          )}
        </section>
      )}

      {allowRevisionEditing && revision?.status === 'pending' && (revision.requestedAt || revision.requestedBy) && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
          <h3 className="font-semibold text-amber-300">Revision Required</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{revision.reason || revision.feedback}</p>
          {revision.dueDate && <p className="mt-2 text-xs text-[var(--text-secondary)]">Due {new Date(revision.dueDate).toLocaleDateString()}</p>}
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Editing will be available after your faculty guide grants access.</p>
        </div>
      )}

      {allowRevisionEditing && revisionAccessOpen && (
        <section className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-emerald-300">Revision Access Open</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{revision.reason || revision.feedback}</p>
              </div>
              {revision.dueDate && <time className="text-xs text-[var(--text-secondary)]">Due {new Date(revision.dueDate).toLocaleDateString()}</time>}
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="font-semibold text-slate-400">Permitted fields</dt><dd className="mt-1">{revisionFieldsLabel.length ? revisionFieldsLabel.join(', ') : 'None'}</dd></div>
              <div><dt className="font-semibold text-slate-400">Permitted files</dt><dd className="mt-1">{revisionFilesLabel.length ? revisionFilesLabel.join(', ') : 'None'}</dd></div>
              <div><dt className="font-semibold text-slate-400">Revision status</dt><dd className="mt-1">{revision.status}</dd></div>
            </dl>
          </div>
          {!hasAuthorizedItems && (
            <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Revision access is open, but no editable items are authorized. Contact your faculty guide.
            </p>
          )}
          {!editingRevision && (
            <button
              type="button"
              onClick={() => {
                setEditingRevision(true);
                requestAnimationFrame(() => revisionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
              }}
              disabled={!isLeader || !hasAuthorizedItems}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {hasAuthorizedItems ? 'Edit Revision' : 'Edit Revision unavailable'}
            </button>
          )}
          {!isLeader && <p className="text-xs text-[var(--text-secondary)]">Only the project leader can edit and resubmit revisions. Team members may still participate in discussion.</p>}
        </section>
      )}

      {allowRevisionEditing && editingRevision && (allowedFields.length > 0 || allowedFileTypes.length > 0) && isLeader && (
        <form ref={revisionFormRef} onSubmit={handleSaveRevision} className="space-y-4 rounded-lg border border-slate-700 p-4">
          <div>
            <h3 className="font-semibold">Edit approved project content</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Only the sections approved by your faculty guide are editable.</p>
          </div>
          {allowedFields.map((field) => (
            <label key={field} className="block text-sm font-medium">
              {revisionFieldLabels[field]}
              <textarea
                value={revisionValues[field] ?? ''}
                onChange={(event) => setRevisionValues((current) => ({ ...current, [field]: event.target.value }))}
                rows={field === 'title' ? 2 : 4}
                maxLength={field === 'title' ? 200 : 5000}
                className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm"
              />
            </label>
          ))}
          {allowedFileTypes.length > 0 && (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <h4 className="text-sm font-semibold">Approved file replacements</h4>
              {allowedFileTypes.map((purpose) => (
                <label key={purpose} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-28 capitalize">{purpose === 'source' ? 'Source ZIP' : purpose}</span>
                  <input
                    type="file"
                    accept={purpose === 'report' ? '.pdf' : purpose === 'presentation' ? '.ppt,.pptx' : '.zip'}
                    disabled={savingRevision}
                    onChange={(event) => handleRevisionFile(event, purpose)}
                    className="min-w-0 flex-1 text-xs"
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {allowedFields.length > 0 && (
              <button disabled={savingRevision} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {savingRevision ? 'Saving...' : 'Save approved changes'}
              </button>
            )}
            <button type="button" onClick={handleResubmit} disabled={savingRevision} className="rounded-md border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50">
              Resubmit for Faculty Review
            </button>
          </div>
        </form>
      )}

      {(project.revisionHistory || []).length > 0 && (
        <details className="rounded-lg border border-slate-700 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Version history ({project.revisionHistory.length})</summary>
          <ol className="mt-3 space-y-2 text-sm">
            {project.revisionHistory.map((version) => (
              <li key={`${version.versionNumber}-${version.submittedAt}`} className="border-t border-slate-800 pt-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>Version {version.versionNumber}: {version.summary}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{version.submittedAt ? new Date(version.submittedAt).toLocaleString() : ''}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {[
                    ['report', 'reportUrl', 'reportName', 'Report'],
                    ['presentation', 'pptUrl', 'pptName', 'Slides'],
                    ['source', 'codeZipUrl', 'codeZipName', 'Source ZIP'],
                  ].filter(([, urlField]) => version.snapshot?.files?.[urlField]).map(([purpose, , nameField, label]) => (
                    <AuthenticatedFileDownload
                      key={`${version.versionNumber}-${purpose}`}
                      projectId={project._id}
                      purpose={purpose}
                      filename={version.snapshot.files[nameField] || label}
                      versionNumber={version.versionNumber}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300"
                    >
                      Download {label}
                    </AuthenticatedFileDownload>
                  ))}
                </div>
                <ReportOriginalityPanel analysis={version.snapshot?.reportOriginality} />
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="rounded-lg border border-slate-700">
        <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3">
          <MessageSquare className="h-4 w-4 text-blue-400" />
          <h3 className="font-semibold">Project discussion</h3>
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-blue-400" /> : messages.length ? messages.map((message) => (
            <article key={message._id} className="border-b border-slate-800 pb-3 last:border-0">
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="font-semibold">{message.sender?.name || 'Project participant'} <span className="font-normal text-[var(--text-secondary)]">{message.senderRole}</span></span>
                <time className="text-[var(--text-secondary)]">{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{message.content}</p>
            </article>
          )) : <p className="text-sm text-[var(--text-secondary)]">No messages yet.</p>}
        </div>
        <form onSubmit={handleSendMessage} className="flex gap-2 border-t border-slate-700 p-3">
          <input
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={4000}
            aria-label="Project message"
            placeholder="Write to your project team and faculty guide"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={sending || !content.trim()} title="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-blue-600 text-white disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </section>
  );
}