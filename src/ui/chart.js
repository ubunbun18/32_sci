export class MiniChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.data = [];
        this.maxPoints = 200;
        this.resize();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        // Matches CSS size * DPR
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    push(val) {
        this.data.push(val);
        if (this.data.length > this.maxPoints) {
            this.data.shift();
        }
    }

    reset() {
        this.data = [];
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    draw(targetValue, toleranceRange) {
        if (this.data.length < 2) return;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Chart Area
        // Y-axis: auto-scale around targetValue (PI)
        const PI = Math.PI;

        // Find min/max in data to auto-zoom, but clamp to reasonable range around PI
        let min = PI - 0.0001;
        let max = PI + 0.0001;

        for (let v of this.data) {
            if (v < min) min = v;
            if (v > max) max = v;
        }

        // Add padding
        const range = max - min;
        min -= range * 0.1;
        max += range * 0.1;

        const mapY = (val) => {
            let t = (val - min) / (max - min);
            return this.height - (t * this.height); // Flip Y
        };
        const mapX = (i) => {
            return (i / (this.data.length - 1)) * this.width;
        };

        // Draw Target Line (PI)
        const yPI = mapY(Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, yPI);
        ctx.lineTo(this.width, yPI);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Data Line
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < this.data.length; i++) {
            const x = mapX(i);
            const y = mapY(this.data[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}
