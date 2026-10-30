import React, { useEffect, useState } from 'react';
import { getUsers, createUser, updateStudentDetails, updateFacultyProfile } from '../../services/adminService';
import { getPasswordError } from '../../utils/validators';
import { Plus, Loader2, AlertCircle, Pencil } from 'lucide-react';

export default function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form states
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('faculty');
  const [department, setDepartment] = useState('Computer Science');
  const [rollNumber, setRollNumber] = useState('');
  const [section, setSection] = useState('');
  const [batch, setBatch] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [editingStudent, setEditingStudent] = useState(null);
  const [cohortDepartment, setCohortDepartment] = useState('Computer Science');
  const [cohortSection, setCohortSection] = useState('');
  const [cohortBatch, setCohortBatch] = useState('');
  const [cohortAcademicYear, setCohortAcademicYear] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [studentRollNumber, setStudentRollNumber] = useState('');
  const [savingCohort, setSavingCohort] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [facultyName, setFacultyName] = useState('');
  const [facultyDepartment, setFacultyDepartment] = useState('Computer Science');
  const [facultyIdValue, setFacultyIdValue] = useState('');
  const [facultyAvailability, setFacultyAvailability] = useState('available');
  const [savingFaculty, setSavingFaculty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Filter
  const [roleFilter, setRoleFilter] = useState('');

  const fetchUsersList = async () => {
    try {
      setLoading(true);
      const data = await getUsers();
      setUsers(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch user directory:', err);
      setError('Unable to load users registry list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersList();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFormError(null);

    const passwordError = getPasswordError(password);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }

    setSubmitting(true);

    try {
      const payload = { name, email, password, role, department };
      if (role === 'student') Object.assign(payload, { rollNumber, section, batch, academicYear });
      if (role === 'faculty') payload.facultyId = facultyId;

      await createUser(payload);
      
      // Reset form
      setName('');
      setEmail('');
      setPassword('');
      setRollNumber('');
      setSection('');
      setBatch('');
      setAcademicYear('');
      setFacultyId('');
      setFormOpen(false);
      
      // Refresh list
      fetchUsersList();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create user account.');
    } finally {
      setSubmitting(false);
    }
  };

  const openCohortEditor = (student) => {
    setEditingStudent(student);
    setStudentName(student.name || '');
    setStudentEmail(student.email || '');
    setStudentRollNumber(student.rollNumber || '');
    setCohortDepartment(student.department || 'Computer Science');
    setCohortSection(student.section || '');
    setCohortBatch(student.batch || '');
    setCohortAcademicYear(student.academicYear || '');
    setFormError(null);
  };

  const handleUpdateCohort = async (event) => {
    event.preventDefault();
    setSavingCohort(true);
    setFormError(null);
    try {
      await updateStudentDetails(editingStudent._id, {
        name: studentName,
        email: studentEmail,
        rollNumber: studentRollNumber,
        department: cohortDepartment,
        section: cohortSection,
        batch: cohortBatch,
        academicYear: cohortAcademicYear,
      });
      setEditingStudent(null);
      await fetchUsersList();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to update student cohort.');
    } finally {
      setSavingCohort(false);
    }
  };

  const openFacultyEditor = (faculty) => {
    setEditingFaculty(faculty);
    setFacultyName(faculty.name || '');
    setFacultyDepartment(faculty.department || 'Computer Science');
    setFacultyIdValue(faculty.facultyId || faculty.facultyProfile?.facultyId || '');
    setFacultyAvailability(faculty.availability || faculty.facultyProfile?.availability || 'available');
    setFormError(null);
  };

  const handleUpdateFaculty = async (event) => {
    event.preventDefault();
    setSavingFaculty(true);
    setFormError(null);
    try {
      await updateFacultyProfile(editingFaculty._id, {
        name: facultyName,
        department: facultyDepartment,
        facultyId: facultyIdValue,
        availability: facultyAvailability,
      });
      setEditingFaculty(null);
      await fetchUsersList();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to update faculty profile.');
    } finally {
      setSavingFaculty(false);
    }
  };

  const filteredUsers = roleFilter
    ? users.filter(u => u.role === roleFilter)
    : users;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage System Accounts</h1>
          <p className="text-[var(--text-secondary)] text-sm">Add university evaluators or student batches manually.</p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-blue-500/10"
        >
          <Plus className="w-4 h-4" />
          Create Account
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex gap-3 items-center">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* User creation form modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateUser} className="w-full max-w-md glass-panel-glow p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 animate-in fade-in zoom-in-95 duration-200 space-y-4">
            <h3 className="text-base font-bold">Register New Account</h3>

            {formError && (
              <div className="p-3 text-xs rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex gap-2 items-center">
                <AlertCircle className="w-4 h-4" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none"
                placeholder="Full Name"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none"
                placeholder="university@email.edu"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Role Type</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                >
                  <option value="student">Student</option>
                  <option value="faculty">Faculty</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-white focus:outline-none"
                >
                  <option value="Computer Science">Computer Science</option>
                  <option value="Information Technology">Information Technology</option>
                </select>
              </div>
            </div>

            {role === 'student' && (
              <div className="space-y-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Roll Number
                  <input type="text" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} className="mt-1 w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none" placeholder="23EG112E09" required />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Section
                    <input type="text" value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} className="mt-1 w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none" required />
                  </label>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Batch
                    <input type="text" value={batch} onChange={(e) => setBatch(e.target.value)} pattern="[0-9]{4}-[0-9]{4}" placeholder="2023-2027" className="mt-1 w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none" required />
                  </label>
                </div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Academic Year
                  <input type="text" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026-27" className="mt-1 w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none" required />
                </label>
              </div>
            )}

            {role === 'faculty' && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Faculty ID</label>
                <input
                  type="text"
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none"
                  placeholder="FAC-501"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Login Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-white focus:outline-none"
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                required
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold cursor-pointer text-slate-400 hover:bg-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
          <form onSubmit={handleUpdateCohort} role="dialog" aria-modal="true" aria-labelledby="student-edit-title" className="glass-panel-glow max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6">
            <h2 id="student-edit-title" className="text-base font-bold">Edit Student Details and Cohort</h2>
            <p className="text-xs text-slate-400">{editingStudent.name} - {editingStudent.rollNumber}</p>
            {formError && <p className="text-xs text-red-400" role="alert">{formError}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-400">Full Name
                <input value={studentName} onChange={(event) => setStudentName(event.target.value)} required maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
              <label className="block text-xs font-semibold text-slate-400">Email
                <input type="email" value={studentEmail} onChange={(event) => setStudentEmail(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
              <label className="block text-xs font-semibold text-slate-400">Roll Number
                <input value={studentRollNumber} onChange={(event) => setStudentRollNumber(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-400">Department
              <select value={cohortDepartment} onChange={(event) => setCohortDepartment(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                <option value="Information Technology">Information Technology</option>
                <option value="Computer Science">Computer Science</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-400">Section
                <input value={cohortSection} onChange={(event) => setCohortSection(event.target.value.toUpperCase())} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
              <label className="block text-xs font-semibold text-slate-400">Batch
                <input value={cohortBatch} onChange={(event) => setCohortBatch(event.target.value)} pattern="[0-9]{4}-[0-9]{4}" placeholder="2023-2027" required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-400">Academic Year
              <input value={cohortAcademicYear} onChange={(event) => setCohortAcademicYear(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditingStudent(null); setFormError(null); }} disabled={savingCohort} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Cancel</button>
              <button type="submit" disabled={savingCohort} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">{savingCohort ? <><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Saving...</> : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleUpdateFaculty} role="dialog" aria-modal="true" aria-labelledby="faculty-edit-title" className="glass-panel-glow w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6">
            <h2 id="faculty-edit-title" className="text-base font-bold">Edit Faculty Profile</h2>
            {formError && <p className="text-xs text-red-400" role="alert">{formError}</p>}
            <label className="block text-xs font-semibold text-slate-400">Full Name
              <input value={facultyName} onChange={(event) => setFacultyName(event.target.value)} required maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
            </label>
            <label className="block text-xs font-semibold text-slate-400">Department
              <select value={facultyDepartment} onChange={(event) => setFacultyDepartment(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                <option value="Information Technology">Information Technology</option>
                <option value="Computer Science">Computer Science</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-400">Faculty ID
              <input value={facultyIdValue} onChange={(event) => setFacultyIdValue(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
            </label>
            <label className="block text-xs font-semibold text-slate-400">Availability
              <select value={facultyAvailability} onChange={(event) => setFacultyAvailability(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                <option value="available">Available</option>
                <option value="limited">Limited</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditingFaculty(null); setFormError(null); }} disabled={savingFaculty} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Cancel</button>
              <button type="submit" disabled={savingFaculty} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">{savingFaculty ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Role filter bar */}
      <div className="glass-panel p-4 rounded-2xl flex gap-2">
        {['', 'student', 'faculty', 'admin'].map(r => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              roleFilter === r
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/10'
                : 'bg-slate-900/40 border border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {r === '' ? 'ALL ACCOUNTS' : r.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Directory Table */}
      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-12 bg-slate-800/40 rounded-xl"></div>
          <div className="h-12 bg-slate-800/40 rounded-xl"></div>
        </div>
      ) : filteredUsers.length > 0 ? (
        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-900">
                <tr>
                  <th className="px-6 py-4">Account Holder</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Identifier ID</th>
                  <th className="px-6 py-4">Department</th>
                  <th className="px-6 py-4">Cohort</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-900">
                {filteredUsers.map(u => (
                  <tr key={u._id} className="hover:bg-slate-500/5 transition-colors">
                    <td className="px-6 py-4 font-semibold text-white">
                      <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center font-bold text-xs text-blue-500">
                        {(u.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <span>{u.name || 'Name not set'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{u.email}</td>
                    <td className="px-6 py-4 text-xs">
                      <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                        u.role === 'admin'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : u.role === 'faculty'
                          ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-400">
                      {u.role === 'student' ? u.rollNumber : u.role === 'faculty' ? u.facultyId : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{u.department || 'Not specified'}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">
                      {u.role === 'student'
                        ? [u.cohortId, u.section && `Section ${u.section}`, u.batch && `Batch ${u.batch}`, u.academicYear && `Year ${u.academicYear}`].filter(Boolean).join(' · ') || 'Not configured'
                        : 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      {u.role === 'student' ? (
                        <button type="button" title="Edit student details and cohort" aria-label={`Edit ${u.name}`} onClick={() => openCohortEditor(u)} className="rounded-md border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : u.role === 'faculty' ? (
                        <button type="button" title="Edit faculty profile" aria-label={`Edit ${u.name}`} onClick={() => openFacultyEditor(u)} className="rounded-md border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : <span className="text-xs text-slate-500">Role protected</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-8 text-center text-slate-400">No matching user accounts discovered.</div>
      )}
    </div>
  );
}
