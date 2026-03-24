import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';

// ─── Types ──────────────────────────────────────────────

interface CourseProgress {
  courseId: string;
  courseName: string;
  enrolledAt: string;
  progress: {
    lessonsCompleted: number;
    totalLessons: number;
    percentage: number;
    quizzesCompleted: number;
    averageQuizScore: number;
    lastActiveAt: string | null;
  };
}

interface TokenUsage {
  totalTokens: number;
  totalCost: number;
  byProvider: Record<
    string,
    {
      totalTokens: number;
      totalCost: number;
      byModel: Record<string, { inputTokens: number; outputTokens: number; totalCost: number }>;
    }
  >;
  byFeature: Record<string, { totalTokens: number; totalCost: number }>;
}

interface Student {
  id: string;
  name: string;
  email: string;
  enrolledCourses: CourseProgress[];
  tokenUsage: TokenUsage;
  joinedAt: string;
  lastActiveAt: string;
  isTemporaryPassword: boolean;
}

interface StudentsResponse {
  students: Student[];
  total: number;
  page: number;
  limit: number;
}

interface CourseOverview {
  courseId: string;
  courseName: string;
  totalStudents: number;
  averageProgress: number;
  totalAiCost: number;
  byProvider: Record<string, number>;
}

interface TeacherCourse {
  id: string;
  title: string;
}

// ─── Helper Components ──────────────────────────────────

