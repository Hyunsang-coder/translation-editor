/**
 * htmlContentExtractor 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  extractContentByType,
  extractSectionFromHtml,
  filterSections,
  listAvailableSections,
} from './htmlContentExtractor';

describe('extractContentByType', () => {
  const sampleHtml = `
    <h1>Title</h1>
    <p>First paragraph.</p>
    <p>Second paragraph.</p>
    <ul>
      <li>Item 1</li>
      <li>Item 2</li>
    </ul>
    <ol>
      <li>Ordered 1</li>
      <li>Ordered 2</li>
    </ol>
    <table>
      <tr><td>Cell 1</td><td>Cell 2</td></tr>
    </table>
    <h2>Subtitle</h2>
    <p>Another paragraph.</p>
  `;

  it('should return original HTML for "all" type', () => {
    const result = extractContentByType(sampleHtml, 'all');
    expect(result).toBe(sampleHtml);
  });

  it('should extract table text for "tables" type', () => {
    const result = extractContentByType(sampleHtml, 'tables');
    expect(result).toContain('Cell 1');
    expect(result).toContain('Cell 2');
    expect(result).not.toContain('paragraph');
  });

  it('should extract list text for "lists" type', () => {
    const result = extractContentByType(sampleHtml, 'lists');
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
    expect(result).toContain('Ordered 1');
    expect(result).not.toContain('paragraph');
  });

  it('should extract paragraph text for "paragraphs" type', () => {
    const result = extractContentByType(sampleHtml, 'paragraphs');
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
    expect(result).not.toContain('Item 1');
  });

  it('should extract heading text for "headings" type', () => {
    const result = extractContentByType(sampleHtml, 'headings');
    expect(result).toContain('Title');
    expect(result).toContain('Subtitle');
    expect(result).not.toContain('paragraph');
  });

  it('should return empty string for empty HTML', () => {
    expect(extractContentByType('', 'tables')).toBe('');
    expect(extractContentByType('  ', 'paragraphs')).toBe('');
  });

  it('should return empty string when no matching elements', () => {
    const noTables = '<p>Just a paragraph</p>';
    expect(extractContentByType(noTables, 'tables')).toBe('');
  });
});

describe('extractSectionFromHtml', () => {
  const htmlWithSections = `
    <h1>Introduction</h1>
    <p>Intro content here.</p>
    <h2>Background</h2>
    <p>Background info.</p>
    <h3>Details</h3>
    <p>Detailed info under background.</p>
    <h2>API Reference</h2>
    <p>API docs here.</p>
    <ul><li>Endpoint 1</li></ul>
    <h2>Conclusion</h2>
    <p>Final thoughts.</p>
  `;

  it('should extract section content until next same-level heading', () => {
    const result = extractSectionFromHtml(htmlWithSections, 'API Reference');
    expect(result).not.toBeNull();
    expect(result).toContain('API docs here');
    expect(result).toContain('Endpoint 1');
    expect(result).not.toContain('Final thoughts');
  });

  it('should extract nested section', () => {
    const result = extractSectionFromHtml(htmlWithSections, 'Background');
    expect(result).not.toBeNull();
    expect(result).toContain('Background info');
    expect(result).toContain('Details');
    expect(result).toContain('Detailed info under background');
    expect(result).not.toContain('API docs');
  });

  it('should be case-insensitive', () => {
    const result = extractSectionFromHtml(htmlWithSections, 'api reference');
    expect(result).not.toBeNull();
    expect(result).toContain('API docs here');
  });

  it('should return null for non-existent section', () => {
    const result = extractSectionFromHtml(htmlWithSections, 'Non-existent');
    expect(result).toBeNull();
  });

  it('should return null for empty inputs', () => {
    expect(extractSectionFromHtml('', 'Test')).toBeNull();
    expect(extractSectionFromHtml(htmlWithSections, '')).toBeNull();
  });

  it('should extract section that goes to end of document', () => {
    const result = extractSectionFromHtml(htmlWithSections, 'Conclusion');
    expect(result).not.toBeNull();
    expect(result).toContain('Final thoughts');
  });
});

describe('filterSections', () => {
  const htmlDoc = `
    <h1>Overview</h1>
    <p>Overview content.</p>
    <h2>Installation</h2>
    <p>Install steps.</p>
    <h2>Usage</h2>
    <p>Usage info.</p>
    <h2>Appendix</h2>
    <p>Appendix content.</p>
  `;

  describe('include mode', () => {
    it('should return only specified sections', () => {
      const result = filterSections(htmlDoc, ['Installation'], 'include');
      expect(result.html).toContain('Install steps');
      expect(result.html).not.toContain('Usage info');
      expect(result.html).not.toContain('Appendix content');
      expect(result.error).toBeUndefined();
    });

    it('should combine multiple sections', () => {
      const result = filterSections(htmlDoc, ['Installation', 'Usage'], 'include');
      expect(result.html).toContain('Install steps');
      expect(result.html).toContain('Usage info');
      expect(result.html).not.toContain('Appendix content');
    });

    it('should return error for non-existent sections', () => {
      const result = filterSections(htmlDoc, ['NonExistent'], 'include');
      expect(result.html).toBe('');
      expect(result.error).toContain('섹션을 찾을 수 없습니다');
      expect(result.availableSections).toBeDefined();
      expect(result.availableSections).toContain('Installation');
    });

    it('should handle partial match with error', () => {
      const result = filterSections(htmlDoc, ['Installation', 'NonExistent'], 'include');
      expect(result.html).toContain('Install steps');
      expect(result.error).toContain('일부 섹션을 찾을 수 없습니다');
    });
  });

  describe('exclude mode', () => {
    it('should remove specified sections', () => {
      const result = filterSections(htmlDoc, ['Appendix'], 'exclude');
      expect(result.html).toContain('Install steps');
      expect(result.html).toContain('Usage info');
      expect(result.html).not.toContain('Appendix content');
      expect(result.error).toBeUndefined();
    });

    it('should remove multiple sections', () => {
      const result = filterSections(htmlDoc, ['Usage', 'Appendix'], 'exclude');
      expect(result.html).toContain('Install steps');
      expect(result.html).not.toContain('Usage info');
      expect(result.html).not.toContain('Appendix content');
    });

    it('should warn for non-existent sections but still return remaining content', () => {
      const result = filterSections(htmlDoc, ['NonExistent'], 'exclude');
      expect(result.html).toContain('Install steps');
      expect(result.html).toContain('Usage info');
      expect(result.error).toContain('일부 섹션을 찾을 수 없습니다');
    });
  });

  it('should return original HTML when no sections specified', () => {
    const result = filterSections(htmlDoc, [], 'include');
    expect(result.html).toBe(htmlDoc);
  });
});

describe('listAvailableSections', () => {
  it('should list all headings', () => {
    const html = `
      <h1>First</h1>
      <h2>Second</h2>
      <h3>Third</h3>
      <p>Not a heading</p>
    `;
    const sections = listAvailableSections(html);
    expect(sections).toEqual(['First', 'Second', 'Third']);
  });

  it('should not include duplicates', () => {
    const html = `
      <h1>Title</h1>
      <h2>Subtitle</h2>
      <h2>Title</h2>
    `;
    const sections = listAvailableSections(html);
    expect(sections).toEqual(['Title', 'Subtitle']);
  });

  it('should return empty array for empty HTML', () => {
    expect(listAvailableSections('')).toEqual([]);
  });

  it('should return empty array for HTML without headings', () => {
    const html = '<p>Just paragraphs</p><div>And divs</div>';
    expect(listAvailableSections(html)).toEqual([]);
  });
});
