import { describe, it, expect } from 'vitest';
import {
  markdownToTipTapJson,
  tipTapJsonToMarkdown,
  markdownToTipTapJsonForTranslation,
  tipTapJsonToMarkdownForTranslation,
  parseTranslationResponseToTipTap,
  extractTranslationMarkdown,
  normalizeTaskLists,
} from './markdownConverter';
import { extractTextFromTipTap } from './tipTapText';
import { normalizePastedHtml } from './htmlNormalizer';

describe('Task list / Checkbox markdown support', () => {
  it('parses markdown task lists (- [ ] and - [x]) into taskList and taskItem', () => {
    const md = `- [ ] 할 일 1\n- [x] 완료된 일 2`;
    const json = markdownToTipTapJson(md);

    const content = json.content as Array<{ type: string; content?: Array<{ type: string; attrs?: { checked?: boolean }; content?: Array<{ content?: Array<{ text?: string }> }> }> }>;
    expect(content[0]?.type).toBe('taskList');
    const items = content[0]?.content;
    expect(items).toHaveLength(2);
    expect(items?.[0]?.type).toBe('taskItem');
    expect(items?.[0]?.attrs?.checked).toBe(false);
    expect(items?.[1]?.type).toBe('taskItem');
    expect(items?.[1]?.attrs?.checked).toBe(true);
  });

  it('serializes taskList and taskItem back to markdown with [ ] and [x]', () => {
    const md = `- [ ] 할 일 1\n- [x] 완료된 일 2`;
    const json = markdownToTipTapJson(md);
    const serialized = tipTapJsonToMarkdown(json);
    expect(serialized).toContain('[ ] 할 일 1');
    expect(serialized).toContain('[x] 완료된 일 2');
    // 대괄호가 이스케이프(\[ \])되지 않아야 함
    expect(serialized).not.toContain('\\[ \\]');
    expect(serialized).not.toContain('\\[x\\]');
  });

  it('handles asterisk bullet task lists (* [ ] and * [x])', () => {
    const md = `* [ ] 별표 할 일\n* [x] 별표 완료`;
    const json = markdownToTipTapJson(md);
    const content = json.content as Array<{ type: string; content?: unknown[] }>;
    expect(content[0]?.type).toBe('taskList');
  });

  it('handles square brackets without bullet prefix ([ ], [x], [])', () => {
    const md = `[ ] 불릿 없는 할 일 1\n[x] 불릿 없는 완료 2\n[] 빈 대괄호 할 일 3`;
    const json = markdownToTipTapJson(md);
    const content = json.content as Array<{ type: string; content?: Array<{ type: string; attrs?: { checked?: boolean } }> }>;
    expect(content[0]?.type).toBe('taskList');
    const items = content[0]?.content;
    expect(items).toHaveLength(3);
    expect(items?.[0]?.attrs?.checked).toBe(false);
    expect(items?.[1]?.attrs?.checked).toBe(true);
    expect(items?.[2]?.attrs?.checked).toBe(false);
  });

  it('handles unicode ballot boxes (☐, ☑, ☒, □)', () => {
    const md = `☐ 유니코드 할 일 1\n☑ 유니코드 완료 2\n☒ 유니코드 체크 3\n□ 빈 네모 4`;
    const json = markdownToTipTapJson(md);
    const content = json.content as Array<{ type: string; content?: Array<{ type: string; attrs?: { checked?: boolean } }> }>;
    expect(content[0]?.type).toBe('taskList');
    const items = content[0]?.content;
    expect(items).toHaveLength(4);
    expect(items?.[0]?.attrs?.checked).toBe(false);
    expect(items?.[1]?.attrs?.checked).toBe(true);
    expect(items?.[2]?.attrs?.checked).toBe(true);
    expect(items?.[3]?.attrs?.checked).toBe(false);
  });

  it('does not touch checkboxes inside code blocks', () => {
    const md = '```markdown\n[ ] 코드 블록 안의 체크박스\n```';
    const normalized = normalizeTaskLists(md);
    expect(normalized).toBe(md);
  });

  it('does not confuse reference links with checkboxes', () => {
    const md = '[x]: https://example.com "참조 링크"';
    const normalized = normalizeTaskLists(md);
    expect(normalized).toBe(md);
  });

  it('supports nested task lists (indentation)', () => {
    const md = `- [ ] 상위 항목\n  - [ ] 하위 항목 1\n  - [x] 하위 완료 2`;
    const json = markdownToTipTapJson(md);
    expect((json.content as Array<{ type: string }>)[0]?.type).toBe('taskList');

    const serialized = tipTapJsonToMarkdown(json);
    expect(serialized).toContain('[ ] 상위 항목');
    expect(serialized).toContain('[ ] 하위 항목 1');
    expect(serialized).toContain('[x] 하위 완료 2');
  });

  it('supports roundtrip conversion in translation pipeline', () => {
    const md = `- [ ] 번역할 작업 항목\n- [x] 완료된 작업 항목`;
    const json = markdownToTipTapJsonForTranslation(md);
    expect((json.content as Array<{ type: string }>)[0]?.type).toBe('taskList');

    const serialized = tipTapJsonToMarkdownForTranslation(json);
    expect(serialized).toContain('[ ] 번역할 작업 항목');
    expect(serialized).toContain('[x] 완료된 작업 항목');
  });

  it('parses task list from parseTranslationResponseToTipTap (with extractTranslationMarkdown)', () => {
    const response = `---TRANSLATION_START---\n- [ ] 번역 완료 대기\n- [x] 번역 완료됨\n---TRANSLATION_END---`;
    const markdown = extractTranslationMarkdown(response);
    const json = parseTranslationResponseToTipTap(markdown);
    const content = json.content as Array<{ type: string; content?: unknown[] }>;
    expect(content[0]?.type).toBe('taskList');
  });

  it('parses task list from parseTranslationResponseToTipTap with HTML format', () => {
    const htmlResponse = `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>HTML 할 일</p></li><li data-type="taskItem" data-checked="true"><p>HTML 완료</p></li></ul>`;
    const json = parseTranslationResponseToTipTap(htmlResponse);
    const content = json.content as Array<{ type: string; content?: unknown[] }>;
    expect(content[0]?.type).toBe('taskList');
  });

  it('extracts plain text from task list via extractTextFromTipTap', () => {
    const md = `- [ ] 할 일 A\n- [x] 완료 B`;
    const json = markdownToTipTapJson(md);
    const text = extractTextFromTipTap(json);
    expect(text).toContain('할 일 A');
    expect(text).toContain('완료 B');
  });

  it('normalizes pasted task list HTML correctly', () => {
    const pastedHtml = `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox"> 복사된 할 일</li><li class="task-list-item checked"><input type="checkbox" checked> 복사된 완료</li></ul>`;
    const normalized = normalizePastedHtml(pastedHtml);
    expect(normalized).toContain('data-type="taskList"');
    expect(normalized).toContain('data-type="taskItem"');
    expect(normalized).toContain('data-checked="false"');
    expect(normalized).toContain('data-checked="true"');
  });
});
