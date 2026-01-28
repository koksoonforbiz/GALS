export function TeacherDashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Teacher Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Total Courses</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Total Questions</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Active Assessments</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Pending Reviews</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
      </div>
    </div>
  );
}
