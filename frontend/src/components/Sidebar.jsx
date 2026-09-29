import React, { useState } from 'react';
import { Calendar, Filter, Droplet, LayoutGrid, PanelRight, X } from 'lucide-react';
import { MAP_STYLES } from '../App';
import { LayerBadge, getLayerStyle } from './layerStyles.jsx';

const Sidebar = ({ 
  selectedDataset, setSelectedDataset, 
  availableLayers, selectedLayers, setSelectedLayers, 
  minConfidence, setMinConfidence, 
  minFrp, setMinFrp,
  exactDate, setExactDate,
  mapStyle, setMapStyle,
  stats, currentFiresCount 
}) => {
  
  const [isOpen, setIsOpen] = useState(true);

  const handleDatasetChange = (e) => {
    setSelectedDataset(e.target.value);
  };

  const handleLayerToggle = (layer) => {
    if (selectedLayers.includes(layer)) {
      setSelectedLayers(selectedLayers.filter(l => l !== layer));
    } else {
      setSelectedLayers([...selectedLayers, layer]);
    }
  };

  const clearFilters = () => {
    setMinConfidence('');
    setMinFrp(0);
    setExactDate('');
  };

  const formatLayerName = (name) => {
    let formatted = name.replace('ext_', '').replace(/_/g, ' ');
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const StatsChart = ({ total = 0, displayed = 0 }) => {
    const max = Math.max(total, displayed, 1);
    const totalHeight = (total / max) * 100;
    const displayedHeight = (displayed / max) * 100;

    return (
      <div
        style={{
          padding: '16px',
          borderRadius: '12px',
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,.08)'
        }}
      >
        <h3 style={{ margin: '0 0 14px', fontSize: '1rem', color: '#1e293b' }}>
          Fire Overview
        </h3>

        <svg
          viewBox="0 0 220 120"
          width="100%"
          height="120"
          role="img"
          aria-label="Fire statistics chart"
        >
          <line x1="25" y1="100" x2="210" y2="100" stroke="#cbd5e1" />

          <rect
            x="55"
            y={100 - totalHeight}
            width="42"
            height={totalHeight}
            rx="6"
            fill="#64748b"
          />

          <rect
            x="135"
            y={100 - displayedHeight}
            width="42"
            height={displayedHeight}
            rx="6"
            fill="#ef4444"
          />

          <text x="76" y="116" textAnchor="middle" fontSize="10" fill="#475569">
            Total
          </text>
          <text x="156" y="116" textAnchor="middle" fontSize="10" fill="#475569">
            Visible
          </text>
        </svg>
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
        style={{
          position: 'fixed',
          top: '50%',
          left: isOpen ? 'min(360px, 90vw)' : 0,
          transform: 'translateY(-50%)',
          zIndex: 10,
          width: '40px',
          height: '52px',
          border: 'none',
          borderRadius: '0 10px 10px 0',
          background: '#2563eb',
          color: '#fff',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          boxShadow: '4px 0 12px rgba(0,0,0,.25)',
          transition: 'left .25s ease'
        }}
      >
        {isOpen ? <X size={20} /> : <PanelRight size={20} />}
      </button>

      {isOpen && (
        <div
          className="sidebar-scrollable"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: '360px',
            maxWidth: '90vw',
            zIndex: 100,
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            background: '#f8fafc',
            boxShadow: '4px 0 16px rgba(0,0,0,.15)'
          }}
        >
          {stats && (
            <div className="stats-panel glass-panel" style={{ padding: '16px', borderRadius: '12px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#1e293b' }}>Current View</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Total Processed:</span>
                <span style={{ fontWeight: 'bold' }}>{stats.total_fires.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Currently Displayed:</span>
                <span style={{ fontWeight: 'bold', color: '#ef4444' }}>{currentFiresCount.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="controls-panel glass-panel" style={{ padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            <div className="control-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><LayoutGrid size={16}/> Map Style</label>
              <select value={mapStyle} onChange={(e) => setMapStyle(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                {Object.keys(MAP_STYLES).map(style => (
                  <option key={style} value={style}>{style.charAt(0).toUpperCase() + style.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label>Fire Dataset</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="dataset" value="24h" checked={selectedDataset === '24h'} onChange={handleDatasetChange} /> Last 24 Hours
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="dataset" value="48h" checked={selectedDataset === '48h'} onChange={handleDatasetChange} /> Last 48 Hours
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="dataset" value="7d" checked={selectedDataset === '7d'} onChange={handleDatasetChange} /> Last 7 Days
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="dataset" value="archive" checked={selectedDataset === 'archive'} onChange={handleDatasetChange} /> 2024 Archive
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                  <input type="radio" name="dataset" value="archive,7d,48h,24h" checked={selectedDataset === 'archive,7d,48h,24h'} onChange={handleDatasetChange} /> Show All Datasets
                </label>
              </div>
            </div>

            <div className="control-group" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={16}/> Exact Date</label>
              <input 
                type="date" 
                value={exactDate} 
                onChange={(e) => setExactDate(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div className="control-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Filter size={16}/> Confidence Level</label>
              <select value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <option value="">All Confidence Levels</option>
                <option value="l">Low (l)</option>
                <option value="n">Nominal (n)</option>
                <option value="h">High (h)</option>
              </select>
            </div>

            <div className="control-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Droplet size={16}/> Min FRP (Intensity): {minFrp}</label>
              <input 
                type="range" 
                min="0" max="500" step="10" 
                value={minFrp} 
                onChange={(e) => setMinFrp(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <button 
              onClick={clearFilters}
              style={{ padding: '10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, marginTop: '8px' }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;