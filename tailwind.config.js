/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 브랜드 컬러
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        // 에디터 전용 컬러
        editor: {
          bg: 'var(--editor-bg)',
          surface: 'var(--editor-surface)',
          border: 'var(--editor-border)',
          text: 'var(--editor-text)',
          muted: 'var(--editor-muted)',
        },
        // Diff 시각화 컬러
        diff: {
          insertion: 'var(--diff-insertion)',
          deletion: 'var(--diff-deletion)',
          'insertion-bg': 'var(--diff-insertion-bg)',
          'deletion-bg': 'var(--diff-deletion-bg)',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
        editor: ['Noto Sans KR', 'sans-serif'],
      },
      fontSize: {
        editor: ['1rem', { lineHeight: '1.75' }],
      },
      spacing: {
        'editor-padding': '1.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
};

