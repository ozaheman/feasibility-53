//--- START OF FILE drawingTools.js ---

// MODULE 5: DRAWING TOOLS & SNAPPING (drawingTools.js equivalent)
// =====================================================================
import { getCanvas, getOverlayContext } from './canvasController.js';
import { resetState, state } from './state.js';
import { pointToLineSegmentDistance, getLineIntersection, allocateCountsByPercent, f, fInt, getPolygonProperties } from './utils.js';
import { initUI, updateUI, applyLevelVisibility, updateLevelFootprintInfo, updateParkingDisplay, updateMixTotal } from './uiController.js';
// REMOVED: import { exitAllModes, handleFinishPolygon, handleObjectModified, handleDblClick } from './eventHandlers.js';
// IMPORT only what is needed, and NOT handleDblClick
import { exitAllModes, handleFinishPolygon, handleFinishPolyline, handleObjectModified } from './eventHandlers.js';
import { generateLinearParking, regenerateParkingInGroup } from './parkingLayoutUtils.js';
import { PREDEFINED_BLOCKS, BLOCK_CATEGORY_COLORS } from './config.js';

import { layoutFlatsOnPolygon } from './apartmentLayout.js';
window.snapIndicators = null;

let cancelBtnEl = null;

function createCancelButton() {
    if (cancelBtnEl) return;
    const canvasContainer = document.querySelector('.canvas-container-wrapper');
    if (!canvasContainer) return;

    cancelBtnEl = document.createElement('div');
    cancelBtnEl.id = 'cancel-drawing-btn';
    cancelBtnEl.textContent = '✕';
    cancelBtnEl.title = 'Cancel Drawing (Esc)';

    // Position fixed relative to the canvas container
    cancelBtnEl.style.position = 'absolute';
    cancelBtnEl.style.top = '20px'; // Offset from top of container
    cancelBtnEl.style.left = '20px'; // Offset from left of container

    cancelBtnEl.addEventListener('click', exitAllModes);
    canvasContainer.appendChild(cancelBtnEl);
}

function removeCancelButton() {
    if (cancelBtnEl) {
        cancelBtnEl.removeEventListener('click', exitAllModes);
        if (cancelBtnEl.parentNode) {
            cancelBtnEl.parentNode.removeChild(cancelBtnEl);
        }
        cancelBtnEl = null;
    }
}

export function initDrawingTools() {
    snapIndicators = new fabric.Group([], { evented: false, selectable: false, isSnapIndicator: true });
    state.canvas.add(snapIndicators);
}
export function resetDrawingState() {
    polygonPoints.length = 0; // Use length = 0 to clear the exported array
    finalpolygonPoints = []; // Use length = 0 to clear the exported array
    if (currentDrawingPolygon) state.canvas.remove(currentDrawingPolygon);
    currentDrawingPolygon = null;
    if (scaleLine) state.canvas.remove(scaleLine);
    scaleLine = null;
    if (guideLine) state.canvas.remove(guideLine);
    guideLine = null;
    if (alignmentHighlight) state.canvas.remove(alignmentHighlight);
    alignmentHighlight = null;
    snapIndicators.remove(...snapIndicators.getObjects());
    clearEdgeSnapIndicator();
    removeCancelButton(); // Ensure the cancel button is removed
    state.canvas.renderAll();
}
export function getOffsetPoints(points) {
    if (!points || points.length < 3 || !state.scale.ratio) return [];
    const offsetLines = [];
    const numPoints = points.length;
    for (let i = 0; i < numPoints; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % numPoints];
        const edgeProps = state.plotEdgeProperties[i] || { distance: 5, direction: 'inside' };
        const offsetDist = (edgeProps.direction === 'inside' ? 1 : -1) * edgeProps.distance / state.scale.ratio;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const nx = -dy / len;
        const ny = dx / len;
        const op1 = { x: p1.x + offsetDist * nx, y: p1.y + offsetDist * ny };
        const op2 = { x: p2.x + offsetDist * nx, y: p2.y + offsetDist * ny };
        offsetLines.push({ p1: op1, p2: op2 });
    }
    if (offsetLines.length < 2) return [];
    const newPolygonPoints = [];
    const numLines = offsetLines.length;
    for (let i = 0; i < numLines; i++) {
        const currentLine = offsetLines[i];
        const nextLine = offsetLines[(i + 1) % numLines];
        const intersection = getLineIntersection(currentLine.p1, currentLine.p2, nextLine.p1, nextLine.p2);
        if (intersection) {
            newPolygonPoints.push(intersection);
        } else {
            newPolygonPoints.push(currentLine.p2);
        }
    }
    return newPolygonPoints;
}
export function drawSetbackGuides() {
    if (!state.plotPolygon) return;
    clearSetbackGuides();
    const points = state.plotPolygon.points;
    const offsetPoints = getOffsetPoints(points);
    if (offsetPoints.length < 2) return;
    for (let i = 0; i < offsetPoints.length; i++) {
        const p1 = offsetPoints[i];
        const p2 = offsetPoints[(i + 1) % offsetPoints.length];
        const guide = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
            stroke: 'rgba(255, 0, 255, 0.8)', strokeWidth: 2, strokeDashArray: [5, 5],
            selectable: false, evented: false, strokeUniform: true, isGuide: true, level: state.currentLevel
        });
        state.setbackGuides.push(guide);
        state.canvas.add(guide);
    }
    state.canvas.renderAll();
}
export function getSetbackPolygonPoints() {
    if (!state.plotPolygon || state.plotEdgeProperties.length === 0) return [];
    return getOffsetPoints(state.plotPolygon.points);
}
export function clearSetbackGuides() {
    state.setbackGuides.forEach(guide => state.canvas.remove(guide));
    state.setbackGuides = [];
    state.canvas.renderAll();
}
export function findNearestParkingEdge(pointer) {
    let minDistance = Infinity;
    let nearestEdge = null;
    const threshold = 15 / (state.canvas?.getZoom() || 1);
    const validLevels = ['Basement', 'Ground_Floor', 'Podium'];


    if (!validLevels.includes(state.currentLevel)) return null;

    const footprints = state.levels[state.currentLevel].objects.filter(o => o.isFootprint && o.visible);
    // Include the plot polygon if it exists, as it can define edges for parking
    if (state.plotPolygon) footprints.push(state.plotPolygon);

    footprints.forEach(poly => {
        if (!poly.points) return;
        for (let i = 0; i < poly.points.length; i++) {
            const p1 = poly.points[i];
            const p2 = poly.points[(i + 1) % poly.points.length];
            const { distance } = pointToLineSegmentDistance(pointer, p1, p2);
            if (distance < minDistance) {
                minDistance = distance;
                nearestEdge = { p1, p2 };
            }
        }
    });

    return minDistance < threshold ? nearestEdge : null;

}
export function getClickedPlotEdge(pointer) {
    if (!state.plotPolygon) return -1;
    const threshold = 10 / state.canvas.getZoom();
    const points = state.plotPolygon.points;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const { distance } = pointToLineSegmentDistance(pointer, p1, p2);
        if (distance < threshold) {
            return i;
        }
    }
    return -1;
}

