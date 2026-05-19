import {
  CircleCheck,
  CircleX,
  CircleAlert,
  Loader2,
  SignalLow,
  SignalMedium,
  SignalHigh,
  ChevronRight,
  TriangleAlert,
  Info,
  MessageSquare,
} from 'lucide-react';

interface ConstructRowProps {
  constructKey: string;
  data: Record<string, unknown>;
  onDrillIn: () => void;
}

const POLARITY: Record<string, Record<string, string>> = {
  metacognition_general: { positive: 'good', negative: 'neutral' },
  metacognitive_monitoring: { positive: 'good', negative: 'neutral' },
  attention_regulation: { positive: 'concerning', negative: 'good' },
  working_memory: { low: 'good', medium: 'neutral', high: 'concerning' },
  cognitive_flexibility: { positive: 'neutral', negative: 'neutral' },
  confusion: { positive: 'concerning', negative: 'good' },
  frustration: { positive: 'concerning', negative: 'good' },
  engagement: { 'on-task': 'good', 'off-task': 'concerning' },
  boredom: { positive: 'concerning', negative: 'good' },
};

function polarityColor(constructKey: string, label: string): string {
  const p = POLARITY[constructKey]?.[label] ?? 'neutral';
  if (p === 'good') return 'text-green-600 bg-green-50';
  if (p === 'concerning') return 'text-red-600 bg-red-50';
  return 'text-gray-600 bg-gray-50';
}

function LatestPill({
  constructKey,
  data,
}: {
  constructKey: string;
  data: Record<string, unknown>;
}) {
  const latest = data.latest as Record<string, unknown> | null;
  if (!latest) return <span className="text-gray-300">--</span>;

  const label = latest.label as string;
  const color = polarityColor(constructKey, label);

  if (label === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-red-600 bg-red-50 text-xs">
        <CircleAlert size={12} aria-hidden="true" /> error
      </span>
    );
  }
  if (label === 'pending') {
    return <Loader2 size={14} className="animate-spin text-gray-400" aria-hidden="true" />;
  }

  const labelType = data.labelType as string;

  if (labelType === 'ordinal') {
    const Icon = label === 'low' ? SignalLow : label === 'medium' ? SignalMedium : SignalHigh;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${color}`}>
        <Icon size={12} aria-hidden="true" /> {label}
      </span>
    );
  }

  const Icon = ['positive', 'on-task'].includes(label) ? CircleCheck : CircleX;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${color}`}>
      <Icon size={12} aria-hidden="true" /> {label}
    </span>
  );
}

function RollingBar({ data }: { data: Record<string, unknown> }) {
  const labelType = data.labelType as string;
  const rolling = data.rolling as Record<string, unknown> | null;
  if (!rolling || (rolling.n as number) === 0) return <span className="text-gray-300">--</span>;

  if (labelType === 'ordinal') {
    const dist = rolling.distribution as Record<string, number>;
    const low = dist.low ?? 0;
    const med = dist.medium ?? 0;
    const high = dist.high ?? 0;
    return (
      <div
        className="flex h-4 rounded overflow-hidden w-full"
        title={`low:${(low * 100).toFixed(0)}% med:${(med * 100).toFixed(0)}% high:${(high * 100).toFixed(0)}%`}
      >
        <div className="bg-green-400" style={{ width: `${low * 100}%` }} />
        <div className="bg-yellow-400" style={{ width: `${med * 100}%` }} />
        <div className="bg-red-400" style={{ width: `${high * 100}%` }} />
      </div>
    );
  }

  const rate =
    labelType === 'engagement'
      ? ((rolling.onTaskRate as number) ?? 0)
      : ((rolling.positiveRate as number) ?? 0);
  const pct = Math.round(rate * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div className="bg-blue-500 rounded-full h-2" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8">{pct}%</span>
    </div>
  );
}

export function ConstructRow({ constructKey, data, onDrillIn }: ConstructRowProps) {
  const displayName = data.displayName as string;
  const feasibility = data.feasibility as number;
  const warning = data.warning as string | null;
  const disabled = data.disabled as boolean;

  if (disabled) {
    return (
      <tr className="opacity-50">
        <td className="px-3 py-2 text-gray-400">{displayName}</td>
        <td className="px-3 py-2" colSpan={4}>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Disabled</span>
        </td>
        <td />
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-800">{displayName}</span>
          {feasibility <= 2 && (
            <TriangleAlert
              size={12}
              className="text-amber-500"
              aria-label={warning ?? 'Low feasibility'}
            />
          )}
          {warning && (
            <span title={warning}>
              <Info size={12} className="text-gray-400" aria-hidden="true" />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <MessageSquare size={10} aria-hidden="true" /> dialogue
        </span>
      </td>
      <td className="px-3 py-2">
        <LatestPill constructKey={constructKey} data={data} />
      </td>
      <td className="px-3 py-2">
        <RollingBar data={data} />
      </td>
      <td className="px-3 py-2">
        <RollingBar data={{ ...data, rolling: data.session }} />
      </td>
      <td className="px-3 py-2">
        <button
          onClick={onDrillIn}
          className="text-gray-400 hover:text-gray-600"
          title="View history"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}
