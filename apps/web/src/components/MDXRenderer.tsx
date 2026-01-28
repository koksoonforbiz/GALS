import { useState, useEffect } from 'react';
import { compile, run } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface MDXRendererProps {
  content: string;
  className?: string;
}

export function MDXRenderer({ content, className = '' }: MDXRendererProps) {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function compileMDX() {
      try {
        const compiled = await compile(content, {
          outputFormat: 'function-body',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        });

        const { default: MDXContent } = await run(String(compiled), {
          ...runtime,
          baseUrl: import.meta.url,
        });

        if (!cancelled) {
          setComponent(() => MDXContent);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render MDX');
          setComponent(null);
        }
      }
    }

    compileMDX();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className={`p-4 bg-red-50 text-red-700 rounded-lg ${className}`}>
        <p className="font-medium">Error rendering content:</p>
        <pre className="text-sm mt-2 whitespace-pre-wrap">{error}</pre>
        <div className="mt-4 p-2 bg-gray-100 rounded text-gray-700">
          <p className="text-sm font-medium">Raw content:</p>
          <pre className="text-sm whitespace-pre-wrap">{content}</pre>
        </div>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div
      className={`prose prose-sm max-w-none ${className}`}
      style={
        {
          // Basic prose-like styling without requiring @tailwindcss/typography
        }
      }
    >
      <Component />
    </div>
  );
}