// NEW: Helper to get clicked edge on any polygon
export function getClickedPolygonEdge(polygon, pointer) {
    if (!polygon || !polygon.points) return -1;
    const threshold = 10 / (state.canvas.getZoom() * polygon.scaleX); // Adjust threshold for scaled polygons
    const matrix = polygon.calcTransformMatrix();
    const transformedPoints = polygon.points.map(p => fabric.util.transformPoint(p, matrix));


    for (let i = 0; i < transformedPoints.length; i++) {
        const p1 = transformedPoints[i];
        const p2 = transformedPoints[(i + 1) % transformedPoints.length];
        const { distance } = pointToLineSegmentDistance(pointer, p1, p2);
        if (distance < threshold) {
            return i;
        }
    }
    return -1;

}

export function updateEdgeHighlight(pointer) {
    if (state.edgeHighlightGroup) state.canvas.remove(state.edgeHighlightGroup);
    state.edgeHighlightGroup = null;
    const edgeIndex = getClickedPlotEdge(pointer);
    const highlights = [];
    if (edgeIndex !== -1) {
        const p1 = state.plotPolygon.points[edgeIndex];
        const p2 = state.plotPolygon.points[(edgeIndex + 1) % state.plotPolygon.points.length];
        highlights.push(new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
            stroke: 'rgba(0, 255, 255, 0.5)', strokeWidth: 5, evented: false, selectable: false, isEdgeHighlight: true, strokeUniform: true
        }));
    }
    state.selectedPlotEdges.forEach(index => {
        const p1 = state.plotPolygon.points[index];
        const p2 = state.plotPolygon.points[(index + 1) % state.plotPolygon.points.length];
        highlights.push(new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
            stroke: 'rgba(255, 0, 255, 0.5)', strokeWidth: 5, evented: false, selectable: false, isEdgeHighlight: true, strokeUniform: true
        }));
    });
    if (highlights.length > 0) {
        state.edgeHighlightGroup = new fabric.Group(highlights, { evented: false, selectable: false });
        state.canvas.add(state.edgeHighlightGroup);
    }
    state.canvas.renderAll();
}
export function clearEdgeHighlight() {
    if (state.edgeHighlightGroup) state.canvas.remove(state.edgeHighlightGroup);
    state.edgeHighlightGroup = null;
    state.canvas.renderAll();
}
export function getNearestEdge(pointer, plotPolygon, setbackGuides) {
    let minDistance = Infinity;
    let nearestEdge = null;
    const threshold = 30 / (state.canvas?.getZoom() || 1);
    const checkEdges = (points) => {
        if (!points) return;
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const { distance } = pointToLineSegmentDistance(pointer, p1, p2);
            if (distance < minDistance) {
                minDistance = distance;
                nearestEdge = { p1, p2 };
            }
        }
    };
    if (plotPolygon) checkEdges(plotPolygon.points);
    setbackGuides.forEach(guide => checkEdges([{ x: guide.x1, y: guide.y1 }, { x: guide.x2, y: guide.y2 }]));
    return minDistance < threshold ? nearestEdge : null;
}
export function alignObjectToEdge(object, edge) {
    const edgeDx = edge.p2.x - edge.p1.x;
    const edgeDy = edge.p2.y - edge.p1.y;
    const angleRad = Math.atan2(edgeDy, edgeDx);
    object.set('angle', fabric.util.radiansToDegrees(angleRad)).setCoords();
    const [A, B, C] = [edge.p1.y - edge.p2.y, edge.p2.x - edge.p1.x, edge.p1.x * edge.p2.y - edge.p2.x * edge.p1.y];
    const lineEqDenominator = Math.sqrt(A * A + B * B);
    if (lineEqDenominator === 0) return;
    const corners = object.oCoords;
    const signedDistances = [corners.tl, corners.tr, corners.br, corners.bl]
        .map(p => (A * p.x + B * p.y + C) / lineEqDenominator);
    const minSignedDist = signedDistances.reduce((min, d) => Math.abs(d) < Math.abs(min) ? d : min, Infinity);
    const normalVector = { x: A / lineEqDenominator, y: B / lineEqDenominator };
    const moveVector = { x: -normalVector.x * minSignedDist, y: -normalVector.y * minSignedDist };
    object.set({ left: object.left + moveVector.x, top: object.top + moveVector.y }).setCoords();
}
export function updateAlignmentHighlight(edge) {
    if (alignmentHighlight) state.canvas.remove(alignmentHighlight);
    alignmentHighlight = null;
    if (edge) {
        alignmentHighlight = new fabric.Line([edge.p1.x, edge.p1.y, edge.p2.x, edge.p2.y], {
            stroke: 'rgba(255, 165, 0, 0.9)', strokeWidth: 5, selectable: false, evented: false, strokeUniform: true,
        });
        state.canvas.add(alignmentHighlight);
    }
    state.canvas.renderAll();
}
export function findSnapPoint(pointer) {
    const snapTypes = {
        endpoint: document.getElementById('snap-endpoint').checked,
        perpendicular: document.getElementById('snap-perpendicular').checked,
        parallel: document.getElementById('snap-parallel').checked,
    };
    if (!Object.values(snapTypes).some(Boolean)) return null;


    let bestSnap = null;
    let minDistance = snapThreshold / state.canvas.getZoom();
    const objects = state.canvas.getObjects().filter(obj => obj.visible && !obj.isSnapIndicator && !obj.isEdgeHighlight && (obj.points || obj.isGuide));

    objects.forEach(obj => {
        let pointsToSnap = [];
        if (obj.points) { pointsToSnap = obj.points; }
        else if (obj.isGuide) { pointsToSnap = [{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }]; }

        if (snapTypes.endpoint) {
            pointsToSnap.forEach(p => {
                const checkPoint = obj.isFootprint && state.currentMode === 'editingFootprint' ? fabric.util.transformPoint(p, obj.calcTransformMatrix()) : p;
                const dist = Math.hypot(checkPoint.x - pointer.x, checkPoint.y - pointer.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestSnap = { type: 'endpoint', x: checkPoint.x, y: checkPoint.y };
                }
            });
        }
        if ((snapTypes.perpendicular || snapTypes.parallel) && polygonPoints.length > 0) {
            const lastPt = polygonPoints[polygonPoints.length - 1];
            for (let i = 0; i < pointsToSnap.length - 1; i++) {
                const p1 = pointsToSnap[i];
                const p2 = pointsToSnap[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                if (snapTypes.parallel) {
                    const snapX = lastPt.x + dx;
                    const snapY = lastPt.y + dy;
                    const dist = Math.hypot(snapX - pointer.x, snapY - pointer.y);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestSnap = { type: 'parallel', x: snapX, y: snapY };
                    }
                }
                if (snapTypes.perpendicular) {
                    const snapX = lastPt.x - dy;
                    const snapY = lastPt.y + dx;
                    const dist = Math.hypot(snapX - pointer.x, snapY - pointer.y);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestSnap = { type: 'perpendicular', x: snapX, y: snapY };
                    }
                }
            }
        }
    });
    return bestSnap;

}
export function updateSnapIndicators(snapPoint) {
    snapIndicators.remove(...snapIndicators.getObjects());
    if (snapPoint) {
        const indicator = new fabric.Circle({
            left: snapPoint.x, top: snapPoint.y,
            radius: 5 / state.canvas.getZoom(), fill: 'transparent',
            stroke: 'cyan', strokeWidth: 2 / state.canvas.getZoom(),
            originX: 'center', originY: 'center',
            isSnapPoint: true
        });
        snapIndicators.add(indicator);
    }
    state.canvas.renderAll();
}
export function snapObjectToEdge(object) {
    const objCenter = object.getCenterPoint();
    const nearestEdge = getNearestEdge(objCenter, state.plotPolygon, state.setbackGuides);
    clearEdgeSnapIndicator();
    if (nearestEdge) {
        const edgeDx = nearestEdge.p2.x - nearestEdge.p1.x;
        const edgeDy = nearestEdge.p2.y - nearestEdge.p1.y;
        const angleRad = Math.atan2(edgeDy, edgeDx);
        object.set('angle', fabric.util.radiansToDegrees(angleRad));
        const { point: closestPointOnLine } = pointToLineSegmentDistance(objCenter, nearestEdge.p1, nearestEdge.p2);
        const moveVector = { x: closestPointOnLine.x - objCenter.x, y: closestPointOnLine.y - objCenter.y };
        object.set({ left: object.left + moveVector.x, top: object.top + moveVector.y }).setCoords();
        updateEdgeSnapIndicator(nearestEdge);
    }
}
export function updateEdgeSnapIndicator(edge) {
    if (edge) {
        edgeSnapIndicator = new fabric.Line([edge.p1.x, edge.p1.y, edge.p2.x, edge.p2.y], {
            stroke: '#00ff00', strokeWidth: 3 / state.canvas.getZoom(), strokeDashArray: [5, 5],
            selectable: false, evented: false, strokeUniform: true, isSnapIndicator: true, klass: 'snap-indicator-parallel'
        });
        state.canvas.add(edgeSnapIndicator);
        state.canvas.renderAll();
    }
}
export function clearEdgeSnapIndicator() {
    if (edgeSnapIndicator) {
        state.canvas.remove(edgeSnapIndicator);
        edgeSnapIndicator = null;
        state.canvas.renderAll();
    }
}

