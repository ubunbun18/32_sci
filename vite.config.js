import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
    base: '/32_sci/',
    root: 'src',
    server: {
        open: true,
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        target: 'esnext'
    },
    plugins: [
        topLevelAwait()
    ],
    // WGSLファイルを文字列として扱う設定
    assetsInclude: ['**/*.wgsl']
});
