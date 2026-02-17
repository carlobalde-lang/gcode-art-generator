"use strict";
// ==================== CONSTANTS ====================

const TWO_PI = 2 * Math.PI;
const PREVIEW_SCALE = 3;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEMPLATE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOOP_ITERATIONS = 100000;
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 10.0;
const ZOOM_FACTOR = 1.1;

// ==================== UTILITY FUNCTIONS ====================

// Inject UI animation styles once at load time
(function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
            to { opacity: 0; transform: translateX(400px); }
        }
        .error-toast.fade-out {
            animation: fadeOut 0.3s ease forwards;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
})();

/**
 * Safely parse float with validation
 */
function safeParseFloat(value, defaultValue, min = -Infinity, max = Infinity) {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || !isFinite(parsed)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(max, parsed));
}

/**
 * Safely parse integer with validation
 */
function safeParseInt(value, defaultValue, min = -Infinity, max = Infinity) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || !isFinite(parsed)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(max, parsed));
}

/**
 * Safely get element by ID
 */
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element not found: ${id}`);
    }
    return element;
}

/**
 * Debounce function for input handlers
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Show error toast notification
 */
function showErrorMessage(message) {
    const existingToast = document.querySelector(".error-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.className = "error-toast";
    toast.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
            z-index: 9999;
            max-width: 400px;
            animation: slideIn 0.3s ease;
            font-family: 'Segoe UI', sans-serif;
            font-size: 14px;
        ">
            <strong>⚠️ Error</strong><br>${message}
        </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("fade-out");
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

/**
 * Show loading spinner
 */
function showLoadingSpinner() {
    const existingSpinner = document.querySelector(".loading-spinner");
    if (existingSpinner) return;

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    spinner.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(4px);
        ">
            <div style="
                background: white;
                padding: 32px;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                text-align: center;
            ">
                <div style="
                    width: 48px;
                    height: 48px;
                    border: 4px solid #e5e7eb;
                    border-top-color: #2563eb;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 16px;
                "></div>
                <div style="color: #1e3a5f; font-weight: 600; font-family: 'Segoe UI', sans-serif;">
                    Generating G-code...
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(spinner);
}

/**
 * Hide loading spinner
 */
function hideLoadingSpinner() {
    const spinner = document.querySelector(".loading-spinner");
    if (spinner) spinner.remove();
}

// ==================== GLOBAL STATE ====================

const appState = {
    originalImage: null,
    originalImageRatio: 1.0,
    gcodeContent: "",
    gcodeTemplateContent: null,
    cachedPixels: null,
    cachedDimensions: null,
    imageOffsetX: 0.0,
    imageOffsetY: 0.0,
    imageZoom: 1.0,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    threeScene: null,
    threeCamera: null,
    threeRenderer: null,
    threeMesh: null,
    threeAnimating: false,
    threeOrbitRadius: 200,
    threeOrbitTheta: -Math.PI / 4,
    threeOrbitPhi: Math.PI / 4,
    threeOrbitDragging: false,
    threePanDragging: false,
    threeOrbitLastX: 0,
    threeOrbitLastY: 0,
    threeTarget: null
};

// Initialize Three.js vector if available
if (typeof THREE !== "undefined") {
    appState.threeTarget = new THREE.Vector3(0, 0, 0);
}

// ==================== DOM REFERENCES ====================

const imageInput = getElement("imageInput");
const hiddenCanvas = getElement("hiddenCanvas");
const previewCanvas = getElement("previewCanvas");
const printWidthInput = getElement("printWidth");
const printHeightInput = getElement("printHeight");

// Canvas contexts with null checks
let ctx = null;
let previewCtx = null;

if (hiddenCanvas) {
    ctx = hiddenCanvas.getContext("2d");
    if (!ctx) {
        console.error("Failed to get 2D context for hidden canvas");
    }
}

if (previewCanvas) {
    previewCtx = previewCanvas.getContext("2d");
    if (!previewCtx) {
        console.error("Failed to get 2D context for preview canvas");
    }
}

// ==================== MATHEMATICAL FUNCTIONS ====================

/**
 * Hilbert Curve algorithm
 */
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
            [x, y] = [y, x];
        }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
    }
    return { x: x, y: y };
}

// ==================== CLEANUP FUNCTIONS ====================

/**
 * Cleanup function to prevent memory leaks
 */
function cleanup() {
    if (appState.originalImage) {
        appState.originalImage.src = "";
        appState.originalImage = null;
    }

    appState.cachedPixels = null;
    appState.cachedDimensions = null;
}

// ==================== IMAGE HANDLING ====================

/**
 * Update print height from width (proportional)
 */
function updatePrintHeightFromWidth(newWidth) {
    if (appState.originalImage && printHeightInput) {
        printHeightInput.value = (newWidth / appState.originalImageRatio).toFixed(2);
    }
}

/**
 * Update print width from height (proportional)
 */
function updatePrintWidthFromHeight(newHeight) {
    if (appState.originalImage && printWidthInput) {
        printWidthInput.value = (newHeight * appState.originalImageRatio).toFixed(2);
    }
}

/**
 * Draw image slice preview on canvas
 */
function drawImageSlicePreview(bedWidth, bedHeight, originAtCenter, offsetX, offsetY, printWidth, printHeight) {
    if (!appState.originalImage || !previewCtx) return;

    // For display purposes, center-origin coords are shifted by half bed size
    const dispOX = originAtCenter ? bedWidth / 2 : 0;
    const dispOY = originAtCenter ? bedHeight / 2 : 0;

    try {
        previewCtx.setTransform(1, 0, 0, 1, 0, 0);
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        previewCtx.translate(0, previewCanvas.height);
        previewCtx.scale(PREVIEW_SCALE, -PREVIEW_SCALE);

        // Draw bed boundary
        previewCtx.strokeStyle = "#cbd5e1";
        previewCtx.lineWidth = 1;
        previewCtx.strokeRect(0, 0, bedWidth, bedHeight);

        const hideImageOverlay = getElement("hideImageOverlay");
        const hideImageOverlayChecked = hideImageOverlay ? hideImageOverlay.checked : false;

        if (hideImageOverlayChecked) {
            const sX_norm = appState.imageOffsetX;
            const sY_norm = appState.imageOffsetY;
            const sW_norm = 1.0 / appState.imageZoom;
            const sH_norm = 1.0 / appState.imageZoom;

            previewCtx.save();
            previewCtx.translate(offsetX + dispOX, offsetY + dispOY);
            previewCtx.scale(1, -1);
            previewCtx.translate(0, -printHeight);

            const mirrorImage = getElement("mirrorimage");
            const mirrorChecked = mirrorImage ? mirrorImage.checked : false;

            if (mirrorChecked) {
                previewCtx.translate(printWidth, 0);
                previewCtx.scale(-1, 1);
            }

            previewCtx.drawImage(
                appState.originalImage,
                appState.originalImage.width * sX_norm,
                appState.originalImage.height * sY_norm,
                appState.originalImage.width * sW_norm,
                appState.originalImage.height * sH_norm,
                0,
                0,
                printWidth,
                printHeight
            );

            previewCtx.restore();
        }

        previewCtx.strokeStyle = "#ef4444";
        previewCtx.lineWidth = 1;
        previewCtx.strokeRect(offsetX + dispOX, offsetY + dispOY, printWidth, printHeight);
    } catch (error) {
        console.error("Error drawing preview:", error);
    }
}

/**
 * Get brightness at UV coordinates with gamma correction
 */
function getBrightnessAtUV(u_print, v_print_yup, pixels, anaW, anaH, gammaVal) {
    const v_print_ydown = 1.0 - v_print_yup;

    let u_source = u_print / appState.imageZoom + appState.imageOffsetX;
    let v_source = v_print_ydown / appState.imageZoom + appState.imageOffsetY;

    u_source = Math.max(0, Math.min(1, u_source));
    v_source = Math.max(0, Math.min(1, v_source));

    // Bilinear interpolation
    const xf = u_source * (anaW - 1);
    const yf = v_source * (anaH - 1);
    const x0 = Math.floor(xf);
    const y0 = Math.floor(yf);
    const x1 = Math.min(x0 + 1, anaW - 1);
    const y1 = Math.min(y0 + 1, anaH - 1);
    const tx = xf - x0;
    const ty = yf - y0;

    function pixelBrightness(px, py) {
        const idx = (py * anaW + px) * 4;
        return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3.0;
    }

    const c00 = pixelBrightness(x0, y0);
    const c10 = pixelBrightness(x1, y0);
    const c01 = pixelBrightness(x0, y1);
    const c11 = pixelBrightness(x1, y1);

    const avgColor = c00 * (1 - tx) * (1 - ty) + c10 * tx * (1 - ty) + c01 * (1 - tx) * ty + c11 * tx * ty;

    let val = avgColor / 255.0;
    val = Math.pow(val, 1.0 / gammaVal);

    return 1.0 - val;
}

// ==================== IMAGE MANIPULATION HANDLERS ====================

/**
 * Setup pan and zoom handlers for preview canvas
 */
function setupImageManipulationHandlers() {
    if (!previewCanvas) return;

    const getPrintParams = () => {
        const bedWidth = safeParseFloat(getElement("bedWidth")?.value, 250, 50, 1000);
        const bedHeight = safeParseFloat(getElement("bedHeight")?.value, 250, 50, 1000);
        const originAtCenter = getElement("originAtCenter")?.checked ?? false;
        const printWidth = safeParseFloat(printWidthInput?.value, 100, 1, bedWidth);
        const printHeight = safeParseFloat(printHeightInput?.value, 100, 1, bedHeight);
        const offsetX = originAtCenter ? -printWidth / 2 : (bedWidth - printWidth) / 2;
        const offsetY = originAtCenter ? -printHeight / 2 : (bedHeight - printHeight) / 2;
        return { bedWidth, bedHeight, originAtCenter, printWidth, printHeight, offsetX, offsetY };
    };

    previewCanvas.addEventListener("mousedown", (e) => {
        if (!appState.originalImage) return;
        appState.isDragging = true;
        appState.lastMouseX = e.clientX;
        appState.lastMouseY = e.clientY;
        previewCanvas.style.cursor = "grabbing";
    });

    document.addEventListener("mouseup", () => {
        appState.isDragging = false;
        if (previewCanvas) {
            previewCanvas.style.cursor = "grab";
        }
    });

    previewCanvas.addEventListener("mousemove", (e) => {
        if (!appState.isDragging || !appState.originalImage) return;

        const { bedWidth, bedHeight, originAtCenter, printWidth, printHeight, offsetX, offsetY } = getPrintParams();

        const dx = e.clientX - appState.lastMouseX;
        const dy = e.clientY - appState.lastMouseY;
        appState.lastMouseX = e.clientX;
        appState.lastMouseY = e.clientY;

        const areaWidthOnScreen = printWidth * PREVIEW_SCALE;
        const areaHeightOnScreen = printHeight * PREVIEW_SCALE;

        const uvDeltaX = dx / areaWidthOnScreen;
        const uvDeltaY = dy / areaHeightOnScreen;

        appState.imageOffsetX -= uvDeltaX / appState.imageZoom;
        appState.imageOffsetY += uvDeltaY / appState.imageZoom;

        const maxOffset = 1 - 1 / appState.imageZoom;
        appState.imageOffsetX = Math.max(0, Math.min(maxOffset, appState.imageOffsetX));
        appState.imageOffsetY = Math.max(0, Math.min(maxOffset, appState.imageOffsetY));

        drawImageSlicePreview(bedWidth, bedHeight, originAtCenter, offsetX, offsetY, printWidth, printHeight);
    });

    previewCanvas.addEventListener(
        "wheel",
        (e) => {
            if (!appState.originalImage) return;
            e.preventDefault();

            const { bedWidth, bedHeight, originAtCenter, printWidth, printHeight, offsetX, offsetY } = getPrintParams();

            const rect = previewCanvas.getBoundingClientRect();
            const mouseX_mm = (e.clientX - rect.left) / PREVIEW_SCALE;
            const mouseY_mm = (previewCanvas.height - (e.clientY - rect.top)) / PREVIEW_SCALE;

            const u_print = (mouseX_mm - offsetX) / printWidth;
            const v_print = (mouseY_mm - offsetY) / printHeight;

            const u_clamped = Math.max(0, Math.min(1, u_print));
            const v_clamped = Math.max(0, Math.min(1, v_print));

            const v_print_ydown = 1.0 - v_clamped;

            const u_source_old = u_clamped / appState.imageZoom + appState.imageOffsetX;
            const v_source_old = v_print_ydown / appState.imageZoom + appState.imageOffsetY;

            const zoomDelta = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
            let newZoom = appState.imageZoom * zoomDelta;

            appState.imageZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));

            let newOffsetX = u_source_old - u_clamped / appState.imageZoom;
            let newOffsetY = v_source_old - v_print_ydown / appState.imageZoom;

            const maxOffset = 1 - 1 / appState.imageZoom;
            newOffsetX = Math.max(0, Math.min(maxOffset, newOffsetX));
            newOffsetY = Math.max(0, Math.min(maxOffset, newOffsetY));

            appState.imageOffsetX = newOffsetX;
            appState.imageOffsetY = newOffsetY;

            drawImageSlicePreview(bedWidth, bedHeight, originAtCenter, offsetX, offsetY, printWidth, printHeight);
        },
        { passive: false }
    );
}

// ==================== IMAGE INPUT HANDLER ====================

if (imageInput) {
    imageInput.addEventListener("change", function (e) {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file size
        if (file.size > MAX_IMAGE_SIZE) {
            showErrorMessage(`Image too large. Maximum size: ${(MAX_IMAGE_SIZE / 1024 / 1024).toFixed(0)}MB`);
            e.target.value = "";
            return;
        }

        // Validate file type
        if (!file.type.startsWith("image/")) {
            showErrorMessage("Please select a valid image file");
            e.target.value = "";
            return;
        }

        const reader = new FileReader();

        reader.onload = function (event) {
            // Cleanup old image
            cleanup();

            appState.originalImage = new Image();

            appState.originalImage.onload = function () {
                try {
                    appState.originalImageRatio = appState.originalImage.width / appState.originalImage.height;

                    const imageRatioInfo = getElement("imageRatioInfo");
                    if (imageRatioInfo) {
                        imageRatioInfo.innerText = `Image Ratio: ${appState.originalImage.width}×${appState.originalImage.height}px (Ratio: ${appState.originalImageRatio.toFixed(2)}:1)`;
                    }

                    if (printWidthInput) {
                        updatePrintHeightFromWidth(safeParseFloat(printWidthInput.value, 180));
                    }

                    // Reset zoom and offset
                    appState.imageZoom = 1.0;
                    appState.imageOffsetX = 0.0;
                    appState.imageOffsetY = 0.0;

                    // Update preview
                    const bedWidth = safeParseFloat(getElement("bedWidth")?.value, 250, 50, 1000);
                    const bedHeight = safeParseFloat(getElement("bedHeight")?.value, 250, 50, 1000);
                    const originAtCenter = getElement("originAtCenter")?.checked ?? false;

                    if (previewCanvas) {
                        previewCanvas.width = bedWidth * PREVIEW_SCALE;
                        previewCanvas.height = bedHeight * PREVIEW_SCALE;

                        const printWidth = safeParseFloat(printWidthInput?.value, 100);
                        const printHeight = safeParseFloat(printHeightInput?.value, 100);
                        const offsetX = originAtCenter ? -printWidth / 2 : (bedWidth - printWidth) / 2;
                        const offsetY = originAtCenter ? -printHeight / 2 : (bedHeight - printHeight) / 2;
                        drawImageSlicePreview(bedWidth, bedHeight, originAtCenter, offsetX, offsetY, printWidth, printHeight);
                    }
                } catch (error) {
                    console.error("Error processing image:", error);
                    showErrorMessage("Error loading image. Please try another file.");
                }
            };

            appState.originalImage.onerror = function () {
                console.error("Image loading error");
                showErrorMessage("Failed to load image. The file may be corrupted.");
                e.target.value = "";
            };

            appState.originalImage.src = event.target.result;
        };

        reader.onerror = function (error) {
            console.error("File reading error:", error);
            showErrorMessage("Failed to read image file. Please try again.");
            e.target.value = "";
        };

        reader.readAsDataURL(file);
    });
}

// ==================== INPUT EVENT HANDLERS ====================

// Debounced dimension updates
if (printWidthInput) {
    printWidthInput.addEventListener(
        "input",
        debounce(() => {
            updatePrintHeightFromWidth(safeParseFloat(printWidthInput.value, 100));
        }, 300)
    );
}

if (printHeightInput) {
    printHeightInput.addEventListener(
        "input",
        debounce(() => {
            updatePrintWidthFromHeight(safeParseFloat(printHeightInput.value, 100));
        }, 300)
    );
}

// Base speed slider
const baseSpeedSlider = getElement("baseSpeed");
const baseSpeedVal = getElement("baseSpeedVal");

if (baseSpeedSlider && baseSpeedVal) {
    baseSpeedSlider.addEventListener("input", (e) => {
        baseSpeedVal.innerText = e.target.value;
    });
}

// Filament change mode
const filamentChangeMode = getElement("filamentChangeMode");
if (filamentChangeMode) {
    filamentChangeMode.addEventListener("change", function (e) {
        const amsContainer = getElement("amsSlotContainer");
        if (amsContainer) {
            if (e.target.value === "ams") {
                amsContainer.classList.remove("hidden");
            } else {
                amsContainer.classList.add("hidden");
            }
        }
    });
}

// G-code template upload
const gcodeTemplate = getElement("gcodeTemplate");
if (gcodeTemplate) {
    gcodeTemplate.addEventListener("change", function (e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > MAX_TEMPLATE_SIZE) {
            showErrorMessage(
                `Template file too large. Maximum size: ${(MAX_TEMPLATE_SIZE / 1024 / 1024).toFixed(0)}MB`
            );
            e.target.value = "";
            return;
        }

        const reader = new FileReader();

        reader.onload = function (event) {
            appState.gcodeTemplateContent = event.target.result;
            console.log("G-code template loaded successfully");
        };

        reader.onerror = function (error) {
            console.error("File reading error:", error);
            showErrorMessage("Failed to load template file. Please try again.");
            e.target.value = "";
        };

        reader.readAsText(file);
    });
}

// ==================== BASE GENERATION FUNCTIONS ====================

/**
 * Generate circular base (for spiral path)
 */
function generateCircularBase(params) {
    const { gcode, baseLayers, zOffset, layerHeight, baseRadius, baseMargin, centerX, centerY, baseSpeed, filArea } =
        params;

    const baseOverlap = 0.45;
    const wallSpacing = 0.42;
    const numWalls = 3;
    const BASE_LINE_WIDTH = 0.5;

    let prevX = params.prevX;
    let prevY = params.prevY;

    function writeBaseSegment(x, y, customSpeed = baseSpeed) {
        const dist = Math.hypot(x - prevX, y - prevY);
        if (dist < 0.01) return;
        const vol = dist * BASE_LINE_WIDTH * layerHeight;
        const e = vol / filArea;
        gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${customSpeed.toFixed(0)}`);
        params.totalE += e;
        prevX = x;
        prevY = y;
    }

    gcode.push(`; --- Circular Base (Adaptive) ---`);

    for (let layer = 0; layer < baseLayers; layer++) {
        const z = zOffset + layer * layerHeight;
        gcode.push(`G1 Z${z.toFixed(3)} F1000 ; Base layer ${layer + 1}/${baseLayers}`);

        // Circular walls
        for (let w = 0; w < numWalls; w++) {
            const currentWallRadius = baseRadius - w * wallSpacing;
            const numPoints = Math.max(60, Math.ceil((TWO_PI * currentWallRadius) / 0.5));
            const dAngle = TWO_PI / numPoints;
            const startX = centerX + currentWallRadius;
            const startY = centerY;

            gcode.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} F6000`);
            prevX = startX;
            prevY = startY;

            for (let i = 1; i <= numPoints; i++) {
                const angle = i * dAngle;
                const x = centerX + currentWallRadius * Math.cos(angle);
                const y = centerY + currentWallRadius * Math.sin(angle);
                writeBaseSegment(x, y);
            }
        }

        gcode.push(`G1 E-0.8 F3000`);
        gcode.push(`G0 Z${(z + 0.4).toFixed(3)} F6000`);

        // Circular infill
        let goingRight = true;
        const fillLimitRadius = baseRadius - numWalls * wallSpacing;
        const infillTotalHeight = fillLimitRadius * 2;

        // Move to fill start, lower Z and recover retract once
        const firstY = centerY - fillLimitRadius;
        const firstXLimit = 0; // at the very edge xLimit ≈ 0
        gcode.push(`G0 X${(centerX).toFixed(3)} Y${firstY.toFixed(3)} F6000`);
        gcode.push(`G1 Z${z.toFixed(3)} F1000`);
        gcode.push(`G1 E0.9 F3000`);
        prevX = centerX;
        prevY = firstY;

        for (let yRel = -fillLimitRadius; yRel <= fillLimitRadius; yRel += baseOverlap) {
            const xLimit = Math.sqrt(Math.max(0, Math.pow(fillLimitRadius, 2) - Math.pow(yRel, 2)));
            const xLeft = centerX - xLimit;
            const xRight = centerX + xLimit;
            const currentY = centerY + yRel;

            let currentSpeed = baseSpeed;
            if (yRel < -fillLimitRadius + infillTotalHeight * 0.1) {
                currentSpeed = baseSpeed * 0.5;
            }

            if (goingRight) {
                writeBaseSegment(xLeft, currentY, currentSpeed);
                writeBaseSegment(xRight, currentY, currentSpeed);
            } else {
                writeBaseSegment(xRight, currentY, currentSpeed);
                writeBaseSegment(xLeft, currentY, currentSpeed);
            }
            goingRight = !goingRight;
        }
        gcode.push(`G0 Z${(z + 0.5).toFixed(3)} F6000`);
    }

    params.prevX = prevX;
    params.prevY = prevY;

    return baseMargin;
}

/**
 * Generate square base (for square spiral and hilbert)
 */
function generateSquareBase(params) {
    const { gcode, baseLayers, zOffset, layerHeight, printDim, baseMargin, centerOffset, baseSpeed, filArea } = params;

    const baseOverlap = 0.45;
    const wallSpacing = 0.42;
    const numWalls = 3;
    const BASE_LINE_WIDTH = 0.5;

    let prevX = params.prevX;
    let prevY = params.prevY;

    function writeBaseSegment(x, y, customSpeed = baseSpeed) {
        const dist = Math.hypot(x - prevX, y - prevY);
        if (dist < 0.01) return;
        const vol = dist * BASE_LINE_WIDTH * layerHeight;
        const e = vol / filArea;
        gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${customSpeed.toFixed(0)}`);
        params.totalE += e;
        prevX = x;
        prevY = y;
    }

    gcode.push(`; --- Square Base (Adaptive) ---`);

    for (let layer = 0; layer < baseLayers; layer++) {
        const z = zOffset + layer * layerHeight;
        gcode.push(`G1 Z${z.toFixed(3)} F1000 ; Base layer ${layer + 1}/${baseLayers}`);

        // Square walls
        for (let w = 0; w < numWalls; w++) {
            const inset = w * wallSpacing;
            const x0 = centerOffset.x + inset;
            const y0 = centerOffset.y + inset;
            const x1 = centerOffset.x + printDim - inset;
            const y1 = centerOffset.y + printDim - inset;

            // Move to start
            gcode.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)} F6000`);
            prevX = x0;
            prevY = y0;

            // Bottom edge (left to right)
            const bottomSegs = Math.max(2, Math.floor((x1 - x0) / 0.5));
            for (let i = 1; i <= bottomSegs; i++) {
                const x = x0 + (x1 - x0) * (i / bottomSegs);
                writeBaseSegment(x, y0);
            }

            // Right edge (bottom to top)
            const rightSegs = Math.max(2, Math.floor((y1 - y0) / 0.5));
            for (let i = 1; i <= rightSegs; i++) {
                const y = y0 + (y1 - y0) * (i / rightSegs);
                writeBaseSegment(x1, y);
            }

            // Top edge (right to left)
            for (let i = 1; i <= bottomSegs; i++) {
                const x = x1 - (x1 - x0) * (i / bottomSegs);
                writeBaseSegment(x, y1);
            }

            // Left edge (top to bottom, except last point to avoid overlap)
            for (let i = 1; i < rightSegs; i++) {
                const y = y1 - (y1 - y0) * (i / rightSegs);
                writeBaseSegment(x0, y);
            }
        }

        // Retract and lift before infill
        gcode.push(`G1 E-0.8 F3000`);
        gcode.push(`G0 Z${(z + 0.4).toFixed(3)} F6000`);

        // Rectangular infill
        const innerMargin = numWalls * wallSpacing;
        const fillX0 = centerOffset.x + innerMargin;
        const fillY0 = centerOffset.y + innerMargin;
        const fillX1 = centerOffset.x + printDim - innerMargin;
        const fillY1 = centerOffset.y + printDim - innerMargin;
        const fillHeight = fillY1 - fillY0;

        // Move to fill start, lower Z and recover retract once
        gcode.push(`G0 X${fillX0.toFixed(3)} Y${fillY0.toFixed(3)} F6000`);
        gcode.push(`G1 Z${z.toFixed(3)} F1000`);
        gcode.push(`G1 E0.9 F3000`);
        prevX = fillX0;
        prevY = fillY0;

        let goingRight = true;

        for (let yRel = fillY0; yRel <= fillY1; yRel += baseOverlap) {
            let currentSpeed = baseSpeed;
            if (yRel - fillY0 < fillHeight * 0.1) {
                currentSpeed = baseSpeed * 0.5;
            }

            if (goingRight) {
                writeBaseSegment(fillX0, yRel, currentSpeed);
                writeBaseSegment(fillX1, yRel, currentSpeed);
            } else {
                writeBaseSegment(fillX1, yRel, currentSpeed);
                writeBaseSegment(fillX0, yRel, currentSpeed);
            }
            goingRight = !goingRight; // FIX: era fuori dal for a causa di parentesi errate
        }

        gcode.push(`G0 Z${(z + 0.5).toFixed(3)} F6000`);
    }

    params.prevX = prevX;
    params.prevY = prevY;

    return baseMargin + numWalls * wallSpacing;
}

/**
 * Generate rectangular base (for zigzag and diagonal)
 */
function generateRectangularBase(params) {
    const {
        gcode,
        baseLayers,
        zOffset,
        layerHeight,
        printWidth,
        printHeight,
        baseMargin,
        offsetX,
        offsetY,
        baseSpeed,
        filArea
    } = params;

    const baseOverlap = 0.45;
    const wallSpacing = 0.42;
    const numWalls = 3;
    const BASE_LINE_WIDTH = 0.5;

    let prevX = params.prevX;
    let prevY = params.prevY;

    function writeBaseSegment(x, y, customSpeed = baseSpeed) {
        const dist = Math.hypot(x - prevX, y - prevY);
        if (dist < 0.01) return;
        const vol = dist * BASE_LINE_WIDTH * layerHeight;
        const e = vol / filArea;
        gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${customSpeed.toFixed(0)}`);
        params.totalE += e;
        prevX = x;
        prevY = y;
    }

    gcode.push(`; --- Rectangular Base (Adaptive) ---`);

    for (let layer = 0; layer < baseLayers; layer++) {
        const z = zOffset + layer * layerHeight;
        gcode.push(`G1 Z${z.toFixed(3)} F1000 ; Base layer ${layer + 1}/${baseLayers}`);

        // Rectangular walls
        for (let w = 0; w < numWalls; w++) {
            const inset = w * wallSpacing;
            const x0 = offsetX + inset;
            const y0 = offsetY + inset;
            const x1 = offsetX + printWidth - inset;
            const y1 = offsetY + printHeight - inset;

            // Move to start
            gcode.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)} F6000`);
            prevX = x0;
            prevY = y0;

            // Bottom edge
            const bottomSegs = Math.max(2, Math.floor((x1 - x0) / 0.5));
            for (let i = 1; i <= bottomSegs; i++) {
                const x = x0 + (x1 - x0) * (i / bottomSegs);
                writeBaseSegment(x, y0);
            }

            // Right edge
            const rightSegs = Math.max(2, Math.floor((y1 - y0) / 0.5));
            for (let i = 1; i <= rightSegs; i++) {
                const y = y0 + (y1 - y0) * (i / rightSegs);
                writeBaseSegment(x1, y);
            }

            // Top edge
            for (let i = 1; i <= bottomSegs; i++) {
                const x = x1 - (x1 - x0) * (i / bottomSegs);
                writeBaseSegment(x, y1);
            }

            // Left edge
            for (let i = 1; i < rightSegs; i++) {
                const y = y1 - (y1 - y0) * (i / rightSegs);
                writeBaseSegment(x0, y);
            }
        }

        gcode.push(`G1 E-0.8 F3000`);
        gcode.push(`G0 Z${(z + 0.4).toFixed(3)} F6000`);

        // Rectangular infill
        const innerMargin = numWalls * wallSpacing;
        const fillX0 = offsetX + innerMargin;
        const fillY0 = offsetY + innerMargin;
        const fillX1 = offsetX + printWidth - innerMargin;
        const fillY1 = offsetY + printHeight - innerMargin;
        const fillHeight = fillY1 - fillY0;

        // Move to fill start, lower Z and recover retract once
        gcode.push(`G0 X${fillX0.toFixed(3)} Y${fillY0.toFixed(3)} F6000`);
        gcode.push(`G1 Z${z.toFixed(3)} F1000`);
        gcode.push(`G1 E0.9 F3000`);
        prevX = fillX0;
        prevY = fillY0;

        let goingRight = true;

        for (let yRel = fillY0; yRel <= fillY1; yRel += baseOverlap) {
            let currentSpeed = baseSpeed;
            if (yRel - fillY0 < fillHeight * 0.1) {
                currentSpeed = baseSpeed * 0.5;
            }

            if (goingRight) {
                writeBaseSegment(fillX0, yRel, currentSpeed);
                writeBaseSegment(fillX1, yRel, currentSpeed);
            } else {
                writeBaseSegment(fillX1, yRel, currentSpeed);
                writeBaseSegment(fillX0, yRel, currentSpeed);
            }
            goingRight = !goingRight;
        }
        gcode.push(`G0 Z${(z + 0.5).toFixed(3)} F6000`);
    }

    params.prevX = prevX;
    params.prevY = prevY;

    return baseMargin + numWalls * wallSpacing;
}

// ==================== MAIN PROCESS FUNCTION ====================

/**
 * Main image processing function with all improvements
 */
function processImage() {
    // Validation
    if (!appState.originalImage) {
        showErrorMessage("Please upload an image first!");
        return;
    }

    if (!ctx || !previewCtx) {
        showErrorMessage("Canvas context not available");
        return;
    }

    const generateBtn = getElement("generateBtn");
    const downloadBtn = getElement("downloadBtn");

    // Disable UI during processing
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = "⏳ Processing...";
    }
    if (downloadBtn) {
        downloadBtn.style.display = "none";
    }

    showLoadingSpinner();

    // Use setTimeout to allow UI update
    setTimeout(() => {
        try {
            processImageCore();
        } catch (error) {
            console.error("Processing error:", error);
            showErrorMessage("An error occurred during processing: " + error.message);
        } finally {
            hideLoadingSpinner();
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = "🚀 Generate Preview";
            }
        }
    }, 50);
}

/**
 * Core processing logic (separated for cleaner error handling)
 */
function processImageCore() {
    // Get and validate all parameters
    const pathTypeElem = getElement("pathType");
    const pathType = pathTypeElem ? pathTypeElem.value : "spiral";

    const filamentDia = safeParseFloat(getElement("filamentDia")?.value, 1.75, 0.1, 5);
    const layerHeight = safeParseFloat(getElement("layerHeight")?.value, 0.2, 0.05, 1);
    const zOffset = safeParseFloat(getElement("zOffset")?.value, 0.2, 0, 50);
    const bedWidth = safeParseFloat(getElement("bedWidth")?.value, 250, 50, 1000);
    const bedHeight = safeParseFloat(getElement("bedHeight")?.value, 250, 50, 1000);
    const originAtCenter = getElement("originAtCenter")?.checked ?? false;

    const printWidth = safeParseFloat(printWidthInput?.value, 100, 1, bedWidth);
    const printHeight = safeParseFloat(printHeightInput?.value, 100, 1, bedHeight);

    const spacing = safeParseFloat(getElement("lineSpacing")?.value, 0.6, 0.1, 10);
    if (spacing <= 0) {
        showErrorMessage("Line spacing must be greater than 0");
        return;
    }

    const minW = safeParseFloat(getElement("minLineWidth")?.value, 0.2, 0.05, 2);
    const maxW = safeParseFloat(getElement("maxLineWidth")?.value, 0.8, 0.05, 3);

    if (minW >= maxW) {
        showErrorMessage("Min line width must be less than max line width");
        return;
    }

    const mirrorImageElem = getElement("mirrorimage");
    const mirrorimage = mirrorImageElem ? mirrorImageElem.checked : false;

    const minSpeedMMS = safeParseFloat(getElement("minSpeed")?.value, 10, 1, 200);
    const maxSpeedMMS = safeParseFloat(getElement("maxSpeed")?.value, 100, 1, 300);

    if (minSpeedMMS >= maxSpeedMMS) {
        showErrorMessage("Min speed must be less than max speed");
        return;
    }

    const minSpeed = minSpeedMMS * 60;
    const maxSpeed = maxSpeedMMS * 60;
    const gammaVal = safeParseFloat(getElement("gamma")?.value, 1.5, 0.5, 3);
    const squiggleAmp = safeParseFloat(getElement("squiggleAmp")?.value, 0, 0, 5);
    const squiggleFreq = safeParseFloat(getElement("squiggleFreq")?.value, 1, 0.1, 20);
    const useSquiggle = squiggleAmp > 0.01;
    const fractalOrder = safeParseInt(getElement("hilbertOrder")?.value, 6, 3, 8);

    const addCircularBaseElem = getElement("addCircularBase");
    const addCircularBase = addCircularBaseElem ? addCircularBaseElem.checked : false;
    const baseMargin = safeParseFloat(getElement("baseMargin")?.value, 2, 0, 100);
    const baseLayers = safeParseInt(getElement("baseLayers")?.value, 2, 1, 20);

    const textModeElem = getElement("textMode");
    const textMode = textModeElem ? textModeElem.checked : false;
    const textThreshold = safeParseFloat(getElement("textThreshold")?.value, 0.4, 0.05, 0.95);

    const anaW = appState.originalImage.width;
    const anaH = appState.originalImage.height;

    // Get or cache pixel data
    let pixels;
    if (
        appState.cachedPixels &&
        appState.cachedDimensions?.width === anaW &&
        appState.cachedDimensions?.height === anaH
    ) {
        pixels = appState.cachedPixels;
    } else {
        hiddenCanvas.width = anaW;
        hiddenCanvas.height = anaH;
        ctx.drawImage(appState.originalImage, 0, 0, anaW, anaH);
        pixels = ctx.getImageData(0, 0, anaW, anaH).data;

        // Cache for future use
        appState.cachedPixels = pixels;
        appState.cachedDimensions = { width: anaW, height: anaH };
    }

    // Compute offsets: center origin uses negative half-dimensions, corner uses centered on bed
    const offsetX = originAtCenter ? -printWidth / 2  : (bedWidth  - printWidth)  / 2;
    const offsetY = originAtCenter ? -printHeight / 2 : (bedHeight - printHeight) / 2;
    const filArea = Math.PI * Math.pow(filamentDia / 2, 2);
    const safeZ = zOffset + 5.0;
    let totalE = 0;

    const printDim = Math.min(printWidth, printHeight);
    const baseRadius = printDim / 2;
    const centerX = offsetX + printWidth / 2;
    const centerY = offsetY + printHeight / 2;
    // innerRadius is updated after base generation; default 0 means no clipping when base is disabled
    let innerRadius = 0;

    previewCanvas.width = bedWidth * PREVIEW_SCALE;
    previewCanvas.height = bedHeight * PREVIEW_SCALE;
    drawImageSlicePreview(bedWidth, bedHeight, originAtCenter, offsetX, offsetY, printWidth, printHeight);

    // Draw base preview if enabled
    if (addCircularBase) {
        // Display offset: center-origin coords need shifting for canvas display
        const dispOX = originAtCenter ? bedWidth / 2 : 0;
        const dispOY = originAtCenter ? bedHeight / 2 : 0;

        previewCtx.strokeStyle = "rgba(100,100,100,0.5)";
        previewCtx.lineWidth = 1 / PREVIEW_SCALE;
        previewCtx.setLineDash([4, 4]);

        if (pathType === "spiral") {
            // Circular preview
            previewCtx.beginPath();
            previewCtx.arc(centerX + dispOX, centerY + dispOY, baseRadius, 0, TWO_PI);
            previewCtx.stroke();
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            previewCtx.beginPath();
            previewCtx.arc(centerX + dispOX, centerY + dispOY, innerRadius, 0, TWO_PI);
            previewCtx.stroke();
        } else if (pathType === "squareSpiral" || pathType === "hilbert") {
            // Square preview
            const centerOffset = {
                x: centerX - printDim / 2 + dispOX,
                y: centerY - printDim / 2 + dispOY
            };
            previewCtx.strokeRect(centerOffset.x, centerOffset.y, printDim, printDim);
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            const ins = Math.min(baseMargin, printDim / 2);
            previewCtx.strokeRect(centerOffset.x + ins, centerOffset.y + ins, printDim - 2 * ins, printDim - 2 * ins);
        } else {
            // Rectangular preview (for zigzag, diagonal)
            previewCtx.strokeRect(offsetX + dispOX, offsetY + dispOY, printWidth, printHeight);
            previewCtx.strokeStyle = "rgba(37, 99, 235, 0.8)";
            previewCtx.setLineDash([2, 2]);
            const ins = Math.min(baseMargin, printWidth / 2, printHeight / 2);
            previewCtx.strokeRect(offsetX + dispOX + ins, offsetY + dispOY + ins, printWidth - 2 * ins, printHeight - 2 * ins);
        }
        previewCtx.setLineDash([]);
    }

    // Start G-code generation
    let gcode = [];
    gcode.push(`; --- G-Code Art Generator (Improved) ---`);
    gcode.push(`G90 ; Absolute Coordinates (XYZE)`);
    gcode.push(`M83 ; Relative Extrusion`);

    let startPoint = { x: offsetX, y: offsetY };
    const centerOffset = {
        x: offsetX + (printWidth - printDim) / 2,
        y: offsetY + (printHeight - printDim) / 2
    };

    if (["spiral", "squareSpiral"].includes(pathType)) {
        startPoint = { x: centerX, y: centerY };
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
    const baseSpeedMMS = safeParseFloat(getElement("baseSpeed")?.value, 30, 10, 150);
    const baseSpeed = baseSpeedMMS * 60;

    let drawingStartZ = zOffset;

    function writeBaseSegment(x, y, customSpeed = baseSpeed) {
        const dist = Math.hypot(x - prevX, y - prevY);
        if (dist < 0.01) return;
        const vol = dist * BASE_LINE_WIDTH * layerHeight;
        const e = vol / filArea;
        gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${customSpeed.toFixed(0)}`);
        totalE += e;
        prevX = x;
        prevY = y;
    }

    const changeMode = getElement("filamentChangeMode")?.value || "manual";
    const amsBaseSlot = getElement("amsBaseSlot")?.value || "T0";
    const amsDrawingSlot = getElement("amsDrawingSlot")?.value || "T1";

    // Generate base layer if enabled
    if (addCircularBase) {
        if (changeMode === "ams") {
            gcode.push(`${amsBaseSlot} ; Select Base Filament Slot`);
            gcode.push(`M400 ; Wait for load`);
        }

        gcode.push(`G0 Z${safeZ.toFixed(3)} F6000`);

        // Prepare parameters for base generation
        const baseParams = {
            gcode,
            baseLayers,
            zOffset,
            layerHeight,
            baseRadius,
            printDim,
            printWidth,
            printHeight,
            baseMargin,
            centerX,
            centerY,
            centerOffset,
            offsetX,
            offsetY,
            baseSpeed,
            filArea,
            prevX,
            prevY,
            totalE
        };

        // ADAPTIVE BASE GENERATION - Choose shape based on path type
        let innerMargin;
        if (pathType === "spiral") {
            innerMargin = generateCircularBase(baseParams);
        } else if (pathType === "squareSpiral" || pathType === "hilbert") {
            innerMargin = generateSquareBase(baseParams);
        } else {
            // zigzag, diagonal
            innerMargin = generateRectangularBase(baseParams);
        }

        // Update variables from params
        prevX = baseParams.prevX;
        prevY = baseParams.prevY;
        totalE = baseParams.totalE;

        // Transition to artwork
        gcode.push(`; --- TRANSITION TO ARTWORK ---`);

        if (changeMode === "ams") {
            gcode.push(`M400`);
            gcode.push(`G91`);
            gcode.push(`G1 Z5 F3000`);
            gcode.push(`G90`);
            gcode.push(`${amsDrawingSlot}`);
            gcode.push(`M400`);
        } else {
            // Park at bed center — safe regardless of origin position or bed size
            const parkX = originAtCenter ? 0 : bedWidth / 2;
            const parkY = originAtCenter ? 0 : bedHeight / 2;
            gcode.push(`G91`);
            gcode.push(`G1 E-5 F3000`);
            gcode.push(`G1 Z10 F1000`);
            gcode.push(`G90`);
            gcode.push(`G0 X${parkX.toFixed(3)} Y${parkY.toFixed(3)} F6000 ; Park at bed center for filament change`);
            gcode.push(`M600`);
        }

        drawingStartZ = zOffset + baseLayers * layerHeight;
        gcode.push(`; --- STARTING ARTWORK DRAWING ---`);
        gcode.push(
            `G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} Z${(drawingStartZ + 2).toFixed(3)} F6000`
        );
        gcode.push(`G1 Z${drawingStartZ.toFixed(3)} F1000`);
        gcode.push(`G1 E0.5 F600`);
        gcode.push(`G4 P200`);

        prevX = startPoint.x;
        prevY = startPoint.y;
        gcode.push(`G92 E0`);

        // Update innerRadius for clip function based on shape
        innerRadius = innerMargin;
    } else {
        if (changeMode === "ams") {
            gcode.push(`${amsDrawingSlot}`);
        }
        gcode.push(`G0 Z${safeZ.toFixed(3)} F3000`);
        gcode.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} F6000`);
        gcode.push(`G1 Z${zOffset.toFixed(3)} F1000`);
        prevX = startPoint.x;
        prevY = startPoint.y;
    }

    // Display offset: for center-origin printers, shift canvas drawing by half bed size
    const dispOX = originAtCenter ? bedWidth / 2 : 0;
    const dispOY = originAtCenter ? bedHeight / 2 : 0;

    function writeMove(x, y, targetW, targetF, isTravel = false) {
        const dist = Math.hypot(x - prevX, y - prevY);

        if (isTravel || dist < 0.01) {
            gcode.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F6000`);
            previewCtx.beginPath();
            previewCtx.moveTo(prevX + dispOX, prevY + dispOY);
            previewCtx.lineTo(x + dispOX, y + dispOY);
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
            previewCtx.moveTo(prevX + dispOX, prevY + dispOY);
            previewCtx.lineTo(x + dispOX, y + dispOY);
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
            // For circular base, use radius-based check
            return Math.hypot(x - centerX, y - centerY) <= baseRadius - innerRadius;
        }
        if (pathType === "squareSpiral" || pathType === "hilbert") {
            // For square base, use square bounds check
            const ins = innerRadius;
            return (
                x >= centerOffset.x + ins &&
                x <= centerOffset.x + printDim - ins &&
                y >= centerOffset.y + ins &&
                y <= centerOffset.y + printDim - ins
            );
        }
        // For rectangular base (zigzag, diagonal), use rectangular bounds check
        const ins = innerRadius;
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

        // Text mode: binary threshold — either full width or skip (no travel artifacts on white)
        if (textMode && !isConnect) {
            if (darkness < textThreshold) {
                // Light pixel: lift and travel, no extrusion
                writeMove(x, y, 0, 0, true);
            } else {
                // Dark pixel: print at full width, slow speed for sharpness
                writeMove(x, y, maxW, minSpeed, false);
            }
            return;
        }

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

    // Generate path based on type
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

        let iterations = 0;
        while (currentSize > spacing * 1.5 && iterations < MAX_LOOP_ITERATIONS) {
            iterations++;

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

        if (iterations >= MAX_LOOP_ITERATIONS) {
            console.warn("Square spiral hit max iterations");
        }

        if (currentSize > 0) {
            doSmartMove(currentOffset.x + currentSize / 2, currentOffset.y + currentSize / 2);
        }
    } else if (pathType === "diagonal") {
        // Continuous diagonal zigzag — no G0 travel between lines, reverses direction at each edge.
        // Much better for text: no retract blobs on white areas, smoother transitions.
        const axisStep = spacing * Math.sqrt(2);
        const maxSum = printWidth + printHeight;
        const numDiagonals = Math.floor(maxSum / axisStep);
        const segRes = 0.5; // mm per sub-segment

        for (let i = 0; i <= numDiagonals; i++) {
            const sum = i * axisStep;

            // Compute the two endpoints of this diagonal on the rectangle boundary
            let p1x = sum <= printHeight ? 0 : sum - printHeight;
            let p1y = sum <= printHeight ? sum : printHeight;
            let p2x = sum <= printWidth  ? sum : printWidth;
            let p2y = sum <= printWidth  ? 0   : sum - printWidth;

            // Clamp to rect
            p1x = Math.max(0, Math.min(printWidth,  p1x));
            p1y = Math.max(0, Math.min(printHeight, p1y));
            p2x = Math.max(0, Math.min(printWidth,  p2x));
            p2y = Math.max(0, Math.min(printHeight, p2y));

            // Alternate direction each line
            let startX, startY, endX, endY;
            if (i % 2 === 0) {
                startX = p1x; startY = p1y; endX = p2x; endY = p2y;
            } else {
                startX = p2x; startY = p2y; endX = p1x; endY = p1y;
            }

            const distLine = Math.hypot(endX - startX, endY - startY);
            if (distLine < 0.01) continue;

            // On the very first line, do a travel to start position
            if (i === 0) {
                doSmartMove(offsetX + startX, offsetY + startY, true);
            }
            // For subsequent lines: connect end of previous line to start of this line.
            // This is a short diagonal step (~axisStep mm) — use doSmartMove so it also
            // samples brightness (continuous path, no retract blobs).
            else {
                doSmartMove(offsetX + startX, offsetY + startY);
            }

            // Draw the diagonal line with sub-segments for brightness sampling
            const numSegs = Math.max(2, Math.floor(distLine / segRes));
            for (let k = 1; k <= numSegs; k++) {
                const t = k / numSegs;
                doSmartMove(offsetX + startX + (endX - startX) * t, offsetY + startY + (endY - startY) * t);
            }
        }
    } else if (pathType === "spiral") {
        let cx = offsetX + printWidth / 2;
        let cy = offsetY + printHeight / 2;
        let radius = 0.0;
        let angle = 0;
        const maxRadius = addCircularBase ? baseRadius - innerRadius : printDim / 2;

        let iterations = 0;
        while (radius < maxRadius && iterations < MAX_LOOP_ITERATIONS) {
            iterations++;

            let res = 0.5;
            let dTheta = res / Math.max(0.5, radius);
            angle += dTheta;
            radius = (spacing / TWO_PI) * angle;

            if (radius > maxRadius) break;

            let px = cx + radius * Math.cos(angle);
            let py = cy + radius * Math.sin(angle);
            doSmartMove(px, py);
        }

        if (iterations >= MAX_LOOP_ITERATIONS) {
            console.warn("Spiral hit max iterations");
        }
    } else {
        // Zigzag (default)
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

    gcode.push(`G0 Z${safeZ.toFixed(3)} F3000`);
    gcode.push(`; Total Extruded: E${totalE.toFixed(2)}`);
    gcode.push(`; --- End of Central G-Code Block ---`);

    const artOnlyGcode = gcode.join("\n");
    const finalGcode = mergeWithTemplate(artOnlyGcode);

    appState.gcodeContent = finalGcode;

    const outputArea = getElement("gcodeOutput");
    if (outputArea) {
        outputArea.value = finalGcode;
    }

    if (typeof update3DPreviewFromGcode === "function") {
        update3DPreviewFromGcode(artOnlyGcode);
    }

    const downloadBtn = getElement("downloadBtn");
    if (downloadBtn) {
        downloadBtn.style.display = "inline-block";
    }

    const statsElem = getElement("stats");
    if (statsElem) {
        statsElem.style.display = "block";
        const baseInfo = addCircularBase ? `Base: ${baseLayers} layer(s), margin ${baseMargin}mm<br>` : "";

        statsElem.innerHTML = `
            <strong>Result:</strong><br>
            Print Dimensions: ${printWidth.toFixed(2)}×${printHeight.toFixed(2)}mm<br>
            ${baseInfo}Estimated Filament: ${(totalE / 1000).toFixed(2)}m<br>
            Speed: ${minSpeedMMS}-${maxSpeedMMS} mm/s
        `;
    }
}