export function addDrawingPoint(point) {
    if (polygonPoints.length > 0) {
        const last = polygonPoints[polygonPoints.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) < 2) {
            return;
        }
    }

    polygonPoints.push(point);
    if (!currentDrawingPolygon) {
        const newPoints = [...polygonPoints, { x: point.x, y: point.y }];
        const isLinearMode = ['drawingLinearBuilding', 'drawingCorridor'].includes(state.currentMode);
        const isClosedPreview = document.getElementById('auto-close-preview-check').checked && !isLinearMode;
        const options = {
            stroke: '#f50057', strokeWidth: 2, fill: isClosedPreview ? 'rgba(245, 0, 87, 0.2)' : 'transparent',
            selectable: false, evented: false, objectCaching: false, strokeUniform: true,
        };
        currentDrawingPolygon = isLinearMode ?
            new fabric.Polyline(newPoints, options) :
            new fabric.Polygon(newPoints, options);
        state.canvas.add(currentDrawingPolygon);
    }

    if ((['drawingLinearBuilding', 'drawingBuilding', 'drawingPlot', 'drawingCorridor'].includes(state.currentMode)) && polygonPoints.length === 1) {
        createCancelButton();
    }

    handleCanvasMouseMove({ e: { clientX: state.lastMousePosition.x, clientY: state.lastMousePosition.y } });
    state.canvas.requestRenderAll();
}

