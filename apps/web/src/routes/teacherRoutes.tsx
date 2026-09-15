import type { RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RoleRoute } from '../components/RoleRoute';
import { TeacherDashboard } from '../pages/teacher/TeacherDashboard';
import { CoursesPage } from '../pages/teacher/CoursesPage';
import { CourseBuilderPage } from '../pages/teacher/CourseBuilderPage';
import { QuestionsPage } from '../pages/teacher/QuestionsPage';
import { AssessmentsPage } from '../pages/teacher/AssessmentsPage';
import { ReviewPage } from '../pages/teacher/ReviewPage';
import { AttemptDetailPage } from '../pages/teacher/AttemptDetailPage';
import { CourseStudioPage } from '../pages/teacher/CourseStudioPage';
import { AiSettingsPage } from '../pages/teacher/AiSettingsPage';
import { PromptSettingsPage } from '../pages/teacher/PromptSettingsPage';
import { QuestionGenerationPage } from '../pages/teacher/QuestionGenerationPage';
import { UserManagementPage } from '../pages/teacher/UserManagementPage';
import { BulkUserProvisioningPage } from '../pages/teacher/BulkUserProvisioningPage';
import { StudentLogPage } from '../pages/teacher/student-logs/StudentLogPage';
import { SessionTimelinePage } from '../pages/dashboard/SessionTimelinePage';
import { StudentTextMiningPage } from '../features/text-mining/pages/StudentTextMiningPage';

// Teacher/admin routes, moved verbatim from App.tsx. Only ever mounted by
// the admin entry; the student bundle must not import this module
// (enforced by .dependency-cruiser.cjs).
function staff(page: ReactNode): ReactNode {
  return <RoleRoute allowedRoles={['teacher', 'admin']}>{page}</RoleRoute>;
}

export const teacherRoutes: RouteObject[] = [
  { path: '/teacher', element: staff(<TeacherDashboard />) },
  { path: '/teacher/courses', element: staff(<CoursesPage />) },
  { path: '/teacher/courses/:courseId', element: staff(<CourseBuilderPage />) },
  { path: '/teacher/studio/:courseId', element: staff(<CourseStudioPage />) },
  { path: '/teacher/courses/:courseId/prompts', element: staff(<PromptSettingsPage />) },
  {
    path: '/teacher/courses/:courseId/generate-questions',
    element: staff(<QuestionGenerationPage />),
  },
  { path: '/teacher/ai-settings', element: staff(<AiSettingsPage />) },
  { path: '/teacher/questions', element: staff(<QuestionsPage />) },
  { path: '/teacher/assessments', element: staff(<AssessmentsPage />) },
  { path: '/teacher/review', element: staff(<ReviewPage />) },
  { path: '/teacher/attempt/:attemptId', element: staff(<AttemptDetailPage />) },
  { path: '/teacher/user-management', element: staff(<UserManagementPage />) },
  { path: '/teacher/users/bulk', element: staff(<BulkUserProvisioningPage />) },
  { path: '/teacher/students/:studentId/logs', element: staff(<StudentLogPage />) },
  { path: '/teacher/students/:studentId/text-mining', element: staff(<StudentTextMiningPage />) },
  // The one teacher route outside /teacher — keep it with the teacher set.
  { path: '/dashboard/sessions/:sessionId/timeline', element: staff(<SessionTimelinePage />) },
];
