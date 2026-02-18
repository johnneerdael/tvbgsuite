const fs = require('fs');
const os = require('os');
const path = require('path');
const { fabric } = require('fabric');
const canvasModule = require('canvas');

// Explicitly link fabric to node-canvas
fabric.nodeCanvas = canvasModule;

// --- ARGS ---
// Old: node render_task.js <payload_json> <output_path>
// New: node render_task.js <layout_json_path> <output_base_path> <data_json_string_or_path>

const layoutPath = process.argv[2];
const outputBasePath = process.argv[3];
const dataRaw = process.argv[4];

if (!layoutPath || !outputBasePath || !dataRaw) {
    console.error("Usage: node render_task.js <layout_json_path> <output_base_path> <data_json_string_or_path>");
    process.exit(1);
}

let data;
try {
    let dataStr = dataRaw;
    if (fs.existsSync(dataRaw)) {
        try {
            dataStr = fs.readFileSync(dataRaw, 'utf8');
        } catch (e) { /* ignore, treat as string */ }
    }
    data = JSON.parse(dataStr);
} catch (e) {
    console.error("FATAL: Failed to parse data JSON:", e.message);
    process.exit(1);
}

// --- ERROR HANDLERS ---
process.on('unhandledRejection', (reason, p) => {
    console.error('FATAL: Unhandled Rejection at:', p, 'reason:', reason);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('FATAL: Uncaught Exception:', err);
    process.exit(1);
});

// --- FONTS ---
const possibleDirs = [
    path.resolve(__dirname, 'fonts'),
    path.resolve(__dirname, 'static', 'fonts')
];

const fontsDir = possibleDirs.find(d => {
    try { return fs.existsSync(d); } catch (e) { return false; }
});

if (fontsDir) {
    let files = [];
    try {
        files = fs.readdirSync(fontsDir);
    } catch (e) {
        console.error(`[ERROR] Failed to read fonts dir: ${e.message}`);
    }

    // Helper to match Python's parse_font_filename logic
    const getFontFamilies = (filename) => {
        const ext = path.extname(filename);
        const originalName = path.basename(filename, ext);
        let name = originalName;
        let aggressiveName = originalName;

        name = name.replace(/(italic|oblique)/gi, '');
        aggressiveName = aggressiveName.replace(/(italic|oblique)/gi, '');

        const keywords = [
            'thin', 'hairline', '100', 'extra[-]?light', 'ultra[-]?light', '200',
            'light', '300', 'normal', 'regular', 'book', '400',
            'medium', '500', 'semi[-]?bold', 'demi[-]?bold', '600',
            'extra[-]?bold', 'ultra[-]?bold', '800', 'bold', '700',
            'black', 'heavy', '900', 'variablefont_wght', 'variablefont'
        ];

        keywords.forEach(k => {
            const strictRegex = new RegExp(`[-_ ]${k}`, 'gi');
            name = name.replace(strictRegex, '');
            const aggressiveRegex = new RegExp(k, 'gi');
            aggressiveName = aggressiveName.replace(aggressiveRegex, '');
        });

        const clean = (n) => n.replace(/(_\d+pt)/gi, '').replace(/,/g, ' ').replace(/[-_ ]+/g, ' ').trim();

        const families = new Set();
        families.add(clean(name));
        families.add(clean(aggressiveName));
        families.add(originalName);

        return Array.from(families).filter(f => f.length > 0);
    };

    files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
            let fullPath = path.join(fontsDir, file);
            if (file.includes(',')) {
                try {
                    const safeName = file.replace(/,/g, '_');
                    const tempPath = path.join(os.tmpdir(), `${Date.now()}_${Math.floor(Math.random() * 1000)}_${safeName}`);
                    fs.copyFileSync(fullPath, tempPath);
                    fullPath = tempPath;
                } catch (e) { return; }
            }
            try {
                if (fs.statSync(fullPath).size > 0) {
                    const families = getFontFamilies(file);
                    families.forEach(fam => {
                        console.log(`[DEBUG] Registering font: ${file} as ${fam}`);
                        canvasModule.registerFont(fullPath, { family: fam });
                        const noSpaces = fam.replace(/\s+/g, '');
                        if (noSpaces !== fam) canvasModule.registerFont(fullPath, { family: noSpaces });
                        // Try to add spaces for CamelCase (e.g. ZillaSlabHighlight -> Zilla Slab Highlight)
                        const withSpaces = fam.replace(/([a-z])([A-Z])/g, '$1 $2');
                        if (withSpaces !== fam && withSpaces !== noSpaces) {
                            canvasModule.registerFont(fullPath, { family: withSpaces });
                            console.log(`[DEBUG] Registering alias: ${withSpaces}`);
                        }
                    });
                }
            } catch (fontErr) { console.error(`[ERROR] Failed to load font ${file}: ${fontErr.message}`); }
        }
    });
}

// --- HELPERS (Synced with editor.js/batch.js) ---

