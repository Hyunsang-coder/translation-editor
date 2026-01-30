/**
 * Confluence 페이지 ADF 구조 확인용 스크립트
 *
 * 사용법:
 * npx tsx scripts/fetch-adf.ts <page_id>
 *
 * 환경변수 필요:
 * - ATLASSIAN_CLOUD_ID
 * - ATLASSIAN_ACCESS_TOKEN
 */

const pageId = process.argv[2] || '873302865';

async function fetchAdf() {
  const cloudId = process.env.ATLASSIAN_CLOUD_ID;
  const token = process.env.ATLASSIAN_ACCESS_TOKEN;

  if (!cloudId || !token) {
    console.error('환경변수 ATLASSIAN_CLOUD_ID와 ATLASSIAN_ACCESS_TOKEN이 필요합니다.');
    console.log('\n앱에서 ADF를 가져오는 방법:');
    console.log('1. npm run tauri:dev로 앱 실행');
    console.log('2. 개발자 도구 콘솔에서:');
    console.log(`   await window.__TAURI__.core.invoke('mcp_call_tool', {
     name: 'getConfluencePage',
     arguments: { cloudId: '<your-cloud-id>', pageId: '${pageId}', contentFormat: 'adf' }
   })`);
    return;
  }

  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    console.error('API 오류:', response.status, await response.text());
    return;
  }

  const data = await response.json();
  const adf = JSON.parse(data.body.atlas_doc_format.value);

  console.log('=== ADF 구조 ===\n');
  console.log(JSON.stringify(adf, null, 2));

  // layoutSection 구조 분석
  console.log('\n=== layoutSection 분석 ===\n');
  analyzeLayout(adf.content, 0);
}

function analyzeLayout(nodes: any[], depth: number) {
  const indent = '  '.repeat(depth);

  for (const node of nodes) {
    if (node.type === 'layoutSection') {
      console.log(`${indent}📐 layoutSection`);
      if (node.content) {
        analyzeLayout(node.content, depth + 1);
      }
    } else if (node.type === 'layoutColumn') {
      const width = node.attrs?.width || '?';
      console.log(`${indent}📊 layoutColumn (width: ${width}%)`);
      if (node.content) {
        analyzeLayout(node.content, depth + 1);
      }
    } else if (node.type === 'heading') {
      const level = node.attrs?.level || '?';
      const text = extractText(node);
      console.log(`${indent}📝 h${level}: "${text}"`);
    } else if (node.content) {
      analyzeLayout(node.content, depth + 1);
    }
  }
}

function extractText(node: any): string {
  if (node.type === 'text') return node.text || '';
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

fetchAdf();
