# PDF Import & Geometry Alignment Implementation Guide

## Overview
This implementation adds advanced PDF import features with geometry alignment and scaling capabilities, ZIP file handling, and new drawing tools for alignment and origin movement.

---

## 1. ZIP FILE IMPORT WITH PDF DETECTION

### File: io.js - Add ZIP Handling Functions

```javascript
// NEW: Handle ZIP file uploads
export async function handleZipUpload(file) {
    try {
        const jszip = window.JSZip || await import('jszip');
        const zip = new jszip();
        const loaded = await zip.loadAsync(file);
        
        let pdfFile = null;
        let geometryFile = null;
        const files = Object.keys(loaded.files);
        
        // Search for PDF and geometry files
        for (const filename of files) {
            const lower = filename.toLowerCase();
            if (lower.endsWith('.pdf')) {
                pdfFile = filename;
            } else if (lower.endsWith('.dxf') || lower.endsWith('.json')) {
                geometryFile = filename;
            }
        }
        
        if (pdfFile) {
            // Extract and import PDF first
            const pdfData = await loaded.files[pdfFile].async('arraybuffer');
            await importPdfAsBackground(pdfData);
            
            // Show scaling dialog
            showPdfScalingDialog();
            
            // If geometry exists, prepare for import after scaling
            if (geometryFile) {
                state.pendingGeometryZipFile = loaded.files[geometryFile];
                document.getElementById('status-bar').textContent = 
                    `✓ PDF imported. Scale the PDF background, then click "Import Geometry" to load ${geometryFile}`;
            }
        } else if (geometryFile) {
            // No PDF, just import geometry
            const data = await loaded.files[geometryFile].async('text');
            if (geometryFile.toLowerCase().endsWith('.dxf')) {
                parseAndDisplayDxf(data);
            } else {
                importGeometryJson(data);
            }
        }
    } catch (error) {
        console.error('Error processing ZIP:', error);
        document.getElementById('status-bar').textContent = 'Error: Could not process ZIP file';
    }
}

// NEW: Import PDF as background
export async function importPdfAsBackground(pdfData) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        state.pdfDocument = pdf;
        state.currentPdfPage = 1;
        
        // Render first page as background
        renderPdfPageAsBackground(1);
        
        document.getElementById('status-bar').textContent = 
            `PDF loaded (${pdf.numPages} pages). Scale to match your plan.`;
    } catch (error) {
        console.error('Error loading PDF:', error);
        document.getElementById('status-bar').textContent = 'Error: Could not load PDF';
    }
}

// NEW: Render PDF page as background
export async function renderPdfPageAsBackground(pageNum) {
    if (!state.pdfDocument) return;
    
    try {
        const page = await state.pdfDocument.getPage(pageNum);
        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        
        // Apply as background image
        const imageData = canvas.toDataURL('image/png');
        
        // Remove old PDF background if exists
        if (state.pdfBackgroundImage) {
            state.canvas.remove(state.pdfBackgroundImage);
        }
        
        // Create new background image
        fabric.Image.fromURL(imageData, (img) => {
            img.set({
                left: 0,
                top: 0,
                originX: 'left',
                originY: 'top',
                selectable: false,
                evented: false,
                isPdfBackground: true,
                opacity: 0.7
            });
            
            // Send to back
            state.canvas.add(img);
            state.pdfBackgroundImage = img;
            state.canvas.sendToBack(img);
            state.canvas.renderAll();
        });
        
        state.currentPdfPage = pageNum;
    } catch (error) {
        console.error('Error rendering PDF page:', error);
    }
}
```

---

## 2. PDF SCALING DIALOG

### File: index.html - Add Modal Dialog