export function handleCanvasMouseDown(pointer) {
    const activeSnap = snapIndicators.getObjects().find(o => o.isSnapPoint);
    if (activeSnap) { pointer.x = activeSnap.left; pointer.y = activeSnap.top; }


    switch (state.currentMode) {
        case 'scaling':
            scaleLine = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                stroke: 'rgba(211, 47, 47, 0.8)', strokeWidth: 2, selectable: false, evented: false, strokeUniform: true,
            });
            state.canvas.add(scaleLine);
            state.canvas.renderAll();
            return null;
        case 'drawingGuide':
            guideLine = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                stroke: 'rgba(0, 255, 255, 0.7)', strokeWidth: 2, selectable: false, evented: false, strokeDashArray: [5, 5], strokeUniform: true, isGuide: true, level: state.currentLevel
            });
            state.canvas.add(guideLine);
            break;
        case 'drawingPlot':
        case 'drawingBuilding':
        case 'drawingLinearBuilding':
        case 'drawingCorridor':
            if (!['drawingLinearBuilding', 'drawingCorridor'].includes(state.currentMode) && polygonPoints.length > 2 && Math.hypot(pointer.x - polygonPoints[0].x, pointer.y - polygonPoints[0].y) < 10 / state.canvas.getZoom()) {

                const finalPolygon = new fabric.Polygon(finalpolygonPoints, { selectable: false, evented: false, objectCaching: false });
                resetDrawingState();
                return { action: 'finishPolygon', polygon: finalPolygon };
            }
            if ((state.currentMode == 'drawingLinearBuilding' || state.currentMode === 'drawingCorridor') && polygonPoints.length > 2) {
                const finalPolyline = new fabric.Polyline(finalpolygonPoints, { selectable: false, evented: false, objectCaching: false });
                resetDrawingState();
                return { action: 'finishPolyline', polyline: finalPolyline };
            }
            finalpolygonPoints.push({ x: pointer.x, y: pointer.y });
            addDrawingPoint({ x: pointer.x, y: pointer.y });
            break;
    }
    return null;
}
export function handleCanvasMouseMove(o) {
    let pointer = state.canvas.getPointer(o.e);
    let liveLayoutData = null;
    let liveUnitCounts = null;

    state.liveDimensionLine = null;

    // The cancel button is now fixed, no need to move it.

    if (['drawingPlot', 'drawingBuilding', 'drawingLinearBuilding', 'drawingCorridor', 'drawingGuide', 'scaling', 'measuring'].includes(state.currentMode)) {
        const snapPoint = findSnapPoint(pointer);
        updateSnapIndicators(snapPoint);
        if (snapPoint) { pointer.x = snapPoint.x; pointer.y = snapPoint.y; }
    }

    switch (state.currentMode) {
        case 'scaling':
            if (scaleLine) {
                scaleLine.set({ x2: pointer.x, y2: pointer.y });
                state.liveDimensionLine = { p1: { x: scaleLine.x1, y: scaleLine.y1 }, p2: pointer };
            }
            break;
        case 'drawingGuide':
            if (guideLine) {
                guideLine.set({ x2: pointer.x, y2: pointer.y });
                state.liveDimensionLine = { p1: { x: guideLine.x1, y: guideLine.y1 }, p2: pointer };
            }
            break;
        case 'drawingPlot':
        case 'drawingBuilding':
        case 'drawingLinearBuilding':
        case 'drawingCorridor':
            if (currentDrawingPolygon) {
                if (polygonPoints.length > 0) {
                    state.liveDimensionLine = { p1: polygonPoints[polygonPoints.length - 1], p2: pointer };
                }
                const newPoints = [...polygonPoints, { x: pointer.x, y: pointer.y }];
                if (currentDrawingPolygon.type === 'polygon') {
                    currentDrawingPolygon.set({ points: newPoints });
                } else {
                    currentDrawingPolygon.points[currentDrawingPolygon.points.length - 1] = { x: pointer.x, y: pointer.y };
                    currentDrawingPolygon.set({ points: currentDrawingPolygon.points });
                }

                const isLinearMode = ['drawingLinearBuilding', 'drawingCorridor'].includes(state.currentMode);
                const tempFabricShape = isLinearMode ? new fabric.Polyline(newPoints) : new fabric.Polygon(newPoints);

                const props = getPolygonProperties(tempFabricShape);
                let statusText;
                if (isLinearMode) {
                    statusText = `Drawing... Length: ${f(props.perimeter, 1)} m`;
                } else {
                    statusText = `Drawing... Area: ${f(props.area)} m²`;
                }

                const isLayoutLevel = state.currentLevel === 'Typical_Floor';

                if (isLayoutLevel && state.currentMode !== 'drawingLinearBuilding' && state.currentMode !== 'drawingCorridor') {
                    const numFloors = parseInt(document.getElementById('numTypicalFloors').value) || 0;
                    const achievedGfa = props.area * numFloors;
                    const allowedGfa = parseFloat(document.getElementById('allowedGfa').value) || 0;
                    statusText += ` | Total GFA: ${f(achievedGfa)} / ${f(allowedGfa)} m²`;
                }

                if (isLayoutLevel && newPoints.length > 1 && state.currentProgram && state.projectType === 'Residential' && state.currentMode !== 'drawingCorridor') {
                    const program = state.currentProgram;
                    const totalMix = program.unitTypes.reduce((sum, t) => sum + (t.mix || 0), 0) || 1;
                    const avgFrontage = program.unitTypes.reduce((acc, unit) => acc + ((unit.frontage || 0) * ((unit.mix || 0) / totalMix)), 0);

                    if (avgFrontage > 0) {
                        const estimatedUnits = Math.floor(props.perimeter / avgFrontage);
                        const counts = allocateCountsByPercent(estimatedUnits, program.unitTypes);
                        const calcMode = document.getElementById('apartment-calc-mode').value;
                        const doubleLoaded = document.getElementById('double-loaded-corridor').checked;
                        const balconyPlacement = document.getElementById('balcony-placement').value;
                        const includeBalconiesInOffset = balconyPlacement === 'recessed';

                        liveLayoutData = layoutFlatsOnPolygon(tempFabricShape, counts, includeBalconiesInOffset, calcMode, doubleLoaded);
                        console.log('liveLayoutData');
                        console.log(liveLayoutData);

                        if (liveLayoutData?.corridorArea > 0) {
                            statusText += ` | Est. Corridor: ${f(liveLayoutData.corridorArea)} m²`;
                        }
                        liveUnitCounts = counts;
                    }
                }
                document.getElementById('status-bar').textContent = statusText;
            }
            break;
    }

    state.livePreviewLayout = liveLayoutData;
    //console.log('state.livePreviewLayout');
    //console.log(state.livePreviewLayout);
    if (liveUnitCounts) updateParkingDisplay(liveUnitCounts);
    state.canvas.requestRenderAll();
    return { liveLayoutData, liveUnitCounts };

}
export function handleMouseUp(o) {
    if (state.currentMode === 'drawingGuide' && guideLine) {
        const finalGuide = new fabric.Line([guideLine.x1, guideLine.y1, guideLine.x2, guideLine.y2], {
            stroke: guideLine.stroke, strokeWidth: guideLine.strokeWidth, strokeDashArray: guideLine.strokeDashArray,
            selectable: false, evented: false, isGuide: true, level: state.currentLevel, strokeUniform: true,
        });
        state.canvas.add(finalGuide);
        state.guideLines.push(finalGuide);
        exitAllModes();
        return;
    }
    if (state.currentMode === 'drawingParking' && parkingLine) {
        generateLinearParking(parkingStartPoint, state.canvas.getPointer(o.e));
        exitAllModes();
    }
    clearEdgeSnapIndicator();
    updateDashboard();
}

export function handleDblClick(o) {
    if ((['drawingPlot', 'drawingBuilding', 'drawingLinearBuilding', 'drawingCorridor'].includes(state.currentMode)) && polygonPoints.length > 1) {
        const pLast = polygonPoints[polygonPoints.length - 1];
        const pPrev = polygonPoints[polygonPoints.length - 2];
        if (pLast && pPrev && Math.hypot(pLast.x - pPrev.x, pLast.y - pPrev.y) < 2) {
            polygonPoints.pop();
        }
        console.log('polygonPoints.pop()');
        console.log(polygonPoints.pop());
        const isLinearMode = ['drawingLinearBuilding', 'drawingCorridor'].includes(state.currentMode);
        const finalShape = isLinearMode ?
            new fabric.Polyline(polygonPoints, { selectable: false, evented: false, objectCaching: false, fill: 'transparent' }) :
            new fabric.Polygon(polygonPoints, { selectable: false, evented: false, objectCaching: false });
        resetDrawingState();
        console.log('final shape in drawing tool.js->handle dblclick:');
        console.log(finalShape);
        handleFinishPolygon(finalShape);
    }
}

