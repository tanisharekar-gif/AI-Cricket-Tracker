```javascript
const video = document.getElementById("camera");
const canvas = document.getElementById("trackingCanvas");
const ctx = canvas.getContext("2d");

const startCameraButton = document.getElementById("startCamera");
const stopCameraButton = document.getElementById("stopCamera");
const startTrackingButton = document.getElementById("startTracking");
const stopTrackingButton = document.getElementById("stopTracking");

const loading = document.getElementById("loading");
const modelStatus = document.getElementById("modelStatus");
const cameraStatus = document.getElementById("cameraStatus");
const trackingStatus = document.getElementById("trackingStatus");

const ballPosition = document.getElementById("ballPosition");
const ballSpeed = document.getElementById("ballSpeed");
const ballDistance = document.getElementById("ballDistance");
const confidence = document.getElementById("confidence");
const trackingMessage = document.getElementById("trackingMessage");

let model = null;
let stream = null;
let tracking = false;
let animationId = null;

let previousBall = null;
let ballHistory = [];
let lastDetectionTime = 0;
let lostFrames = 0;

const MAX_HISTORY = 35;
const MAX_LOST_FRAMES = 12;

async function loadAIModel() {
    try {
        modelStatus.textContent = "Loading";
        loading.style.display = "block";
        loading.textContent = "Loading AI model...";

        model = await cocoSsd.load({
            base: "lite_mobilenet_v2"
        });

        modelStatus.textContent = "READY";
        loading.textContent = "AI Ready";

        setTimeout(() => {
            loading.style.display = "none";
        }, 1200);

        trackingMessage.textContent =
            "AI model loaded. Start the camera.";

    } catch (error) {
        console.error(error);

        modelStatus.textContent = "ERROR";
        loading.textContent = "AI model failed";

        trackingMessage.textContent =
            "Could not load the AI model. Check your internet connection.";
    }
}

async function startCamera() {
    try {
        if (stream) {
            return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: {
                    ideal: "environment"
                },
                width: {
                    ideal: 1280
                },
                height: {
                    ideal: 720
                },
                frameRate: {
                    ideal: 30,
                    max: 60
                }
            },
            audio: false
        });

        video.srcObject = stream;

        await video.play();

        cameraStatus.textContent = "ON";

        trackingMessage.textContent =
            "Camera is ready. Press Start Tracking.";

        resizeCanvas();

    } catch (error) {
        console.error(error);

        cameraStatus.textContent = "ERROR";

        trackingMessage.textContent =
            "Camera could not start. Allow camera permission and use HTTPS.";
    }
}

function stopCamera() {
    stopTracking();

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;

    cameraStatus.textContent = "OFF";

    clearCanvas();

    trackingMessage.textContent =
        "Camera stopped.";
}

function resizeCanvas() {
    if (!video.videoWidth || !video.videoHeight) {
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function startTracking() {
    if (!model) {
        trackingMessage.textContent =
            "Wait for the AI model to finish loading.";
        return;
    }

    if (!stream) {
        trackingMessage.textContent =
            "Start the camera first.";
        return;
    }

    if (tracking) {
        return;
    }

    tracking = true;

    previousBall = null;
    ballHistory = [];
    lostFrames = 0;

    trackingStatus.textContent = "ON";

    trackingMessage.textContent =
        "Searching for the cricket ball...";

    detectFrame();
}

function stopTracking() {
    tracking = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    trackingStatus.textContent = "OFF";

    clearCanvas();

    previousBall = null;
    ballHistory = [];
    lostFrames = 0;

    ballPosition.textContent = "--";
    ballSpeed.textContent = "-- km/h";
    ballDistance.textContent = "-- m";
    confidence.textContent = "-- %";

    trackingMessage.textContent =
        "Tracking stopped.";
}

async function detectFrame() {
    if (!tracking || !model) {
        return;
    }

    if (video.readyState < 2) {
        animationId = requestAnimationFrame(detectFrame);
        return;
    }

    resizeCanvas();

    try {
        const predictions = await model.detect(video);

        const ball = findBestBall(predictions);

        clearCanvas();

        if (ball) {
            processBall(ball);
            drawBall(ball);
            drawTrajectory();
        } else {
            handleLostBall();
        }

    } catch (error) {
        console.error("Detection error:", error);
    }

    animationId = requestAnimationFrame(detectFrame);
}

function findBestBall(predictions) {
    const candidates = predictions.filter(prediction => {

        const isBall =
            prediction.class === "sports ball";

        const score =
            prediction.score >= 0.25;

        const box =
            prediction.bbox;

        const width =
            box[2];

        const height =
            box[3];

        const sizeOkay =
            width > 4 &&
            height > 4 &&
            width < canvas.width * 0.5 &&
            height < canvas.height * 0.5;

        return isBall && score && sizeOkay;
    });

    if (candidates.length === 0) {
        return null;
    }

    if (!previousBall) {
        return candidates.sort(
            (a, b) => b.score - a.score
        )[0];
    }

    const previousX = previousBall.x;
    const previousY = previousBall.y;

    candidates.forEach(candidate => {

        const box = candidate.bbox;

        candidate.x =
            box[0] + box[2] / 2;

        candidate.y =
            box[1] + box[3] / 2;

        candidate.distance =
            Math.hypot(
                candidate.x - previousX,
                candidate.y - previousY
            );

    });

    candidates.sort((a, b) => {

        const distanceDifference =
            a.distance - b.distance;

        if (Math.abs(distanceDifference) < 100) {
            return b.score - a.score;
        }

        return distanceDifference;
    });

    return candidates[0];
}

function processBall(prediction) {

    const box = prediction.bbox;

    const x =
        box[0] + box[2] / 2;

    const y =
        box[1] + box[3] / 2;

    const now =
        performance.now();

    const ball = {
        x,
        y,
        width: box[2],
        height: box[3],
        score: prediction.score,
        time: now
    };

    if (previousBall) {

        const dx =
            ball.x - previousBall.x;

        const dy =
            ball.y - previousBall.y;

        const pixelDistance =
            Math.hypot(dx, dy);

        const timeSeconds =
            (now - previousBall.time) / 1000;

        if (timeSeconds > 0) {

            const pixelSpeed =
                pixelDistance / timeSeconds;

            ball.pixelSpeed =
                pixelSpeed;
        }
    }

    previousBall = ball;

    ballHistory.push(ball);

    if (ballHistory.length > MAX_HISTORY) {
        ballHistory.shift();
    }

    lostFrames = 0;
    lastDetectionTime = now;

    updateStatistics(ball);
}

function updateStatistics(ball) {

    const xPercent =
        (ball.x / canvas.width) * 100;

    const yPercent =
        (ball.y / canvas.height) * 100;

    ballPosition.textContent =
        `${xPercent.toFixed(1)}%, ${yPercent.toFixed(1)}%`;

    const confidencePercent =
        ball.score * 100;

    confidence.textContent =
        `${confidencePercent.toFixed(1)} %`;

    if (ball.pixelSpeed) {

        const estimatedSpeed =
            convertPixelSpeedToKmh(ball.pixelSpeed);

        ballSpeed.textContent =
            `${estimatedSpeed.toFixed(1)} km/h`;
    }

    const distance =
        calculateEstimatedDistance(ball);

    if (distance !== null) {
        ballDistance.textContent =
            `${distance.toFixed(2)} m`;
    }

    trackingMessage.textContent =
        "🏏 Ball detected and tracking.";
}

function convertPixelSpeedToKmh(pixelSpeed) {

    const referencePixels =
        Math.max(canvas.width, canvas.height);

    const referenceMeters =
        1;

    const metersPerSecond =
        (pixelSpeed / referencePixels) *
        referenceMeters;

    return metersPerSecond * 3.6;
}

function calculateEstimatedDistance(ball) {

    if (!ball.width || !ball.height) {
        return null;
    }

    const averageBallSize =
        (ball.width + ball.height) / 2;

    if (averageBallSize <= 0) {
        return null;
    }

    const assumedBallDiameter =
        0.072;

    const focalScale =
        canvas.width * 0.8;

    const distance =
        (assumedBallDiameter * focalScale) /
        averageBallSize;

    if (!Number.isFinite(distance)) {
        return null;
    }

    return Math.min(distance, 100);
}

function handleLostBall() {

    lostFrames++;

    if (lostFrames <= MAX_LOST_FRAMES) {

        trackingMessage.textContent =
            "Ball temporarily lost... searching.";

        drawTrajectory();

        return;
    }

    trackingMessage.textContent =
        "Ball lost. Searching for it again.";

    previousBall = null;
}

function drawBall(ball) {

    const radius =
        Math.max(
            8,
            Math.min(
                ball.width,
                ball.height
            ) / 2
        );

    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        radius + 6,
        0,
        Math.PI * 2
    );

    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        4,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    ctx.font = "bold 16px Arial";

    ctx.fillText(
        `BALL ${(ball.score * 100).toFixed(0)}%`,
        ball.x + 12,
        ball.y - 12
    );
}

function drawTrajectory() {

    if (ballHistory.length < 2) {
        return;
    }

    ctx.beginPath();

    ctx.moveTo(
        ballHistory[0].x,
        ballHistory[0].y
    );

    for (let i = 1; i < ballHistory.length; i++) {

        ctx.lineTo(
            ballHistory[i].x,
            ballHistory[i].y
        );
    }

    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.stroke();

    for (let i = 0; i < ballHistory.length; i += 4) {

        const point =
            ballHistory[i];

        ctx.beginPath();

        ctx.arc(
            point.x,
            point.y,
            3,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "white";
        ctx.fill();
    }
}

startCameraButton.addEventListener(
    "click",
    startCamera
);

stopCameraButton.addEventListener(
    "click",
    stopCamera
);

startTrackingButton.addEventListener(
    "click",
    startTracking
);

stopTrackingButton.addEventListener(
    "click",
    stopTracking
);

video.addEventListener(
    "loadedmetadata",
    resizeCanvas
);

window.addEventListener(
    "resize",
    resizeCanvas
);

loadAIModel();
```
