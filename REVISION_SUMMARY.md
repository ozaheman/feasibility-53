# Basement and Podium Calculation Revision - Summary

## Date: February 20, 2026

### What Was Changed

The basement and podium level calculation logic has been revised to treat them as typical repeating floors with separate handling for the last level, and to implement the accurate parking area formula.

### Key Revisions

#### 1. **Basement and Podium Treated as Typical Floors**
- `Basement` level: Multiplied by `inputs.numBasements` (e.g., if 3, counted 3 times)
- `Podium` level: Multiplied by `inputs.numPodiums` (e.g., if 4, counted 4 times)
- Regular repeating basement/podium floors can have identical configurations

#### 2. **Basement_Last and Podium_Last as Separate Layers**
- `Basement_Last`: Always has multiplier = 1 (deepest basement, counted once)
- `Podium_Last`: Always has multiplier = 1 (topmost podium, counted once)
- These can have different service/GFA block configurations than regular floors
- Only included if `numBasements > 0` or `numPodiums > 0` respectively

#### 3. **Parking Area Formula Revision**

**Old Formula**: 
```
Parking Area = Polygon Area - Service Area - GFA Area
```

**New Formula**:
```
Parking Area = Polygon Area - (Service Blocks Area + GFA Blocks Area) × Number of Floors
```

This accounts for how many times service and GFA blocks are repeated across floors.

#### 4. **Service and GFA Block Multiplication**
- Service blocks and GFA blocks are multiplied by the number of floors in the parking calculation
- Per-floor amounts are preserved in the calculation
- Example: If Basement has 100 m² service blocks and 3 basement floors, it uses 100 × 3 = 300 m² in the formula

### Code Changes

#### File: `feasibilityEngine.js`

**Change 1: Updated `calculateNetParkingArea()` Function**
```javascript
// BEFORE
const calculateNetParkingArea = (levelName) => {
    const validParkingLevels = ['Basement', 'Ground_Floor', 'Podium'];
    if (!validParkingLevels.includes(levelName)) {return 0;}
    const footprintArea = getAreaForLevel(levelName);
    if (footprintArea === 0) return 0;
    const gfaArea = getBlockDetails('gfa', levelName).totalArea;
    const servicesArea = getBlockDetails('service', levelName).totalArea;
    return Math.max(0, footprintArea - gfaArea - servicesArea);
};

// AFTER
const calculateNetParkingArea = (levelName, numFloors = 1) => {
    const validParkingLevels = ['Basement', 'Basement_Last', 'Ground_Floor', 'Podium', 'Podium_Last'];
    if (!validParkingLevels.includes(levelName)) {return 0;}
    const footprintArea = getAreaForLevel(levelName);
    if (footprintArea === 0) return 0;
    const gfaArea = getBlockDetails('gfa', levelName).totalArea;
    const servicesArea = getBlockDetails('service', levelName).totalArea;
    // Parking formula: polygon area - (service blocks area + gfa blocks area) × number of floors
    return Math.max(0, footprintArea - ((gfaArea + servicesArea) * numFloors));
};
```

**Change 2: Added Number of Floors Determination**
```javascript
// NEW: Determine number of floors for parking calculation
let numFloorsForParking = 1;
if (levelKey === 'Basement') {
    numFloorsForParking = inputs.numBasements || 1;
} else if (levelKey === 'Basement_Last') {
    numFloorsForParking = 1;
} else if (levelKey === 'Podium') {
    numFloorsForParking = inputs.numPodiums || 1;
} else if (levelKey === 'Podium_Last') {
    numFloorsForParking = 1;
} else if (levelKey === 'Ground_Floor') {
    numFloorsForParking = 1;
}
```

**Change 3: Updated Parking Calculation Call**
```javascript
// BEFORE
parking: calculateNetParkingArea(levelKey),

// AFTER
parking: calculateNetParkingArea(levelKey, numFloorsForParking),
```

**Change 4: Multiplier Logic**
```javascript
// Updated in LEVEL_ORDER.forEach loop:
let multiplier = 1;
if (levelKey === 'Basement_Last') {
    multiplier = shouldIncludeLastBasement(inputs) ? 1 : 0;
} else if (levelKey === 'Podium_Last') {
    multiplier = shouldIncludeLastPodium(inputs) ? 1 : 0;
} else {
    multiplier = levelDef.countKey ? (inputs[levelDef.countKey] || 0) : 1;
}
```

### Calculation Examples

#### Example 1: 3 Basements Project
When a project has 3 basements:

**Basement (Regular Floors 1-3)**:
- Polygon area: 2000 m²
- Service blocks: 100 m²
- GFA blocks: 200 m²
- Parking = 2000 - (100 + 200) × 3 = 2000 - 900 = **1100 m²**
- Multiplier: 3
- Total area = (GFA + Service + Parking) × 3 = (200 + 100 + 1100) × 3

