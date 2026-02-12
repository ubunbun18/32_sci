import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
    root: 'src',
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
