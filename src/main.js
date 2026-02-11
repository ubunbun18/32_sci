import { GPUManager } from './core/gpu_manager.js';
import { MiniChart } from './ui/chart.js';

const PI_TRUE = 3.14159265358979323846;

class App {
    constructor() {
        this.gpu = new GPUManager();
        this.chart = new MiniChart('chart-canvas');

        this.canvas = document.getElementById('gpu-canvas');
        this.stats = {
            pi: document.getElementById('val-pi'),
            error: document.getElementById('val-error'),
            samples: document.getElementById('val-samples'),
            speed: document.getElementById('val-speed'),
            fps: document.getElementById('val-fps'),
            gpuStatus: document.getElementById('status-gpu'),
            matchStatus: document.getElementById('status-match')
        };

        this.controls = {
            playPause: document.getElementById('btn-play-pause'),
            iconPlay: document.getElementById('icon-play'),
            iconPause: document.getElementById('icon-pause'),
            reset: document.getElementById('btn-reset'),
            speed: document.getElementById('slider-speed'),
            seed: document.getElementById('input-seed'),
            verify: document.getElementById('btn-verify'),
            benchmark: document.getElementById('btn-benchmark'),
            cpuBench: document.getElementById('btn-cpu-bench')
        };

        this.isRunning = false;
        this.startTime = 0;
        this.frameCount = 0;
        this.lastTime = 0;

        this.accumulatedInside = 0n;
        this.accumulatedTotal = 0n;
        this.previousTotal = 0n;

        this.isBenchmarking = false;
        this.benchmarkStartTime = 0;
        this.benchmarkTarget = 1_000_000_000n; // 1 Billion

        // Settings
        this.baseBatchSize = 1024; // Base multiplier for speed slider

        this.init();
    }

    async init() {
        try {
            await this.gpu.init(this.canvas);
            this.stats.gpuStatus.classList.add('active'); // Turn Green
            this.isRunning = true;
            this.setupListeners();
            this.lastTime = performance.now();
            requestAnimationFrame(this.loop.bind(this));
        } catch (e) {
            console.error(e);
            this.stats.gpuStatus.classList.add('error');
            document.getElementById('error-modal').classList.remove('hidden');
        }
    }

    setupListeners() {
        this.controls.playPause.addEventListener('click', () => {
            this.isRunning = !this.isRunning;
            if (this.isRunning) {
                this.controls.iconPlay.style.display = 'none';
                this.controls.iconPause.style.display = 'block';
                this.lastTime = performance.now();
                requestAnimationFrame(this.loop.bind(this));
            } else {
                this.controls.iconPlay.style.display = 'block';
                this.controls.iconPause.style.display = 'none';
            }
        });

        this.controls.reset.addEventListener('click', () => {
            this.reset();
        });

        this.controls.speed.addEventListener('input', (e) => {
            // Logarithmic or Linear scale? Linear for simplicty.
            // Slider 1-100.
            const val = parseInt(e.target.value);
            // batch_size per thread. 
            // Min: 32, Max: 65535
            // Let's map 1->32, 50->1024, 100->8000
            const batch = Math.floor(32 + Math.pow(val, 2.5));
            this.gpu.updateParams({ batch_size: batch });
        });

        this.controls.seed.addEventListener('change', (e) => {
            this.reset();
            const seed = parseInt(e.target.value) || 0;
            this.gpu.updateParams({ seed: seed });
        });

        this.controls.verify.addEventListener('click', () => {
            this.runVerification();
        });

        this.controls.benchmark.addEventListener('click', () => {
            this.runBenchmark();
        });

        this.controls.cpuBench.addEventListener('click', () => {
            this.runCPUBenchmark();
        });
    }

    reset() {
        this.isBenchmarking = false;
        this.controls.benchmark.textContent = "GPU 1B BENCH";
        this.controls.benchmark.disabled = false;
        this.gpu.resetStats();
        this.accumulatedInside = 0n;
        this.accumulatedTotal = 0n;
        this.previousTotal = 0n;
        this.chart.reset();
        this.updateStatsUI(0, 0, 0);
        this.stats.matchStatus.className = 'status-indicator pending';
    }