export function finishScaling() {
    if (!scaleLine) return null;
    const lengthInPixels = Math.hypot(scaleLine.x2 - scaleLine.x1, scaleLine.y2 - scaleLine.y1);
    const lengthInMetersStr = document.getElementById('scale-distance').value;
    const lengthInMeters = parseFloat(lengthInMetersStr);
    if (lengthInMetersStr && !isNaN(lengthInMeters) && lengthInMeters > 0) {
        return { pixels: lengthInPixels, meters: lengthInMeters };
    }
    return null;
}
export function drawMeasurement(ctx, p1, endPoint) {
    if (!ctx || !p1 || !endPoint || state.scale.ratio === 0) return;

    const vpt = state.canvas.viewportTransform;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // No clearing here, handleAfterRender does that
    ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.strokeStyle = '#f50057';
    ctx.lineWidth = 2 / state.canvas.getZoom();
    ctx.stroke();
    const distPixels = Math.hypot(endPoint.x - p1.x, endPoint.y - p1.y);
    const distMeters = distPixels * state.scale.ratio;
    const text = `${distMeters.toFixed(3)} m`;
    const midX = (p1.x + endPoint.x) / 2;
    const midY = (p1.y + endPoint.y) / 2;
    ctx.font = `${14 / state.canvas.getZoom()}px sans-serif`;
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = 14 / state.canvas.getZoom();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#333';
    ctx.fillRect(midX - textWidth / 2 - 5 / state.canvas.getZoom(), midY - textHeight, textWidth + 10 / state.canvas.getZoom(), textHeight + 5 / state.canvas.getZoom());
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, midX, midY - textHeight / 2 + 2 / state.canvas.getZoom());
    ctx.restore();
}

// --- NEW POLYGON EDITING LOGIC ---

// Position handler for vertex controls
function polygonPositionHandler(dim, finalMatrix, fabricObject) {
    const pointIndex = this.pointIndex;
    const point = fabricObject.points[pointIndex];
    const adjustedPoint = { x: point.x - fabricObject.pathOffset.x, y: point.y - fabricObject.pathOffset.y };
    return fabric.util.transformPoint(adjustedPoint, fabric.util.multiplyTransformMatrices(fabricObject.canvas.viewportTransform, fabricObject.calcTransformMatrix()));
}

// Position handler for midpoint controls
function midpointPositionHandler(dim, finalMatrix, fabricObject) {
    const pointIndex = this.pointIndex;
    const p1 = fabricObject.points[pointIndex];
    const p2 = fabricObject.points[(pointIndex + 1) % fabricObject.points.length];
    const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const adjustedMidpoint = { x: midpoint.x - fabricObject.pathOffset.x, y: midpoint.y - fabricObject.pathOffset.y };
    return fabric.util.transformPoint(adjustedMidpoint, fabric.util.multiplyTransformMatrices(fabricObject.canvas.viewportTransform, fabricObject.calcTransformMatrix()));
}

// Position handler for remove controls
function removePositionHandler(dim, finalMatrix, fabricObject) {
    const pointIndex = this.pointIndex;
    const point = fabricObject.points[pointIndex];
    const adjustedPoint = { x: point.x - fabricObject.pathOffset.x, y: point.y - fabricObject.pathOffset.y };
    const transformedPoint = fabric.util.transformPoint(adjustedPoint, fabric.util.multiplyTransformMatrices(fabricObject.canvas.viewportTransform, fabricObject.calcTransformMatrix()));
    const offset = 15;
    const angle = fabric.util.degreesToRadians(fabricObject.angle);
    const offsetX = Math.cos(angle + Math.PI / 4) * offset;
    const offsetY = Math.sin(angle + Math.PI / 4) * offset;
    return { x: transformedPoint.x - offsetX, y: transformedPoint.y - offsetY };
}

// Action handler for moving a vertex
function actionHandler(eventData, transform, x, y) {
    const polygon = transform.target;
    const currentControl = polygon.controls[transform.corner];
    const pointIndex = currentControl.pointIndex;

    const mouseLocalPosition = polygon.toLocalPoint(new fabric.Point(x, y), 'center', 'center');
    const finalPointPosition = {
        x: mouseLocalPosition.x + polygon.pathOffset.x,
        y: mouseLocalPosition.y + polygon.pathOffset.y
    };
    polygon.points[pointIndex] = finalPointPosition;
    const props = getPolygonProperties(polygon);
    document.getElementById('status-bar').textContent = `Editing... Area: ${f(props.area)} m² | Perimeter: ${f(props.perimeter, 1)} m`;
    return true;
}

// --- CUSTOM RENDERING FOR CONTROLS ---
function renderCircleControl(ctx, left, top, styleOverride, fabricObject) {
    const size = fabricObject.cornerSize;
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
    ctx.fillStyle = styleOverride.cornerColor || fabricObject.cornerColor;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
}

function renderPlusControl(ctx, left, top, styleOverride, fabricObject) {
    const size = fabricObject.cornerSize * 0.9;
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
    ctx.fillStyle = '#1a90ff';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size / 4, 0); ctx.lineTo(size / 4, 0);
    ctx.moveTo(0, -size / 4); ctx.lineTo(0, size / 4);
    ctx.stroke();
    ctx.restore();
}

function renderRemoveControl(ctx, left, top, styleOverride, fabricObject) {
    const size = fabricObject.cornerSize * 0.7;
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    const crossSize = size / 4;
    ctx.beginPath();
    ctx.moveTo(-crossSize, -crossSize); ctx.lineTo(crossSize, crossSize);
    ctx.moveTo(crossSize, -crossSize); ctx.lineTo(-crossSize, crossSize);
    ctx.stroke();
    ctx.restore();
}

export function refreshEditablePolygon(polygon) {
    const controls = {};
    const isPolyline = polygon.type === 'polyline';
    const numPoints = polygon.points.length;

    polygon.points.forEach((point, index) => {
        // Vertex controls
        controls[`p${index}`] = new fabric.Control({
            positionHandler: polygonPositionHandler,
            actionHandler: actionHandler,
            actionName: 'modifyPolygon',
            pointIndex: index,
            render: renderCircleControl,
        });

        // Midpoint controls (don't add one for the last segment of a polyline)
        if (!(isPolyline && index === numPoints - 1)) {
            controls[`m${index}`] = new fabric.Control({
                positionHandler: midpointPositionHandler,
                actionName: 'addPolygonPoint',
                pointIndex: index,
                render: renderPlusControl,
                mouseDownHandler: (eventData, transform) => {
                    const poly = transform.target;
                    const currentControl = poly.controls[transform.corner];
                    const pointIndex = currentControl.pointIndex;
                    const p1 = poly.points[pointIndex];
                    const p2 = poly.points[(pointIndex + 1) % poly.points.length];
                    const newPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                    poly.points.splice(pointIndex + 1, 0, newPoint);
                    refreshEditablePolygon(poly);
                    state.canvas.requestRenderAll();
                    state.canvas.fire('mouse:up'); // <-- FIX: Release the mouse
                    return true;
                }
            });
        }

        // Remove controls
        controls[`r${index}`] = new fabric.Control({
            positionHandler: removePositionHandler,
            actionName: 'removePolygonPoint',
            pointIndex: index,
            render: renderRemoveControl,
            mouseDownHandler: (eventData, transform) => {
                const poly = transform.target;
                const minPoints = poly.type === 'polyline' ? 2 : 3;
                if (poly.points.length <= minPoints) return false;

                const currentControl = poly.controls[transform.corner];
                const pointIndex = currentControl.pointIndex;
                poly.points.splice(pointIndex, 1);
                refreshEditablePolygon(poly);
                state.canvas.requestRenderAll();
                state.canvas.fire('mouse:up'); // <-- FIX: Release the mouse
                return true;
            },
        });
    });
    polygon.controls = controls;
    polygon.hasBorders = false;
    polygon.setCoords();
}

