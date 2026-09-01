import { useState } from 'react';
import { DecompositionPanel } from '../../code-practice/DecompositionPanel';

interface CodeDecompositionViewProps {
  question: string;
  starterCode: string;
}

/** DBox's home is now the "Stepwise Learning" chat strategy — clicking
 *  it launches this view instead of the reading-comprehension
 *  StepwiseLearningView whenever there's an active coding question (see
 *  ChatbotPanel's `mode === 'stepwise-learning'` branch). This is just a
 *  thin host: it owns the code string DecompositionPanel reads/writes
 *  (Stage 2/implementation writes to it via its own editor) and renders
 *  nothing else — the guided-decomposition tree is the entire view, and
 *  DecompositionPanel starts its own session automatically. */
export function CodeDecompositionView({ question, starterCode }: CodeDecompositionViewProps) {
  const [code, setCode] = useState(starterCode);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DecompositionPanel code={code} loadedQuestion={question} onApplyCode={setCode} />
    </div>
  );
}
