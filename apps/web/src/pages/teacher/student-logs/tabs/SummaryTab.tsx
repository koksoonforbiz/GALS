interface Summary {
  totalEvents: number;
  totalActiveTimeSecs: number;
  assessmentsStarted: number;
  assessmentsSubmitted: number;
  questionsAnswered: number;
  questionsCorrect: number;
  interventionsTriggered: number;
  interventionsCompleted: number;
  interventionBreakdown: Record<string, number> | null;
  dialogueSessionsStarted: number;
  studentMessagesSent: number;
  flashcardsReviewed: number;
  moduleItemsViewed: number;
  masteryDeltas: Array<{ kcId: string; deltaP_L: number; newP_L: number }> | null;
}

export function SummaryTab({ summary }: { summary: Summary | null }) {
  if (!summary) return <p className="text-xs text-gray-400">No summary yet.</p>;

  const accuracy =
    summary.questionsAnswered > 0
      ? Math.round((summary.questionsCorrect / summary.questionsAnswered) * 100)
      : null;

  const activeMin = Math.round(summary.totalActiveTimeSecs / 60);

  return (
    <div className="space-y-6">
      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Active time" value={`${activeMin} min`} />
        <StatCard label="Total events" value={summary.totalEvents} />
        <StatCard label="Pages viewed" value={summary.moduleItemsViewed} />
        <StatCard label="Questions answered" value={summary.questionsAnswered} />
        <StatCard
          label="Accuracy"
          value={accuracy !== null ? `${accuracy}%` : '\u2014'}
          highlight={accuracy !== null && accuracy >= 70}
        />
        <StatCard label="Interventions" value={summary.interventionsTriggered} />
        <StatCard label="Dialogue messages" value={summary.studentMessagesSent} />
        <StatCard label="Flashcards reviewed" value={summary.flashcardsReviewed} />
      </div>

      {/* Intervention breakdown */}
      {summary.interventionBreakdown && Object.keys(summary.interventionBreakdown).length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Intervention breakdown
          </h3>
          <div className="space-y-1">
            {Object.entries(summary.interventionBreakdown).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-48 truncate">{type}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-purple-400 h-1.5 rounded-full"
                    style={{
                      width: `${Math.min((count / summary.interventionsTriggered) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span className="text-gray-700 dark:text-gray-300 w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mastery deltas */}
      {summary.masteryDeltas && summary.masteryDeltas.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Mastery changes this session
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="pb-1 font-normal">KC</th>
                <th className="pb-1 font-normal text-right">P(L) after</th>
                <th className="pb-1 font-normal text-right">{'\u0394'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {summary.masteryDeltas.map((d, i) => (
                <tr key={i}>
                  <td className="py-1 text-gray-700 dark:text-gray-300 font-mono text-[10px]">
                    {d.kcId}
                  </td>
                  <td className="py-1 text-right text-gray-700 dark:text-gray-300">
                    {(d.newP_L * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`py-1 text-right font-medium ${
                      d.deltaP_L >= 0 ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {d.deltaP_L >= 0 ? '+' : ''}
                    {(d.deltaP_L * 100).toFixed(1)}%
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

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p
        className={`text-lg font-semibold mt-0.5 ${
          highlight ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