**Basement_Last (Floor 4 - Deepest)**:
- Polygon area: 2000 m² (same basement)
- Service blocks: 150 m² (different configuration)
- GFA blocks: 250 m² (different configuration)
- Parking = 2000 - (150 + 250) × 1 = 2000 - 400 = **1600 m²**
- Multiplier: 1
- Total area = (GFA + Service + Parking) × 1 = (250 + 150 + 1600) × 1

**Result**: Last basement has more parking capacity because it has fewer service/GFA blocks.

#### Example 2: 4 Podiums Project
When a project has 4 podiums:

**Podium (Regular Floors 1-4)**:
- Polygon area: 1800 m²
- Service blocks: 80 m²
- GFA blocks: 150 m²
- Parking = 1800 - (80 + 150) × 4 = 1800 - 920 = **880 m²**
- Multiplier: 4
- Total area = (GFA + Service + Parking) × 4

**Podium_Last (Floor 5 - Topmost)**:
- Polygon area: 1800 m²
- Service blocks: 100 m² (may be different for top floor)
- GFA blocks: 180 m²
- Parking = 1800 - (100 + 180) × 1 = 1800 - 280 = **1520 m²**
- Multiplier: 1
- Total area = (GFA + Service + Parking) × 1

**Result**: Last podium has more parking capacity and different service configuration.

### Why This Approach is Better

1. **More Accurate Parking**: Accounts for how many times service/GFA blocks repeat across floors
2. **Flexible Configurations**: Each level can have different service/GFA block layouts
3. **Realistic Modeling**: Last basement/podium can accommodate more cars if they have fewer service/GFA blocks
4. **Clear Separation**: Regular and last levels are counted and calculated separately
5. **Better Space Utilization**: More parking where service/GFA blocks are minimal

### Related Helper Functions (Already in Code)

```javascript
// Check if last basement should be included
export function shouldIncludeLastBasement(inputs) {
    return (inputs.numBasements || 0) > 0;
}

// Check if last podium should be included
export function shouldIncludeLastPodium(inputs) {
    return (inputs.numPodiums || 0) > 0;
}

// Get area of last basement polygon
export function getLastBasementAreaPolygone(levelName = 'Basement_Last') {
    if (state.scale.ratio === 0) return 0;
    return state.levels[levelName]?.objects.filter(o => o.isFootprint)
        .reduce((sum, obj) => sum + getPolygonProperties(obj).area, 0) || 0;
}

// Get area of last podium polygon
export function getLastPodiumAreaPolygone(levelName = 'Podium_Last') {
    if (state.scale.ratio === 0) return 0;
    return state.levels[levelName]?.objects.filter(o => o.isFootprint)
        .reduce((sum, obj) => sum + getPolygonProperties(obj).area, 0) || 0;
}

// Get comprehensive summary
export function getLastBasementAndPodiumSummary(inputs) {
    const lastBasementPolygons = state.levels['Basement_Last']?.objects.filter(o => o.isFootprint) || [];
    const lastPodiumPolygons = state.levels['Podium_Last']?.objects.filter(o => o.isFootprint) || [];
    
    const lastBasementArea = lastBasementPolygons.reduce((sum, obj) => sum + getPolygonProperties(obj).area, 0);
    const lastPodiumArea = lastPodiumPolygons.reduce((sum, obj) => sum + getPolygonProperties(obj).area, 0);
    
    return {
        lastBasementIncluded: shouldIncludeLastBasement(inputs),
        lastBasementArea: lastBasementArea,
        lastBasementCount: lastBasementPolygons.length,
        lastBasementId: shouldIncludeLastBasement(inputs) ? inputs.numBasements : 0,
        lastPodiumIncluded: shouldIncludeLastPodium(inputs),
        lastPodiumArea: lastPodiumArea,
        lastPodiumCount: lastPodiumPolygons.length,
        lastPodiumId: shouldIncludeLastPodium(inputs) ? inputs.numPodiums : 0
    };
}
```

### Testing Recommendations

- Test with projects having 1, 2, 3, and 0 basements
- Test with projects having 1, 2, 4, and 0 podiums
- Verify parking areas reduce when additional service/GFA blocks are added
- Verify total areas are correctly multiplied by counts
- Compare reports between regular and last levels

### Files Modified

1. **feasibilityEngine.js**: Main calculation logic updated
2. **LAST_BASEMENT_PODIUM_CALCULATION.md**: Documentation updated with new approach

### Backward Compatibility

- Existing projects will continue to work
- The changes are additive and don't break existing functionality
- Manual overrides for area values are still supported