function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-600">{percentage}%</span>
    </div>
  );
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatFeatureName(feature: string): string {
  return feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Add Student Modal ──────────────────────────────────

function AddStudentModal({
  courses,
  onClose,
  onAdded,
}: {
  courses: TeacherCourse[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    studentId: string;
    email: string;
    name: string;
    temporaryPassword: string | null;
    enrolledCourses: string[];
    message: string;
  } | null>(null);

  // Bulk state
  const [csvText, setCsvText] = useState('');
  const [bulkResult, setBulkResult] = useState<{
    created: number;
    alreadyExisted: number;
    failed: number;
    results: Array<{ email: string; status: string; temporaryPassword?: string }>;
  } | null>(null);

  const toggleCourse = (id: string) => {
    setSelectedCourses((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || selectedCourses.length === 0) return;

    setSaving(true);
    try {
      const res = await api.post<typeof result>('/user-management/students', {
        name,
        email,
        courseIds: selectedCourses,
      });
      setResult(res);
      onAdded();
    } catch (err: unknown) {
      toast('error', (err as Error).message || 'Failed to add student');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkUpload = async () => {
    if (!csvText.trim() || selectedCourses.length === 0) return;

    const lines = csvText
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    const students = lines
      .map((line) => {
        const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
        return { name: parts[0] || '', email: parts[1] || '' };
      })
      .filter((s) => s.name && s.email);

    if (students.length === 0) {
      toast('error', 'No valid students found in CSV');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post<typeof bulkResult>('/user-management/students/bulk', {
        students,
        courseIds: selectedCourses,
      });
      setBulkResult(res);
      onAdded();
    } catch (err: unknown) {
      toast('error', (err as Error).message || 'Bulk upload failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) || '');
    };
    reader.readAsText(file);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast('success', 'Copied to clipboard');
  };

  // Success view
  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold text-green-700 mb-4">Student Added Successfully</h3>
          <p className="text-sm text-gray-700 mb-2">
            <strong>{result.name}</strong> ({result.email})
          </p>
          <p className="text-sm text-gray-600 mb-3">
            Enrolled in: {result.enrolledCourses.join(', ')}
          </p>

          {result.temporaryPassword && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-yellow-800 mb-1">Temporary Password:</p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono bg-white px-3 py-1 rounded border">
                  {result.temporaryPassword}
                </code>
                <button
                  onClick={() => copyToClipboard(result.temporaryPassword!)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-yellow-700 mt-2">
                No email service configured. Please share the password manually.
              </p>
            </div>
          )}

          {!result.temporaryPassword && (
            <p className="text-sm text-gray-600 mb-4">{result.message}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setResult(null);
                setName('');
                setEmail('');
              }}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
            >
              Add Another
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Bulk result view
  if (bulkResult) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">Bulk Upload Results</h3>
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-green-700">Created: {bulkResult.created}</span>
            <span className="text-yellow-700">Existing: {bulkResult.alreadyExisted}</span>
            <span className="text-red-700">Failed: {bulkResult.failed}</span>
          </div>

          <div className="space-y-2 mb-4">
            {bulkResult.results.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded"
              >
                <span>{r.email}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      r.status === 'created'
                        ? 'text-green-600'
                        : r.status === 'failed'
                          ? 'text-red-600'
                          : 'text-yellow-600'
                    }
                  >
                    {r.status}
                  </span>
                  {r.temporaryPassword && (
                    <button
                      onClick={() => copyToClipboard(r.temporaryPassword!)}
                      className="text-xs text-blue-600 hover:underline"
                      title={r.temporaryPassword}
                    >
                      Copy pwd
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Add Student</h3>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'single' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Single Student
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={`px-3 py-1.5 text-sm rounded-lg ${mode === 'bulk' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Bulk Upload
          </button>
        </div>

        {mode === 'single' ? (
          <form onSubmit={handleAddSingle} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enroll in courses
              </label>
              {courses.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedCourses.includes(c.id)}
                    onChange={() => toggleCourse(c.id)}
                  />
                  <span className="text-sm">{c.title}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving || !name || !email || selectedCourses.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Student'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CSV data (name, email per line)
              </label>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'John Doe, john@example.com\nJane Smith, jane@example.com'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg h-32 text-sm font-mono"
              />
              <div className="mt-2">
                <label className="text-sm text-blue-600 cursor-pointer hover:underline">
                  Or upload CSV file
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enroll all in</label>
              {courses.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedCourses.includes(c.id)}
                    onChange={() => toggleCourse(c.id)}
                  />
                  <span className="text-sm">{c.title}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleBulkUpload}
                disabled={saving || !csvText.trim() || selectedCourses.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Uploading...' : 'Upload & Add All'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Student Detail Modal ───────────────────────────────

function StudentDetailModal({
  student,
  onClose,
  onResendInvitation,
}: {
  student: Student;
  onClose: () => void;
  onResendInvitation: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold">{student.name}</h3>
            <p className="text-sm text-gray-500">
              {student.email} &middot; Joined {new Date(student.joinedAt).toLocaleDateString()}
            </p>
            <p className="text-xs text-gray-400">
              Last active: {new Date(student.lastActiveAt).toLocaleDateString()}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>

        {/* Course Progress */}
        <h4 className="font-medium text-gray-900 mb-2 mt-4">Course Progress</h4>
        {student.enrolledCourses.map((course) => (
          <div key={course.courseId} className="bg-gray-50 rounded-lg p-3 mb-2">
            <p className="font-medium text-sm">{course.courseName}</p>
            <div className="mt-1">
              <ProgressBar percentage={course.progress.percentage} />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {course.progress.lessonsCompleted}/{course.progress.totalLessons} lessons &middot;{' '}
              {course.progress.quizzesCompleted} quizzes
              {course.progress.averageQuizScore > 0 &&
                ` &middot; Avg: ${course.progress.averageQuizScore}%`}
            </p>
          </div>
        ))}

        {/* Token Usage */}
        <h4 className="font-medium text-gray-900 mb-2 mt-4">AI Token Usage & Costs</h4>
        <p className="text-sm text-gray-600 mb-3">
          Total: {student.tokenUsage.totalTokens.toLocaleString()} tokens &middot;{' '}
          {formatCost(student.tokenUsage.totalCost)}
        </p>

        {/* By Provider */}
        {Object.keys(student.tokenUsage.byProvider).length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-gray-500 mb-1">By Provider</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-1">Provider</th>
                  <th className="pb-1">Model</th>
                  <th className="pb-1 text-right">Tokens</th>
                  <th className="pb-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(student.tokenUsage.byProvider).map(([provider, pData]) =>
                  Object.entries(pData.byModel).map(([model, mData]) => (
                    <tr key={`${provider}-${model}`} className="border-b border-gray-100">
                      <td className="py-1 capitalize">{provider}</td>
                      <td className="py-1 font-mono text-xs">{model}</td>
                      <td className="py-1 text-right">
                        {(mData.inputTokens + mData.outputTokens).toLocaleString()}
                      </td>
                      <td className="py-1 text-right">{formatCost(mData.totalCost)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* By Feature */}
        {Object.keys(student.tokenUsage.byFeature).length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 mb-1">By Feature</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-1">Feature</th>
                  <th className="pb-1 text-right">Tokens</th>
                  <th className="pb-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(student.tokenUsage.byFeature).map(([feature, fData]) => (
                  <tr key={feature} className="border-b border-gray-100">
                    <td className="py-1">{formatFeatureName(feature)}</td>
                    <td className="py-1 text-right">{fData.totalTokens.toLocaleString()}</td>
                    <td className="py-1 text-right">{formatCost(fData.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4 pt-4 border-t">
          {student.isTemporaryPassword && (
            <button
              onClick={() => onResendInvitation(student.id)}
              className="px-3 py-1.5 text-sm bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200"
            >
              Reset Password
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export function UserManagementPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'students' | 'usage' | 'courses'>('students');

  // Students tab state
  const [students, setStudents] = useState<Student[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Teacher usage tab state
  const [teacherUsage, setTeacherUsage] = useState<TokenUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Course overview tab state
  const [courseOverviews, setCourseOverviews] = useState<CourseOverview[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);

  // Teacher's courses (for filters and add modal)
  const [teacherCourses, setTeacherCourses] = useState<TeacherCourse[]>([]);

  // Load teacher's courses
  useEffect(() => {
    api
      .get<TeacherCourse[]>('/courses')
      .then(setTeacherCourses)
      .catch(() => {});
  }, []);

  // Load students
  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (search) params.set('search', search);
      if (courseFilter) params.set('courseId', courseFilter);

      const data = await api.get<StudentsResponse>(`/user-management/students?${params}`);
      setStudents(data.students);
      setTotalStudents(data.total);
    } catch {
      toast('error', 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [page, search, courseFilter, toast]);

  useEffect(() => {
    if (activeTab === 'students') loadStudents();
  }, [activeTab, loadStudents]);

  // Load teacher usage
  useEffect(() => {
    if (activeTab === 'usage' && !teacherUsage) {
      setUsageLoading(true);
      api
        .get<TokenUsage>('/user-management/my-usage')
        .then(setTeacherUsage)
        .catch(() => toast('error', 'Failed to load usage data'))
        .finally(() => setUsageLoading(false));
    }
  }, [activeTab, teacherUsage, toast]);

  // Load course overviews
  useEffect(() => {
    if (activeTab === 'courses' && courseOverviews.length === 0) {
      setCoursesLoading(true);
      api
        .get<CourseOverview[]>('/user-management/courses-overview')
        .then(setCourseOverviews)
        .catch(() => toast('error', 'Failed to load course overview'))
        .finally(() => setCoursesLoading(false));
    }
  }, [activeTab, courseOverviews.length, toast]);

  const handleResendInvitation = async (studentId: string) => {
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        `/user-management/students/${studentId}/resend-invitation`,
      );
      toast('success', `New temporary password: ${result.temporaryPassword}`);
      loadStudents();
    } catch {
      toast('error', 'Failed to reset password');
    }
  };

  const handleExport = async () => {
    try {
      const params = courseFilter ? `?courseId=${courseFilter}` : '';
      const res = await fetch(`/api/user-management/students/export${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'students.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('error', 'Failed to export CSV');
    }
  };

  const totalPages = Math.ceil(totalStudents / 20);

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">User Management</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'students' as const, label: 'My Students' },
          { key: 'usage' as const, label: 'My Usage' },
          { key: 'courses' as const, label: 'Course Overview' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Students Tab ──────────────────────────────── */}
      {activeTab === 'students' && (
        <div>
          {/* Controls */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="Search students..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64"
            />
            <select
              value={courseFilter}
              onChange={(e) => {
                setCourseFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All Courses</option>
              {teacherCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <div className="ml-auto flex gap-2">
              <button
                onClick={handleExport}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Export CSV
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                + Add Student
              </button>
            </div>
          </div>

          {/* Student Table */}
          {loading ? (
            <div className="text-gray-500 py-8 text-center">Loading students...</div>
          ) : students.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">
              No students found. Add students to get started.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      <th className="pb-2 pr-4">Name / Email</th>
                      <th className="pb-2 pr-4">Courses</th>
                      <th className="pb-2 pr-4">Progress</th>
                      <th className="pb-2 pr-4 text-right">AI Cost</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {students.map((student) => (
                      <tr key={student.id} className="hover:bg-gray-50">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            {student.isTemporaryPassword && (
                              <span
                                className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded"
                                title="Temporary password"
                              >
                                Temp pwd
                              </span>
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{student.name}</p>
                              <p className="text-xs text-gray-500">{student.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          {student.enrolledCourses.map((c) => (
                            <p key={c.courseId} className="text-xs text-gray-600">
                              {c.courseName}
                            </p>
                          ))}
                        </td>
                        <td className="py-3 pr-4">
                          {student.enrolledCourses.map((c) => (
                            <div key={c.courseId} className="mb-1">
                              <ProgressBar percentage={c.progress.percentage} />
                            </div>
                          ))}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-xs">
                          {formatCost(student.tokenUsage.totalCost)}
                        </td>
                        <td className="py-3 text-right space-x-3">
                          <button
                            onClick={() => setSelectedStudent(student)}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            View
                          </button>
                          <Link
                            to={`/teacher/students/${student.id}/logs`}
                            className="text-sm text-indigo-600 hover:underline"
                          >
                            Logs
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-gray-500">
                    Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, totalStudents)} of{' '}
                    {totalStudents}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── My Usage Tab ──────────────────────────────── */}
      {activeTab === 'usage' && (
        <div>
          {usageLoading ? (
            <div className="text-gray-500 py-8 text-center">Loading usage data...</div>
          ) : !teacherUsage ? (
            <div className="text-gray-500 py-8 text-center">No usage data available</div>
          ) : (
            <div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-semibold text-blue-900">My AI Usage</h3>
                <p className="text-sm text-blue-700 mt-1">
                  Total: {teacherUsage.totalTokens.toLocaleString()} tokens &middot;{' '}
                  {formatCost(teacherUsage.totalCost)}
                </p>
              </div>

              {/* By Provider */}
              {Object.keys(teacherUsage.byProvider).length > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 mb-2">By Provider</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b">
                        <th className="pb-2">Provider</th>
                        <th className="pb-2">Model</th>
                        <th className="pb-2 text-right">Tokens</th>
                        <th className="pb-2 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(teacherUsage.byProvider).map(([provider, pData]) =>
                        Object.entries(pData.byModel).map(([model, mData]) => (
                          <tr key={`${provider}-${model}`} className="border-b border-gray-100">
                            <td className="py-2 capitalize">{provider}</td>
                            <td className="py-2 font-mono text-xs">{model}</td>
                            <td className="py-2 text-right">
                              {(mData.inputTokens + mData.outputTokens).toLocaleString()}
                            </td>
                            <td className="py-2 text-right">{formatCost(mData.totalCost)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* By Feature */}
              {Object.keys(teacherUsage.byFeature).length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">By Feature</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b">
                        <th className="pb-2">Feature</th>
                        <th className="pb-2 text-right">Tokens</th>
                        <th className="pb-2 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(teacherUsage.byFeature).map(([feature, fData]) => (
                        <tr key={feature} className="border-b border-gray-100">
                          <td className="py-2">{formatFeatureName(feature)}</td>
                          <td className="py-2 text-right">{fData.totalTokens.toLocaleString()}</td>
                          <td className="py-2 text-right">{formatCost(fData.totalCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {teacherUsage.totalTokens === 0 && (
                <p className="text-gray-500 text-sm">
                  No AI usage recorded yet. Generate course content or use AI features to see usage
                  tracked here.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Course Overview Tab ───────────────────────── */}
      {activeTab === 'courses' && (
        <div>
          {coursesLoading ? (
            <div className="text-gray-500 py-8 text-center">Loading course overview...</div>
          ) : courseOverviews.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">No courses found</div>
          ) : (
            <div className="space-y-4">
              {courseOverviews.map((course) => (
                <div key={course.courseId} className="bg-white border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{course.courseName}</h4>
                      <p className="text-sm text-gray-500 mt-1">
                        {course.totalStudents} students &middot; Avg progress:{' '}
                        {course.averageProgress}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">{formatCost(course.totalAiCost)}</p>
                      <p className="text-xs text-gray-500">Total AI cost</p>
                    </div>
                  </div>
                  {Object.keys(course.byProvider).length > 0 && (
                    <div className="mt-2 flex gap-3 text-xs text-gray-500">
                      {Object.entries(course.byProvider).map(([provider, cost]) => (
                        <span key={provider} className="capitalize">
                          {provider}: {formatCost(cost)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddStudentModal
          courses={teacherCourses}
          onClose={() => setShowAddModal(false)}
          onAdded={loadStudents}
        />
      )}

      {selectedStudent && (
        <StudentDetailModal
          student={selectedStudent}
          onClose={() => setSelectedStudent(null)}
          onResendInvitation={handleResendInvitation}
        />
      )}
    </div>
  );
}
