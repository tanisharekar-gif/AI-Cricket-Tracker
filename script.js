const video = document.getElementById("video");
const canvas = document.getElementById("trackingCanvas");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const trackingButton = document.getElementById("trackingButton");

const cameraMessage = document.getElementById("cameraMessage");
const statusText = document.getElementById("status");
const positionText = document.getElementById("position");
const speedText = document.getElementById("speed");
const distanceText = document.getElementById("distance");

let stream = null;
let tracking = false;
let model = null;
let animationId = null;
let loadingModel = false;
let detecting = false;
let frameCounter = 0;

let ballHistory = [];
let lastBall = null;
let lastDetectionTime = 0;
let totalDistance = 0;
let missedFrames = 0;

const DETECTION_SIZE = 416;
const PITCH_LENGTH = 20.12;
const MAX_HISTORY = 100;
const MAX_MISSED = 5;

const smallCanvas = document.createElement("canvas");
smallCanvas.width = DETECTION_SIZE;
smallCanvas.height = DETECTION_SIZE;

const smallCtx = smallCanvas.getContext("2d", {
    willReadFrequently: true
});

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadDetector() {
    if (model) return true;

    if (loadingModel) return false;

    loadingModel = true;
    statusText.textContent = "Loading AI...";

    try {
        if (!window.tf) {
            await loadScript(
                "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
            );
        }

        if (!window.cocoSsd) {
            await loadScript(
                "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"
            );
        }

        await tf.ready();

        try {
            await tf.setBackend("webgl");
            await tf.ready();
        } catch (e) {
            console.log("WebGL unavailable");
        }

        model = await cocoSsd.load({
            base: "lite_mobilenet_v2"
        });

        loadingModel = false;
        statusText.textContent = "AI READY";

        return true;

    } catch (error) {
        console.error(error);

        loadingModel = false;
        statusText.textContent = "AI ERROR";

        return false;
    }
}

async function getRearCamera() {

    const permissionStream =
        await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

    permissionStream
        .getTracks()
        .forEach(track => track.stop());

    const devices =
        await navigator.mediaDevices.enumerateDevices();

    const cameras =
        devices.filter(
            device => device.kind === "videoinput"
        );

    const rear =
        cameras.find(device =>
            /back|rear|environment|main/i.test(
                device.label
            )
        );

    if (rear) {
        return rear.deviceId;
    }

    if (cameras.length > 1) {
        return cameras[cameras.length - 1].deviceId;
    }

    if (cameras.length === 1) {
        return cameras[0].deviceId;
    }

    return null;
}

async function startCamera() {

    try {

        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {

            throw new Error(
                "Camera not supported"
            );
        }

        if (stream) {
            stream.getTracks()
                .forEach(track => track.stop());
        }

        cameraMessage.textContent =
            "Opening rear camera...";

        statusText.textContent =
            "Selecting camera...";

        const rearCamera =
            await getRearCamera();

        if (!rearCamera) {
            throw new Error(
                "Rear camera not found"
            );
        }

        stream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: {
                        exact: rearCamera
                    },
                    width: {
                        ideal: 1280
                    },
                    height: {
                        ideal: 720
                    },
                    frameRate: {
                        ideal: 30,
                        max: 30
                    }
                },
                audio: false
            });

        video.srcObject = stream;

        video.onloadedmetadata =
            async function () {

                await video.play();

                canvas.width =
                    video.videoWidth;

                canvas.height =
                    video.videoHeight;

                const settings =
                    stream
                        .getVideoTracks()[0]
                        .getSettings();

                cameraMessage.textContent =
                    "REAR CAMERA ON";

                statusText.textContent =
                    "Camera " +
                    settings.width +
                    "x" +
                    settings.height +
                    " | " +
                    Math.round(
                        settings.frameRate || 0
                    ) +
                    " FPS";
            };

    } catch (error) {

        console.error(error);

        cameraMessage.textContent =
            "CAMERA ERROR";

        statusText.textContent =
            error.name +
            ": " +
            error.message;
    }
}

