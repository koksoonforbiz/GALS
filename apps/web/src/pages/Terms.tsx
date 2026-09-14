import { Link } from 'react-router-dom';

/**
 * Data-collection notice shown at registration (SMU cybersecurity
 * checklist item 35). This is a DRAFT written from what the codebase
 * actually collects — it is not reviewed legal/PDPA text. Replace the
 * body copy with SMU's approved policy before any real deployment;
 * the route, link, and consent-checkbox wiring in Register.tsx can
 * stay as-is.
 */
export function Terms() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto bg-white shadow-sm rounded-lg p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Collection Notice</h1>
          <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Draft — this page describes what the platform actually collects, based on a code audit.
            It has not been reviewed by SMU's legal or PDPA office and should be replaced with
            approved policy text before real deployment.
          </p>
        </div>

        <section className="space-y-2 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900">What this platform collects</h2>
          <p>By creating an account, you agree that GALS may collect and store:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your name, email address, and role (student or teacher).</li>
            <li>
              Course activity: pages viewed, questions answered, assessment attempts and scores.
            </li>
            <li>Chat messages you send to the learning assistant, and its responses, in full.</li>
            <li>
              Where enabled for a course: webcam video, screen recordings, eye-gaze/pupil-size
              measurements, keystrokes, and clipboard activity during that course's sessions.
            </li>
            <li>
              Technical/security logs: login times, IP address, and device/browser information.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900">Why</h2>
          <p>
            This data is used to run the adaptive-learning features you interact with (course
            content, the learning assistant, progress tracking) and, for research courses, to
            support the study your teacher/institution has told you about separately.
          </p>
        </section>

        <section className="space-y-2 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900">Recording consent</h2>
          <p>
            Webcam, screen, gaze, and biometric recording is only active for courses where your
            teacher has turned it on, and you'll see a separate, specific consent prompt before any
            of that recording starts.
          </p>
        </section>

        <div className="pt-4 border-t">
          <Link to="/register" className="text-blue-600 hover:text-blue-500 text-sm">
            &larr; Back to sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
