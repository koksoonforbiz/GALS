/**
 * Seed: CS 601 — AI and Uncertainty Reasoning POST-study assessment.
 *
 * Parallel form to seed-cs601-assessment.ts (the pre-study seed): identical
 * topic list, identical per-topic structure (Q1 single-answer, Q2 select-all,
 * Q3 two-part calculation) and identical point weights and difficulty/Bloom's
 * tags, so pre/post scores are directly comparable for learning-gain analysis.
 * All questions and numbers are new (source: post-study_assessment.tex).
 *
 * Math is written as inline LaTeX delimited by $...$ so the web client renders
 * it with KaTeX (see apps/web/src/components/MathText.tsx). LaTeX is authored
 * with the `tex` (String.raw) tag so backslashes need no double-escaping.
 *
 * Creates:
 *   1. A default teacher/admin account if none exists (env: SEED_ADMIN_EMAIL,
 *      SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME — see defaults below).
 *   2. Uses the course "CS 601: AI and Uncertainty Reasoning" (creates it if
 *      absent). Override with --course-title=<exact title>.
 *   3. 28 questions — Q1 (MCQ_SINGLE), Q2 (MCQ_MULTI), Q3a (MCQ_SINGLE),
 *      Q3b (MCQ_SINGLE) for each of the 7 topics.
 *   4. One assessment "Post-study Assessment" with all 36 questions.
 *
 * This script is idempotent: re-running it is safe and will skip
 * already-existing records (unless --force is passed).
 *
 * Run manually (from apps/api, with DATABASE_URL set):
 *   node_modules/.bin/ts-node --transpile-only -P tsconfig.json \
 *     prisma/scripts/seed-cs601-post-assessment.ts \
 *     "--course-title=CS 601: AI and Uncertainty Reasoning"
 *
 * Options:
 *   --teacher-email=<email>   use a specific teacher account (defaults to first teacher found)
 *   --course-title=<title>    attach to an existing course with this exact title
 *   --dry-run                 print what would be created without touching the DB
 *   --force                   re-create assessment even if it already exists
 */

import { PrismaClient, QuestionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** String.raw tag: write LaTeX verbatim (no backslash double-escaping). */
const tex = String.raw;

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
  /** Plain-text (LaTeX-bearing) worked solution shown to teacher. */
  solution: string;
  bloomsLevel: string;
  difficulty: number;
}

function buildOptions(raw: RawOption[]): { id: string; text: string; isCorrect: boolean }[] {
  return raw.map((o) => ({ id: randomUUID(), text: o.text, isCorrect: o.isCorrect }));
}

