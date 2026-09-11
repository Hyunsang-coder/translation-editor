import { describe, expect, it } from 'vitest';
import { plainTextToPasteHtml } from './plainTextPaste';

describe('plainTextToPasteHtml', () => {
  describe('변환이 필요 없는 입력', () => {
    it('코드/체크박스 패턴이 없으면 null을 반환해 기본 붙여넣기에 위임한다', () => {
      expect(plainTextToPasteHtml('그냥 한 줄')).toBeNull();
      expect(plainTextToPasteHtml('첫 줄\n둘째 줄\n\n다음 문단')).toBeNull();
    });

    it('빈 문자열은 null을 반환한다', () => {
      expect(plainTextToPasteHtml('')).toBeNull();
    });
  });

  describe('코드 펜스', () => {
    it('언어 정보를 language- 클래스로 옮긴다', () => {
      const html = plainTextToPasteHtml('```ts\nconst a = 1;\n```');
      expect(html).toBe('<pre><code class="language-ts">const a = 1;</code></pre>');
    });

    it('언어 정보가 없으면 class 없이 pre/code만 만든다', () => {
      const html = plainTextToPasteHtml('```\nplain\n```');
      expect(html).toBe('<pre><code>plain</code></pre>');
    });

    it('스페이스 들여쓰기·탭·펜스 내부 빈 줄을 그대로 보존한다', () => {
      const html = plainTextToPasteHtml('```py\ndef f():\n    return 1\n\n\tif x:\n\t\tpass\n```');
      expect(html).toBe(
        '<pre><code class="language-py">def f():\n    return 1\n\n\tif x:\n\t\tpass</code></pre>',
      );
    });

    it('코드 내부의 HTML 특수문자를 이스케이프한다', () => {
      const html = plainTextToPasteHtml('```\nif (a < b && c > d) x = "<br>";\n```');
      expect(html).toBe(
        '<pre><code>if (a &lt; b &amp;&amp; c &gt; d) x = "&lt;br&gt;";</code></pre>',
      );
    });

    it('닫히지 않은 펜스는 문서 끝까지 코드로 취급한다 (CommonMark)', () => {
      const html = plainTextToPasteHtml('```sh\nnpm run dev\n아직 안 닫음');
      expect(html).toBe(
        '<pre><code class="language-sh">npm run dev\n아직 안 닫음</code></pre>',
      );
    });

    it('펜스보다 긴 백틱 런으로 열면 같은 길이 이상에서만 닫는다', () => {
      const html = plainTextToPasteHtml('````\n```\ninner\n```\n````');
      expect(html).toBe('<pre><code>```\ninner\n```</code></pre>');
    });

    it('들여쓰여 열린 펜스는 펜스의 들여쓰기만큼만 벗겨낸다', () => {
      const html = plainTextToPasteHtml('  ```\n  outer\n      inner\n  ```');
      expect(html).toBe('<pre><code>outer\n    inner</code></pre>');
    });

    it('빈 코드블럭도 pre/code를 만든다', () => {
      expect(plainTextToPasteHtml('```\n```')).toBe('<pre><code></code></pre>');
    });

    it('펜스 앞뒤 산문과 함께 붙여넣으면 각각 별도 블록이 된다', () => {
      const html = plainTextToPasteHtml('설명 문단\n\n```js\nlet a;\n```\n\n마무리 문단');
      expect(html).toBe(
        '<p>설명 문단</p><pre><code class="language-js">let a;</code></pre><p>마무리 문단</p>',
      );
    });

    it('언어 정보에서 위험한 문자를 제거한다', () => {
      const html = plainTextToPasteHtml('```ts"><img src=x>\ncode\n```');
      expect(html).toBe('<pre><code class="language-ts">code</code></pre>');
    });
  });

  describe('인라인 백틱', () => {
    it('백틱으로 감싼 구간을 code 요소로 만든다', () => {
      const html = plainTextToPasteHtml('`npm run dev`로 실행한다');
      expect(html).toBe('<p><code>npm run dev</code>로 실행한다</p>');
    });

    it('한 줄에 여러 개가 있어도 각각 변환한다', () => {
      const html = plainTextToPasteHtml('`a`와 `b`를 비교');
      expect(html).toBe('<p><code>a</code>와 <code>b</code>를 비교</p>');
    });

    it('짝이 맞지 않는 백틱은 리터럴로 남긴다', () => {
      expect(plainTextToPasteHtml('가격은 `100원 정도')).toBeNull();
    });

    it('이중 백틱 안의 단일 백틱을 코드 내용으로 유지한다', () => {
      const html = plainTextToPasteHtml('``a`b``를 보라');
      expect(html).toBe('<p><code>a`b</code>를 보라</p>');
    });

    it('코드 내용의 HTML 특수문자를 이스케이프한다', () => {
      const html = plainTextToPasteHtml('`<script>` 태그');
      expect(html).toBe('<p><code>&lt;script&gt;</code> 태그</p>');
    });

    it('여러 줄에 걸친 백틱은 코드로 묶지 않는다', () => {
      expect(plainTextToPasteHtml('첫 줄에 `열고\n다음 줄에서 닫음`')).toBeNull();
    });
  });

  describe('비코드 구간의 문단 구조 (ProseMirror 기본 붙여넣기와 동일)', () => {
    // 실측: 기본 plain text 붙여넣기는 줄마다 별도 문단을 만들고 빈 줄은 버린다.
    it('줄마다 별도 문단을 만든다', () => {
      const html = plainTextToPasteHtml('첫 줄\n둘째 줄\n`code` 있는 줄');
      expect(html).toBe('<p>첫 줄</p><p>둘째 줄</p><p><code>code</code> 있는 줄</p>');
    });

    it('빈 줄은 문단을 만들지 않는다', () => {
      const html = plainTextToPasteHtml('앞\n\n\n\n`뒤`');
      expect(html).toBe('<p>앞</p><p><code>뒤</code></p>');
    });

    it('산문의 HTML 특수문자를 이스케이프한다', () => {
      const html = plainTextToPasteHtml('a < b 이고 `c` 이다');
      expect(html).toBe('<p>a &lt; b 이고 <code>c</code> 이다</p>');
    });
  });

  describe('체크박스 변환과의 우선순위', () => {
    it('체크박스 줄을 taskList로 변환한다 (기존 동작)', () => {
      const html = plainTextToPasteHtml('☐ 미완료\n☑ 완료');
      expect(html).toBe(
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p>미완료</p></li>' +
          '<li data-type="taskItem" data-checked="true"><p>완료</p></li>' +
          '</ul>',
      );
    });

    it('대괄호 체크박스도 변환한다 (기존 동작)', () => {
      const html = plainTextToPasteHtml('- [ ] 할 일\n- [x] 한 일');
      expect(html).toBe(
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p>할 일</p></li>' +
          '<li data-type="taskItem" data-checked="true"><p>한 일</p></li>' +
          '</ul>',
      );
    });

    it('펜스 내부의 [] / [x]는 태스크리스트가 아니라 코드로 유지한다', () => {
      const html = plainTextToPasteHtml('```go\nvar b []byte\n// [x] done\n```');
      expect(html).toBe(
        '<pre><code class="language-go">var b []byte\n// [x] done</code></pre>',
      );
    });

    it('펜스 내부의 유니코드 체크박스도 코드로 유지한다', () => {
      const html = plainTextToPasteHtml('```\n☑ 코드 안 체크박스\n```');
      expect(html).toBe('<pre><code>☑ 코드 안 체크박스</code></pre>');
    });

    it('펜스 밖 체크박스와 펜스 안 코드가 섞여도 각각 처리한다', () => {
      const html = plainTextToPasteHtml('☐ 확인\n\n```\nvar b []byte\n```');
      expect(html).toBe(
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p>확인</p></li>' +
          '</ul>' +
          '<pre><code>var b []byte</code></pre>',
      );
    });

    it('체크박스 줄과 산문이 한 문단에 섞이면 각각 분리한다', () => {
      const html = plainTextToPasteHtml('작업 목록\n☐ 확인\n마무리');
      expect(html).toBe(
        '<p>작업 목록</p>' +
          '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p>확인</p></li>' +
          '</ul>' +
          '<p>마무리</p>',
      );
    });

    it('체크박스 항목 안의 인라인 백틱도 코드로 변환한다', () => {
      const html = plainTextToPasteHtml('☐ `npm test` 실행');
      expect(html).toBe(
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p><code>npm test</code> 실행</p></li>' +
          '</ul>',
      );
    });
  });
});
