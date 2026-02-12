export class GPUManager {
    constructor() {
        this.device = null;
        this.context = null;
        this.pipelines = {};
        this.buffers = {};
        this.bindGroups = {};
        this.simulationParams = {
            seed: 0,
            global_time: 0,
            batch_size: 64, // 64 loops * 8 samples = 512 samples per thread
            write_threshold: 0
        };
        this.frameCounter = 0;
        this.isReading = false;
        this.lastResult = { inside: 0n, total: 0n };

        // Settings
        this.workgroupSize = 256;
        this.maxVisualPoints = 1048576;

        // RNG State Management (128-bit state per thread)
        this.totalThreads = 128 * 256; // 32,768 threads fixed
        this.rngStateBuffer = null;
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async init(canvas, shaderSources) {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported on this browser.");
        }

        console.log("🔍 Attempting to request WebGPU Adapter...");

        // Strategy 1: High-Performance
        let adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });

        // Strategy 2: Default
        if (!adapter) {
            console.warn("⚠️ High-performance adapter locked or not found. Retrying with default...");
            adapter = await navigator.gpu.requestAdapter();
        }

        // Strategy 3: Fallback (Software or low-power if allowed)
        if (!adapter) {
            console.warn("🚨 All standard GPU adapters are locked. Attempting emergency fallback adapter...");
            adapter = await navigator.gpu.requestAdapter({
                forceFallbackAdapter: true
            });
        }

        if (!adapter) {
            const platformInfo = navigator.userAgent;
            throw new Error(`CRITICAL: WebGPU Context Provider is DEADLOCKED. 
            GPU Process has hung after extreme Blackwell Benchmarking.
            User Agent: ${platformInfo}
            ACTION REQUIRED: Please FULLY RESTART THE BROWSER (Close all tabs).`);
        }

        // Check features
        const requiredFeatures = [];
        if (adapter.features.has("shader-f16")) {
            requiredFeatures.push("shader-f16");
        } else {
            throw new Error("Device does not support 'shader-f16'. This app requires f16 for optimization.");
        }

        // Enable Subgroups if available
        let useSubgroups = false;
        if (adapter.features.has("subgroups")) {
            requiredFeatures.push("subgroups");
            useSubgroups = true;
            console.log("🚀 Subgroups feature detected! Enabling Extreme Mode.");
        }

        this.device = await adapter.requestDevice({
            requiredFeatures: requiredFeatures
        });

        this.context = canvas.getContext("webgpu");
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: canvasFormat,
            alphaMode: "premultiplied"
        });

        await this.createResources();
        await this.initSimulationPipeline(canvasFormat, useSubgroups, shaderSources);
        console.log("WebGPU Initialized. Recommended Adapter:", adapter.info);
    }

    async createResources() {
        // 1. Buffers for SoA Visualization (f16)
        // Size: maxVisualPoints * 2 bytes (f16 is 2 bytes)
        const vizBufferSize = this.maxVisualPoints * 2;

        // Align to 4 bytes just in case, though f16 array usually tightly packed?
        // WGSL array<f16> stride is 2 bytes.

        this.buffers.outX = this.device.createBuffer({
            size: vizBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
            label: "OutputBufferX"
        });

        this.buffers.outY = this.device.createBuffer({
            size: vizBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
            label: "OutputBufferY"
        });

        // Result Buffer (1024 slots * 16 bytes = 16384 bytes)
        const resultBufferSize = 1024 * 16;

        this.buffers.result = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            label: "ResultBuffer"
        });

        // 3. Staging Buffer for reading results
        this.buffers.readback = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: "ReadbackBuffer"
        });

        this.buffers.uniform = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "SimParamsUniform"
        });

        // 5. RNG State Buffer (Xoshiro128++ Vectorized)
        // 16 x u32 (64 bytes) per thread for true 4-wide SIMD independence
        const rngBufferSize = this.totalThreads * 64;
        this.buffers.rngState = this.device.createBuffer({
            size: rngBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: "RNGStateBuffer"
        });

        // Initialize RNG states with high-quality random seeds
        const seedData = new Uint32Array(this.totalThreads * 16);
        const CHUNK_SIZE = 16384;
        for (let i = 0; i < seedData.length; i += CHUNK_SIZE) {
            const chunk = seedData.subarray(i, Math.min(i + CHUNK_SIZE, seedData.length));
            crypto.getRandomValues(chunk);
        }

        // Secure RNG: Ensure non-zero state for Xoshiro
        for (let i = 0; i < seedData.length; i += 4) {
            if (seedData[i] === 0 && seedData[i + 1] === 0 && seedData[i + 2] === 0 && seedData[i + 3] === 0) {
                seedData[i] = 0x9E3779B9; // Standard constant to break zero-state
            }
        }

        this.device.queue.writeBuffer(this.buffers.rngState, 0, seedData);
    }

    async initSimulationPipeline(format, useSubgroups, shaderSources) {
        let simCode = shaderSources.simulation;

        if (useSubgroups) {
            console.log("🛠️ Injecting Blackwell Subgroup Optimization...");
            // Inject extension enable
            simCode = "enable subgroups;\n" + simCode;

            const injectionTag = "<<GPU_OPTIMIZATION_INJECTION_POINT>>";
            const optimizedBlock = `
    // --- Subgroup Optimized Reduction (Blackwell Mode) ---
    let slot_idx = gid % NUM_SLOTS;
    let wg_inside = subgroupAdd(u_private_inside);
    let wg_total = subgroupAdd(private_total);

    if (subgroupElect()) {
        let low_i = atomicAdd(&result.slots[slot_idx].inside_low, wg_inside);
        if (low_i + wg_inside < low_i) {
            atomicAdd(&result.slots[slot_idx].inside_high, 1u);
        }
        let low_t = atomicAdd(&result.slots[slot_idx].total_low, wg_total);
        if (low_t + wg_total < low_t) {
            atomicAdd(&result.slots[slot_idx].total_high, 1u);
        }
    }
    return; // Final Blackwell exit
`;
            // 🚨 IMPROVED REGEX: matches from the injection tag to the very end of the function.
            // This ensures NO default code is left behind.
            const totalReplacementPattern = new RegExp(this.escapeRegExp(injectionTag) + "[\\s\\S]*?(?=^}$)", "m");
            simCode = simCode.replace(totalReplacementPattern, injectionTag + optimizedBlock);
        }

        const simulationModule = this.device.createShaderModule({
            label: "Simulation Shader",
            code: simCode
        });

        // Bind Group Layout 0: Static Storage
        this.bindGroupLayouts = {};
        this.bindGroupLayouts.static = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out_x
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out_y
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // result
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }  // rng_state
            ]
        });

        // Bind Group Layout 1: Dynamic Uniforms
        this.bindGroupLayouts.dynamic = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
            ]
        });

        this.pipelines.compute = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayouts.static, this.bindGroupLayouts.dynamic]
            }),
            compute: {
                module: simulationModule,
                entryPoint: "main"
            }
        });

        // --- Render Pipeline ---
        const renderModule = this.device.createShaderModule({
            label: "Render Shader",
            code: shaderSources.render
        });

        // For rendering, we need readonly access to f16 buffers from Vertex stage
        this.bindGroupLayouts.render = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }
            ]
        });

        this.pipelines.render = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayouts.render]
            }),
            vertex: {
                module: renderModule,
                entryPoint: "vs_main"
            },
            fragment: {
                module: renderModule,
                entryPoint: "fs_main",
                targets: [{
                    format: format,
                    blend: {
                        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                        alpha: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" } // Premultiplied
                    }
                }]
            },
            primitive: {
                topology: "point-list"
            }
        });

        // --- Create Bind Groups ---
        // Static Compute BG
        this.bindGroups.computeStatic = this.device.createBindGroup({
            layout: this.bindGroupLayouts.static,
            entries: [
                { binding: 0, resource: { buffer: this.buffers.outX } },
                { binding: 1, resource: { buffer: this.buffers.outY } },
                { binding: 2, resource: { buffer: this.buffers.result } },
                { binding: 3, resource: { buffer: this.buffers.rngState } }
            ]
        });

        // Dynamic Compute BG
        this.bindGroups.computeDynamic = this.device.createBindGroup({
            layout: this.bindGroupLayouts.dynamic,
            entries: [
                { binding: 0, resource: { buffer: this.buffers.uniform } }
            ]
        });

        // Render BG
        this.bindGroups.render = this.device.createBindGroup({
            layout: this.bindGroupLayouts.render,
            entries: [
                { binding: 0, resource: { buffer: this.buffers.outX } },
                { binding: 1, resource: { buffer: this.buffers.outY } }
            ]
        });
    }

    updateParams(newParams) {
        Object.assign(this.simulationParams, newParams);

        // Upload to Uniform Buffer
        const uniformData = new Uint32Array([
            this.simulationParams.seed,
            this.simulationParams.global_time,
            this.simulationParams.batch_size,
            this.simulationParams.write_threshold
        ]);
        this.device.queue.writeBuffer(this.buffers.uniform, 0, uniformData);
    }

    async runFrame(dispatchCountX, dispatchCountY, options = { render: true, readback: true }) {
        this.frameCounter++;
        this.simulationParams.global_time = this.frameCounter;
        this.updateParams({});

        const commandEncoder = this.device.createCommandEncoder();

        // 1. Compute Pass (Always active)
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipelines.compute);
        computePass.setBindGroup(0, this.bindGroups.computeStatic);
        computePass.setBindGroup(1, this.bindGroups.computeDynamic);
        computePass.dispatchWorkgroups(dispatchCountX, dispatchCountY);
        computePass.end();

        // 2. Render Pass
        if (options.render) {
            const textureView = this.context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: textureView,
                    clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1.0 },
                    loadOp: "clear",
                    storeOp: "store"
                }]
            });
            renderPass.setPipeline(this.pipelines.render);
            renderPass.setBindGroup(0, this.bindGroups.render);
            renderPass.draw(this.maxVisualPoints);
            renderPass.end();
        }

        // --- CRITICAL FIX: Safe Readback Handling ---
        // If readback is requested AND we are not already waiting for a previous one
        if (options.readback && !this.isReading) {
            // Check mapping state to avoid "Buffer used in submit while mapped" error
            // Unfortunately WebGPU doesn't have a synchronous "isMapped" check, 
            // so we rely on our 'isReading' flag which MUST be perfectly managed.

            commandEncoder.copyBufferToBuffer(
                this.buffers.result, 0,
                this.buffers.readback, 0,
                this.buffers.result.size
            );

            // Clear Result for next cycle
            commandEncoder.clearBuffer(this.buffers.result);

            this.device.queue.submit([commandEncoder.finish()]);

            // Start async readback
            this.isReading = true;
            try {
                await this.buffers.readback.mapAsync(GPUMapMode.READ);
                const resultData = new Uint32Array(this.buffers.readback.getMappedRange());

                let totalInside = 0n;
                let totalTotal = 0n;

                // Sum all slots
                for (let i = 0; i < 1024; i++) {
                    const base = i * 4;
                    totalInside += BigInt(resultData[base]) + (BigInt(resultData[base + 1]) << 32n);
                    totalTotal += BigInt(resultData[base + 2]) + (BigInt(resultData[base + 3]) << 32n);
                }

                this.buffers.readback.unmap();
                this.lastResult = { inside: totalInside, total: totalTotal };
                return this.lastResult;
            } catch (e) {
                console.warn("Readback failed or aborted:", e);
                return this.lastResult;
            } finally {
                this.isReading = false;
            }
        } else {
            // Normal case: Just compute
            this.device.queue.submit([commandEncoder.finish()]);

            // Optional: Wait for GPU to finish work if sync is requested (but no data read)
            if (options.sync) {
                await this.device.queue.onSubmittedWorkDone();
            }

            return this.lastResult;
        }
    }

    resetStats() {
        // Clear result buffer (4096 bytes)
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.clearBuffer(this.buffers.result);
        this.device.queue.submit([commandEncoder.finish()]);
        this.frameCounter = 0;
        this.lastResult = { inside: 0n, total: 0n }; // Reset internal BIGINT cache
    }
}
