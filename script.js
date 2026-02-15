"use strict";
// --- MATHEMATICAL CONSTANTS & UTILITIES ---
const TWO_PI = 2 * Math.PI;
// Hilbert Curve (Base 2)
function hilbert(order, d) {
    let x = 0,
        y = 0;
    let rx, ry, s;
    let t = d;
    const n = 1 << order;

    for (s = 1; s < n; s *= 2) {
        rx = 1 & (t / 2);
        ry = 1 & (t ^ rx);

        if (ry === 0) {
            if (rx === 1) {
                x = s - 1 - x;
                y = s - 1 - y;
            }
            [x, y] = [y, x]; // Swap x and y
        }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
    }
    return { x: x, y: y };
}

// --- GLOBAL VARIABLES & DOM REFERENCES ---
const baseSpeedSlider = document.getElementById("baseSpeed");
const baseSpeedVal = document.getElementById("baseSpeedVal");

if (baseSpeedSlider && baseSpeedVal) {
    baseSpeedSlider.addEventListener("input", (e) => {
        baseSpeedVal.innerText = e.target.value;
    });
}

// Gestione visibilità AMS
document.getElementById("filamentChangeMode").addEventListener("change", function (e) {
    const amsContainer = document.getElementById("amsSlotContainer");
    if (e.target.value === "ams") {
        amsContainer.classList.remove("hidden");
    } else {
        amsContainer.classList.add("hidden");
    }
});
let gcodeContent = "";
let originalImage = null;
let originalImageRatio = 1.0;
let gcodeTemplateContent = null;
document.getElementById("gcodeTemplate").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (event) {
        gcodeTemplateContent = event.target.result;
        console.log("G-code uploaded!");
    };
    reader.readAsText(file);
});
// 3D preview globals
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeMesh = null;
let threeAnimating = false;
let threeOrbitRadius = 200;
let threeOrbitTheta = -Math.PI / 4;
let threeOrbitPhi = Math.PI / 4;
let threeOrbitDragging = false;
let threePanDragging = false;
let threeOrbitLastX = 0;
let threeOrbitLastY = 0;
let threeTarget = new THREE.Vector3(0, 0, 0);

const imageInput = document.getElementById("imageInput");
const hiddenCanvas = document.getElementById("hiddenCanvas");
const ctx = hiddenCanvas.getContext("2d");
const previewCanvas = document.getElementById("previewCanvas");
const previewCtx = previewCanvas.getContext("2d");
const printWidthInput = document.getElementById("printWidth");
const printHeightInput = document.getElementById("printHeight");

// Pan & Zoom State Variables
const PREVIEW_SCALE = 3;
let imageOffsetX = 0.0;
let imageOffsetY = 0.0;
let imageZoom = 1.0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// --- PROPORTIONAL LOGIC ---
function updatePrintHeightFromWidth(newWidth) {
    if (originalImage) {
        printHeightInput.value = (newWidth / originalImageRatio).toFixed(2);
    }
}

function updatePrintWidthFromHeight(newHeight) {
    if (originalImage) {
        printWidthInput.value = (newHeight * originalImageRatio).toFixed(2);
    }
}

printWidthInput.addEventListener("input", () => {
    updatePrintHeightFromWidth(parseFloat(printWidthInput.value));
});
printHeightInput.addEventListener("input", () => {
    updatePrintWidthFromHeight(parseFloat(printHeightInput.value));
});

function drawImageSlicePreview(bedSize, offsetX, offsetY, printWidth, printHeight) {
    if (!originalImage) return;

    // 1. Clear and setup Canvas (Y-up for G-code visual alignment)
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    previewCtx.translate(0, previewCanvas.height);
    previewCtx.scale(PREVIEW_SCALE, -PREVIEW_SCALE);

    // 2. Draw Bed Boundary
    previewCtx.strokeStyle = "#cbd5e1";
    previewCtx.lineWidth = 1;
    previewCtx.strokeRect(0, 0, bedSize, bedSize);

    const hideImageOverlayChecked = document.getElementById("hideImageOverlay").checked;

    if (hideImageOverlayChecked) {
        const sX_norm = imageOffsetX;
        const sY_norm = imageOffsetY;
        const sW_norm = 1.0 / imageZoom;
        const sH_norm = 1.0 / imageZoom;

        previewCtx.save();
        previewCtx.translate(offsetX, offsetY);
        previewCtx.scale(1, -1);
        previewCtx.translate(0, -printHeight);

        const mirrorimage = document.getElementById("mirrorimage").checked;
        if (mirrorimage) {
            previewCtx.translate(printWidth, 0);
            previewCtx.scale(-1, 1);
        }

        previewCtx.drawImage(
            originalImage,
            originalImage.width * sX_norm,
            originalImage.height * sY_norm,
            originalImage.width * sW_norm,
            originalImage.height * sH_norm,
            0,
            0,
            printWidth,
            printHeight
        );

        previewCtx.restore();
    }

    previewCtx.strokeStyle = "#ef4444";
    previewCtx.lineWidth = 1;
    previewCtx.strokeRect(offsetX, offsetY, printWidth, printHeight);
}

