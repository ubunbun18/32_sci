// -------------------------------------------------------------------------
// Monte Carlo Pi Rendering Shader
// "Extreme Optimization Mode" - Vertex Pulling
// -------------------------------------------------------------------------

// --- Feature Enablement ---
enable f16;

// --- Bindings ---
// Group 0: Static Resources (Same as Compute)
@group(0) @binding(0) var<storage, read> in_x: array<f16>;
@group(0) @binding(1) var<storage, read> in_y: array<f16>;
// Binding 2 (Result) is not needed for vertex shader

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

// --- Vertex Shader ---
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    // Programmable Vertex Pulling
    // Directly alias vertex_index to buffer index.
    // Note: bounds checking is handled by clamping or ensuring draw call size matches buffer.
    
    // Read f16 positions (Coalesced read if warp execution aligns with index)
    let x_f16 = in_x[vertex_index];
    let y_f16 = in_y[vertex_index];
    
    // Convert to f32 for rendering pipeline
    let x = f32(x_f16);
    let y = f32(y_f16);
    
    // Check if inside circle (x^2 + y^2 <= 1.0)
    // We visualize unit circle. 
    let dist_sq = x*x + y*y;
    let is_inside = dist_sq <= 1.0;
    
    // Color Logic
    // Inside: Cyan/Blue (0.0, 0.8, 1.0)
    // Outside: Magenta/Red (1.0, 0.0, 0.5)
    // Mixing for aesthetics
    var color: vec4<f32>;
    if (is_inside) {
        color = vec4<f32>(0.0, 0.9, 1.0, 0.8); // Cyan
    } else {
        color = vec4<f32>(1.0, 0.1, 0.5, 0.3); // Magenta, lower alpha
    }

    // Coordinate Transform
    // Map [0, 1] to Normalized Device Coordinates [-1, 1]
    // We want the circle to be centered and fit in the screen.
    // Let's assume aspect ratio handling is done by viewport or here.
    // For raw speed, we just map 0..1 to -1..1 range in a square area.
    // x_ndc = x * 2 - 1
    // y_ndc = y * 2 - 1
    // But y axis is usually up in math, down in some APIs. WebGPU is Y-up in NDC? 
    // WebGPU NDC: X[-1, 1], Y[-1, 1], Z[0, 1]. Y is up.
    
    // We'll keep it simple: map 0,0 to bottom-left (-1, -1) and 1,1 to top-right (1, 1) currently.
    // Real aspect ratio correction should happen in JS or Uniform, but for "Minimal" UI,
    // we might just stretch it or keep it square. Let's start with stretch to full canvas.
    
    var pos_x = x * 2.0 - 1.0;
    var pos_y = y * 2.0 - 1.0;
    
    // Point Size approximation? 
    // WebGPU doesn't support gl_PointSize directly in all topologies. 
    // We render as PointList.
    
    var out: VertexOutput;
    out.position = vec4<f32>(pos_x, pos_y, 0.0, 1.0);
    out.color = color;
    return out;
}

// --- Fragment Shader ---
@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}
