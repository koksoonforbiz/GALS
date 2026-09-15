import type { RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RoleRoute } from '../components/RoleRoute';
import { BiometricsWrapper } from '../components/student/BiometricsWrapper';
import { StudentDashboard } from '../pages/student/StudentDashboard';
import { StudentAssessmentsPage } from '../pages/student/StudentAssessmentsPage';
import { StudentResultsPage } from '../pages/student/StudentResultsPage';
import { AttemptPage } from '../pages/student/AttemptPage';
import { AssessmentAttemptPage } from '../pages/student/AssessmentAttemptPage';
import { CatalogPage } from '../pages/student/CatalogPage';
import { MyCoursesPage } from '../pages/student/MyCoursesPage';
import { StudentCourseViewPage } from '../pages/student/StudentCourseViewPage';
import { ReviewQueuePage } from '../pages/student/ReviewQueuePage';
import { DialogueLearning } from '../pages/student/DialogueLearning';
import { DialogueSessionHistory } from '../pages/student/DialogueSessionHistory';
import { ChatHistoryPage } from '../pages/student/ChatHistoryPage';

// Student routes, moved verbatim from App.tsx. Wrappers (RoleRoute,
// BiometricsWrapper) are unchanged; see docs/two-door/route-table.md.
function student(page: ReactNode): ReactNode {
  return <RoleRoute allowedRoles={['student']}>{page}</RoleRoute>;
}

function studentBiometric(page: ReactNode): ReactNode {
  return student(<BiometricsWrapper>{page}</BiometricsWrapper>);
}

export const studentRoutes: RouteObject[] = [
  { path: '/student', element: student(<StudentDashboard />) },
  { path: '/student/assessments', element: student(<StudentAssessmentsPage />) },
  { path: '/student/results', element: student(<StudentResultsPage />) },
  { path: '/student/attempt/:attemptId', element: studentBiometric(<AttemptPage />) },
  {
    path: '/student/courses/:courseId/assessment/:assessmentId',
    element: studentBiometric(<AssessmentAttemptPage />),
  },
  { path: '/student/catalog', element: student(<CatalogPage />) },
  { path: '/student/courses', element: student(<MyCoursesPage />) },
  { path: '/student/courses/:courseId', element: studentBiometric(<StudentCourseViewPage />) },
  { path: '/student/review-queue', element: student(<ReviewQueuePage />) },
  { path: '/student/courses/:courseId/dialogue', element: studentBiometric(<DialogueLearning />) },
  {
    path: '/student/courses/:courseId/dialogue/sessions',
    element: student(<DialogueSessionHistory />),
  },
  { path: '/student/chat-history', element: student(<ChatHistoryPage />) },
];
