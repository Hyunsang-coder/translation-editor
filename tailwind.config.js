/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 브랜드 컬러 (모드별로 CSS 변수 사용) — 액센트는 파랑 하나뿐이다
        primary: {
          50: '#f0f7ff',
          100: 'var(--accent-highlight)',
          200: '#b3d4f5',
          300: '#66a3e0',
          400: 'rgb(var(--primary-400-rgb) / <alpha-value>)', // 모드별로 다름 (아이콘/강조용)
          500: 'rgb(var(--primary-500-rgb) / <alpha-value>)', // 모드별로 다름 (버튼/주요 액션)
          600: 'rgb(var(--primary-600-rgb) / <alpha-value>)', // 모드별로 다름 (호버 상태)
          700: '#004485',
          800: '#003366',
          900: 'var(--accent-tint)',
          950: '#001a33',
          focus: 'rgb(var(--primary-focus-rgb) / <alpha-value>)', // 포커스 링 전용 — 다른 용도 금지
          // 채움 버튼 배경 전용(흰 글자 전제) — 글자색으로 쓰지 않는다
          fill: 'rgb(var(--primary-fill-rgb) / <alpha-value>)',
          'fill-hover': 'rgb(var(--primary-fill-hover-rgb) / <alpha-value>)',
        },
        // 심각도 의미색 — 검수 배지는 이 3단(critical/major/minor=primary)만 쓴다
        severity: {
          critical: 'rgb(var(--severity-critical-rgb) / <alpha-value>)',
          major: 'rgb(var(--severity-major-rgb) / <alpha-value>)',
          // 같은 색 틴트 위 글자 전용 (accent.deep과 같은 성격) — 배경으로 쓰지 않는다
          'critical-deep': 'var(--severity-critical-deep)',
          'major-deep': 'var(--severity-major-deep)',
        },
        // 에디터 전용 컬러
        editor: {
          bg: 'rgb(var(--editor-bg-rgb) / <alpha-value>)',
          raised: 'rgb(var(--editor-raised-rgb) / <alpha-value>)',
          surface: 'rgb(var(--editor-surface-rgb) / <alpha-value>)',
          border: 'rgb(var(--editor-border-rgb) / <alpha-value>)',
          hairline: 'rgb(var(--editor-hairline-rgb) / <alpha-value>)',
          text: 'rgb(var(--editor-text-rgb) / <alpha-value>)',
          muted: 'rgb(var(--editor-muted-rgb) / <alpha-value>)',
        },
        // 세그먼트/이슈 상태 액센트
        accent: {
          tint: 'var(--accent-tint)',
          highlight: 'var(--accent-highlight)',
          deep: 'var(--accent-deep)',
        },
        // Diff 시각화 컬러
        diff: {
          insertion: 'rgb(var(--diff-insertion-rgb) / <alpha-value>)',
          deletion: 'rgb(var(--diff-deletion-rgb) / <alpha-value>)',
          'insertion-bg': 'var(--diff-insertion-bg)',
          'deletion-bg': 'var(--diff-deletion-bg)',
          'insertion-deep': 'var(--diff-insertion-deep)',
        },
      },
      // index.css --font-sans와 항상 동일해야 한다 (폰트 스택 단일화)
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Pretendard Variable',
          'Pretendard',
          'Apple SD Gothic Neo',
          'Inter',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      // 타이포 5단: 11(임의값) / 12 / 13 / 15 / 30(임의값). 크기가 곧 역할이다.
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],          // 상태·보조 텍스트
        sm: ['13px', { lineHeight: '1.5', letterSpacing: '-0.01em' }], // 표준 컨트롤 라벨
        base: ['15px', { lineHeight: '1.62', letterSpacing: '-0.006em' }], // 본문
        editor: ['1rem', { lineHeight: '1.75' }],
      },
      // 굵기 3종: 400 / 600 / 700 — 500은 쓰지 않는다 (medium 호출부를 600으로 접는다)
      fontWeight: {
        medium: '600',
      },
      // 라운드 3종: 8(컨트롤·카드) / 12(오버레이 전용) / pill(배지·칩)
      borderRadius: {
        none: '0',
        sm: '8px',
        DEFAULT: '8px',
        md: '8px',
        lg: '8px',
        xl: '12px',
        '2xl': '12px',
        '3xl': '12px',
        full: '9999px',
      },
      // 그림자 1종 — 모달·팝오버·드롭다운에만. 카드·버튼에는 절대 쓰지 않는다.
      boxShadow: {
        overlay: '0 8px 30px rgba(0, 0, 0, 0.10)',
        sm: 'none',
        DEFAULT: '0 8px 30px rgba(0, 0, 0, 0.10)',
        md: '0 8px 30px rgba(0, 0, 0, 0.10)',
        lg: '0 8px 30px rgba(0, 0, 0, 0.10)',
        xl: '0 8px 30px rgba(0, 0, 0, 0.10)',
        '2xl': '0 8px 30px rgba(0, 0, 0, 0.10)',
        none: 'none',
      },
      spacing: {
        'editor-padding': '1.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