function stopCamera() {

    tracking = false;
    detecting = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (stream) {

        stream.getTracks()
            .forEach(track => track.stop());

        stream = null;
    }

    video.srcObject = null;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    cameraMessage.textContent =
        "Camera OFF";

    statusText.textContent =
        "Ready";

    positionText.textContent =
        "-";

    speedText.textContent =
        "0 km/h";

    distanceText.textContent =
        "0 m";

    ballHistory = [];
    lastBall = null;
    lastDetectionTime = 0;
    totalDistance = 0;
    missedFrames = 0;
}

function resetTracking() {

    ballHistory = [];
    lastBall = null;
    lastDetectionTime = 0;
    totalDistance = 0;
    missedFrames = 0;

    positionText.textContent =
        "-";

    speedText.textContent =
        "0 km/h";

    distanceText.textContent =
        "0 m";

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );
}

function chooseBall(predictions) {

    const candidates =
        predictions.filter(p => {

            if (p.class !== "sports ball") {
                return false;
            }

            if (p.score < 0.20) {
                return false;
            }

            const [
                x,
                y,
                w,
                h
            ] = p.bbox;

            if (w < 5 || h < 5) {
                return false;
            }

            const ratio =
                w / h;

            if (
                ratio < 0.50 ||
                ratio > 2.0
            ) {
                return false;
            }

            const area =
                w * h;

            const frameArea =
                DETECTION_SIZE *
                DETECTION_SIZE;

            if (
                area / frameArea >
                0.18
            ) {
                return false;
            }

            return true;
        });

    if (candidates.length === 0) {
        return null;
    }

    if (!lastBall) {

        candidates.sort(
            (a, b) =>
                b.score - a.score
        );

        return candidates[0];
    }

    let best = null;
    let bestScore = -Infinity;

    for (const ball of candidates) {

        const [
            x,
            y,
            w,
            h
        ] = ball.bbox;

        const cx =
            x + w / 2;

        const cy =
            y + h / 2;

        const dx =
            cx - lastBall.x;

        const dy =
            cy - lastBall.y;

        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        const maxJump =
            DETECTION_SIZE * 0.40;

        const proximity =
            1 -
            Math.min(
                distance / maxJump,
                1
            );

        const score =
            ball.score * 0.65 +
            proximity * 0.35;

        if (score > bestScore) {

            bestScore = score;
            best = ball;
        }
    }

    return best;
}

function convertBall(ball) {

    const [
        x,
        y,
        w,
        h
    ] = ball.bbox;

    const scaleX =
        canvas.width /
        DETECTION_SIZE;

    const scaleY =
        canvas.height /
        DETECTION_SIZE;

    return {
        x: x * scaleX,
        y: y * scaleY,
        w: w * scaleX,
        h: h * scaleY
    };
}

function updateBall(ball) {

    const centerX =
        ball.x +
        ball.w / 2;

    const centerY =
        ball.y +
        ball.h / 2;

    const now =
        performance.now();

    if (lastBall &&
        lastDetectionTime > 0) {

        const dt =
            (now -
                lastDetectionTime) /
            1000;

        if (
            dt > 0.01 &&
            dt < 1
        ) {

            const dx =
                centerX -
                lastBall.x;

            const dy =
                centerY -
                lastBall.y;

            const pixelDistance =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            if (
                pixelDistance <
                Math.max(
                    canvas.width,
                    canvas.height
                ) * 0.35
            ) {

                totalDistance +=
                    pixelDistance;

                const pixelsPerMeter =
                    canvas.height /
                    PITCH_LENGTH;

                const meters =
                    pixelDistance /
                    pixelsPerMeter;

                const kmh =
                    (meters / dt) *
                    3.6;

                if (
                    kmh > 1 &&
                    kmh < 250
                ) {

                    speedText.textContent =
                        Math.round(kmh) +
                        " km/h";
                }
            }
        }
    }

    lastBall = {
        x: centerX,
        y: centerY
    };

    lastDetectionTime = now;
    missedFrames = 0;

    ballHistory.push({
        x: centerX,
        y: centerY
    });

    if (
        ballHistory.length >
        MAX_HISTORY
    ) {
        ballHistory.shift();
    }

    positionText.textContent =
        Math.round(centerX) +
        ", " +
        Math.round(centerY);

    const pixelsPerMeter =
        canvas.height /
        PITCH_LENGTH;

    distanceText.textContent =
        (
            totalDistance /
            pixelsPerMeter
        ).toFixed(2) +
        " m";
}