// --- IMAGE MANIPULATION HANDLERS (Pan & Zoom) ---
function setupImageManipulationHandlers() {
    const pC = previewCanvas;

    const getPrintParams = () => {
        const bedSize = parseFloat(document.getElementById("bedSize").value) || 250;
        const printWidth = parseFloat(printWidthInput.value) || 100;
        const printHeight = parseFloat(printHeightInput.value) || 100;
        const offsetX = (bedSize - printWidth) / 2;
        const offsetY = (bedSize - printHeight) / 2;
        return { bedSize, printWidth, printHeight, offsetX, offsetY };
    };

    pC.addEventListener("mousedown", (e) => {
        if (!originalImage) return;
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        pC.style.cursor = "grabbing";
    });

    document.addEventListener("mouseup", () => {
        isDragging = false;
        pC.style.cursor = "grab";
    });

    pC.addEventListener("mousemove", (e) => {
        if (!isDragging || !originalImage) return;

        const { bedSize, printWidth, printHeight, offsetX, offsetY } = getPrintParams();

        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        const areaWidthOnScreen = printWidth * PREVIEW_SCALE;
        const areaHeightOnScreen = printHeight * PREVIEW_SCALE;

        const uvDeltaX = dx / areaWidthOnScreen;
        const uvDeltaY = dy / areaHeightOnScreen;

        imageOffsetX -= uvDeltaX / imageZoom;
        imageOffsetY += uvDeltaY / imageZoom;

        const maxOffset = 1 - 1 / imageZoom;
        imageOffsetX = Math.max(0, Math.min(maxOffset, imageOffsetX));
        imageOffsetY = Math.max(0, Math.min(maxOffset, imageOffsetY));

        drawImageSlicePreview(bedSize, offsetX, offsetY, printWidth, printHeight);
    });

    pC.addEventListener(
        "wheel",
        (e) => {
            if (!originalImage) return;
            e.preventDefault();

            const { bedSize, printWidth, printHeight, offsetX, offsetY } = getPrintParams();

            const rect = pC.getBoundingClientRect();
            const mouseX_mm = (e.clientX - rect.left) / PREVIEW_SCALE;
            const mouseY_mm = (pC.height - (e.clientY - rect.top)) / PREVIEW_SCALE;

            const u_print = (mouseX_mm - offsetX) / printWidth;
            const v_print = (mouseY_mm - offsetY) / printHeight;

            const u_clamped = Math.max(0, Math.min(1, u_print));
            const v_clamped = Math.max(0, Math.min(1, v_print));

            const v_print_ydown = 1.0 - v_clamped;

            const u_source_old = u_clamped / imageZoom + imageOffsetX;
            const v_source_old = v_print_ydown / imageZoom + imageOffsetY;

            const zoomDelta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            let newZoom = imageZoom * zoomDelta;

            imageZoom = Math.max(1.0, Math.min(10.0, newZoom));

            let newOffsetX = u_source_old - u_clamped / imageZoom;
            let newOffsetY = v_source_old - v_print_ydown / imageZoom;

            const maxOffset = 1 - 1 / imageZoom;
            newOffsetX = Math.max(0, Math.min(maxOffset, newOffsetX));
            newOffsetY = Math.max(0, Math.min(maxOffset, newOffsetY));

            imageOffsetX = newOffsetX;
            imageOffsetY = newOffsetY;

            drawImageSlicePreview(bedSize, offsetX, offsetY, printWidth, printHeight);
        },
        { passive: false }
    );
}

