import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngagementService } from './computations/engagement.service';
import { CognitiveLoadService } from './computations/cognitive-load.service';
import { EmotionService } from './computations/emotion.service';
import { LearningVelocityService } from './computations/learning-velocity.service';
import { AtRiskService } from './computations/at-risk.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engagement: EngagementService,
    private readonly cognitiveLoad: CognitiveLoadService,
    private readonly emotion: EmotionService,
    private readonly learningVelocity: LearningVelocityService,
    private readonly atRisk: AtRiskService,
  ) {}

  async compute(
    sessionId: string,
    jobType: string,
  ): Promise<{ success: boolean; jobType: string; results: Record<string, unknown> }> {
    const results: Record<string, unknown> = {};

    const jobs =
      jobType === 'all'
        ? ['engagement', 'cognitive_load', 'emotion', 'learning_velocity', 'at_risk']
        : [jobType];

    for (const job of jobs) {
      switch (job) {
        case 'engagement':
          results.engagement = await this.engagement.compute(sessionId);
          break;
        case 'cognitive_load':
          results.cognitive_load = await this.cognitiveLoad.compute(sessionId);
          break;
        case 'emotion':
          results.emotion = await this.emotion.compute(sessionId);
          break;
        case 'learning_velocity':
          results.learning_velocity = await this.learningVelocity.compute(sessionId);
          break;
        case 'at_risk':
          results.at_risk = await this.atRisk.compute(sessionId);
          break;
      }
    }

    return { success: true, jobType, results };
  }

  async getSummary(sessionId: string) {
    const [engagementWindows, cognitiveWindows, emotions, velocity, riskFlags] = await Promise.all([
      this.prisma.derived_engagement.findMany({
        where: { sessionId },
        orderBy: { windowStartMs: 'asc' },
      }),
      this.prisma.derived_cognitive_load.findMany({
        where: { sessionId },
        orderBy: { windowStartMs: 'asc' },
      }),
      this.prisma.derived_emotion_timeline.findMany({
        where: { sessionId },
        orderBy: { windowStartMs: 'asc' },
      }),
      this.prisma.derived_learning_velocity.findMany({
        where: { sessionId },
      }),
      this.prisma.derived_at_risk_flags.findMany({
        where: { sessionId },
        orderBy: { flaggedAt: 'desc' },
      }),
    ]);

    // Engagement summary
    const latestEngagement = engagementWindows[engagementWindows.length - 1];
    const avgEngagement =
      engagementWindows.length > 0
        ? engagementWindows.reduce((s, w) => s + w.engagementScore, 0) / engagementWindows.length
        : 0;

    // Cognitive load summary
    const latestCognitive = cognitiveWindows[cognitiveWindows.length - 1];
    const avgCognitive =
      cognitiveWindows.length > 0
        ? cognitiveWindows.reduce((s, w) => s + w.cognitiveLoadIndex, 0) / cognitiveWindows.length
        : 0;

    // Emotion distribution
    const emotionCounts: Record<string, number> = {};
    for (const e of emotions) {
      emotionCounts[e.emotion] = (emotionCounts[e.emotion] ?? 0) + 1;
    }
    const totalEmotions = emotions.length || 1;
    const emotionDistribution: Record<string, number> = {};
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      emotionDistribution[emotion] = Math.round((count / totalEmotions) * 100) / 100;
    }
    const dominantEmotion =
      Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';

    // At-risk
    const latestRisk = riskFlags[0];

    return {
      sessionId,
      engagement: {
        windows: engagementWindows,
        latestScore: latestEngagement?.engagementScore ?? 0,
        averageScore: Math.round(avgEngagement * 100) / 100,
      },
      cognitiveLoad: {
        windows: cognitiveWindows,
        latestIndex: latestCognitive?.cognitiveLoadIndex ?? 0,
        averageIndex: Math.round(avgCognitive * 100) / 100,
      },
      emotion: {
        dominantEmotion,
        distribution: emotionDistribution,
      },
      learningVelocity: velocity,
      atRisk: {
        currentLevel: latestRisk?.riskLevel ?? 'none',
        activeConditions: (latestRisk?.reasons as string[]) ?? [],
        history: riskFlags,
      },
    };
  }
}
