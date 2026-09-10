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

let cameraStream = null;
let tracking = false;
let animationId = null;

let trail = [];
let lastBall = null;

const detectorCanvas = document.createElement("canvas");
const detectorContext = detectorCanvas.getContext("2d", {
    willReadFrequently: true
});

async function startCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera not supported");
        }

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        video.srcObject = cameraStream;

        await video.play();

        cameraMessage.textContent = "Camera ON";
        statusText.textContent = "Camera Active";

        resizeCanvas();

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

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    video.srcObject = null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    trail = [];
    lastBall = null;

    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";
    speedText.textContent = "0 km/h";
    distanceText.textContent = "0 m";
}

function resizeCanvas() {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
}

function startTracking() {
    if (!cameraStream) {
        statusText.textContent = "Start camera first";
        return;
    }

    tracking = !tracking;

    if (tracking) {
        trackingButton.textContent = "STOP TRACKING";
        statusText.textContent = "Searching for ball";
        trail = [];
        lastBall = null;
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

function trackBall() {
    if (!tracking || !cameraStream) {
        return;
    }

    if (video.readyState < 2) {
        animationId = requestAnimationFrame(trackBall);
        return;
    }

    resizeCanvas();

    const width = 320;
    const height = Math.round(
        video.videoHeight * (width / video.videoWidth)
    );

    detectorCanvas.width = width;
    detectorCanvas.height = height;

    detectorContext.drawImage(
        video,
        0,
        0,
        width,
        height
    );

    const imageData = detectorContext.getImageData(
        0,
        0,
        width,
        height
    );

    const pixels = imageData.data;

    let totalX = 0;
    let totalY = 0;
    let count = 0;

    for (let y = 5; y < height - 5; y += 3) {

        for (let x = 5; x < width - 5; x += 3) {

            const index = (y * width + x) * 4;

            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];

            const brightness = (r + g + b) / 3;

            const whitePixel =
                r > 190 &&
                g > 190 &&
                b > 190 &&
                Math.max(r, g, b) - Math.min(r, g, b) < 45;

            if (whitePixel && brightness > 190) {
                totalX += x;
                totalY += y;
                count++;
            }
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (count > 20 && count < 2500) {

        const detectedX =
            (totalX / count) * (canvas.width / width);

        const detectedY =
            (totalY / count) * (canvas.height / height);

        const ball = {
            x: detectedX,
            y: detectedY
        };

        trail.push(ball);

        if (trail.length > 25) {
            trail.shift();
        }

        lastBall = ball;

        drawTrail();
        drawBall(ball);

        statusText.textContent = "Ball detected";

        calculateMovement();

    } else {

        drawTrail();

        statusText.textContent = "Searching for ball";
    }

    animationId = requestAnimationFrame(trackBall);
}

function drawBall(ball) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 18, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
}

function drawTrail() {
    if (trail.length < 2) {
        return;
    }

    ctx.beginPath();

    ctx.moveTo(trail[0].x, trail[0].y);

    for (let i = 1; i < trail.length; i++) {
        ctx.lineTo(trail[i].x, trail[i].y);
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.stroke();
}

function calculateMovement() {
    if (trail.length < 2) {
        return;
    }

    const first = trail[0];
    const last = trail[trail.length - 1];

    const dx = last.x - first.x;
    const dy = last.y - first.y;

    const pixelDistance = Math.sqrt(
        dx * dx + dy * dy
    );

    const estimatedDistance =
        pixelDistance / canvas.width * 20;

    distanceText.textContent =
        estimatedDistance.toFixed(2) + " m";

    speedText.textContent = "Calculating...";
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
trackingButton.addEventListener("click", startTracking);

window.addEventListener("resize", resizeCanvas);