function hexToRgba(hex, a) {
    let r = 0, g = 0, b = 0;
    if (!hex) return `rgba(0,0,0,${a === 0 ? 0.005 : a})`;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${a === 0 ? 0.005 : a})`;
}

function checkCollision(obj, blockedAreas, scaleFactor = 1) {
    if (!blockedAreas || blockedAreas.length === 0) return false;
    const b = obj.getBoundingRect();
    return blockedAreas.some(area => {
        const aLeft = area.left * scaleFactor;
        const aTop = area.top * scaleFactor;
        const aWidth = area.width * scaleFactor;
        const aHeight = area.height * scaleFactor;

        return (b.left < aLeft + aWidth &&
            b.left + b.width > aLeft &&
            b.top < aTop + aHeight &&
            b.top + b.height > aTop);
    });
}

function groupElementsByRow(elements, threshold = 5) {
    if (!elements.length) return [];
    elements.sort((a, b) => a.top - b.top);
    const rows = [];
    let currentRow = [elements[0]];
    for (let i = 1; i < elements.length; i++) {
        if (Math.abs(elements[i].top - currentRow[0].top) < threshold) {
            currentRow.push(elements[i]);
        } else {
            rows.push(currentRow);
            currentRow = [elements[i]];
        }
    }
    rows.push(currentRow);
    return rows;
}

function fitTextToContainer(canvas, textbox) {
    if (!canvas || !textbox) return;
    const textSource = textbox.fullMediaText || textbox.text || "";
    textbox.set('text', textSource);

    // Node-canvas specific: initDimensions might need to be called if text changes
    if (typeof textbox.initDimensions === 'function') textbox.initDimensions();

    const limit = (textbox.fixedHeight || textbox.height) - 5;

    // Helper to get current rendered height
    const getHeight = () => textbox.height * textbox.scaleY;

    if (getHeight() > limit) {
        let words = textSource.split(' ');
        if (getHeight() > limit * 1.5) {
            const ratio = limit / getHeight();
            words = words.slice(0, Math.floor(words.length * ratio));
            textbox.set('text', words.join(' ') + '...');
            if (typeof textbox.initDimensions === 'function') textbox.initDimensions();
        }

        while (getHeight() > limit && words.length > 0) {
            words.pop();
            textbox.set('text', words.join(' ') + '...');
            if (typeof textbox.initDimensions === 'function') textbox.initDimensions();
        }
    }
}

// ADAPTED from editor.js: updateVerticalLayout
// Replaces DOM lookups with 'settings' object usage
function updateVerticalLayout(canvas, settings, activeBlockedAreas = []) {
    if (!canvas) return;

    const anchor = canvas.getObjects().find(o => o.dataTag === 'title');
    if (!anchor) return;

    // Mapping settings
    const padding = parseInt(settings.lineSpacing) || 20;
    const hPadding = parseInt(settings.tagPadding) || 20;
    const rowThreshold = 5;

    const marginTop = parseInt(settings.margins?.top || 50);
    const marginBottom = parseInt(settings.margins?.bottom || 50);
    const marginLeft = parseInt(settings.margins?.left || 50);
    const marginRight = parseInt(settings.margins?.right || 50);

    const scaleFactor = 1;

    // Update Text Alignments
    const textAlignment = settings.textContentAlignment || 'left';
    canvas.getObjects().forEach(o => {
        if ((o.dataTag === 'overview' || o.dataTag === 'provider_source') && (o.type === 'textbox' || o.type === 'i-text')) {
            o.set('textAlign', textAlignment);
        }
    });

    const alignment = settings.tagAlignment || 'left';

    // 1. Constrain Anchor
    if (anchor.left < marginLeft) anchor.set('left', marginLeft);
    if (anchor.left + (anchor.width * anchor.scaleX) > canvas.width - marginRight) {
        anchor.set('left', Math.max(marginLeft, canvas.width - marginRight - (anchor.width * anchor.scaleX)));
    }
    if (anchor.top < marginTop) anchor.set('top', marginTop);
    if (anchor.top + (anchor.height * anchor.scaleY) > canvas.height - marginBottom) {
        anchor.set('top', Math.max(marginTop, canvas.height - marginBottom - (anchor.height * anchor.scaleY)));
    }
    anchor.setCoords();

    // 2. Auto-Scale Anchor (Gap Fitting)
    if (activeBlockedAreas.length > 0) {
        const anchorH = anchor.height * anchor.scaleY;
        const anchorCenterY = anchor.top + (anchorH / 2);
        const anchorLeft = anchor.left;
        const anchorRight = anchor.left + (anchor.width * anchor.scaleX);

        const obstacles = [];
        obstacles.push({ top: -Infinity, bottom: marginTop });
        obstacles.push({ top: canvas.height - marginBottom, bottom: Infinity });

        activeBlockedAreas.forEach(area => {
            const aLeft = area.left * scaleFactor;
            const aWidth = area.width * scaleFactor;
            const aRight = aLeft + aWidth;
            if (aLeft < anchorRight && aRight > anchorLeft) {
                const aTop = area.top * scaleFactor;
                const aHeight = area.height * scaleFactor;
                obstacles.push({ top: aTop, bottom: aTop + aHeight });
            }
        });

        obstacles.sort((a, b) => a.top - b.top);
        const merged = [];
        if (obstacles.length > 0) {
            let curr = obstacles[0];
            for (let i = 1; i < obstacles.length; i++) {
                if (obstacles[i].top < curr.bottom) {
                    curr.bottom = Math.max(curr.bottom, obstacles[i].bottom);
                } else {
                    merged.push(curr);
                    curr = obstacles[i];
                }
            }
            merged.push(curr);
        }

        const gaps = [];
        for (let i = 0; i < merged.length - 1; i++) {
            const top = merged[i].bottom;
            const bottom = merged[i + 1].top;
            if (bottom > top) gaps.push({ top, bottom, height: bottom - top });
        }

        let bestGap = gaps.find(g => anchorCenterY >= g.top && anchorCenterY <= g.bottom);
        if (!bestGap && gaps.length > 0) {
            bestGap = gaps.reduce((prev, curr) => {
                const prevDist = Math.min(Math.abs(anchorCenterY - prev.top), Math.abs(anchorCenterY - prev.bottom));
                const currDist = Math.min(Math.abs(anchorCenterY - curr.top), Math.abs(anchorCenterY - curr.bottom));
                return (currDist < prevDist) ? curr : prev;
            });
        }

        if (bestGap) {
            const currentH = anchor.height * anchor.scaleY;
            const maxH = Math.max(20, bestGap.height - 10);
            const targetH = currentH; // In render task, we stick to current/preferred size
            const finalH = Math.min(targetH, maxH);

            if (Math.abs(finalH - currentH) > 1) {
                const oldLeft = anchor.left;
                const oldWidth = anchor.width * anchor.scaleX;
                const oldRight = oldLeft + oldWidth;
                const oldCenterX = oldLeft + (oldWidth / 2);

                anchor.scaleToHeight(finalH);
                const newWidth = anchor.width * anchor.scaleX;

                if (alignment === 'right') anchor.set('left', oldRight - newWidth);
                else if (alignment === 'center') anchor.set('left', oldCenterX - (newWidth / 2));
                else anchor.set('left', oldLeft);

                anchor.set('top', bestGap.top + (bestGap.height - finalH) / 2);
                anchor.setCoords();
            }
        }
    }

    // 3. Anchor Collision Push
    let safety = 0;
    while (checkCollision(anchor, activeBlockedAreas, scaleFactor) && safety < 10) {
        const b = anchor.getBoundingRect();
        const area = activeBlockedAreas.find(a => {
            const aLeft = a.left * scaleFactor;
            const aTop = a.top * scaleFactor;
            const aWidth = a.width * scaleFactor;
            const aHeight = a.height * scaleFactor;
            return (b.left < aLeft + aWidth && b.left + b.width > aLeft &&
                b.top < aTop + aHeight && b.top + b.height > aTop);
        });

        if (area) {
            const aLeft = area.left * scaleFactor;
            const aTop = area.top * scaleFactor;
            const aWidth = area.width * scaleFactor;
            const aHeight = area.height * scaleFactor;
            const overL = (b.left + b.width) - aLeft;
            const overR = (aLeft + aWidth) - b.left;
            const overT = (b.top + b.height) - aTop;
            const overB = (aTop + aHeight) - b.top;
            const min = Math.min(overL, overR, overT, overB);

            if (min === overL) anchor.left -= overL;
            else if (min === overR) anchor.left += overR;
            else if (min === overT) anchor.top -= overT;
            else if (min === overB) anchor.top += overB;
            anchor.setCoords();
        }
        safety++;
    }
    anchor.setCoords();

    let current_y = anchor.top + (anchor.height * anchor.scaleY) + padding;

    // Filter elements
    const elements = canvas.getObjects().filter(o => {
        if (o.dataTag === 'background') return false;
        if (o.dataTag === 'title') return false;
        if (o.dataTag === 'guide' || o.dataTag === 'fade_effect' || o.dataTag === 'grid_line' || o.dataTag === 'guide_overlay' || o.dataTag === 'ambilight_bg') return false;
        if (!o.dataTag) return false;
        if (o.snapToObjects === false) return false; // Manual mode check (preserved from original JSON)
        return true;
    });

    const rows = groupElementsByRow(elements, rowThreshold);

    if (rows.length > 0) {
        let maxRowWidth = 0;
        rows.forEach(row => {
            let w = 0;
            const visibleEls = row.filter(e => e.visible);
            visibleEls.forEach((el, i) => {
                const pad = el.padding || 0;
                w += (el.width * el.scaleX) + (pad * 2);
                if (i < visibleEls.length - 1) w += hPadding;
            });
            if (w > maxRowWidth) maxRowWidth = w;
        });

        const anchorW = anchor.width * anchor.scaleX;
        let shift = 0;

        if (alignment === 'center') {
            const idealStart = anchor.left + (anchorW - maxRowWidth) / 2;
            if (idealStart < marginLeft) shift = marginLeft - idealStart;
            else if (idealStart + maxRowWidth > canvas.width - marginRight) shift = (canvas.width - marginRight - maxRowWidth) - idealStart;
        } else if (alignment === 'right') {
            const idealStart = (anchor.left + anchorW) - maxRowWidth;
            if (idealStart < marginLeft) shift = marginLeft - idealStart;
        } else { // left
            const idealStart = anchor.left;
            if (idealStart + maxRowWidth > canvas.width - marginRight) shift = (canvas.width - marginRight - maxRowWidth) - idealStart;
        }

        if (shift !== 0) { anchor.set('left', anchor.left + shift); anchor.setCoords(); }
        if (shift !== 0) {
            anchor.set('left', anchor.left + shift);

            // Re-clamp anchor to margins to prevent sliding off screen
            if (anchor.left < marginLeft) anchor.set('left', marginLeft);
            if (anchor.left + (anchor.width * anchor.scaleX) > canvas.width - marginRight) {
                anchor.set('left', Math.max(marginLeft, canvas.width - marginRight - (anchor.width * anchor.scaleX)));
            }

            anchor.setCoords();
        }
    }

    const anchorLeft = anchor.left;
    const anchorWidth = anchor.width * anchor.scaleX;

    rows.forEach(row => {
        // Match Height Logic
        const resizableIcons = row.filter(el => el.type === 'image' && el.matchHeight && el.visible);
        if (resizableIcons.length > 0) {
            const ref = row.find(el => (el.type === 'i-text' || el.type === 'textbox' || el.type === 'group') && !el.matchHeight && el.visible);
            if (ref) {
                const targetH = ref.height * ref.scaleY;
                resizableIcons.forEach(icon => {
                    if (Math.abs((icon.height * icon.scaleY) - targetH) > 0.5) {
                        icon.scaleToHeight(targetH);
                        icon.setCoords();
                    }
                });
            }
        }

        row.sort((a, b) => a.left - b.left);

        let totalRowWidth = 0;
        const visibleEls = row.filter(e => e.visible);
        visibleEls.forEach((el, index) => {
            el.setCoords();
            const pad = el.padding || 0;
            totalRowWidth += (el.width * el.scaleX) + (pad * 2);
            if (index < visibleEls.length - 1) totalRowWidth += hPadding;
        });

        let current_x;
        if (alignment === 'center') {
            current_x = anchorLeft + (anchorWidth - totalRowWidth) / 2;
        } else if (alignment === 'right') {
            current_x = (anchorLeft + anchorWidth) - totalRowWidth;
            const lastEl = visibleEls[visibleEls.length - 1];
            if (lastEl) current_x += (lastEl.padding || 0);
        } else {
            current_x = anchorLeft;
            const firstEl = visibleEls[0];
            if (firstEl) current_x -= (firstEl.padding || 0);
        }

        if (current_x < marginLeft) current_x = marginLeft;
        if (current_x + totalRowWidth > canvas.width - marginRight) {
            current_x = Math.max(marginLeft, canvas.width - marginRight - totalRowWidth);
        }

        const maxRowHeight = Math.max(...row.map(el => el.visible ? (el.height * el.scaleY) + ((el.padding || 0) * 2) : 0));

        row.forEach(el => {
            const pad = el.padding || 0;
            el.set({ top: current_y + pad, left: current_x + pad });
            el.setCoords();

            const startX = current_x;
            let isColliding = checkCollision(el, activeBlockedAreas, scaleFactor);
            while (isColliding && current_x < canvas.width - marginRight) {
                current_x += 10;
                el.set({ left: current_x + pad });
                el.setCoords();
                isColliding = checkCollision(el, activeBlockedAreas, scaleFactor);
            }
            if (isColliding) {
                current_x = startX;
                el.set({ left: current_x + pad });
                el.setCoords();
            }

            if (el.visible) {
                current_x += (el.width * el.scaleX) + (pad * 2) + hPadding;
            } else {
                current_x += 0.1;
            }
        });

        const lastEl = row[row.length - 1];
        if (lastEl && lastEl.visible) {
            const rightEdge = lastEl.left + (lastEl.width * lastEl.scaleX);
            const maxRight = canvas.width - marginRight;
            if (rightEdge > maxRight) {
                const overflow = rightEdge - maxRight;
                row.forEach(el => {
                    el.left -= overflow;
                    el.setCoords();
                });
            }
        }

        if (maxRowHeight > 0) current_y += maxRowHeight + padding;
    });

    const contentBottom = current_y - padding;
    const maxBottom = canvas.height - marginBottom;

    let maxBlockedShift = 0;
    const allElements = [anchor];
    rows.forEach(row => row.forEach(el => { if (el.visible) allElements.push(el); }));

    allElements.forEach(el => {
        const b = el.getBoundingRect();
        activeBlockedAreas.forEach(area => {
            const aLeft = area.left * scaleFactor;
            const aTop = area.top * scaleFactor;
            const aWidth = area.width * scaleFactor;
            const aHeight = area.height * scaleFactor;
            if (b.left < aLeft + aWidth && b.left + b.width > aLeft &&
                b.top < aTop + aHeight && b.top + b.height > aTop) {
                const overlap = (b.top + b.height) - aTop;
                if (overlap > 0 && overlap > maxBlockedShift) maxBlockedShift = overlap;
            }
        });
    });

    const marginShift = Math.max(0, contentBottom - maxBottom);
    const totalShift = Math.max(marginShift, maxBlockedShift);

    if (totalShift > 0) {
        let limitTop = marginTop;
        const anchorLeft = anchor.left;
        const anchorRight = anchor.left + (anchor.width * anchor.scaleX);

        activeBlockedAreas.forEach(area => {
            const aLeft = area.left * scaleFactor;
            const aWidth = area.width * scaleFactor;
            const aRight = aLeft + aWidth;
            const aTop = area.top * scaleFactor;
            const aHeight = area.height * scaleFactor;
            const aBottom = aTop + aHeight;

            if (aLeft < anchorRight && aRight > anchorLeft) {
                if (aBottom <= anchor.top + 5) {
                    if (aBottom > limitTop) limitTop = aBottom;
                }
            }
        });

        const maxSafeShiftUp = Math.max(0, anchor.top - limitTop);
        if (totalShift > maxSafeShiftUp) {
            const deficit = totalShift - maxSafeShiftUp;
            const currentHeight = anchor.height * anchor.scaleY;
            const newHeight = Math.max(20, currentHeight - deficit);

            const oldLeft = anchor.left;
            const oldWidth = anchor.width * anchor.scaleX;
            const oldRight = oldLeft + oldWidth;
            const oldCenterX = oldLeft + (oldWidth / 2);

            anchor.scaleToHeight(newHeight);
            const newWidth = anchor.width * anchor.scaleX;

            if (alignment === 'right') anchor.set('left', oldRight - newWidth);
            else if (alignment === 'center') anchor.set('left', oldCenterX - (newWidth / 2));

            anchor.set('top', limitTop);
            rows.forEach(row => row.forEach(el => el.set('top', el.top - totalShift)));
        } else {
            anchor.set('top', anchor.top - totalShift);
            rows.forEach(row => row.forEach(el => el.set('top', el.top - totalShift)));
        }
    }
}

// --- EFFECT HELPERS ---
function drawRoundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Manual box blur for corner softness - shadowBlur is unreliable in node-canvas
function applyBoxBlur(imageData, width, height, radius) {
    if (radius < 1) return imageData;

    const data = imageData.data;
    const tempData = new Uint8ClampedArray(data);

    // Horizontal blur pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;

            for (let kx = -radius; kx <= radius; kx++) {
                const px = Math.min(width - 1, Math.max(0, x + kx));
                const idx = (y * width + px) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                a += data[idx + 3];
                count++;
            }

            const idx = (y * width + x) * 4;
            tempData[idx] = r / count;
            tempData[idx + 1] = g / count;
            tempData[idx + 2] = b / count;
            tempData[idx + 3] = a / count;
        }
    }

    // Vertical blur pass
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;

            for (let ky = -radius; ky <= radius; ky++) {
                const py = Math.min(height - 1, Math.max(0, y + ky));
                const idx = (py * width + x) * 4;
                r += tempData[idx];
                g += tempData[idx + 1];
                b += tempData[idx + 2];
                a += tempData[idx + 3];
                count++;
            }

            const idx = (y * width + x) * 4;
            data[idx] = r / count;
            data[idx + 1] = g / count;
            data[idx + 2] = b / count;
            data[idx + 3] = a / count;
        }
    }

    return imageData;
}

function generateAlphaMask(mainBg, settings) {
    if (!mainBg) return null;
    const w = mainBg.width;
    const h = mainBg.height;
    const maskCanvas = canvasModule.createCanvas(w, h); // Using node-canvas directly
    const ctx = maskCanvas.getContext('2d');

    // In node-canvas, mainBg.width is just the image dimensions (no scale yet if using raw image)
    // But mainBg here is a fabric object? yes.
    // The mask needs to match the IMAGE internal dimensions regarding gradients?
    // Wait, the mask in fabric is applied to the object.

    const scaleX = mainBg.scaleX;
    const scaleY = mainBg.scaleY;

    const type = settings.fadeEffect || 'none';
    const sT = (parseInt(settings.fadeTop) || 0) / scaleY;
    const sB = (parseInt(settings.fadeBottom) || 0) / scaleY;
    const sL = (parseInt(settings.fadeLeft) || 0) / scaleX;
    const sR = (parseInt(settings.fadeRight) || 0) / scaleX;
    const radius = (parseInt(settings.fadeRadius) || 0) / Math.max(scaleX, scaleY);
    const softness = (parseInt(settings.fadeSoftness) || 40) / Math.max(scaleX, scaleY);

    // Helper to draw directional fades
    function drawLinearFade(x, y, w, h, fromSide) {
        let g;
        if (fromSide === 'top') {
            g = ctx.createLinearGradient(0, 0, 0, h);
        } else if (fromSide === 'bottom') {
            g = ctx.createLinearGradient(0, y + h, 0, y);
        } else if (fromSide === 'left') {
            g = ctx.createLinearGradient(0, 0, w, 0);
        } else if (fromSide === 'right') {
            g = ctx.createLinearGradient(x + w, 0, x, 0);
        }

        g.addColorStop(0, 'rgba(0,0,0,1)');   // Black (transparent in mask) at edge
        g.addColorStop(1, 'rgba(0,0,0,0)');   // Transparent (opaque in mask) inwards

        ctx.fillStyle = g;
        // Check compositing: We want to "erase" the white mask
        // destination-out removes existing content based on new alpha
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = 'source-over'; // Reset
    }

    if (type === 'vignette') {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        const stop = Math.max(0, 1 - (radius * 2));
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(stop, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    } else if (type === 'mask') {
        ctx.clearRect(0, 0, w, h);
        const gV = ctx.createLinearGradient(0, 0, 0, h);
        if (sT > 0) { gV.addColorStop(0, 'rgba(0,0,0,0)'); gV.addColorStop(Math.min(sT / h, 0.5), 'rgba(0,0,0,1)'); }
        else { gV.addColorStop(0, 'rgba(0,0,0,1)'); }
        if (sB > 0) { gV.addColorStop(Math.max(1 - (sB / h), 0.5), 'rgba(0,0,0,1)'); gV.addColorStop(1, 'rgba(0,0,0,0)'); }
        else { gV.addColorStop(1, 'rgba(0,0,0,1)'); }
        ctx.fillStyle = gV; ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'destination-in';
        const gH = ctx.createLinearGradient(0, 0, w, 0);
        if (sL > 0) { gH.addColorStop(0, 'rgba(0,0,0,0)'); gH.addColorStop(Math.min(sL / w, 0.5), 'rgba(0,0,0,1)'); }
        else { gH.addColorStop(0, 'rgba(0,0,0,1)'); }
        if (sR > 0) { gH.addColorStop(Math.max(1 - (sR / w), 0.5), 'rgba(0,0,0,1)'); gH.addColorStop(1, 'rgba(0,0,0,0)'); }
        else { gH.addColorStop(1, 'rgba(0,0,0,1)'); }
        ctx.fillStyle = gH; ctx.fillRect(0, 0, w, h);
    } else if (type === 'gradient') {
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    } else {
        // Default (or 'none'): create elliptical vignette fade for Ambilight
        // Pure radial gradient approach - no shadowBlur to avoid colored overlay
        const cx = w / 2;
        const cy = h / 2;
        const maxDim = Math.max(w, h);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.6);

        // Smooth gradient fade stops for seamless blending
        grad.addColorStop(0, 'rgba(0,0,0,1)');      // Full opacity at center
        grad.addColorStop(0.7, 'rgba(0,0,0,1)');    // Solid through 70%
        grad.addColorStop(0.85, 'rgba(0,0,0,0.9)'); // Very subtle fade
        grad.addColorStop(0.95, 'rgba(0,0,0,0.5)'); // Moderate transparency
        grad.addColorStop(1, 'rgba(0,0,0,0)');      // Fully transparent

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    // Apply directional fades AFTER generating the base mask
    // "Erase" edges using destination-out
    if (sT > 0) drawLinearFade(0, 0, w, sT, 'top');
    if (sB > 0) drawLinearFade(0, h - sB, w, sB, 'bottom');
    if (sL > 0) drawLinearFade(0, 0, sL, h, 'left');
    if (sR > 0) drawLinearFade(w - sR, 0, sR, h, 'right');

    // Apply rounded corners with manual blur for softness
    // shadowBlur is unreliable in node-canvas, so we use pixel-level blur
    if (radius > 0) {
        ctx.globalCompositeOperation = 'destination-in';

        if (softness > 0) {
            // Optimization: Perform blur on a smaller canvas to improve performance
            // Processing 1920x1080 pixels in JS is very slow.
            // Scaling down by 4 reduces pixel count by 16x, making it mucn faster.
            const scale = 0.25;
            const sw = Math.ceil(w * scale);
            const sh = Math.ceil(h * scale);

            // Create small temp canvas
            const temp = canvasModule.createCanvas(sw, sh);
            const tCtx = temp.getContext('2d');

            // Calculate scaled dimensions
            // Maximize radius: inset = 0 to prevent shrinking
            const scaledSoftness = softness * scale;
            const scaledRadius = radius * scale;
            const inset = 0;

            const rectW = Math.max(0, sw - inset * 2);
            const rectH = Math.max(0, sh - inset * 2);
            const maxR = Math.min(rectW, rectH) / 2;
            const safeR = Math.min(Math.max(0, scaledRadius - inset), maxR);

            // Draw white rounded rect on small canvas
            tCtx.fillStyle = 'white';
            tCtx.beginPath();
            drawRoundedPath(tCtx, inset, inset, rectW, rectH, safeR);
            tCtx.fill();

            // Apply blur on small image data
            const imageData = tCtx.getImageData(0, 0, sw, sh);
            // Scale blur radius accordingly
            // User requested wider soft zone: Use full softness instead of softness/3
            // effectively tripling the blur width
            const blurRadius = Math.max(1, Math.ceil(softness * scale));

            // Apply blur 3 times for Gaussian approximation
            applyBoxBlur(imageData, sw, sh, blurRadius);
            applyBoxBlur(imageData, sw, sh, blurRadius);
            applyBoxBlur(imageData, sw, sh, blurRadius);

            tCtx.putImageData(imageData, 0, 0);

            // Draw scaled-up result back to main canvas
            // The scaling up automatically adds some smoothness too
            ctx.drawImage(temp, 0, 0, sw, sh, 0, 0, w, h);
        } else {
            // No softness - use clean hard edges
            const safeR = Math.min(radius, Math.min(w, h) / 2);
            ctx.fillStyle = 'black';
            ctx.beginPath();
            drawRoundedPath(ctx, 0, 0, w, h, safeR);
            ctx.fill();
        }
    }

    return maskCanvas;
}

function createFadeRect(mainBg, type, size, bgColor, settings) {
    let fadeColor = bgColor;
    const style = settings.bgStyle || 'solid';
    const grads = settings.currentGradientColors;

    if (grads) {
        if (style === 'gradient_h') {
            if (type === 'left') fadeColor = grads.c1 || fadeColor;
            else if (type === 'right') fadeColor = grads.c2 || fadeColor;
            else fadeColor = grads.c1 || fadeColor;
        } else if (style === 'gradient_v') {
            if (type === 'top') fadeColor = grads.c1 || fadeColor;
            else if (type === 'bottom') fadeColor = grads.c2 || fadeColor;
            else fadeColor = grads.c1 || fadeColor;
        }
    }

    const b = 2; // Bleed
    const wImg = mainBg.width * mainBg.scaleX;
    const hImg = mainBg.height * mainBg.scaleY;

    let bgLeft = mainBg.left;
    let bgTop = mainBg.top;
    if (mainBg.originX === 'center') bgLeft -= wImg / 2;
    if (mainBg.originY === 'center') bgTop -= hImg / 2;

    let w, h, x, y, c;
    if (type === 'left') { w = parseInt(size) + b; h = hImg + b * 2; x = bgLeft - b; y = bgTop - b; }
    else if (type === 'right') { w = parseInt(size) + b; h = hImg + b * 2; x = bgLeft + wImg - size; y = bgTop - b; }
    else if (type === 'top') { w = wImg + b * 2; h = parseInt(size) + b; x = bgLeft - b; y = bgTop - b; }
    else if (type === 'bottom') { w = wImg + b * 2; h = parseInt(size) + b; x = bgLeft - b; y = bgTop + hImg - size; }

    if (type === 'left') c = { x1: 0, y1: 0, x2: 1, y2: 0 };
    else if (type === 'right') c = { x1: 1, y1: 0, x2: 0, y2: 0 };
    else if (type === 'top') c = { x1: 0, y1: 0, x2: 0, y2: 1 };
    else if (type === 'bottom') c = { x1: 0, y1: 1, x2: 0, y2: 0 };

    return new fabric.Rect({
        left: x, top: y, width: w, height: h, selectable: false, evented: false,
        fill: new fabric.Gradient({
            type: 'linear',
            gradientUnits: 'percentage',
            coords: c,
            colorStops: [{ offset: 0, color: fadeColor }, { offset: 1, color: hexToRgba(fadeColor, 0) }]
        }),
        dataTag: 'fade_effect'
    });
}

function addCornerFade(canvas, mainBg, pos, radius, bgColor, settings) {
    const r = parseInt(radius);
    if (r <= 0) return;

    let fadeColor = bgColor;
    const style = settings.bgStyle || 'solid';
    const grads = settings.currentGradientColors;

    if (grads) {
        if (style === 'gradient_h') {
            if (pos.includes('left')) fadeColor = grads.c1 || fadeColor;
            if (pos.includes('right')) fadeColor = grads.c2 || fadeColor;
        } else if (style === 'gradient_v') {
            if (pos.includes('top')) fadeColor = grads.c1 || fadeColor;
            if (pos.includes('bottom')) fadeColor = grads.c2 || fadeColor;
        }
    }

    const w = mainBg.width * mainBg.scaleX;
    const h = mainBg.height * mainBg.scaleY;
    let bgLeft = mainBg.left;
    let bgTop = mainBg.top;
    if (mainBg.originX === 'center') bgLeft -= w / 2;
    if (mainBg.originY === 'center') bgTop -= h / 2;

    let rectLeft, rectTop, gradCx, gradCy;

    if (pos === 'bottom-left') { rectLeft = bgLeft; rectTop = bgTop + h - r; gradCx = 0; gradCy = r; }
    else if (pos === 'bottom-right') { rectLeft = bgLeft + w - r; rectTop = bgTop + h - r; gradCx = r; gradCy = r; }
    else if (pos === 'top-left') { rectLeft = bgLeft; rectTop = bgTop; gradCx = 0; gradCy = 0; }
    else if (pos === 'top-right') { rectLeft = bgLeft + w - r; rectTop = bgTop; gradCx = r; gradCy = 0; }

    const grad = new fabric.Gradient({
        type: 'radial',
        coords: { r1: 0, r2: r, x1: gradCx, y1: gradCy, x2: gradCx, y2: gradCy },
        colorStops: [{ offset: 0, color: fadeColor }, { offset: 1, color: hexToRgba(fadeColor, 0) }]
    });

    const rect = new fabric.Rect({ left: rectLeft, top: rectTop, width: r, height: r, fill: grad, selectable: false, evented: false, dataTag: 'fade_effect' });
    canvas.add(rect);
    rect.moveTo(canvas.getObjects().indexOf(mainBg) + 1);
}

function addVignette(canvas, mainBg, radius, bgColor) {
    const r = parseInt(radius);
    if (r <= 0) return;
    const padding = 10;
    const w = Math.ceil(mainBg.width * mainBg.scaleX) + padding;
    const h = Math.ceil(mainBg.height * mainBg.scaleY) + padding;

    let bgLeft = mainBg.left;
    let bgTop = mainBg.top;
    if (mainBg.originX === 'center') bgLeft -= (mainBg.width * mainBg.scaleX) / 2;
    if (mainBg.originY === 'center') bgTop -= (mainBg.height * mainBg.scaleY) / 2;

    const grad = new fabric.Gradient({
        type: 'radial',
        coords: { r1: 0, r2: r, x1: w / 2, y1: h / 2, x2: w / 2, y2: h / 2 },
        colorStops: [{ offset: 0, color: hexToRgba(bgColor, 0) }, { offset: 1, color: bgColor }]
    });

    const rect = new fabric.Rect({ left: bgLeft - (padding / 2), top: bgTop - (padding / 2), width: w, height: h, fill: grad, selectable: false, evented: false, dataTag: 'fade_effect' });
    canvas.add(rect);
    rect.moveTo(canvas.getObjects().indexOf(mainBg) + 1);
}

async function applyCustomEffects(canvas, settings, mainBg) {
    if (!settings || !mainBg) return;
    // DO NOT reset clipPath here - preserve it from layout JSON if it exists



    if (settings.backgroundMode === 'ambilight' && mainBg) {
        // For Ambilight, ALWAYS generate a fresh mask matching current backdrop dimensions
        // Layout clipPath is designed for placeholder image and won't fit dynamically loaded images

        // Override fadeEffect to ensure we use our custom vignette logic
        // The 'mask' fadeEffect creates rectangular fades which don't work well for Ambilight
        const ambilightSettings = {
            ...settings,
            fadeEffect: 'none', // Force default vignette path
            fadeRadius: parseInt(settings.fadeRadius) || 1000,
            fadeSoftness: parseInt(settings.fadeSoftness) || 40 // Use value from settings
        };

        const maskCanvas = generateAlphaMask(mainBg, ambilightSettings);
        if (maskCanvas) {
            await new Promise(resolve => {
                const dataURL = maskCanvas.toDataURL();
                fabric.Image.fromURL(dataURL, (maskImg) => {
                    if (maskImg) {
                        maskImg.originX = 'center';
                        maskImg.originY = 'center';
                        mainBg.clipPath = maskImg;
                        console.log("Applied Ambilight fade mask to backdrop");
                    }
                    resolve();
                });
            });
        }
    } else {
        // Original logic for non-ambilight effects
        const bgColor = settings.bgColor || "#000000";
        const type = settings.fadeEffect || 'none';
        const hasFadeSettings = (type !== 'none' && type !== 'custom') ||
            (type === 'custom' && (settings.fadeLeft || settings.fadeRight || settings.fadeTop || settings.fadeBottom));

        if (!hasFadeSettings) return;

        canvas.getObjects().filter(o => o.dataTag === 'fade_effect').forEach(o => canvas.remove(o));

        const addLinear = (side) => {
            let val = 0;
            if (side === 'left') val = settings.fadeLeft;
            else if (side === 'right') val = settings.fadeRight;
            else if (side === 'top') val = settings.fadeTop;
            else if (side === 'bottom') val = settings.fadeBottom;

            if (val && parseInt(val) > 0) {
                const rect = createFadeRect(mainBg, side, val, bgColor, settings);
                canvas.add(rect);
                const bgIdx = canvas.getObjects().indexOf(mainBg);
                if (bgIdx >= 0) rect.moveTo(bgIdx + 1);
            }
        };

        if (type === 'custom') { ['left', 'right', 'top', 'bottom'].forEach(addLinear); }
        else if (type === 'bottom-left') { addCornerFade(canvas, mainBg, 'bottom-left', settings.fadeRadius, bgColor, settings); addLinear('left'); addLinear('bottom'); }
        else if (type === 'bottom-right') { addCornerFade(canvas, mainBg, 'bottom-right', settings.fadeRadius, bgColor, settings); addLinear('right'); addLinear('bottom'); }
        else if (type === 'top-left') { addCornerFade(canvas, mainBg, 'top-left', settings.fadeRadius, bgColor, settings); addLinear('left'); addLinear('top'); }
        else if (type === 'top-right') { addCornerFade(canvas, mainBg, 'top-right', settings.fadeRadius, bgColor, settings); addLinear('right'); addLinear('top'); }
        else if (type === 'vignette') { addVignette(canvas, mainBg, settings.fadeRadius, bgColor); addLinear('top'); addLinear('bottom'); }
    }
}

function getCertificationFilename(rating) {
    if (!rating) return null;
    let r = String(rating).toUpperCase().replace(/[\s-]/g, '');
    if (r === 'FSK0' || r === '0' || r === 'DE0' || r === 'AB0' || r === 'AB0JAHREN') return 'FSK_0.svg';
    if (r === 'FSK6' || r === '6' || r === 'DE6' || r === 'AB6' || r === 'AB6JAHREN') return 'FSK_6.svg';
    if (r === 'FSK12' || r === '12' || r === 'DE12' || r === 'AB12' || r === 'AB12JAHREN') return 'FSK_12.svg';
    if (r === 'FSK16' || r === '16' || r === 'DE16' || r === 'AB16' || r === 'AB16JAHREN') return 'FSK_16.svg';
    if (r === 'FSK18' || r === '18' || r === 'DE18' || r === 'AB18' || r === 'AB18JAHREN') return 'FSK_18.svg';
    return null;
}

// --- MAIN EXECUTION ---

(async () => {
    try {
        // 1. Load Layout JSON
        const layoutJson = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

        // 2. Setup Canvas
        let baseWidth = 1920;
        let baseHeight = 1080;
        if ((layoutJson.width && layoutJson.width > 3000) || (layoutJson.objects && layoutJson.objects.some(o => o.left > 2500))) {
            baseWidth = 3840;
            baseHeight = 2160;
        }

        const canvas = new fabric.StaticCanvas(null, { width: baseWidth, height: baseHeight });
        let mainBg = canvas.getObjects().find(o => o.dataTag === 'background');
        // Filter out ambilight_bg to avoid duplicates (will receive new one if needed)
        if (layoutJson.objects) {
            layoutJson.objects = layoutJson.objects.filter(o => o.dataTag !== 'ambilight_bg');
        }

        // Relative URL Fix (Node has no base URL)
        const API_BASE = "http://127.0.0.1:5000";
        const fixUrl = (obj) => {
            if (!obj) return;
            if (obj.src && typeof obj.src === 'string' && obj.src.startsWith('/')) obj.src = API_BASE + obj.src;
            if (obj.fill && obj.fill.source && typeof obj.fill.source === 'string' && obj.fill.source.startsWith('/')) obj.fill.source = API_BASE + obj.fill.source;
            if (obj.stroke && obj.stroke.source && typeof obj.stroke.source === 'string' && obj.stroke.source.startsWith('/')) obj.stroke.source = API_BASE + obj.stroke.source;
            if (obj.source && typeof obj.source === 'string' && obj.source.startsWith('/')) obj.source = API_BASE + obj.source;
            if (obj.clipPath) fixUrl(obj.clipPath);
        };
        if (layoutJson.backgroundImage) fixUrl(layoutJson.backgroundImage);
        if (layoutJson.overlayImage) fixUrl(layoutJson.overlayImage);
        if (layoutJson.objects) {
            layoutJson.objects.forEach(obj => {
                fixUrl(obj);
                if (obj.objects) obj.objects.forEach(sub => fixUrl(sub));
            });
        }

        console.log("Loading layout into canvas...");
        try {
            await new Promise((resolve, reject) => {
                canvas.loadFromJSON(layoutJson, () => {
                    console.log("Canvas loaded successfully.");
                    resolve();
                }, (o, object) => {
                    // console.log("Reviver processing:", object.type);
                });
            });
        } catch (err) {
            console.error("Error loading JSON into canvas:", err);
            throw err;
        }

        // Enforce Resolution
        if (canvas.getWidth() !== baseWidth || canvas.getHeight() !== baseHeight) {
            canvas.setDimensions({ width: baseWidth, height: baseHeight });
        }

        const settings = layoutJson.custom_effects || {};
        const blockedAreas = settings.blocked_areas || [];
        // Merge with data-provided settings if any (not typical but possible)

        // 4. POPULATE DATA
        const imagePromises = [];
        const certDir = path.join(__dirname, 'certification');

        // Remove existing fade effects (will be re-applied)
        canvas.getObjects().filter(o => o.dataTag === 'fade_effect').forEach(o => canvas.remove(o));

        canvas.getObjects().forEach(obj => {
            if (!obj.dataTag) return;
            let val = undefined;

            switch (obj.dataTag) {
                case 'title':
                    // If image, we handle plain replacement logic or keep it if logo provided
                    // Logic handled in Logo/Backdrop section below
                    if (obj.type !== 'image') val = data.title;
                    break;
                case 'year': val = data.year; break;
                case 'rating':
                case 'rating_star':
                    let r = data.rating;
                    if (r && r !== 'N/A' && !isNaN(parseFloat(r))) r = parseFloat(r).toFixed(1);
                    else r = null;

                    if (obj.type === 'group') {
                        const t = obj.getObjects().find(o => o.type === 'i-text');
                        if (t) { t.set('text', r ? String(r) : ''); obj.addWithUpdate(); }
                        obj.set('visible', !!r);
                        val = undefined;
                    } else {
                        val = r ? (obj.dataTag === 'rating' ? `IMDb: ${r}` : r) : null;
                    }
                    break;
                case 'rating_val':
                    let rv = data.rating;
                    if (rv && rv !== 'N/A' && !isNaN(parseFloat(rv))) rv = parseFloat(rv).toFixed(1);
                    val = rv || null;
                    break;
                case 'overview':
                    val = data.overview;
                    if (obj.type === 'textbox') obj.fullMediaText = val || "";
                    break;
                case 'genres':
                    val = data.genres;
                    if (val && settings.genreLimit) {
                        const limit = parseInt(settings.genreLimit);
                        if (!isNaN(limit) && limit > 0) val = val.split(',').slice(0, limit).join(',');
                    }
                    break;
                case 'runtime':
                    val = data.runtime;
                    const rtCheck = String(val || "").toLowerCase().replace(/\s/g, '');
                    if (rtCheck === '0min' || rtCheck === '0') val = null;
                    break;
                case 'officialRating': val = data.officialRating; break;
                case 'provider_source':
                    let providerText = "";
                    let providerLogo = null;
                    let source = data.source || "Jellyfin";

                    // Logic based on provider
                    if (source === 'TMDB') {
                        providerText = "Now Trending on ";
                        providerLogo = "tmdblogo.png";
                    } else if (source === 'Trakt') {
                        providerText = "Now on my watchlist ";
                        providerLogo = "traktlogo.png";
                    } else if (['Sonarr', 'Radarr', 'Jellyseerr'].includes(source)) {
                        providerText = "Soon available on ";
                        providerLogo = "jellyfinlogo.png";
                    } else {
                        // Default fallback
                        providerText = "Now available on ";
                        if (source === 'Plex') providerLogo = "plexlogo.png";
                        else providerLogo = "jellyfinlogo.png";
                    }

                    if (providerLogo) {
                        const logoPath = path.join(__dirname, 'static', 'provider_logos', providerLogo);
                        const pLogo = new Promise(resolve => {
                            if (fs.existsSync(logoPath)) {
                                const imgData = fs.readFileSync(logoPath);
                                const ext = path.extname(logoPath).slice(1);
                                const src = `data:image/${ext};base64,${imgData.toString('base64')}`;
                                fabric.Image.fromURL(src, (img) => {
                                    if (img) {
                                        // Create Text
                                        // Use the properties of the original object (obj)
                                        let currentFont = obj.fontFamily || 'Roboto';
                                        let currentSize = obj.fontSize || 40;
                                        let currentFill = obj.fill || 'white';

                                        if (obj.type === 'group' && obj.getObjects) {
                                            const existingText = obj.getObjects().find(o => o.type === 'i-text' || o.type === 'text');
                                            if (existingText) {
                                                if (existingText.fontFamily) currentFont = existingText.fontFamily;
                                                if (existingText.fontSize) currentSize = existingText.fontSize;
                                                if (existingText.fill) currentFill = existingText.fill;
                                            }
                                        }

                                        const textObj = new fabric.IText(providerText, {
                                            fontFamily: currentFont,
                                            fontSize: currentSize,
                                            fill: currentFill,
                                            originY: 'center',
                                            originX: 'left',
                                            left: 0,
                                            top: 0
                                        });

                                        // Scale Logo to match Text Height + 20%
                                        // We use the calculated height of the text object
                                        const targetH = textObj.height * textObj.scaleY;
                                        img.scaleToHeight(targetH * 1.2);
                                        img.set({ originY: 'center', originX: 'left', left: textObj.getScaledWidth() + 15, top: 0 });

                                        // Group
                                        const group = new fabric.Group([textObj, img], {
                                            left: obj.left,
                                            top: obj.top,
                                            originX: obj.originX,
                                            originY: obj.originY,
                                            dataTag: 'provider_source',
                                            fontFamily: obj.fontFamily || 'Roboto', // Persist font in output
                                            scaleX: obj.scaleX,
                                            scaleY: obj.scaleY,
                                            angle: obj.angle,
                                            opacity: obj.opacity,
                                            selectable: false // Render task objects usually static
                                        });

                                        canvas.remove(obj);
                                        canvas.add(group);
                                    }
                                    resolve();
                                });
                            } else {
                                // Fallback if logo file missing
                                obj.set('text', providerText + source);
                                resolve();
                            }
                        });
                        imagePromises.push(pLogo);
                        val = undefined; // Handled by promise
                    } else {
                        val = providerText + source;
                    }
                    break;
                case 'certification':
                    const fname = getCertificationFilename(data.officialRating);
                    if (fname) {
                        const p = new Promise(resolve => {
                            const fpath = path.join(certDir, fname);
                            if (fs.existsSync(fpath)) {
                                const imgData = fs.readFileSync(fpath);
                                const ext = path.extname(fname).slice(1);
                                const src = `data:image/${ext};base64,${imgData.toString('base64')}`;
                                fabric.Image.fromURL(src, (img) => {
                                    if (img) {
                                        img.set({
                                            left: obj.left, top: obj.top,
                                            originX: obj.originX, originY: obj.originY,
                                            dataTag: 'certification'
                                        });
                                        img.scaleToHeight(obj.height * obj.scaleY);
                                        canvas.remove(obj);
                                        canvas.add(img);
                                    }
                                    resolve();
                                });
                            } else {
                                obj.set('visible', false);
                                resolve();
                            }
                        });
                        imagePromises.push(p);
                        // Ensure mask is applied
                        if (mainBg && mainBg.mask) {
                            // Check if mask is valid
                        }
                        val = undefined;
                    } else {
                        val = null;
                    }
                    break;
            }

            if (val !== undefined && obj.dataTag !== 'overview' && obj.dataTag !== 'background') {
                if (val === null || val === "" || val === "N/A") {
                    obj.set('visible', false);
                } else {
                    obj.set({ text: String(val), visible: true });
                }
            }

            if (obj.dataTag === 'overview' && obj.type === 'textbox') {
                if (!obj.fullMediaText && val) obj.fullMediaText = String(val);
                fitTextToContainer(canvas, obj);
            }
        });

        // 5. IMAGES (Backdrop & Logo)
        // Background
        mainBg = canvas.getObjects().find(o => o.dataTag === 'background');
        if (data.backdrop_url) {
            // Save the state and target dimensions of the old background, if it exists
            let oldState = null;
            if (mainBg) {
                oldState = {
                    left: mainBg.left,
                    top: mainBg.top,
                    flipX: mainBg.flipX,
                    flipY: mainBg.flipY,
                    originX: mainBg.originX,
                    originY: mainBg.originY,
                    // Calculate target dimensions instead of raw scale
                    targetWidth: mainBg.width * mainBg.scaleX,
                    targetHeight: mainBg.height * mainBg.scaleY
                    // DO NOT preserve clipPath - it's sized for placeholder, not actual image
                    // applyCustomEffects will generate fresh clipPath for actual dimensions
                };
            }

            canvas.getObjects().filter(o => o.dataTag === 'background').forEach(o => canvas.remove(o));
            await new Promise(resolve => {
                fabric.Image.fromURL(data.backdrop_url, (img) => {
                    if (img) {
                        if (oldState) {
                            // Calculate new scale to match the placeholder's rendered dimensions
                            const newScaleX = oldState.targetWidth / img.width;
                            const newScaleY = oldState.targetHeight / img.height;

                            img.set({
                                left: oldState.left,
                                top: oldState.top,
                                flipX: oldState.flipX,
                                flipY: oldState.flipY,
                                originX: oldState.originX,
                                originY: oldState.originY,
                                scaleX: newScaleX,
                                scaleY: newScaleY,
                                dataTag: 'background'
                                // DO NOT restore clipPath - fresh one will be generated for actual size
                            });
                        } else {
                            // Fallback to "cover" logic if no placeholder existed
                            let scale = Math.max(canvas.width / img.width, canvas.height / img.height);
                            img.set({
                                left: canvas.width / 2,
                                top: canvas.height / 2,
                                originX: 'center',
                                originY: 'center',
                                scaleX: scale,
                                scaleY: scale,
                                dataTag: 'background'
                            });
                        }
                        canvas.add(img);
                        canvas.sendToBack(img);
                        mainBg = img;
                    }
                    resolve();
                }, { crossOrigin: 'anonymous' });
            });
        }

        // Logo
        if (data.logo_url) {
            const titleObj = canvas.getObjects().find(o => o.dataTag === 'title');
            if (titleObj) {
                const oldState = { left: titleObj.left, top: titleObj.top, originX: titleObj.originX, originY: titleObj.originY, width: titleObj.width * titleObj.scaleX };
                canvas.remove(titleObj);

                // Allow logo auto fix proxy
                let loadUrl = data.logo_url;
                if (settings.logoAutoFix !== false && !loadUrl.includes('/api/proxy/image')) {
                    loadUrl = `${API_BASE}/api/proxy/image?url=${encodeURIComponent(data.logo_url)}`;
                }

                await new Promise(resolve => {
                    fabric.Image.fromURL(loadUrl, (img) => {
                        if (img) {
                            // --- SMART LOGO RESIZING (Ported from editor.js) ---
                            // 1. Define Scale Limits
                            // Use placeholder width as target width, but constrain height to avoid massive vertical logos
                            const baseMaxW = oldState.width;
                            const baseMaxH = canvas.height * 0.35; // Default safe height limit from editor.js

                            // 2. Check aspect ratio
                            const ratio = img.width / img.height;
                            let allowedHeight = baseMaxH;

                            // 3. Apply Ratio Constraints
                            if (ratio < 0.65) {
                                // Extremely Tall (e.g. "November"): Limit to 50% of max height
                                allowedHeight = baseMaxH * 0.50;
                            } else if (ratio < 1.2) {
                                // Square/Compact: Limit to 75% of max height
                                allowedHeight = baseMaxH * 0.75;
                            }
                            // Else: Wide logos can use full height

                            // 4. Calculate Scale
                            // Must fit within BOTH the width slot AND the calculated allowed height
                            let scale = Math.min(baseMaxW / img.width, allowedHeight / img.height);

                            // Alignment Correction
                            let newLeft = oldState.left;
                            const align = settings.tagAlignment || 'left';
                            const newW = img.width * scale;
                            // Simplified sticky logic
                            if (align === 'right') newLeft = (oldState.left + oldState.width) - newW;
                            else if (align === 'center') newLeft = (oldState.left + (oldState.width / 2)) - (newW / 2);

                            img.set({
                                left: newLeft, top: oldState.top, originX: oldState.originX, originY: oldState.originY,
                                scaleX: scale, scaleY: scale, dataTag: 'title',
                                logoAutoFix: titleObj.logoAutoFix // Propagate
                            });
                            canvas.add(img);
                            canvas.bringToFront(img);
                        }
                        resolve();
                    }, { crossOrigin: 'anonymous' });
                });
            }
        } else {
            // Fallback to text title if logo missing but object was image
            const titleObj = canvas.getObjects().find(o => o.dataTag === 'title');
            if (titleObj && titleObj.type === 'image') {
                canvas.remove(titleObj);
                const fontSize = baseWidth > 3000 ? 120 : 80;
                const placeholderWidth = titleObj.width * titleObj.scaleX;
                const align = settings.tagAlignment || 'left';

                const text = new fabric.Textbox(data.title || "Title", {
                    left: titleObj.left, top: titleObj.top,
                    originX: titleObj.originX, originY: titleObj.originY,
                    width: canvas.width * 0.5,
                    fontFamily: 'Roboto', fontSize: fontSize,
                    fill: 'white', dataTag: 'title',
                    textAlign: align,
                    splitByGrapheme: false
                });

                // Shrink width to fit actual text (improves alignment)
                let maxLineW = 0;
                if (text._textLines && text._textLines.length > 0) {
                    for (let i = 0; i < text._textLines.length; i++) {
                        const w = text.getLineWidth(i);
                        if (w > maxLineW) maxLineW = w;
                    }
                    if (maxLineW > 0) {
                        text.set({ width: maxLineW + 40 }); // buffer
                    }
                }

                // Recalculate Position based on alignment (mirrors image logic)
                // We need to shift the box so it visual aligns correctly within the original placeholder area
                const textAlign = settings.tagAlignment || 'left';
                if (textAlign === 'right') {
                    text.set({ left: (titleObj.left + placeholderWidth) - text.width });
                } else if (textAlign === 'center') {
                    text.set({ left: (titleObj.left + (placeholderWidth / 2)) - (text.width / 2) });
                }

                canvas.add(text);
            }
        }

        if (imagePromises.length > 0) await Promise.all(imagePromises);

        // 6. LAYOUT & EFFECTS
        try {
            updateVerticalLayout(canvas, settings, blockedAreas);
        } catch (e) {
            console.warn("Layout update failed in pre-pass:", e.message);
        }

        // 7. AMBILIGHT (Separate Output)
        if (settings.backgroundMode === 'ambilight' && mainBg) {
            // Ensure canvas BG is transparent
            canvas.backgroundColor = null;

            console.log("Generating Ambilight background...");

            // OPTIMIZED AMBILIGHT GENERATION
            // Downscale full image to 1/4 size, apply heavy blur, then upscale
            // The heavy blur naturally emphasizes edge colors over center details

            // 1. Calculate dimensions (1/4 of total size)
            const smallW = baseWidth / 4;
            const smallH = baseHeight / 4;

            // 2. Render backdrop to downscaled canvas
            const bgScaleX = mainBg.scaleX || 1;
            const bgScaleY = mainBg.scaleY || 1;
            const bgWidth = Math.floor(mainBg.width * bgScaleX);
            const bgHeight = Math.floor(mainBg.height * bgScaleY);

            const bgImg = await canvasModule.loadImage(mainBg._element.src);

            // Create small canvas for downscaled render
            const smallCanvas = canvasModule.createCanvas(smallW, smallH);
            const smallCtx = smallCanvas.getContext('2d');
            smallCtx.drawImage(bgImg, 0, 0, smallW, smallH);

            // 3. Create filtering canvas
            const filterCanvas = canvasModule.createCanvas(smallW, smallH);
            const fCtx = filterCanvas.getContext('2d');
            fCtx.drawImage(smallCanvas, 0, 0);

            // 4. Determine Brightness correction
            // Logic must match editor.js: brightness = 0.4 + (val / 100)
            let bVal = parseInt(settings.bgBrightness);
            if (isNaN(bVal)) bVal = 20;
            const brightness = 0.4 + (bVal / 100);

            // 5. Apply "Massive" Blur MANUALLY
            // Node-canvas often does not support 'filter', so we must blur manually.
            // We use a simplified StackBlur algorithm for high performance.

            // 5. Apply blur to the edge-sampled canvas
            fastBlur(fCtx, smallW, smallH, 60);

            // 6. Apply Brightness manually (since filter is also unsupported)
            if (brightness !== 1) {
                const imageData = fCtx.getImageData(0, 0, smallW, smallH);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    data[i] = Math.min(255, data[i] * brightness);
                    data[i + 1] = Math.min(255, data[i + 1] * brightness);
                    data[i + 2] = Math.min(255, data[i + 2] * brightness);
                }
                fCtx.putImageData(imageData, 0, 0);
            }

            // 7. Load filtered image back to Fabric
            const smallData = filterCanvas.toDataURL();

            const blurredImg = await new Promise(resolve => {
                fabric.Image.fromURL(smallData, (img) => {
                    if (!img) { resolve(null); return; }

                    // Scale to fill output
                    const scale = Math.max(baseWidth / img.width, baseHeight / img.height);
                    img.set({
                        originX: 'center', originY: 'center',
                        left: baseWidth / 2, top: baseHeight / 2,
                        scaleX: scale, scaleY: scale
                    });

                    resolve(img);
                });
            });

            // SIMPLIFIED BOX BLUR (Multiple passes = Gaussian approximation)
            function fastBlur(ctx, width, height, radius) {
                if (radius < 1) return;
                // 3 passes of box blur approximates gaussian
                boxBlurCanvasRGBA(ctx, width, height, radius);
                boxBlurCanvasRGBA(ctx, width, height, radius);
                boxBlurCanvasRGBA(ctx, width, height, radius);
            }

            function boxBlurCanvasRGBA(ctx, width, height, radius) {
                const imageData = ctx.getImageData(0, 0, width, height);
                const pixels = imageData.data;
                const temp = new Uint8ClampedArray(pixels.length);

                // Horizontal
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        let r = 0, g = 0, b = 0, a = 0, count = 0;
                        for (let i = -radius; i <= radius; i++) {
                            const nx = Math.min(width - 1, Math.max(0, x + i));
                            const idx = (y * width + nx) * 4;
                            r += pixels[idx];
                            g += pixels[idx + 1];
                            b += pixels[idx + 2];
                            a += pixels[idx + 3];
                            count++;
                        }
                        const tidx = (y * width + x) * 4;
                        temp[tidx] = r / count;
                        temp[tidx + 1] = g / count;
                        temp[tidx + 2] = b / count;
                        temp[tidx + 3] = a / count;
                    }
                }

                // Vertical
                for (let x = 0; x < width; x++) {
                    for (let y = 0; y < height; y++) {
                        let r = 0, g = 0, b = 0, a = 0, count = 0;
                        for (let i = -radius; i <= radius; i++) {
                            const ny = Math.min(height - 1, Math.max(0, y + i));
                            const idx = (ny * width + x) * 4;
                            r += temp[idx];
                            g += temp[idx + 1];
                            b += temp[idx + 2];
                            a += temp[idx + 3];
                            count++;
                        }
                        const idx = (y * width + x) * 4;
                        pixels[idx] = r / count;
                        pixels[idx + 1] = g / count;
                        pixels[idx + 2] = b / count;
                        pixels[idx + 3] = a / count;
                    }
                }

                ctx.putImageData(imageData, 0, 0);
            }
            // Render Ambilight Output to File
            if (blurredImg) {
                const ambiCanvas = new fabric.StaticCanvas(null, { width: baseWidth, height: baseHeight });
                ambiCanvas.add(blurredImg);
                ambiCanvas.renderAll();

                const ambilightOutPath = `${outputBasePath}.ambilight.jpg`;
                await new Promise((resolve, reject) => {
                    const outStream = fs.createWriteStream(ambilightOutPath);
                    const canvasStream = ambiCanvas.createJPEGStream({ quality: 0.8 });
                    canvasStream.pipe(outStream);
                    outStream.on('finish', resolve);
                    outStream.on('error', reject);
                });
            }

            // Add blurred object to main canvas
            if (blurredImg) {
                blurredImg.set({
                    dataTag: 'ambilight_bg'
                });
                canvas.add(blurredImg);
                canvas.sendToBack(blurredImg);
            }
        }

        // Apply Custom Effects (Ambilight Mask or Fades)
        await applyCustomEffects(canvas, settings, mainBg);

        // 8. RENDER MAIN OUTPUT (JPEG)
        console.log("Updating vertical layout for final render...");
        updateVerticalLayout(canvas, settings, blockedAreas);
        console.log("Rendering all...");
        canvas.renderAll();

        const mainOutPath = `${outputBasePath}.jpg`;
        const outStreamMain = fs.createWriteStream(mainOutPath);
        const canvasStreamMain = canvas.createJPEGStream({ quality: 0.9 });
        canvasStreamMain.pipe(outStreamMain);
        await new Promise(r => outStreamMain.on('finish', r));
        console.log("Main JPEG saved.");

        // 9. SAVE JSON METADATA
        console.log("Generating JSON output...");

        let jsonOutput;
        const propertiesToInclude = ['dataTag', 'fullMediaText', 'selectable', 'evented', 'lockScalingY', 'splitByGrapheme', 'fixedHeight', 'editable', 'matchHeight', 'autoBackgroundColor', 'textureId', 'textureScale', 'textureRotation', 'textureOpacity', 'logoAutoFix', 'crossOrigin', 'clipPath'];

        // Fix Ambilight Object for JSON (Link to file instead of embedding Base64)
        // Matches client-side batch.js behavior and prevents huge JSON files
        const ambiObj = canvas.getObjects().find(o => o.dataTag === 'ambilight_bg');
        if (ambiObj && settings.backgroundMode === 'ambilight') {
            const relativeAmbiPath = `${path.basename(outputBasePath)}.ambilight.jpg`;
            // We strip the data URL and point to the file we just saved
            // This ensures the Gallery Editor loads the external file
            // Setting 'src' directly on the object ensures toJSON uses this string
            ambiObj.set({
                src: relativeAmbiPath,
                crossOrigin: 'anonymous'
            });
        }

        try {
            jsonOutput = canvas.toJSON(propertiesToInclude);
        } catch (err) {
            console.error("[WARN] Standard canvas.toJSON failed. Attempting safe serialization...", err.message);
            jsonOutput = {
                version: canvas.version,
                objects: canvas.getObjects().map(obj => {
                    try {
                        return obj.toObject(propertiesToInclude);
                    } catch (e) {
                        console.error(`[ERROR] Skipping object serialization for ${obj.type} (Tag: ${obj.dataTag}):`, e.message);
                        return null;
                    }
                }).filter(o => o !== null),
                width: canvas.width,
                height: canvas.height,
                backgroundImage: canvas.backgroundImage ? canvas.backgroundImage.toObject(propertiesToInclude) : null,
                overlayImage: canvas.overlayImage ? canvas.overlayImage.toObject(propertiesToInclude) : null
            };
        }

        jsonOutput.custom_effects = settings;
        // Inject metadata to match batch / gallery editor requirements
        jsonOutput.metadata = data;
        console.log("JSON generated.");

        const metaPath = `${outputBasePath}.json`;
        fs.writeFileSync(metaPath, JSON.stringify(jsonOutput, null, 2));

        console.log(`[SUCCESS] Rendered: ${mainOutPath}`);

    } catch (e) {
        console.error("FATAL: Error during render:", e);
        process.exit(1);
    }
})();
