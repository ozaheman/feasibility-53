# Last Basement and Last Podium Calculation - Revised Approach

## Overview
This document describes the revised implementation of calculating basement and podium levels in the feasibility calculation, treating them as repeated typical floors with separate handling for the last level.

## Key Principles

1. **Basement & Podium as Typical Floors**: Regular `Basement` and `Podium` levels are treated as repeating typical floors (multiplied by `numBasements` and `numPodiums` respectively)

2. **Last Level Separation**: `Basement_Last` and `Podium_Last` are counted separately as single floors (multiplier = 1), allowing different configurations for the deepest basement and topmost podium

3. **Service & GFA Blocks Multiplication**: Service blocks and GFA blocks are multiplied by the number of floors in the parking calculation

4. **Parking Area Formula**:
   ```
   Parking Area = Polygon Area - (Service Blocks Area + GFA Blocks Area) × Number of Floors
   ```

## Implementation Details

### 1. Multiplier Logic

**For Regular Basement and Podium**:
- `Basement`: multiplier = `inputs.numBasements` (e.g., 3 if there are 3 regular basements)
- `Podium`: multiplier = `inputs.numPodiums` (e.g., 4 if there are 4 regular podiums)

**For Last Basement and Last Podium**:
- `Basement_Last`: multiplier = 1 (only if `numBasements > 0`)
- `Podium_Last`: multiplier = 1 (only if `numPodiums > 0`)

### 2. Number of Floors for Parking Calculation

The `numFloorsForParking` determines how many times the service and GFA blocks are counted when calculating parking:

```javascript
let numFloorsForParking = 1;
if (levelKey === 'Basement') {
    numFloorsForParking = inputs.numBasements || 1;
} else if (levelKey === 'Basement_Last') {
    numFloorsForParking = 1;
} else if (levelKey === 'Podium') {
    numFloorsForParking = inputs.numPodiums || 1;
} else if (levelKey === 'Podium_Last') {
    numFloorsForParking = 1;
}
```

### 3. Parking Calculation Function

```javascript
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

## Calculation Examples

### Example 1: Project with 3 Basements

**Basement (Regular) Level**:
- Polygon area: 2000 m²
- Service blocks: 100 m²
- GFA blocks: 200 m²
- Number of floors: 3 (from `inputs.numBasements`)
- Parking area = 2000 - (100 + 200) × 3 = 2000 - 900 = **1100 m²**
- Total area per floor = (common GFA: 200 + service: 100 + parking: 1100) = 1400 m² per floor
- Total area = 1400 × 3 = **4200 m²** for 3 basement floors

**Basement_Last (Deepest) Level**:
- Polygon area: 2000 m²
- Service blocks: 150 m² (different configuration)
- GFA blocks: 250 m² (different configuration)
- Number of floors: 1 (only the last basement)
- Parking area = 2000 - (150 + 250) × 1 = 2000 - 400 = **1600 m²**
- Total area per floor = (common GFA: 250 + service: 150 + parking: 1600) = 2000 m² per floor
- Total area = 2000 × 1 = **2000 m²** for the last basement

**Total Basement Area** = 4200 + 2000 = **6200 m²**
**Total Basement Parking** = 1100 + 1600 = **2700 m²**

### Example 2: Project with 4 Podiums

**Podium (Regular) Level**:
- Polygon area: 1800 m²
- Service blocks: 80 m²
- GFA blocks: 150 m²
- Number of floors: 4 (from `inputs.numPodiums`)
- Parking area = 1800 - (80 + 150) × 4 = 1800 - 920 = **880 m²**
- Total area per floor = (GFA: 150 + service: 80 + parking: 880) = 1110 m² per floor
- Total area = 1110 × 4 = **4440 m²** for 4 podium floors

**Podium_Last (Topmost) Level**:
- Polygon area: 1800 m²
- Service blocks: 100 m² (additional configuration for top floor)
- GFA blocks: 180 m² (additional configuration for top floor)
- Number of floors: 1 (only the last/top podium)
- Parking area = 1800 - (100 + 180) × 1 = 1800 - 280 = **1520 m²**
- Total area per floor = (GFA: 180 + service: 100 + parking: 1520) = 1800 m² per floor
- Total area = 1800 × 1 = **1800 m²** for the last podium

**Total Podium Area** = 4440 + 1800 = **6240 m²**
**Total Podium Parking** = 3520 + 1520 = **5040 m²**

### Example 3: Project with 0 Basements and 0 Podiums

- `Basement_Last` is excluded (multiplier = 0)
- `Podium_Last` is excluded (multiplier = 0)
- Only included basement and podium floors are calculated

## Key Changes from Previous Implementation

### Before
- `Basement_Last` and `Podium_Last` had `countKey: null` but no special multiplier handling
- Parking calculation didn't account for service/GFA blocks being multiplied by number of floors
- Formula: `parking = polygon - service - gfa` (no multiplication by floors)

### After
- `Basement` and `Podium` use their count keys as multipliers
- `Basement_Last` and `Podium_Last` always have multiplier = 1 (single floor each)
- Parking calculation multiplies service/GFA blocks by number of floors
- Formula: `parking = polygon - (service + gfa) × numFloors`
- Different block configurations can be placed on regular and last levels

## Advantages of This Approach

1. **More Accurate Parking**: Accounts for how many times service/GFA blocks are repeated across floors
2. **Flexibility**: Regular basements/podiums can differ from the last one
3. **Realistic Modeling**: Last basement/podium might have different requirements or layouts
4. **Clear Separation**: Each level type is treated distinctly in calculations
5. **Better Space Management**: More cars can be accommodated in the last basement/podium if it has fewer service/GFA blocks

## Built-Up Area (BUA) Calculation

The BUA properly sums all levels:
- **Typical Basement**: (GFA + Service + Parking) × `numBasements`
- **Last Basement**: (GFA + Service + Parking) × 1
- **Ground Floor**: (GFA + Service + Parking) × 1
- **Podium**: (GFA + Service + Parking) × `numPodiums`
- **Last Podium**: (GFA + Service + Parking) × 1
- **Other Floors**: Calculated based on their specific requirements

## Files Modified

1. **feasibilityEngine.js**:
   - Updated `calculateNetParkingArea()` to accept and use `numFloors` parameter
   - Added `numFloorsForParking` calculation based on level type
   - Updated multiplier logic for `Basement_Last` and `Podium_Last`
   - Integrated new parking formula with service/GFA block multiplication

## Testing Scenarios

- [ ] 1 basement: parking calculated with 1 floor for Basement_Last
- [ ] 3 basements: parking calculated with 3 floors for Basement, 1 floor for Basement_Last
- [ ] 0 basements: Basement_Last excluded from calculation
- [ ] 1 podium: parking calculated with 1 floor for Podium_Last
- [ ] 4 podiums: parking calculated with 4 floors for Podium, 1 floor for Podium_Last
- [ ] 0 podiums: Podium_Last excluded from calculation
- [ ] Verify parking area reduces when service/GFA blocks increase
- [ ] Verify total area includes all floors correctly

