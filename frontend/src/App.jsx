import React, { useState, useEffect } from 'react';
import { Flame, Menu, X, Bell } from 'lucide-react';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import RightSidebar from './components/RightSidebar';
import { fetchFires, fetchStats, fetchLayer, fetchAlerts, sendAlert, cancelAlert, fetchAvailableLayers } from './api';

export const MAP_STYLES = {
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  street: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
};

function App() {
  const [fires, setFires] = useState([]);
  const [stats, setStats] = useState(null);
  const [layerData, setLayerData] = useState({});
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [availableLayers, setAvailableLayers] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  
  // Filters
  const [selectedDataset, setSelectedDataset] = useState('24h');
  const [selectedLayers, setSelectedLayers] = useState([]);
  
  const [minConfidence, setMinConfidence] = useState('');
  const [minFrp, setMinFrp] = useState(0);
  const [exactDate, setExactDate] = useState('');
  const [mapStyle, setMapStyle] = useState('satellite');

  useEffect(() => {
    fetchAvailableLayers().then(res => {
      if (res.status === 'success') {
        setAvailableLayers(res.layers);
      }
    }).catch(e => console.error(e));
  }, []);

  useEffect(() => {
    if (!selectedDataset) {
      setFires([]);
      setStats(null);
      return;
    }
    
    const loadData = async () => {
      setLoading(true);
      try {
        const [firesData, statsData] = await Promise.all([
          fetchFires({ 
            datasets: selectedDataset,
            limit: 10000, 
            min_confidence: minConfidence || undefined, 
            min_frp: minFrp || undefined,
            exact_date: exactDate || undefined
          }),
          fetchStats(selectedDataset)
        ]);
        
        if (firesData.status === 'success') {
          setFires(firesData.data);
        }
        if (statsData.status === 'success') {
          setStats(statsData);
        }
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [selectedDataset, minConfidence, minFrp, exactDate]);

  useEffect(() => {
    selectedLayers.forEach(layer => {
      if (!layerData[layer]) {
        fetchLayer(layer).then(res => {
          if (res.status === 'success') {
            setLayerData(prev => ({...prev, [layer]: res.data}));
          }
        }).catch(err => console.error(`Failed to fetch layer ${layer}`, err));
      }
    });
  }, [selectedLayers]);
  
  const loadAlerts = async () => {
    try {
      const res = await fetchAlerts();
      setActiveAlerts(res.alerts);
    } catch (e) {
      console.error("Error fetching alerts", e);
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSendAlert = async (fireInfo, targetType) => {
    try {
      const res = await sendAlert({
        fire_lat: fireInfo.latitude,
        fire_lon: fireInfo.longitude,
        frp: fireInfo.frp || 0,
        date: fireInfo.acq_date || new Date().toISOString(),
        target_type: targetType
      });
      if (res.status === 'success') {
        setActiveAlerts(prev => [...prev, res.alert]);
        setRightSidebarOpen(true);
      }
    } catch (e) {
      alert(`Error sending alert: Ensure '${targetType}' layer is available in the backend.`);
    }
  };

  const handleCancelAlert = async (alertId) => {
    try {
      const res = await cancelAlert(alertId);
      if (res.status === 'success') {
        setActiveAlerts(prev => prev.filter(a => a.id !== alertId));
      }
    } catch (e) {
      console.error("Failed to cancel alert", e);
    }
  };

  return (
    <div className="app-container">
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <h2>Loading Data...</h2>
        </div>
      )}
      
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
        <Menu size={24} color="#333" />
      </button>
      
      <button className="mobile-alerts-btn" onClick={() => setRightSidebarOpen(true)}>
        <Bell size={24} color="#ef4444" />
        {activeAlerts.length > 0 && <span className="alert-badge">{activeAlerts.length}</span>}
      </button>

      <div className={`sidebar-container ${sidebarOpen ? 'open' : ''}`}>
        <button className="mobile-close-btn" onClick={() => setSidebarOpen(false)}>
          <X size={24} color="#333" />
        </button>
        
        {/* <div className="header glass-panel">
          <Flame color="#ef4444" size={32} />
          <h1>FireSight Analytics</h1>
        </div> */}
        
        <Sidebar 
          selectedDataset={selectedDataset}
          setSelectedDataset={setSelectedDataset}
          availableLayers={availableLayers}
          selectedLayers={selectedLayers}
          setSelectedLayers={setSelectedLayers}
          minConfidence={minConfidence} 
          setMinConfidence={setMinConfidence}
          minFrp={minFrp}
          setMinFrp={setMinFrp}
          exactDate={exactDate}
          setExactDate={setExactDate}
          mapStyle={mapStyle}
          setMapStyle={setMapStyle}
          stats={stats}
          currentFiresCount={fires.length}
        />
      </div>
      
      <div className="map-container">
        <MapView 
          data={fires} 
          mapStyle={mapStyle} 
          layerData={layerData}
          selectedLayers={selectedLayers}
          activeAlerts={activeAlerts}
          onSendAlert={handleSendAlert}
          availableLayers={availableLayers}
          setSelectedLayers={setSelectedLayers}
        />
      </div>
      
      <RightSidebar alerts={activeAlerts} isOpen={rightSidebarOpen} setIsOpen={setRightSidebarOpen} onCancelAlert={handleCancelAlert} />
    </div>
  );
}

export default App;