# Linden's HA Dashboard — Home Assistant Add-on

A custom control dashboard for Home Assistant, packaged as an add-on so it runs on your **HA Green** (or any HAOS box) — always-on, no separate PC required.

Includes: Home glance, Rooms, Cameras + a borderless **Camera Wall**, Energy, **EV Charging** (Zappi), **Media** (Sonos + Nest, grouping, favourites, radio), dimmable Lights, Climate, Scenes, family presence, a 7-day forecast — plus **1280×800** and **1920×1080** wall-tablet kiosk views.

## Install

1. Home Assistant → **Settings → Add-ons → Add-on Store**.
2. Top-right **⋮ → Repositories**, paste this URL and **Add**:
   ```
   https://github.com/linden-agileit/ha-dashboard-addon
   ```
3. Close the dialog; the store now lists **HA Dashboard**. Open it → **Install**
   (the first build takes a few minutes on the Green while it pulls Node).
4. **Configuration** tab:
   - `ha_token` — a **Long-Lived Access Token** (HA → your profile → *Security* → *Create Token*).
   - `ha_url` — leave as `http://homeassistant:8123`. If the add-on can't connect, try `http://<your-ha-ip>:8123` or your external HA URL.
5. **Info** tab → enable **Start on boot** and **Watchdog**, then **Start**.

## Open it

- This machine / browser: `http://<your-ha-green-ip>:3002`
- **Wall tablets:** open that URL, then tap **Tablet** (1280×800) or **Tablet HD** (1920×1080).

## Updating

When the dashboard changes, a new version is pushed to this repo — Home Assistant shows an **Update** button on the add-on.
