import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('확대·overflow 컨테이너 밖의 body 포털에 렌더링한다', () => {
    render(
      <main style={{ zoom: 1.2, overflow: 'hidden' }}>
        <Modal open onClose={vi.fn()} labelId="portal-modal-title">
          <h2 id="portal-modal-title">포털 모달</h2>
        </Modal>
      </main>,
    );

    const dialog = screen.getByRole('dialog', { name: '포털 모달' });
    expect(dialog.parentElement).toBe(document.body);
  });

  it('열었던 컴포넌트가 언마운트되어도 이전 포커스를 복구한다', async () => {
    const opener = document.createElement('button');
    opener.textContent = '열기';
    document.body.appendChild(opener);
    opener.focus();

    const view = render(
      <Modal open onClose={vi.fn()} labelId="focus-modal-title">
        <h2 id="focus-modal-title">포커스 모달</h2>
        <button type="button">닫기</button>
      </Modal>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
    });

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('중첩 모달에서는 ESC가 최상위 모달만 닫는다', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();

    render(
      <>
        <Modal open onClose={closeParent} labelId="parent-modal-title">
          <h2 id="parent-modal-title">부모 모달</h2>
        </Modal>
        <Modal open onClose={closeChild} labelId="child-modal-title">
          <h2 id="child-modal-title">자식 모달</h2>
        </Modal>
      </>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();
  });
});
