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

async function loadAIModel() {
    try {
        modelStatus.textContent = "Loading";
        loading.style.display = "block";
        loading.textContent = "Downloading AI model...";

        if (typeof tf === "undefined") {
            throw new Error("TensorFlow.js did not load.");
        }

        trackingMessage.textContent =
            "TensorFlow.js loaded. Loading detector...";

        await tf.ready();

        if (typeof cocoSsd === "undefined") {
            throw new Error("COCO-SSD did not load.");
        }

        loading.textContent = "Loading object detector...";

        model = await Promise.race([
            cocoSsd.load({
                base: "lite_mobilenet_v2"
            }),

            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(
                        new Error(
                            "AI model loading timed out after 45 seconds."
                        )
                    );
                }, 45000);
            })
        ]);

        modelStatus.textContent = "READY";
        loading.textContent = "AI READY";

        trackingMessage.textContent =
            "✅ AI model ready. Start the camera.";

        setTimeout(() => {
            loading.style.display = "none";
        }, 1500);

    } catch (error) {

        console.error("AI ERROR:", error);

        model = null;

        modelStatus.textContent = "ERROR";

        loading.style.display = "block";
        loading.textContent = "AI LOAD FAILED";

        trackingMessage.textContent =
            "❌ " + error.message;
    }
}

async function startCamera() {

    try {

        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {

            throw new Error(
                "Camera API is not available."
            );
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
                }
            },
            audio: false
        });

        video.srcObject = stream;

        await video.play();

        cameraStatus.textContent = "ON";

        trackingMessage.textContent =
            "📷 Camera ready.";

        resizeCanvas();

    } catch (error) {

        console.error("CAMERA ERROR:", error);

        cameraStatus.textContent = "ERROR";

        trackingMessage.textContent =
            "❌ Camera error: " + error.message;
    }
}

function stopCamera() {

    stopTracking();

    if (stream) {

        stream.getTracks().forEach(track => {
            track.stop();
        });

        stream = null;
    }

    video.srcObject = null;

    cameraStatus.textContent = "OFF";

    clearCanvas();

    trackingMessage.textContent =
        "Camera stopped.";
}

function resizeCanvas() {

    if (!video.videoWidth ||
        !video.videoHeight) {
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

function clearCanvas() {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );
}

function startTracking() {

    if (!model) {

        trackingMessage.textContent =
            "❌ AI model is not ready yet.";

        return;
    }

    if (!stream) {

        trackingMessage.textContent =
            "❌ Start the camera first.";

        return;
    }

    if (tracking) {
        return;
    }

    tracking = true;

    trackingStatus.textContent = "ON";

    trackingMessage.textContent =
        "🎯 Searching for ball...";

    detectFrame();
}

function stopTracking() {

    tracking = false;

    if (animationId) {

        cancelAnimationFrame(
            animationId
        );

        animationId = null;
    }

    trackingStatus.textContent = "OFF";

    clearCanvas();

    trackingMessage.textContent =
        "Tracking stopped.";
}

async function detectFrame() {

    if (!tracking || !model) {
        return;
    }

    try {

        resizeCanvas();

        const predictions =
            await model.detect(video);

        clearCanvas();

        const balls =
            predictions.filter(
                object =>
                    object.class === "sports ball" &&
                    object.score > 0.25
            );

        if (balls.length > 0) {

            const ball = balls[0];

            drawDetection(ball);

            ballPosition.textContent =
                Math.round(ball.bbox[0]) +
                ", " +
                Math.round(ball.bbox[1]);

            confidence.textContent =
                (ball.score * 100).toFixed(1) +
                " %";

            trackingMessage.textContent =
                "🏏 Sports ball detected!";
        } else {

            trackingMessage.textContent =
                "🔎 Searching for ball...";
        }

    } catch (error) {

        console.error(
            "Detection error:",
            error
        );

        trackingMessage.textContent =
            "Detection error.";
    }

    animationId =
        requestAnimationFrame(
            detectFrame
        );
}

function drawDetection(prediction) {

    const x = prediction.bbox[0];
    const y = prediction.bbox[1];
    const width = prediction.bbox[2];
    const height = prediction.bbox[3];

    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;

    ctx.strokeRect(
        x,
        y,
        width,
        height
    );

    ctx.font =
        "bold 18px Arial";

    ctx.fillText(
        "BALL " +
        (prediction.score * 100).toFixed(0) +
        "%",
        x,
        Math.max(25, y - 8)
    );
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
