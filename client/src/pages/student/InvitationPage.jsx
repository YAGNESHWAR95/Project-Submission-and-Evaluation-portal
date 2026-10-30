import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { acceptInvitation, rejectInvitation } from '../../services/invitationService';

export default function InvitationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [respondingStatus, setRespondingStatus] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleResponse = async (decision) => {
    if (!token) {
      setError('Invitation token is missing.');
      return;
    }

    setRespondingStatus(decision);
    setError('');
    setSuccess('');

    try {
      if (decision === 'accepted') await acceptInvitation(token);
      else await rejectInvitation(token);
      setSuccess(decision === 'accepted'
        ? 'Invitation accepted successfully. You are now part of the project team.'
        : 'Invitation declined successfully.');
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || `Unable to ${decision === 'accepted' ? 'accept' : 'decline'} this invitation.`);
    } finally {
      setRespondingStatus(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-sm text-slate-300">
          Loading your session...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Project Invitation</p>
          <h1 className="mt-4 text-2xl font-bold text-white">Please log in to continue</h1>
          <p className="mt-2 text-sm text-slate-400">
            You need to sign in before accepting this invitation.
          </p>
          <Link
            to={`/login?redirect=${encodeURIComponent(`/team-invitations/${token}`)}`}
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Project Invitation</p>
        <h1 className="mt-4 text-2xl font-bold text-white">Accept team invitation</h1>
        <p className="mt-3 text-sm text-slate-400">
          You are signed in as <span className="font-semibold text-white">{user.name}</span>. Accept or decline this team invitation.
        </p>
        {user.role !== 'student' && (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300" role="alert">
            Sign in with the invited student account to respond to this invitation.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {success}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => handleResponse('accepted')}
            disabled={respondingStatus !== null || user.role !== 'student'}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {respondingStatus === 'accepted' ? 'Accepting...' : 'Accept Invitation'}
          </button>
          <button
            type="button"
            onClick={() => handleResponse('rejected')}
            disabled={respondingStatus !== null || user.role !== 'student'}
            className="flex-1 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {respondingStatus === 'rejected' ? 'Declining...' : 'Decline Invitation'}
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