// --- IMAGE LOADING EVENT LISTENER ---
imageInput.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        originalImage = new Image();
        originalImage.onload = function () {
            originalImageRatio = originalImage.width / originalImage.height;

            document.getElementById("imageRatioInfo").innerText =
                `Image Ratio: ${originalImage.width}x${originalImage.height}px (X/Y Ratio: ${originalImageRatio.toFixed(2)}:1)`;

            updatePrintHeightFromWidth(parseFloat(printWidthInput.value));

            imageZoom = 1.0;
            imageOffsetX = 0.0;
            imageOffsetY = 0.0;

            const bedSize = parseFloat(document.getElementById("bedSize").value) || 250;
            previewCanvas.width = bedSize * PREVIEW_SCALE;
            previewCanvas.height = bedSize * PREVIEW_SCALE;

            const printWidth = parseFloat(printWidthInput.value) || 100;
            const printHeight = parseFloat(printHeightInput.value) || 100;
            const offsetX = (bedSize - printWidth) / 2;
            const offsetY = (bedSize - printHeight) / 2;
            drawImageSlicePreview(bedSize, offsetX, offsetY, printWidth, printHeight);
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- BRIGHTNESS FUNCTION WITH GAMMA (OPTIMIZED) ---
function getBrightnessAtUV(u_print, v_print_yup, pixels, anaW, anaH, gammaVal) {
    const v_print_ydown = 1.0 - v_print_yup;

    let u_source = u_print / imageZoom + imageOffsetX;
    let v_source = v_print_ydown / imageZoom + imageOffsetY;

    u_source = Math.max(0, Math.min(1, u_source));
    v_source = Math.max(0, Math.min(1, v_source));

    const x = Math.floor(u_source * (anaW - 1));
    const y = Math.floor(v_source * (anaH - 1));

    const idx = (y * anaW + x) * 4;

    const avgColor = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3.0;
    let val = avgColor / 255.0;

    val = Math.pow(val, 1.0 / gammaVal);

    return 1.0 - val;
}

// --- MAIN PROCESS ---
function processImage() {
    if (!originalImage) {
        alert("Please upload an image first!");
        return;
    }

    const pathType = document.getElementById("pathType").value;
    const filamentDia = parseFloat(document.getElementById("filamentDia").value) || 1.75;
    const layerHeight = parseFloat(document.getElementById("layerHeight").value) || 0.2;
    const zOffset = parseFloat(document.getElementById("zOffset").value) || 0.2;
    const bedSize = parseFloat(document.getElementById("bedSize").value) || 250;

    const printWidth = parseFloat(printWidthInput.value) || 100;
    const printHeight = parseFloat(printHeightInput.value) || 100;

    const spacing = parseFloat(document.getElementById("lineSpacing").value) || 0.6;
    const minW = parseFloat(document.getElementById("minLineWidth").value) || 0.3;
    const maxW = parseFloat(document.getElementById("maxLineWidth").value) || 0.8;
    const mirrorimage = document.getElementById("mirrorimage").checked;

    const minSpeedMMS = parseFloat(document.getElementById("minSpeed").value) || 15;
    const maxSpeedMMS = parseFloat(document.getElementById("maxSpeed").value) || 60;
    const minSpeed = minSpeedMMS * 60;
    const maxSpeed = maxSpeedMMS * 60;
    const gammaVal = parseFloat(document.getElementById("gamma").value) || 1.5;
    const squiggleAmp = parseFloat(document.getElementById("squiggleAmp").value) || 0.0;
    const squiggleFreq = parseFloat(document.getElementById("squiggleFreq").value) || 5;
    const useSquiggle = squiggleAmp > 0.01;
    const fractalOrder = parseInt(document.getElementById("hilbertOrder").value) || 6;

    const addCircularBase = document.getElementById("addCircularBase").checked;
    const baseMargin = parseFloat(document.getElementById("baseMargin").value) || 2;
    const baseLayers = Math.max(1, parseInt(document.getElementById("baseLayers").value) || 2);

    const anaW = originalImage.width;
    const anaH = originalImage.height;

    hiddenCanvas.width = anaW;
    hiddenCanvas.height = anaH;
    ctx.drawImage(originalImage, 0, 0, anaW, anaH);
    const pixels = ctx.getImageData(0, 0, anaW, anaH).data;

    const offsetX = (bedSize - printWidth) / 2;
    const offsetY = (bedSize - printHeight) / 2;
    const filArea = Math.PI * Math.pow(filamentDia / 2, 2);
    const safeZ = zOffset + 5.0;
    let totalE = 0;

    const printDim = Math.min(printWidth, printHeight);
    const baseRadius = printDim / 2;
    const centerX = offsetX + printWidth / 2;
    const centerY = offsetY + printHeight / 2;
    const innerRadius = Math.max(0, baseRadius - baseMargin);

    previewCanvas.width = bedSize * PREVIEW_SCALE;
    previewCanvas.height = bedSize * PREVIEW_SCALE;
    drawImageSlicePreview(bedSize, offsetX, offsetY, printWidth, printHeight);

    if (addCircularBase) {
        previewCtx.strokeStyle = "rgba(100,100,100,0.5)";
        previewCtx.lineWidth = 1 / PREVIEW_SCALE;
        previewCtx.setLineDash([4, 4]);
        if (pathType === "spiral") {
            previewCtx.beginPath();
            previewCtx.arc(centerX, centerY, baseRadius, 0, TWO_PI);
            previewCtx.stroke();
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            previewCtx.beginPath();
            previewCtx.arc(centerX, centerY, innerRadius, 0, TWO_PI);
            previewCtx.stroke();
        } else if (pathType === "squareSpiral") {
            previewCtx.strokeRect(centerOffset.x, centerOffset.y, printDim, printDim);
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            const ins = Math.min(baseMargin, printDim / 2);
            previewCtx.strokeRect(centerOffset.x + ins, centerOffset.y + ins, printDim - 2 * ins, printDim - 2 * ins);
        } else {
            previewCtx.strokeRect(offsetX, offsetY, printWidth, printHeight);
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            const ins = Math.min(baseMargin, printWidth / 2, printHeight / 2);
            previewCtx.strokeRect(offsetX + ins, offsetY + ins, printWidth - 2 * ins, printHeight - 2 * ins);
        }
        previewCtx.setLineDash([]);
    }

    let gcode = [];
    gcode.push(`; --- G-Code Art Generator v6.3 (Zoomed) ---`);
    gcode.push(`G90 ; Absolute Coordinates (XYZE)`);
    gcode.push(`M83 ; Relative Extrusion`);

    let startPoint = { x: offsetX, y: offsetY };
    const centerOffset = {
        x: offsetX + (printWidth - printDim) / 2,
        y: offsetY + (printHeight - printDim) / 2
    };

    if (["spiral", "squareSpiral"].includes(pathType)) {
        startPoint = { x: offsetX + printWidth / 2, y: offsetY + printHeight / 2 };
    } else if (pathType === "hilbert") {
        const order = fractalOrder;
        const N = 1 << order;
        const step = printDim / N;
        let p0 = hilbert(order, 0);
        startPoint = { x: centerOffset.x + p0.x * step, y: centerOffset.y + p0.y * step };
    }

    let prevX = startPoint.x;
    let prevY = startPoint.y;

    const BASE_SPACING = 0.5;
    const BASE_LINE_WIDTH = 0.5;
    const baseSpeedMMS = parseFloat(document.getElementById("baseSpeed")?.value) || 30;
    const baseSpeed = baseSpeedMMS * 60;

    let drawingStartZ = zOffset;

    function writeBaseSegment(x, y) {
        const dist = Math.hypot(x - prevX, y - prevY);
        if (dist < 0.01) return;
        const vol = dist * BASE_LINE_WIDTH * layerHeight;
        const e = vol / filArea;
        gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${baseSpeed.toFixed(0)}`);
        totalE += e;
        prevX = x;
        prevY = y;
    }

    // Recupero i valori dai nuovi selettori HTML
    const changeMode = document.getElementById("filamentChangeMode").value;
    const amsBaseSlot = document.getElementById("amsBaseSlot").value;
    const amsDrawingSlot = document.getElementById("amsDrawingSlot").value;

    if (addCircularBase) {
        // --- 1. SELEZIONE FILAMENTO INIZIALE (SOLO AMS) ---
        if (changeMode === "ams") {
            gcode.push(`${amsBaseSlot} ; Select Base Filament Slot`);
            gcode.push(`M400 ; Wait for load`);
        }

        gcode.push(`; --- Circular Base with 3 Walls and Zig-Zag Infill ---`);
        gcode.push(`G0 Z${safeZ.toFixed(3)} F6000 ; Lift to safe Z`);

        const baseOverlap = 0.45;
        const wallSpacing = 0.42;
        const numWalls = 3;

        for (let layer = 0; layer < baseLayers; layer++) {
            const z = zOffset + layer * layerHeight;
            gcode.push(`G1 Z${z.toFixed(3)} F1000 ; Base layer ${layer + 1}/${baseLayers}`);

            // 1. Disegno dei muri (Walls)
            for (let w = 0; w < numWalls; w++) {
                const currentWallRadius = baseRadius - w * wallSpacing;
                const numPoints = Math.max(60, Math.ceil((TWO_PI * currentWallRadius) / 0.5));
                const dAngle = TWO_PI / numPoints;
                const startX = centerX + currentWallRadius;
                const startY = centerY;

                gcode.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} F6000`);
                prevX = startX; prevY = startY;

                for (let i = 1; i <= numPoints; i++) {
                    const angle = i * dAngle;
                    const x = centerX + currentWallRadius * Math.cos(angle);
                    const y = centerY + currentWallRadius * Math.sin(angle);
                    writeBaseSegment(x, y);
                }
            }

            // --- NOVITÀ: OTTIMIZZAZIONE TRANSIZIONE MURI -> INFILL ---
            gcode.push(`G1 E-0.8 F3000 ; Retrazione anti-blob`);
            gcode.push(`G0 Z${(z + 0.4).toFixed(3)} F6000 ; Z-Hop di sicurezza`);

            let goingRight = true;
            // Ridotto l'overlap da +0.1 a -0.05 per non "pestare" i muri
            const fillLimitRadius = baseRadius - (numWalls * wallSpacing) - 0.05; 
            const infillTotalHeight = fillLimitRadius * 2;

            for (let yRel = -fillLimitRadius; yRel <= fillLimitRadius; yRel += baseOverlap) {
                const xLimit = Math.sqrt(Math.max(0, Math.pow(fillLimitRadius, 2) - Math.pow(yRel, 2)));
                const xLeft = centerX - xLimit;
                const xRight = centerX + xLimit;
                const currentY = centerY + yRel;

                // --- NOVITÀ: VELOCITÀ RIDOTTA NEL PRIMO 10% ---
                let currentSpeed = baseSpeed;
                if (yRel < (-fillLimitRadius + (infillTotalHeight * 0.10))) {
                    currentSpeed = baseSpeed * 0.5; // Vai al 50% della velocità
                }

                if (goingRight) {
                    if (yRel === -fillLimitRadius || Math.abs(yRel + fillLimitRadius) < 0.01) {
                        gcode.push(`G0 X${xLeft.toFixed(3)} Y${currentY.toFixed(3)} F6000`);
                        gcode.push(`G1 Z${z.toFixed(3)} F1000 ; Torna in quota`);
                        gcode.push(`G1 E0.8 F3000 ; Prime (ripristino filo)`);
                        prevX = xLeft; prevY = currentY;
                    } else {
                        writeBaseSegment(xLeft, currentY, currentSpeed);
                    }
                    writeBaseSegment(xRight, currentY, currentSpeed);
                } else {
                    writeBaseSegment(xRight, currentY, currentSpeed);
                    writeBaseSegment(xLeft, currentY, currentSpeed);
                }
                goingRight = !goingRight;
            }
            // Fine layer: un piccolo salto prima di salire al prossimo
            gcode.push(`G0 Z${(z + 0.5).toFixed(3)} F6000`);
        }

        // --- 2. TRANSIZIONE AL DISEGNO ---
        gcode.push(`; --- TRANSITION TO ARTWORK ---`);

        if (changeMode === "ams") {
            gcode.push(`M400 ; Finish all moves`);
            gcode.push(`G91 ; Relative`);
            gcode.push(`G1 Z5 F3000 ; Lift for toolchange`);
            gcode.push(`G90 ; Absolute`);

            // Usiamo il secondo slot scelto dall'utente
            gcode.push(`${amsDrawingSlot} ; Switch to Drawing Filament Slot`);

            gcode.push(`M400 ; Wait for AMS`);
            gcode.push(`G92 E0 ; Reset extruder`);
        } else {
            gcode.push(`G91 ; Relative`);
            gcode.push(`G1 E-5 F3000 ; Retract`);
            gcode.push(`G1 Z10 F1000 ; Safety lift`);
            gcode.push(`G90 ; Absolute`);
            gcode.push(`G0 X0 Y0 F6000 ; Park`);
            gcode.push(`M600 ; Manual Pause`);
        }

        drawingStartZ = zOffset + baseLayers * layerHeight;
        gcode.push(`; --- STARTING ARTWORK DRAWING ---`);
        gcode.push(`G0 Z${(drawingStartZ + 5).toFixed(3)} F3000`);
        gcode.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} F6000`);
        gcode.push(`G1 Z${drawingStartZ.toFixed(3)} F1000`);
        prevX = startPoint.x;
        prevY = startPoint.y;
    } else {
        // --- 3. LOGICA SENZA BASE (SELEZIONE SLOT DISEGNO) ---
        if (changeMode === "ams") {
            gcode.push(`${amsDrawingSlot} ; Select Drawing Filament (No base)`);
        }
        gcode.push(`G0 Z${safeZ.toFixed(3)} F3000`);
        gcode.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} F6000`);
        gcode.push(`G1 Z${zOffset.toFixed(3)} F1000`);
        prevX = startPoint.x;
        prevY = startPoint.y;
    }

    function writeMove(x, y, targetW, targetF, isTravel = false) {
        const dist = Math.hypot(x - prevX, y - prevY);

        if (isTravel || dist < 0.01) {
            gcode.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F6000`);
            previewCtx.beginPath();
            previewCtx.moveTo(prevX, prevY);
            previewCtx.lineTo(x, y);
            previewCtx.lineWidth = 1 / PREVIEW_SCALE;
            previewCtx.lineCap = "round";
            previewCtx.strokeStyle = `rgba(0,0,0, 0.4)`;
            previewCtx.stroke();
        } else {
            const vol = dist * targetW * layerHeight;
            const e = vol / filArea;
            gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${targetF.toFixed(0)}`);
            totalE += e;

            previewCtx.beginPath();
            previewCtx.moveTo(prevX, prevY);
            previewCtx.lineTo(x, y);
            previewCtx.lineWidth = targetW;
            previewCtx.lineCap = "round";
            previewCtx.strokeStyle = `rgba(0,0,0, 0.9)`;
            previewCtx.stroke();
        }
        prevX = x;
        prevY = y;
        return dist;
    }

    function isInsideBaseClip(x, y) {
        if (pathType === "spiral") {
            return Math.hypot(x - centerX, y - centerY) <= innerRadius;
        }
        if (pathType === "squareSpiral") {
            const ins = baseMargin;
            return (
                x >= centerOffset.x + ins &&
                x <= centerOffset.x + printDim - ins &&
                y >= centerOffset.y + ins &&
                y <= centerOffset.y + printDim - ins
            );
        }
        const ins = baseMargin;
        return (
            x >= offsetX + ins &&
            x <= offsetX + printWidth - ins &&
            y >= offsetY + ins &&
            y <= offsetY + printHeight - ins
        );
    }

    function doSmartMove(x, y, isConnect = false) {
        if (addCircularBase && !isInsideBaseClip(x, y)) {
            writeMove(x, y, 0, 0, true);
            return;
        }

        let u = (x - offsetX) / printWidth;
        let v_yup = (y - offsetY) / printHeight;

        let u_sample = u;
        let v_sample_yup = v_yup;

        if (mirrorimage) {
            u_sample = 1.0 - u;
        }

        const darkness = getBrightnessAtUV(u_sample, v_sample_yup, pixels, anaW, anaH, gammaVal);

        const targetW = minW + darkness * (maxW - minW);
        const targetF = maxSpeed - darkness * (maxSpeed - minSpeed);

        if (isConnect || !useSquiggle || darkness < 0.1) {
            writeMove(x, y, targetW, targetF, isConnect);
        } else {
            const startX = prevX;
            const startY = prevY;
            const distTotal = Math.hypot(x - startX, y - startY);
            const numSegments = Math.max(2, Math.floor(distTotal / 0.1));

            const dx = (x - startX) / numSegments;
            const dy = (y - startY) / numSegments;

            const norm = Math.hypot(dx, dy);
            let dx_perp = -dy / norm;
            let dy_perp = dx / norm;

            const amplitude = squiggleAmp * darkness;
            const freq = squiggleFreq * TWO_PI;

            for (let i = 1; i <= numSegments; i++) {
                const currentDist = (i / numSegments) * distTotal;

                let px_straight = startX + dx * i;
                let py_straight = startY + dy * i;

                const phase = currentDist * freq;
                const offsetMag = Math.sin(phase) * amplitude;

                const px_squiggle = px_straight + dx_perp * offsetMag;
                const py_squiggle = py_straight + dy_perp * offsetMag;

                writeMove(px_squiggle, py_squiggle, targetW, targetF);
            }
        }
    }

    if (pathType === "hilbert") {
        const order = fractalOrder;
        const N = 1 << order;
        const totalPoints = N * N;
        const step = printDim / N;

        for (let d = 1; d < totalPoints; d++) {
            let p = hilbert(order, d);
            doSmartMove(centerOffset.x + p.x * step, centerOffset.y + p.y * step);
        }
    } else if (pathType === "squareSpiral") {
        let currentSize = printDim;
        let currentOffset = { x: centerOffset.x, y: centerOffset.y };
        const res = 0.5;

        while (currentSize > spacing * 1.5) {
            let x0 = currentOffset.x;
            let y0 = currentOffset.y;
            let x1 = currentOffset.x + currentSize;
            let y1 = currentOffset.y + currentSize;

            const moveLine = (startX, startY, endX, endY, length) => {
                const numSegs = Math.max(2, Math.floor(length / res));
                for (let k = 1; k <= numSegs; k++) {
                    let t = k / numSegs;
                    doSmartMove(startX + (endX - startX) * t, startY + (endY - startY) * t);
                }
            };

            moveLine(x0, y0, x1, y0, currentSize);
            moveLine(x1, y0, x1, y1, currentSize);
            moveLine(x1, y1, x0, y1, currentSize);

            let remainingLength = currentSize - spacing;
            moveLine(x0, y1, x0, y1 - remainingLength, remainingLength);

            let nextX = currentOffset.x + spacing;
            let nextY = currentOffset.y + spacing;
            doSmartMove(nextX, nextY, true);

            currentSize -= spacing * 2;
            currentOffset.x += spacing;
            currentOffset.y += spacing;
        }

        if (currentSize > 0) {
            doSmartMove(currentOffset.x + currentSize / 2, currentOffset.y + currentSize / 2);
        }
    } else if (pathType === "diagonal") {
        const axisStep = spacing * Math.sqrt(2);
        const maxSum = printWidth + printHeight;
        const numDiagonals = Math.floor(maxSum / axisStep);

        for (let i = 0; i <= numDiagonals; i++) {
            let sum = i * axisStep;

            let p1x = sum <= printHeight ? 0 : sum - printHeight;
            let p1y = sum <= printHeight ? sum : printHeight;
            let p2x = sum <= printWidth ? sum : printWidth;
            let p2y = sum <= printWidth ? 0 : sum - printWidth;

            let startX, startY, endX, endY;
            if (i % 2 === 0) {
                startX = p1x;
                startY = p1y;
                endX = p2x;
                endY = p2y;
            } else {
                startX = p2x;
                startY = p2y;
                endX = p1x;
                endY = p1y;
            }

            startX = Math.max(0, Math.min(printWidth, startX));
            startY = Math.max(0, Math.min(printHeight, startY));
            endX = Math.max(0, Math.min(printWidth, endX));
            endY = Math.max(0, Math.min(printHeight, endY));

            if (i > 0) {
                doSmartMove(offsetX + startX, offsetY + startY, true);
            }

            const distLine = Math.hypot(endX - startX, endY - startY);

            if (distLine > 0.01) {
                const numSegs = Math.max(2, Math.floor(distLine / 0.5));

                for (let k = 1; k <= numSegs; k++) {
                    let t = k / numSegs;
                    doSmartMove(offsetX + startX + (endX - startX) * t, offsetY + startY + (endY - startY) * t);
                }
            }
        }
    } else if (pathType === "spiral") {
        let cx = offsetX + printWidth / 2;
        let cy = offsetY + printHeight / 2;
        let radius = 0.0;
        let angle = 0;
        const maxRadius = addCircularBase ? innerRadius : printDim / 2;

        while (radius < maxRadius) {
            let res = 0.5;
            let dTheta = res / Math.max(0.5, radius);
            angle += dTheta;
            radius = (spacing / TWO_PI) * angle;

            if (radius > maxRadius) break;

            let px = cx + radius * Math.cos(angle);
            let py = cy + radius * Math.sin(angle);
            doSmartMove(px, py);
        }
    } else {
        const lines = Math.floor(printHeight / spacing);

        for (let i = 0; i < lines; i++) {
            let y = i * spacing;
            let even = i % 2 === 0;
            let xStart = even ? 0 : printWidth;
            let xEnd = even ? printWidth : 0;

            if (i > 0) {
                doSmartMove(offsetX + xStart, offsetY + y, true);
            }

            const distLine = printWidth;
            const numSegs = Math.max(2, Math.floor(distLine / 0.5));
            for (let k = 1; k <= numSegs; k++) {
                let t = k / numSegs;
                let currX = xStart + (xEnd - xStart) * t;
                doSmartMove(offsetX + currX, offsetY + y);
            }
        }
    }

    gcode.push(`G0 Z${safeZ.toFixed(3)} F3000 ; Lift to safe Z`);
    gcode.push(`; Total Extruded: E${totalE.toFixed(2)}`);
    gcode.push(`; --- End of Central G-Code Block ---`);

    // --- 1. PREPARAZIONE G-CODE E MERGE ---
    const artOnlyGcode = gcode.join("\n");

    // Eseguiamo il merge con il template caricato cercando ;MARKER
    const finalGcode = mergeWithTemplate(artOnlyGcode);

    // Aggiorniamo la variabile globale gcodeContent per il download
    gcodeContent = finalGcode;

    // Aggiorniamo la textarea se presente
    const outputArea = document.getElementById("gcodeOutput");
    if (outputArea) {
        outputArea.value = finalGcode;
    }

    // --- 2. AGGIORNAMENTO PREVIEW E STATISTICHE ---
    if (typeof update3DPreviewFromGcode === "function") {
        update3DPreviewFromGcode(artOnlyGcode);
    }

    document.getElementById("downloadBtn").style.display = "inline-block";
    const statsElem = document.getElementById("stats");
    if (statsElem) {
        statsElem.style.display = "block";
        const baseInfo =
            typeof addCircularBase !== "undefined" && addCircularBase
                ? `Base: ${baseLayers} layer(s), margin ${baseMargin}mm (drawing on top after M0 pause)<br>`
                : "";

        statsElem.innerHTML = `
            <strong>Result:</strong><br>
            Print Dimensions: ${printWidth.toFixed(2)}x${printHeight.toFixed(2)}mm<br>
            ${baseInfo}Estimated Filament: ${(totalE / 1000).toFixed(2)}m<br>
            Speed: ${minSpeedMMS} - ${maxSpeedMMS} mm/s
        `;
    }
}