export function makeFootprintEditable(polygon) {
    if (!polygon || !polygon.points) return;
    polygon.set({
        objectCaching: false, transparentCorners: false, cornerColor: '#007bff', cornerSize: 16,
        lockMovementX: true, lockMovementY: true, lockScalingX: true,
        lockScalingY: true, lockRotation: true, selectable: true, evented: true
    });

    refreshEditablePolygon(polygon);

    //polygon.on('modified', () => {const { min, max } = fabric.util.getBoundsOfPoints(polygon.points);
    // polygon.set({pathOffset: { x: min.x + (max.x - min.x) / 2, y: min.y + (max.y - min.y) / 2 },width: max.x - min.x, height: max.y - min.y,}).setCoords();
    //handleObjectModified({ target: polygon });
    //});
    polygon.setCoords();
}

export function makeFootprintUneditable(polygon) {
    if (!polygon) return;
    polygon.controls = fabric.Object.prototype.controls;
    polygon.off('modified');
    polygon.set({
        hasBorders: true,
        objectCaching: true,
        hasControls: true,
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: false,
    });

    // If it's a plot, always lock it after editing
    if (polygon.isPlot) {
        polygon.set({
            selectable: false,
            evented: false
        });
    }

    polygon.setCoords();
    state.canvas.requestRenderAll();
}

export function placeServiceBlock(pointer, blockKeyOrData, levelOverride = null) {
    let blockData;
    if (typeof blockKeyOrData === 'string') {
        blockData = PREDEFINED_BLOCKS[blockKeyOrData];
    } else {
        blockData = blockKeyOrData;
    }

    if (!blockData || !state.scale.ratio) return;
    const blockWidth = blockData.width / state.scale.ratio;
    const blockHeight = blockData.height / state.scale.ratio;
    const colors = BLOCK_CATEGORY_COLORS[blockData.category || 'default'];
    const blockId = `SB-${state.serviceBlockCounter++}`;
    const rect = new fabric.Rect({ width: blockWidth, height: blockHeight, fill: colors.fill, stroke: colors.stroke, strokeWidth: 2, originX: 'center', originY: 'center', strokeUniform: true });
    const label = new fabric.Text(blockId, { fontSize: Math.min(blockWidth, blockHeight) * 0.2, fill: '#fff', backgroundColor: 'rgba(0,0,0,0.4)', originX: 'center', originY: 'center' });
    const lockIcon = new fabric.Text("🔒", { fontSize: Math.min(blockWidth, blockHeight) * 0.2, left: Math.min(blockWidth, blockHeight) * 0.2, originY: 'center', visible: true });

    const group = new fabric.Group([rect, label, lockIcon], {
        left: pointer.x,
        top: pointer.y,
        originX: 'center',
        originY: 'center',
        isServiceBlock: true,
        blockData: { ...blockData }, // Use a copy
        blockId: blockId,
        level: levelOverride || state.currentLevel,
        selectable: true,
        evented: true,
        lockScalingX: true,
        lockScalingY: true,
    });
    state.serviceBlocks.push(group);
    state.canvas.add(group);
    return group;
}

export function createCompositeGroup(compositeData, pointer) {
    if (!compositeData || state.scale.ratio === 0) return;
    const items = [];
    const compositeLevel = compositeData.level || state.currentLevel;
    compositeData.blocks.forEach(blockDef => {
        const blockData = PREDEFINED_BLOCKS[blockDef.key];
        if (!blockData) return;
        const blockWidth = (blockDef.w ?? blockData.width) / state.scale.ratio;
        const blockHeight = (blockDef.h ?? blockData.height) / state.scale.ratio;
        const colors = BLOCK_CATEGORY_COLORS[blockData.category || 'default'];
        const blockId = `SB-${state.serviceBlockCounter++}`;
        const rect = new fabric.Rect({ width: blockWidth, height: blockHeight, fill: colors.fill, stroke: colors.stroke, strokeWidth: 2, originX: 'center', originY: 'center', strokeUniform: true });
        const label = new fabric.Text(blockId, { fontSize: Math.min(blockWidth, blockHeight) * 0.2, fill: '#fff', backgroundColor: 'rgba(0,0,0,0.4)', originX: 'center', originY: 'center' });

        const x_px = (blockDef.x || 0) / state.scale.ratio;
        const y_px = (blockDef.y || 0) / state.scale.ratio;

        const subGroup = new fabric.Group([rect, label], {
            isServiceBlock: true, blockData: { ...blockData }, blockId: blockId, level: compositeLevel,
            left: x_px + blockWidth / 2, top: y_px + blockHeight / 2,
            selectable: false, evented: false
        });

        state.serviceBlocks.push(subGroup);
        items.push(subGroup);
    });
    const compositeGroup = new fabric.Group(items, { left: pointer.x, top: pointer.y, level: compositeLevel, isCompositeGroup: true, compositeDefName: compositeData.name });
    state.canvas.add(compositeGroup);
    return compositeGroup;
}

// ============================================
// NEW: Alignment & Scaling Tools
// ============================================

const TOOL_MODES = {
    NONE: 'none',
    ALIGN_SCALE: 'alignScale',
    MOVE_ORIGIN: 'moveOrigin',
    SCALE_GEOMETRY: 'scaleGeometry'
};

let currentAlignmentMode = TOOL_MODES.NONE;
let alignmentPoints = [];
let alignmentPhase = 'pdf'; // Track if we're selecting PDF points ('pdf') or geometry points ('geometry')

// NEW: Align & Scale Tool
export function activateAlignScaleTool() {
    currentAlignmentMode = TOOL_MODES.ALIGN_SCALE;
    alignmentPoints = [];
    alignmentPhase = 'pdf';
    state.currentMode = 'alignScale'; // Set mode for eventHandlers detection

    const canvas = state.canvas;
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
        'Alignment Mode: Click 3 points on the PDF background';

    showAlignmentToolPanel();

    // Hide geometry to focus on PDF
    setGeometryVisibility(false);
}

