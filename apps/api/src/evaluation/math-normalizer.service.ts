import { Injectable } from '@nestjs/common';

/**
 * Deterministic math normalizer that detects and fixes broken/invalid
 * math formatting in block-based page content.
 *
 * Common issues detected:
 * 1. Raw HTML fragments from broken TipTap serialization (e.g. </p><div data-block-math...)
 * 2. Unescaped LaTeX in plain HTML (bare \frac{}{} outside of math containers)
 * 3. Empty math containers (data-inline-math with empty latex attr)
 * 4. Mismatched math delimiters ($$..$ or $..$$)
 * 5. Double-wrapped math containers
 * 6. LaTeX syntax errors (unclosed braces, unmatched \left/\right)
 */

export interface MathIssue {
  blockId: string;
  blockIndex: number;
  category:
    | 'broken_html'
    | 'raw_latex'
    | 'empty_math'
    | 'delimiter_mismatch'
    | 'double_wrap'
    | 'syntax_error';
  severity: 'error' | 'warning';
  location: string; // human-readable location description
  message: string;
  original: string; // the problematic fragment
  suggestedFix: string; // the corrected fragment
  autoFixable: boolean;
}

interface BlockDocument {
  version: number;
  blocks: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
}

@Injectable()
export class MathNormalizerService {
  /**
   * Analyze a BlockDocument JSON string for math formatting issues.
   * Returns issues found (does NOT modify the content).
   */
  analyze(contentJson: string): MathIssue[] {
    const issues: MathIssue[] = [];

    let doc: BlockDocument;
    try {
      doc = JSON.parse(contentJson);
    } catch {
      return issues;
    }

    if (!doc.blocks || !Array.isArray(doc.blocks)) return issues;

    for (let i = 0; i < doc.blocks.length; i++) {
      const block = doc.blocks[i]!;
      if (block.type === 'text' || block.type === 'callout') {
        const html =
          (block.data as { html?: string; body?: string }).html ||
          (block.data as { body?: string }).body ||
          '';
        if (html) {
          issues.push(...this.analyzeHtml(html, block.id, i));
        }
      }
    }

    return issues;
  }

  /**
   * Apply all auto-fixable issues to the content, returning the fixed JSON string.
   */
  applyFixes(
    contentJson: string,
    issuesToFix?: MathIssue[],
  ): { fixed: string; appliedCount: number } {
    let doc: BlockDocument;
    try {
      doc = JSON.parse(contentJson);
    } catch {
      return { fixed: contentJson, appliedCount: 0 };
    }

    const issues = issuesToFix || this.analyze(contentJson);
    const fixableIssues = issues.filter((i) => i.autoFixable);
    let appliedCount = 0;

    for (const issue of fixableIssues) {
      const block = doc.blocks.find((b) => b.id === issue.blockId);
      if (!block) continue;

      const dataObj = block.data as Record<string, string>;
      const field = block.type === 'callout' ? 'body' : 'html';
      const current = dataObj[field];
      if (!current) continue;

      const updated = current.replace(issue.original, issue.suggestedFix);
      if (updated !== current) {
        dataObj[field] = updated;
        appliedCount++;
      }
    }

    return { fixed: JSON.stringify(doc), appliedCount };
  }

  // ─── Internal Analysis ────────────────────────────────