// --- 3D PREVIEW ENGINE (three.js) ---
function init3DPreview() {
    if (!window.THREE || threeRenderer) return;

    const container = document.getElementById("preview3dContainer");
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 240;

    // --- SCENE ---
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x020617);

    // --- CAMERA ---
    threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    threeCamera.up.set(0, 0, 1);

    // --- RENDERER ---
    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setSize(width, height);
    threeRenderer.setPixelRatio(window.devicePixelRatio || 1);

    // --- LIGHTS ---
    const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
    threeScene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(100, -100, 200);
    threeScene.add(dirLight);

    // --- ATTACH CANVAS ---
    container.innerHTML = "";
    container.appendChild(threeRenderer.domElement);

    // 🔴 FONDAMENTALE: inizializza subito la posizione camera
    updateThreeCameraFromOrbit();

    // --- CONTROLS ---
    const dom = threeRenderer.domElement;
    dom.style.cursor = "grab";

    dom.addEventListener("mousedown", (e) => {
        if (e.button === 2) threePanDragging = true;
        else threeOrbitDragging = true;

        threeOrbitLastX = e.clientX;
        threeOrbitLastY = e.clientY;
        dom.style.cursor = "grabbing";
    });

    window.addEventListener("mouseup", () => {
        threeOrbitDragging = false;
        threePanDragging = false;
        dom.style.cursor = "grab";
    });

    dom.addEventListener("mousemove", (e) => {
        if (!threeCamera) return;

        const dx = e.clientX - threeOrbitLastX;
        const dy = e.clientY - threeOrbitLastY;
        threeOrbitLastX = e.clientX;
        threeOrbitLastY = e.clientY;

        if (threeOrbitDragging) {
            threeOrbitTheta -= dx * 0.005;
            threeOrbitPhi += dy * 0.005;
            threeOrbitPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, threeOrbitPhi));
            updateThreeCameraFromOrbit();
        } else if (threePanDragging) {
            const panSpeed = threeOrbitRadius * 0.001;

            // Direzione destra della camera (proiettata su XY)
            const right = new THREE.Vector3(Math.cos(threeOrbitTheta), Math.sin(threeOrbitTheta), 0).normalize();

            // Direzione avanti (per movimento verticale su schermo)
            const forward = new THREE.Vector3(-Math.sin(threeOrbitTheta), Math.cos(threeOrbitTheta), 0).normalize();

            const moveRight = -dy * panSpeed;
            const moveForward = -dx * panSpeed;

            const move = new THREE.Vector3();
            move.addScaledVector(right, moveRight);
            move.addScaledVector(forward, moveForward);

            // 🔴 Sposta SIA target che camera
            threeTarget.add(move);
            threeCamera.position.add(move);
        }
    });

    dom.addEventListener(
        "wheel",
        (e) => {
            if (!threeCamera) return;
            e.preventDefault();

            const rect = dom.getBoundingClientRect();

            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, threeCamera);

            // Intersezione con piano Z=0
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            const intersection = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, intersection);

            if (!intersection) return;

            const zoomFactor = 1 + e.deltaY * 0.001;
            const newRadius = THREE.MathUtils.clamp(threeOrbitRadius * zoomFactor, 20, 2000);

            const scale = newRadius / threeOrbitRadius;
            threeOrbitRadius = newRadius;

            // Compensazione per mantenere il punto sotto il mouse fermo
            const offset = new THREE.Vector3().subVectors(intersection, threeTarget).multiplyScalar(1 - scale);

            threeTarget.add(offset);
            threeCamera.position.add(offset);

            updateThreeCameraFromOrbit();
        },
        { passive: false }
    );

    dom.addEventListener("contextmenu", (e) => e.preventDefault());

    // --- RESIZE HANDLER ---
    window.addEventListener("resize", () => {
        if (!threeRenderer || !threeCamera) return;

        const w = container.clientWidth;
        const h = container.clientHeight;

        threeRenderer.setSize(w, h);
        threeCamera.aspect = w / h;
        threeCamera.updateProjectionMatrix();
    });

    // --- ANIMATION LOOP ---
    if (!threeAnimating) {
        threeAnimating = true;

        const animate = () => {
            requestAnimationFrame(animate);
            if (threeRenderer && threeScene && threeCamera) {
                threeRenderer.render(threeScene, threeCamera);
            }
        };

        animate();
    }
}

