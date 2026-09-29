import Papa from 'papaparse';

let fireDatasets = {};
let jsonLayers = {};
let activeAlerts = [];
let availableLayersCache = null;

// Helper to calculate distance
const haversine = (lon1, lat1, lon2, lat2) => {
  const R = 6371.0;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const a = Math.sin(dlat / 2)**2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getFeatureCoords = (feature) => {
  const geomType = feature?.geometry?.type;
  const coords = feature?.geometry?.coordinates;
  if (!coords) return null;
  try {
    if (geomType === "Point") return [coords[0], coords[1]];
    else if (geomType === "MultiPolygon") return [coords[0][0][0][0], coords[0][0][0][1]];
    else if (geomType === "Polygon") return [coords[0][0][0], coords[0][0][1]];
  } catch (e) {
    // ignore
  }
  return null;
};

export const fetchAvailableLayers = async () => {
  if (availableLayersCache) return { status: 'success', layers: availableLayersCache };
  
  // Hardcoded layers based on what's in the data folder
  const layers = [
    "ext_industrial_zones",
    "ext_power_plants",
    "factories",
    "fire_stations",
    "hospitals",
    "police",
    "water"
  ];
  availableLayersCache = layers;
  return { status: "success", layers };
};

const loadCsv = async (datasetKey) => {
  if (fireDatasets[datasetKey]) return fireDatasets[datasetKey];
  
  const csvMapping = {
    "archive": "viirs-jpss1_2024_India.csv",
    "24h": "J2_VIIRS_C2_South_Asia_24h.csv",
    "48h": "J2_VIIRS_C2_South_Asia_48h.csv",
    "7d": "J2_VIIRS_C2_South_Asia_7d.csv"
  };
  
  const filename = csvMapping[datasetKey];
  if (!filename) return [];

  try {
    const response = await fetch(`/data/${filename}`);
    if (!response.ok) return [];
    
    const text = await response.text();
    return new Promise((resolve) => {
      Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          let df = results.data;
          
          df = df.filter(row => {
            row.confidence = row.confidence || 'n';
            row.acq_date = String(row.acq_date);
            
            return row.longitude >= 68.0 && row.longitude <= 97.4 && 
                   row.latitude >= 6.5 && row.latitude <= 35.5;
          });
          
          fireDatasets[datasetKey] = df;
          resolve(df);
        }
      });
    });
  } catch (e) {
    console.error("Failed to load CSV", e);
    return [];
  }
};

export const fetchLayer = async (layerName) => {
  if (jsonLayers[layerName]) {
    const data = jsonLayers[layerName];
    const isFc = data.type === "FeatureCollection";
    return {
      status: "success",
      is_geojson: isFc,
      count: isFc ? data.features?.length || 0 : data.length,
      data: data
    };
  }
  
  try {
    const response = await fetch(`/data/${layerName}.json`);
    if (!response.ok) throw new Error("Layer not found");
    const data = await response.json();
    jsonLayers[layerName] = data;
    
    const isFc = data.type === "FeatureCollection";
    return {
      status: "success",
      is_geojson: isFc,
      count: isFc ? data.features?.length || 0 : data.length,
      data: data
    };
  } catch (e) {
    throw new Error("Layer not found");
  }
};

const runAiDetection = async () => {
  const targetLayers = ['ext_industrial_zones', 'ext_power_plants', 'factories'];
  const industrialPoints = [];
  
  for (const layer of targetLayers) {
    try {
      const { data } = await fetchLayer(layer);
      if (data && data.features) {
        for (const f of data.features) {
          const coords = getFeatureCoords(f);
          if (coords) industrialPoints.push(coords);
        }
      } else if (data && Array.isArray(data)) {
        for (const item of data) {
          industrialPoints.push([item.longitude, item.latitude]);
        }
      }
    } catch (e) {
      // layer not available yet, ignore
    }
  }

  if (industrialPoints.length === 0) return;

  const df = fireDatasets['24h'];
  if (!df) return;

  const highRiskFires = df.filter(fire => fire.confidence === 'h' && fire.frp > 50);
  if (highRiskFires.length === 0) return;

  let stations = [];
  try {
    const stRes = await fetchLayer('fire_stations');
    stations = stRes.data || [];
  } catch (e) {
    return;
  }
  if (!stations || stations.length === 0) return;

  let count = 0;
  for (const fire of highRiskFires) {
    if (count > 50) break;
    
    let isNearIndustry = false;
    for (const [indLon, indLat] of industrialPoints) {
      if (haversine(fire.longitude, fire.latitude, indLon, indLat) < 5.0) {
        isNearIndustry = true;
        break;
      }
    }
    
    if (isNearIndustry) {
      let nearestStation = null;
      let minDist = Infinity;
      
      for (const st of stations) {
        const dist = haversine(fire.longitude, fire.latitude, st.longitude, st.latitude);
        if (dist < minDist) {
          minDist = dist;
          nearestStation = st;
        }
      }
      
      if (nearestStation) {
        const alertId = `ai_alert_${count}_${Date.now()}`;
        if (!activeAlerts.find(a => a.station.id === nearestStation.id && a.fire.latitude === fire.latitude && a.fire.longitude === fire.longitude)) {
          activeAlerts.push({
            id: alertId,
            timestamp: new Date().toISOString(),
            is_ai: true,
            target_type: "fire_stations",
            fire: {
              longitude: Number(fire.longitude),
              latitude: Number(fire.latitude),
              frp: Number(fire.frp),
              date: String(fire.acq_date)
            },
            station: nearestStation,
            distance_km: Math.round(minDist * 100) / 100
          });
        }
        count++;
      }
    }
  }
};