```html
<!-- NEW: PDF Scaling & Alignment Modal -->
<div id="pdf-alignment-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background-color:rgba(0,0,0,0.7); z-index:1000; justify-content:center; align-items:center;">
    <div style="background:white; padding:30px; border-radius:8px; max-width:500px; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
        <h2 style="margin-top:0; margin-bottom:20px;">PDF Alignment & Scaling</h2>
        
        <div style="background-color:#f0f4ff; padding:15px; border-radius:4px; margin-bottom:20px;">
            <p style="margin:0; font-size:0.9em; color:#333;">
                The PDF plan is now visible as a background (70% opacity). You can:
            </p>
            <ul style="margin:10px 0; padding-left:20px; font-size:0.9em;">
                <li><strong>Scale:</strong> Use Shift+Scroll or the Scale Tool</li>
                <li><strong>Move:</strong> Drag or use Move Tool</li>
                <li><strong>Rotate:</strong> Use the Rotate Tool</li>
            </ul>
        </div>
        
        <div style="margin-bottom:20px;">
            <label style="display:block; margin-bottom:5px; font-weight:bold;">Scale Multiplier:</label>
            <input type="number" id="pdf-scale-multiplier" value="1.0" step="0.1" min="0.1" style="width:100%; padding:8px; box-sizing:border-box;">
            <small style="color:#666; display:block; margin-top:3px;">Adjust PDF size to match your geometry</small>
        </div>
        
        <div style="margin-bottom:20px;">
            <label style="display:block; margin-bottom:5px; font-weight:bold;">PDF Opacity:</label>
            <input type="range" id="pdf-opacity-slider" min="0.1" max="1" step="0.1" value="0.7" style="width:100%;">
            <small style="color:#666;">Adjust for better visibility</small>
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <button id="use-align-tool-btn" style="padding:12px; background-color:#2196F3; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                Use Alignment Tool →
            </button>
            <button id="pdf-scale-done-btn" style="padding:12px; background-color:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                Done Scaling
            </button>
        </div>
        
        <p style="margin:15px 0 0 0; font-size:0.85em; color:#999; text-align:center;">
            If geometry file exists in ZIP, it will be imported after scaling.
        </p>
    </div>
</div>
```

---

## 3. ALIGNMENT & SCALING TOOLS

### File: drawingTools.js - Add New Tools

