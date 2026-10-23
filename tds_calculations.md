# Brew Tool: TDS, k_v and extraction yield calculations

This document is written in ASD-STE100 Simplified Technical English.

The code for these calculations is in `tds.js`. The screens that use them are in `scale-ui.js`.

## 1. Scope

This document gives the calculations that Brew Tool uses for:

- Cumulative Ionic Yield (CIY)
- Liquid yield (live estimate and measured)
- Total Dissolved Solids (TDS)
- The calibration constant k_v
- Extraction yield (EY)
- The brew control chart regions

## 2. Symbols and units

| Symbol | Name | Unit | Source |
|---|---|---|---|
| EC | Electrical conductivity of the coffee, at 25 °C | mS/cm | EC meter (Belka PORTAL) |
| W | Weight on the scale | g | Scale (BOOKOO) |
| W₀ | Weight on the scale at Start | g | Scale |
| W_max | Highest weight on the scale since Start | g | Scale |
| ΔV | Water added since the last EC reading | g | Calculated |
| CIY | Cumulative Ionic Yield | mS/cm × g | Calculated |
| P | Water poured since Start | g | Calculated |
| D | Bean dose (dry coffee) | g | Settings > Bean dose |
| a | Retained ratio (water that the coffee bed holds) | g/g | Settings > Retained ratio |
| Y | Liquid yield (coffee in the cup) | g | Calculated or typed |
| k_v | Calibration constant | cm/mS | Settings > k_v |
| TDS | Total Dissolved Solids | % | Calculated |
| EY | Extraction yield | % | Calculated |

Note: Brew Tool uses 1 g of water as equal to 1 mL of water.

## 3. Cumulative Ionic Yield (CIY)

### 3.1 Description

CIY is the sum of EC multiplied by the water that is added to the brew. It is a Riemann sum over the volume of water.

The EC meter does the temperature compensation to 25 °C. Brew Tool uses the EC value from the meter as it is. Brew Tool does not do a second temperature compensation.

### 3.2 Conditions

Brew Tool calculates CIY only when all of these conditions are true:

- The brew timer runs (after Start, before Stop).
- The scale is connected.
- The EC meter is connected.
- The scale has sent one or more weights.

When you push Start, Brew Tool sets CIY to 0.

### 3.3 Calculation

1. At Start, record the weight on the scale as W₀. If the scale did a tare at Start, W₀ is 0 g.
2. Set W_max = W₀.
3. For each EC reading, calculate the water that was added since the last EC reading:

   ΔV = max(0, W − W_max)

4. Set W_max = max(W_max, W).
5. Add the EC reading multiplied by ΔV to CIY:

   CIY = CIY + EC × ΔV

Brew Tool uses W_max (not the last weight) for ΔV. Thus, a decrease in weight does not add water two times. Noise from the scale, or a hand on the scale, can cause a decrease in weight.

### 3.4 Example

| Weight W (g) | EC (mS/cm) | W_max before (g) | ΔV (g) | EC × ΔV | CIY |
|---|---|---|---|---|---|
| 0 (Start) | – | – | – | – | 0.0 |
| 40 | 4.8 | 0 | 40 | 192.0 | 192.0 |
| 38 | 4.6 | 40 | 0 | 0.0 | 192.0 |
| 100 | 3.9 | 40 | 60 | 234.0 | 426.0 |
| 160 | 3.0 | 100 | 60 | 180.0 | 606.0 |
| 155 | 3.0 | 160 | 0 | 0.0 | 606.0 |
| 220 | 2.4 | 160 | 60 | 144.0 | 750.0 |

The weight decreases at 38 g and at 155 g. These decreases do not change CIY.

## 4. Liquid yield

### 4.1 Water poured

P = W − W₀

### 4.2 Live yield (estimate)

During the brew, the cup does not yet contain all the liquid. Also, the coffee bed holds some water. Brew Tool estimates the liquid yield as follows:

Y_live = P − D × a

- The default retained ratio a is 2.0 g/g. You can change it in Settings (0 to 5 g/g).
- If the bean dose D is not set, Brew Tool uses D × a = 0.

Example: P = 304 g, D = 20 g, a = 2.0 g/g.

Y_live = 304 − 20 × 2.0 = 264 g

### 4.3 Measured yield (Final TDS calculator)

After Stop, push Final TDS. Put the cup or carafe with the coffee on the scale. Brew Tool shows this value as the yield:

Y = W − carafe weight

- The carafe weight is in Settings > Carafe. If it is not set, Brew Tool uses 0 g.
- You can type a different yield. After you type a value, Brew Tool does not change it.

## 5. TDS

### 5.1 Formula

TDS = 100 × k_v × CIY / Y

Brew Tool calculates TDS only when k_v, CIY and Y are all more than 0.

### 5.2 Live TDS

During the brew, Brew Tool uses Y = Y_live (refer to Section 4.2).

- For the first 30 seconds after Start, the TDS reading shows "-- %".
- At Stop, Brew Tool keeps the last live TDS. This is the estimated TDS ("TDS ≈").

