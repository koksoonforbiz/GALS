import { EmotionTimelineLane } from '../components/EmotionTimelineLane';
import { AffectiveStatCards } from '../components/AffectiveStatCards';

interface SessionEmotionTabProps {
  sessionId: string;
  sessionStartMs: number;
  sessionEndMs: number;
}

export function SessionEmotionTab({
  sessionId,
  sessionStartMs,
  sessionEndMs,
}: SessionEmotionTabProps) {
  return (
    <div className="space-y-6">
      <AffectiveStatCards sessionId={sessionId} />

      <EmotionTimelineLane
        sessionId={sessionId}
        sessionStartMs={sessionStartMs}
        sessionEndMs={sessionEndMs}
        pixelsPerSecond={10}
        zoom={1}
      />
    </div>
  );
}