// ==================== 3D PREVIEW ====================

function init3DPreview() {
    if (!window.THREE || appState.threeRenderer) return;

    const container = getElement("preview3dContainer");
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 240;

    appState.threeScene = new THREE.Scene();
    appState.threeScene.background = new THREE.Color(0x020617);

    appState.threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    appState.threeCamera.up.set(0, 0, 1);

    appState.threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    appState.threeRenderer.setSize(width, height);
    appState.threeRenderer.setPixelRatio(window.devicePixelRatio || 1);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
    appState.threeScene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(100, -100, 200);
    appState.threeScene.add(dirLight);

    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    container.appendChild(appState.threeRenderer.domElement);

    updateThreeCameraFromOrbit();

    const dom = appState.threeRenderer.domElement;
    dom.style.cursor = "grab";

    dom.addEventListener("mousedown", (e) => {
        if (e.button === 2) appState.threePanDragging = true;
        else appState.threeOrbitDragging = true;

        appState.threeOrbitLastX = e.clientX;
        appState.threeOrbitLastY = e.clientY;
        dom.style.cursor = "grabbing";
    });

    window.addEventListener("mouseup", () => {
        appState.threeOrbitDragging = false;
        appState.threePanDragging = false;
        dom.style.cursor = "grab";
    });

    dom.addEventListener("mousemove", (e) => {
        if (!appState.threeCamera) return;

        const dx = e.clientX - appState.threeOrbitLastX;
        const dy = e.clientY - appState.threeOrbitLastY;
        appState.threeOrbitLastX = e.clientX;
        appState.threeOrbitLastY = e.clientY;

        if (appState.threeOrbitDragging) {
            appState.threeOrbitTheta -= dx * 0.005;
            appState.threeOrbitPhi += dy * 0.005;
            appState.threeOrbitPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, appState.threeOrbitPhi));
            updateThreeCameraFromOrbit();
        } else if (appState.threePanDragging) {
            const panSpeed = appState.threeOrbitRadius * 0.001;

            const right = new THREE.Vector3(
                Math.cos(appState.threeOrbitTheta),
                Math.sin(appState.threeOrbitTheta),
                0
            ).normalize();

            const forward = new THREE.Vector3(
                -Math.sin(appState.threeOrbitTheta),
                Math.cos(appState.threeOrbitTheta),
                0
            ).normalize();

            const moveRight = -dy * panSpeed;
            const moveForward = -dx * panSpeed;

            const move = new THREE.Vector3();
            move.addScaledVector(right, moveRight);
            move.addScaledVector(forward, moveForward);

            appState.threeTarget.add(move);
            appState.threeCamera.position.add(move);
        }
    });

    dom.addEventListener(
        "wheel",
        (e) => {
            if (!appState.threeCamera) return;
            e.preventDefault();

            const zoomFactor = 1 + e.deltaY * 0.001;
            appState.threeOrbitRadius = THREE.MathUtils.clamp(
                appState.threeOrbitRadius * zoomFactor,
                20,
                2000
            );

            updateThreeCameraFromOrbit();
        },
        { passive: false }
    );

    dom.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("resize", () => {
        if (!appState.threeRenderer || !appState.threeCamera) return;

        const w = container.clientWidth;
        const h = container.clientHeight;

        appState.threeRenderer.setSize(w, h);
        appState.threeCamera.aspect = w / h;
        appState.threeCamera.updateProjectionMatrix();
    });

    if (!appState.threeAnimating) {
        appState.threeAnimating = true;

        const animate = () => {
            requestAnimationFrame(animate);
            if (appState.threeRenderer && appState.threeScene && appState.threeCamera) {
                appState.threeRenderer.render(appState.threeScene, appState.threeCamera);
            }
        };

        animate();
    }
}