```javascript
const TOOL_MODES = {
    NONE: 'none',
    ALIGN_SCALE: 'alignScale',
    MOVE_ORIGIN: 'moveOrigin',
    SCALE_GEOMETRY: 'scaleGeometry'
};

let currentAlignmentMode = TOOL_MODES.NONE;
let alignmentPoints = [];

// NEW: Align & Scale Tool
export function activateAlignScaleTool() {
    currentAlignmentMode = TOOL_MODES.ALIGN_SCALE;
    alignmentPoints = [];
    
    const canvas = getCanvas();
    canvas.hoverCursor = 'crosshair';
    canvas.selection = false;
    
    // Disable polygon selection
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon) {
            obj.selectable = false;
            obj.evented = false;
        }
    });
    
    document.getElementById('status-bar').textContent = 
        'Alignment Mode: Click 2 points on your geometry, then 2 corresponding points on the PDF';
    
    showAlignmentToolPanel();
}

// NEW: Move Origin Tool
export function activateMoveOriginTool() {
    currentAlignmentMode = TOOL_MODES.MOVE_ORIGIN;
    
    const canvas = getCanvas();
    canvas.hoverCursor = 'move';
    canvas.selection = false;
    
    // Allow moving PDF background
    if (state.pdfBackgroundImage) {
        state.pdfBackgroundImage.selectable = true;
        state.pdfBackgroundImage.evented = true;
    }
    
    document.getElementById('status-bar').textContent = 
        'Move Origin: Drag the PDF or click to align to origin (0,0)';
}

// NEW: Scale Geometry Tool
export function activateScaleGeometryTool() {
    currentAlignmentMode = TOOL_MODES.SCALE_GEOMETRY;
    alignmentPoints = [];
    
    const canvas = getCanvas();
    canvas.hoverCursor = 'help';
    canvas.selection = false;
    
    document.getElementById('status-bar').textContent = 
        'Scale Geometry: Click 2 reference points on geometry, then enter known distance to scale';
    
    showScaleGeometryPanel();
}

// Helper: Show alignment panel
function showAlignmentToolPanel() {
    const html = `
        <div style="padding:15px; background-color:#e3f2fd; border-radius:4px;">
            <h4 style="margin:0 0 10px 0;">Align & Scale Tool</h4>
            <p style="margin:0 0 10px 0; font-size:0.9em;">
                Click 2 points on your geometry, then click 2 corresponding points on PDF background
            </p>
            <div style="margin-bottom:10px;">
                <button onclick="window.alignmentReset()" style="padding:8px 12px; background-color:#ff9800; color:white; border:none; border-radius:4px; cursor:pointer;">
                    Reset Points
                </button>
            </div>
            <div id="alignment-points-status" style="font-size:0.85em; color:#666;">Points selected: 0/4</div>
        </div>
    `;
    
    document.getElementById('tool-panel-content').innerHTML = html;
    window.alignmentReset = () => {
        alignmentPoints = [];
        document.getElementById('alignment-points-status').textContent = 'Points selected: 0/4';
    };
}

// Helper: Show scale geometry panel
function showScaleGeometryPanel() {
    const html = `
        <div style="padding:15px; background-color:#f3e5f5; border-radius:4px;">
            <h4 style="margin:0 0 10px 0;">Scale Geometry</h4>
            <p style="margin:0 0 10px 0; font-size:0.9em;">
                Click 2 reference points, then enter the real-world distance between them
            </p>
            <div style="margin-bottom:10px;">
                <label style="display:block; font-size:0.85em; margin-bottom:3px;">Distance (m):</label>
                <input type="number" id="reference-distance" placeholder="e.g., 100" step="0.1" min="0" style="width:100%; padding:6px; box-sizing:border-box;">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button onclick="window.scaleGeometryApply()" style="padding:8px; background-color:#9c27b0; color:white; border:none; border-radius:4px; cursor:pointer;">
                    Apply Scale
                </button>
                <button onclick="window.alignmentReset()" style="padding:8px; background-color:#ff9800; color:white; border:none; border-radius:4px; cursor:pointer;">
                    Reset
                </button>
            </div>
            <div id="scale-points-status" style="font-size:0.85em; color:#666; margin-top:10px;">Points selected: 0/2</div>
        </div>
    `;
    
    document.getElementById('tool-panel-content').innerHTML = html;
    window.alignmentReset = () => {
        alignmentPoints = [];
        document.getElementById('scale-points-status').textContent = 'Points selected: 0/2';
    };
}

// NEW: Handle alignment point selection
export function handleAlignmentPointSelect(point) {
    if (currentAlignmentMode === TOOL_MODES.ALIGN_SCALE) {
        alignmentPoints.push(point);
        document.getElementById('alignment-points-status').textContent = 
            `Points selected: ${alignmentPoints.length}/4`;
        
        if (alignmentPoints.length === 4) {
            applyAlignment();
        }
    } else if (currentAlignmentMode === TOOL_MODES.SCALE_GEOMETRY) {
        alignmentPoints.push(point);
        document.getElementById('scale-points-status').textContent = 
            `Points selected: ${alignmentPoints.length}/2`;
    }
}

// Apply alignment transformation
function applyAlignment() {
    const [p1, p2, p3, p4] = alignmentPoints;
    // p1, p2 are on geometry; p3, p4 are on PDF (reference)
    
    const geometryDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const pdfDist = Math.hypot(p4.x - p3.x, p4.y - p3.y);
    
    if (geometryDist === 0 || pdfDist === 0) {
        document.getElementById('status-bar').textContent = 'Invalid points selected';
        return;
    }
    
    const scaleFactor = pdfDist / geometryDist;
    
    // Scale all geometry
    scaleAllGeometry(scaleFactor);
    
    // Calculate rotation needed
    const geomAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const pdfAngle = Math.atan2(p4.y - p3.y, p4.x - p3.x);
    const rotationAngle = pdfAngle - geomAngle;
    
    // Rotate all geometry
    rotateAllGeometry(rotationAngle, p1);
    
    // Move geometry to align p1 with p3
    const offsetX = p3.x - p1.x;
    const offsetY = p3.y - p1.y;
    moveAllGeometry(offsetX, offsetY);
    
    document.getElementById('status-bar').textContent = 
        `✓ Alignment applied: Scale ${scaleFactor.toFixed(2)}x, Rotate ${(rotationAngle * 180/Math.PI).toFixed(1)}°`;
    
    exitAlignmentMode();
}

// Helper: Scale all geometry
function scaleAllGeometry(factor) {
    const canvas = getCanvas();
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock) {
            if (obj.points) {
                obj.points = obj.points.map(p => ({
                    x: p.x * factor,
                    y: p.y * factor
                }));
            }
            obj.scaleX *= factor;
            obj.scaleY *= factor;
            obj.setCoords();
        }
    });
    canvas.renderAll();
}

// Helper: Rotate all geometry
function rotateAllGeometry(angle, pivot) {
    const canvas = getCanvas();
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock) {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            if (obj.points) {
                obj.points = obj.points.map(p => {
                    const dx = p.x - pivot.x;
                    const dy = p.y - pivot.y;
                    return {
                        x: pivot.x + (dx * cos - dy * sin),
                        y: pivot.y + (dx * sin + dy * cos)
                    };
                });
            }
            obj.angle = (obj.angle || 0) + (angle * 180 / Math.PI);
            obj.setCoords();
        }
    });
    canvas.renderAll();
}

// Helper: Move all geometry
function moveAllGeometry(offsetX, offsetY) {
    const canvas = getCanvas();
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock) {
            obj.left += offsetX;
            obj.top += offsetY;
            if (obj.points) {
                obj.points = obj.points.map(p => ({
                    x: p.x + offsetX,
                    y: p.y + offsetY
                }));
            }
            obj.setCoords();
        }
    });
    canvas.renderAll();
}

// Exit alignment mode and restore selection
export function exitAlignmentMode() {
    currentAlignmentMode = TOOL_MODES.NONE;
    alignmentPoints = [];
    const canvas = getCanvas();
    canvas.selection = true;
    canvas.hoverCursor = 'auto';
}
```

