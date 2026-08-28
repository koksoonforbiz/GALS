import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import { ActivityLogService, ActivityAction } from '../activity-log';
import { CodePracticeService } from '../code-practice/code-practice.service';
import type { Prisma } from '@prisma/client';
import {
  buildInferTreePrompt,
  buildCheckTreePrompt,
  buildHintPrompt,
  buildRevealSubstepPrompt,
  buildRevealCodePrompt,
  buildShowStepAnswerPrompt,
  buildFullTreeAnswerPrompt,
  buildFullCodeAnswerPrompt,
  buildCheckMatchPrompt,
} from './prompts/code-decomposition.prompt';
import type {
  GenerateDecompositionDto,
  InferTreeDto,
  MutateNodeDto,
  NodeHintDto,
  SubmitCodeDto,
  AdoptSolutionDto,
} from './dto';

// ─── Session data shape (persisted as LearningIntervention.sessionData) ───
//
// Stage-1 statuses mirror the paper's 5 node labels, plus a `pending`
// status this codebase needs but the paper doesn't name explicitly: a
// freshly inferred/added node hasn't been graded yet, so it can't honestly
// be `correct` or `incorrect` until the student runs "Check Step Tree".
// Stage-2 statuses (implemented/incorrectly_implemented/to_be_coded) are
// added by a later milestone; the type is declared in full now so the
// sessionData shape never needs a breaking migration between milestones.
export type NodeStatus =
  | 'pending'
  | 'correct'
  | 'incorrect'
  | 'missing'
  | 'can_be_divided'
  | 'system_generated'
  | 'implemented'
  | 'incorrectly_implemented'
  | 'to_be_coded';

export interface HintState {
  general: string | null;
  detailed: string | null;
  revealSubstepId: string | null;
  revealCode: string | null;
  /** Full correct answer for this node ("Show Answer") — distinct from
   *  revealSubstepId/revealCode, which only reveal a partial hint and
   *  leave the node's own status unresolved. Using Show Answer marks the
   *  node done directly, mirroring StepwiseLearningView's showAnswer
   *  mechanic (reveal the answer after repeated failed attempts *and*
   *  mark the step passed so the student isn't stuck). */
  correctAnswer: string | null;
  attemptsSinceLastCheck: number;
  generalViewed: boolean;
  detailedViewed: boolean;
  revealed: boolean;
}

function emptyHintState(): HintState {
  return {
    general: null,
    detailed: null,
    revealSubstepId: null,
    revealCode: null,
    correctAnswer: null,
    attemptsSinceLastCheck: 0,
    generalViewed: false,
    detailedViewed: false,
    revealed: false,
  };
}

export interface StepNode {
  id: string;
  parentId: string | null;
  order: number;
  content: string;
  originalStudentContent: string | null;
  status: NodeStatus;
  llmFeedback: string | null;
  hints: HintState;
  codeMapping: {
    startLine: number | null;
    endLine: number | null;
    commentInsertedAtLine: number | null;
  } | null;
}

export interface CodeDecompositionSessionData {
  problem: { question: string; starterCode: string; language: string };
  inputMode: 'code_first' | 'tree_first';
  stage: 'formation' | 'implementation';
  nodes: StepNode[];
  studentCode: string;
  formationCheckCount: number;
  inferTreeCount: number;
  matchCheckCount: number;
  commentsCopiedAt: string | null;
  testResults: unknown | null;
}

const INFER_TREE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tempId: { type: 'string' },
          parentTempId: { type: ['string', 'null'] },
          content: { type: 'string' },
          order: { type: 'number' },
        },
        required: ['tempId', 'content', 'order'],
      },
    },
  },
  required: ['nodes'],
};

const CHECK_TREE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['correct', 'incorrect', 'can_be_divided'] },
          llmFeedback: { type: ['string', 'null'] },
        },
        required: ['id', 'status'],
      },
    },
    // No "content" field — a missing step is flagged by position only
    // (blank placeholder node), never described, so the student writes
    // it themselves instead of the LLM handing it to them.
    missingNodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          parentId: { type: ['string', 'null'] },
          order: { type: 'number' },
        },
        required: ['order'],
      },
    },
  },
  required: ['updates', 'missingNodes'],
};

const HINT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { hint: { type: 'string' } },
  required: ['hint'],
};

const REVEAL_SUBSTEP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    substep: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  required: ['substep'],
};

const REVEAL_CODE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
};

const SHOW_ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

const CHECK_MATCH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['implemented', 'incorrectly_implemented', 'to_be_coded'],
          },
          llmFeedback: { type: ['string', 'null'] },
          startLine: { type: ['number', 'null'] },
          endLine: { type: ['number', 'null'] },
        },
        required: ['id', 'status'],
      },
    },
  },
  required: ['updates'],
};

const DBOX_COMMENT_BLOCK_START = '# ─── DBox Steps ───';
const DBOX_COMMENT_BLOCK_END = '# ─── End DBox Steps ───';

const MAX_TREE_DEPTH = 3; // step / substep / sub-substep, per the paper
const MAX_FORMATION_CHECKS = 20; // session-level spam guard (see plan §Throttling)
const MAX_INFER_TREE_CALLS = 20; // same rationale as MAX_FORMATION_CHECKS
const MAX_MATCH_CHECKS = 20; // same rationale, stage 2's equivalent of MAX_FORMATION_CHECKS
const REVEAL_ATTEMPT_THRESHOLD = 2; // "after failed two attempts", per the paper

@Injectable()
export class CodeDecompositionService {
  private readonly logger = new Logger(CodeDecompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly activityLogService: ActivityLogService,
    private readonly codePracticeService: CodePracticeService,
  ) {}

