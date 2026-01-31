/**
 * TipTap custom node extensions for LaTeX equations.
 * - InlineMath: rendered inline within text ($...$)
 * - BlockMath: centered display equation ($$...$$)
 * Both store raw LaTeX source and render via KaTeX.
 */
import { Node, mergeAttributes } from '@tiptap/react';
import katex from 'katex';

// ─── Inline Math ($...$) ─────────────────────────────────

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = HTMLAttributes.latex || '';
    let rendered = '';
    try {
      rendered = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      rendered = `<span class="text-red-500">${latex}</span>`;
    }
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-inline-math': '',
        class: 'inline-math-node',
        contenteditable: 'false',
      }),
      ['span', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      dom.classList.add('inline-math-node');
      dom.setAttribute('data-inline-math', '');
      dom.contentEditable = 'false';
      dom.style.cursor = 'pointer';
      dom.title = 'Click to edit equation';

      const renderKatex = () => {
        try {
          katex.render(node.attrs.latex || '?', dom, {
            throwOnError: false,
            displayMode: false,
          });
        } catch {
          dom.textContent = node.attrs.latex || '?';
        }
      };
      renderKatex();

      dom.addEventListener('click', () => {
        // Dispatch a custom event for the editor wrapper to handle
        const event = new CustomEvent('edit-equation', {
          detail: {
            type: 'inline',
            latex: node.attrs.latex,
            pos: editor.view.posAtDOM(dom, 0),
          },
          bubbles: true,
        });
        dom.dispatchEvent(event);
      });

      return { dom };
    };
  },
});

// ─── Block Math ($$...$$) ────────────────────────────────

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = HTMLAttributes.latex || '';
    let rendered = '';
    try {
      rendered = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      rendered = `<span class="text-red-500">${latex}</span>`;
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-block-math': '',
        class: 'block-math-node',
        contenteditable: 'false',
      }),
      ['div', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div');
      dom.classList.add('block-math-node');
      dom.setAttribute('data-block-math', '');
      dom.contentEditable = 'false';
      dom.style.cursor = 'pointer';
      dom.style.textAlign = 'center';
      dom.style.padding = '0.75rem 0';
      dom.style.margin = '0.5rem 0';
      dom.title = 'Click to edit equation';

      const renderKatex = () => {
        try {
          katex.render(node.attrs.latex || '?', dom, {
            throwOnError: false,
            displayMode: true,
          });
        } catch {
          dom.textContent = node.attrs.latex || '?';
        }
      };
      renderKatex();

      dom.addEventListener('click', () => {
        const event = new CustomEvent('edit-equation', {
          detail: {
            type: 'block',
            latex: node.attrs.latex,
            pos: editor.view.posAtDOM(dom, 0),
          },
          bubbles: true,
        });
        dom.dispatchEvent(event);
      });

      return { dom };
    };
  },
});