### 5.3 Final TDS

In the Final TDS calculator, Brew Tool uses the measured yield Y (refer to Section 4.3). When you push Next, Brew Tool keeps this TDS as the final TDS ("TDS").

### 5.4 Example

k_v = 0.0052 cm/mS, CIY = 709.8 mS/cm × g, Y = 264 g.

TDS = 100 × 0.0052 × 709.8 / 264 = 1.398 %

Brew Tool shows "1.40 %".

### 5.5 Uncalibrated k_v

If you did not calibrate k_v, Brew Tool uses the default k_v = 0.005 cm/mS. In this condition, Brew Tool shows "(uncal.)" or "uncalibrated" next to the TDS. The TDS can have a large error. To get an accurate TDS, calibrate k_v (refer to Section 6).

## 6. Calibration constant k_v

### 6.1 Description

k_v changes CIY per gram of yield into TDS. k_v also corrects the differences between this model and the real coffee. Thus, find k_v from a measurement with a refractometer.

### 6.2 Formula

The k_v formula is the TDS formula, solved for k_v:

k_v = TDS × Y / (100 × CIY)

In this formula, TDS is the value from the refractometer, in %.

### 6.3 Procedure

1. Make a full brew with the scale and the EC meter connected. Push Stop at the end of the brew.
2. Measure the TDS of the brew with a refractometer.
3. Open Settings. Push Calibrate (in the k_v row).
4. Make sure that the yield is correct. Brew Tool uses the measured yield from the Final TDS calculator. If there is no measured yield, Brew Tool uses the live yield at Stop.
5. Type the refractometer TDS in "True TDS". The value must be from 0.1 % to 25 %.
6. Push Next. Brew Tool shows the current k_v, the new k_v and the last 3 calibrations with their average.
7. Do one of these steps:
   - To use the new k_v, push "Save new k_v". You can change the value before you save it.
   - To keep the current k_v, push "Keep current".

Brew Tool adds a value to the history in the two conditions:

- If you push "Save new k_v", Brew Tool adds the value that you saved.
- If you push "Keep current", Brew Tool adds the calculated new k_v. The current k_v does not change.

The history keeps the last 3 values.

### 6.4 Example

Refractometer TDS = 1.38 %, Y = 264 g, CIY = 709.8 mS/cm × g.

k_v = 1.38 × 264 / (100 × 709.8) = 0.005133 cm/mS

Brew Tool shows k_v with 4 significant digits: "0.005133".

### 6.5 Average

The average of the last 3 values is:

k_v (average) = (k_v1 + k_v2 + k_v3) / 3

Example: (0.005133 + 0.0051 + 0.0053) / 3 = 0.005178 cm/mS

You can type the average as the new k_v. An average decreases the effect of one bad measurement.

## 7. Extraction yield (EY)

### 7.1 Formula

EY = Y × TDS / D

EY is the percentage of the dry coffee that is dissolved in the cup. Brew Tool calculates EY only when Y, TDS and D are all more than 0.

### 7.2 Values that Brew Tool uses

| Condition | Y | TDS | Point on the chart |
|---|---|---|---|
| During the brew (after 30 seconds) | Y_live | Live TDS | Hollow dot and trail |
| After Stop | Y_live at Stop | Estimated TDS at Stop | Hollow dot |
| After Final TDS > Next | Measured Y | Final TDS | Solid dot |

The point during the brew shows the EY and TDS if you stop the brew at that time. The live point and trail show only when the scale and the EC meter are both connected.

### 7.3 Example

Y = 264 g, TDS = 1.398 %, D = 20 g.

EY = 264 × 1.398 / 20 = 18.5 %

## 8. Brew control chart regions

The TDS vs extraction chart shows the "gold cup" area:

- TDS from 1.15 % to 1.35 %
- EY from 18 % to 22 %

Brew Tool gives each point a strength and an extraction:

| Value | Limit | Result |
|---|---|---|
| TDS | More than 1.35 % | Strong |
| TDS | Less than 1.15 % | Weak |
| EY | More than 22 % | Over-extracted |
| EY | Less than 18 % | Under-extracted |

If TDS and EY are both in the gold cup area, the result is "Ideal (gold cup)".

Example: TDS = 1.398 %, EY = 18.5 %. The result is "Strong, balanced extraction".

## 9. Saved data

| Data | Where |
|---|---|
| k_v | localStorage `tdsKvV1` |
| Last 3 k_v values | localStorage `kvHistoryV1` |
| Retained ratio a | localStorage `bedAbsorptionV1` |
| CIY, live yield and measured yield of the last brew (for calibration) | localStorage `lastBrewV1` |
| CIY and live TDS for each data row | CSV export, columns `ciy` and `tds_pct` |
| Each brew, with its CIY, yield and TDS (final or estimated) | Brew log (IndexedDB `btscaleBrewLogV1`). Brew Tool calculates EY from these values when you open the brew. |
