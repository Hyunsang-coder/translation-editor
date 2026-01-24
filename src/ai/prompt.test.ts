import { describe, it, expect } from 'vitest';
import { detectRequestType, buildBlockContextText } from './prompt';
import type { EditorBlock } from '@/types';

describe('detectRequestType', () => {
  describe('질문 감지 (question)', () => {
    it('물음표가 있으면 question', () => {
      expect(detectRequestType('이게 뭐야?')).toBe('question');
      expect(detectRequestType('왜 이렇게 번역했어?')).toBe('question');
      expect(detectRequestType('What is this?')).toBe('question');
    });

    it('전각 물음표도 question', () => {
      expect(detectRequestType('이게 뭐야？')).toBe('question');
    });

    it('질문 키워드 포함 시 question', () => {
      expect(detectRequestType('이 단어의 의미가 뭔지 알려줘')).toBe('question');
      expect(detectRequestType('왜 이렇게 번역했는지 설명해')).toBe('question');
      expect(detectRequestType('how does this work')).toBe('question');
      expect(detectRequestType('what is the difference')).toBe('question');
    });

    it('짧은 한국어 질문 단어 - 단어 경계 체크', () => {
      // 독립적으로 사용된 경우
      expect(detectRequestType('뭐')).toBe('question');
      expect(detectRequestType('이거 뭐')).toBe('question');
      expect(detectRequestType('맞아')).toBe('question');
      expect(detectRequestType('틀려')).toBe('question');
      expect(detectRequestType('어때')).toBe('question');
    });

    it('짧은 단어가 다른 단어 안에 있으면 감지 안함', () => {
      // '뭐'가 '뭔가'의 일부인 경우 - 정확히 단어 경계를 체크하므로 감지 안됨
      const result = detectRequestType('뭔가 이상해');
      // '뭔가'는 '뭐'로 시작하지 않고, 공백/줄바꿈 뒤에 '뭐'가 없으므로 general
      expect(result).toBe('general');
    });
  });

  describe('번역 감지 (translate)', () => {
    it('강한 번역 키워드', () => {
      expect(detectRequestType('이 문서를 번역해')).toBe('translate');
      expect(detectRequestType('번역해줘')).toBe('translate');
      expect(detectRequestType('한국어로 옮겨줘')).toBe('translate');
      expect(detectRequestType('영어로 바꿔줘')).toBe('translate');
    });

    it('약한 번역 키워드', () => {
      expect(detectRequestType('translate this')).toBe('translate');
      expect(detectRequestType('한국어로 변환')).toBe('translate');
      expect(detectRequestType('문장을 다듬어')).toBe('translate');
      expect(detectRequestType('표현을 수정해')).toBe('translate');
    });
  });

  describe('일반 요청 (general)', () => {
    it('특별한 키워드가 없으면 general', () => {
      expect(detectRequestType('안녕하세요')).toBe('general');
      expect(detectRequestType('고마워')).toBe('general');
      expect(detectRequestType('좋아')).toBe('general');
    });
  });

  describe('우선순위 테스트', () => {
    it('물음표가 번역 키워드보다 우선', () => {
      // 물음표가 있으면 번역 키워드가 있어도 question
      expect(detectRequestType('번역해줄 수 있어?')).toBe('question');
    });

    it('강한 번역 키워드가 질문 단어보다 우선', () => {
      // 강한 번역 키워드가 있으면 질문 단어가 있어도 translate
      expect(detectRequestType('이게 뭔지 번역해줘')).toBe('translate');
    });
  });

  describe('엣지 케이스', () => {
    it('빈 문자열', () => {
      expect(detectRequestType('')).toBe('general');
    });

    it('공백만 있는 경우', () => {
      expect(detectRequestType('   ')).toBe('general');
    });

    it('대소문자 무시', () => {
      expect(detectRequestType('TRANSLATE THIS')).toBe('translate');
      expect(detectRequestType('HOW does this work')).toBe('question');
    });

    it('줄바꿈 포함', () => {
      expect(detectRequestType('이거\n뭐야')).toBe('question');
    });
  });
});

describe('buildBlockContextText', () => {
  it('빈 배열이면 빈 문자열 반환', () => {
    expect(buildBlockContextText([])).toBe('');
  });

  it('블록 내용을 포맷팅', () => {
    const blocks: EditorBlock[] = [
      { id: '1', type: 'source', content: '<p>테스트 내용</p>', hash: 'hash1', metadata: { createdAt: 0, updatedAt: 0, tags: [] } },
      { id: '2', type: 'target', content: '<h1>제목</h1>', hash: 'hash2', metadata: { createdAt: 0, updatedAt: 0, tags: [] } },
    ];
    const result = buildBlockContextText(blocks);

    expect(result).toContain('[컨텍스트 블록]');
    expect(result).toContain('테스트 내용');
    expect(result).toContain('제목');
  });

  it('HTML 태그 제거', () => {
    const blocks: EditorBlock[] = [
      { id: '1', type: 'source', content: '<p><strong>볼드</strong> 텍스트</p>', hash: 'hash1', metadata: { createdAt: 0, updatedAt: 0, tags: [] } },
    ];
    const result = buildBlockContextText(blocks);

    expect(result).not.toContain('<strong>');
    expect(result).not.toContain('</strong>');
    expect(result).toContain('볼드');
  });

  it('최대 20개 블록까지만 처리', () => {
    const blocks: EditorBlock[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      type: (i % 2 === 0 ? 'source' : 'target') as any,
      content: `<p>블록 ${i}</p>`,
      hash: `hash${i}`,
      metadata: { createdAt: 0, updatedAt: 0, tags: [] },
    }));
    const result = buildBlockContextText(blocks);

    expect(result).toContain('블록 0');
    expect(result).toContain('블록 19');
    expect(result).not.toContain('블록 20');
  });

  it('블록당 500자 제한', () => {
    const longContent = 'A'.repeat(600);
    const blocks: EditorBlock[] = [
      { id: '1', type: 'source', content: `<p>${longContent}</p>`, hash: 'hash1', metadata: { createdAt: 0, updatedAt: 0, tags: [] } },
    ];
    const result = buildBlockContextText(blocks);

    // 500자 + "..." = 503자 이하
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(600);
  });
});
