# Sandbox-Wiring
A sandbox simulation game featuring a wiring and electronics system. Build circuits using power supplies, motherboards, sensors, and displays to create functional in-game machines and logic systems.
# Sandbox Wiring - Full Illustrated Guide
[cite_start]**Author:** Eren [cite: 2]

[cite_start]This guide covers the fundamental electronics and wiring logic for the Sandbox simulation. [cite: 1]

---

## 1. Cable & Port Types
[cite_start]Ports are only compatible when the **Type** matches (e.g., POWER to POWER). [cite: 5]

| Type | Meaning / Use |
| :--- | :--- |
| **POWER** | [cite_start]Carries on/off state and voltage (v). [cite: 4] |
| **VIDEO** | [cite_start]Carries display signal: none, white, color, image. [cite: 4] |
| **DATA** | [cite_start]Carries structured values, e.g., sensor {value}. [cite: 4] |

---

## 2. Components & Pins

### Power Supply
* [cite_start]**Behavior**: Outputs `{on:true, v:voltage}` when active and voltage > 0; otherwise `{on:false, v:0}`. [cite: 16, 18, 19]
* [cite_start]**Connects to**: Any POWER input (Switch, Motherboard, Screen, LED, etc.). [cite: 8, 9, 11, 12, 13]
* **Pins**:
    * [cite_start]`power` (OUT): Supplies voltage when ON. [cite: 21]

![Power Supply](./assets/power_supply.png)

### Switch
* [cite_start]**Logic**: If the switch property is ON and the input power is ON, it passes power through. [cite: 28, 29]
* **Pins**:
    * [cite_start]`powerin` (IN): Accepts incoming power. [cite: 30]
    * [cite_start]`powerOut` (OUT): Forwards input power when switch is ON. [cite: 30]

![Switch](./assets/switch.png)

### Splitter
* [cite_start]**Logic**: Mirrors the input power and voltage to both outputs. [cite: 37, 38, 39]
* **Pins**:
    * [cite_start]`in` (IN): Takes a single power input. [cite: 32]
    * [cite_start]`a` (OUT): Mirrors input. [cite: 32]
    * [cite_start]`b` (OUT): Mirrors input. [cite: 32]

![Splitter](./assets/splitter.png)

### Motherboard
* [cite_start]**Video Modes**: Supports 'white', 'color' (uses props.color), or 'DosOS' (image via props.dosUrl). [cite: 50, 51, 52, 53]
* **Pins**:
    * [cite_start]`power` (IN): Required to operate. [cite: 41]
    * [cite_start]`video` (OUT): Sends video signal. [cite: 41]
    * [cite_start]`data` (OUT): Sends data payload (empty object). [cite: 41, 55]

![Motherboard](./assets/motherboard.png)

### Screen
* [cite_start]**States**: Can be off, standby, or on. [cite: 63, 64]
* [cite_start]**Visuals**: Displays white, color (with brightness modulation), or image URLs. [cite: 65, 66, 67]
* **Pins**:
    * [cite_start]`power` (IN): Powers the display. [cite: 71]
    * [cite_start]`video` (IN): Video signal from Motherboard. [cite: 71]

![Screen](./assets/screen.png)

### Sensor
* [cite_start]**Logic**: When powered, it outputs a value that toggles between 0 and 1 every ~250ms. [cite: 87, 88, 89]
* **Pins**:
    * [cite_start]`power` (IN): Required to operate. [cite: 93]
    * [cite_start]`data` (OUT): Toggles value 0/1 over time. [cite: 93]

![Sensor](./assets/sensor.png)

---

## 3. Example Wiring Setups

### Basic Power Chain
1. [cite_start]**Power Supply.power** → **Switch.powerIn** [cite: 105]
2. [cite_start]**Switch.powerOut** → **Screen.power** [cite: 105]
3. [cite_start]**Switch.powerOut** → **LED.power** (in parallel) [cite: 105]

### Video Display
1. [cite_start]**Power Supply.power** → **Motherboard.power** [cite: 108]
2. [cite_start]**Power Supply.power** → **Screen.power** [cite: 108]
3. [cite_start]**Motherboard.video** → **Screen.video** [cite: 108]

### Split Power
1. [cite_start]**Power Supply.power** → **Splitter.in** [cite: 114]
2. [cite_start]**Splitter.a** → **Screen.power** [cite: 114]
3. [cite_start]**Splitter.b** → **LED.power** [cite: 114]
