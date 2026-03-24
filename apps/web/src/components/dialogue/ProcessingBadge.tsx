interface ProcessingBadgeProps {
  status: string;
}

export function ProcessingBadge({ status }: ProcessingBadgeProps) {
  switch (status) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Ready
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
          Processing
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          Failed
        </span>
      );
    case 'PENDING':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          Pending
        </span>
      );
  }
}
