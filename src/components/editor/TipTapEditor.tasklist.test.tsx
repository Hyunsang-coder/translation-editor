import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { SourceTipTapEditor, TargetTipTapEditor } from './TipTapEditor';

describe('TipTapEditor TaskList / Checkbox support', () => {
  it('renders taskList and taskItem with checkbox in SourceTipTapEditor', async () => {
    const onEditorReady = vi.fn();
    const htmlContent = `
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>미완료 항목</p></li>
        <li data-type="taskItem" data-checked="true"><p>완료 항목</p></li>
      </ul>
    `;

    const { container } = render(
      <SourceTipTapEditor
        content={htmlContent}
        onEditorReady={onEditorReady}
      />,
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    // ProseMirror state에 taskList 및 taskItem 노드가 존재하는지 검증
    const taskListNodes: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskList' || node.type.name === 'taskItem') {
        taskListNodes.push(node.type.name);
      }
    });
    expect(taskListNodes).toContain('taskList');
    expect(taskListNodes).toContain('taskItem');

    // DOM 렌더링 확인: 체크박스 input들이 존재하는지
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('allows clicking checkbox to toggle state in TargetTipTapEditor', async () => {
    const onEditorReady = vi.fn();
    const htmlContent = `
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>할 일 토글 테스트</p></li>
      </ul>
    `;

    const { container } = render(
      <TargetTipTapEditor
        content={htmlContent}
        onEditorReady={onEditorReady}
      />,
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    // 체크박스 클릭
    act(() => {
      fireEvent.click(checkbox);
    });

    // state 상에서 checked가 true로 변경되었는지 확인
    let checkedState: boolean | undefined;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') {
        checkedState = node.attrs.checked as boolean;
      }
    });
    expect(checkedState).toBe(true);
  });

  it('renders pasted Confluence / Unicode checkbox text correctly as taskList', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor
        content=""
        onEditorReady={onEditorReady}
      />,
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    // Confluence에서 복사된 HTML을 paste 이벤트로 시뮬레이션
    const confluencePastedHtml = `
      <ul class="inline-task-list">
        <li class="inline-task-item" data-task-state="incomplete">
          <span class="placeholder-inline-tasks"></span>
          <span>작업 에셋이 올바른 VFX 경로에 생성되었는지 확인</span>
        </li>
        <li class="inline-task-item" data-task-state="completed">
          <span class="placeholder-inline-tasks"></span>
          <span>테스트 레벨과 실제 레벨에서 모두 정상 표시되는지 확인</span>
        </li>
      </ul>
    `;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) => (type === 'text/html' ? confluencePastedHtml : ''),
        },
      });
    });

    const taskItems: Array<{ checked: boolean; text: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') {
        taskItems.push({
          checked: node.attrs.checked as boolean,
          text: node.textContent,
        });
      }
    });

    expect(taskItems.length).toBe(2);
    expect(taskItems[0]?.checked).toBe(false);
    expect(taskItems[0]?.text).toContain('작업 에셋이 올바른 VFX 경로에 생성되었는지 확인');
    expect(taskItems[1]?.checked).toBe(true);
    expect(taskItems[1]?.text).toContain('테스트 레벨과 실제 레벨에서 모두 정상 표시되는지 확인');
  });

  it('renders plain text with unicode ballot box (☐, ☑) as taskList upon paste', async () => {
    const onEditorReady = vi.fn();
    const { container } = render(
      <TargetTipTapEditor
        content=""
        onEditorReady={onEditorReady}
      />,
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const editor = onEditorReady.mock.calls[0]?.[0] as Editor;

    const plainText = `리뷰 및 서밋 전 체크\n☐ 작업 에셋 확인\n☑ 레벨 테스트 완료`;

    const editableEl = container.querySelector('[contenteditable="true"]')!;
    act(() => {
      fireEvent.paste(editableEl, {
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? plainText : ''),
        },
      });
    });

    const taskItems: Array<{ checked: boolean; text: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') {
        taskItems.push({
          checked: node.attrs.checked as boolean,
          text: node.textContent,
        });
      }
    });

    expect(taskItems.length).toBe(2);
    expect(taskItems[0]?.checked).toBe(false);
    expect(taskItems[0]?.text).toContain('작업 에셋 확인');
    expect(taskItems[1]?.checked).toBe(true);
    expect(taskItems[1]?.text).toContain('레벨 테스트 완료');
  });
});
