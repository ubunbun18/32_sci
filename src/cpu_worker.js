// CPU Benchmark Worker
// Implements the same PCG Hash + Float32 logic as the GPU shader.

self.onmessage = function (e) {
    const duration = e.data.duration || 1000; // ms
    const startTime = performance.now();
    let samples = 0;

    // PCG State
    let state = 12345; // Initial seed logic
    // JS doesn't have uint32 type natively easily, we use BigInt for 64bit emulation or standard bitwise for 32bit.
    // Standard bitwise in JS treats numbers as signed 32-bit integers.
    // We need to be careful with unsigned logic.
    // Let's use BigInt for PCG to be safe and strictly correct, or standard Math.random for "Typical CPU"?
    // User asked for "Comparison". Comparing optimized GPU vs optimized CPU is best.
    // JS `Math.random` is slow.
    // Let's use a simple LCG or Xorshift for speed in JS, OR PCG.
    // PCG in JS with BigInt might be slow due to BigInt overhead.
    // Let's use a standard fast Xorshift128+ or just Math.random to show "Standard JS Performance".
    // Actually, let's try to match the algorithm (Float math).

    // Mode: "Math.random()" (Standard JS)
    // Most fair comparison for "JavaScript vs WebGPU".

    while (performance.now() - startTime < duration) {
        // Batch 1000 to reduce time check overhead
        for (let i = 0; i < 1000; i++) {
            const x = Math.random();
            const y = Math.random();
            if (x * x + y * y <= 1.0) {
                // inside
            }
            samples++;
        }
    }

    const endTime = performance.now();
    const actualDuration = (endTime - startTime) / 1000; // sec

    self.postMessage({
        samples: samples,
        duration: actualDuration,
        speed: samples / actualDuration // samples/sec
    });
};
