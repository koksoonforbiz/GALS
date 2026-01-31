import { useState, useEffect, useRef } from 'react';
import katex from 'katex';

interface Props {
  open: boolean;
  initialLatex?: string;
  mode: 'inline' | 'block';
  onInsert: (latex: string, mode: 'inline' | 'block') => void;
  onClose: () => void;
}

const EXAMPLES = [
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Square root', latex: '\\sqrt{x}' },
  { label: 'Subscript', latex: 'x_{i}' },
  { label: 'Superscript', latex: 'x^{2}' },
  { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Greek', latex: '\\alpha, \\beta, \\gamma, \\theta' },
  { label: 'Vector', latex: '\\vec{F} = m\\vec{a}' },
];

export default function EquationModal({ open, initialLatex, mode, onInsert, onClose }: Props) {
  const [latex, setLatex] = useState(initialLatex || '');
  const [eqMode, setEqMode] = useState<'inline' | 'block'>(mode);
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setLatex(initialLatex || '');
      setEqMode(mode);
      setError('');
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open, initialLatex, mode]);

  // Live preview
  useEffect(() => {
    if (!previewRef.current) return;
    if (!latex.trim()) {
      previewRef.current.innerHTML =
        '<span class="text-gray-400 text-sm">Type LaTeX above...</span>';
      setError('');
      return;
    }
    try {
      katex.render(latex, previewRef.current, {
        throwOnError: true,
        displayMode: eqMode === 'block',
      });
      setError('');
    } catch (err: any) {
      setError(err.message || 'Invalid LaTeX');
      previewRef.current.innerHTML = `<span class="text-red-500 text-sm">${err.message || 'Invalid LaTeX'}</span>`;
    }
  }, [latex, eqMode]);

  if (!open) return null;

  const handleInsert = () => {
    if (!latex.trim()) return;
    onInsert(latex, eqMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">
            {initialLatex ? 'Edit Equation' : 'Insert Equation'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setEqMode('inline')}
              className={`px-3 py-1 text-xs rounded border ${
                eqMode === 'inline'
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              Inline ($...$)
            </button>
            <button
              onClick={() => setEqMode('block')}
              className={`px-3 py-1 text-xs rounded border ${
                eqMode === 'block'
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              Display ($$...$$)
            </button>
          </div>

          {/* LaTeX input */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">LaTeX Source</label>
            <textarea
              ref={textareaRef}
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              rows={3}
              placeholder="e.g. E = mc^{2}"
              spellCheck={false}
            />
          </div>

          {/* Live preview */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Preview</label>
            <div
              ref={previewRef}
              className={`min-h-[3rem] p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center ${
                eqMode === 'block' ? 'justify-center' : 'justify-start'
              }`}
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          {/* Quick examples */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quick Insert</label>
            <div className="flex flex-wrap gap-1">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setLatex((prev) => (prev ? prev + ' ' + ex.latex : ex.latex))}
                  className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200 font-mono"
                  title={ex.latex}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            disabled={!latex.trim() || !!error}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {initialLatex ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