function updateThreeCameraFromOrbit() {
    if (!appState.threeCamera) return;
    const x = appState.threeOrbitRadius * Math.cos(appState.threeOrbitTheta) * Math.cos(appState.threeOrbitPhi);
    const y = appState.threeOrbitRadius * Math.sin(appState.threeOrbitTheta) * Math.cos(appState.threeOrbitPhi);
    const z = appState.threeOrbitRadius * Math.sin(appState.threeOrbitPhi);
    appState.threeCamera.position.set(x, y, z);
    appState.threeCamera.lookAt(appState.threeTarget);
}

function parseGcodeToSegments(gcode) {
    const lines = gcode.split("\n");
    let segments = [];
    let x = 0,
        y = 0,
        z = 0;
    let inBase = true;

    for (let raw of lines) {
        let line = raw.trim();

        if (!line || line.startsWith(";")) {
            if (line.includes("STARTING ARTWORK DRAWING")) {
                inBase = false;
            }
            continue;
        }

        if (line.startsWith("M0") || line.startsWith("M600") || line.includes("Pause")) {
            inBase = false;
            continue;
        }

        if (!(line.startsWith("G0") || line.startsWith("G1"))) continue;

        let parts = line.split(/\s+/);
        let nx = x,
            ny = y,
            nz = z;
        let extrude = false;
        let foundCoord = false;

        for (let i = 1; i < parts.length; i++) {
            const p = parts[i].toUpperCase();
            if (p.length < 2) continue;

            const code = p[0];
            const valStr = p.slice(1);
            const val = parseFloat(valStr);

            if (isNaN(val)) continue;

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

        if (!foundCoord && !extrude) continue;
        if (Math.abs(nx - x) < 0.001 && Math.abs(ny - y) < 0.001 && Math.abs(nz - z) < 0.001) continue;

        segments.push({
            x1: x || 0,
            y1: y || 0,
            z1: z || 0,
            x2: nx || 0,
            y2: ny || 0,
            z2: nz || 0,
            extrude: line.startsWith("G1") && extrude,
            isBase: inBase
        });

        x = nx;
        y = ny;
        z = nz;
    }
    return segments;
}

function update3DPreviewFromGcode(gcode) {
    if (!window.THREE) return;
    init3DPreview();
    if (!appState.threeScene) return;

    const segments = parseGcodeToSegments(gcode);
    if (!segments.length) return;

    if (appState.threeMesh) {
        appState.threeScene.remove(appState.threeMesh);
        appState.threeMesh.geometry.dispose();
        appState.threeMesh.material.dispose();
    }

    const bedWidth = safeParseFloat(getElement("bedWidth")?.value, 250, 50, 1000);
    const bedHeight = safeParseFloat(getElement("bedHeight")?.value, 250, 50, 1000);
    const originAtCenter = getElement("originAtCenter")?.checked ?? false;

    // For corner-origin: center is at bedWidth/2, bedHeight/2
    // For center-origin: coordinates are already centered around 0
    const cx = originAtCenter ? 0 : bedWidth / 2;
    const cy = originAtCenter ? 0 : bedHeight / 2;
    const cz = 0;

    const scale = 120 / Math.max(bedWidth, bedHeight);

    const positions = new Float32Array(segments.length * 6);
    const colors = new Float32Array(segments.length * 6);

    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];

        positions[i * 6 + 0] = (s.x1 - cx) * scale;
        positions[i * 6 + 1] = (s.y1 - cy) * scale;
        positions[i * 6 + 2] = (s.z1 - cz) * scale;
        positions[i * 6 + 3] = (s.x2 - cx) * scale;
        positions[i * 6 + 4] = (s.y2 - cy) * scale;
        positions[i * 6 + 5] = (s.z2 - cz) * scale;

        let c;
        if (s.extrude) {
            c = s.isBase ? [1.0, 1.0, 1.0] : [0.0, 0.0, 0.0];
        } else {
            c = [0.3, 0.3, 0.4];
        }

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

    appState.threeMesh = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
    appState.threeScene.add(appState.threeMesh);
}

