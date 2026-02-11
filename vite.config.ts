import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import pkg from './package.json';

// package.json에서 버전 정보를 가져옴
const appVersion = pkg.version;

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // IMPORTANT:
  // - Vite는 config 평가 시점에 NODE_ENV가 기대와 다를 수 있어(production build에서도 undefined 등)
  //   `command`(serve/build) 기준으로 분기합니다.
  // - Tauri production(asset 프로토콜)에서는 상대 경로가 필요합니다.
  const isBuild = command === 'build';

  return {
    base: isBuild ? './' : '/',
    // 보안: 기본적으로 VITE_ 프리픽스만 클라이언트에 노출합니다.
    // (BRAVE_SEARCH_API 등 비밀키는 Rust(Tauri) 백엔드에서만 읽도록 설계)
    envPrefix: ['VITE_'],
    
    // Node.js 호환성을 위한 Polyfill
    define: {
      'process.env': {},
      'process.platform': JSON.stringify(process.platform),
      'process.version': JSON.stringify(process.version),
      global: 'window',
      __APP_VERSION__: JSON.stringify(appVersion),
    },

    plugins: [
      react(),
    ],

  // Path aliases
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@editor': path.resolve(__dirname, './src/editor'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
      // Polyfill node:async_hooks for LangChain MCP Adapters
      'node:async_hooks': path.resolve(__dirname, './src/mocks/async_hooks.js'),
    },
  },

  // Build options for production
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Produce sourcemaps for debugging
    sourcemap: !!process.env.TAURI_DEBUG,
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    
    // Node.js 모듈 외부화 (빌드 시 브라우저 번들에 포함하지 않음)
    // - MCP SDK가 Node 모듈을 참조하더라도, 브라우저에서 실행될 때(Tauri) 무시되도록 함
    rollupOptions: {
        output: {
            manualChunks(id) {
                if (!id.includes('node_modules')) return undefined;

                if (
                    id.includes('/@tiptap/') ||
                    id.includes('/tiptap-markdown/')
                ) {
                    return 'tiptap-vendor';
                }

                if (id.includes('/prosemirror-')) {
                    return 'prosemirror-vendor';
                }

                if (
                    id.includes('/@langchain/') ||
                    id.includes('/langchain/')
                ) {
                    return 'langchain-vendor';
                }

                if (id.includes('/@modelcontextprotocol/')) {
                    return 'mcp-vendor';
                }

                if (id.includes('/openai/')) {
                    return 'openai-vendor';
                }

                if (id.includes('/zod/')) {
                    return 'zod-vendor';
                }

                if (
                    id.includes('/react/') ||
                    id.includes('/react-dom/') ||
                    id.includes('/scheduler/') ||
                    id.includes('/zustand/')
                ) {
                    return 'react-vendor';
                }

                return undefined;
            },
        },
        external: [
            // Node.js built-ins that shouldn't be bundled for browser
            'child_process',
            'fs',
            'path',
            'os',
            'crypto',
            'stream',
            'util',
            'events',
            'node:process',
            'node:stream',
            'node:util',
            'node:events'
        ],
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,

  server: {
    // Tauri expects a fixed port
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  };
});