function drawTracking(ball) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    if (
        ballHistory.length > 1
    ) {

        ctx.beginPath();

        ctx.moveTo(
            ballHistory[0].x,
            ballHistory[0].y
        );

        for (
            let i = 1;
            i < ballHistory.length;
            i++
        ) {

            ctx.lineTo(
                ballHistory[i].x,
                ballHistory[i].y
            );
        }

        ctx.strokeStyle =
            "#00ff66";

        ctx.lineWidth = 6;

        ctx.lineCap =
            "round";

        ctx.lineJoin =
            "round";

        ctx.stroke();
    }

    if (!ball) {
        return;
    }

    ctx.strokeStyle =
        "#ff3030";

    ctx.lineWidth = 5;

    ctx.strokeRect(
        ball.x,
        ball.y,
        ball.w,
        ball.h
    );

    ctx.beginPath();

    ctx.arc(
        ball.x +
        ball.w / 2,
        ball.y +
        ball.h / 2,
        Math.max(
            ball.w,
            ball.h
        ) / 2,
        0,
        Math.PI * 2
    );

    ctx.strokeStyle =
        "#00ffff";

    ctx.lineWidth = 3;

    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        ball.x +
        ball.w / 2,
        ball.y +
        ball.h / 2,
        7,
        0,
        Math.PI * 2
    );

    ctx.fillStyle =
        "#ffff00";

    ctx.fill();
}

async function detectBall() {

    if (
        detecting ||
        !model ||
        !tracking
    ) {
        return;
    }

    if (
        video.readyState < 2 ||
        video.videoWidth === 0
    ) {
        return;
    }

    detecting = true;

    try {

        smallCtx.drawImage(
            video,
            0,
            0,
            DETECTION_SIZE,
            DETECTION_SIZE
        );

        const predictions =
            await model.detect(
                smallCanvas,
                10,
                0.20
            );

        const detected =
            chooseBall(predictions);

        if (detected) {

            const ball =
                convertBall(detected);

            updateBall(ball);

            drawTracking(ball);

            statusText.textContent =
                "🏏 BALL DETECTED";

        } else {

            missedFrames++;

            if (
                missedFrames >
                MAX_MISSED
            ) {

                statusText.textContent =
                    "SEARCHING FOR BALL";

                lastBall = null;
            }
        }

    } catch (error) {

        console.error(error);

        statusText.textContent =
            "AI TRACKING ERROR";

    } finally {

        detecting = false;
    }
}

function trackingLoop() {

    if (!tracking) {
        return;
    }

    frameCounter++;

    if (
        frameCounter % 2 === 0
    ) {
        detectBall();
    }

    animationId =
        requestAnimationFrame(
            trackingLoop
        );
}

async function startTracking() {

    if (!stream) {
        await startCamera();
    }

    if (!stream) {
        return;
    }

    const ready =
        await loadDetector();

    if (!ready) {
        return;
    }

    resetTracking();

    tracking = true;
    frameCounter = 0;

    statusText.textContent =
        "GET READY TO BOWL";

    if (animationId) {
        cancelAnimationFrame(
            animationId
        );
    }

    trackingLoop();
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
