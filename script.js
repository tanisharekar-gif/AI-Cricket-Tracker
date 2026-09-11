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

let ballHistory = [];
let lastBall = null;
let lastTime = 0;
let totalDistance = 0;
let missedFrames = 0;

const PITCH_LENGTH = 20.12;
const MAX_HISTORY = 80;
const MAX_MISSED_FRAMES = 8;

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
    statusText.textContent = "Loading AI detector...";

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

        model = await cocoSsd.load({
            base: "lite_mobilenet_v2"
        });

        loadingModel = false;
        statusText.textContent = "AI detector ready";

        return true;

    } catch (error) {
        console.error(error);

        loadingModel = false;
        statusText.textContent = "AI detector failed";

        return false;
    }
}

async function getRearCamera() {
    const permissionStream =
        await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

    permissionStream.getTracks().forEach(track => track.stop());

    const devices =
        await navigator.mediaDevices.enumerateDevices();

    const cameras =
        devices.filter(device => device.kind === "videoinput");

    const rear =
        cameras.find(device =>
            /back|rear|environment|main/i.test(device.label)
        );

    if (rear) {
        return rear.deviceId;
    }

    if (cameras.length > 1) {
        return cameras[cameras.length - 1].deviceId;
    }

    return cameras.length === 1
        ? cameras[0].deviceId
        : null;
}

async function startCamera() {
    try {
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera not supported");
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        cameraMessage.textContent = "Opening rear camera...";
        statusText.textContent = "Selecting camera...";

        const rearCamera = await getRearCamera();

        if (!rearCamera) {
            throw new Error("No camera found");
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: {
                    exact: rearCamera
                },
                width: {
                    ideal: 1920
                },
                height: {
                    ideal: 1080
                },
                frameRate: {
                    ideal: 60,
                    max: 60
                }
            },
            audio: false
        });

        video.srcObject = stream;

        video.onloadedmetadata = async function () {
            await video.play();

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const settings =
                stream.getVideoTracks()[0].getSettings();

            cameraMessage.textContent = "REAR CAMERA ON";

            statusText.textContent =
                "Camera " +
                settings.width +
                "x" +
                settings.height +
                " | " +
                Math.round(settings.frameRate || 0) +
                " FPS";
        };

    } catch (error) {
        console.error(error);

        cameraMessage.textContent = "CAMERA ERROR";
        statusText.textContent =
            error.name + ": " + error.message;
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

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";

    positionText.textContent = "-";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";

    ballHistory = [];
    lastBall = null;
    lastTime = 0;
    totalDistance = 0;
    missedFrames = 0;
}

function resetTracking() {
    ballHistory = [];
    lastBall = null;
    lastTime = 0;
    totalDistance = 0;
    missedFrames = 0;

    positionText.textContent = "-";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );
}