function updateThreeCameraFromOrbit() {
    if (!threeCamera) return;
    const x = threeOrbitRadius * Math.cos(threeOrbitTheta) * Math.cos(threeOrbitPhi);
    const y = threeOrbitRadius * Math.sin(threeOrbitTheta) * Math.cos(threeOrbitPhi);
    const z = threeOrbitRadius * Math.sin(threeOrbitPhi);
    threeCamera.position.set(x, y, z);
    threeCamera.lookAt(threeTarget);
}

function parseGcodeToSegments(gcode) {
    const lines = gcode.split("\n");
    let segments = [];
    let x = 0,
        y = 0,
        z = 0;
    let inBase = true; // Assume che si inizi con la base

    for (let raw of lines) {
        let line = raw.trim();

        // 1. Gestione Commenti e Marker
        if (!line || line.startsWith(";")) {
            // Se troviamo il marker di inizio disegno, smettiamo di considerarlo "Base"
            if (line.includes("STARTING ARTWORK DRAWING")) {
                inBase = false;
            }
            continue; // Salta la riga
        }

        // 2. Gestione Pause (M0, M600, ecc.)
        if (line.startsWith("M0") || line.startsWith("M600") || line.includes("Pause")) {
            // Spesso dopo la pausa inizia il disegno
            inBase = false;
            continue;
        }

        // 3. Filtro comandi: Accetta solo G0 e G1
        if (!(line.startsWith("G0") || line.startsWith("G1"))) continue;

        // 4. Parsing Coordinate
        let parts = line.split(/\s+/); // Divide per spazi multipli
        let nx = x,
            ny = y,
            nz = z;
        let extrude = false;
        let foundCoord = false; // Flag per capire se è un movimento reale

        for (let i = 1; i < parts.length; i++) {
            const p = parts[i].toUpperCase(); // Normalizza maiuscole
            if (p.length < 2) continue; // Salta frammenti troppo corti

            const code = p[0];
            const valStr = p.slice(1);
            const val = parseFloat(valStr);

            if (isNaN(val)) continue; // PROTEZIONE NaN: Se non è un numero, ignora

            if (code === "X") {
                nx = val;
                foundCoord = true;
            } else if (code === "Y") {
                ny = val;
                foundCoord = true;
            } else if (code === "Z") {
                nz = val;
                foundCoord = true;
            } else if (code === "E" && val > 0) extrude = true;
        }

        // Se non ci sono coordinate valide o se non ci siamo mossi, salta
        if (!foundCoord && !extrude) continue;
        if (Math.abs(nx - x) < 0.001 && Math.abs(ny - y) < 0.001 && Math.abs(nz - z) < 0.001) continue;

        // 5. Aggiungi segmento sicuro
        segments.push({
            x1: x || 0, // Fallback a 0 se undefined
            y1: y || 0,
            z1: z || 0,
            x2: nx || 0,
            y2: ny || 0,
            z2: nz || 0,
            extrude: line.startsWith("G1") && extrude,
            isBase: inBase
        });

        // Aggiorna posizione attuale
        x = nx;
        y = ny;
        z = nz;
    }
    return segments;
}

