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

const W = 220;
const H = 124;

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

function isBallColor(r, g, b) {
    const brightness = (r + g + b) / 3;

    if (brightness < 35 || brightness > 220) {
        return false;
    }

    const redGreenDifference = r - g;
    const greenBlueDifference = g - b;

    return (
        redGreenDifference > 8 &&
        greenBlueDifference > 3 &&
        r > 55 &&
        g > 35
    );
}

function detectBall(frame) {
    const pixels = frame.data;

    if (!previousFrame) {
        previousFrame = new Uint8Array(pixels);
        return null;
    }

    const motion = new Uint8Array(W * H);

    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {

            const i = (y * W + x) * 4;

            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];

            const oldR = previousFrame[i];
            const oldG = previousFrame[i + 1];
            const oldB = previousFrame[i + 2];

            const difference =
                Math.abs(r - oldR) +
                Math.abs(g - oldG) +
                Math.abs(b - oldB);

            if (difference > 55 && isBallColor(r, g, b)) {
                motion[y * W + x] = 1;
            }
        }
    }

    previousFrame = new Uint8Array(pixels);

    let bestBall = null;

    for (let y = 4; y < H - 4; y += 2) {
        for (let x = 4; x < W - 4; x += 2) {

            if (!motion[y * W + x]) {
                continue;
            }

            let points = [];
            let minX = W;
            let maxX = 0;
            let minY = H;
            let maxY = 0;

            for (let yy = y - 7; yy <= y + 7; yy++) {
                for (let xx = x - 7; xx <= x + 7; xx++) {

                    if (
                        xx < 0 ||
                        xx >= W ||
                        yy < 0 ||
                        yy >= H
                    ) {
                        continue;
                    }

                    if (motion[yy * W + xx]) {
                        points.push({
                            x: xx,
                            y: yy
                        });

                        minX = Math.min(minX, xx);
                        maxX = Math.max(maxX, xx);
                        minY = Math.min(minY, yy);
                        maxY = Math.max(maxY, yy);
                    }
                }
            }

            if (points.length < 5 || points.length > 130) {
                continue;
            }

            const width = maxX - minX;
            const height = maxY - minY;

            if (
                width < 3 ||
                height < 3 ||
                width > 24 ||
                height > 24
            ) {
                continue;
            }

            const ratio = width / height;

            if (ratio < 0.45 || ratio > 2.2) {
                continue;
            }

            let centerX = 0;
            let centerY = 0;

            for (const point of points) {
                centerX += point.x;
                centerY += point.y;
            }

            centerX /= points.length;
            centerY /= points.length;

            let score = points.length;

            if (lastBall) {

                const lastX =
                    lastBall.x * W / canvas.width;

                const lastY =
                    lastBall.y * H / canvas.height;

                const dx = centerX - lastX;
                const dy = centerY - lastY;

                const movement =
                    Math.sqrt(dx * dx + dy * dy);

                if (movement < 35) {
                    score += 80;
                }

                if (movement > 80) {
                    score -= 30;
                }
            }

            if (!bestBall || score > bestBall.score) {
                bestBall = {
                    x: centerX,
                    y: centerY,
                    score: score
                };
            }
        }
    }

    if (!bestBall || bestBall.score < 12) {
        return null;
    }

    return {
        x: bestBall.x * canvas.width / W,
        y: bestBall.y * canvas.height / H
    };
}

function drawBall(ball) {
    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        25,
        0,
        Math.PI * 2
    );

    ctx.lineWidth = 5;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        7,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "white";

    ctx.fillText(
        "BALL",
        ball.x + 30,
        ball.y - 25
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

    ctx.lineWidth = 6;
    ctx.strokeStyle = "white";
    ctx.stroke();
}

function updateMeasurements(ball) {
    const now = performance.now();

    if (lastBall) {

        const dx =
            ball.x - lastBall.x;

        const dy =
            ball.y - lastBall.y;

        const pixels =
            Math.sqrt(dx * dx + dy * dy);

        const time =
            (now - lastTime) / 1000;

        if (time > 0 && pixels < 400) {

            totalDistance += pixels;

            const pixelsPerSecond =
                pixels / time;

            const speed =
                pixelsPerSecond * 0.1 * 3.6;

            if (speed < 250) {
                speedText.textContent =
                    speed.toFixed(1) + " km/h";
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

        if (trail.length > 80) {
            trail.shift();
        }

        drawTrail();
        drawBall(ball);
        updateMeasurements(ball);

        statusText.textContent =
            "BALL DETECTED";
    } else {

        lostFrames++;

        drawTrail();

        if (lastBall && lostFrames < 10) {
            drawBall(lastBall);
        }

        if (lostFrames < 10) {
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
