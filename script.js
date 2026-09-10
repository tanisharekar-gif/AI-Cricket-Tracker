const video = document.getElementById("video");
const canvas = document.getElementById("trackingCanvas");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const trackingButton = document.getElementById("trackingButton");

const cameraMessage = document.getElementById("cameraMessage");
const statusText = document.getElementById("status");
const positionText = document.getElementById("position");
const distanceText = document.getElementById("distance");
const speedText = document.getElementById("speed");

let stream = null;
let tracking = false;
let animationId = null;

let previousFrame = null;
let lastBall = null;
let trail = [];

let lastTime = 0;
let totalDistance = 0;
let lostFrames = 0;

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", {
    willReadFrequently: true
});

const W = 160;
const H = 90;

scanCanvas.width = W;
scanCanvas.height = H;

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
        lastBall = null;
        trail = [];
        totalDistance = 0;
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

    previousFrame = null;
    lastBall = null;
    trail = [];
    totalDistance = 0;

    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";
    positionText.textContent = "-";
    distanceText.textContent = "0 m";
    speedText.textContent = "0 km/h";

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
        statusText.textContent = "Searching for ball";

        previousFrame = null;
        lastBall = null;
        trail = [];
        totalDistance = 0;
        lostFrames = 0;
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

function getFrame() {
    scanCtx.drawImage(
        video,
        0,
        0,
        W,
        H
    );

    return scanCtx.getImageData(
        0,
        0,
        W,
        H
    );
}

function detectBall(frame) {
    if (!previousFrame) {
        previousFrame = new Uint8Array(frame.data);
        return null;
    }

    const current = frame.data;
    const old = previousFrame;

    const motion = new Uint8Array(W * H);

    for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {

            const i = (y * W + x) * 4;

            const r1 = current[i];
            const g1 = current[i + 1];
            const b1 = current[i + 2];

            const r2 = old[i];
            const g2 = old[i + 1];
            const b2 = old[i + 2];

            const difference =
                Math.abs(r1 - r2) +
                Math.abs(g1 - g2) +
                Math.abs(b1 - b2);

            if (difference > 75) {
                motion[y * W + x] = 1;
            }
        }
    }

    previousFrame = new Uint8Array(current);

    let best = null;

    for (let y = 3; y < H - 3; y += 2) {
        for (let x = 3; x < W - 3; x += 2) {

            if (!motion[y * W + x]) {
                continue;
            }

            let count = 0;
            let sumX = 0;
            let sumY = 0;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;

            for (let yy = y - 6; yy <= y + 6; yy++) {
                for (let xx = x - 6; xx <= x + 6; xx++) {

                    if (
                        xx < 0 ||
                        xx >= W ||
                        yy < 0 ||
                        yy >= H
                    ) {
                        continue;
                    }

                    if (motion[yy * W + xx]) {
                        count++;

                        sumX += xx;
                        sumY += yy;

                        minX = Math.min(minX, xx);
                        maxX = Math.max(maxX, xx);
                        minY = Math.min(minY, yy);
                        maxY = Math.max(maxY, yy);
                    }
                }
            }

            const width = maxX - minX;
            const height = maxY - minY;

            if (
                count >= 8 &&
                count <= 180 &&
                width <= 25 &&
                height <= 25
            ) {

                const centerX = sumX / count;
                const centerY = sumY / count;

                let score = count;

                if (lastBall) {
                    const dx = centerX - lastBall.x;
                    const dy = centerY - lastBall.y;

                    const distance =
                        Math.sqrt(dx * dx + dy * dy);

                    if (distance < 30) {
                        score += 100;
                    }
                }

                if (!best || score > best.score) {
                    best = {
                        x: centerX,
                        y: centerY,
                        score: score
                    };
                }
            }
        }
    }

    if (!best) {
        return null;
    }

    return {
        x: best.x * canvas.width / W,
        y: best.y * canvas.height / H
    };
}

function drawBall(ball) {
    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        22,
        0,
        Math.PI * 2
    );

    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        6,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "white";
    ctx.fillText(
        "BALL",
        ball.x + 25,
        ball.y - 20
    );
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

    ctx.lineWidth = 5;
    ctx.strokeStyle = "white";
    ctx.stroke();
}

function updateMeasurements(ball) {
    const now = performance.now();

    if (lastBall) {

        const dx = ball.x - lastBall.x;
        const dy = ball.y - lastBall.y;

        const pixels =
            Math.sqrt(dx * dx + dy * dy);

        const time =
            (now - lastTime) / 1000;

        if (time > 0 && pixels < 300) {

            totalDistance += pixels;

            const pixelsPerSecond =
                pixels / time;

            const estimatedSpeed =
                pixelsPerSecond * 0.1 * 3.6;

            if (
                estimatedSpeed >= 0 &&
                estimatedSpeed < 250
            ) {
                speedText.textContent =
                    estimatedSpeed.toFixed(1) +
                    " km/h";
            }
        }
    }

    lastTime = now;

    positionText.textContent =
        Math.round(ball.x) +
        ", " +
        Math.round(ball.y);

    distanceText.textContent =
        (totalDistance / 100).toFixed(2) +
        " m";
}

function trackBall() {
    if (!tracking || !stream) {
        return;
    }

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    const frame = getFrame();

    const ball = detectBall(frame);

    if (ball) {

        lastBall = ball;
        lostFrames = 0;

        trail.push({
            x: ball.x,
            y: ball.y
        });

        if (trail.length > 60) {
            trail.shift();
        }

        drawTrail();
        drawBall(ball);
        updateMeasurements(ball);

        statusText.textContent =
            "Ball detected";
    } else {

        lostFrames++;

        drawTrail();

        if (lastBall) {
            drawBall(lastBall);
        }

        if (lostFrames < 15) {
            statusText.textContent =
                "Tracking...";
        } else {
            statusText.textContent =
                "Searching for ball";
        }
    }

    animationId =
        requestAnimationFrame(trackBall);
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