// ---------------------------------------------------------------------------
// Question bank — 7 topics × 4 sub-questions = 28 questions (POST-study form)
// Topics match the pre-study assessment exactly for a valid pre/post comparison.
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
    prompt: tex`For two events $A$ and $B$ with $P(B) > 0$, which equation correctly states Bayes' rule?`,
    options: [
      { text: tex`$P(A \mid B) = P(A)\,P(B)$`, isCorrect: false },
      { text: tex`$P(A \mid B) = P(A,B)\,P(B)$`, isCorrect: false },
      { text: tex`$P(A \mid B) = \dfrac{P(B \mid A)\,P(A)}{P(B)}$`, isCorrect: true },
      { text: tex`$P(A \mid B) = \dfrac{P(B \mid A)}{P(A)}$`, isCorrect: false },
    ],
    solution: tex`Bayes' rule inverts a conditional: $P(A \mid B) = P(B \mid A)\,P(A) / P(B)$.`,
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL statements that follow from the standard rules of probability.',
    options: [
      { text: tex`Product rule: $P(X,Y) = P(X \mid Y)\,P(Y)$.`, isCorrect: true },
      { text: tex`Marginalization: $P(X{=}x) = \sum_{y} P(X{=}x, Y{=}y)$.`, isCorrect: true },
      {
        text: tex`Law of total probability: for a partition $\{B_i\}$, $P(A) = \sum_i P(A \mid B_i)\,P(B_i)$.`,
        isCorrect: true,
      },
      { text: tex`Complement rule: $P(\lnot A) = 1 - P(A)$.`, isCorrect: true },
      {
        text: tex`If $P(A \mid B) = P(A)$, then $A$ and $B$ must be mutually exclusive.`,
        isCorrect: false,
      },
      { text: tex`For any event $A$, $0 \le P(A) \le 1$.`, isCorrect: true },
    ],
    solution: tex`Correct: A, B, C, D, F. Option E is false — $P(A \mid B) = P(A)$ means $A$ and $B$ are independent, not mutually exclusive.`,
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`In a factory, Machine 1 makes 60% of the parts and 3% of its parts are defective; Machine 2 makes the other 40% and 5% of its parts are defective. A part is drawn at random and found defective. Which expression gives the overall probability a part is defective, $P(\text{def})$?`,
    options: [
      { text: tex`$0.60 + 0.40$`, isCorrect: false },
      { text: tex`$0.60(0.03) + 0.40(0.05)$`, isCorrect: true },
      { text: tex`$0.03 + 0.05$`, isCorrect: false },
      { text: tex`$0.60(0.03) \times 0.40(0.05)$`, isCorrect: false },
    ],
    solution: tex`Law of total probability: $P(\text{def}) = 0.018 + 0.020 = 0.038$.`,
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Probabilistic Reasoning',
    topicIndex: 1,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`Using $P(\text{def}) = 0.038$ (from the previous part), which expression gives $P(\text{Machine 2} \mid \text{def})$ and what is its value?`,
    options: [
      { text: tex`$\dfrac{0.038}{0.40(0.05)} \approx 1.90$`, isCorrect: false },
      { text: tex`$\dfrac{0.40}{0.038} \approx 10.5$`, isCorrect: false },
      { text: tex`$\dfrac{0.40(0.05)}{0.038} \approx 0.53$`, isCorrect: true },
      { text: tex`$0.40(0.05) \times 0.038 \approx 0.0008$`, isCorrect: false },
    ],
    solution: tex`Bayes rule: $P(\text{Machine 2} \mid \text{def}) = 0.020 / 0.038 = 0.526 \approx 0.53$.`,
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
      'A node is conditionally independent of all other nodes in the network given which set?',
    options: [
      { text: 'Its Markov blanket.', isCorrect: true },
      { text: 'Its parents and its children only.', isCorrect: false },
      { text: 'Every other node, regardless of structure.', isCorrect: false },
      { text: 'Its ancestors together with its descendants.', isCorrect: false },
    ],
    solution:
      "A node's Markov blanket — its parents, its children, and its children's other parents — shields it from the rest of the network.",
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about Bayesian-network representation.',
    options: [
      {
        text: "The joint factorizes as a product of each node's conditional given its parents.",
        isCorrect: true,
      },
      {
        text: tex`A binary node with $k$ binary parents needs $2^{k}$ independent parameters (one per parent configuration).`,
        isCorrect: true,
      },
      {
        text: 'Adding more edges to a network always lets it represent fewer joint distributions.',
        isCorrect: false,
      },
      {
        text: 'Two networks with different structures can encode the same independencies (they are Markov equivalent).',
        isCorrect: true,
      },
      {
        text: 'A node is independent of its non-descendants given its parents.',
        isCorrect: true,
      },
      {
        text: tex`In general, the joint over $n$ binary variables needs $2^{n} - 1$ free parameters.`,
        isCorrect: true,
      },
    ],
    solution:
      'Correct: A, B, D, E, F. Option C is false — more edges impose fewer independence constraints, so the network can represent more distributions, not fewer.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`Consider the three-node chain $C \to R \to W$ (Cloudy $C$ influences Rain $R$, which influences a Wet lawn $W$), so $P(C,R,W) = P(C)\,P(R \mid C)\,P(W \mid R)$. Given $P(C{=}1){=}0.5$, $P(R{=}1 \mid C{=}1){=}0.8$, and $P(W{=}1 \mid R{=}1){=}0.9$, which expression gives $P(C{=}1, R{=}1, W{=}1)$?`,
    options: [
      { text: tex`$P(C{=}1) + P(R{=}1 \mid C{=}1) + P(W{=}1 \mid R{=}1)$`, isCorrect: false },
      { text: tex`$P(C{=}1) \times P(R{=}1) \times P(W{=}1)$`, isCorrect: false },
      { text: tex`$P(R{=}1 \mid C{=}1) \times P(W{=}1 \mid R{=}1)$`, isCorrect: false },
      {
        text: tex`$P(C{=}1) \times P(R{=}1 \mid C{=}1) \times P(W{=}1 \mid R{=}1)$`,
        isCorrect: true,
      },
    ],
    solution: 'Product of the three chain factors (chain rule along the DAG).',
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Representation',
    topicIndex: 2,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`That product $0.5 \times 0.8 \times 0.9$ equals:`,
    options: [
      { text: tex`$0.36$`, isCorrect: true },
      { text: tex`$0.72$`, isCorrect: false },
      { text: tex`$0.045$`, isCorrect: false },
      { text: tex`$2.2$`, isCorrect: false },
    ],
    solution: tex`$0.36 = 0.5 \times 0.8 \times 0.9$.`,
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
      'Variable elimination is usually far cheaper than enumerating the full joint because it:',
    options: [
      { text: 'always runs in linear time on every possible network.', isCorrect: false },
      { text: 'first builds the complete joint table and then deletes rows.', isCorrect: false },
      { text: 'works only when all variables are mutually independent.', isCorrect: false },
      {
        text: 'sums out variables one at a time, reusing intermediate factors.',
        isCorrect: true,
      },
    ],
    solution:
      'It eliminates variables sequentially and reuses factors, never materializing the full joint.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about Bayesian-network inference.',
    options: [
      {
        text: 'Marginalization sums out variables that are neither queried nor observed.',
        isCorrect: true,
      },
      {
        text: 'Normalizing (conditioning) divides by the probability of the evidence.',
        isCorrect: true,
      },
      {
        text: 'The running time of variable elimination depends on the elimination ordering.',
        isCorrect: true,
      },
      { text: 'Exact inference in general Bayesian networks is NP-hard.', isCorrect: true },
      {
        text: 'Variable elimination reuses intermediate factors rather than rebuilding the joint.',
        isCorrect: true,
      },
      {
        text: 'An optimal elimination ordering can always be found in polynomial time.',
        isCorrect: false,
      },
    ],
    solution:
      'Correct: A, B, C, D, E. Option F is false — finding an optimal elimination ordering is itself NP-hard.',
    bloomsLevel: 'understand',
    difficulty: 3,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`A message is Spam with prior $P(\text{Spam}){=}0.4$. A particular word appears with $P(\text{word} \mid \text{Spam}){=}0.6$ and $P(\text{word} \mid \text{not Spam}){=}0.2$. A message contains the word. Which expression gives $P(\text{word})$ (marginalizing over Spam / not Spam)?`,
    options: [
      { text: tex`$0.6 + 0.2$`, isCorrect: false },
      { text: tex`$0.4(0.6) \times 0.6(0.2)$`, isCorrect: false },
      { text: tex`$0.4(0.6) + 0.6(0.2)$`, isCorrect: true },
      { text: tex`$0.4(0.6)$`, isCorrect: false },
    ],
    solution: tex`Law of total probability: $P(\text{word}) = 0.24 + 0.12 = 0.36$.`,
    bloomsLevel: 'apply',
    difficulty: 3,
  },
  {
    topic: 'Bayesian Network: Inference',
    topicIndex: 3,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`Using $P(\text{word}) = 0.36$, which expression gives $P(\text{Spam} \mid \text{word})$ and what is its value?`,
    options: [
      { text: tex`$\dfrac{0.6(0.2)}{0.36} \approx 0.33$`, isCorrect: false },
      { text: tex`$\dfrac{0.4(0.6)}{0.36} \approx 0.67$`, isCorrect: true },
      { text: tex`$\dfrac{0.36}{0.4(0.6)} \approx 1.5$`, isCorrect: false },
      { text: tex`$\dfrac{0.4}{0.36} \approx 1.11$`, isCorrect: false },
    ],
    solution: tex`Bayes rule: $P(\text{Spam} \mid \text{word}) = 0.24 / 0.36 = 0.667 \approx 0.67$.`,
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
    prompt: tex`What is the role of the discount factor $\gamma \in [0,1)$ in an MDP?`,
    options: [
      { text: 'It sets the probability of taking a random action.', isCorrect: false },
      {
        text: 'It weights immediate rewards more heavily than distant future rewards.',
        isCorrect: true,
      },
      { text: 'It is the learning rate used by value iteration.', isCorrect: false },
      { text: 'It guarantees every reward is positive.', isCorrect: false },
    ],
    solution: tex`$\gamma$ discounts future rewards; smaller $\gamma$ is more short-sighted, and $\gamma < 1$ also keeps the infinite-horizon return finite.`,
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
        text: tex`An optimal policy $\pi^{*}$ picks, in each state, an action that maximizes expected return.`,
        isCorrect: true,
      },
      {
        text: tex`A larger discount factor $\gamma$ makes the agent more short-sighted, ignoring future rewards.`,
        isCorrect: false,
      },
      {
        text: "The Bellman optimality equation relates a state's value to the values of its successor states.",
        isCorrect: true,
      },
      {
        text: 'Value iteration repeatedly applies the Bellman update until the values converge.',
        isCorrect: true,
      },
      {
        text: 'Policy iteration alternates policy evaluation with policy improvement.',
        isCorrect: true,
      },
      { text: tex`$V^{*}(s) = \max_a Q^{*}(s,a)$.`, isCorrect: true },
    ],
    solution: tex`Correct: A, C, D, E, F. Option B is backwards — a larger $\gamma$ makes the agent more far-sighted.`,
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`From state $s$ an agent may take Action 1 or Action 2, with discount $\gamma{=}0.5$. Action 1 gives reward 3 and leads to a state of value $V{=}10$. Action 2 gives reward 6 and leads to a state of value $V{=}2$. Which expression gives the value $Q(s, \text{Action 1})$?`,
    options: [
      { text: tex`$3 + 0.5(10)$`, isCorrect: true },
      { text: tex`$3 \times 0.5 \times 10$`, isCorrect: false },
      { text: tex`$3 + 10$`, isCorrect: false },
      { text: tex`$0.5(3) + 10$`, isCorrect: false },
    ],
    solution: tex`$Q = r + \gamma V(s') = 3 + 0.5(10) = 8$.`,
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Markov Decision Processes',
    topicIndex: 4,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`Since $Q(s, \text{Action 1}){=}8$ and $Q(s, \text{Action 2}){=}6+0.5(2){=}7$, the state value $V(s){=}\max_a Q(s,a)$ and the chosen action are:`,
    options: [
      { text: tex`$7$; choose Action 2.`, isCorrect: false },
      { text: tex`$6.5$; either action.`, isCorrect: false },
      { text: tex`$15$; choose Action 1.`, isCorrect: false },
      { text: tex`$8$; choose Action 1.`, isCorrect: true },
    ],
    solution: tex`$V(s) = 8$, Action 1 — the maximum-value action ($8 > 7$).`,
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
    prompt:
      'What distinguishes an off-policy method such as Q-learning from an on-policy method such as Sarsa?',
    options: [
      {
        text: "Off-policy methods require a full model of the environment's dynamics.",
        isCorrect: false,
      },
      { text: 'On-policy methods never explore.', isCorrect: false },
      {
        text: 'Off-policy methods evaluate one policy while following another.',
        isCorrect: true,
      },
      { text: 'On-policy methods do not use a value function.', isCorrect: false },
    ],
    solution:
      'Q-learning learns about the greedy (target) policy while acting under a different behaviour policy; Sarsa learns about the policy it follows.',
    bloomsLevel: 'understand',
    difficulty: 1,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about reinforcement learning.',
    options: [
      {
        text: 'RL learns from sampled experience when the transition and reward models are unknown.',
        isCorrect: true,
      },
      {
        text: 'Temporal-difference methods update after each step using a bootstrapped estimate.',
        isCorrect: true,
      },
      {
        text: 'Monte Carlo methods wait until an episode ends before updating.',
        isCorrect: true,
      },
      {
        text: tex`Raising $\epsilon$ in $\epsilon$-greedy always increases the final policy's reward.`,
        isCorrect: false,
      },
      { text: 'Q-learning is off-policy, whereas Sarsa is on-policy.', isCorrect: true },
      {
        text: 'The exploration–exploitation trade-off governs how often the agent tries new actions.',
        isCorrect: true,
      },
    ],
    solution: tex`Correct: A, B, C, E, F. Option D is false — too much exploration (large $\epsilon$) can lower performance.`,
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`An agent using Sarsa observes reward $r{=}3$, then in the next state takes the action whose value is $Q(s',a'){=}8$. Currently $Q(s,a){=}4$, with learning rate $\alpha{=}0.5$ and discount $\gamma{=}0.5$. Which expression is the correct Sarsa update for $Q(s,a)$?`,
    options: [
      {
        text: tex`$Q(s,a) + \alpha[\,r + \gamma \max_{a'} Q(s',a') - Q(s,a)\,]$`,
        isCorrect: false,
      },
      { text: tex`$Q(s,a) + \alpha[\,r + \gamma\,Q(s',a')\,]$`, isCorrect: false },
      { text: tex`$Q(s,a) + \alpha[\,r + \gamma\,Q(s',a') - Q(s,a)\,]$`, isCorrect: true },
      { text: tex`$r + \gamma\,Q(s',a')$`, isCorrect: false },
    ],
    solution: tex`Sarsa uses the value of the action actually taken next, $Q(s',a')$, not the $\max$ (that would be Q-learning).`,
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Reinforcement Learning',
    topicIndex: 5,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`Substituting, $4 + 0.5[\,3 + 0.5(8) - 4\,]$ equals:`,
    options: [
      { text: tex`$7.0$`, isCorrect: false },
      { text: tex`$5.5$`, isCorrect: true },
      { text: tex`$3.5$`, isCorrect: false },
      { text: tex`$4.0$`, isCorrect: false },
    ],
    solution: tex`$5.5$ (target $= 3 + 4 = 7$, so $4 + 0.5(7 - 4) = 5.5$).`,
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
    prompt: tex`In A$^{*}$ search with $f(n) = g(n) + h(n)$, what do $g(n)$ and $h(n)$ denote?`,
    options: [
      {
        text: tex`$g$ = cost so far (start $\to n$); $h$ = estimated cost to go ($n \to$ goal).`,
        isCorrect: true,
      },
      {
        text: tex`$g$ = estimated cost to the goal; $h$ = the exact cost already paid from the start.`,
        isCorrect: false,
      },
      { text: 'Both are always equal to zero.', isCorrect: false },
      { text: tex`$g$ = the goal depth; $h$ = the branching factor.`, isCorrect: false },
    ],
    solution: tex`$g$ is the known cost from the start; $h$ estimates the remaining cost to the goal.`,
    bloomsLevel: 'remember',
    difficulty: 1,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about search algorithms.',
    options: [
      {
        text: 'Greedy best-first search always returns the least-cost path to the goal.',
        isCorrect: false,
      },
      {
        text: tex`A$^{*}$ is optimal when the heuristic is admissible (and, for graph search, consistent).`,
        isCorrect: true,
      },
      {
        text: 'Breadth-first search is complete and finds the shallowest goal.',
        isCorrect: true,
      },
      { text: 'A consistent heuristic is also admissible.', isCorrect: true },
      {
        text: tex`Uniform-cost search expands nodes in order of path cost $g(n)$.`,
        isCorrect: true,
      },
      {
        text: tex`Setting $h(n) = 0$ for all $n$ turns A$^{*}$ into uniform-cost search.`,
        isCorrect: true,
      },
    ],
    solution: tex`Correct: B, C, D, E, F. Option A is false — greedy best-first search is not optimal; it follows $h$ alone and can miss the cheapest path.`,
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`During an A$^{*}$ search, three nodes sit on the frontier with these cost-so-far $g$ and heuristic $h$ values: node $A$ has $g{=}2,\ h{=}6$; node $B$ has $g{=}4,\ h{=}3$; node $C$ has $g{=}5,\ h{=}5$. Which expression gives $f(B)$?`,
    options: [
      { text: tex`$4 \times 3$`, isCorrect: false },
      { text: tex`$4 + 3$`, isCorrect: true },
      { text: tex`$\max(4, 3)$`, isCorrect: false },
      { text: tex`$4 + 3 + 5$`, isCorrect: false },
    ],
    solution: tex`$f(B) = g(B) + h(B) = 4 + 3 = 7$.`,
    bloomsLevel: 'apply',
    difficulty: 1,
  },
  {
    topic: 'Heuristic Search',
    topicIndex: 6,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`A$^{*}$ expands the frontier node with the smallest $f$. Given $f(A){=}8$, $f(B){=}7$, $f(C){=}10$, the node expanded next is:`,
    options: [
      { text: tex`$A$, with $f{=}8$.`, isCorrect: false },
      { text: tex`$C$, with $f{=}10$.`, isCorrect: false },
      { text: tex`$A$, because it has the smallest $g$.`, isCorrect: false },
      { text: tex`$B$, with $f{=}7$.`, isCorrect: true },
    ],
    solution: tex`$B$ ($f{=}7$) — the smallest $f$-value on the frontier.`,
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
    prompt: 'Why does DQN use a separate target network?',
    options: [
      {
        text: 'To eliminate the replay buffer and store nothing between updates.',
        isCorrect: false,
      },
      { text: 'To make the network smaller and run faster.', isCorrect: false },
      { text: 'To turn the task into ordinary i.i.d. supervised learning.', isCorrect: false },
      { text: 'To keep the update targets stable across steps.', isCorrect: true },
    ],
    solution:
      'Freezing the target network for several steps stops the target from shifting every update, which stabilizes training.',
    bloomsLevel: 'understand',
    difficulty: 1,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q2',
    type: 'MCQ_MULTI',
    points: 3,
    prompt: 'Select ALL correct statements about Deep Q-learning.',
    options: [
      {
        text: 'A replay buffer stores past transitions and samples mini-batches to decorrelate updates.',
        isCorrect: true,
      },
      {
        text: 'A target network holds the bootstrapped targets fixed for several steps to stabilize learning.',
        isCorrect: true,
      },
      {
        text: 'DQN can learn a control policy directly from high-dimensional pixel input.',
        isCorrect: true,
      },
      {
        text: tex`Double DQN reduces the overestimation bias of the $\max$ operator.`,
        isCorrect: true,
      },
      {
        text: 'Because the targets are held fixed, DQN training is exactly ordinary i.i.d. supervised regression.',
        isCorrect: false,
      },
      {
        text: tex`The loss is a squared temporal-difference error between the target and the current $Q$-value.`,
        isCorrect: true,
      },
    ],
    solution:
      'Correct: A, B, C, D, F. Option E is false — the data are correlated and non-stationary, unlike an i.i.d. supervised dataset.',
    bloomsLevel: 'understand',
    difficulty: 2,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q3a',
    type: 'MCQ_SINGLE',
    points: 2,
    prompt: tex`A DQN transition has reward $r{=}2$ and discount $\gamma{=}0.9$. For the next state, the target network's best value is $\max_{a'}\hat{Q}(s',a'){=}10$. Which expression gives the temporal-difference target $y$?`,
    options: [
      { text: tex`$r + \gamma \max_{a'}\hat{Q}(s',a')$`, isCorrect: true },
      { text: tex`$r + \gamma\,\hat{Q}(s',a) - Q(s,a)$`, isCorrect: false },
      { text: tex`$r \times \gamma \times \max_{a'}\hat{Q}(s',a')$`, isCorrect: false },
      { text: tex`$\max_{a'}\hat{Q}(s',a') - r$`, isCorrect: false },
    ],
    solution: "The DQN target bootstraps from the target network's best next-state value.",
    bloomsLevel: 'apply',
    difficulty: 2,
  },
  {
    topic: 'Deep Q-learning',
    topicIndex: 7,
    label: 'Q3b',
    type: 'MCQ_SINGLE',
    points: 3,
    prompt: tex`Substituting, $2 + 0.9(10)$ equals:`,
    options: [
      { text: tex`$9.0$`, isCorrect: false },
      { text: tex`$20$`, isCorrect: false },
      { text: tex`$11$`, isCorrect: true },
      { text: tex`$10.8$`, isCorrect: false },
    ],
    solution: tex`$11 = 2 + 9$.`,
    bloomsLevel: 'apply',
    difficulty: 1,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    DRY_RUN ? '[DRY RUN] Seed: CS 601 post-study assessment' : 'Seed: CS 601 post-study assessment',
  );

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
  // Otherwise fall back to finding/creating the default CS 601 course.
  const COURSE_TITLE = courseTitle ?? 'CS 601: AI and Uncertainty Reasoning';
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
          description: 'Per-topic assessments covering 9 topics in AI and Uncertainty Reasoning.',
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
  const ASSESSMENT_TITLE = 'Post-study Assessment';
  let existingAssessment = await prisma.assessment.findFirst({
    where: { courseId, title: ASSESSMENT_TITLE },
  });

  if (existingAssessment && !FORCE) {
    console.log(`  Assessment already exists (${existingAssessment.id}). Use --force to recreate.`);
    return;
  }

  if (existingAssessment && FORCE && !DRY_RUN) {
    console.log('  --force: deleting existing assessment, its links, and its question rows…');
    const links = await prisma.assessmentQuestion.findMany({
      where: { assessmentId: existingAssessment.id },
      select: { questionId: true },
    });
    const oldQuestionIds = links.map((l) => l.questionId);
    await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: existingAssessment.id } });
    await prisma.assessment.delete({ where: { id: existingAssessment.id } });
    if (oldQuestionIds.length > 0) {
      await prisma.question.deleteMany({ where: { id: { in: oldQuestionIds } } });
    }
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
          'All-multiple-choice post-study assessment covering 7 topics: 3 questions per topic (Q1 single-answer, Q2 select-all, Q3 two-part calculation). Parallel form to the pre-study assessment. Total: 28 questions.',
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
    console.log(`  ✓ ${createdQuestionIds.length} questions linked across 7 topic sections`);
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
