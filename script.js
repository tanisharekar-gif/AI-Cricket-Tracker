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

async function startCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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

        video.onloadedmetadata = async function () {
            await video.play();

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            cameraMessage.textContent = "Camera ON";
            statusText.textContent = "Camera Active";
        };

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
        statusText.textContent = "Tracking Ready";
        trackingLoop();
    } else {
        trackingButton.textContent = "START TRACKING";
        statusText.textContent = "Tracking stopped";

        cancelAnimationFrame(animationId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function trackingLoop() {
    if (!tracking || !stream) {
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    animationId = requestAnimationFrame(trackingLoop);
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
trackingButton.addEventListener("click", startTracking);