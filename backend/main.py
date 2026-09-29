import os
import json
import math
import pandas as pd
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="FireSight Analytics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fire_datasets = {}
json_layers = {}
active_alerts = [] 

def haversine(lon1, lat1, lon2, lat2):
    R = 6371.0
    dlon = math.radians(lon2 - lon1)
    dlat = math.radians(lat2 - lat1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_feature_coords(feature):
    geom_type = feature.get("geometry", {}).get("type")
    coords = feature.get("geometry", {}).get("coordinates")
    if not coords: return None
    try:
        if geom_type == "Point": return coords[0], coords[1]
        elif geom_type == "MultiPolygon": return coords[0][0][0][0], coords[0][0][0][1]
        elif geom_type == "Polygon": return coords[0][0][0], coords[0][0][1]
    except:
        pass
    return None

def detect_ai_alerts():
    print("Running AI Detection Algorithm...")
    # Target layers for AI detection
    target_layers = ['ext_industrial_zones', 'ext_power_plants', 'factories']
    industrial_points = []
    
    for layer in target_layers:
        if layer in json_layers:
            data = json_layers[layer]
            if isinstance(data, dict) and "features" in data:
                for f in data["features"]:
                    coords = get_feature_coords(f)
                    if coords:
                        industrial_points.append(coords)
            elif isinstance(data, list):
                for item in data:
                    industrial_points.append((item['longitude'], item['latitude']))

    if not industrial_points:
        print("No industrial points found for AI detection.")
        return

    # Check ONLY 24h fires for alerts as requested
    df = fire_datasets.get('24h')
        
    if df is not None:
        # Filter high confidence & high FRP
        high_risk_fires = df[(df['confidence'] == 'h') & (df['frp'] > 50)]
        print(f"Found {len(high_risk_fires)} high risk fires to check for AI detection in 24h dataset.")
        
        stations = json_layers.get("fire_stations", [])
        if not stations: return
        
        count = 0
        for _, fire in high_risk_fires.iterrows():
            if count > 50: break # Limit auto alerts
            
            # Check if near industrial
            is_near_industry = False
            for ind_lon, ind_lat in industrial_points:
                if haversine(fire['longitude'], fire['latitude'], ind_lon, ind_lat) < 5.0: # within 5km
                    is_near_industry = True
                    break
            
            if is_near_industry:
                # Find nearest station
                nearest_station = None
                min_dist = float('inf')
                for st in stations:
                    dist = haversine(fire['longitude'], fire['latitude'], st['longitude'], st['latitude'])
                    if dist < min_dist:
                        min_dist = dist
                        nearest_station = st
                        
                if nearest_station:
                    active_alerts.append({
                        "id": f"ai_alert_{count}_{int(datetime.now().timestamp())}",
                        "timestamp": datetime.now().isoformat(),
                        "is_ai": True,
                        "target_type": "fire_stations",
                        "fire": {
                            "longitude": float(fire['longitude']),
                            "latitude": float(fire['latitude']),
                            "frp": float(fire['frp']),
                            "date": str(fire['acq_date'])
                        },
                        "station": nearest_station,
                        "distance_km": round(min_dist, 2)
                    })
                    count += 1
        print(f"AI Detection complete. Generated {count} automatic alerts.")


def load_data():
    base_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    
    csv_mapping = {
        "archive": "viirs-jpss1_2024_India.csv",
        "24h": "J2_VIIRS_C2_South_Asia_24h.csv",
        "48h": "J2_VIIRS_C2_South_Asia_48h.csv",
        "7d": "J2_VIIRS_C2_South_Asia_7d.csv"
    }
    
    for key, filename in csv_mapping.items():
        path = os.path.join(base_dir, filename)
        if os.path.exists(path):
            print(f"Loading fire dataset '{key}'...")
            df = pd.read_csv(path)
            df['acq_date'] = df['acq_date'].astype(str)
            df.fillna(0, inplace=True)
            if 'confidence' not in df.columns:
                df['confidence'] = 'n'
            
            df = df[(df['longitude'] >= 68.0) & (df['longitude'] <= 97.4) & 
                    (df['latitude'] >= 6.5) & (df['latitude'] <= 35.5)]
            fire_datasets[key] = df
    
    if os.path.exists(base_dir):
        for filename in os.listdir(base_dir):
            if filename.endswith(".json") and filename != "all_data.json":
                key = filename.replace(".json", "")
                path = os.path.join(base_dir, filename)
                print(f"Loading JSON layer '{key}'...")
                with open(path, 'r') as f:
                    json_layers[key] = json.load(f)
                    
    detect_ai_alerts()

@app.on_event("startup")
async def startup_event():
    load_data()

@app.get("/api/available-layers")
async def get_available_layers():
    return {"status": "success", "layers": list(json_layers.keys())}

@app.get("/api/fires")
async def get_fires(
    datasets: str = Query("archive"),
    limit: int = Query(5000),
    min_confidence: Optional[str] = None,
    min_frp: Optional[float] = None,
    start_date: Optional[str] = None,
    exact_date: Optional[str] = None
):
    selected_datasets = [d.strip() for d in datasets.split(",") if d.strip()]
    combined_records = []
    
    for ds_key in selected_datasets:
        df = fire_datasets.get(ds_key)
        if df is None: continue
        
        if min_confidence: df = df[df['confidence'] == min_confidence]
        if min_frp is not None: df = df[df['frp'] >= min_frp]
        if exact_date: df = df[df['acq_date'] == exact_date]
        elif start_date: df = df[df['acq_date'] >= start_date]
            
        df_result = df.head(limit) if limit > 0 else df
        records = df_result.to_dict(orient="records")
        for r in records: r['dataset_source'] = ds_key
        combined_records.extend(records)
        
    return {"status": "success", "count": len(combined_records), "data": combined_records}

@app.get("/api/stats")
async def get_stats(datasets: str = Query("archive")):
    selected_datasets = [d.strip() for d in datasets.split(",") if d.strip()]
    dataframes = [fire_datasets.get(ds) for ds in selected_datasets if fire_datasets.get(ds) is not None]
    
    if not dataframes:
        return {"status": "success", "total_fires": 0, "trend_data": []}
        
    df = pd.concat(dataframes)
    daily_counts = df.groupby('acq_date').size().reset_index(name='count').sort_values('acq_date').tail(30)
    daily_frp = df.groupby('acq_date')['frp'].mean().reset_index(name='avg_frp').sort_values('acq_date').tail(30)
    
    trend_data = []
    for (idx, row1), (_, row2) in zip(daily_counts.iterrows(), daily_frp.iterrows()):
        trend_data.append({
            "date": row1['acq_date'],
            "count": row1['count'],
            "avg_frp": round(row2['avg_frp'], 2)
        })
        
    return {"status": "success", "total_fires": len(df), "trend_data": trend_data}

@app.get("/api/layer/{layer_name}")
async def get_layer(layer_name: str):
    if layer_name not in json_layers:
        raise HTTPException(status_code=404, detail="Layer not found")
    data = json_layers[layer_name]
    is_fc = isinstance(data, dict) and data.get("type") == "FeatureCollection"
    return {
        "status": "success",
        "is_geojson": is_fc,
        "count": len(data.get("features", [])) if is_fc else len(data),
        "data": data
    }

class AlertRequest(BaseModel):
    fire_lat: float
    fire_lon: float
    frp: float
    date: str
    target_type: str = "fire_stations"

@app.post("/api/send-alert")
async def send_alert(req: AlertRequest):
    targets = json_layers.get(req.target_type, [])
    if not targets:
        raise HTTPException(status_code=400, detail=f"No targets loaded for {req.target_type}")
    
    nearest_target = None
    min_dist = float('inf')
    
    for st in targets:
        # Support both PBF extracted arrays and GeoJSON features if needed.
        # Currently PBF arrays have 'longitude' / 'latitude'
        dist = haversine(req.fire_lon, req.fire_lat, st['longitude'], st['latitude'])
        if dist < min_dist:
            min_dist = dist
            nearest_target = st
            
    if nearest_target is None:
        raise HTTPException(status_code=400, detail="Could not find nearest target")
        
    new_alert = {
        "id": f"alert_{len(active_alerts)}_{int(datetime.now().timestamp())}",
        "timestamp": datetime.now().isoformat(),
        "is_ai": False,
        "target_type": req.target_type,
        "fire": {
            "longitude": req.fire_lon,
            "latitude": req.fire_lat,
            "frp": req.frp,
            "date": req.date
        },
        "station": nearest_target,
        "distance_km": round(min_dist, 2)
    }
    
    active_alerts.append(new_alert)
    return {"status": "success", "alert": new_alert}

@app.delete("/api/cancel-alert/{alert_id}")
async def cancel_alert(alert_id: str):
    global active_alerts
    active_alerts = [a for a in active_alerts if a["id"] != alert_id]
    return {"status": "success"}

@app.get("/api/active-alerts")
async def get_active_alerts():
    return {"status": "success", "alerts": active_alerts}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