function setGeometryVisibility(visible) {
    const canvas = state.canvas;
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock || obj.type === 'polyline' || obj.isPlot || obj.isGuide) {
            obj.set({ visible: visible });
        }
    });
    canvas.renderAll();
}

function setBackgroundVisibility(visible) {
    if (state.canvas.backgroundImage) {
        state.canvas.backgroundImage.set({ visible: visible });
        state.canvas.renderAll();
    }
}

// NEW: Move Origin Tool
export function activateMoveOriginTool() {
    currentAlignmentMode = TOOL_MODES.MOVE_ORIGIN;
    state.currentMode = 'moveOrigin'; // Set mode for eventHandlers detection

    const canvas = state.canvas;
    canvas.hoverCursor = 'move';
    canvas.selection = false;

    // Allow moving PDF background
    if (state.pdfBackgroundImage) {
        state.pdfBackgroundImage.selectable = true;
        state.pdfBackgroundImage.evented = true;
    }

    document.getElementById('status-bar').textContent =
        'Move Origin: Drag the PDF or architecture tools to align to origin (0,0)';
}

// NEW: Scale Geometry Tool
export function activateScaleGeometryTool() {
    currentAlignmentMode = TOOL_MODES.SCALE_GEOMETRY;
    alignmentPoints = [];
    state.currentMode = 'scaleGeometry'; // Set mode for eventHandlers detection

    const canvas = state.canvas;
    canvas.hoverCursor = 'help';
    canvas.selection = false;

    document.getElementById('status-bar').textContent =
        'Scale Geometry: Click 2 reference points on geometry, then enter known distance to scale';

    showScaleGeometryPanel();
}

// Helper: Show alignment panel
function showAlignmentToolPanel() {
    const toolPanel = document.getElementById('tool-panel-content');
    if (!toolPanel) return;
    toolPanel.style.display = 'block';

    const html = `
        <div style="padding:15px; background-color:#e3f2fd; border-radius:4px;">
            <h4 style="margin:0 0 10px 0;">3-Point Align & Scale</h4>
            <p style="margin:0 0 10px 0; font-size:0.9em; font-weight:bold; color:#1976d2;">
                Step 1: Click 3 points on PDF
            </p>
            <p style="margin:0 0 10px 0; font-size:0.85em; color:#666;">
                Select 3 reference points on the PDF background (e.g., corners or known landmarks)
            </p>
            <div style="margin-bottom:10px;">
                <button onclick="window.alignmentReset()" style="padding:8px 12px; background-color:#ff9800; color:white; border:none; border-radius:4px; cursor:pointer; width:100%;">
                    Reset All Points
                </button>
            </div>
            <div id="alignment-points-status" style="font-size:0.9em; color:#1976d2; font-weight:bold; text-align:center; padding:10px; background-color:#fff; border-radius:3px;">PDF Point 1/3</div>
        </div>
    `;

    toolPanel.innerHTML = html;
    window.alignmentReset = () => {
        alignmentPoints = [];
        alignmentPhase = 'pdf';
        const status = document.getElementById('alignment-points-status');
        if (status) status.textContent = 'PDF Point 1/3';
        document.getElementById('status-bar').textContent = 'Click 3 points on the PDF background';
    };
}