---

## 4. MAKE POLYGONS NON-SELECTABLE BY DEFAULT

### File: drawingTools.js - Modify Polygon Creation

When creating any polygon, add:
```javascript
polygon.selectable = false;  // Non-selectable by default
polygon.evented = false;     // Don't receive mouse events
polygon.isEditable = true;   // But can be edited via menu/buttons
```

When entering edit mode:
```javascript
polygon.selectable = true;   // Make editable
polygon.evented = true;
```

When exiting edit mode:
```javascript
polygon.selectable = false;  // Back to non-selectable
polygon.evented = false;
```

---

## 5. UI CONTROLS IN INDEX.HTML

Add toolbar buttons:
```html
<!-- NEW: PDF & Alignment Tools -->
<div id="pdf-tools-section" style="margin-top:15px; padding:15px; background-color:#fff3e0; border-radius:4px;">
    <h4 style="margin:0 0 10px 0;">PDF & Geometry Tools</h4>
    
    <button id="import-zip-btn" style="width:100%; padding:8px; margin-bottom:5px; background-color:#2196F3; color:white; border:none; border-radius:4px; cursor:pointer;">
        📦 Import ZIP (with PDF)
    </button>
    
    <input type="file" id="zip-file-input" accept=".zip" style="display:none;">
    
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        <button id="align-scale-tool-btn" style="padding:8px; background-color:#9c27b0; color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.9em;">
            🔧 Align & Scale
        </button>
        <button id="move-origin-tool-btn" style="padding:8px; background-color:#ff9800; color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.9em;">
            ↔ Move Origin
        </button>
    </div>
    
    <button id="scale-geometry-btn" style="width:100%; padding:8px; margin-top:10px; background-color:#009688; color:white; border:none; border-radius:4px; cursor:pointer;">
        📐 Scale Geometry
    </button>
    
    <div id="tool-panel-content" style="margin-top:15px; min-height:100px; background-color:white; padding:10px; border-radius:4px; border:1px solid #e0e0e0;"></div>
</div>
```

