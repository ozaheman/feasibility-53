//--- START OF FILE io.js ---

// MODULE 11: IO (io.js equivalent)
// =====================================================================
import { state, resetState, setScale, rehydrateProgram } from './state.js';
import { handleFinishPolygon } from './eventHandlers.js';
import { zoomToObject, setCanvasBackground, renderPdfToBackground } from './canvasController.js';
import { updateUI } from './uiController.js';
import { PROJECT_PROGRAMS, PREDEFINED_BLOCKS, BLOCK_CATEGORY_COLORS, DUBAI_LOCATIONS, MARKET_RATE_PROPERTY_TYPES } from './config.js';
import { f } from './utils.js';
import { placeServiceBlock, createCompositeGroup } from './drawingTools.js';

export function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}
function formatXML(xml) {
    let formatted = '', indent = '';
    const tab = '  ';
    xml.split(/>\s*</).forEach(node => {
        if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
        formatted += indent + '<' + node + '>\r\n';
        if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab;
    });
    return formatted.substring(1, formatted.length - 3);
}

const ACI_COLORS = [
    '#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff',
    '#808080', '#c0c0c0', '#fe0000', '#fe7f7f', '#aaa400', '#dfdb7b', '#00ae00', '#7fd67f',
    '#00aeae', '#7fd6d6', '#0000ae', '#7f7fd6', '#ae00ae', '#d67fd6', '#fe0000', '#fe7f7f'
];

function getEntityColor(entity, dxfData) {
    if (entity.color !== undefined) {
        return ACI_COLORS[entity.color] || '#00ffff';
    }
    const layer = dxfData.tables?.layer?.layers[entity.layer];
    if (layer && layer.color !== undefined) {
        return ACI_COLORS[layer.color] || '#00ffff';
    }
    return '#00ffff';
}

function parseAndDisplayDxf(dxfText, makeSelectable = false) {
    try {
        const parser = new DxfParser();
        const dxf = parser.parseSync(dxfText);
        if (!dxf || !dxf.entities || dxf.entities.length === 0) { throw new Error("No entities found in DXF file."); }

        if (state.dxfOverlayGroup) state.canvas.remove(state.dxfOverlayGroup);
        state.dxfLayers = {};

        const fabricObjects = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Pass 1: Collect points and define bounding box
        dxf.entities.forEach(entity => {
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE' || entity.type === 'LINE') {
                const points = [];
                if (entity.type === 'LINE') {
                    points.push({ x: entity.vertices[0].x, y: -entity.vertices[0].y });
                    points.push({ x: entity.vertices[1].x, y: -entity.vertices[1].y });
                } else {
                    entity.vertices.forEach(v => points.push({ x: v.x, y: -v.y }));
                }
                points.forEach(p => {
                    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                });
            }
        });

        const dxfWidth = maxX - minX;
        const dxfHeight = maxY - minY;
        if (dxfWidth === 0 || dxfHeight === 0) return;

        // Auto-scaling to fit canvas (approx 80% of canvas)
        const canvasWidth = state.canvas.getWidth();
        const canvasHeight = state.canvas.getHeight();
        const padding = 50;
        const scaleX = (canvasWidth - padding * 2) / dxfWidth;
        const scaleY = (canvasHeight - padding * 2) / dxfHeight;
        const autoScale = Math.min(scaleX, scaleY, 1.0);

        // Pass 2: Create Fabric objects and group by layers
        dxf.entities.forEach(entity => {
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE' || entity.type === 'LINE') {
                const points = [];
                if (entity.type === 'LINE') {
                    points.push({ x: (entity.vertices[0].x - minX) * autoScale, y: (-entity.vertices[0].y - minY) * autoScale });
                    points.push({ x: (entity.vertices[1].x - minX) * autoScale, y: (-entity.vertices[1].y - minY) * autoScale });
                } else {
                    entity.vertices.forEach(v => points.push({ x: (v.x - minX) * autoScale, y: (-v.y - minY) * autoScale }));
                }

                const layerName = entity.layer || '0';
                if (!state.dxfLayers[layerName]) {
                    state.dxfLayers[layerName] = {
                        name: layerName,
                        color: getEntityColor(entity, dxf),
                        thickness: 1,
                        visible: true,
                        objects: []
                    };
                }

                const poly = new fabric.Polyline(points, {
                    fill: 'transparent',
                    stroke: state.dxfLayers[layerName].color,
                    strokeWidth: 1,
                    objectCaching: false,
                    strokeUniform: true,
                    selectable: true,
                    evented: true,
                    isImportedGeometry: true,
                    layerName: layerName
                });

                state.dxfLayers[layerName].objects.push(poly);
                fabricObjects.push(poly);
            }
        });

        const group = new fabric.Group(fabricObjects, {
            left: padding,
            top: padding,
            originX: 'left',
            originY: 'top',
            isDxfOverlay: true,
            selectable: true,
            evented: true,
            subTargetCheck: true,
            lockScalingFlip: true,
            hasRotatingPoint: true
        });

        state.dxfOverlayGroup = group;
        state.canvas.add(group);
        state.canvas.centerObject(group);
        group.setCoords();

        state.canvas.renderAll();
        // Automatically set background to black on import
        state.canvas.setBackgroundColor('black', state.canvas.renderAll.bind(state.canvas));
        const bgInput = document.getElementById('dxf-bg-color');
        if (bgInput) bgInput.value = '#000000';

        updateUI();
        document.getElementById('status-bar').textContent = 'DXF imported. Manage layers for detailed editing.';

    } catch (err) {
        console.error('Error parsing DXF file:', err);
        document.getElementById('status-bar').textContent = 'Could not parse the DXF file. Please ensure it is a valid DXF format.';
    }
}

