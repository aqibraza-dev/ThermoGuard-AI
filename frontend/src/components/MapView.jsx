import React, { useMemo, useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { TileLayer, TripsLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { FlyToInterpolator } from '@deck.gl/core';
import { MAP_STYLES } from '../App';
import { getLayerStyle, loadPinIcon, LayerBadge } from './layerStyles';
import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: 78.9629,
  latitude: 20.5937,
  zoom: 4.5,
  pitch: 30,
  bearing: 0
};

const CHIP_CSS = `
.deckgl-wrapper {
  position: relative;
  z-index: 1100;
}

.gm-chips {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999 !important;
  isolation: isolate;
  pointer-events: none;
  width: max-content;
  max-width: calc(100% - 32px);
  display: flex;
  justify-content: center;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 6px;
  scrollbar-width: none;
}

.gm-chips::-webkit-scrollbar{display:none}

.gm-chip {
  position: relative;
  z-index: 100000;
  pointer-events: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.08);
  background: #fff;
  color: #1e293b;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  transition: transform .12s ease,box-shadow .12s ease;
}

@media (max-width:768px){
  .gm-chips{
    top:12px;
    max-width:calc(100% - 24px);
  }
}

`;

// Average of a ring / line's vertices -> a point where a pin can sit for polygon features
const centroidOf = (g) => {
  let ring = null;
  if (g.type === 'Polygon') ring = g.coordinates[0];
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0]?.[0];
  else if (g.type === 'LineString') ring = g.coordinates;
  else if (g.type === 'MultiLineString') ring = g.coordinates[0];
  if (!ring || ring.length === 0) return null;
  let x = 0, y = 0;
  ring.forEach(p => { x += p[0]; y += p[1]; });
  return [x / ring.length, y / ring.length];
};

