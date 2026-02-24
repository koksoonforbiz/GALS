import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { usePageContext } from '../../contexts/PageContext';
import BlockRenderer from '../../components/editor/BlockRenderer';

interface ModuleItem {
  id: string;
  type: 'PAGE' | 'PDF' | 'LINK' | 'ASSESSMENT';
  title: string;
  orderIndex: number;
  contentMdx: string | null;
  pdfBlobKey: string | null;
  pdfFilename: string | null;
  pdfSize: number | null;
  url: string | null;
  assessmentId: string | null;
}

interface CourseModule {
  id: string;
  title: string;
  orderIndex: number;
  items: ModuleItem[];
}

interface Course {
  id: string;
  title: string;
  description: string;
  status: string;
  teacher: { id: string; name: string };
  modules: CourseModule[];
}

export function StudentCourseViewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { setPageContext } = usePageContext();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Update page context when course or selected item changes
  useEffect(() => {
    if (course && selectedItemId) {
      const item = course.modules.flatMap((m) => m.items).find((i) => i.id === selectedItemId);
      setPageContext({
        pageType: 'lesson',
        courseId: course.id,
        contentId: selectedItemId,
        contentTitle: item?.title || course.title,
      });
    } else if (course) {
      setPageContext({
        pageType: 'lesson',
        courseId: course.id,
        contentId: null,
        contentTitle: course.title,
      });
    }
  }, [course, selectedItemId, setPageContext]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await apiFetch<Course>(`/courses/${courseId}`);
        setCourse(data);
        // Auto-select first item
        const firstItem = data.modules[0]?.items[0];
        if (firstItem) setSelectedItemId(firstItem.id);
      } catch {
        toast('error', 'Failed to load course');
        navigate('/student/courses');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePdfDownload = async (itemId: string) => {
    try {
      const { url } = await apiFetch<{ url: string; filename: string }>(
        `/items/${itemId}/download-url`,
      );
      window.open(url, '_blank');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to open PDF');
    }
  };

  if (loading || !course) return <div className="text-gray-500">Loading course...</div>;

  // Find selected item across all modules
  let selectedItem: ModuleItem | null = null;
  for (const mod of course.modules) {
    const found = mod.items.find((i) => i.id === selectedItemId);
    if (found) {
      selectedItem = found;
      break;
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/student/courses')}
          className="text-gray-500 hover:text-gray-700"
        >
          &larr; Back
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{course.title}</h2>
          <p className="text-sm text-gray-500">by {course.teacher.name}</p>
        </div>
      </div>

      {course.modules.length === 0 ? (
        <div className="text-gray-400 text-center py-12">This course has no content yet.</div>
      ) : (
        <div className="flex gap-6">
          {/* Sidebar: Module/Item navigation */}
          <div className="w-64 shrink-0">
            {course.modules.map((mod) => (
              <div key={mod.id} className="mb-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {mod.title}
                </h4>
                <div className="space-y-0.5">
                  {mod.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
                        selectedItemId === item.id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.type === 'PAGE'
                            ? 'bg-blue-400'
                            : item.type === 'PDF'
                              ? 'bg-red-400'
                              : item.type === 'LINK'
                                ? 'bg-purple-400'
                                : 'bg-green-400'
                        }`}
                      />
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 p-6">
            {!selectedItem ? (
              <p className="text-gray-400">Select an item from the left.</p>
            ) : selectedItem.type === 'PAGE' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                {selectedItem.contentMdx ? (
                  <BlockRenderer content={selectedItem.contentMdx} />
                ) : (
                  <p className="text-gray-400">No content yet.</p>
                )}
              </div>
            ) : selectedItem.type === 'PDF' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                {selectedItem.pdfBlobKey ? (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">{selectedItem.pdfFilename}</p>
                      {selectedItem.pdfSize && (
                        <p className="text-xs text-gray-400">
                          {(selectedItem.pdfSize / 1024).toFixed(0)} KB
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handlePdfDownload(selectedItem!.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Open PDF
                    </button>
                  </div>
                ) : (
                  <p className="text-gray-400">PDF not yet uploaded.</p>
                )}
              </div>
            ) : selectedItem.type === 'LINK' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                {selectedItem.url ? (
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {selectedItem.url}
                  </a>
                ) : (
                  <p className="text-gray-400">No URL set.</p>
                )}
              </div>
            ) : (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                <p className="text-sm text-gray-500">
                  This is a linked assessment. Go to{' '}
                  <button
                    onClick={() => navigate('/student/assessments')}
                    className="text-blue-600 hover:underline"
                  >
                    Assessments
                  </button>{' '}
                  to take it.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