let aiDetectionRun = false;

export const fetchFires = async ({ datasets, limit = 5000, min_confidence, min_frp, exact_date, start_date } = {}) => {
  const selectedDatasets = (Array.isArray(datasets) ? datasets : datasets.split(',')).map(d => d.trim()).filter(Boolean);
  let combinedRecords = [];
  
  for (const dsKey of selectedDatasets) {
    let df = await loadCsv(dsKey);
    
    if (min_confidence) df = df.filter(row => String(row.confidence) === String(min_confidence));
    if (min_frp !== undefined && min_frp !== null) df = df.filter(row => row.frp >= min_frp);
    
    if (exact_date) {
      df = df.filter(row => String(row.acq_date) === String(exact_date));
    } else if (start_date) {
      df = df.filter(row => String(row.acq_date) >= String(start_date));
    }
    
    if (limit > 0) df = df.slice(0, limit);
    
    const records = df.map(r => ({ ...r, dataset_source: dsKey }));
    combinedRecords = combinedRecords.concat(records);
  }
  
  if (!aiDetectionRun && fireDatasets['24h']) {
    runAiDetection().catch(e => console.error(e));
    aiDetectionRun = true;
  }
  
  return { status: "success", count: combinedRecords.length, data: combinedRecords };
};

export const fetchStats = async (datasets) => {
  const selectedDatasets = (Array.isArray(datasets) ? datasets : datasets.split(',')).map(d => d.trim()).filter(Boolean);
  let dataframes = [];
  
  for (const ds of selectedDatasets) {
    const df = fireDatasets[ds];
    if (df) dataframes = dataframes.concat(df);
  }
  
  if (dataframes.length === 0) {
    return { status: "success", total_fires: 0, trend_data: [] };
  }
  
  const dailyStats = {};
  for (const row of dataframes) {
    const date = row.acq_date;
    if (!dailyStats[date]) {
      dailyStats[date] = { count: 0, total_frp: 0 };
    }
    dailyStats[date].count += 1;
    dailyStats[date].total_frp += (row.frp || 0);
  }
  
  const sortedDates = Object.keys(dailyStats).sort();
  const last30 = sortedDates.slice(-30);
  
  const trendData = last30.map(date => ({
    date,
    count: dailyStats[date].count,
    avg_frp: Math.round((dailyStats[date].total_frp / dailyStats[date].count) * 100) / 100
  }));
  
  return { status: "success", total_fires: dataframes.length, trend_data: trendData };
};

export const sendAlert = async (alertData) => {
  let targets = [];
  try {
    const res = await fetchLayer(alertData.target_type);
    targets = res.data || [];
  } catch(e) {
    throw new Error(`No targets loaded for ${alertData.target_type}`);
  }
  
  let nearestTarget = null;
  let minDist = Infinity;
  
  for (const st of targets) {
    const dist = haversine(alertData.fire_lon, alertData.fire_lat, st.longitude, st.latitude);
    if (dist < minDist) {
      minDist = dist;
      nearestTarget = st;
    }
  }
  
  if (!nearestTarget) {
    throw new Error("Could not find nearest target");
  }
  
  const newAlert = {
    id: `alert_${activeAlerts.length}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    is_ai: false,
    target_type: alertData.target_type,
    fire: {
      longitude: alertData.fire_lon,
      latitude: alertData.fire_lat,
      frp: alertData.frp,
      date: alertData.date
    },
    station: nearestTarget,
    distance_km: Math.round(minDist * 100) / 100
  };
  
  activeAlerts.push(newAlert);
  return { status: "success", alert: newAlert };
};

export const fetchAlerts = async () => {
  return { status: "success", alerts: activeAlerts };
};

export const cancelAlert = async (alertId) => {
  activeAlerts = activeAlerts.filter(a => a.id !== alertId);
  return { status: "success" };
};
