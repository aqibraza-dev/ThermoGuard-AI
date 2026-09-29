import os
import json

INDIA_BBOX = {
    "min_lon": 68.0,
    "max_lon": 97.4,
    "min_lat": 6.5,
    "max_lat": 35.5
}

def is_in_india(lon, lat):
    return (INDIA_BBOX["min_lon"] <= lon <= INDIA_BBOX["max_lon"] and
            INDIA_BBOX["min_lat"] <= lat <= INDIA_BBOX["max_lat"])

def filter_feature(feature):
    # Determine the centroid or a point to check if it's in India
    geom_type = feature.get("geometry", {}).get("type")
    coords = feature.get("geometry", {}).get("coordinates")
    
    if not coords:
        return False

    lon, lat = 0, 0
    if geom_type == "Point":
        lon, lat = coords[0], coords[1]
    elif geom_type == "MultiPolygon":
        try:
            # Just check the first point of the first polygon
            lon, lat = coords[0][0][0][0], coords[0][0][0][1]
        except:
            return False
    elif geom_type == "Polygon":
        try:
            lon, lat = coords[0][0][0], coords[0][0][1]
        except:
            return False
    else:
        return False
        
    return is_in_india(lon, lat)

def main():
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    all_data_path = os.path.join(base_dir, "all_data.json")
    
    if not os.path.exists(all_data_path):
        print(f"Error: {all_data_path} not found.")
        return

    print("Loading all_data.json (this may take a moment)...")
    with open(all_data_path, 'r') as f:
        data = json.load(f)

    for key, feature_collection in data.items():
        if not isinstance(feature_collection, dict) or feature_collection.get("type") != "FeatureCollection":
            continue
            
        print(f"Processing collection: {key}...")
        features = feature_collection.get("features", [])
        
        # Filter features to only include those in India
        filtered_features = [f for f in features if filter_feature(f)]
        
        print(f"  - Extracted {len(filtered_features)} features (filtered from {len(features)})")
        
        out_path = os.path.join(base_dir, f"ext_{key}.json")
        with open(out_path, 'w') as out_f:
            json.dump({
                "type": "FeatureCollection",
                "features": filtered_features
            }, out_f)
        print(f"  - Saved to {out_path}")

if __name__ == "__main__":
    main()