export function updateDxfLayerProperty(layerName, property, value) {
    const layer = state.dxfLayers[layerName];
    if (!layer) return;

    if (property === 'visible') {
        layer.visible = value;
        layer.objects.forEach(obj => obj.set('visible', value));
    } else if (property === 'color') {
        layer.color = value;
        layer.objects.forEach(obj => obj.set('stroke', value));
    } else if (property === 'thickness') {
        layer.thickness = parseFloat(value);
        layer.objects.forEach(obj => obj.set('strokeWidth', layer.thickness));
    } else if (property === 'name') {
        layer.name = value;
    }

    state.canvas.renderAll();
}

export function handleDxfUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        state.originalDxfContent = event.target.result; // Store raw text
        parseAndDisplayDxf(state.originalDxfContent);
    };
    reader.readAsText(file);
}
export function updateDxfStrokeWidth() {
    if (!state.dxfOverlayGroup) return;
    const newWidth = parseFloat(document.getElementById('dxf-stroke-width').value) || 1;
    state.dxfOverlayGroup.forEachObject(obj => { obj.set('strokeWidth', newWidth); });
    state.canvas.renderAll();
}

function calculatePolygonArea(points) {
    if (!points || points.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
}

export function assignDxfAsPlot() {
    const selected = state.canvas.getActiveObject();
    if (!selected || !selected.isDxfOverlay) {
        document.getElementById('status-bar').textContent = 'Please select the imported DXF group first.';
        return;
    }
    const polylines = selected.getObjects().filter(o => o.type === 'polyline');
    if (polylines.length === 0) {
        document.getElementById('status-bar').textContent = 'No polylines found in the selected DXF group.';
        return;
    }

    let largestPoly = null;
    let maxArea = -1;
    polylines.forEach(poly => {
        const matrix = selected.calcTransformMatrix();
        const transformedPoints = poly.points.map(p => fabric.util.transformPoint({ x: p.x + poly.left, y: p.y + poly.top }, matrix));
        const area = calculatePolygonArea(transformedPoints);
        if (area > maxArea) { maxArea = area; largestPoly = transformedPoints; }
    });

    if (largestPoly) {
        const finalPolygon = new fabric.Polygon(largestPoly, { objectCaching: false });
        handleFinishPolygon(finalPolygon, 'drawingPlot');
    }
    deleteDxf();
}
export function finalizeDxf() {
    if (!state.dxfOverlayGroup) return;
    state.dxfOverlayGroup._restoreObjectsState();
    state.canvas.remove(state.dxfOverlayGroup);
    state.dxfOverlayGroup.getObjects().forEach(item => {
        item.set({ isGuide: true, stroke: 'rgba(0, 255, 255, 0.7)', strokeWidth: 2, selectable: false, evented: false, strokeDashArray: [5, 5] });
        state.guideLines.push(item);
        state.canvas.add(item);
    });
    state.dxfOverlayGroup = null;
    updateUI();
    state.canvas.discardActiveObject();
    state.canvas.renderAll();
}
export function deleteDxf() {
    if (state.dxfOverlayGroup) {
        state.canvas.remove(state.dxfOverlayGroup);
        state.dxfOverlayGroup = null;
        state.originalDxfContent = null;
        updateUI();
        state.canvas.renderAll();
    }
}

function generateServiceBlocksCSVString() {
    if (state.serviceBlocks.length === 0 || state.scale.ratio === 0) {
        return null;
    }

    let csvContent = "ID,Key,Name,Level,Category,Width_m,Height_m,Area_sqm\n";
    const scaleSq = state.scale.ratio * state.scale.ratio;

    const allBlocks = [];
    state.serviceBlocks.forEach(block => {
        if (block.isCompositeGroup) {
            block.getObjects().forEach(subBlock => allBlocks.push(subBlock));
        } else if (block.isServiceBlock) {
            allBlocks.push(block);
        }
    });

    allBlocks.forEach(block => {
        if (block.blockData) {
            const widthM = block.getScaledWidth() * state.scale.ratio;
            const heightM = block.getScaledHeight() * state.scale.ratio;
            const areaM2 = widthM * heightM;
            const row = [
                `"${block.blockId || 'N/A'}"`,
                `"${block.blockData.key || 'N/A'}"`,
                `"${block.blockData.name || 'Unnamed'}"`,
                `"${block.level || 'Unassigned'}"`,
                `"${block.blockData.category || 'default'}"`,
                `${widthM.toFixed(2)}`,
                `${heightM.toFixed(2)}`,
                `${areaM2.toFixed(2)}`
            ].join(',');
            csvContent += row + "\n";
        }
    });
    return csvContent;
}
// ==========================================================
// NEW: Export Canvas Geometries to DXF Format
// ==========================================================
function generateDXFString(canvas, scaleRatio) {
    let dxf = "  0\nSECTION\n  2\nENTITIES\n";
    
    canvas.getObjects().forEach(obj => {
        if (obj.isDxfOverlay || obj.isSnapIndicator || obj.isEdgeHighlight) return;
        
        let layerName = "DEFAULT";
        if (obj.isPlot) layerName = "PLOT";
        else if (obj.isFootprint) layerName = `FOOTPRINT_${(obj.level || 'UNASSIGNED').toUpperCase()}`;
        else if (obj.isGuide) layerName = "GUIDES";
        else return; // Only process actual plot, footprint, or guide objects
        
        if (obj.type === 'polygon' || obj.type === 'polyline') {
            const isClosed = obj.type === 'polygon' ? 1 : 0;
            const matrix = obj.calcTransformMatrix();
            
            dxf += "  0\nLWPOLYLINE\n";
            dxf += "  8\n" + layerName + "\n";
            dxf += " 90\n" + obj.points.length + "\n";
            dxf += " 70\n" + isClosed + "\n";
            
            obj.points.forEach(p => {
                // Remove the internal pathOffset, then transform to get absolute canvas coords
                const px = p.x - (obj.pathOffset?.x || 0);
                const py = p.y - (obj.pathOffset?.y || 0);
                const abs = fabric.util.transformPoint({ x: px, y: py }, matrix);
                
                const x = abs.x * scaleRatio;
                const y = -abs.y * scaleRatio; // Invert Y for CAD systems
                
                dxf += " 10\n" + x.toFixed(6) + "\n 20\n" + y.toFixed(6) + "\n";
            });
        } else if (obj.type === 'line') {
            // For straight guide lines
            const x1 = obj.x1 * scaleRatio;
            const y1 = -obj.y1 * scaleRatio;
            const x2 = obj.x2 * scaleRatio;
            const y2 = -obj.y2 * scaleRatio;

            dxf += "  0\nLINE\n";
            dxf += "  8\n" + layerName + "\n";
            dxf += " 10\n" + x1.toFixed(6) + "\n 20\n" + y1.toFixed(6) + "\n";
            dxf += " 11\n" + x2.toFixed(6) + "\n 21\n" + y2.toFixed(6) + "\n";
        }
    });
    
    dxf += "  0\nENDSEC\n  0\nEOF\n";
    return dxf;
}
async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            const base64String = dataUrl.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

export async function exportProjectZIP(canvas) {
    const zip = new JSZip();

    // 1. Generate and add XML
    const doc = document.implementation.createDocument(null, "FeasibilityProject", null);
    const projectNode = doc.documentElement;
    const scaleNode = doc.createElement("Scale");
    scaleNode.setAttribute("pixels", state.scale.pixelDistance);
    scaleNode.setAttribute("meters", state.scale.realDistance);
    projectNode.appendChild(scaleNode);
    const paramsNode = doc.createElement("Parameters");
    paramsNode.setAttribute("projectType", state.projectType);
    document.querySelectorAll('.param-input, .cost-param-input').forEach(input => { // UPDATED SELECTOR
        const paramNode = doc.createElement(input.id);
        paramNode.textContent = input.type === 'checkbox' ? input.checked : input.value;
        paramsNode.appendChild(paramNode);
    });
    projectNode.appendChild(paramsNode);
    const programNode = doc.createElement("ProgramData");
    if (state.currentProgram) { programNode.textContent = JSON.stringify(state.currentProgram); }
    projectNode.appendChild(programNode);
    const customBlocksNode = doc.createElement("UserCompositeBlocks");
    customBlocksNode.textContent = JSON.stringify(state.userCompositeBlocks);
    projectNode.appendChild(customBlocksNode);
    const plotPropsNode = doc.createElement("PlotEdgeProperties");
    plotPropsNode.textContent = JSON.stringify(state.plotEdgeProperties);
    projectNode.appendChild(plotPropsNode);

    const historyNode = doc.createElement("ActionHistory");
    historyNode.textContent = JSON.stringify(state.actionHistory);
    projectNode.appendChild(historyNode);

    const canvasNode = doc.createElement("CanvasObjects");
    const objectsToExport = canvas.getObjects().filter(obj => !obj.isSnapPoint && !obj.isEdgeHighlight && !obj.isSnapIndicator);
    objectsToExport.forEach(obj => {
        const objNode = doc.createElement("Object");
        const customProps = ['level', 'isServiceBlock', 'blockData', 'blockId', 'isPlot', 'isFootprint', 'isCompositeGroup', 'compositeDefName', 'isParkingRow', 'parkingParams', 'parkingCount', 'isGuide', 'isDxfOverlay'];
        const fabricData = obj.toObject(customProps);
        objNode.textContent = JSON.stringify(fabricData);
        canvasNode.appendChild(objNode);
    });
    projectNode.appendChild(canvasNode);
    const serializer = new XMLSerializer();
    const xmlString = formatXML(serializer.serializeToString(doc));
    zip.file("project.xml", xmlString);

    // 2. Add Original Plan File
    if (state.originalPlanFile) {
        if (state.originalPlanFile.name.toLowerCase().endsWith('.pdf')) {
            try {
                const base64String = await fileToBase64(state.originalPlanFile);
                const baseName = state.originalPlanFile.name.replace(/\.[^/.]+$/, "");
                zip.file(`${baseName}.b64`, base64String);
            } catch (error) {
                console.error("Error converting PDF to Base64:", error);
            }
        } else {
            zip.file(state.originalPlanFile.name, state.originalPlanFile);
        }
    }

    // 3. Add Original DXF Content
    if (state.originalDxfContent) {
        zip.file("overlay.dxf", state.originalDxfContent);
    }
    // 4. Generate and add Service Block Area Statement CSV
    const csvContent = generateServiceBlocksCSVString();
    if (csvContent) {
        zip.file("service_block_schedule.csv", csvContent);
    }
 // 5. Generate and add exported Geometry DXF (NEW FEATURE)
    const dxfGeometry = generateDXFString(canvas, state.scale.ratio || 1);
    zip.file("project_geometry.dxf", dxfGeometry);
    // 5. Generate and Download ZIP
    const content = await zip.generateAsync({ type: "blob" });
    downloadFile("project.zip", content, "application/zip");
}

export async function importProjectZIP(file, canvas, onComplete) {
    try {
        const zip = await JSZip.loadAsync(file);
        const xmlFile = zip.file("project.xml");
        if (!xmlFile) throw new Error("project.xml not found in the zip archive.");

        canvas.clear();

        // STEP 1: Load and render background plan first
        const b64ZipObject = Object.values(zip.files).find(f => !f.dir && /\.b64$/i.test(f.name));
        const pdfZipObject = Object.values(zip.files).find(f => !f.dir && /\.pdf$/i.test(f.name));
        const imageZipObject = Object.values(zip.files).find(f => !f.dir && /\.(png|jpe?g)$/i.test(f.name));

        let pdfArrayBuffer = null;

        if (b64ZipObject) {
            // New Base64 format
            const base64Content = await b64ZipObject.async("string");
            const binaryString = window.atob(base64Content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            pdfArrayBuffer = bytes.buffer;

            const originalPdfName = b64ZipObject.name.replace(/\.b64$/, ".pdf");
            state.originalPlanFile = new File([pdfArrayBuffer], originalPdfName, { type: 'application/pdf' });

        } else if (pdfZipObject) {
            // Old binary PDF format for backward compatibility
            pdfArrayBuffer = await pdfZipObject.async("arraybuffer");
            state.originalPlanFile = new File([pdfArrayBuffer], pdfZipObject.name, { type: 'application/pdf' });

        } else if (imageZipObject) {
            // Image format
            const blob = await imageZipObject.async("blob");
            state.originalPlanFile = new File([blob], imageZipObject.name, { type: blob.type });
            const dataUrl = URL.createObjectURL(state.originalPlanFile);
            setCanvasBackground(dataUrl);
        }

        if (pdfArrayBuffer) {
            window.currentPdfData = pdfArrayBuffer;
            const pdfImg = await renderPdfToBackground(pdfArrayBuffer, 1);
            if (pdfImg) setCanvasBackground(pdfImg);
        }

        // STEP 2: Now that background is loaded, parse XML and set scale
        const xmlContent = await xmlFile.async("string");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
        if (xmlDoc.getElementsByTagName("parsererror").length) throw new Error("XML parsing error.");

        const scaleNode = xmlDoc.querySelector("Scale");
        if (scaleNode) {
            const pixels = parseFloat(scaleNode.getAttribute("pixels"));
            const meters = parseFloat(scaleNode.getAttribute("meters"));
            if (pixels > 0 && meters > 0) setScale(pixels, meters);
        }

        // STEP 3: Restore all other settings from XML
        const plotPropsNode = xmlDoc.querySelector("PlotEdgeProperties");
        if (plotPropsNode && plotPropsNode.textContent) state.plotEdgeProperties = JSON.parse(plotPropsNode.textContent);

        let projectType = 'Residential';
        const paramsNode = xmlDoc.querySelector("Parameters");
        if (paramsNode) {
            projectType = paramsNode.getAttribute("projectType") || 'Residential';
            document.getElementById('project-type-select').value = projectType;
            paramsNode.childNodes.forEach(paramNode => {
                if (paramNode.nodeType === 1) {
                    // Check both param-input and cost-param-input classes
                    const input = document.getElementById(paramNode.tagName);
                    if (input && (input.classList.contains('param-input') || input.classList.contains('cost-param-input'))) {
                        if (input.type === 'checkbox') input.checked = paramNode.textContent === 'true';
                        else input.value = paramNode.textContent;
                    }
                }
            });
        }
        state.projectType = projectType;

        const programNode = xmlDoc.querySelector("ProgramData");
        if (programNode && programNode.textContent) {
            const plainProgramData = JSON.parse(programNode.textContent);
            const masterProgram = PROJECT_PROGRAMS[projectType];
            state.currentProgram = rehydrateProgram(plainProgramData, masterProgram);
        }

        const customBlocksNode = xmlDoc.querySelector("UserCompositeBlocks");
        if (customBlocksNode && customBlocksNode.textContent) state.userCompositeBlocks = JSON.parse(customBlocksNode.textContent);

        const historyNode = xmlDoc.querySelector("ActionHistory");
        if (historyNode && historyNode.textContent) state.actionHistory = JSON.parse(historyNode.textContent);

        // STEP 4: Process and interactively load canvas objects
        const objectNodes = xmlDoc.querySelectorAll("CanvasObjects > Object");
        const fabricObjectsData = Array.from(objectNodes).map(node => JSON.parse(node.textContent));

        let newBlockCounter = 0;

        // Levels that should be non-selectable on import
        const nonSelectableLevels = ['Typical_Floor', 'Ground_Floor', 'Podium', 'Podium_Last', 'Roof', 'Plot', 'Basement', 'Basement_Last'];

        for (const objData of fabricObjectsData) {
            if (objData.isServiceBlock || objData.isCompositeGroup) {
                const blockName = objData.isServiceBlock ? objData.blockData.name : objData.compositeDefName;
                const userWantsToImport = confirm(`Import saved block '${blockName}'?\n\nClick 'Cancel' to create a new instance instead.`);

                if (userWantsToImport) {
                    await new Promise(resolve => fabric.util.enlivenObjects([objData], (enlivened) => {
                        const obj = enlivened[0];
                        if (obj.isCompositeGroup) {
                            obj.forEachObject(subObj => subObj.set({ selectable: false, evented: false }));
                        }
                        canvas.add(obj);
                        resolve();
                    }));
                } else {
                    const pos = { x: 50 + (newBlockCounter % 10) * 20, y: 50 + Math.floor(newBlockCounter / 10) * 20 };
                    if (objData.isServiceBlock) {
                        const blockKey = objData.blockData.key;
                        if (blockKey && PREDEFINED_BLOCKS[blockKey]) {
                            placeServiceBlock(pos, PREDEFINED_BLOCKS[blockKey], objData.level);
                        }
                    } else if (objData.isCompositeGroup) {
                        const compositeDef = state.userCompositeBlocks.find(c => c.name === objData.compositeDefName);
                        if (compositeDef) {
                            createCompositeGroup(compositeDef, pos);
                        }
                    }
                    newBlockCounter++;
                }
            } else {
                await new Promise(resolve => fabric.util.enlivenObjects([objData], (enlivened) => {
                    const obj = enlivened[0];
                    // Make specific levels non-selectable on import
                    if (nonSelectableLevels.includes(objData.level)) {
                        obj.set({ selectable: false, evented: false });
                    }
                    // Also make plot polygon and parking rows non-selectable
                    if (objData.isPlot || objData.isPlotPolygon || objData.isParkingRow) {
                        obj.set({ selectable: false, evented: false });
                    }
                    canvas.add(obj);
                    resolve();
                }));
            }
        }

        const dxfZipObject = zip.file("overlay.dxf");
        if (dxfZipObject) {
            const dxfText = await dxfZipObject.async("string");
            state.originalDxfContent = dxfText;
            parseAndDisplayDxf(dxfText);
        }

        canvas.renderAll();
        if (onComplete) onComplete();

    } catch (error) {
        console.error("Failed to import ZIP:", error);
        document.getElementById('status-bar').textContent = `Error: ${error.message}`;
    }
}

export function exportServiceBlocksCSV() {
    const csvContent = generateServiceBlocksCSVString();
    if (!csvContent) {
        document.getElementById('status-bar').textContent = 'No service blocks to export.';
        return;
    }
    downloadFile("service_block_schedule.csv", csvContent, "text/csv;charset=utf-8;");
    document.getElementById('status-bar').textContent = 'Service block schedule exported as CSV.';
}

export function importServiceBlocksCSV(file, onComplete) {
    if (!file) return;
    if (state.scale.ratio === 0) {
        alert('Please set the scale before importing blocks.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const csvText = event.target.result;
            const rows = csvText.split('\n').filter(row => row.trim() !== '');
            if (rows.length < 2) throw new Error("CSV is empty or contains only a header.");

            const header = rows.shift().toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
            const keyIndex = header.indexOf('key');
            const nameIndex = header.indexOf('name');
            const levelIndex = header.indexOf('level');
            const categoryIndex = header.indexOf('category');

            if ((keyIndex === -1 && nameIndex === -1) || levelIndex === -1) {
                throw new Error("CSV must contain 'Level' and either 'Key' or 'Name' columns.");
            }

            let blocksCreated = 0;
            const placementStart = { x: 100, y: 100 };

            rows.forEach((row, rowIndex) => {
                const values = row.split(',').map(v => v.trim().replace(/"/g, ''));
                const blockKeyFromCSV = keyIndex > -1 ? values[keyIndex] : null;
                const blockName = nameIndex > -1 ? values[nameIndex] : null;
                const levelName = values[levelIndex];
                const categoryName = categoryIndex > -1 ? values[categoryIndex].toLowerCase() : 'default';
                let blockKeyToUse = null;

                if (blockKeyFromCSV && PREDEFINED_BLOCKS[blockKeyFromCSV]) {
                    blockKeyToUse = blockKeyFromCSV;
                } else if (blockName) {
                    console.warn(`Could not find block by key "${blockKeyFromCSV}" from CSV row ${rowIndex + 1}. Falling back to search by name "${blockName}". This may be inaccurate.`);
                    blockKeyToUse = Object.keys(PREDEFINED_BLOCKS).find(key => PREDEFINED_BLOCKS[key].name === blockName);
                }

                if (!blockKeyToUse) {
                    console.warn(`Could not find any predefined block matching row ${rowIndex + 1}. Skipping.`);
                    return;
                }

                const blockData = { ...PREDEFINED_BLOCKS[blockKeyToUse] };
                if (categoryIndex > -1) {
                    blockData.category = categoryName;
                }

                const pos = { x: placementStart.x + (blocksCreated % 10) * 20, y: placementStart.y + Math.floor(blocksCreated / 10) * 20 };
                placeServiceBlock(pos, blockData, levelName);
                blocksCreated++;
            });

            if (blocksCreated > 0) {
                document.getElementById('status-bar').textContent = `Successfully imported ${blocksCreated} service blocks.`;
                if (onComplete) onComplete();
            } else {
                document.getElementById('status-bar').textContent = 'Import complete, but no matching blocks were found to create.';
            }

        } catch (error) {
            console.error("CSV Import Error:", error);
            document.getElementById('status-bar').textContent = `Error importing CSV: ${error.message}`;
        }
    };
    reader.readAsText(file);
}
// ******************************************************
// ***** NEW FUNCTIONS FOR OFFLINE MARKET RATES I/O *****
// ******************************************************

/**
 * Generates and downloads an XML file with simulated market rates for all locations.
 */
export function exportMarketRatesXML() {
    const doc = document.implementation.createDocument(null, "MarketRates", null);
    const root = doc.documentElement;
    root.setAttribute("generated", new Date().toISOString());

    DUBAI_LOCATIONS.forEach(loc => {
        const locationNode = doc.createElement("Location");
        locationNode.setAttribute("id", loc.id);
        locationNode.setAttribute("name", loc.name);

        MARKET_RATE_PROPERTY_TYPES.forEach(prop => {
            const randomness = 1 + (Math.random() - 0.5) * 0.3;
            const buyingRate = (prop.baseBuy * randomness).toFixed(0);
            const rentRate = (prop.baseRent * randomness).toFixed(0);

            const propNode = doc.createElement("Property");
            propNode.setAttribute("key", prop.key);
            propNode.setAttribute("buy", buyingRate);
            propNode.setAttribute("rent", rentRate);
            locationNode.appendChild(propNode);
        });
        root.appendChild(locationNode);
    });

    const serializer = new XMLSerializer();
    const xmlString = formatXML(serializer.serializeToString(doc));
    downloadFile("dubai_market_rates.xml", xmlString, "application/xml");
}

/**
 * Imports an XML file of market rates and populates the offline state.
 * @param {File} file - The XML file to import.
 * @param {function} onComplete - Callback function to run after successful import.
 */
export function importMarketRatesXML(file, onComplete) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const xmlText = event.target.result;
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            if (xmlDoc.getElementsByTagName("parsererror").length) {
                throw new Error("XML parsing error. Please ensure the file is valid.");
            }

            const offlineData = {};
            const locationNodes = xmlDoc.querySelectorAll("Location");

            locationNodes.forEach(locNode => {
                const locId = locNode.getAttribute("id");
                if (!locId) return;

                offlineData[locId] = {};
                const propNodes = locNode.querySelectorAll("Property");
                propNodes.forEach(propNode => {
                    const propKey = propNode.getAttribute("key");
                    const buy = parseFloat(propNode.getAttribute("buy"));
                    const rent = parseFloat(propNode.getAttribute("rent"));
                    if (propKey && !isNaN(buy) && !isNaN(rent)) {
                        offlineData[locId][propKey] = { buy, rent };
                    }
                });
            });

            if (Object.keys(offlineData).length > 0) {
                state.offlineMarketRates = offlineData;
                if (onComplete) onComplete(true, `Successfully imported market data for ${Object.keys(offlineData).length} locations.`);
            } else {
                throw new Error("No valid location data found in the XML file.");
            }

        } catch (error) {
            console.error("Market Rate Import Error:", error);
            if (onComplete) onComplete(false, `Error: ${error.message}`);
        }
    };
    reader.readAsText(file);
}

// ============================================
// NEW: ZIP File Import with PDF Detection
// ============================================

export async function handleZipUpload(file) {
    try {
        const JSZip = window.JSZip;
        const zip = new JSZip();
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
                const statusText = pdfFile.split('/').pop();
                const geomText = geometryFile.split('/').pop();
                document.getElementById('status-bar').textContent =
                    `✓ PDF imported (${statusText}). Scale the PDF background, then click "Done Scaling" to import geometry (${geomText})`;
            } else {
                document.getElementById('status-bar').textContent =
                    `✓ PDF imported (${pdfFile.split('/').pop()}). Scale and position as needed.`;
            }
        } else if (geometryFile) {
            // No PDF, just import geometry
            const data = await loaded.files[geometryFile].async('text');
            if (geometryFile.toLowerCase().endsWith('.dxf')) {
                parseAndDisplayDxf(data);
            }
        } else {
            document.getElementById('status-bar').textContent = 'No PDF or geometry file found in ZIP';
        }
    } catch (error) {
        console.error('Error processing ZIP:', error);
        document.getElementById('status-bar').textContent = 'Error: Could not process ZIP file - ' + error.message;
    }
}