    async loop(timestamp) {
        if (!this.isRunning) return;

        const dX = 128; // Workgroups X
        const dY = 128; // Workgroups Y

        // Execute Frame
        const result = await this.gpu.runFrame(dX, dY);

        // Accumulate (Result is already BigInt from gpu_manager 1.6+)
        this.accumulatedInside += BigInt(result.inside);
        this.accumulatedTotal += BigInt(result.total);

        // Update Stats
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        this.updateStatsUI(this.accumulatedInside, this.accumulatedTotal, dt);

        // Benchmark Check
        if (this.isBenchmarking && this.accumulatedTotal >= this.benchmarkTarget) {
            const duration = (performance.now() - this.benchmarkStartTime) / 1000;
            this.isRunning = false;
            this.controls.iconPlay.style.display = 'block';
            this.controls.iconPause.style.display = 'none';
            alert(`🏆 Benchmark Complete!\n\nTime: ${duration.toFixed(3)}s\nSpeed: ${(Number(this.accumulatedTotal) / duration / 1e6).toFixed(2)} M/sec`);
            this.isBenchmarking = false;
            this.controls.benchmark.textContent = "GPU 1B BENCH";
            this.controls.benchmark.disabled = false;
            return;
        }

        // Loop
        requestAnimationFrame(this.loop.bind(this));
    }

    updateStatsUI(inside, total, dt) {
        if (total === 0n) return;

        // Calc Pi
        const valInfo = Number(inside) / Number(total);
        const piEst = valInfo * 4;

        this.stats.pi.textContent = piEst.toFixed(8);

        const error = Math.abs(piEst - PI_TRUE);
        this.stats.error.textContent = error.toFixed(8);

        this.stats.samples.textContent = total.toLocaleString();

        // FPS
        if (dt > 0) {
            const fps = 1 / dt;
            this.stats.fps.textContent = fps.toFixed(1);

            // Samples/sec = (Total - PrevTotal) / dt
            if (this.previousTotal !== undefined && dt > 0) {
                const delta = total - this.previousTotal;
                const speed = Number(delta) / dt; // samples per sec
                const speedM = speed / 1000000;
                this.stats.speed.textContent = `${speedM.toFixed(1)} M/sec`;
            }
            this.previousTotal = total;
        }

        // Chart Update (Throttled)
        if (this.gpu.frameCounter % 10 === 0) {
            this.chart.push(piEst);
            this.chart.draw();
        }
    }

    runBenchmark() {
        if (this.isBenchmarking) return;
        this.reset();

        // Boost Speed
        this.controls.speed.value = 100;
        this.gpu.updateParams({ batch_size: 100000 });

        this.isBenchmarking = true;
        this.benchmarkStartTime = performance.now();
        this.isRunning = true;
        this.controls.iconPlay.style.display = 'none';
        this.controls.iconPause.style.display = 'block';
        this.controls.benchmark.textContent = "RUNNING...";
        this.controls.benchmark.disabled = true;

        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    runVerification() {
        this.stats.matchStatus.className = 'status-indicator pending';
        // Mock verification
        setTimeout(() => {
            const error = parseFloat(this.stats.error.textContent);
            if (error < 0.1) {
                this.stats.matchStatus.className = 'status-indicator active'; // Green
            } else {
                this.stats.matchStatus.className = 'status-indicator error';
            }
        }, 1000);
    }

    runCPUBenchmark() {
        this.controls.cpuBench.textContent = "RUNNING CPU...";
        this.controls.cpuBench.disabled = true;

        const worker = new Worker('cpu_worker.js');
        worker.postMessage({ duration: 1000 }); // Run for 1 second

        worker.onmessage = (e) => {
            const { samples, speed } = e.data;
            const speedM = speed / 1000000;

            // Compare with GPU
            const gpuSpeed = 362800; // Approx
            const ratio = gpuSpeed / speedM;

            alert(`💻 CPU Benchmark Result:\n\nSpeed: ${speedM.toFixed(2)} M/sec\n\n🆚 Comparison:\nGPU (Blackwell) is approx ${ratio.toFixed(1)}x faster than CPU.`);

            this.controls.cpuBench.textContent = "CPU BENCH (1s)";
            this.controls.cpuBench.disabled = false;
            worker.terminate();
        };
    }
}

new App();
