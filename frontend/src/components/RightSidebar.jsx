import React from 'react';
import { ShieldAlert, MapPin, Clock, X, Bot } from 'lucide-react';

const RightSidebar = ({ alerts, isOpen, setIsOpen, onCancelAlert }) => {
  return (
    <div className={`right-sidebar-container ${isOpen ? 'open' : ''}`}>
      <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="header" style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert color="#ef4444" />
            Active Alerts
          </h2>
          <button className="mobile-close-btn" style={{ position: 'static' }} onClick={() => setIsOpen(false)}>×</button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {alerts.length === 0 ? (
            <p style={{ color: '#64748b', textAlign: 'center', marginTop: '20px' }}>No active alerts.</p>
          ) : (
            alerts.map((alert, idx) => (
              <div key={idx} className="alert-card" style={{ position: 'relative' }}>
                <button 
                  onClick={() => onCancelAlert(alert.id)}
                  style={{
                    position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8'
                  }}
                  title="Cancel Alert"
                >
                  <X size={16} />
                </button>
                
                {alert.is_ai && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 'bold', marginBottom: '4px' }}>
                    <Bot size={14} /> DETECTED BY AI
                  </div>
                )}
                
                <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>
                  Routed to {alert.target_type === 'police' ? 'Police' : 'Fire Station'}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MapPin size={14} /> {alert.station.name}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ShieldAlert size={14} /> Dist: {alert.distance_km} km
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> {new Date(alert.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
