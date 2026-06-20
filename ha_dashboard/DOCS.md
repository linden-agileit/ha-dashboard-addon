# HA Dashboard

Serves the custom dashboard **and** its Home Assistant proxy API from one container, on port **3002**.

## Configuration

| Option | Description |
|--------|-------------|
| `ha_token` | **Required.** A Home Assistant Long-Lived Access Token (profile → *Security* → *Create Token*). Stays inside this add-on; the browser never sees it. |
| `ha_url` | Where the add-on reaches Home Assistant. Default `http://homeassistant:8123` (internal, fast). Fallbacks: `http://<ha-ip>:8123`, or your external URL. |

## Usage

After starting, browse to `http://<your-ha-ip>:3002`. For a wall tablet, open that URL and tap **Tablet** or **Tablet HD** for the chromeless kiosk views.

## Notes

- Enable **Start on boot** and **Watchdog** (Info tab) so it's always available.
- The token lives only in the add-on config; the frontend talks to HA only via this add-on's `/api` proxy.
