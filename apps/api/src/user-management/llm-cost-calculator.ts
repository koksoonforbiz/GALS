import type { PrismaClient } from '@prisma/client';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

interface CostResult {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export async function calculateCost(
  prisma: PrismaClient,
  usage: TokenUsage,
): Promise<CostResult> {
  const pricing = await prisma.llmModelPricing.findFirst({
    where: {
      provider: usage.provider,
      model: usage.model,
      isActive: true,
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!pricing) {
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }

  const inputCost = (usage.inputTokens / 1000) * pricing.inputPricePer1k;
  const outputCost = (usage.outputTokens / 1000) * pricing.outputPricePer1k;

  return {
    inputCost: Math.round(inputCost * 1000000) / 1000000,
    outputCost: Math.round(outputCost * 1000000) / 1000000,
    totalCost: Math.round((inputCost + outputCost) * 1000000) / 1000000,
  };
}