  async generateSession(
    userId: string,
    dto: GenerateDecompositionDto,
  ): Promise<{
    sessionId: string;
    problem: CodeDecompositionSessionData['problem'];
    stage: 'formation';
    nodes: StepNode[];
  }> {
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    let problem: CodeDecompositionSessionData['problem'];
    if (dto.question && dto.starterCode) {
      problem = {
        question: dto.question,
        starterCode: dto.starterCode,
        language: dto.language || 'python',
      };
    } else {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        select: { title: true },
      });
      if (!course) throw new NotFoundException('Course not found');
      const generated = await this.codePracticeService.generateQuestion(
        teacherId,
        dto.courseId,
        course.title,
      );
      problem = generated;
    }

    const sessionData: CodeDecompositionSessionData = {
      problem,
      inputMode: 'code_first',
      stage: 'formation',
      nodes: [],
      studentCode: problem.starterCode,
      formationCheckCount: 0,
      inferTreeCount: 0,
      matchCheckCount: 0,
      commentsCopiedAt: null,
      testResults: null,
    };

    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'CODE_DECOMPOSITION',
        status: 'IN_PROGRESS',
        selectedText: problem.question,
        sessionData: sessionData as unknown as Prisma.InputJsonValue,
      },
    });

    return { sessionId: intervention.id, problem, stage: 'formation', nodes: [] };
  }

  async inferTree(
    userId: string,
    sessionId: string,
    dto: InferTreeDto,
  ): Promise<{ nodes: StepNode[]; stage: CodeDecompositionSessionData['stage'] }> {
    if (!dto.code || !dto.code.trim()) {
      throw new BadRequestException('code is required');
    }

    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'formation') {
      throw new BadRequestException('Tree inference is only available during solution formation');
    }
    if (sessionData.inferTreeCount >= MAX_INFER_TREE_CALLS) {
      throw new BadRequestException(
        "You've rebuilt the tree from code a lot — try checking or editing the current tree instead.",
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    const { system, user } = buildInferTreePrompt({
      problem: sessionData.problem.question,
      code: dto.code,
    });

    let inferred: Array<{
      tempId: string;
      parentTempId: string | null;
      content: string;
      order: number;
    }>;
    let attempts = 0;
    const maxAttempts = 2;
    for (;;) {
      attempts++;
      try {
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: INFER_TREE_SCHEMA,
          },
          {
            feature: 'code_decomposition_infer_tree',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        inferred = this.validateInferTreeResponse(this.parseLlmJson(result.content));
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('code_decomposition infer-tree failed after retries', err);
          throw new BadRequestException(
            'Failed to infer a step tree from this code. Please try again.',
          );
        }
        this.logger.warn(`infer-tree attempt ${attempts} failed, retrying...`);
      }
    }

    const tempIdToRealId = new Map<string, string>();
    for (const n of inferred!) tempIdToRealId.set(n.tempId, randomUUID());

    const nodes: StepNode[] = inferred!.map((n) => ({
      id: tempIdToRealId.get(n.tempId)!,
      parentId: n.parentTempId ? (tempIdToRealId.get(n.parentTempId) ?? null) : null,
      order: n.order,
      content: n.content,
      originalStudentContent: null,
      status: 'pending',
      llmFeedback: null,
      hints: emptyHintState(),
      codeMapping: null,
    }));

    const updated: CodeDecompositionSessionData = {
      ...sessionData,
      nodes,
      inputMode: 'code_first',
      studentCode: dto.code,
      inferTreeCount: sessionData.inferTreeCount + 1,
    };

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    return { nodes, stage: updated.stage };
  }

  async checkTree(
    userId: string,
    sessionId: string,
    activitySessionId?: string,
  ): Promise<{ nodes: StepNode[]; stage: CodeDecompositionSessionData['stage'] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'formation') {
      throw new BadRequestException('Check Step Tree is only available during solution formation');
    }
    if (sessionData.nodes.length === 0) {
      throw new BadRequestException('Add or infer some steps before checking the tree');
    }
    if (sessionData.formationCheckCount >= MAX_FORMATION_CHECKS) {
      throw new BadRequestException(
        "You've checked this tree a lot — try implementing a few more steps before checking again.",
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    const { system, user } = buildCheckTreePrompt({
      problem: sessionData.problem.question,
      nodes: sessionData.nodes.map((n) => ({ id: n.id, parentId: n.parentId, content: n.content })),
    });

    let parsed: {
      updates: Array<{
        id: string;
        status: 'correct' | 'incorrect' | 'can_be_divided';
        llmFeedback: string | null;
      }>;
      missingNodes: Array<{ parentId: string | null; order: number }>;
    };
    try {
      const result = await this.llmService.callLlmStructured(
        teacherId,
        {
          systemPrompt: system,
          messages: [{ role: 'user', content: user }],
          jsonMode: true,
          jsonSchema: CHECK_TREE_SCHEMA,
        },
        {
          feature: 'code_decomposition_check_tree',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        },
      );
      parsed = this.validateCheckTreeResponse(this.parseLlmJson(result.content));
    } catch (err) {
      this.logger.error('code_decomposition check-tree failed', err);
      throw new BadRequestException('Failed to check the step tree. Please try again.');
    }

    const existingIds = new Set(sessionData.nodes.map((n) => n.id));
    const updateById = new Map(parsed.updates.map((u) => [u.id, u]));

    // Never touch `content`/`id`/`hints` on existing nodes — only status +
    // feedback are LLM-writable, per the "preserve original structure" rule.
    const updatedNodes: StepNode[] = sessionData.nodes.map((n) => {
      const u = updateById.get(n.id);
      if (!u) return n; // LLM omitted this node — leave its prior status as-is
      return { ...n, status: u.status, llmFeedback: u.llmFeedback ?? null };
    });

    for (const m of parsed.missingNodes) {
      const parentId = m.parentId && existingIds.has(m.parentId) ? m.parentId : null;
      if (this.depthOf(parentId, updatedNodes) >= MAX_TREE_DEPTH) continue; // silently drop over-deep nodes
      // Blank placeholder — position only, never content. The student
      // writes what belongs here; the LLM only flags that something does.
      const newNode: StepNode = {
        id: randomUUID(),
        parentId,
        order: m.order,
        content: '',
        originalStudentContent: null,
        status: 'missing',
        llmFeedback: null,
        hints: emptyHintState(),
        codeMapping: null,
      };
      updatedNodes.push(newNode);
    }

    // "Failed attempt" bookkeeping that gates Reveal (Sub)Step: a node
    // still incorrect after this check counts as one more failed attempt;
    // a node that just became correct has its counter reset. Nodes that
    // weren't evaluated this round (missing/can_be_divided/pending/
    // system_generated) are left untouched.
    const finalNodes = updatedNodes.map((n) => {
      if (n.status === 'correct') {
        return n.hints.attemptsSinceLastCheck === 0
          ? n
          : { ...n, hints: { ...n.hints, attemptsSinceLastCheck: 0 } };
      }
      if (n.status === 'incorrect') {
        return {
          ...n,
          hints: { ...n.hints, attemptsSinceLastCheck: n.hints.attemptsSinceLastCheck + 1 },
        };
      }
      return n;
    });

    const updated: CodeDecompositionSessionData = {
      ...sessionData,
      nodes: finalNodes,
      formationCheckCount: sessionData.formationCheckCount + 1,
    };

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_TREE_CHECKED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: {
          nodeCount: finalNodes.length,
          correctCount: finalNodes.filter((n) => n.status === 'correct').length,
          formationCheckCount: updated.formationCheckCount,
        },
      });
    }

    return { nodes: finalNodes, stage: updated.stage };
  }

  async mutateNode(
    userId: string,
    sessionId: string,
    dto: MutateNodeDto,
  ): Promise<{ nodes: StepNode[] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'formation') {
      throw new BadRequestException('Tree editing is only available during solution formation');
    }

    let nodes = [...sessionData.nodes];
    let inputMode = sessionData.inputMode;

    switch (dto.action) {
      case 'add': {
        const content = dto.content?.trim();
        if (!content) throw new BadRequestException('content is required');
        const parentId =
          dto.parentId && nodes.some((n) => n.id === dto.parentId) ? dto.parentId : null;
        if (this.depthOf(parentId, nodes) >= MAX_TREE_DEPTH) {
          throw new BadRequestException('Maximum step nesting depth reached');
        }
        if (nodes.length === 0) inputMode = 'tree_first'; // first-ever node was hand-authored, not inferred
        const siblingOrders = nodes.filter((n) => n.parentId === parentId).map((n) => n.order);
        const order = siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
        nodes.push({
          id: randomUUID(),
          parentId,
          order,
          content,
          originalStudentContent: content,
          status: 'pending',
          llmFeedback: null,
          hints: emptyHintState(),
          codeMapping: null,
        });
        break;
      }
      case 'edit': {
        const content = dto.content?.trim();
        if (!content) throw new BadRequestException('content is required');
        const idx = nodes.findIndex((n) => n.id === dto.nodeId);
        const existing = nodes[idx];
        if (idx === -1 || !existing) throw new NotFoundException('Node not found');
        nodes[idx] = {
          ...existing,
          content,
          originalStudentContent: content,
          status: 'pending',
          llmFeedback: null,
        };
        break;
      }
      case 'delete': {
        const toDelete = this.collectSubtreeIds(dto.nodeId, nodes);
        if (toDelete.size === 0) throw new NotFoundException('Node not found');
        nodes = nodes.filter((n) => !toDelete.has(n.id));
        break;
      }
      case 'reorder': {
        const idx = nodes.findIndex((n) => n.id === dto.nodeId);
        const node = nodes[idx];
        if (idx === -1 || !node) throw new NotFoundException('Node not found');
        const siblings = nodes
          .filter((n) => n.parentId === node.parentId)
          .sort((a, b) => a.order - b.order);
        const pos = siblings.findIndex((n) => n.id === node.id);
        const swapPos = dto.direction === 'up' ? pos - 1 : pos + 1;
        const other = swapPos >= 0 && swapPos < siblings.length ? siblings[swapPos] : undefined;
        if (other) {
          const otherIdx = nodes.findIndex((n) => n.id === other.id);
          const thisOrder = node.order;
          nodes[idx] = { ...node, order: other.order };
          nodes[otherIdx] = { ...other, order: thisOrder };
        }
        break;
      }
    }

    const updated: CodeDecompositionSessionData = { ...sessionData, nodes, inputMode };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });
    return { nodes };
  }

  async getNodeHint(
    userId: string,
    sessionId: string,
    nodeId: string,
    dto: NodeHintDto,
    activitySessionId?: string,
  ): Promise<{ hint: string }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;
    const idx = sessionData.nodes.findIndex((n) => n.id === nodeId);
    const node = sessionData.nodes[idx];
    if (idx === -1 || !node) throw new NotFoundException('Node not found');

    const recordHintViewed = () => {
      if (!activitySessionId) return;
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_NODE_HINT_VIEWED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { nodeId, tier: dto.tier, stage: sessionData.stage },
      });
    };

    const cached = dto.tier === 'general' ? node.hints.general : node.hints.detailed;
    if (cached) {
      recordHintViewed();
      return { hint: cached };
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    const { system, user } = buildHintPrompt({
      problem: sessionData.problem.question,
      stepContent: node.content,
      stage: sessionData.stage,
      tier: dto.tier,
    });

    let hint: string;
    try {
      const result = await this.llmService.callLlmStructured(
        teacherId,
        {
          systemPrompt: system,
          messages: [{ role: 'user', content: user }],
          jsonMode: true,
          jsonSchema: HINT_SCHEMA,
        },
        {
          feature: 'code_decomposition_hint',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        },
      );
      const parsed = this.parseLlmJson(result.content) as { hint?: unknown };
      if (typeof parsed.hint !== 'string' || !parsed.hint.trim()) {
        throw new Error('Invalid hint response');
      }
      hint = parsed.hint.trim();
    } catch (err) {
      this.logger.error('code_decomposition hint failed', err);
      throw new BadRequestException('Failed to generate a hint. Please try again.');
    }

    const nodes = [...sessionData.nodes];
    nodes[idx] = {
      ...node,
      hints: {
        ...node.hints,
        general: dto.tier === 'general' ? hint : node.hints.general,
        detailed: dto.tier === 'detailed' ? hint : node.hints.detailed,
        generalViewed: dto.tier === 'general' ? true : node.hints.generalViewed,
        detailedViewed: dto.tier === 'detailed' ? true : node.hints.detailedViewed,
      },
    };
    const updated: CodeDecompositionSessionData = { ...sessionData, nodes };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });
    recordHintViewed();
    return { hint };
  }

  async revealNode(
    userId: string,
    sessionId: string,
    nodeId: string,
    activitySessionId?: string,
  ): Promise<{ nodes: StepNode[] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;
    const idx = sessionData.nodes.findIndex((n) => n.id === nodeId);
    const node = sessionData.nodes[idx];
    if (idx === -1 || !node) throw new NotFoundException('Node not found');

    const doneStatus: NodeStatus = sessionData.stage === 'formation' ? 'correct' : 'implemented';
    if (node.status === doneStatus) {
      throw new BadRequestException('This step is already done');
    }
    if (node.hints.revealed) {
      throw new BadRequestException('This step has already had something revealed');
    }
    if (node.hints.attemptsSinceLastCheck < REVEAL_ATTEMPT_THRESHOLD) {
      throw new BadRequestException(
        `Check at least ${REVEAL_ATTEMPT_THRESHOLD} more time(s) with this step still unresolved before revealing`,
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    const nodes = [...sessionData.nodes];

    if (sessionData.stage === 'formation') {
      if (this.depthOf(node.id, sessionData.nodes) >= MAX_TREE_DEPTH) {
        throw new BadRequestException('This step is already at the maximum nesting depth');
      }
      const { system, user } = buildRevealSubstepPrompt({
        problem: sessionData.problem.question,
        stepContent: node.content,
      });

      let substepContent: string;
      try {
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: REVEAL_SUBSTEP_SCHEMA,
          },
          {
            feature: 'code_decomposition_reveal',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        const parsed = this.parseLlmJson(result.content) as { substep?: { content?: unknown } };
        if (typeof parsed.substep?.content !== 'string' || !parsed.substep.content.trim()) {
          throw new Error('Invalid reveal response');
        }
        substepContent = parsed.substep.content.trim();
      } catch (err) {
        this.logger.error('code_decomposition reveal (substep) failed', err);
        throw new BadRequestException('Failed to reveal a substep. Please try again.');
      }

      const newNode: StepNode = {
        id: randomUUID(),
        parentId: node.id,
        order: 0,
        content: substepContent,
        originalStudentContent: null,
        status: 'system_generated',
        llmFeedback: null,
        hints: emptyHintState(),
        codeMapping: null,
      };
      nodes.push(newNode);
      nodes[idx] = {
        ...node,
        hints: { ...node.hints, revealed: true, revealSubstepId: newNode.id },
      };
    } else {
      const { system, user } = buildRevealCodePrompt({
        problem: sessionData.problem.question,
        stepContent: node.content,
        code: sessionData.studentCode,
      });

      let code: string;
      try {
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: REVEAL_CODE_SCHEMA,
          },
          {
            feature: 'code_decomposition_reveal',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        const parsed = this.parseLlmJson(result.content) as { code?: unknown };
        if (typeof parsed.code !== 'string' || !parsed.code.trim()) {
          throw new Error('Invalid reveal response');
        }
        code = parsed.code.trim();
      } catch (err) {
        this.logger.error('code_decomposition reveal (code) failed', err);
        throw new BadRequestException('Failed to reveal code for this step. Please try again.');
      }

      nodes[idx] = { ...node, hints: { ...node.hints, revealed: true, revealCode: code } };
    }

    const updated: CodeDecompositionSessionData = { ...sessionData, nodes };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { nodeId, stage: sessionData.stage },
      });
    }

    return { nodes };
  }

  /** Stronger than `revealNode` — the student asked to see the answer
   *  outright rather than a partial hint, so this marks the node done
   *  directly instead of leaving it for them to keep working on. Mirrors
   *  StepwiseLearningView's checkStepResponse `showAnswer` behavior
   *  (reveal + mark passed after repeated failed attempts) so a student
   *  who's genuinely stuck is never permanently blocked from advancing. */
  async showAnswer(
    userId: string,
    sessionId: string,
    nodeId: string,
    activitySessionId?: string,
  ): Promise<{ nodes: StepNode[] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;
    const idx = sessionData.nodes.findIndex((n) => n.id === nodeId);
    const node = sessionData.nodes[idx];
    if (idx === -1 || !node) throw new NotFoundException('Node not found');

    const doneStatus: NodeStatus = sessionData.stage === 'formation' ? 'correct' : 'implemented';
    if (node.status === doneStatus) {
      throw new BadRequestException('This step is already done');
    }
    if (node.hints.attemptsSinceLastCheck < REVEAL_ATTEMPT_THRESHOLD) {
      throw new BadRequestException(
        `Check at least ${REVEAL_ATTEMPT_THRESHOLD} more time(s) with this step still unresolved before showing the answer`,
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    let answer: string;
    try {
      if (sessionData.stage === 'formation') {
        const { system, user } = buildShowStepAnswerPrompt({
          problem: sessionData.problem.question,
          stepContent: node.content,
        });
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: SHOW_ANSWER_SCHEMA,
          },
          {
            feature: 'code_decomposition_show_answer',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        const parsed = this.parseLlmJson(result.content) as { answer?: unknown };
        if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
          throw new Error('Invalid show-answer response');
        }
        answer = parsed.answer.trim();
      } else {
        const { system, user } = buildRevealCodePrompt({
          problem: sessionData.problem.question,
          stepContent: node.content,
          code: sessionData.studentCode,
        });
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: REVEAL_CODE_SCHEMA,
          },
          {
            feature: 'code_decomposition_show_answer',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        const parsed = this.parseLlmJson(result.content) as { code?: unknown };
        if (typeof parsed.code !== 'string' || !parsed.code.trim()) {
          throw new Error('Invalid show-answer response');
        }
        answer = parsed.code.trim();
      }
    } catch (err) {
      this.logger.error('code_decomposition show-answer failed', err);
      throw new BadRequestException('Failed to show the answer. Please try again.');
    }

    const nodes = [...sessionData.nodes];
    nodes[idx] = {
      ...node,
      status: doneStatus,
      llmFeedback: null,
      hints: { ...node.hints, correctAnswer: answer, revealed: true },
    };

    const updated: CodeDecompositionSessionData = { ...sessionData, nodes };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { nodeId, stage: sessionData.stage, mode: 'show_answer' },
      });
    }

    return { nodes };
  }

  /** Whole-tree/whole-solution version of `showAnswer` — replaces the
   *  entire tree (formation) or the entire code (implementation) with an
   *  LLM-generated ideal answer — as a non-destructive PREVIEW only.
   *  Unlike `showAnswer`, this never writes to sessionData: the
   *  student's actual tree/code is untouched, and the frontend toggles
   *  between showing it and this response rather than replacing it.
   *  Deliberately ungated (no attempt threshold, always available) per
   *  explicit product request, so it's throttled harder than the
   *  per-node reveal actions at the controller level to bound spam. */
  async revealFullSolution(
    userId: string,
    sessionId: string,
    activitySessionId?: string,
  ): Promise<{ stage: CodeDecompositionSessionData['stage']; nodes: StepNode[]; code?: string }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;
    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    if (sessionData.stage === 'formation') {
      const { system, user } = buildFullTreeAnswerPrompt({ problem: sessionData.problem.question });
      let inferred: Array<{
        tempId: string;
        parentTempId: string | null;
        content: string;
        order: number;
      }>;
      try {
        const result = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt: system,
            messages: [{ role: 'user', content: user }],
            jsonMode: true,
            jsonSchema: INFER_TREE_SCHEMA,
          },
          {
            feature: 'code_decomposition_reveal_solution',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
        );
        inferred = this.validateInferTreeResponse(this.parseLlmJson(result.content));
      } catch (err) {
        this.logger.error('code_decomposition reveal-solution (tree) failed', err);
        throw new BadRequestException('Failed to reveal the complete tree. Please try again.');
      }

      const tempIdToRealId = new Map<string, string>();
      for (const n of inferred) tempIdToRealId.set(n.tempId, randomUUID());
      // Cosmetic-only status ('correct', for green coloring in the
      // read-only preview) — never persisted, so it can't leak into the
      // student's own grading.
      const nodes: StepNode[] = inferred.map((n) => ({
        id: tempIdToRealId.get(n.tempId)!,
        parentId: n.parentTempId ? (tempIdToRealId.get(n.parentTempId) ?? null) : null,
        order: n.order,
        content: n.content,
        originalStudentContent: null,
        status: 'correct',
        llmFeedback: null,
        hints: emptyHintState(),
        codeMapping: null,
      }));

      if (activitySessionId) {
        void this.activityLogService.record({
          sessionId: activitySessionId,
          userId,
          action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
          interventionId: sessionId,
          courseId: intervention.courseId,
          metadata: { stage: 'formation', mode: 'full_tree' },
        });
      }

      return { stage: 'formation', nodes };
    }

    // implementation stage — reveal the complete code solution
    const { system, user } = buildFullCodeAnswerPrompt({
      problem: sessionData.problem.question,
      nodes: sessionData.nodes.map((n) => ({ content: n.content })),
    });
    let code: string;
    try {
      const result = await this.llmService.callLlmStructured(
        teacherId,
        {
          systemPrompt: system,
          messages: [{ role: 'user', content: user }],
          jsonMode: true,
          jsonSchema: REVEAL_CODE_SCHEMA,
        },
        {
          feature: 'code_decomposition_reveal_solution',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        },
      );
      const parsed = this.parseLlmJson(result.content) as { code?: unknown };
      if (typeof parsed.code !== 'string' || !parsed.code.trim()) {
        throw new Error('Invalid reveal-solution response');
      }
      code = parsed.code.trim();
    } catch (err) {
      this.logger.error('code_decomposition reveal-solution (code) failed', err);
      throw new BadRequestException('Failed to reveal the complete solution. Please try again.');
    }

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { stage: 'implementation', mode: 'full_solution' },
      });
    }

    return { stage: 'implementation', nodes: [], code };
  }

  /** Persists a previously-previewed reveal (from `revealFullSolution`)
   *  as the student's actual tree/code, marked done. The client sends
   *  back exactly what it was shown — this never calls the LLM again,
   *  it just writes what's already been generated and displayed. */
  async adoptSolution(
    userId: string,
    sessionId: string,
    dto: AdoptSolutionDto,
    activitySessionId?: string,
  ): Promise<{ nodes: StepNode[] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage === 'formation') {
      if (!Array.isArray(dto.nodes) || dto.nodes.length === 0) {
        throw new BadRequestException('nodes is required to adopt a solution during formation');
      }
      const validIds = new Set(dto.nodes.map((n) => n.id));
      const nodes: StepNode[] = dto.nodes.map((n) => {
        if (typeof n.id !== 'string' || typeof n.content !== 'string') {
          throw new BadRequestException('Invalid node in adopted solution');
        }
        return {
          id: n.id,
          parentId: n.parentId && validIds.has(n.parentId) ? n.parentId : null,
          order: typeof n.order === 'number' ? n.order : 0,
          content: n.content,
          originalStudentContent: null,
          status: 'correct',
          llmFeedback: null,
          hints: emptyHintState(),
          codeMapping: null,
        };
      });

      const updated: CodeDecompositionSessionData = { ...sessionData, nodes };
      await this.prisma.learningIntervention.update({
        where: { id: sessionId },
        data: { sessionData: updated as unknown as Prisma.InputJsonValue },
      });

      if (activitySessionId) {
        void this.activityLogService.record({
          sessionId: activitySessionId,
          userId,
          action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
          interventionId: sessionId,
          courseId: intervention.courseId,
          metadata: { stage: 'formation', mode: 'adopt_full_tree' },
        });
      }

      return { nodes };
    }

    if (typeof dto.code !== 'string' || !dto.code.trim()) {
      throw new BadRequestException('code is required to adopt a solution during implementation');
    }
    const nodes: StepNode[] = sessionData.nodes.map((n) => ({
      ...n,
      status: 'implemented',
      llmFeedback: null,
    }));
    const updated: CodeDecompositionSessionData = { ...sessionData, nodes, studentCode: dto.code };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_NODE_REVEALED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { stage: 'implementation', mode: 'adopt_full_solution' },
      });
    }

    return { nodes };
  }

  async advanceStage(
    userId: string,
    sessionId: string,
    activitySessionId?: string,
  ): Promise<{ stage: CodeDecompositionSessionData['stage'] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'formation') {
      throw new BadRequestException('Session is not in the formation stage');
    }
    if (sessionData.nodes.length === 0 || sessionData.nodes.some((n) => n.status !== 'correct')) {
      throw new BadRequestException(
        'All steps must be marked correct before moving to implementation',
      );
    }

    // Stage 2 evaluates a different dimension (code implementation, not
    // step correctness), so each node's status/feedback/hints reset to a
    // clean slate here — a stage-1 hint or attempt count must not leak
    // into stage-2 gating.
    const nodes: StepNode[] = sessionData.nodes.map((n) => ({
      ...n,
      status: 'to_be_coded',
      llmFeedback: null,
      hints: emptyHintState(),
      codeMapping: null,
    }));

    const updated: CodeDecompositionSessionData = {
      ...sessionData,
      stage: 'implementation',
      nodes,
    };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_STAGE_ADVANCED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: { fromStage: 'formation', toStage: 'implementation', nodeCount: nodes.length },
      });
    }

    return { stage: 'implementation' };
  }

  async copyToComments(
    userId: string,
    sessionId: string,
  ): Promise<{ code: string; nodeLineMap: Record<string, number> }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'implementation') {
      throw new BadRequestException('Copy to Comments is only available during implementation');
    }

    const { lines, nodeLineMap } = this.buildCommentBlock(sessionData.nodes);
    const commentBlock = lines.join('\n');
    // Strip a header this same action inserted on a prior run before
    // rebuilding, so re-running Copy to Comments after editing the tree
    // replaces the old header instead of stacking a second one on top.
    const baseCode = this.stripPriorCommentBlock(sessionData.studentCode).trim();
    const code = baseCode.length > 0 ? `${commentBlock}\n\n${baseCode}` : `${commentBlock}\n`;

    const nodes: StepNode[] = sessionData.nodes.map((n) => ({
      ...n,
      codeMapping: {
        startLine: nodeLineMap[n.id] ?? null,
        endLine: nodeLineMap[n.id] ?? null,
        commentInsertedAtLine: nodeLineMap[n.id] ?? null,
      },
    }));

    const updated: CodeDecompositionSessionData = {
      ...sessionData,
      nodes,
      studentCode: code,
      commentsCopiedAt: new Date().toISOString(),
    };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });
    return { code, nodeLineMap };
  }

  async syncCode(userId: string, sessionId: string, dto: SubmitCodeDto): Promise<{ ok: true }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    const updated: CodeDecompositionSessionData = { ...sessionData, studentCode: dto.code };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });
    return { ok: true };
  }

  async checkMatch(
    userId: string,
    sessionId: string,
    activitySessionId?: string,
  ): Promise<{ nodes: StepNode[] }> {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    if (sessionData.stage !== 'implementation') {
      throw new BadRequestException('Check Match is only available during implementation');
    }
    if (sessionData.matchCheckCount >= MAX_MATCH_CHECKS) {
      throw new BadRequestException(
        "You've checked this a lot — try implementing a few more steps before checking again.",
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
    const { system, user } = buildCheckMatchPrompt({
      problem: sessionData.problem.question,
      nodes: sessionData.nodes.map((n) => ({ id: n.id, parentId: n.parentId, content: n.content })),
      code: sessionData.studentCode,
    });

    let parsed: {
      updates: Array<{
        id: string;
        status: 'implemented' | 'incorrectly_implemented' | 'to_be_coded';
        llmFeedback: string | null;
        startLine: number | null;
        endLine: number | null;
      }>;
    };
    try {
      const result = await this.llmService.callLlmStructured(
        teacherId,
        {
          systemPrompt: system,
          messages: [{ role: 'user', content: user }],
          jsonMode: true,
          jsonSchema: CHECK_MATCH_SCHEMA,
        },
        {
          feature: 'code_decomposition_check_match',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        },
      );
      parsed = this.validateCheckMatchResponse(this.parseLlmJson(result.content));
    } catch (err) {
      this.logger.error('code_decomposition check-match failed', err);
      throw new BadRequestException(
        'Failed to check your code against the step tree. Please try again.',
      );
    }

    const updateById = new Map(parsed.updates.map((u) => [u.id, u]));
    const updatedNodes: StepNode[] = sessionData.nodes.map((n) => {
      const u = updateById.get(n.id);
      if (!u) return n;
      const startLine = this.clampLine(u.startLine, sessionData.studentCode);
      const endLine = this.clampLine(u.endLine, sessionData.studentCode);
      const attemptsSinceLastCheck =
        u.status === 'implemented'
          ? 0
          : u.status === 'incorrectly_implemented'
            ? n.hints.attemptsSinceLastCheck + 1
            : n.hints.attemptsSinceLastCheck;
      return {
        ...n,
        status: u.status,
        llmFeedback: u.llmFeedback ?? null,
        hints: { ...n.hints, attemptsSinceLastCheck },
        codeMapping: {
          startLine,
          endLine,
          commentInsertedAtLine: n.codeMapping?.commentInsertedAtLine ?? null,
        },
      };
    });

    const updated: CodeDecompositionSessionData = {
      ...sessionData,
      nodes: updatedNodes,
      matchCheckCount: sessionData.matchCheckCount + 1,
    };
    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { sessionData: updated as unknown as Prisma.InputJsonValue },
    });

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId,
        action: ActivityAction.CODE_DECOMP_MATCH_CHECKED,
        interventionId: sessionId,
        courseId: intervention.courseId,
        metadata: {
          nodeCount: updatedNodes.length,
          implementedCount: updatedNodes.filter((n) => n.status === 'implemented').length,
          matchCheckCount: updated.matchCheckCount,
        },
      });
    }

    return { nodes: updatedNodes };
  }

  async getSession(userId: string, sessionId: string) {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    return {
      sessionId: intervention.id,
      status: intervention.status,
      problem: sessionData.problem,
      inputMode: sessionData.inputMode,
      stage: sessionData.stage,
      nodes: sessionData.nodes,
      studentCode: sessionData.studentCode,
      formationCheckCount: sessionData.formationCheckCount,
      inferTreeCount: sessionData.inferTreeCount,
      matchCheckCount: sessionData.matchCheckCount,
      commentsCopiedAt: sessionData.commentsCopiedAt,
      completedAt: intervention.completedAt,
    };
  }

  async completeSession(userId: string, sessionId: string) {
    const intervention = await this.loadOwnedSession(userId, sessionId);
    const sessionData = intervention.sessionData as unknown as CodeDecompositionSessionData;

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const doneStatus: NodeStatus = sessionData.stage === 'formation' ? 'correct' : 'implemented';
    const correctNodes = sessionData.nodes.filter((n) => n.status === doneStatus).length;
    return {
      totalNodes: sessionData.nodes.length,
      correctNodes,
      stage: sessionData.stage,
    };
  }

  // ─── Private helpers ────────────────────────────────────────

  private async loadOwnedSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });
    if (!intervention) {
      throw new NotFoundException('Decomposition session not found');
    }
    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's session");
    }
    if (intervention.type !== 'CODE_DECOMPOSITION') {
      throw new BadRequestException('Invalid intervention type');
    }
    return intervention;
  }

  /** Mirrors LearningInterventionsService's private helper of the same
   *  name — learning interventions use the course teacher's API key, not
   *  the student's, and this module has no other dependency on that
   *  service, so it's duplicated here rather than reaching across
   *  modules for one method. */
  private async getCourseTeacherIdWithApiKey(courseId: string): Promise<string> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    const hasKey = await this.llmService.hasApiKey(course.teacherId);
    if (!hasKey) {
      throw new BadRequestException(
        'The course instructor has not configured an LLM API key. Please contact your instructor.',
      );
    }
    return course.teacherId;
  }

  /** Depth of `nodeId` counting from 1 at the root — used to enforce
   *  MAX_TREE_DEPTH (step / substep / sub-substep) wherever a node is
   *  added. `null` (a would-be root) is depth 0. */
  private depthOf(nodeId: string | null, nodes: StepNode[]): number {
    let depth = 0;
    let current = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
    while (current) {
      depth++;
      const parentId: string | null = current.parentId;
      current = parentId ? nodes.find((n) => n.id === parentId) : undefined;
    }
    return depth;
  }

  private collectSubtreeIds(nodeId: string, nodes: StepNode[]): Set<string> {
    const root = nodes.find((n) => n.id === nodeId);
    if (!root) return new Set();
    const ids = new Set<string>([nodeId]);
    let frontier = [nodeId];
    while (frontier.length > 0) {
      const children = nodes.filter((n) => n.parentId && frontier.includes(n.parentId));
      frontier = children.map((c) => c.id).filter((id) => !ids.has(id));
      frontier.forEach((id) => ids.add(id));
    }
    return ids;
  }

  /** Walks the tree in DFS order (siblings sorted by `order`) and emits
   *  one `# <content>` comment line per node, indented by depth, wrapped
   *  in a marker header/footer. Pure string transform, no LLM call — the
   *  student's existing code is kept intact below this block rather than
   *  trying to interleave comments into it, since we have no positional
   *  mapping until `checkMatch` has run at least once. The markers exist
   *  so `stripPriorCommentBlock` can recognize and remove a header this
   *  same action inserted on an earlier run, keeping repeated calls
   *  idempotent instead of stacking duplicate headers. */
  private buildCommentBlock(nodes: StepNode[]): {
    lines: string[];
    nodeLineMap: Record<string, number>;
  } {
    const lines: string[] = [DBOX_COMMENT_BLOCK_START];
    const nodeLineMap: Record<string, number> = {};
    const visit = (parentId: string | null, depth: number) => {
      const children = nodes
        .filter((n) => n.parentId === parentId)
        .sort((a, b) => a.order - b.order);
      for (const child of children) {
        nodeLineMap[child.id] = lines.length;
        lines.push(`${'  '.repeat(depth)}# ${child.content}`);
        visit(child.id, depth + 1);
      }
    };
    visit(null, 0);
    lines.push(DBOX_COMMENT_BLOCK_END);
    return { lines, nodeLineMap };
  }

  /** Removes a `buildCommentBlock` header from the start of `code`, if
   *  one is present, so `copyToComments` can rebuild it fresh rather than
   *  stacking a second copy on top. Returns `code` unchanged if no
   *  DBox-inserted header is found at the very start. */
  private stripPriorCommentBlock(code: string): string {
    if (!code.startsWith(DBOX_COMMENT_BLOCK_START)) return code;
    const endIdx = code.indexOf(DBOX_COMMENT_BLOCK_END);
    if (endIdx === -1) return code;
    const afterEndLineIdx = code.indexOf('\n', endIdx);
    if (afterEndLineIdx === -1) return '';
    let rest = code.slice(afterEndLineIdx + 1);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    return rest;
  }

  /** LLM-estimated line numbers are never guaranteed to be exact — clamp
   *  into the actual document range instead of trusting them outright. */
  private clampLine(line: number | null | undefined, code: string): number | null {
    if (line === null || line === undefined || !Number.isFinite(line)) return null;
    const totalLines = code.split('\n').length;
    return Math.max(0, Math.min(Math.trunc(line), totalLines - 1));
  }

  private parseLlmJson(content: string): unknown {
    let cleaned = content.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) cleaned = jsonMatch[1].trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  private validateInferTreeResponse(
    parsed: unknown,
  ): Array<{ tempId: string; parentTempId: string | null; content: string; order: number }> {
    const data = parsed as { nodes?: unknown[] };
    if (!data?.nodes || !Array.isArray(data.nodes) || data.nodes.length === 0) {
      throw new Error('LLM response missing nodes array');
    }
    return data.nodes.map((raw) => {
      const n = raw as Record<string, unknown>;
      if (typeof n.tempId !== 'string' || typeof n.content !== 'string') {
        throw new Error('Invalid node structure in infer-tree response');
      }
      return {
        tempId: n.tempId,
        parentTempId: typeof n.parentTempId === 'string' ? n.parentTempId : null,
        content: n.content,
        order: typeof n.order === 'number' ? n.order : 0,
      };
    });
  }

  private validateCheckTreeResponse(parsed: unknown): {
    updates: Array<{
      id: string;
      status: 'correct' | 'incorrect' | 'can_be_divided';
      llmFeedback: string | null;
    }>;
    missingNodes: Array<{ parentId: string | null; order: number }>;
  } {
    const data = parsed as { updates?: unknown[]; missingNodes?: unknown[] };
    if (!Array.isArray(data?.updates) || !Array.isArray(data?.missingNodes)) {
      throw new Error('LLM response missing updates/missingNodes arrays');
    }
    const validStatuses = new Set(['correct', 'incorrect', 'can_be_divided']);
    const updates = data.updates.map((raw) => {
      const u = raw as Record<string, unknown>;
      if (
        typeof u.id !== 'string' ||
        typeof u.status !== 'string' ||
        !validStatuses.has(u.status)
      ) {
        throw new Error('Invalid update structure in check-tree response');
      }
      return {
        id: u.id,
        status: u.status as 'correct' | 'incorrect' | 'can_be_divided',
        llmFeedback: typeof u.llmFeedback === 'string' ? u.llmFeedback : null,
      };
    });
    // Deliberately ignore any "content" the LLM sends here even though the
    // schema no longer asks for it — position only, never description, so
    // a missing step is never revealed to the student.
    const missingNodes = data.missingNodes.map((raw) => {
      const m = raw as Record<string, unknown>;
      return {
        parentId: typeof m.parentId === 'string' ? m.parentId : null,
        order: typeof m.order === 'number' ? m.order : 0,
      };
    });
    return { updates, missingNodes };
  }

  private validateCheckMatchResponse(parsed: unknown): {
    updates: Array<{
      id: string;
      status: 'implemented' | 'incorrectly_implemented' | 'to_be_coded';
      llmFeedback: string | null;
      startLine: number | null;
      endLine: number | null;
    }>;
  } {
    const data = parsed as { updates?: unknown[] };
    if (!Array.isArray(data?.updates)) {
      throw new Error('LLM response missing updates array');
    }
    const validStatuses = new Set(['implemented', 'incorrectly_implemented', 'to_be_coded']);
    const updates = data.updates.map((raw) => {
      const u = raw as Record<string, unknown>;
      if (
        typeof u.id !== 'string' ||
        typeof u.status !== 'string' ||
        !validStatuses.has(u.status)
      ) {
        throw new Error('Invalid update structure in check-match response');
      }
      return {
        id: u.id,
        status: u.status as 'implemented' | 'incorrectly_implemented' | 'to_be_coded',
        llmFeedback: typeof u.llmFeedback === 'string' ? u.llmFeedback : null,
        startLine: typeof u.startLine === 'number' ? u.startLine : null,
        endLine: typeof u.endLine === 'number' ? u.endLine : null,
      };
    });
    return { updates };
  }
}
