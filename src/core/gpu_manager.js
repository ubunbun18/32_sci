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
            batch_size: 64, // Default loop count per thread (x4 SIMD = 256 samples)
            write_threshold: 0
        };
        this.frameCounter = 0;

        // Settings
        this.workgroupSize = 256;
        this.maxVisualPoints = 1000000; // 1M points for visualization
    }

    async init(canvas, shaderSources) {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported on this browser.");
        }

        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });

        if (!adapter) {
            throw new Error("No appropriate GPUAdapter found.");
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
        await this.createPipelines(canvasFormat, useSubgroups, shaderSources);
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

        // Result Buffer (Atomic u32 x 4: inside_low, inside_high, total_low, total_high)
        this.buffers.result = this.device.createBuffer({
            size: 16, // 4 bytes * 4
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            label: "ResultBuffer"
        });

        // 3. Staging Buffer for reading results
        this.buffers.readback = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: "ReadbackBuffer"
        });

        // 4. Uniform Buffer
        // Struct: seed(u32), global_time(u32), batch_size(u32), threshold(u32) = 16 bytes
        this.buffers.uniform = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: "SimParamsUniform"
        });
    }

    async createPipelines(format, useSubgroups, shaderSources) {
        // --- Compute Pipeline ---
        let simCode = shaderSources.simulation;

        // Preprocessing Shader Code
        if (useSubgroups) {
            // Inject extension enable
            simCode = "enable subgroups;\n" + simCode;

            // Subgroup Optimization Injection
            // We search for the standard shared memory atomic reduction block and replace it
            // with Subgroup ops + Elected atomic reduction.
            const targetBlock = `    // Atomic add to shared memory
    atomicAdd(&wg_inside, private_inside);
    atomicAdd(&wg_total, private_total);`;

            const optimizedBlock = `    // Subgroup Optimized Reduction
    private_inside = subgroupAdd(private_inside);
    private_total = subgroupAdd(private_total);
    if (subgroupElect()) {
        atomicAdd(&wg_inside, private_inside);
        atomicAdd(&wg_total, private_total);
    }`;

            simCode = simCode.replace(targetBlock, optimizedBlock);
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
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }  // result
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
                { binding: 2, resource: { buffer: this.buffers.result } }
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

    async runFrame(dispatchCountX, dispatchCountY) {
        this.frameCounter++;
        this.simulationParams.global_time = this.frameCounter;
        this.updateParams({}); // Upload updated time

        const commandEncoder = this.device.createCommandEncoder();

        // 1. Compute Pass
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipelines.compute);
        computePass.setBindGroup(0, this.bindGroups.computeStatic);
        computePass.setBindGroup(1, this.bindGroups.computeDynamic);
        computePass.dispatchWorkgroups(dispatchCountX, dispatchCountY);
        computePass.end();

        // 2. Render Pass
        const textureView = this.context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1.0 }, // Deep Void Black with slight tint
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        renderPass.setPipeline(this.pipelines.render);
        renderPass.setBindGroup(0, this.bindGroups.render);
        // Draw as many points as buffer holds. 
        // Note: Ideally we track how many valid points were written if logic was complex,
        // but here we map buffers 1:1 to threads in a cyclic/clamped way or just draw full buffer.
        // For visual density, drawing full buffer (even if zeros initially) is fine as (0,0) is valid point (inside).
        // To be cleaner, we draw 'maxVisualPoints'.
        renderPass.draw(this.maxVisualPoints);
        renderPass.end();

        // Result Readback logic
        // 1. Copy Result to Readback (for CPU reading)
        commandEncoder.copyBufferToBuffer(
            this.buffers.result, 0,
            this.buffers.readback, 0,
            16 // 4 * 4 bytes
        );

        // 2. Clear Result Buffer for next frame
        commandEncoder.clearBuffer(this.buffers.result);

        this.device.queue.submit([commandEncoder.finish()]);

        // Readback (Async)
        await this.buffers.readback.mapAsync(GPUMapMode.READ);
        const resultData = new Uint32Array(this.buffers.readback.getMappedRange());

        // Combine Low/High to BigInt
        const insideLow = BigInt(resultData[0]);
        const insideHigh = BigInt(resultData[1]);
        const totalLow = BigInt(resultData[2]);
        const totalHigh = BigInt(resultData[3]);

        const inside = insideLow + (insideHigh << 32n);
        const total = totalLow + (totalHigh << 32n);

        this.buffers.readback.unmap();

        return { inside, total };
    }

    resetStats() {
        // Clear result buffer
        const zeros = new Uint32Array([0, 0, 0, 0]);
        this.device.queue.writeBuffer(this.buffers.result, 0, zeros);
        this.frameCounter = 0;
    }
}
