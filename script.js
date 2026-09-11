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
    statusText.textContent = "Loading ball detector...";

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

        statusText.textContent = "Ball detector ready";
        loadingModel = false;

        return true;

    } catch (error) {
        console.error(error);
        statusText.textContent = "Detector loading failed";
        loadingModel = false;

        return false;
    }
}

async function startCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera not supported");
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        cameraMessage.textContent = "Finding rear camera...";
        statusText.textContent = "Requesting camera permission...";

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

        const rearCamera =
            cameras.find(device =>
                /back|rear|environment|main/i.test(device.label)
            );

        if (!rearCamera) {
            throw new Error("Rear camera not found");
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: {
                    exact: rearCamera.deviceId
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

            cameraMessage.textContent = "Rear Camera ON";

            statusText.textContent =
                "Rear Camera Active " +
                settings.width +
                "x" +
                settings.height +
                " " +
                (settings.frameRate || "") +
                " FPS";
        };

    } catch (error) {
        console.error(error);

        cameraMessage.textContent = "Camera Error";

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

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";

    positionText.textContent = "-";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";

    ballHistory = [];
    lastBall = null;
    lastTime = 0;
    totalDistance = 0;
}

function resetTracking() {
    ballHistory = [];
    lastBall = null;
    lastTime = 0;
    totalDistance = 0;

    positionText.textContent = "-";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";

    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function chooseBall(predictions) {
    const balls = predictions.filter(p => {
        if (p.class !== "sports ball") return false;

        if (p.score < 0.25) return false;

        const [x, y, w, h] = p.bbox;

        if (w < 8 || h < 8) return false;

        const ratio = w / h;

        if (ratio < 0.55 || ratio > 1.8) return false;

        const areaRatio =
            (w * h) /
            (video.videoWidth * video.videoHeight);

        if (areaRatio > 0.20) return false;

        return true;
    });

    if (balls.length === 0) return null;

    if (!lastBall) {
        balls.sort((a, b) => b.score - a.score);
        return balls[0];
    }

    let best = null;
    let bestScore = -Infinity;

    for (const ball of balls) {
        const [x, y, w, h] = ball.bbox;

        const cx = x + w / 2;
        const cy = y + h / 2;

        const dx = cx - lastBall.x;
        const dy = cy - lastBall.y;

        const distance =
            Math.sqrt(dx * dx + dy * dy);

        const maximumJump =
            Math.max(
                video.videoWidth,
                video.videoHeight
            ) * 0.30;

        if (distance > maximumJump) continue;

        const proximity =
            1 - Math.min(
                distance / maximumJump,
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

function updateTracking(ball) {
    const [x, y, w, h] = ball.bbox;

    const centerX = x + w / 2;
    const centerY = y + h / 2;

    const now = performance.now();

    if (lastBall && lastTime > 0) {
        const dt = (now - lastTime) / 1000;

        if (dt > 0 && dt < 1) {
            const dx = centerX - lastBall.x;
            const dy = centerY - lastBall.y;

            const pixelDistance =
                Math.sqrt(dx * dx + dy * dy);

            if (
                pixelDistance <
                Math.max(
                    canvas.width,
                    canvas.height
                ) * 0.25
            ) {
                totalDistance += pixelDistance;

                const pixelsPerMeter = 120;

                const metersPerSecond =
                    (pixelDistance /
                        pixelsPerMeter) /
                    dt;

                const kmh =
                    metersPerSecond * 3.6;

                if (kmh < 300) {
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

    lastTime = now;

    ballHistory.push({
        x: centerX,
        y: centerY
    });

    if (ballHistory.length > 100) {
        ballHistory.shift();
    }

    positionText.textContent =
        Math.round(centerX) +
        ", " +
        Math.round(centerY);

    distanceText.textContent =
        (
            totalDistance /
            pixelsPerMeterForDisplay()
        ).toFixed(2) +
        " m";
}

function pixelsPerMeterForDisplay() {
    return 120;
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

        ctx.strokeStyle = "#00ff66";
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
    }

    if (ball) {
        const [x, y, w, h] = ball.bbox;

        ctx.strokeStyle = "#ff3030";
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

        ctx.strokeStyle = "#00ffff";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();

        ctx.arc(
            x + w / 2,
            y + h / 2,
            6,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "#ffff00";
        ctx.fill();
    }
}

async function trackingLoop() {
    if (!tracking || !model) return;

    if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
    ) {
        try {
            const predictions =
                await model.detect(video);

            const ball =
                chooseBall(predictions);

            if (ball) {
                updateTracking(ball);
                drawTracking(ball);

                statusText.textContent =
                    "BALL TRACKING";
            } else {
                drawTracking(null);

                statusText.textContent =
                    "Searching for ball...";
            }

        } catch (error) {
            console.error(error);

            statusText.textContent =
                "Tracking error";
        }
    }

    animationId =
        requestAnimationFrame(trackingLoop);
}

async function startTracking() {
    if (!stream) {
        await startCamera();
    }

    if (!stream) return;

    const ready =
        await loadDetector();

    if (!ready) return;

    resetTracking();

    tracking = true;

    statusText.textContent =
        "BALL TRACKING";

    if (animationId) {
        cancelAnimationFrame(animationId);
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