function chooseBall(predictions) {

    const candidates = predictions.filter(p => {

        if (p.class !== "sports ball") {
            return false;
        }

        if (p.score < 0.35) {
            return false;
        }

        const [x, y, w, h] = p.bbox;

        const frameArea =
            video.videoWidth * video.videoHeight;

        const boxArea = w * h;

        const areaRatio =
            boxArea / frameArea;

        if (areaRatio > 0.08) {
            return false;
        }

        if (w < 6 || h < 6) {
            return false;
        }

        const ratio = w / h;

        if (ratio < 0.55 || ratio > 1.8) {
            return false;
        }

        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    if (!lastBall) {
        candidates.sort((a, b) =>
            b.score - a.score
        );

        return candidates[0];
    }

    let best = null;
    let bestValue = -Infinity;

    const frameSize =
        Math.max(
            video.videoWidth,
            video.videoHeight
        );

    const maximumJump =
        frameSize * 0.22;

    for (const candidate of candidates) {

        const [x, y, w, h] =
            candidate.bbox;

        const cx = x + w / 2;
        const cy = y + h / 2;

        const dx =
            cx - lastBall.x;

        const dy =
            cy - lastBall.y;

        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        if (distance > maximumJump) {
            continue;
        }

        const proximity =
            1 -
            distance / maximumJump;

        const value =
            candidate.score * 0.7 +
            proximity * 0.3;

        if (value > bestValue) {
            bestValue = value;
            best = candidate;
        }
    }

    return best;
}

function smoothPoint(x, y) {

    if (!lastBall) {
        return {
            x,
            y
        };
    }

    const smooth = 0.55;

    return {
        x:
            lastBall.x +
            (x - lastBall.x) *
            smooth,

        y:
            lastBall.y +
            (y - lastBall.y) *
            smooth
    };
}

function calculateSpeed(pixelDistance, dt) {

    if (dt <= 0) {
        return 0;
    }

    const pitchPixels =
        Math.max(
            canvas.width,
            canvas.height
        );

    const pixelsPerMeter =
        pitchPixels / PITCH_LENGTH;

    const meters =
        pixelDistance /
        pixelsPerMeter;

    const kmh =
        (meters / dt) * 3.6;

    if (!isFinite(kmh)) {
        return 0;
    }

    return Math.min(kmh, 250);
}

function updateTracking(ball) {

    const [x, y, w, h] =
        ball.bbox;

    const rawX =
        x + w / 2;

    const rawY =
        y + h / 2;

    const point =
        smoothPoint(
            rawX,
            rawY
        );

    const now =
        performance.now();

    if (lastBall && lastTime > 0) {

        const dt =
            (now - lastTime) / 1000;

        if (dt > 0.015 && dt < 0.5) {

            const dx =
                point.x -
                lastBall.x;

            const dy =
                point.y -
                lastBall.y;

            const pixelDistance =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            const maximumDistance =
                Math.max(
                    canvas.width,
                    canvas.height
                ) * 0.20;

            if (pixelDistance <
                maximumDistance) {

                totalDistance +=
                    pixelDistance;

                const kmh =
                    calculateSpeed(
                        pixelDistance,
                        dt
                    );

                if (kmh > 0 &&
                    kmh < 250) {

                    speedText.textContent =
                        Math.round(kmh) +
                        " km/h";
                }
            }
        }
    }

    lastBall = point;
    lastTime = now;
    missedFrames = 0;

    ballHistory.push({
        x: point.x,
        y: point.y
    });

    if (ballHistory.length >
        MAX_HISTORY) {

        ballHistory.shift();
    }

    positionText.textContent =
        Math.round(point.x) +
        ", " +
        Math.round(point.y);

    const pitchScale =
        Math.max(
            canvas.width,
            canvas.height
        ) / PITCH_LENGTH;

    const distanceMeters =
        totalDistance /
        pitchScale;

    distanceText.textContent =
        distanceMeters.toFixed(2) +
        " m";
}

function drawTracking(ball) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    if (ballHistory.length > 1) {

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

        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.stroke();
    }

    if (!ball) {
        return;
    }

    const [x, y, w, h] =
        ball.bbox;

    ctx.strokeStyle =
        "#ff3030";

    ctx.lineWidth = 5;

    ctx.strokeRect(
        x,
        y,
        w,
        h
    );

    ctx.beginPath();

    ctx.arc(
        x + w / 2,
        y + h / 2,
        Math.max(w, h) / 2,
        0,
        Math.PI * 2
    );

    ctx.strokeStyle =
        "#00ffff";

    ctx.lineWidth = 3;

    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        x + w / 2,
        y + h / 2,
        7,
        0,
        Math.PI * 2
    );

    ctx.fillStyle =
        "#ffff00";

    ctx.fill();
}

async function trackingLoop() {

    if (!tracking || !model) {
        return;
    }

    if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
    ) {

        try {

            const predictions =
                await model.detect(
                    video,
                    10,
                    0.25
                );

            const ball =
                chooseBall(predictions);

            if (ball) {

                updateTracking(ball);

                drawTracking(ball);

                statusText.textContent =
                    "BALL TRACKING";

            } else {

                missedFrames++;

                if (
                    lastBall &&
                    missedFrames <=
                    MAX_MISSED_FRAMES
                ) {

                    drawTracking(null);

                    statusText.textContent =
                        "BALL TEMPORARILY LOST";

                } else {

                    drawTracking(null);

                    statusText.textContent =
                        "SEARCHING FOR BALL";
                }
            }

        } catch (error) {

            console.error(error);

            statusText.textContent =
                "Tracking error";
        }
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

    statusText.textContent =
        "BALL TRACKING";

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
