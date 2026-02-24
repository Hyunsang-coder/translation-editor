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