function update3DPreviewFromGcode(gcode) {
    if (!window.THREE) return;
    init3DPreview();
    if (!threeScene) return;

    const segments = parseGcodeToSegments(gcode);
    if (!segments.length) return;

    // Pulizia della mesh precedente per evitare sovrapposizioni
    if (threeMesh) {
        threeScene.remove(threeMesh);
        threeMesh.geometry.dispose();
        threeMesh.material.dispose();
    }

    // Parametri del piatto di stampa (Anycubic Kobra 250x250)
    const bedSize = 250;
    const scale = 120 / bedSize;
    const cx = bedSize / 2;
    const cy = bedSize / 2;
    const cz = 0;

    const positions = new Float32Array(segments.length * 6);
    const colors = new Float32Array(segments.length * 6);

    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];

        // Coordinate posizioni
        positions[i * 6 + 0] = (s.x1 - cx) * scale;
        positions[i * 6 + 1] = (s.y1 - cy) * scale;
        positions[i * 6 + 2] = (s.z1 - cz) * scale;
        positions[i * 6 + 3] = (s.x2 - cx) * scale;
        positions[i * 6 + 4] = (s.y2 - cy) * scale;
        positions[i * 6 + 5] = (s.z2 - cz) * scale;

        // --- LOGICA COLORI ---
        let c;
        if (s.extrude) {
            // Se è estrusione: Base = Bianca [1,1,1], Disegno = Nero [0,0,0]
            c = s.isBase ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0];
        } else {
            // Movimenti a vuoto (Travel): Grigio scuro/Bluastro per non disturbare
            c = [0.3, 0.3, 0.4];
        }

        // Assegnazione colori ai due vertici del segmento
        colors[i * 6 + 0] = c[0];
        colors[i * 6 + 1] = c[1];
        colors[i * 6 + 2] = c[2];
        colors[i * 6 + 3] = c[0];
        colors[i * 6 + 4] = c[1];
        colors[i * 6 + 5] = c[2];
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Utilizziamo vertexColors: true per visualizzare i colori definiti sopra
    threeMesh = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
    threeScene.add(threeMesh);
}

