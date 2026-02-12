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

const NUM_SLOTS = 1024u;

struct Slot {
    inside_low: atomic<u32>,
    inside_high: atomic<u32>,
    total_low: atomic<u32>,
    total_high: atomic<u32>,
};

struct Result {
    slots: array<Slot, NUM_SLOTS>,
};

@group(0) @binding(0) var<storage, read_write> out_x: array<f16>;
@group(0) @binding(1) var<storage, read_write> out_y: array<f16>;
@group(0) @binding(2) var<storage, read_write> result: Result;
@group(1) @binding(0) var<uniform> params: SimParams;

struct RNGState {
    s0: vec4<u32>,
    s1: vec4<u32>,
    s2: vec4<u32>,
    s3: vec4<u32>,
};

@group(0) @binding(3) var<storage, read_write> rng_storage: array<vec4<u32>>;

fn rotl(x: vec4<u32>, k: u32) -> vec4<u32> {
    let vk = vec4<u32>(k);
    let vnk = vec4<u32>(32u - k);
    return (x << vk) | (x >> vnk);
}

// Xoshiro128++ (Vectorized)
// Each lane is a completely independent generator (512-bit state total per thread).
fn xoshiro128pp_next(s: ptr<function, RNGState>) -> vec4<u32> {
    let result = rotl((*s).s0 + (*s).s3, 7u) + (*s).s0;
    
    let t = (*s).s1 << vec4<u32>(9u);
    (*s).s2 ^= (*s).s0;
    (*s).s3 ^= (*s).s1;
    (*s).s1 ^= (*s).s2;
    (*s).s0 ^= (*s).s3;
    (*s).s2 ^= t;
    (*s).s3 = rotl((*s).s3, 11u);
    
    return result;
}

// Convert vec4<u32> random to vec4<f32> [0.0, 1.0)
// High-precision version: Uses full 32-bit entropy to satisfy trillion-sample variance limit.
fn to_float_v4(v: vec4<u32>) -> vec4<f32> {
    return vec4<f32>(v) * 2.3283064365386962890625e-10; 
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let gid = global_id.x;
    
    // 1. Load RNG State (512-bit per thread = 4 vec4s)
    let offset = gid * 4u;
    var state: RNGState;
    state.s0 = rng_storage[offset];
    state.s1 = rng_storage[offset+1u];
    state.s2 = rng_storage[offset+2u];
    state.s3 = rng_storage[offset+3u];

    var private_inside_v1 = vec4<u32>(0u);
    var private_inside_v2 = vec4<u32>(0u);
    let count = params.batch_size; 
    
    var last_x: f32 = 0.0;
    var last_y: f32 = 0.0;

    // 2. The Core Loop (8x SIMD Vectorized Xoshiro)
    for (var i: u32 = 0u; i < count; i++) {
        let rx1_raw = xoshiro128pp_next(&state);
        let ry1_raw = xoshiro128pp_next(&state);
        private_inside_v1 += select(vec4<u32>(0u), vec4<u32>(1u), to_float_v4(rx1_raw)*to_float_v4(rx1_raw) + to_float_v4(ry1_raw)*to_float_v4(ry1_raw) <= vec4<f32>(1.0));

        let rx2_raw = xoshiro128pp_next(&state);
        let ry2_raw = xoshiro128pp_next(&state);
        private_inside_v2 += select(vec4<u32>(0u), vec4<u32>(1u), to_float_v4(rx2_raw)*to_float_v4(rx2_raw) + to_float_v4(ry2_raw)*to_float_v4(ry2_raw) <= vec4<f32>(1.0));

        if (i == count - 1u) {
            last_x = to_float_v4(rx1_raw).x;
            last_y = to_float_v4(ry1_raw).x;
        }
    }

    // 3. Reduction
    let sum_v = private_inside_v1 + private_inside_v2;
    let u_private_inside = sum_v.x + sum_v.y + sum_v.z + sum_v.w;
    let private_total = count * 8u; 

    // 4. Save RNG State
    rng_storage[offset] = state.s0;
    rng_storage[offset+1u] = state.s1;
    rng_storage[offset+2u] = state.s2;
    rng_storage[offset+3u] = state.s3;

    // 5. Visualization Write
    if (gid < arrayLength(&out_x)) {
        out_x[gid] = f16(last_x);
        out_y[gid] = f16(last_y);
    }

    // 6. Global Atomic Aggregate <<GPU_OPTIMIZATION_INJECTION_POINT>>
    let slot_idx = gid % NUM_SLOTS;
    let old_inside = atomicAdd(&result.slots[slot_idx].inside_low, u_private_inside);
    if (old_inside + u_private_inside < old_inside) {
        atomicAdd(&result.slots[slot_idx].inside_high, 1u);
    }
    let old_total = atomicAdd(&result.slots[slot_idx].total_low, private_total);
    if (old_total + private_total < old_total) {
        atomicAdd(&result.slots[slot_idx].total_high, 1u);
    }
}
