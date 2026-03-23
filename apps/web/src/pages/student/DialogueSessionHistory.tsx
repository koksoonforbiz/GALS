import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface DialogueSession {
  id: string;
  title: string;
  courseId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number; studioOutputs: number };
}

interface Course {
  id: string;
  title: string;
}

export function DialogueSessionHistory() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [course, setCourse] = useState<Course | null>(null);
  const [sessions, setSessions] = useState<DialogueSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;

    const load = async () => {
      try {
        const [courseData, sessionsData] = await Promise.all([
          api.get<Course>(`/courses/${courseId}`),
          api.get<DialogueSession[]>(`/dialogue/courses/${courseId}/sessions`),
        ]);
        setCourse(courseData);
        setSessions(sessionsData);
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [courseId, toast]);

  const handleDelete = useCallback(
    async (sessionId: string) => {
      try {
        await api.delete(`/dialogue/sessions/${sessionId}`);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast('success', 'Session deleted');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to delete session');
      }
    },
    [toast],
  );

  const handleNewSession = useCallback(() => {
    navigate(`/student/courses/${courseId}/dialogue`);
  }, [courseId, navigate]);

  const handleResume = useCallback(
    (sessionId: string) => {
      navigate(`/student/courses/${courseId}/dialogue?session=${sessionId}`);
    },
    [courseId, navigate],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dialogue Sessions</h1>
          {course && <p className="text-sm text-gray-500 mt-1">{course.title}</p>}
        </div>
        <button
          onClick={handleNewSession}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + New Session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-4xl mb-3">{'\u{1F4AC}'}</div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No sessions yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Start a new dialogue session to begin learning with your sources.
          </p>
          <button
            onClick={handleNewSession}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Start First Session
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                  Session
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                  Created
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                  Last Active
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                  Messages
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.id}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleResume(session.id)}
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-gray-900">{session.title}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {session._count?.messages || 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex items-center justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleResume(session.id)}
                        className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="text-xs px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
