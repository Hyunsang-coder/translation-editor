import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { TargetTipTapEditor } from './TipTapEditor';
import { CONFLUENCE_CODE_BLOCK_MULTI_LINE } from '@/utils/__fixtures__/confluenceClipboard';

/** plain text만 담긴 클립보드를 붙여넣고 결과 문서 JSON을 돌려준다. */
async function pastePlainText(text: string): Promise<JSONContent> {
  const onEditorReady = vi.fn();
  const { container } = render(
    <TargetTipTapEditor content="" onEditorReady={onEditorReady} />,
  );

  await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
  const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

  const editableEl = container.querySelector('[contenteditable="true"]')!;
  act(() => {
    fireEvent.paste(editableEl, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
  });

  return editor.getJSON();
}

describe('TipTapEditor plain text 코드 붙여넣기', () => {
  it('코드 펜스를 language 속성이 붙은 codeBlock으로 만든다', async () => {
    const doc = await pastePlainText('```ts\nconst a = 1;\n```');

    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const a = 1;' }],
      },
    ]);
  });

  it('codeBlock 안의 들여쓰기·탭·빈 줄을 그대로 보존한다', async () => {
    const doc = await pastePlainText('```py\ndef f():\n    return 1\n\n\tif x:\n\t\tpass\n```');

    const codeBlock = doc.content?.[0];
    expect(codeBlock?.type).toBe('codeBlock');
    expect(codeBlock?.content?.[0]?.text).toBe('def f():\n    return 1\n\n\tif x:\n\t\tpass');
  });

  it('인라인 백틱을 code mark로 만든다', async () => {
    const doc = await pastePlainText('`npm run dev`로 실행');

    expect(doc.content?.length).toBe(1);
    expect(doc.content?.[0]?.type).toBe('paragraph');
    expect(doc.content?.[0]?.content).toEqual([
      { type: 'text', marks: [{ type: 'code' }], text: 'npm run dev' },
      { type: 'text', text: '로 실행' },
    ]);
  });

  it('비코드 구간은 기본 붙여넣기와 동일하게 줄마다 문단이 된다', async () => {
    const doc = await pastePlainText('첫 줄\n둘째 줄\n\n`code` 문단');

    expect(doc.content?.length).toBe(3);
    expect(doc.content?.[0]?.content).toEqual([{ type: 'text', text: '첫 줄' }]);
    expect(doc.content?.[1]?.content).toEqual([{ type: 'text', text: '둘째 줄' }]);
    expect(doc.content?.[2]?.content?.[0]?.marks).toEqual([{ type: 'code' }]);
  });

  it('펜스 내부의 [] / [x]는 taskList가 아니라 코드로 유지한다', async () => {
    const doc = await pastePlainText('```go\nvar b []byte\n// [x] done\n```');

    const types: string[] = [];
    for (const node of doc.content ?? []) types.push(node.type ?? '');
    expect(types).toEqual(['codeBlock']);
    expect(doc.content?.[0]?.content?.[0]?.text).toBe('var b []byte\n// [x] done');
  });

  it('코드 패턴이 없는 plain text는 기존 기본 붙여넣기 동작을 유지한다', async () => {
    const doc = await pastePlainText('첫 줄\n둘째 줄\n\n다음 문단');

    expect(doc.content?.length).toBe(3);
    expect((doc.content ?? []).map((node) => node.content?.[0]?.text)).toEqual([
      '첫 줄',
      '둘째 줄',
      '다음 문단',
    ]);
  });

  it('text/html이 있으면 plain text 변환 경로를 타지 않는다', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor content="" onEditorReady={onEditorReady} />,
    );
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) => {
            if (type === 'text/html') return '<p>서식 있는 <strong>본문</strong></p>';
            if (type === 'text/plain') return '```ts\nconst a = 1;\n```';
            return '';
          },
        },
      });
    });

    const doc = editor.getJSON();
    const types = (doc.content ?? []).map((node) => node.type);
    expect(types).not.toContain('codeBlock');
  });

  it('Confluence 코드 블록 HTML을 붙여넣으면 codeBlock으로 들어온다', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor content="" onEditorReady={onEditorReady} />,
    );
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) =>
            type === 'text/html' ? CONFLUENCE_CODE_BLOCK_MULTI_LINE : '',
        },
      });
    });

    const doc = editor.getJSON();
    expect(doc.content?.[0]?.type).toBe('codeBlock');
    expect(doc.content?.[0]?.content?.[0]?.text).toContain(
      'SetEnvironmentVariable(\n"Path",',
    );
  });

  it('Confluence 한 줄 인라인 코드 HTML을 붙여넣으면 code mark로 유지한다', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor content="" onEditorReady={onEditorReady} />,
    );
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) =>
            type === 'text/html'
              ? '<p>폭탄 해체 시작음인 <code style="white-space: pre-wrap">Mordor.Weapon.PlantedBomb.StartDefuse</code>는 개별 볼륨이다.</p>'
              : '',
        },
      });
    });

    const doc = editor.getJSON();
    expect(doc.content?.[0]?.type).toBe('paragraph');
    expect(doc.content?.[0]?.content?.[1]).toEqual({
      type: 'text',
      marks: [{ type: 'code' }],
      text: 'Mordor.Weapon.PlantedBomb.StartDefuse',
    });
    expect((doc.content ?? []).map((node) => node.type)).not.toContain('codeBlock');
  });

  it('Confluence 고정 헤더 복제본과 사이의 빈 문단을 제거한다', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor content="" onEditorReady={onEditorReady} />,
    );
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const html = `
      <table>
        <thead><tr><th>위치/클래스</th><th>종류</th><th>상태</th><th>역할</th></tr></thead>
      </table>
      <p>\u200B</p><p>\uFEFF</p><p><br></p>
      <table>
        <thead><tr><th>위치/클래스</th><th>종류</th><th>상태</th><th>역할</th></tr></thead>
        <tbody><tr><td>AHPlayerState</td><td>PlayerState</td><td>확장</td><td>보유 상태</td></tr></tbody>
      </table>
    `;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) => (type === 'text/html' ? html : ''),
        },
      });
    });

    const doc = editor.getJSON();
    expect((doc.content ?? []).map((node) => node.type)).toEqual(['table']);
    expect(editor.getText()).toContain('AHPlayerState');
  });
});
