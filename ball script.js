const video = document.getElementById("video");
const canvas = document.getElementById("trackingCanvas");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const trackingButton = document.getElementById("trackingButton");

const cameraMessage = document.getElementById("cameraMessage");
const statusText = document.getElementById("status");
const speedText = document.getElementById("speed");
const distanceText = document.getElementById("distance");

let stream = null;
let tracking = false;
let animationId = null;
let previousFrame = null;

let trail = [];
let lastPosition = null;
let lastTime = 0;

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", {
    willReadFrequently: true
});

const scanWidth = 240;
const scanHeight = 135;

scanCanvas.width = scanWidth;
scanCanvas.height = scanHeight;

async function startCamera() {
    try {
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera not supported");
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        video.srcObject = stream;

        await video.play();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        cameraMessage.textContent = "Camera ON";
        statusText.textContent = "Camera Active";

        previousFrame = null;
        trail = [];
        lastPosition = null;

    } catch (error) {
        cameraMessage.textContent = "Camera Error";
        statusText.textContent = error.name;
        console.log(error);
    }
}

function stopCamera() {
    tracking = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    trail = [];
    lastPosition = null;
    previousFrame = null;

    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";

    trackingButton.textContent = "START TRACKING";
}

function startTracking() {
    if (!stream) {
        statusText.textContent = "Start camera first";
        return;
    }

    tracking = !tracking;

    if (tracking) {
        trackingButton.textContent = "STOP TRACKING";
        statusText.textContent = "Searching for ball...";
        trail = [];
        lastPosition = null;
        previousFrame = null;
        lastTime = performance.now();
        trackBall();
    } else {
        trackingButton.textContent = "START TRACKING";
        statusText.textContent = "Tracking stopped";

        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function isBallColor(r, g, b) {

    const redBall =
        r > 100 &&
        r > g * 1.35 &&
        r > b * 1.35;

    const whiteBall =
        r > 170 &&
        g > 170 &&
        b > 170 &&
        Math.max(r, g, b) - Math.min(r, g, b) < 45;

    return redBall || whiteBall;
}

function detectBall() {

    scanCtx.drawImage(
        video,
        0,
        0,
        scanWidth,
        scanHeight
    );

    const frame = scanCtx.getImageData(
        0,
        0,
        scanWidth,
        scanHeight
    );

    const pixels = frame.data;

    if (!previousFrame) {
        previousFrame = new Uint8ClampedArray(pixels);
        return null;
    }

    const visited = new Uint8Array(scanWidth * scanHeight);
    const candidates = [];

    for (let y = 2; y < scanHeight - 2; y += 2) {

        for (let x = 2; x < scanWidth - 2; x += 2) {

            const pixelIndex = (y * scanWidth + x) * 4;
            const gridIndex = y * scanWidth + x;

            if (visited[gridIndex]) {
                continue;
            }

            const r = pixels[pixelIndex];
            const g = pixels[pixelIndex + 1];
            const b = pixels[pixelIndex + 2];

            const pr = previousFrame[pixelIndex];
            const pg = previousFrame[pixelIndex + 1];
            const pb = previousFrame[pixelIndex + 2];

            const movement =
                Math.abs(r - pr) +
                Math.abs(g - pg) +
                Math.abs(b - pb);

            if (movement < 45 || !isBallColor(r, g, b)) {
                continue;
            }

            let queue = [[x, y]];
            visited[gridIndex] = 1;

            let totalX = 0;
            let totalY = 0;
            let count = 0;

            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;

            while (queue.length > 0) {

                const point = queue.pop();
                const px = point[0];
                const py = point[1];

                const pi = (py * scanWidth + px) * 4;

                const rr = pixels[pi];
                const gg = pixels[pi + 1];
                const bb = pixels[pi + 2];

                const ppi = (py * scanWidth + px) * 4;

                const move =
                    Math.abs(rr - previousFrame[ppi]) +
                    Math.abs(gg - previousFrame[ppi + 1]) +
                    Math.abs(bb - previousFrame[ppi + 2]);

                if (move < 35 || !isBallColor(rr, gg, bb)) {
                    continue;
                }

                totalX += px;
                totalY += py;
                count++;

                minX = Math.min(minX, px);
                maxX = Math.max(maxX, px);
                minY = Math.min(minY, py);
                maxY = Math.max(maxY, py);

                const neighbours = [
                    [px + 2, py],
                    [px - 2, py],
                    [px, py + 2],
                    [px, py - 2]
                ];

                for (const n of neighbours) {

                    const nx = n[0];
                    const ny = n[1];

                    if (
                        nx >= 2 &&
                        nx < scanWidth - 2 &&
                        ny >= 2 &&
                        ny < scanHeight - 2
                    ) {

                        const ni = ny * scanWidth + nx;

                        if (!visited[ni]) {
                            visited[ni] = 1;
                            queue.push([nx, ny]);
                        }
                    }
                }
            }

            const width = maxX - minX;
            const height = maxY - minY;

            if (
                count >= 3 &&
                count <= 180 &&
                width <= 45 &&
                height <= 45
            ) {
                candidates.push({
                    x: totalX / count,
                    y: totalY / count,
                    size: count
                });
            }
        }
    }

    previousFrame = new Uint8ClampedArray(pixels);

    if (candidates.length === 0) {
        return null;
    }

    let best = candidates[0];

    if (lastPosition) {

        let bestDistance = Infinity;

        for (const candidate of candidates) {

            const dx = candidate.x - lastPosition.x;
            const dy = candidate.y - lastPosition.y;

            const distance = Math.sqrt(
                dx * dx + dy * dy
            );

            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
    }

    return {
        x: best.x * canvas.width / scanWidth,
        y: best.y * canvas.height / scanHeight
    };
}

function drawBall(position) {

    ctx.beginPath();
    ctx.arc(position.x, position.y, 20, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(position.x, position.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
}

function drawTrail() {

    if (trail.length < 2) {
        return;
    }

    ctx.beginPath();

    ctx.moveTo(
        trail[0].x,
        trail[0].y
    );

    for (let i = 1; i < trail.length; i++) {

        ctx.lineTo(
            trail[i].x,
            trail[i].y
        );
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();
}

function calculateMovement(position) {

    const now = performance.now();

    if (lastPosition) {

        const dx = position.x - lastPosition.x;
        const dy = position.y - lastPosition.y;

        const pixels = Math.sqrt(
            dx * dx + dy * dy
        );

        const timeSeconds =
            (now - lastTime) / 1000;

        if (timeSeconds > 0) {

            const pixelsPerSecond =
                pixels / timeSeconds;

            const estimatedSpeed =
                pixelsPerSecond * 0.15;

            const kmh =
                estimatedSpeed * 3.6;

            if (kmh < 250) {
                speedText.textContent =
                    kmh.toFixed(1) + " km/h";
            }
        }
    }

    lastPosition = position;
    lastTime = now;
}

function trackBall() {

    if (!tracking || !stream) {
        return;
    }

    const position = detectBall();

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    if (position) {

        trail.push(position);

        if (trail.length > 30) {
            trail.shift();
        }

        drawTrail();
        drawBall(position);
        calculateMovement(position);

        statusText.textContent = "Ball detected";
        distanceText.textContent =
            (trail.length * 0.2).toFixed(1) + " m";

    } else {

        drawTrail();

        statusText.textContent =
            "Searching for ball...";
    }

    animationId = requestAnimationFrame(trackBall);
}

startButton.addEventListener(
    "click",
    startCamera
);

stopButton.addEventListener(
    "click",
    stopCamera
);

trackingButton.addEventListener(
    "click",
    startTracking
);