// ==================== DOWNLOAD & MERGE ====================

function downloadGcode() {
    if (!appState.gcodeContent || appState.gcodeContent.length < 10) {
        showErrorMessage("Please generate G-code first");
        return;
    }

    try {
        const blob = new Blob([appState.gcodeContent], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "art_gcode.gcode";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Download error:", error);
        showErrorMessage("Failed to download G-code");
    }
}

function mergeWithTemplate(artGcode) {
    if (!appState.gcodeTemplateContent) {
        return artGcode;
    }

    const lines = appState.gcodeTemplateContent.split(/\r?\n/);
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toUpperCase();

        if (line.includes(";START_ART")) {
            startIndex = i;
        }
        if (line.includes(";END_ART")) {
            endIndex = i;
        }
    }

    if (startIndex === -1) {
        console.warn("Marker ;START_ART not found in template");
        return appState.gcodeTemplateContent + "\n" + artGcode;
    }

    const header = lines.slice(0, startIndex + 1).join("\n");

    let footer = "";
    if (endIndex !== -1 && endIndex > startIndex) {
        footer = lines.slice(endIndex).join("\n");
    } else {
        footer = lines.slice(startIndex + 1).join("\n");
    }

    const mode = getElement("filamentChangeMode")?.value || "manual";

    let changeCommand = "";
    if (mode === "manual") {
        changeCommand = "\n; --- MANUAL PAUSE ---\nM600\n";
    }

    let finalGcode = header + changeCommand + "\n; --- START ARTWORK ---\n" + artGcode + "\n; --- END ARTWORK ---\n";

    return finalGcode + footer;
}