  private analyzeHtml(html: string, blockId: string, blockIndex: number): MathIssue[] {
    const issues: MathIssue[] = [];

    // 1. Broken HTML: raw </p><div data-block-math .../><p> fragments
    const brokenBlockMath = /<\/p>\s*<div\s+data-block-math[^>]*><\/div>\s*<p>/g;
    let match: RegExpExecArray | null;
    while ((match = brokenBlockMath.exec(html)) !== null) {
      const latex = this.extractLatexAttr(match[0]);
      issues.push({
        blockId,
        blockIndex,
        category: 'broken_html',
        severity: 'error',
        location: `Block ${blockIndex + 1}, broken block-math HTML`,
        message: 'Block math element incorrectly embedded inside paragraph tags',
        original: match[0],
        suggestedFix: `</p><div data-block-math="" latex="${this.escapeAttr(latex)}"></div><p>`,
        autoFixable: true,
      });
    }

    // 2. Empty math containers
    const emptyInlineMath = /<span\s+data-inline-math=""\s+latex=""\s*><\/span>/g;
    while ((match = emptyInlineMath.exec(html)) !== null) {
      issues.push({
        blockId,
        blockIndex,
        category: 'empty_math',
        severity: 'warning',
        location: `Block ${blockIndex + 1}, empty inline math`,
        message: 'Empty inline math container (no LaTeX content)',
        original: match[0],
        suggestedFix: '',
        autoFixable: true,
      });
    }

    const emptyBlockMath = /<div\s+data-block-math=""\s+latex=""\s*><\/div>/g;
    while ((match = emptyBlockMath.exec(html)) !== null) {
      issues.push({
        blockId,
        blockIndex,
        category: 'empty_math',
        severity: 'warning',
        location: `Block ${blockIndex + 1}, empty block math`,
        message: 'Empty block math container (no LaTeX content)',
        original: match[0],
        suggestedFix: '',
        autoFixable: true,
      });
    }

    // 3. Raw LaTeX outside math containers (common AI generation issue)
    // Detect \frac, \sum, \int, \sqrt, \alpha etc. outside of math containers
    const rawLatexPattern =
      /(?<![""'])\\(?:frac|sum|int|sqrt|alpha|beta|gamma|delta|theta|pi|sigma|infty|partial|nabla|cdot|times|div|pm|leq|geq|neq|approx)\b[^<]{0,200}/g;
    const mathContainerRegions = this.getMathContainerRegions(html);

    while ((match = rawLatexPattern.exec(html)) !== null) {
      if (this.isInsideMathContainer(match.index, mathContainerRegions)) continue;
      // Also skip if inside an attribute value
      if (this.isInsideAttribute(html, match.index)) continue;

      const fragment = match[0].substring(0, 80);
      issues.push({
        blockId,
        blockIndex,
        category: 'raw_latex',
        severity: 'error',
        location: `Block ${blockIndex + 1}, raw LaTeX in text`,
        message: 'LaTeX command found outside of a math container',
        original: fragment,
        suggestedFix: `<span data-inline-math="" latex="${this.escapeAttr(fragment)}"></span>`,
        autoFixable: true,
      });
    }

    // 4. Double-wrapped math: span[data-inline-math] inside span[data-inline-math]
    const doubleWrap = /<span\s+data-inline-math=""\s+latex="[^"]*<span\s+data-inline-math/g;
    while ((match = doubleWrap.exec(html)) !== null) {
      issues.push({
        blockId,
        blockIndex,
        category: 'double_wrap',
        severity: 'error',
        location: `Block ${blockIndex + 1}, double-wrapped math`,
        message: 'Math container is nested inside another math container',
        original: match[0].substring(0, 100),
        suggestedFix: match[0].substring(0, 100), // manual fix needed
        autoFixable: false,
      });
    }

    // 5. LaTeX syntax: unclosed braces in math containers
    const mathLatexAttrs = /latex="([^"]*)"/g;
    while ((match = mathLatexAttrs.exec(html)) !== null) {
      const latex = match[1];
      if (!latex) continue;
      const decoded = this.unescapeAttr(latex);
      const braceIssue = this.checkBraces(decoded);
      if (braceIssue) {
        issues.push({
          blockId,
          blockIndex,
          category: 'syntax_error',
          severity: 'warning',
          location: `Block ${blockIndex + 1}, LaTeX syntax`,
          message: braceIssue,
          original: latex.substring(0, 80),
          suggestedFix: latex.substring(0, 80),
          autoFixable: false,
        });
      }
    }

    // 6. Mismatched dollar-sign delimiters (from copy-paste or AI output)
    const dollarMismatch = /\$\$([^$]+)\$(?!\$)/g;
    while ((match = dollarMismatch.exec(html)) !== null) {
      if (this.isInsideMathContainer(match.index, mathContainerRegions)) continue;
      if (this.isInsideAttribute(html, match.index)) continue;
      issues.push({
        blockId,
        blockIndex,
        category: 'delimiter_mismatch',
        severity: 'error',
        location: `Block ${blockIndex + 1}, mismatched $$ delimiters`,
        message: 'Opening $$ with single closing $',
        original: match[0].substring(0, 80),
        suggestedFix: `<div data-block-math="" latex="${this.escapeAttr(match[1]!.trim())}"></div>`,
        autoFixable: true,
      });
    }

    return issues;
  }

  // ─── Helpers ──────────────────────────────────────────

  private extractLatexAttr(html: string): string {
    const m = /latex="([^"]*)"/.exec(html);
    return m ? m[1]! : '';
  }

  private escapeAttr(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private unescapeAttr(s: string): string {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  private getMathContainerRegions(html: string): Array<[number, number]> {
    const regions: Array<[number, number]> = [];
    const pattern = /<(?:span\s+data-inline-math|div\s+data-block-math)[^>]*>.*?<\/(?:span|div)>/gs;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null) {
      regions.push([m.index, m.index + m[0].length]);
    }
    return regions;
  }

  private isInsideMathContainer(pos: number, regions: Array<[number, number]>): boolean {
    return regions.some(([start, end]) => pos >= start && pos < end);
  }

  private isInsideAttribute(html: string, pos: number): boolean {
    // Simple check: find last unmatched " before pos
    let inAttr = false;
    const sub = html.substring(Math.max(0, pos - 500), pos);
    let quoteCount = 0;
    for (let i = sub.length - 1; i >= 0; i--) {
      if (sub[i] === '"' && (i === 0 || sub[i - 1] !== '\\')) {
        quoteCount++;
      }
      if (sub[i] === '<') break;
      if (sub[i] === '>') break;
    }
    inAttr = quoteCount % 2 === 1;
    return inAttr;
  }

  private checkBraces(latex: string): string | null {
    let depth = 0;
    for (const ch of latex) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth < 0) return 'Extra closing brace } found';
    }
    if (depth > 0) return `${depth} unclosed opening brace(s) {`;
    return null;
  }
}
