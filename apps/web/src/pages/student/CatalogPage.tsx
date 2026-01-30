import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface CatalogCourse {
  id: string;
  title: string;
  description: string;
  bannerBlobKey: string | null;
  createdAt: string;
  teacher: { id: string; name: string };
  _count: { modules: number; enrollments: number };
}

export function CatalogPage() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [enrolling, setEnrolling] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catalogData, myEnrollments] = await Promise.all([
          apiFetch<CatalogCourse[]>('/courses/catalog'),
          apiFetch<{ courseId: string }[]>('/enrollments/my'),
        ]);
        setCourses(catalogData);
        setEnrolledIds(new Set(myEnrollments.map((e) => e.courseId)));
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to load catalog');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnroll = async (courseId: string) => {
    setEnrolling(courseId);
    try {
      await apiFetch('/enrollments/self', {
        method: 'POST',
        body: JSON.stringify({ courseId }),
      });
      setEnrolledIds((prev) => new Set(prev).add(courseId));
      toast('success', 'Enrolled successfully!');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to enroll');
    } finally {
      setEnrolling(null);
    }
  };

  const filtered = courses.filter(
    (c) =>
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.teacher.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) return <div className="text-gray-500">Loading catalog...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Course Catalog</h2>
      <p className="text-gray-500 text-sm mb-6">Browse and enroll in available courses.</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by title or teacher..."
        className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-6"
      />

      {filtered.length === 0 ? (
        <div className="text-gray-400 text-center py-12">
          {courses.length === 0 ? 'No courses available yet.' : 'No courses match your search.'}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => {
            const isEnrolled = enrolledIds.has(course.id);
            return (
              <div
                key={course.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col"
              >
                <div className="h-2 bg-gradient-to-r from-blue-500 to-purple-500" />
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-lg font-semibold text-gray-900">{course.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">by {course.teacher.name}</p>
                  {course.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-3 flex-1">
                      {course.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-400">
                      {course._count.modules} module(s) &middot; {course._count.enrollments} student(s)
                    </span>
                    {isEnrolled ? (
                      <span className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg font-medium">
                        Enrolled
                      </span>
                    ) : (
                      <button
                        onClick={() => handleEnroll(course.id)}
                        disabled={enrolling === course.id}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {enrolling === course.id ? 'Enrolling...' : 'Enroll'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
