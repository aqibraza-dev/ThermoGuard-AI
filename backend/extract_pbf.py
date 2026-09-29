import os
import json
try:
    import osmium
except ImportError:
    print("Error: The 'osmium' library is not installed.")
    print("Please install it by running: pip install osmium")
    exit(1)

INDIA_BBOX = {
    "min_lon": 68.0,
    "max_lon": 97.4,
    "min_lat": 6.5,
    "max_lat": 35.5
}

def is_in_india(lon, lat):
    return (INDIA_BBOX["min_lon"] <= lon <= INDIA_BBOX["max_lon"] and
            INDIA_BBOX["min_lat"] <= lat <= INDIA_BBOX["max_lat"])

class MultiFeatureHandler(osmium.SimpleHandler):
    def __init__(self):
        super(MultiFeatureHandler, self).__init__()
        self.fire_stations = []
        self.hospitals = []
        self.police = []
        self.water = []
        self.factories = []

    def _extract_point(self, n, tags):
        return {
            "id": n.id,
            "name": tags.get("name", "Unknown"),
            "longitude": n.location.lon,
            "latitude": n.location.lat
        }

    def node(self, n):
        # Filter for India BBox
        if not is_in_india(n.location.lon, n.location.lat):
            return
            
        amenity = n.tags.get("amenity")
        landuse = n.tags.get("landuse")
        man_made = n.tags.get("man_made")
        natural = n.tags.get("natural")

        if amenity == "fire_station":
            self.fire_stations.append(self._extract_point(n, n.tags))
        elif amenity == "hospital":
            self.hospitals.append(self._extract_point(n, n.tags))
        elif amenity == "police":
            self.police.append(self._extract_point(n, n.tags))
        elif natural == "water" or amenity == "drinking_water":
            self.water.append(self._extract_point(n, n.tags))
        elif landuse == "industrial" or man_made == "works":
            self.factories.append(self._extract_point(n, n.tags))

def main():
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    pbf_file = os.path.join(base_dir, "india-260916.osm.pbf")
    
    if not os.path.exists(pbf_file):
        print(f"Error: Could not find {pbf_file}")
        return

    print(f"Parsing {pbf_file} to extract multiple features (Filtered for India)...")
    print("This may take a few minutes depending on your system speed...")
    
    handler = MultiFeatureHandler()
    handler.apply_file(pbf_file)
    
    print(f"Extracted {len(handler.fire_stations)} fire stations.")
    print(f"Extracted {len(handler.hospitals)} hospitals.")
    print(f"Extracted {len(handler.police)} police stations.")
    print(f"Extracted {len(handler.water)} water points.")
    print(f"Extracted {len(handler.factories)} factories.")
    
    def save_json(data, filename):
        path = os.path.join(base_dir, filename)
        with open(path, 'w') as f:
            json.dump(data, f)
        print(f"Saved {filename}")

    save_json(handler.fire_stations, "fire_stations.json")
    save_json(handler.hospitals, "hospitals.json")
    save_json(handler.police, "police.json")
    save_json(handler.water, "water.json")
    save_json(handler.factories, "factories.json")
    
    print("Extraction complete. You can now start the FastAPI server.")

if __name__ == '__main__':
    main()
