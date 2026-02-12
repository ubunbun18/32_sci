import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
    root: 'src',
    base: '/32_sci/',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    plugins: [
        topLevelAwait()
    ],
    resolve: {
        extensions: ['.js', '.ts', '.wgsl']
    },
    assetsInclude: ['**/*.wgsl'],
    server: {
        open: true
    }
});
