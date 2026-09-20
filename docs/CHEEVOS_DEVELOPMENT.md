# Cheevos Development

`c64-ready` can run a game in the browser and load a `c64-cheevos` detector for local score and achievement testing.

This is intended for developing game classes in `c64-cheevos` while playing the game in the web emulator.

## Setup

In a local development checkout, `c64-ready` depends on `c64-cheevos` through a file dependency:

```json
"c64-cheevos": "file:../c64-cheevos"
```

Run the c64-ready dev server:

```zsh
cd ~/Homespace/c64-ready
npm install
npm run dev
```

Open the local Vite URL, usually:

```text
http://localhost:5173/
```

## Load A Game

Use the settings menu to load a `.crt`, `.prg`, `.d64`, or supported snapshot file.

You can also start with a game URL:

```text
http://localhost:5173/?game=games/cartridges/legend-of-wilf.crt
```

Use `?game=null` to boot without autoloading a game.

## Enable Cheevos

Open the settings menu, then the `Cheevos` tab.

1. Enter the detector ID, for example `uridium`.
2. Paste achievement JSON into the text box, or click `Load JSON File` and select a `.json` file.
3. Click `Enable`.

When enabled, c64-ready creates the cheevos instance with `createCheevos(detectorId, options)` and injects emulator memory readers:

```js
cheevos.cpuReadNS = (addr) => player.cpuReadNS(addr)
cheevos.cpuRead = (addr) => player.cpuRead(addr)
cheevos.ramRead = (addr) => player.ramRead(addr)
```

The cheevos instance is executed once per animation frame.

## Detector IDs

Detector IDs are not automatically derived from game titles. They are explicit keys in the `c64-cheevos` registry.

Examples:

- `uridium` loads `src/cheevos/Uridium.js`.
- `rainbow-islands` loads `src/cheevos/RainbowIslands.js`.
- `mario-cf` loads `src/cheevos/MariosCementFactory.js`.

If a detector ID is not registered, `c64-cheevos` falls back to `CheevoTemplate`.

## Achievement JSON Format

The JSON box accepts the same shape expected by `c64-cheevos` host applications:

```json
{
  "_id": "uridium-dev-set",
  "cheevos": [
    {
      "_id": "uridium-zinc",
      "title": "Zinc",
      "description": "Clear the Zinc dreadnought."
    }
  ]
}
```

Achievement matching inside existing game classes commonly uses `camelize(c.title)`, so titles must match the `switch` cases in the game class.

For example, `Uridium.js` expects titles such as:

- `Zinc`
- `Lead`
- `Tri Alloy`
- `Novice Pilot`
- `Uridium Ace`

## Tracker Panel

The Cheevos settings tab includes a `Show tracker panel` checkbox.

When enabled, the tracker panel appears to the right of the emulator in `Standard` display mode. It hides automatically in `Full` and `Stretch` display modes, and on narrow viewports.

The panel shows:

- current detector ID
- score
- lives
- status (`Waiting`, `Playing`, or `Game Over`)
- popped count
- popped achievements
- remaining achievements
- recent cheevos messages
- optional dynamic tracker fields

Popped and remaining achievement lists show up to 6 achievements by default. Use `Show all` in the panel to expand a list.

## Dynamic Tracker Fields

For games that use fields other than lives, such as health, energy, fuel, or level, add `trackerFields` to the JSON.

`trackerFields` read public fields from the active cheevos instance after each `execute()` call.

```json
{
  "_id": "example-dev-set",
  "trackerFields": [
    {
      "key": "health",
      "label": "Health",
      "source": "field",
      "field": "health",
      "display": "bar",
      "max": 100
    },
    {
      "key": "level",
      "label": "Level",
      "source": "field",
      "field": "level"
    }
  ],
  "cheevos": []
}
```

Field properties:

- `key`: Stable tracker field key.
- `label`: Display label in the tracker panel.
- `source`: Currently `field` only.
- `field`: Public property name on the cheevos instance. Defaults to `key`.
- `display`: `text` or `bar`.
- `max`: Required for useful `bar` display.

For this to work, the game class must keep the value as a public instance property, for example `this.health = currentHealth`.

## Local Persistence

c64-ready stores development data in browser `localStorage`:

- popped achievements
- submitted scores
- detector ID preference
- tracker panel visibility

Use the Cheevos tab buttons to clear local unlocks or local scores for the active detector.

## URL Parameters

Cheevos can be enabled from the URL:

```text
http://localhost:5173/?game=games/cartridges/game.crt&cheevos=uridium
```

You can also load a cheevos set JSON URL:

```text
http://localhost:5173/?game=games/cartridges/game.crt&cheevos=uridium&cheevosSet=cheevos/uridium.json
```

Relative `cheevosSet` URLs resolve from the c64-ready base URL.

## Debugging Tips

- Confirm the detector ID exists in `c64-cheevos/src/registry.js`.
- Confirm achievement titles match the game class `camelize(c.title)` cases.
- Watch the browser console for cheevos constructor and score submission logs.
- Use `Clear Unlocks` when retesting the same achievement.
- Use the tracker panel to confirm score, lives, game over state, and dynamic fields are updating.
