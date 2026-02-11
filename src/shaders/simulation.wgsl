// -------------------------------------------------------------------------
// Monte Carlo Pi Simulation Compute Shader
// "High Precision Mode" (PCG Hash + f32)
// -------------------------------------------------------------------------

// --- Feature Enablement ---
enable f16;
// enable subgroups; // Injected by gpu_manager.js if supported

// --- Constants ---
const WORKGROUP_SIZE = 256u;

// --- Bindings ---
struct SimParams {
    seed: u32,
    global_time: u32,
    batch_size: u32,
    write_threshold: u32,
};

struct Result {
    inside_low: atomic<u32>,
    inside_high: atomic<u32>,
    total_low: atomic<u32>,
    total_high: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> out_x: array<f16>;
@group(0) @binding(1) var<storage, read_write> out_y: array<f16>;
@group(0) @binding(2) var<storage, read_write> result: Result;
@group(1) @binding(0) var<uniform> params: SimParams;

// --- Shared Memory ---
var<workgroup> wg_inside: atomic<u32>;
var<workgroup> wg_total: atomic<u32>;

// --- Helper Functions (PCG Hash) ---
// High quality, statistically good RNG.
fn pcg_hash(input: u32) -> u32 {
    let state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

// Convert u32 random to f32 [0.0, 1.0)
fn random_float(seed: u32) -> f32 {
    // 0x3f800000 is 1.0 in float bit representation.
    // We mask random bits to mantissa (23 bits) and set exponent to 1.0 range.
    // Method: (u32 >> 9) | 0x3f800000 -> [1.0, 2.0). Then subtract 1.0.
    // This is faster than division.
    // Mantissa is 23 bits. We take top 23 bits of u32 (>> 9).
    let m = (seed >> 9u) & 0x7FFFFFu;
    let ieee = m | 0x3F800000u;
    return bitcast<f32>(ieee) - 1.0;
}

// --- Main Kernel ---
@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>
) {
    let gid = global_id.x;
    let lid = local_id.x;

    // Use unique ID sequence per thread
    // Seed strategy: Base seed + Global Thread ID + Time steps
    // To ensure quality, we use the hash of inputs as the iterator state.
    var rng_state = pcg_hash(params.seed + gid) ^ pcg_hash(params.global_time);

    var private_inside: u32 = 0u;
    let count = params.batch_size;
    
    // Visualization logic
    let write_index = gid;
    var should_write_viz = (gid < arrayLength(&out_x)); 
    var last_x: f32 = 0.0;
    var last_y: f32 = 0.0;
    var wrote_sample = false;

    // The Loop
    for (var i: u32 = 0u; i < count; i++) {
        // 1. Generate Random X
        rng_state = pcg_hash(rng_state); // Next state
        // To avoid correlation between X and Y from sequential states (though PCG is good),
        // we can mix it. But simple sequential PCG is usually fine for MC.
        let rx = random_float(rng_state);

        // 2. Generate Random Y
        rng_state = pcg_hash(rng_state);
        let ry = random_float(rng_state);

        // 3. Circle Check (Float Precision)
        let dist_sq = rx*rx + ry*ry;
        if (dist_sq <= 1.0) {
            private_inside += 1u;
        }

        // 4. Viz Capture (Store last sample)
        if (should_write_viz) {
            last_x = rx; // Already f32
            last_y = ry;
            wrote_sample = true;
        }
    }

    // --- Visualization Write ---
    if (wrote_sample) {
        // Direct f32 to f16 conversion
        out_x[write_index] = f16(last_x);
        out_y[write_index] = f16(last_y);
    }

    // --- Reduction ---
    let private_total = count; 

    // Workgroup Reduction (Shared Memory)
    // Initialize shared memory (only first thread)
    if (lid == 0u) {
        atomicStore(&wg_inside, 0u);
        atomicStore(&wg_total, 0u);
    }
    workgroupBarrier();

    // Atomic add to shared memory
    // This block MUST Match gpu_manager.js replacement target EXACTLY for Subgroups
    atomicAdd(&wg_inside, private_inside);
    atomicAdd(&wg_total, private_total);
    
    workgroupBarrier();

    // Global Reduction (64-bit)
    if (lid == 0u) {
        let final_inside = atomicLoad(&wg_inside);
        let final_total = atomicLoad(&wg_total);
        
        let old_inside = atomicAdd(&result.inside_low, final_inside);
        if (old_inside + final_inside < old_inside) {
            atomicAdd(&result.inside_high, 1u);
        }

        let old_total = atomicAdd(&result.total_low, final_total);
        if (old_total + final_total < old_total) {
            atomicAdd(&result.total_high, 1u);
        }
    }
}