// NEW: Import PDF as background
export async function importPdfAsBackground(pdfData) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        state.pdfDocument = pdf;
        state.currentPdfPage = 1;

        // Render first page as background
        await renderPdfPageAsBackground(1);

        document.getElementById('status-bar').textContent =
            `PDF loaded (${pdf.numPages} pages). Scale to match your plan.`;
    } catch (error) {
        console.error('Error loading PDF:', error);
        document.getElementById('status-bar').textContent = 'Error: Could not load PDF - ' + error.message;
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

// NEW: Update PDF opacity
export function updatePdfOpacity(value) {
    if (state.pdfBackgroundImage) {
        state.pdfBackgroundImage.opacity = parseFloat(value);
        state.canvas.renderAll();
    }
}

// NEW: Show PDF scaling dialog
export function showPdfScalingDialog() {
    const modal = document.getElementById('pdf-alignment-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// NEW: Close PDF scaling dialog
export function closePdfScalingDialog() {
    const modal = document.getElementById('pdf-alignment-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    // If geometry is pending, import it now
    if (state.pendingGeometryZipFile) {
        importPendingGeometry();
    }
}

// NEW: Import pending geometry from ZIP
async function importPendingGeometry() {
    try {
        const data = await state.pendingGeometryZipFile.async('text');
        const filename = state.pendingGeometryZipFile.name;

        if (filename.toLowerCase().endsWith('.dxf')) {
            // Import as selectable so user can view/inspect polygons
            parseAndDisplayDxf(data, true);
        } else if (filename.toLowerCase().endsWith('.json')) {
            // Handle JSON geometry import if needed
        }

        state.pendingGeometryZipFile = null;

        // Show dialog to ask about making polygons non-selectable
        showImportedGeometryDialog();
    } catch (error) {
        console.error('Error importing geometry:', error);
        document.getElementById('status-bar').textContent = 'Error: Could not import geometry - ' + error.message;
    }
}

// NEW: Show dialog after geometry import to ask about selectability
function showImportedGeometryDialog() {
    const modal = document.getElementById('geometry-selectability-modal');
    if (!modal) {
        // Create modal if it doesn't exist
        const newModal = document.createElement('div');
        newModal.id = 'geometry-selectability-modal';
        newModal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background-color: rgba(0,0,0,0.7); display: flex; align-items: center; 
            justify-content: center; z-index: 1000;
        `;
        newModal.innerHTML = `
            <div style="background-color: white; padding: 20px; border-radius: 8px; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 15px 0; color: #333;">Geometry Import Complete</h3>
                <p style="margin: 0 0 20px 0; color: #666;">
                    The area polygons have been imported and are currently selectable for inspection.
                </p>
                <p style="margin: 0 0 20px 0; color: #666; font-size: 0.9em;">
                    Would you like to make them <strong>non-selectable</strong>? (You can still edit them via tools, but they won't be accidentally dragged).
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button onclick="window.makeGeometryNonSelectable()" style="padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        Yes, Make Non-Selectable
                    </button>
                    <button onclick="window.closeGeometryDialog()" style="padding: 10px; background-color: #666; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        Keep Selectable
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(newModal);
    } else {
        modal.style.display = 'flex';
    }
}

// NEW: Make imported geometry non-selectable
function makeGeometryNonSelectable() {
    if (state.dxfOverlayGroup) {
        state.dxfOverlayGroup.set({ selectable: false, evented: false });
        state.dxfOverlayGroup.forEachObject(obj => {
            obj.set({ selectable: false, evented: false });
        });
        state.canvas.discardActiveObject();
        state.canvas.renderAll();
        document.getElementById('status-bar').textContent =
            '✓ Geometry made non-selectable. Use Align & Scale tool to align with PDF background.';
    }
    closeGeometryDialog();
}

// NEW: Close geometry dialog
function closeGeometryDialog() {
    const modal = document.getElementById('geometry-selectability-modal');
    if (modal) modal.style.display = 'none';
    if (!state.dxfOverlayGroup) {
        document.getElementById('status-bar').textContent =
            '✓ Geometry imported. Use Align & Scale tool to align geometry with PDF background.';
    }
}

// Expose functions globally for onclick handlers
window.makeGeometryNonSelectable = makeGeometryNonSelectable;
window.closeGeometryDialog = closeGeometryDialog;

// NEW: Export geometry coordinates and PDF scale to CSV
export function exportGeometryCSV() {
    const csvRows = [];

    // Add header with PDF scale info
    csvRows.push(`PDF Scale (pixels),PDF Scale (meters),Scale Ratio`);
    csvRows.push(`${state.scale.pixelDistance},${state.scale.realDistance},${state.scale.ratio}`);
    csvRows.push(''); // Empty line

    // Add geometry data for each level
    csvRows.push(`Level,Element ID,X Coordinate,Y Coordinate,Type,Properties`);

    state.canvas.getObjects().forEach((obj, index) => {
        if (!obj.level) return; // Skip objects without level

        const level = obj.level;
        const elementId = obj.blockId || obj.name || `Element-${index}`;
        const x = obj.left.toFixed(2);
        const y = obj.top.toFixed(2);
        const type = obj.type || 'unknown';

        // For polygons, add point count; for blocks add dimensions
        let properties = '';
        if (obj.points) {
            properties = `points=${obj.points.length}`;
        } else if (obj.width) {
            properties = `width=${obj.width.toFixed(2)},height=${obj.height.toFixed(2)}`;
        }

        csvRows.push(`${level},"${elementId}",${x},${y},${type},"${properties}"`);
    });

    const csvContent = csvRows.join('\n');
    downloadFile(`geometry_${Date.now()}.csv`, csvContent, 'text/csv');
    document.getElementById('status-bar').textContent = '✓ Geometry exported with coordinates and PDF scale';
}

// NEW: Import geometry from CSV with level/selectability dialog
export function importGeometryCSV(file, onComplete) {
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const csvContent = event.target.result;
            const lines = csvContent.split('\n');

            // Parse PDF scale from first data row (row 2)
            let pdfScalePixels = 0, pdfScaleMeters = 0;
            if (lines.length > 1) {
                const scaleRow = lines[1].split(',');
                pdfScalePixels = parseFloat(scaleRow[0]);
                pdfScaleMeters = parseFloat(scaleRow[1]);

                // Apply PDF scale if different from current scale
                if (pdfScalePixels > 0 && pdfScaleMeters > 0) {
                    const newScale = pdfScaleMeters / pdfScalePixels;
                    if (Math.abs(newScale - state.scale.ratio) > 0.0001) {
                        state.scale.pixelDistance = pdfScalePixels;
                        state.scale.realDistance = pdfScaleMeters;
                        state.scale.ratio = newScale;

                        // Rescale PDF background if it exists
                        if (state.pdfBackgroundImage) {
                            state.canvas.renderAll();
                        }

                        document.getElementById('status-bar').textContent =
                            `PDF scale updated: ${pdfScalePixels.toFixed(2)}px = ${pdfScaleMeters.toFixed(2)}m`;
                    }
                }
            }

            // Parse geometry data and collect by level
            const levelData = {};
            for (let i = 4; i < lines.length; i++) {
                if (!lines[i].trim()) continue;

                const row = parseCSVRow(lines[i]);
                if (row.length < 5) continue;

                const level = row[0];
                const elementId = row[1];
                const x = parseFloat(row[2]);
                const y = parseFloat(row[3]);
                const type = row[4];

                if (!levelData[level]) {
                    levelData[level] = [];
                }

                levelData[level].push({
                    elementId,
                    x,
                    y,
                    type,
                    line: lines[i]
                });
            }

            // Show dialog with levels and selectability options
            showLevelSelectabilityDialog(levelData);

        } catch (error) {
            console.error('Error importing geometry CSV:', error);
            document.getElementById('status-bar').textContent = 'Error: Could not import geometry CSV - ' + error.message;
        }
    };
    reader.readAsText(file);
}

// NEW: Parse CSV row accounting for quoted fields
function parseCSVRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

// NEW: Show dialog for selecting selectability of imported geometry by level
function showLevelSelectabilityDialog(levelData) {
    let modalHtml = `
        <div style="background-color: white; padding: 20px; border-radius: 8px; max-width: 600px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); max-height: 80vh; overflow-y: auto;">
            <h3 style="margin: 0 0 15px 0; color: #333;">Geometry Import - Select Levels</h3>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 0.9em;">
                Configure selectability for each floor/level. Checked = Non-selectable (recommended).
            </p>
            <div style="margin-bottom: 15px; border: 1px solid #ddd; border-radius: 4px; padding: 10px;">
    `;

    const levels = Object.keys(levelData).sort();
    levels.forEach(level => {
        const items = levelData[level];
        const checkedState = 'checked'; // Default to non-selectable

        modalHtml += `
            <div style="margin-bottom: 12px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="level-${level}" data-level="${level}" ${checkedState} style="margin-right: 10px; cursor: pointer;">
                    <span style="font-weight: bold; color: #1976d2;">${level}</span>
                    <span style="color: #999; font-size: 0.85em; margin-left: 10px;">(${items.length} elements)</span>
                </label>
                <div style="margin-left: 25px; margin-top: 5px; font-size: 0.85em; color: #666;">
                    ${items.map((item, idx) => `<div>• ${item.elementId} (${item.type})</div>`).slice(0, 3).join('')}
                    ${items.length > 3 ? `<div style="color: #999;">... and ${items.length - 3} more</div>` : ''}
                </div>
            </div>
        `;
    });

    modalHtml += `
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px;">
                <button onclick="window.confirmLevelImport()" style="padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    Import Selected
                </button>
                <button onclick="window.cancelLevelImport()" style="padding: 10px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    Cancel
                </button>
            </div>
        </div>
    `;

    const modal = document.getElementById('level-selectability-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.remove();
    }

    const newModal = document.createElement('div');
    newModal.id = 'level-selectability-modal';
    newModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
        background-color: rgba(0,0,0,0.7); display: flex; align-items: center; 
        justify-content: center; z-index: 1001;
    `;
    newModal.innerHTML = modalHtml;
    document.body.appendChild(newModal);

    // Store level data globally for import confirmation
    window.levelDataToImport = levelData;
}

// NEW: Confirm level import with selected options
window.confirmLevelImport = function () {
    const levelData = window.levelDataToImport;
    const checkedLevels = new Set();

    document.querySelectorAll('input[id^="level-"]').forEach(checkbox => {
        if (checkbox.checked) {
            checkedLevels.add(checkbox.dataset.level);
        }
    });

    // Apply selectability to imported geometry based on checked levels
    state.canvas.getObjects().forEach(obj => {
        if (obj.level && levelData[obj.level]) {
            const shouldBeNonSelectable = checkedLevels.has(obj.level);
            obj.set({
                selectable: !shouldBeNonSelectable,
                evented: !shouldBeNonSelectable
            });
        }
    });

    state.canvas.renderAll();

    const modal = document.getElementById('level-selectability-modal');
    if (modal) modal.remove();

    document.getElementById('status-bar').textContent =
        '✓ Geometry imported with configured selectability settings';
};

// NEW: Cancel level import
window.cancelLevelImport = function () {
    const modal = document.getElementById('level-selectability-modal');
    if (modal) modal.remove();
    document.getElementById('status-bar').textContent = 'Import cancelled';
};