// Helper: Show scale geometry panel
function showScaleGeometryPanel() {
    const toolPanel = document.getElementById('tool-panel-content');
    if (!toolPanel) return;
    toolPanel.style.display = 'block';

    const html = `
        <div style="padding:15px; background-color:#f3e5f5; border-radius:4px;">
            <h4 style="margin:0 0 10px 0;">Scale Geometry</h4>
            <p style="margin:0 0 10px 0; font-size:0.9em;">
                Click 2 reference points on geometry, then enter the real-world distance between them
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

    toolPanel.innerHTML = html;
    window.alignmentReset = () => {
        alignmentPoints = [];
        const status = document.getElementById('scale-points-status');
        if (status) status.textContent = 'Points selected: 0/2';
    };

    window.scaleGeometryApply = () => {
        if (alignmentPoints.length !== 2) {
            document.getElementById('status-bar').textContent = 'Error: Select exactly 2 points first';
            return;
        }
        const distance = parseFloat(document.getElementById('reference-distance').value);
        if (!distance || distance <= 0) {
            document.getElementById('status-bar').textContent = 'Error: Enter a valid distance';
            return;
        }
        applyScaleGeometry(distance);
    };
}

// NEW: Handle alignment point selection via canvas click
export function handleAlignmentPointSelect(point) {
    if (currentAlignmentMode === TOOL_MODES.ALIGN_SCALE) {
        alignmentPoints.push(point);
        const status = document.getElementById('alignment-points-status');

        if (alignmentPhase === 'pdf') {
            const pdfCount = alignmentPoints.length;
            if (status) status.textContent = `PDF Point ${pdfCount}/3`;

            if (pdfCount === 3) {
                // Switch to geometry phase
                alignmentPhase = 'geometry';
                document.getElementById('status-bar').textContent =
                    'Now click 3 corresponding points on your geometry (same order as PDF points)';
                if (status) status.textContent = 'Geometry Point 1/3';

                // Toggle visibility: Show geometry, hide PDF
                setGeometryVisibility(true);
                setBackgroundVisibility(false);
            }
        } else if (alignmentPhase === 'geometry') {
            const geomCount = alignmentPoints.length - 3;
            if (status) status.textContent = `Geometry Point ${geomCount}/3`;

            if (alignmentPoints.length === 6) {
                // All points selected, apply alignment
                applyAlignment();
            }
        }
    } else if (currentAlignmentMode === TOOL_MODES.SCALE_GEOMETRY) {
        alignmentPoints.push(point);
        const status = document.getElementById('scale-points-status');
        if (status) status.textContent = `Points selected: ${alignmentPoints.length}/2`;
    }
}

// Apply alignment transformation using 3-point affine registration
function applyAlignment() {
    // First 3 points are PDF points, last 3 are geometry points
    const pdfPoints = alignmentPoints.slice(0, 3);
    const geomPoints = alignmentPoints.slice(3, 6);

    // Validate points
    if (!pdfPoints.every(p => p.x !== undefined && p.y !== undefined) ||
        !geomPoints.every(p => p.x !== undefined && p.y !== undefined)) {
        document.getElementById('status-bar').textContent = 'Error: Invalid points';
        return;
    }

    // Calculate affine transformation matrix from geometry to PDF space
    const affineMatrix = calculateAffineTransform(geomPoints, pdfPoints);

    if (!affineMatrix) {
        document.getElementById('status-bar').textContent = 'Error: Points are collinear, cannot calculate transformation';
        return;
    }

    // Apply transformation to all geometry
    applyAffineTransform(affineMatrix);

    document.getElementById('status-bar').textContent =
        `✓ Alignment applied: Geometry aligned and scaled to match PDF reference points`;

    exitAlignmentMode();
}

// Calculate 2D affine transformation matrix from source to destination points
function calculateAffineTransform(srcPoints, dstPoints) {
    // src and dst should each be 3 points: [{x, y}, {x, y}, {x, y}]
    if (srcPoints.length !== 3 || dstPoints.length !== 3) return null;

    const [s0, s1, s2] = srcPoints;
    const [d0, d1, d2] = dstPoints;

    // Build system of equations: [a b tx] * [src_x]   [dst_x]
    //                            [c d ty]   [src_y] = [dst_y]
    //                            [0 0  1]   [ 1  ]   [ 1  ]

    const denom = (s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y));

    if (Math.abs(denom) < 1e-10) return null; // Points are collinear

    const a = ((d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom);
    const b = ((d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom);
    const c = ((d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom);
    const d = ((d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom);
    const tx = d0.x - a * s0.x - b * s0.y;
    const ty = d0.y - c * s0.x - d * s0.y;

    return { a, b, c, d, tx, ty };
}

// Apply affine transformation to all geometry
function applyAffineTransform(matrix) {
    const canvas = state.canvas;
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock || obj.type === 'polyline') {
            if (obj.points) {
                obj.points = obj.points.map(p => {
                    const x = matrix.a * p.x + matrix.b * p.y + matrix.tx;
                    const y = matrix.c * p.x + matrix.d * p.y + matrix.ty;
                    return { x, y };
                });
                obj.setCoords();
            }
        }
    });
    canvas.renderAll();
}

// Apply scale from reference distance
function applyScaleGeometry(realDistance) {
    const [p1, p2] = alignmentPoints;

    const pixelDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (pixelDist === 0) {
        document.getElementById('status-bar').textContent = 'Invalid points selected';
        return;
    }

    const scaleFactor = realDistance / pixelDist;
    scaleAllGeometry(scaleFactor);

    document.getElementById('status-bar').textContent =
        `✓ Geometry scaled: ${scaleFactor.toFixed(4)}x (${realDistance}m / ${pixelDist.toFixed(2)}px)`;

    exitAlignmentMode();
}

// Helper: Scale all geometry
function scaleAllGeometry(factor) {
    const canvas = state.canvas;
    canvas.forEachObject(obj => {
        if (obj.isFootprint || obj.isPolygon || obj.isBlock || obj.type === 'polyline') {
            if (obj.points) {
                obj.points = obj.points.map(p => ({
                    x: p.x * factor,
                    y: p.y * factor
                }));
                obj.setCoords();
            }
        }
    });
    canvas.renderAll();
}

// Exit alignment mode and restore selection
export function exitAlignmentMode() {
    currentAlignmentMode = TOOL_MODES.NONE;
    alignmentPoints = [];
    alignmentPhase = 'pdf';
    state.currentMode = null; // Clear mode
    const canvas = state.canvas;
    canvas.selection = true;
    canvas.hoverCursor = 'auto';

    // Restore visibility
    setGeometryVisibility(true);
    setBackgroundVisibility(true);
}

export function makeParkingEditable(group) {
    if (!group || !group.isParkingRow) return;

    // First ensure it's not scaled - we work with unscaled groups for parametric editing
    const width = group.getScaledWidth();
    group.set({
        scaleX: 1,
        scaleY: 1,
        width: width,
        originX: 'center',
        originY: 'center',
        hasControls: true,
        lockScalingY: true,
        lockRotation: true,
        lockMovementX: true, // Don't move the whole location while editing handles
        lockMovementY: true,
        selectable: true,
        evented: true,
        cornerColor: '#ffc107',
        cornerStyle: 'circle',
        transparentCorners: false
    });

    const controls = {};

    controls.start = new fabric.Control({
        x: -0.5,
        y: 0,
        actionHandler: parkingHandleActionHandler,
        cursorStyle: 'pointer',
        actionName: 'parkingEditStart',
        render: renderParkingHandle
    });

    controls.end = new fabric.Control({
        x: 0.5,
        y: 0,
        actionHandler: parkingHandleActionHandler,
        cursorStyle: 'pointer',
        actionName: 'parkingEditEnd',
        render: renderParkingHandle
    });

    group.controls = controls;
    group.setCoords();
    state.canvas.requestRenderAll();
}

export function makeParkingUneditable(group) {
    if (!group) return;
    group.controls = fabric.Object.prototype.controls;
    group.set({
        lockScalingY: true,
        lockRotation: false,
        lockMovementX: false,
        lockMovementY: false,
        hasControls: true
    });
    group.setCoords();
    state.canvas.requestRenderAll();
}

function renderParkingHandle(ctx, left, top, styleOverride, fabricObject) {
    const size = 24; // Slightly larger
    ctx.save();
    ctx.translate(left, top);
    ctx.fillStyle = '#ffc107'; // Amber
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function parkingHandleActionHandler(eventData, transform, x, y) {
    const group = transform.target;

    // Capture the fixed point (the other handle) at the start of the interaction
    if (!transform.otherPointAbs) {
        const isStart = transform.corner === 'start';
        const angleRad = group.angle * Math.PI / 180;
        const halfWidth = group.width / 2;
        const otherPointRel = { x: isStart ? halfWidth : -halfWidth, y: 0 };

        transform.otherPointAbs = {
            x: group.left + (otherPointRel.x * Math.cos(angleRad) - otherPointRel.y * Math.sin(angleRad)),
            y: group.top + (otherPointRel.x * Math.sin(angleRad) + otherPointRel.y * Math.cos(angleRad))
        };
    }

    const isStart = transform.corner === 'start';
    const pointer = state.canvas.getPointer(eventData);
    const otherPt = transform.otherPointAbs;

    const p1 = isStart ? pointer : otherPt;
    const p2 = isStart ? otherPt : pointer;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const newLength = Math.max(1, Math.hypot(dx, dy));
    const newAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const newCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    if (isNaN(newCenter.x) || isNaN(newCenter.y)) return false;

    // Update group properties
    group.set({
        left: newCenter.x,
        top: newCenter.y,
        angle: newAngle,
        width: newLength,
        scaleX: 1, // Ensure scale remains 1
        scaleY: 1
    });

    // Use global or imported function
    const regenFunc = (typeof regenerateParkingInGroup !== 'undefined') ? regenerateParkingInGroup : window.regenerateParkingInGroup;
    if (regenFunc) {
        regenFunc(group, state.scale.ratio);
    }

    // Safety: ensure center is exactly where we calculated
    group.set({
        left: newCenter.x,
        top: newCenter.y
    });

    group.setCoords();
    state.canvas.requestRenderAll();
    return true;
}
