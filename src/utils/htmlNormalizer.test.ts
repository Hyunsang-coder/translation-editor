/**
 * htmlNormalizer 테스트
 */

import { describe, it, expect } from 'vitest';
import { normalizePastedHtml } from './htmlNormalizer';

describe('removeDuplicateTableHeaders', () => {
  it('표 앞 p 태그가 헤더와 동일한 텍스트면 제거 (기존 동작)', () => {
    const html = `
      <p>Asset | Image | Feedback</p>
      <table>
        <thead><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></thead>
        <tbody><tr><td>Item1</td><td>Img1</td><td>FB1</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
    // p 태그 제거 확인
    expect(result).not.toMatch(/<p>\s*Asset/);
  });

  it('sticky header: 앞 표가 thead만 있고 본문 표와 헤더가 같으면 앞 표 제거', () => {
    // sticky header 복사 패턴: 헤더 전용 표 + 실제 전체 표
    const html = `
      <table>
        <thead><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></thead>
      </table>
      <table>
        <thead><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></thead>
        <tbody><tr><td>NS_ERA_Car</td><td>img</td><td>feedback text</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
    // 실제 데이터가 있는 표가 남아야 함
    expect(result).toContain('NS_ERA_Car');
  });

  it('sticky header: 앞 표의 tbody가 비어 있는 경우도 제거', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody></tbody>
      </table>
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>Foo</td><td>Bar</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
    expect(result).toContain('Foo');
  });

  it('sticky header: 앞 표가 tbody 안의 th 헤더 한 줄로 복사되어도 제거', () => {
    const html = `
      <table>
        <tbody><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></thead>
        <tbody><tr><td>NS_ERA_Car</td><td>img</td><td>feedback text</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
    expect(result).toContain('NS_ERA_Car');
  });

  it('sticky header: 앞 표가 td만 있는 헤더 클론이어도 제거', () => {
    const html = `
      <table>
        <tbody><tr><td>Asset</td><td>Image</td><td>Feedback</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Asset</th><th>Image</th><th>Feedback</th></tr></thead>
        <tbody><tr><td>NS_ERA_Car</td><td>img</td><td>feedback text</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(1);
    expect(result).toContain('NS_ERA_Car');
  });

  it('두 표의 헤더가 다르면 둘 다 유지', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Age</th></tr></thead>
        <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Product</th><th>Price</th></tr></thead>
        <tbody><tr><td>Widget</td><td>9.99</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(2);
  });

  it('앞 표가 데이터 행을 포함하면 제거하지 않음', () => {
    // 앞 표에도 tbody 행이 있으면 단순 sticky header가 아님
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>SomeData</td><td>123</td></tr></tbody>
      </table>
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>Foo</td><td>Bar</td></tr></tbody>
      </table>
    `;
    const result = normalizePastedHtml(html);
    const tableCount = (result.match(/<table/g) ?? []).length;
    expect(tableCount).toBe(2);
  });
});

describe('ordered list start 속성 보존', () => {
  it('Confluence처럼 코드블록으로 쪼개진 <ol start="N"> 연속 번호를 유지', () => {
    // Confluence ADF 렌더러는 리스트 사이에 다른 블록이 끼면
    // <ol start="N">으로 쪼개서 번호를 이어간다.
    // 픽스처: PUBGUE5-15066 재현 단계 페이지의 실제 본문에서 2번 항목까지 발췌.
    // 래퍼 div는 실제 클립보드 복사 시 붙는 렌더러 컨테이너(inline style 포함)로,
    // shouldNormalizePastedHtml 게이트를 통과시켜 sanitize 경로를 태운다.
    const html = `<div class="ak-renderer-document" style="margin: 0px;"><h3 data-local-id="029c995ae8d2">단계</h3><ol data-local-id="b105d1c32ff1"><li data-local-id="d7799881853e"><p data-local-id="3cd5fc5af626">로컬 데디케이티드 서버로 <code>IBR_Erangel</code>에 입장한다.</p></li></ol><ol data-local-id="61ed92d3baad" start="2"><li data-local-id="db290015a15e"><p data-local-id="69bd5a3dd8a9">남성 캐릭터에서 다음 순서로 맨몸 상태를 만든다.</p></li></ol><pre data-local-id="9e012900-a2e8-4931-8f1e-aa1a45b5a2d5"><code class="language-plaintext">   Admin ClearInventory
   Admin MS2Set 0
   Admin ClearInventory</code></pre></div>`;
    const result = normalizePastedHtml(html);
    expect(result).toContain('start="2"');
  });
});
