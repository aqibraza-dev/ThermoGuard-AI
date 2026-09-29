import json
import requests

BASE_URL = "https://sih26162-ai-based-detection-and-4qo5.onrender.com"

# GET endpoints that return data
ENDPOINTS = {
    "thermal_points": "/api/thermal-points",
    "thermal_points_24h": "/api/thermal-points?hours=24",
    "industrial_zones": "/api/industrial-zones",
    "power_plants": "/api/power-plants",
    "stats": "/api/stats",
    "incidents": "/api/incidents",
}


def fetch(path, retries=3, timeout=60):
    """Fetch one endpoint. Render free tier sleeps, so the first call can be slow."""
    url = BASE_URL + path
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            print(f"[{attempt}/{retries}] {path} failed: {e}")
    return None


def fetch_all():
    return {name: fetch(path) for name, path in ENDPOINTS.items()}


if __name__ == "__main__":
    data = fetch_all()

    with open("all_data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    for name, value in data.items():
        size = len(value) if isinstance(value, (list, dict)) else "n/a"
        print(f"{name}: {'OK' if value is not None else 'FAILED'} (items: {size})")

    print("Saved to all_data.json")