// --- FUNZIONI DI SISTEMA ---
function downloadGcode() {
    if (!gcodeContent || gcodeContent.length < 10) {
        alert("Genera prima il G-code!");
        return;
    }
    const blob = new Blob([gcodeContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "art_gcode.gcode";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function mergeWithTemplate(artGcode) {
    if (!gcodeTemplateContent) {
        alert("Errore: Carica prima il file base.gcode!");
        return artGcode;
    }

    const lines = gcodeTemplateContent.split(/\r?\n/);
    let startIndex = -1;
    let endIndex = -1;

    // SCANSIONE: Cerca SOLO i nuovi marker definitivi
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toUpperCase();
        
        // Cerca start anche se ci sono altri caratteri nella riga
        if (line.includes(";START_ART")) {
            startIndex = i;
        }
        // Cerca end anche se ci sono altri caratteri nella riga
        if (line.includes(";END_ART")) {
            endIndex = i;
        }
    }

    // Se manca lo START, blocchiamo tutto
    if (startIndex === -1) {
        alert("ERRORE: Marker ;START_ART non trovato nel template.");
        return gcodeTemplateContent + "\n" + artGcode;
    }

    // HEADER: Tutto fino allo START compreso
    const header = lines.slice(0, startIndex + 1).join('\n');
    
    // FOOTER: Tutto dall'END compreso in poi (se esiste)
    let footer = "";
    if (endIndex !== -1 && endIndex > startIndex) {
        footer = lines.slice(endIndex).join('\n');
    } else {
        // Fallback solo se ti sei dimenticato di scrivere END_ART
        footer = lines.slice(startIndex + 1).join('\n');
    }

    // RECUPERO VARIABILI UI
    const mode = document.getElementById("filamentChangeMode")?.value || "manual";
    const amsBaseSlot = document.getElementById("amsBaseSlot")?.value || "T0";
    // const amsDrawingSlot = document.getElementById("amsDrawingSlot")?.value || "T1"; // Non serve qui

    // GENERAZIONE COMANDO CAMBIO
    let changeCommand = "";
    
    if (mode === "ams") {
        // --- FIX: In modalità AMS non aggiungiamo nulla qui ---
        // La funzione processImage() ha già inserito il comando corretto (T2 o T3)
        // come primissima riga di 'artGcode'.
        changeCommand = ""; 
    } else {
        // In manuale manteniamo la pausa M600 per permettere il cambio filo
        changeCommand = "\n; --- PAUSA MANUALE ---\nM600\n";
    }

    // COSTRUZIONE FINALE
    let finalGcode = header + 
                     changeCommand + 
                     "\n; --- START ARTWORK ---\n" + 
                     artGcode + 
                     "\n; --- END ARTWORK ---\n";

    return finalGcode + footer;
}

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    setupImageManipulationHandlers?.();

    document.getElementById("generateBtn")?.addEventListener("click", processImage);
    document.getElementById("downloadBtn")?.addEventListener("click", downloadGcode);

    // Eventi UI minori
    ["hilbertOrder", "gamma"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", (e) => {
            const display = document.getElementById(id === "hilbertOrder" ? "orderVal" : "gammaVal");
            if (display) display.innerText = e.target.value;
        });
    });

});
