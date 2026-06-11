/**
 * Seed: CS 601 — AI and Uncertainty Reasoning pre-study assessment.
 *
 * Creates:
 *   1. A default teacher/admin account if none exists (env: SEED_ADMIN_EMAIL,
 *      SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME — see defaults below).
 *   2. A course "CS 601 — AI and Uncertainty Reasoning" (if absent).
 *   3. 36 questions — Q1 (MCQ_SINGLE), Q2 (MCQ_MULTI), Q3a (MCQ_SINGLE),
 *      Q3b (MCQ_SINGLE) for each of the 9 topics.
 *   4. One assessment "Pre-study Assessment" with all 36 questions.
 *
 * This script is idempotent: re-running it is safe and will skip
 * already-existing records (unless --force is passed).
 *
 * Run manually:
 *   pnpm --filter @ats/api exec tsx prisma/scripts/seed-cs601-assessment.ts
 *
 * Options:
 *   --teacher-email=<email>   use a specific teacher account (defaults to first teacher found)
 *   --dry-run                 print what would be created without touching the DB
 *   --force                   re-create assessment even if it already exists
 */

import { PrismaClient, QuestionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const teacherEmail = args.find((a) => a.startsWith('--teacher-email='))?.split('=')[1];
const courseTitle = args
  .find((a) => a.startsWith('--course-title='))
  ?.split('=')
  .slice(1)
  .join('=');
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawOption {
  text: string;
  isCorrect: boolean;
}

interface RawQuestion {
  topic: string;
  topicIndex: number; // 1-9
  label: string; // Q1 / Q2 / Q3a / Q3b
  type: 'MCQ_SINGLE' | 'MCQ_MULTI';
  points: number;
  prompt: string;
  options: RawOption[];
  /** Plain-text worked solution shown to teacher. */
  solution: string;
  bloomsLevel: string;
  difficulty: number;
}

function buildOptions(raw: RawOption[]): { id: string; text: string; isCorrect: boolean }[] {
  return raw.map((o) => ({ id: randomUUID(), text: o.text, isCorrect: o.isCorrect }));
}

// ---------------------------------------------------------------------------
// Question bank — 9 topics × 4 sub-questions = 36 questions
// ---------------------------------------------------------------------------

const QUESTION_BANK: RawQuestion[] = [
  // ========================================================================
  // Topic 1 — Probabilistic Reasoning
  // ========================================================================
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A probability distribution is defined over an outcome space Ω — the set of all possible outcomes, where a single outcome is written ω. How is a valid probability assigned to it?',
    options: [
      {
        text: 'Each outcome may take a negative probability provided the values sum to 1.',
        isCorrect: false,
      },
      {
        text: 'Each outcome satisfies p(ω) ≥ 0 and the probabilities of all outcomes sum to 1: Σ p(ω) = 1.',
        isCorrect: true,
      },
      {
        text: 'The probability of an event is the product of the probabilities of the outcomes it contains.',
        isCorrect: false,
      },
      { text: 'Probabilities represent the ground truth about the world.', isCorrect: false },
    ],
    solution:
      "A distribution requires p(ω) ≥ 0 and Σ p(ω) = 1; an event's probability is the sum (not product) of its outcomes' probabilities.",
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL statements that are consistent with the standard rules of probability.',
    options: [
      { text: 'Chain rule: P(X,Y) = P(X)P(Y|X) = P(Y)P(X|Y).', isCorrect: true },
      { text: 'Bayes rule: P(X|Y) = P(Y|X)P(X) / P(Y).', isCorrect: true },
      { text: 'If X and Y are independent, then P(X,Y) = P(X)P(Y).', isCorrect: true },
      { text: 'Marginalization: P(X=x) = Σ_y P(X=x, Y=y).', isCorrect: true },
      {
        text: 'If X and Y are conditionally independent given Z, then P(X,Y|Z) = P(X|Z) + P(Y|Z).',
        isCorrect: false,
      },
      { text: 'Conditional probability: P(X=x|Y=y) = P(X=x, Y=y) / P(Y=y).', isCorrect: true },
    ],
    solution:
      'Correct: A, B, C, D, F. Option E is false — conditional independence gives a product, not a sum: P(X,Y|Z) = P(X|Z)P(Y|Z).',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A parcel company ships via Courier A, B, or C with probabilities 0.30, 0.45, and 0.25. A delivery is late with probability 6% for A, 2% for B, and 8% for C. Which expression correctly gives the overall probability P(late)?',
    options: [
      { text: '0.30(0.06) + 0.45(0.02) + 0.25(0.08)', isCorrect: true },
      { text: '0.30 + 0.45 + 0.25', isCorrect: false },
      { text: '0.06 + 0.02 + 0.08', isCorrect: false },
      { text: '0.30(0.06) × 0.45(0.02) × 0.25(0.08)', isCorrect: false },
    ],
    solution: 'Law of total probability: P(late) = 0.018 + 0.009 + 0.020 = 0.047.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'Using P(late) = 0.047 (from the previous part), which expression gives P(Courier C | late) and what is its value?',
    options: [
      { text: '0.25(0.08) / 0.047 ≈ 0.43', isCorrect: true },
      { text: '0.047 / [0.25(0.08)] ≈ 2.35', isCorrect: false },
      { text: '0.25(0.08) × 0.047 ≈ 0.001', isCorrect: false },
      { text: '0.25 / 0.047 ≈ 5.32', isCorrect: false },
    ],
    solution: 'Bayes rule: P(C|late) = P(late|C)P(C) / P(late) = 0.020 / 0.047 ≈ 0.43.',
    bloomsLevel: 'apply',
    difficulty: 3,
  },

  // ========================================================================
  // Topic 2 — Bayesian Network: Representation
  // ========================================================================
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'By the Local Markov Property, a variable X is independent of which set, given its parents?',
    options: [
      { text: 'Its descendants.', isCorrect: false },
      { text: 'Its children.', isCorrect: false },
      { text: 'Its non-descendants.', isCorrect: true },
      { text: 'All other variables in the network.', isCorrect: false },
    ],
    solution: 'X ⊥ NonDescendants(X) | Parents(X) — the Local Markov Property.',
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about Bayesian networks.',
    options: [
      {
        text: 'A Bayesian network is represented using a directed acyclic graph (DAG).',
        isCorrect: true,
      },
      {
        text: 'The joint distribution factorizes as P(X1,…,Xn) = ∏ P(Xi | Parents(Xi)).',
        isCorrect: true,
      },
      {
        text: 'For n binary variables the full joint-probability table has size 2^n.',
        isCorrect: true,
      },
      {
        text: "A node's Markov blanket is its parents, its children, and its children's parents.",
        isCorrect: true,
      },
      {
        text: 'In a v-structure X→Z←Y, X and Y do not influence each other when Z is unobserved.',
        isCorrect: true,
      },
      {
        text: 'A Bayesian network can represent independencies but not dependencies among variables.',
        isCorrect: false,
      },
    ],
    solution:
      'Correct: A, B, C, D, E. F is false — the graph encodes both independencies and dependencies.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'For the Bayes net F→S←A, S→H, S→N (Flu and Allergy cause Sinus inflammation, which causes Headache and RunnyNose), given P(F=0)=0.9, P(A=0)=0.85, P(S=0|F=0,A=0)=0.95, P(H=0|S=0)=0.8, P(N=0|S=0)=0.7, which expression correctly gives the joint P(F=0,A=0,S=0,H=0,N=0)?',
    options: [
      { text: 'P(F=0) · P(A=0) · P(S=0|F=0,A=0) · P(H=0|S=0) · P(N=0|S=0)', isCorrect: true },
      { text: 'P(F=0) + P(A=0) + P(S=0|F=0,A=0) + P(H=0|S=0) + P(N=0|S=0)', isCorrect: false },
      { text: 'P(S=0|F=0,A=0) · P(H=0|S=0) · P(N=0|S=0)', isCorrect: false },
      { text: 'P(F=0) · P(A=0)', isCorrect: false },
    ],
    solution: 'Product of all five conditional factors — chain rule along the DAG.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: 'The product 0.9 × 0.85 × 0.95 × 0.8 × 0.7 is closest to:',
    options: [
      { text: '0.41', isCorrect: true },
      { text: '0.73', isCorrect: false },
      { text: '0.50', isCorrect: false },
      { text: '0.05', isCorrect: false },
    ],
    solution: 'Exactly 0.40698 ≈ 0.41.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },

  // ========================================================================
  // Topic 3 — Bayesian Network: Inference
  // ========================================================================
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'What is the main advantage of Variable Elimination (VE) over building the full joint-probability table for inference?',
    options: [
      { text: 'VE always runs in constant time regardless of the network.', isCorrect: false },
      {
        text: 'VE avoids constructing the entire joint distribution table and exploits the conditional independences present in the network.',
        isCorrect: true,
      },
      { text: 'VE first builds the full joint table and then simplifies it.', isCorrect: false },
      { text: 'VE works only when all variables are mutually independent.', isCorrect: false },
    ],
    solution: 'VE reuses intermediate factors and never materialises the full joint.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about the inference procedure and its complexity.',
    options: [
      {
        text: 'The naïve solution constructs the joint distribution, inserts the evidence, marginalizes, then normalizes (conditions).',
        isCorrect: true,
      },
      {
        text: 'Building the full joint distribution is exponential in the number of variables, O(2^n).',
        isCorrect: true,
      },
      {
        text: 'For a chain network with n binary variables, VE reduces the cost from exponential to linear in n.',
        isCorrect: true,
      },
      {
        text: 'The cost of VE is always linear in the number of variables, regardless of structure.',
        isCorrect: false,
      },
      {
        text: "VE's cost is exponential in the number of variables in the largest intermediate factor/table.",
        isCorrect: true,
      },
      {
        text: 'Normalizing (conditioning) divides by the probability of the evidence.',
        isCorrect: true,
      },
    ],
    solution:
      'Correct: A, B, C, E, F. D is false — VE cost depends on the largest intermediate factor, not always linear.',
    bloomsLevel: 'understand',
    difficulty: 3,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A disease D has P(D=present)=0.2. P(Fever=yes|present)=0.8, P(Fever=yes|absent)=0.1; P(Cough=yes|present)=0.7, P(Cough=yes|absent)=0.2. Both symptoms depend only on D. Which expression correctly gives the joint P(Fever=yes, Cough=yes) after marginalizing over D?',
    options: [
      { text: '0.2(0.8)(0.7) + 0.8(0.1)(0.2)', isCorrect: true },
      { text: '0.8(0.7) + 0.1(0.2)', isCorrect: false },
      { text: '0.2(0.8)(0.8)(0.1)(0.7)(0.2)', isCorrect: false },
      { text: '0.7 × 0.2', isCorrect: false },
    ],
    solution: 'Sum over D of the products: 0.112 + 0.016 = 0.128.',
    bloomsLevel: 'apply',
    difficulty: 3,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'Given P(Fever=yes, Cough=yes)=0.128 and P(Fever=yes, Cough=no)=0.112, which expression gives P(Cough=yes | Fever=yes) and what is its value?',
    options: [
      { text: '0.128 / (0.128 + 0.112) ≈ 0.53', isCorrect: true },
      { text: '0.112 / (0.128 + 0.112) ≈ 0.47', isCorrect: false },
      { text: '0.128 × (0.128 + 0.112) ≈ 0.03', isCorrect: false },
      { text: '0.128 (no normalization)', isCorrect: false },
    ],
    solution: 'Normalize by P(Fever=yes) = 0.240: 0.128 / 0.240 ≈ 0.53.',
    bloomsLevel: 'apply',
    difficulty: 3,
  },

  // ========================================================================
  // Topic 4 — Markov Decision Processes
  // ========================================================================
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: "In the MDP tuple ⟨S, A, P, R⟩, what does P(s'|s,a) represent?",
    options: [
      { text: 'The reward of taking action a in state s.', isCorrect: false },
      {
        text: "The probability of transitioning to state s' from s on taking action a.",
        isCorrect: true,
      },
      { text: 'The policy that selects an action in each state.', isCorrect: false },
      { text: "The discounted value of state s'.", isCorrect: false },
    ],
    solution: "P is the transition model; R(s,a,s') is the reward.",
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about MDPs.',
    options: [
      {
        text: 'The Markov assumption: given the present state, the future and the past are independent.',
        isCorrect: true,
      },
      { text: 'The Bellman equation gives V(s) = max_a Q(s,a).', isCorrect: true },
      {
        text: 'With discount factor γ, the value of rewards decays exponentially.',
        isCorrect: true,
      },
      {
        text: 'Policy iteration converges in fewer iterations than value iteration, but each iteration is more expensive.',
        isCorrect: true,
      },
      {
        text: 'Value iteration computes the policy explicitly while updating the values implicitly.',
        isCorrect: false,
      },
      { text: "Q(s,a) = Σ_{s'} P(s'|s,a) [R(s,a,s') + γV(s')].", isCorrect: true },
    ],
    solution:
      'Correct: A, B, C, D, F. E is false — value iteration updates values explicitly, policy implicitly.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A dispatcher picks one of two delivery routes. Route X earns +80 if on time (prob. 0.6) and -30 if late (prob. 0.4). Which expression correctly gives the expected utility of Route X?',
    options: [
      { text: '0.6(80) + 0.4(-30)', isCorrect: true },
      { text: '0.6 + 0.4 + 80 - 30', isCorrect: false },
      { text: '0.6(80) × 0.4(-30)', isCorrect: false },
      { text: '[80 + (-30)] / 2', isCorrect: false },
    ],
    solution: 'Expected utility = Σ Pr(Oj)U(Oj) = 48 - 12 = 36.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'Given EU(X)=36 and EU(Y)=0.5(120)+0.5(-40)=40 (Route Y: +120 if on time prob. 0.5, -40 if late prob. 0.5), which route should be chosen?',
    options: [
      { text: 'Route Y, because its expected utility 40 > 36.', isCorrect: true },
      { text: 'Route X, because its expected utility 36 > 40.', isCorrect: false },
      { text: 'Route X, because it risks the smaller loss (-30 vs -40).', isCorrect: false },
      { text: 'Either; the expected utilities are equal.', isCorrect: false },
    ],
    solution: 'Route Y — the maximum-expected-utility action (40 > 36).',
    bloomsLevel: 'apply',
    difficulty: 2,
  },

  // ========================================================================
  // Topic 5 — Reinforcement Learning
  // ========================================================================
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: 'How does reinforcement learning (RL) differ from a standard MDP?',
    options: [
      {
        text: 'In RL the transition probability P and the reward function R are not given.',
        isCorrect: true,
      },
      { text: 'In RL the state space must always be small and discrete.', isCorrect: false },
      { text: 'RL requires the full joint-probability table.', isCorrect: false },
      { text: 'RL cannot handle continuous state spaces.', isCorrect: false },
    ],
    solution: 'RL learns from experience when P and R are unknown.',
    bloomsLevel: 'understand',
    difficulty: 1,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about RL exploration and learning methods.',
    options: [
      {
        text: 'ε-greedy chooses the apparent best action with probability 1-ε and a random action with probability ε.',
        isCorrect: true,
      },
      {
        text: 'The greedy strategy fully exploits the current estimate and never explores.',
        isCorrect: true,
      },
      {
        text: "Q-learning's update uses the maximum Q-value over next actions (off-policy).",
        isCorrect: true,
      },
      {
        text: 'Sarsa updates using the Q-value of the action actually chosen next (on-policy).',
        isCorrect: true,
      },
      {
        text: 'Monte Carlo methods update using the accumulated return G_t over a full episode.',
        isCorrect: true,
      },
      {
        text: 'Temporal-difference methods can update only after a complete episode ends.',
        isCorrect: false,
      },
    ],
    solution:
      'Correct: A, B, C, D, E. F is false — TD updates after every step, not only at episode end.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      "An agent has Q(s,a)=2, observes reward r=5, next-state max Q(s',a')=10, learning rate α=0.1, discount γ=0.9. Which expression is the correct Q-learning update for Q_new(s,a)?",
    options: [
      { text: "Q(s,a) + α[r + γ max Q(s',a') - Q(s,a)]", isCorrect: true },
      { text: "Q(s,a) + α[r + γ max Q(s',a')]", isCorrect: false },
      { text: "r + γ max Q(s',a')", isCorrect: false },
      { text: "Q(s,a) + α[r - γ max Q(s',a') - Q(s,a)]", isCorrect: false },
    ],
    solution: 'The temporal-difference update: target minus current Q, scaled by α.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      "Substituting Q(s,a)=2, α=0.1, r=5, γ=0.9, max Q(s',a')=10 into the Q-learning update: 2 + 0.1[5 + 0.9(10) - 2] equals:",
    options: [
      { text: '3.2', isCorrect: true },
      { text: '1.2', isCorrect: false },
      { text: '14', isCorrect: false },
      { text: '2.0', isCorrect: false },
    ],
    solution: 'Target = 5 + 9 = 14, TD error = 14 - 2 = 12, update = 2 + 0.1(12) = 3.2.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },

  // ========================================================================
  // Topic 6 — Heuristic Search
  // ========================================================================
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: 'An admissible heuristic is one that:',
    options: [
      { text: 'always overestimates the true cost to reach the goal.', isCorrect: false },
      { text: 'never overestimates the true cost of reaching the goal.', isCorrect: true },
      { text: 'equals zero for every state.', isCorrect: false },
      { text: 'always equals the actual cost to the goal.', isCorrect: false },
    ],
    solution: 'It never overestimates the true cost-to-goal.',
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about these search algorithms.',
    options: [
      { text: 'BFS uses a queue and is guaranteed to find the shallowest path.', isCorrect: true },
      {
        text: 'DFS uses a stack and may not complete if it enters an unbounded branch.',
        isCorrect: true,
      },
      {
        text: 'BFS-Optimal uses a priority queue ordered by path cost from the start and is guaranteed to find the optimal solution.',
        isCorrect: true,
      },
      {
        text: 'Best-First (greedy) search prioritizes nodes by the heuristic estimate to the goal and is not optimal.',
        isCorrect: true,
      },
      { text: 'A* search expands nodes by f(n) = g(n) + h(n).', isCorrect: true },
      {
        text: 'Best-First (greedy) search is always guaranteed to find the least-cost path.',
        isCorrect: false,
      },
    ],
    solution: 'Correct: A, B, C, D, E. F is false — Best-First is greedy and not optimal.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A graph has undirected edge costs S–A=2, S–B=5, A–C=3, B–C=1, C–G=3, A–G=9, B–G=6. Which expression correctly gives the cost of the path S→A→C→G?',
    options: [
      { text: '2 + 3 + 3', isCorrect: true },
      { text: '2 × 3 × 3', isCorrect: false },
      { text: 'max(2, 3, 3)', isCorrect: false },
      { text: '2 + 3 + 3 + 1', isCorrect: false },
    ],
    solution: 'Sum of the edge costs along the path = 8.',
    bloomsLevel: 'apply',
    difficulty: 1,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'The simple paths from S to G cost: S→A→C→G=8, S→B→C→G=9, S→A→G=11, S→B→G=11. The least-cost path from S to G is:',
    options: [
      { text: 'S→A→C→G, cost 8', isCorrect: true },
      { text: 'S→B→C→G, cost 9', isCorrect: false },
      { text: 'S→A→G, cost 11', isCorrect: false },
      { text: 'S→B→G, cost 11', isCorrect: false },
    ],
    solution: 'S→A→C→G with cost 8 is the minimum.',
    bloomsLevel: 'apply',
    difficulty: 1,
  },

  // ========================================================================
  // Topic 7 — Deep Q-learning
  // ========================================================================
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: 'What is the role of experience replay in DQN?',
    options: [
      {
        text: 'It stores past transitions and samples them randomly, breaking the correlations between consecutive samples.',
        isCorrect: true,
      },
      {
        text: 'It increases the correlation between consecutive training samples.',
        isCorrect: false,
      },
      { text: 'It removes the need for any reward signal.', isCorrect: false },
      {
        text: 'It replaces the convolutional neural network with a lookup table.',
        isCorrect: false,
      },
    ],
    solution: 'Random sampling decorrelates samples and stabilizes training.',
    bloomsLevel: 'understand',
    difficulty: 1,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about Deep Q-learning (DQN).',
    options: [
      {
        text: 'DQN uses a convolutional neural network trained with a variant of Q-learning.',
        isCorrect: true,
      },
      {
        text: 'The input is raw pixels and the output is an action-value function estimating future rewards.',
        isCorrect: true,
      },
      {
        text: 'A separate target Q-network is used, whose weights are periodically reset to equal the Q-network every C steps.',
        isCorrect: true,
      },
      {
        text: 'Experience replay lets each experience be reused in many weight updates, improving data efficiency.',
        isCorrect: true,
      },
      {
        text: 'Double DQN was introduced to reduce the overestimation (maximization) bias.',
        isCorrect: true,
      },
      {
        text: 'DQN requires a fixed i.i.d. labeled dataset, exactly like supervised learning.',
        isCorrect: false,
      },
    ],
    solution:
      'Correct: A, B, C, D, E. F is false — DQN learns from sparse, delayed rewards over correlated, shifting data.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      "A DQN agent scores 600 on a game; random play scores 200 and a human scores 1000. Which expression correctly gives the agent's normalized performance (in %)?",
    options: [
      { text: '100 × (DQN − random) / (human − random)', isCorrect: true },
      { text: '100 × (DQN / human)', isCorrect: false },
      { text: '100 × (DQN − human) / (random − human)', isCorrect: false },
      { text: '100 × (human − DQN) / (human − random)', isCorrect: false },
    ],
    solution:
      'Progress from random (0%) to human (100%): measures how much of the human–random gap was closed.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: 'Substituting DQN=600, random=200, human=1000: 100 × (600−200) / (1000−200) equals:',
    options: [
      { text: '50%', isCorrect: true },
      { text: '40%', isCorrect: false },
      { text: '60%', isCorrect: false },
      { text: '75%', isCorrect: false },
    ],
    solution: '100 × 400/800 = 50%.',
    bloomsLevel: 'apply',
    difficulty: 1,
  },

  // ========================================================================
  // Topic 8 — Policy Learning
  // ========================================================================
  {
    topic: 'Policy Learning',
    topicIndex: 8,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'In the policy-gradient method REINFORCE, which quantity is used as the target signal in the parameter update?',
    options: [
      { text: "The transition probability P(s'|s,a).", isCorrect: false },
      {
        text: 'The complete return G_t from time t until the end of the episode.',
        isCorrect: true,
      },
      { text: "The reward model's preference score.", isCorrect: false },
      { text: 'A single Q-value table entry.', isCorrect: false },
    ],
    solution: 'REINFORCE scales each update by the episode return G_t.',
    bloomsLevel: 'understand',
    difficulty: 1,
  },
  {
    topic: 'Policy Learning',
    topicIndex: 8,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about policy-gradient methods.',
    options: [
      { text: 'The policy π_θ(a|s) must be differentiable with respect to θ.', isCorrect: true },
      { text: 'J(θ) measures the expected sum of discounted rewards.', isCorrect: true },
      {
        text: 'REINFORCE is a Monte Carlo algorithm, well defined for the episodic case with updates made after the episode completes.',
        isCorrect: true,
      },
      {
        text: "Subtracting a baseline b(s) that does not depend on the action leaves the gradient's expectation unchanged.",
        isCorrect: true,
      },
      {
        text: 'The advantage q_π(s,a) − v_π(s) is positive for actions that improve on the current policy.',
        isCorrect: true,
      },
      {
        text: "The policy-gradient theorem requires knowing the transition function p(s'|s,a).",
        isCorrect: false,
      },
    ],
    solution:
      "Correct: A, B, C, D, E. F is false — the theorem evaluates ∇_θ J(θ) without p(s'|s,a).",
    bloomsLevel: 'understand',
    difficulty: 3,
  },
  {
    topic: 'Policy Learning',
    topicIndex: 8,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'A REINFORCE-with-baseline update uses θ_t=0.5, α=0.1, return G_t=10, baseline b(S_t)=7, ∇_θ ln π_θ(A_t|S_t)=2. Which expression is the correct update for θ_{t+1}?',
    options: [
      { text: 'θ_t + α(G_t − b(S_t)) ∇_θ ln π_θ(A_t|S_t)', isCorrect: true },
      { text: 'θ_t + α G_t ∇_θ ln π_θ(A_t|S_t)', isCorrect: false },
      { text: 'θ_t + α(G_t + b(S_t)) ∇_θ ln π_θ(A_t|S_t)', isCorrect: false },
      { text: 'θ_t − α(G_t − b(S_t)) ∇_θ ln π_θ(A_t|S_t)', isCorrect: false },
    ],
    solution: 'Ascend the gradient, weighted by the baseline-adjusted return (G_t − b).',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Policy Learning',
    topicIndex: 8,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'Substituting θ_t=0.5, α=0.1, G_t=10, b(S_t)=7, ∇_θ ln π=2 into the REINFORCE-with-baseline update: 0.5 + 0.1(10−7)(2) equals:',
    options: [
      { text: '1.1', isCorrect: true },
      { text: '0.6', isCorrect: false },
      { text: '1.6', isCorrect: false },
      { text: '6.5', isCorrect: false },
    ],
    solution: '0.5 + 0.1(3)(2) = 0.5 + 0.6 = 1.1.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },

  // ========================================================================
  // Topic 9 — RL for Large Language Models
  // ========================================================================
  {
    topic: 'RL for Large Language Models',
    topicIndex: 9,
    label: 'Q1',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: 'What are the three stages of building a large language model, in order?',
    options: [
      { text: 'Reward modeling → pre-training → fine-tuning.', isCorrect: false },
      {
        text: 'Pre-training → supervised fine-tuning → alignment with human preferences.',
        isCorrect: true,
      },
      {
        text: 'Alignment with human preferences → pre-training → supervised fine-tuning.',
        isCorrect: false,
      },
      { text: 'Supervised fine-tuning → pre-training → reward modeling.', isCorrect: false },
    ],
    solution:
      'Pre-training builds general language ability; supervised fine-tuning teaches instruction following; the final stage aligns the model to human preferences.',
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'RL for Large Language Models',
    topicIndex: 9,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt:
      'Select ALL correct statements about how a large language model is aligned to human feedback after pre-training. (KL-divergence measures difference between distributions; Bradley–Terry model turns pairwise preferences into numerical scores.)',
    options: [
      {
        text: 'A reward model is trained to predict a human preference score and serves as a proxy for environment rewards.',
        isCorrect: true,
      },
      {
        text: 'Proximal Policy Optimization (PPO) adds a KL-divergence penalty to keep the policy close to the reference (supervised fine-tuned) model.',
        isCorrect: true,
      },
      {
        text: 'Group Relative Policy Optimization (GRPO) removes the value function and estimates advantages from a group of sampled responses.',
        isCorrect: true,
      },
      {
        text: 'Direct Preference Optimization (DPO) trains a separate reward model explicitly before optimizing the policy.',
        isCorrect: false,
      },
      {
        text: 'The reward model is trained by minimizing the negative log-likelihood under a Bradley–Terry preference model.',
        isCorrect: true,
      },
      {
        text: 'GRPO samples multiple responses per prompt, whereas PPO samples one response per prompt.',
        isCorrect: true,
      },
    ],
    solution: 'Correct: A, B, C, E, F. D is false — DPO uses no explicit reward model.',
    bloomsLevel: 'understand',
    difficulty: 3,
  },
  {
    topic: 'RL for Large Language Models',
    topicIndex: 9,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt:
      'For one prompt, GRPO samples four responses earning rewards {2, 4, 6, 8} (mean=5, population std≈2.24). Which expression correctly gives the GRPO group-relative advantage Â_i of response i?',
    options: [
      { text: '(r_i − mean({r_j})) / std({r_j})', isCorrect: true },
      { text: 'r_i − mean({r_j})', isCorrect: false },
      { text: 'r_i − mean({r_j})) / mean({r_j})', isCorrect: false },
      { text: 'r_i / std({r_j})', isCorrect: false },
    ],
    solution: 'Centre by the group mean, scale by the group standard deviation.',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'RL for Large Language Models',
    topicIndex: 9,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt:
      'For the response with reward r_i=8 (mean=5, std≈2.24), the advantage (8−5)/2.24 = 3/2.24 is closest to:',
    options: [
      { text: '1.34', isCorrect: true },
      { text: '0.45', isCorrect: false },
      { text: '2.24', isCorrect: false },
      { text: '0.67', isCorrect: false },
    ],
    solution: '1.34 — a positive advantage (this response beats the group average).',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] Seed: CS 601 assessment' : 'Seed: CS 601 assessment');

  // ── 1. Find (or create) teacher ──────────────────────────────────────────
  const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@gals.local';
  const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234!';
  const SEED_NAME = process.env.SEED_ADMIN_NAME ?? 'GALS Admin';

  let teacher: { id: string; email: string; name: string };
  if (teacherEmail) {
    const found = await prisma.user.findUnique({ where: { email: teacherEmail } });
    if (!found) throw new Error(`No user found with email "${teacherEmail}"`);
    teacher = found;
  } else {
    const found = await prisma.user.findFirst({
      where: { role: { in: ['teacher', 'admin'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (found) {
      teacher = found;
    } else {
      console.log(`  No teacher found — creating default admin account: ${SEED_EMAIL}`);
      if (!DRY_RUN) {
        const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
        teacher = await prisma.user.create({
          data: {
            email: SEED_EMAIL,
            name: SEED_NAME,
            passwordHash,
            role: 'admin',
          },
        });
        console.log(`  Default admin created (password: ${SEED_PASSWORD})`);
        console.log('  ⚠  Change this password after first login!');
      } else {
        teacher = { id: 'DRY_RUN_TEACHER_ID', email: SEED_EMAIL, name: SEED_NAME };
      }
    }
  }
  console.log(`  Teacher: ${teacher.name} <${teacher.email}>`);

  // ── 2. Course ────────────────────────────────────────────────────────────
  // If --course-title is given, use the existing course with that exact title.
  // Otherwise fall back to finding/creating the default "CS 601" course.
  const COURSE_TITLE = courseTitle ?? 'CS 601 — AI and Uncertainty Reasoning';
  let existingCourse = await prisma.course.findFirst({ where: { title: COURSE_TITLE } });

  if (existingCourse) {
    console.log(`  Using course "${COURSE_TITLE}": ${existingCourse.id}`);
  } else if (courseTitle) {
    throw new Error(
      `Course "${courseTitle}" not found. Check the title matches exactly (case-sensitive).`,
    );
  } else {
    console.log(`  Creating course "${COURSE_TITLE}"…`);
    if (!DRY_RUN) {
      existingCourse = await prisma.course.create({
        data: {
          title: COURSE_TITLE,
          description:
            'Per-topic pre-study assessment covering 9 topics in AI and Uncertainty Reasoning.',
          teacherId: teacher.id,
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          allowStudentSelfEnroll: true,
        },
      });
      console.log(`  Course created: ${existingCourse.id}`);
    } else {
      console.log('  [dry-run] Would create course.');
    }
  }

  const courseId = existingCourse?.id ?? 'DRY_RUN_COURSE_ID';

  // ── 3. Assessment (idempotent) ───────────────────────────────────────────
  const ASSESSMENT_TITLE = 'Pre-study Assessment — Version 4';
  let existingAssessment = await prisma.assessment.findFirst({
    where: { courseId, title: ASSESSMENT_TITLE },
  });

  if (existingAssessment && !FORCE) {
    console.log(`  Assessment already exists (${existingAssessment.id}). Use --force to recreate.`);
    return;
  }

  if (existingAssessment && FORCE && !DRY_RUN) {
    console.log('  --force: deleting existing assessment and its questions…');
    await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: existingAssessment.id } });
    await prisma.assessment.delete({ where: { id: existingAssessment.id } });
    existingAssessment = null;
  }

  // ── 4. Create questions ──────────────────────────────────────────────────
  console.log(`  Creating ${QUESTION_BANK.length} questions…`);
  const createdQuestionIds: string[] = [];

  for (const raw of QUESTION_BANK) {
    const options = buildOptions(raw.options);
    const correctOptionId =
      raw.type === 'MCQ_SINGLE' ? (options.find((o) => o.isCorrect)?.id ?? null) : null;

    const data = {
      courseId,
      prompt: `[Topic ${raw.topicIndex}: ${raw.topic}] ${raw.label} — ${raw.prompt}`,
      type: raw.type as QuestionType,
      maxScore: raw.points,
      options: options as object,
      correctOptionId,
      explanation: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: raw.solution }] }],
      },
      difficulty: raw.difficulty,
      bloomsLevel: raw.bloomsLevel,
      status: 'approved',
      createdBy: 'admin',
    };

    if (!DRY_RUN) {
      const q = await prisma.question.create({ data });
      createdQuestionIds.push(q.id);
    } else {
      createdQuestionIds.push(`DRY_RUN_Q_${createdQuestionIds.length + 1}`);
      console.log(`  [dry-run] Would create: ${data.prompt.slice(0, 80)}…`);
    }
  }
  console.log(`  Questions created: ${createdQuestionIds.length}`);

  // ── 5. Create assessment and link questions ──────────────────────────────
  console.log(`  Creating assessment "${ASSESSMENT_TITLE}"…`);

  if (!DRY_RUN) {
    const assessment = await prisma.assessment.create({
      data: {
        courseId,
        title: ASSESSMENT_TITLE,
        description:
          'All-multiple-choice pre-study assessment covering 9 topics: 3 questions per topic (Q1 single-answer, Q2 select-all, Q3 two-part calculation). Total: 36 questions.',
        mode: 'practice',
        isPublished: true,
        settings: {
          showSolutions: true,
          shuffle: false,
        },
      },
    });

    // Link questions to assessment — group by topic section
    const assessmentQuestions = createdQuestionIds.map((questionId, i) => {
      const raw = QUESTION_BANK[i]!;
      return {
        id: randomUUID(),
        assessmentId: assessment.id,
        questionId,
        orderIndex: i,
        points: raw.points,
        section: `Topic ${raw.topicIndex}: ${raw.topic}`,
      };
    });

    await prisma.assessmentQuestion.createMany({ data: assessmentQuestions });

    console.log(`\n  ✓ Assessment created: ${assessment.id}`);
    console.log(`  ✓ ${createdQuestionIds.length} questions linked across 9 topic sections`);
    console.log(`  ✓ Course: ${courseId}`);
  } else {
    console.log('[dry-run] Would create assessment and link all questions.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
