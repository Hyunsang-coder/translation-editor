import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { normalizePastedHtml } from './htmlNormalizer';
import {
  CONFLUENCE_CODE_BLOCK_MULTI_LINE,
  CONFLUENCE_CODE_BLOCK_SINGLE_LINE,
} from './__fixtures__/confluenceClipboard';

/** 정규화된 HTML을 실제 에디터 스키마로 파싱한 문서 JSON. */
function parseToDoc(html: string): ReturnType<Editor['getJSON']> {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit],
    content: html,
    parseOptions: { preserveWhitespace: 'full' },
  });
  return editor.getJSON();
}

describe('normalizePastedHtml — <pre> 없는 블록 코드 승격', () => {
  describe('Confluence 실제 클립보드 (픽스처)', () => {
    it('여러 줄 코드 블록을 codeBlock 한 개로 만들고 줄바꿈을 유지한다', () => {
      const doc = parseToDoc(normalizePastedHtml(CONFLUENCE_CODE_BLOCK_MULTI_LINE));

      expect(doc.content?.length).toBe(1);
      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.content?.[0]?.text).toBe(
        '[System.Environment]::SetEnvironmentVariable(\n"Path",\n$env:Path + ";$HOME\\.local\\bin",\n"User“\n)',
      );
    });

    it('한 줄 코드 블록도 문단 속 인라인 코드가 아니라 codeBlock이 된다', () => {
      const doc = parseToDoc(normalizePastedHtml(CONFLUENCE_CODE_BLOCK_SINGLE_LINE));

      expect(doc.content?.length).toBe(1);
      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.content?.[0]?.text).toBe(
        'irm https://claude.ai/install.ps1 | iex',
      );
    });

    it('빈 language- 클래스를 남기지 않는다', () => {
      const html = normalizePastedHtml(CONFLUENCE_CODE_BLOCK_MULTI_LINE);
      expect(html).not.toContain('language-"');
    });
  });

  describe('승격 신호', () => {
    it('white-space: pre가 걸린 <code>를 pre로 감싼다', () => {
      const doc = parseToDoc(
        normalizePastedHtml('<div><code style="white-space: pre">a = 1\nb = 2</code></div>'),
      );

      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.content?.[0]?.text).toBe('a = 1\nb = 2');
    });

    it('white-space: pre-wrap도 승격한다', () => {
      const doc = parseToDoc(
        normalizePastedHtml('<div><code style="white-space: pre-wrap">a\nb</code></div>'),
      );

      expect(doc.content?.[0]?.type).toBe('codeBlock');
    });

    it('language- 클래스에 실제 언어가 있으면 유지한다', () => {
      const doc = parseToDoc(
        normalizePastedHtml(
          '<div><code class="language-powershell" style="white-space: pre">$a = 1\n$b = 2</code></div>',
        ),
      );

      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.attrs?.language).toBe('powershell');
    });
  });

  describe('승격하지 않아야 하는 경우', () => {
    it('문장 중간의 인라인 <code>는 code mark로 남긴다', () => {
      const doc = parseToDoc(
        normalizePastedHtml(
          '<table><tbody><tr><td><p>run <code style="color:#eb5757">ls -la</code> now</p></td></tr></tbody></table>',
        ),
      );

      const types: string[] = [];
      const codeMarkTexts: string[] = [];
      const walk = (node: Record<string, unknown>): void => {
        if (typeof node.type === 'string') types.push(node.type);
        const marks = node.marks as Array<{ type: string }> | undefined;
        if (marks?.some((mark) => mark.type === 'code')) {
          codeMarkTexts.push(String(node.text));
        }
        for (const child of (node.content ?? []) as Array<Record<string, unknown>>) walk(child);
      };
      walk(doc as Record<string, unknown>);

      expect(types).not.toContain('codeBlock');
      expect(codeMarkTexts).toEqual(['ls -la']);
    });

    it('이미 <pre> 안에 있는 <code>는 이중으로 감싸지 않는다', () => {
      const html = normalizePastedHtml(
        '<div style="color:#111"><pre><code style="white-space: pre">a\nb</code></pre></div>',
      );
      expect(html).not.toContain('<pre><pre>');

      const doc = parseToDoc(html);
      expect(doc.content?.length).toBe(1);
      expect(doc.content?.[0]?.type).toBe('codeBlock');
      expect(doc.content?.[0]?.content?.[0]?.text).toBe('a\nb');
    });

    it('white-space 지정이 없는 블록 <code>는 기존 동작(인라인 코드)을 유지한다', () => {
      const doc = parseToDoc(
        normalizePastedHtml('<div style="color:#111"><code>npm run dev</code></div>'),
      );

      expect(doc.content?.[0]?.type).toBe('paragraph');
      expect(doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'code' }]);
    });
  });
});
