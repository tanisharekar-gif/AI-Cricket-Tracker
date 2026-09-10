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

let selectedBall = null;
let trail = [];

let lastTime = 0;
let totalDistance = 0;

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

        stream.getTracks().forEach(track => {
            track.stop();
        });

        stream = null;
    }

    video.srcObject = null;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    selectedBall = null;
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

        statusText.textContent =
            "Start camera first";

        return;
    }

    tracking = !tracking;

    if (tracking) {

        trackingButton.textContent =
            "STOP TRACKING";

        statusText.textContent =
            "Tap the ball";

        trail = [];
        selectedBall = null;
        totalDistance = 0;

        trackBall();

    } else {

        trackingButton.textContent =
            "START TRACKING";

        statusText.textContent =
            "Tracking stopped";

        if (animationId) {
            cancelAnimationFrame(animationId);
        }

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );
    }
}

canvas.addEventListener("click", function(event) {

    if (!tracking) {
        return;
    }

    const rect = canvas.getBoundingClientRect();

    const x =
        (event.clientX - rect.left) *
        canvas.width /
        rect.width;

    const y =
        (event.clientY - rect.top) *
        canvas.height /
        rect.height;

    selectedBall = {
        x: x,
        y: y
    };

    trail = [
        {
            x: x,
            y: y
        }
    ];

    lastTime = performance.now();

    statusText.textContent =
        "Ball selected";

    positionText.textContent =
        Math.round(x) + ", " + Math.round(y);
});

function findBallNearSelected() {

    if (!selectedBall) {
        return null;
    }

    scanCtx.drawImage(
        video,
        0,
        0,
        scanWidth,
        scanHeight
    );

    const image =
        scanCtx.getImageData(
            0,
            0,
            scanWidth,
            scanHeight
        );

    const pixels = image.data;

    const selectedX =
        selectedBall.x *
        scanWidth /
        canvas.width;

    const selectedY =
        selectedBall.y *
        scanHeight /
        canvas.height;

    let bestX = 0;
    let bestY = 0;
    let bestScore = 0;

    const searchRadius = 35;

    for (
        let y = Math.max(2, selectedY - searchRadius);
        y < Math.min(scanHeight - 2, selectedY + searchRadius);
        y += 2
    ) {

        for (
            let x = Math.max(2, selectedX - searchRadius);
            x < Math.min(scanWidth - 2, selectedX + searchRadius);
            x += 2
        ) {

            const index =
                (Math.floor(y) * scanWidth +
                Math.floor(x)) * 4;

            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];

            const brightness =
                (r + g + b) / 3;

            const white =
                r > 150 &&
                g > 150 &&
                b > 150 &&
                Math.max(r, g, b) -
                Math.min(r, g, b) < 60;

            const red =
                r > 100 &&
                r > g * 1.3 &&
                r > b * 1.3;

            if (!white && !red) {
                continue;
            }

            const dx = x - selectedX;
            const dy = y - selectedY;

            const distance =
                Math.sqrt(dx * dx + dy * dy);

            if (distance > searchRadius) {
                continue;
            }

            const score =
                brightness -
                distance * 2;

            if (score > bestScore) {

                bestScore = score;
                bestX = x;
                bestY = y;
            }
        }
    }

    if (bestScore < 80) {
        return null;
    }

    return {
        x: bestX * canvas.width / scanWidth,
        y: bestY * canvas.height / scanHeight
    };
}

function drawBall(position) {

    ctx.beginPath();

    ctx.arc(
        position.x,
        position.y,
        18,
        0,
        Math.PI * 2
    );

    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        position.x,
        position.y,
        5,
        0,
        Math.PI * 2
    );

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

function calculateSpeed(position) {

    if (!selectedBall) {
        return;
    }

    const now = performance.now();

    const dx =
        position.x -
        selectedBall.x;

    const dy =
        position.y -
        selectedBall.y;

    const pixels =
        Math.sqrt(
            dx * dx +
            dy * dy
        );

    const time =
        (now - lastTime) / 1000;

    if (time > 0) {

        totalDistance += pixels;

        const pixelsPerSecond =
            pixels / time;

        const estimatedSpeed =
            pixelsPerSecond * 0.1 * 3.6;

        if (estimatedSpeed < 250) {

            speedText.textContent =
                estimatedSpeed.toFixed(1) +
                " km/h";
        }
    }

    lastTime = now;
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

    if (selectedBall) {

        const detected =
            findBallNearSelected();

        if (detected) {

            selectedBall = detected;

            trail.push(detected);

            if (trail.length > 40) {
                trail.shift();
            }

            drawTrail();
            drawBall(detected);

            positionText.textContent =
                Math.round(detected.x) +
                ", " +
                Math.round(detected.y);

            statusText.textContent =
                "Tracking ball";

            calculateSpeed(detected);

            distanceText.textContent =
                (totalDistance / 100).toFixed(2) +
                " m";

        } else {

            drawTrail();

            statusText.textContent =
                "Ball lost - move slowly";
        }

    } else {

        statusText.textContent =
            "Tap the ball to select it";
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