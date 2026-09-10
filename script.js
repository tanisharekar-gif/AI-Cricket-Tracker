const video = document.getElementById("video");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const cameraMessage = document.getElementById("cameraMessage");
const statusText = document.getElementById("status");
const speedText = document.getElementById("speed");
const distanceText = document.getElementById("distance");

let cameraStream = null;

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        cameraStream = stream;
        video.srcObject = stream;

        cameraMessage.textContent = "Camera ON";
        statusText.textContent = "Camera Active";

    } catch (error) {
        cameraMessage.textContent = "Camera Error";
        statusText.textContent = error.name;
        console.log(error);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    video.srcObject = null;
    cameraMessage.textContent = "Camera OFF";
    statusText.textContent = "Ready";
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);