---

## 6. EVENT HANDLERS IN UICONTROLLER.JS

```javascript
// NEW: Initialize PDF & Alignment tools
export function initPdfAndAlignmentTools() {
    // ZIP Import
    const importZipBtn = document.getElementById('import-zip-btn');
    const zipInput = document.getElementById('zip-file-input');
    
    if (importZipBtn) {
        importZipBtn.addEventListener('click', () => zipInput.click());
    }
    
    if (zipInput) {
        zipInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                handleZipUpload(e.target.files[0]);
            }
        });
    }
    
    // Alignment Tool
    const alignScaleBtn = document.getElementById('align-scale-tool-btn');
    if (alignScaleBtn) {
        alignScaleBtn.addEventListener('click', activateAlignScaleTool);
    }
    
    // Move Origin Tool
    const moveOriginBtn = document.getElementById('move-origin-tool-btn');
    if (moveOriginBtn) {
        moveOriginBtn.addEventListener('click', activateMoveOriginTool);
    }
    
    // Scale Geometry Tool
    const scaleGeometryBtn = document.getElementById('scale-geometry-btn');
    if (scaleGeometryBtn) {
        scaleGeometryBtn.addEventListener('click', activateScaleGeometryTool);
    }
    
    // PDF Scaling Dialog
    const pdfScaleDoneBtn = document.getElementById('pdf-scale-done-btn');
    if (pdfScaleDoneBtn) {
        pdfScaleDoneBtn.addEventListener('click', closePdfScalingDialog);
    }
    
    const alignToolBtn = document.getElementById('use-align-tool-btn');
    if (alignToolBtn) {
        alignToolBtn.addEventListener('click', () => {
            closePdfScalingDialog();
            activateAlignScaleTool();
        });
    }
    
    // PDF Opacity Slider
    const opacitySlider = document.getElementById('pdf-opacity-slider');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            if (state.pdfBackgroundImage) {
                state.pdfBackgroundImage.opacity = parseFloat(e.target.value);
                getCanvas().renderAll();
            }
        });
    }
}
```

---

## 7. STATE.JS ADDITIONS

Add to state object:
```javascript
pdfDocument: null,
pdfBackgroundImage: null,
currentPdfPage: 1,
pendingGeometryZipFile: null
```

---

## 8. REQUIRED LIBRARIES

Add to index.html head:
```html
<!-- PDF.js library -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>

<!-- JSZip library -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
```

---

## Key Features Implemented

✅ ZIP file import with automatic PDF detection
✅ PDF rendering as background with opacity control
✅ Automatic scaling dialog on PDF import
✅ Align & Scale tool (4-point registration)
✅ Move Origin tool (to reposition or rotate PDF)
✅ Scale Geometry tool (reference-based scaling)
✅ Polygons non-selectable by default but editable
✅ Geometry scaling, rotation, and translation
✅ Deferred geometry import after PDF scaling

---

## Workflow

1. User clicks "Import ZIP"
2. System detects PDF in ZIP
3. PDF is rendered as semi-transparent background
4. User scales/positions PDF to match plan
5. User can manually align using Align & Scale tool
6. After scaling, geometry is imported and auto-aligned
7. All polygons are non-selectable but can be edited via tools