const MapView = ({
  data, mapStyle, layerData, selectedLayers, activeAlerts, onSendAlert,
  availableLayers = [], setSelectedLayers
}) => {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [popupInfo, setPopupInfo] = useState(null);
  const [time, setTime] = useState(0);
  const [pinIcons, setPinIcons] = useState({});

  // Animation loop (throttled ~20fps) for trips, AI glow and zone pulse
  useEffect(() => {
    let raf;
    let last = 0;
    const animate = (now) => {
      if (now - last > 50) {
        setTime(t => (t + 2) % 100);
        last = now;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Rasterise pin icons for whichever layers are selected
  useEffect(() => {
    selectedLayers.forEach(name => {
      if (pinIcons[name]) return;
      loadPinIcon(name).then(icon => {
        if (icon) setPinIcons(prev => (prev[name] ? prev : { ...prev, [name]: icon }));
      });
    });
  }, [selectedLayers, pinIcons]);

  const handleZoom = (longitude, latitude) => {
    setViewState({
      longitude,
      latitude,
      zoom: 12,
      pitch: 0,
      bearing: 0,
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator()
    });
    setPopupInfo(null);
  };

  const toggleLayer = (layer) => {
    if (!setSelectedLayers) return;
    setSelectedLayers(
      selectedLayers.includes(layer)
        ? selectedLayers.filter(l => l !== layer)
        : [...selectedLayers, layer]
    );
  };

  // Pin size steps with zoom so pins stay readable but don't swamp the map
  const z = viewState.zoom;
  const pinScale = z < 5 ? 0.7 : z < 8 ? 0.85 : z < 12 ? 1 : 1.15;

  // Split each infrastructure layer into pins (points + polygon centroids) and zone shapes
  const infra = useMemo(() => {
    const pins = {};
    const zones = {};
    selectedLayers.forEach(name => {
      const content = layerData[name];
      if (!content) return;
      const label = getLayerStyle(name).label;

      if (content.type === 'FeatureCollection') {
        const pts = [];
        const shapes = [];
        (content.features || []).forEach(f => {
          const g = f.geometry;
          if (!g) return;
          const props = f.properties || {};
          const nm = props.name || label;
          if (g.type === 'Point') {
            pts.push({ name: nm, longitude: g.coordinates[0], latitude: g.coordinates[1] });
          } else if (g.type === 'MultiPoint') {
            g.coordinates.forEach(c => pts.push({ name: nm, longitude: c[0], latitude: c[1] }));
          } else {
            shapes.push(f);

            // Industrial zones show only the highlighted area, not a map pin.
            if (name !== 'ext_industrial_zones') {
              const c = centroidOf(g);
              if (c) {
                pts.push({
                  name: nm,
                  longitude: c[0],
                  latitude: c[1]
                });
              }
            }
          }
        });
        pins[name] = pts;
        if (shapes.length) zones[name] = { type: 'FeatureCollection', features: shapes };
      } else if (Array.isArray(content) && content.length > 0) {
        pins[name] = content;
      }
    });
    return { pins, zones };
  }, [layerData, selectedLayers]);

  const layers = useMemo(() => {
    const baseLayers = [];

    if (mapStyle === 'satellite') {
      baseLayers.push(
        new TileLayer({
          id: 'satellite-tiles',
          data: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          minZoom: 0,
          maxZoom: 19,
          tileSize: 256,
          renderSubLayers: props => {
            const { bbox: { west, south, east, north } } = props.tile;
            return new BitmapLayer(props, {
              data: null,
              image: props.data,
              bounds: [west, south, east, north]
            });
          }
        })
      );
    }

    const dataLayers = [];
    const pulse = 0.5 + 0.5 * Math.sin((time / 100) * Math.PI * 2);

    // 1) Zones (industrial zones, power plants, ...) — bright glowing polygons, drawn under everything
    Object.keys(infra.zones).forEach(name => {
      const st = getLayerStyle(name);
      const zoneData = infra.zones[name];
      const openPopup = info => {
        if (info.object) {
          setPopupInfo({
            name: info.object.properties?.name || st.label,
            longitude: info.coordinate[0],
            latitude: info.coordinate[1],
            x: info.x,
            y: info.y,
            type: 'infrastructure',
            layerType: name
          });
        }
      };

      dataLayers.push(
        // soft outer glow
        new GeoJsonLayer({
          id: `zone-glow-${name}`,
          data: zoneData,
          pickable: false,
          stroked: true,
          filled: false,
          extruded: false,
          lineWidthUnits: 'pixels',
          getLineWidth: 14,
          getLineColor: [...st.rgb, 90],
          opacity: 0.45 + 0.5 * pulse,
          parameters: { depthTest: false }
        }),
        // solid vivid fill + bright outline
        new GeoJsonLayer({
          id: `zone-${name}`,
          data: zoneData,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 110],
          stroked: true,
          filled: true,
          extruded: false,
          lineWidthUnits: 'pixels',
          getLineWidth: 3,
          getFillColor: st.zoneFill,
          getLineColor: st.zoneLine,
          parameters: { depthTest: false },
          onClick: openPopup
        })
      );
    });

    // 2) Fire heatmap + points
    const aiFires = [];
    if (activeAlerts) {
      activeAlerts.forEach(alert => {
        if (alert.is_ai) aiFires.push(alert.fire);
      });
    }

    if (data && data.length > 0) {
      dataLayers.push(
        new HeatmapLayer({
          id: 'heatmap-layer',
          data,
          getPosition: d => [d.longitude, d.latitude],
          getWeight: d => d.frp,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.05
        }),
        new ScatterplotLayer({
          id: 'scatterplot-layer',
          data,
          pickable: true,
          opacity: 0.8,
          stroked: false,
          filled: true,
          radiusScale: 1000,
          radiusMinPixels: 3,
          radiusMaxPixels: 15,
          lineWidthMinPixels: 1,
          getPosition: d => [d.longitude, d.latitude],
          getFillColor: d => {
            if (d.confidence === 'h') return [239, 68, 68, 255];
            if (d.confidence === 'l') return [250, 204, 21, 200];
            return [249, 115, 22, 220];
          },
          onClick: info => {
            if (info.object) {
              const isAi = aiFires.some(f => f.longitude === info.object.longitude && f.latitude === info.object.latitude);
              setPopupInfo({
                ...info.object,
                x: info.x,
                y: info.y,
                type: 'fire',
                is_ai: isAi
              });
            }
          }
        })
      );
    }

    // 3) Pulsing glow for AI-detected industrial fires
    if (aiFires.length > 0) {
      const radiusOffset = 5 * Math.sin((time / 100) * Math.PI * 2);
      dataLayers.push(
        new ScatterplotLayer({
          id: 'ai-glow-layer',
          data: aiFires,
          pickable: false,
          opacity: 0.6,
          stroked: true,
          getLineColor: [139, 92, 246, 255],
          getLineWidth: 2,
          lineWidthMinPixels: 2,
          filled: true,
          radiusScale: 1000,
          radiusMinPixels: 15 + radiusOffset,
          radiusMaxPixels: 30 + radiusOffset,
          getPosition: d => [d.longitude, d.latitude],
          getFillColor: [139, 92, 246, 100],
        })
      );
    }

    // 4) Alert routes
    if (activeAlerts && activeAlerts.length > 0) {
      const tripsData = activeAlerts.map(alert => ({
        path: [
          [alert.fire.longitude, alert.fire.latitude],
          [alert.station.longitude, alert.station.latitude]
        ],
        timestamps: [0, 100],
        color: alert.target_type === 'police' ? [59, 130, 246] : [239, 68, 68]
      }));

      dataLayers.push(
        new TripsLayer({
          id: 'alert-trips',
          data: tripsData,
          getPath: d => d.path,
          getTimestamps: d => d.timestamps,
          getColor: d => d.color,
          opacity: 0.8,
          widthMinPixels: 5,
          rounded: true,
          trailLength: 40,
          currentTime: time,
          shadowEnabled: false
        })
      );
    }

    // 5) Google-Maps-style pins, always on top
    Object.keys(infra.pins).forEach(name => {
      const items = infra.pins[name];
      if (!items || items.length === 0) return;
      const icon = pinIcons[name];
      if (!icon) return;

      dataLayers.push(
        new IconLayer({
          id: `pins-${name}`,
          data: items,
          pickable: true,
          billboard: true,
          sizeUnits: 'pixels',
          sizeScale: pinScale,
          getSize: 44,
          getIcon: () => icon,
          getPosition: d => [d.longitude, d.latitude],
          parameters: { depthTest: false },
          updateTriggers: { sizeScale: pinScale },
          onClick: info => {
            if (info.object) {
              setPopupInfo({
                ...info.object,
                x: info.x,
                y: info.y,
                type: 'infrastructure',
                layerType: name
              });
            }
          }
        })
      );
    });

    return [...baseLayers, ...dataLayers];
  }, [data, mapStyle, infra, activeAlerts, time, pinScale, pinIcons]);

  const popupStyle = popupInfo && popupInfo.type === 'infrastructure' ? getLayerStyle(popupInfo.layerType) : null;

  return (
    <div className="deckgl-wrapper" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <style>{CHIP_CSS}</style>

      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
        onClick={(info) => {
          if (!info.object) setPopupInfo(null);
        }}
      >
        {mapStyle !== 'satellite' && (
          <Map
            mapStyle={MAP_STYLES[mapStyle]}
            reuseMaps
          />
        )}
      </DeckGL>

      {/* Google-Maps-style category chips */}
      
      {availableLayers.length > 0 && (
        <div className="gm-chips" role="group" aria-label="Map layers">
          {availableLayers.map(layer => {
            const st = getLayerStyle(layer);
            const active = selectedLayers.includes(layer);
            return (
              <button
                key={layer}
                type="button"
                className={`gm-chip ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleLayer(layer)}
                style={active ? { background: st.color, borderColor: st.color } : undefined}
              >
                {active ? (
                  <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={st.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      {st.paths.map((d, i) => <path key={i} d={d} />)}
                    </svg>
                  </span>
                ) : (
                  <LayerBadge name={layer} size={28} />
                )}
                {st.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Interactive Popup */}
      {popupInfo && (
        <div
          className="custom-popup"
          style={{
            left: popupInfo.x + 15,
            top: popupInfo.y - 15,
          }}
        >
          <div className="popup-content">
            <button className="popup-close" onClick={() => setPopupInfo(null)}>×</button>
            {popupInfo.type === 'fire' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>🔥 Fire Event</h3>
                  {popupInfo.is_ai && (
                    <span style={{ background: '#ef4444', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>
                      ⚠️ INSPECTION NEEDED
                    </span>
                  )}
                </div>
                <p><strong>FRP:</strong> {popupInfo.frp}</p>
                <p><strong>Confidence:</strong> {popupInfo.confidence}</p>
                <p><strong>Date:</strong> {popupInfo.acq_date}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  <button
                    className="alert-btn"
                    onClick={() => {
                      onSendAlert(popupInfo, 'fire_stations');
                      setPopupInfo(null);
                    }}
                    style={{
                      padding: '8px', background: '#dc2626', color: 'white',
                      border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Send to Fire Station
                  </button>
                  <button
                    className="alert-btn"
                    onClick={() => {
                      onSendAlert(popupInfo, 'police');
                      setPopupInfo(null);
                    }}
                    style={{
                      padding: '8px', background: '#2563eb', color: 'white',
                      border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Send to Police Station
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <LayerBadge name={popupInfo.layerType} size={34} />
                  <div>
                    <div style={{ fontSize: '0.75rem', color: popupStyle.color, fontWeight: 700 }}>{popupStyle.label}</div>
                    <div style={{ fontWeight: 700, color: '#1e293b', lineHeight: 1.25 }}>{popupInfo.name}</div>
                  </div>
                </div>
              </>
            )}
            <button
              className="zoom-btn"
              onClick={() => handleZoom(popupInfo.longitude, popupInfo.latitude)}
            >
              Zoom Here
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;