// ==================== INITIALIZATION ====================

document.addEventListener("DOMContentLoaded", () => {
    console.log("✅ G-Code Art Generator (Improved) initialized");

    setupImageManipulationHandlers();

    const generateBtn = getElement("generateBtn");
    if (generateBtn) {
        generateBtn.addEventListener("click", processImage);
    }

    const downloadBtn = getElement("downloadBtn");
    if (downloadBtn) {
        downloadBtn.addEventListener("click", downloadGcode);
    }

    // Slider value displays
    const hilbertOrder = getElement("hilbertOrder");
    const orderVal = getElement("orderVal");
    if (hilbertOrder && orderVal) {
        hilbertOrder.addEventListener("input", (e) => {
            orderVal.innerText = e.target.value;
        });
    }

    const gamma = getElement("gamma");
    const gammaVal = getElement("gammaVal");
    if (gamma && gammaVal) {
        gamma.addEventListener("input", (e) => {
            gammaVal.innerText = parseFloat(e.target.value).toFixed(1);
        });
    }

    const textThresholdSlider = getElement("textThreshold");
    const textThresholdVal = getElement("textThresholdVal");
    if (textThresholdSlider && textThresholdVal) {
        textThresholdSlider.addEventListener("input", (e) => {
            textThresholdVal.innerText = parseFloat(e.target.value).toFixed(2);
        });
    }

    // Toggle text mode options visibility
    const textModeCheckbox = getElement("textMode");
    const textModeOptions = getElement("textModeOptions");
    if (textModeCheckbox && textModeOptions) {
        textModeCheckbox.addEventListener("change", (e) => {
            textModeOptions.style.display = e.target.checked ? "block" : "none";
        });
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            const btn = getElement("generateBtn");
            if (btn && !btn.disabled) {
                btn.click();
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            const btn = getElement("downloadBtn");
            if (btn && btn.style.display !== "none") {
                e.preventDefault();
                btn.click();
            }
        }
    });

    console.log("💡 Keyboard shortcuts: Ctrl+Enter (Generate) | Ctrl+S (Download)");
});
