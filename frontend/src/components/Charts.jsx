import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Charts = ({ trendData }) => {
  if (!trendData || trendData.length === 0) return null;

  return (
    <div className="control-group">
      <label>Daily Fire Detections (Last 30 Days)</label>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={trendData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickFormatter={(tick) => tick.substring(5)} />
            <YAxis stroke="#64748b" fontSize={10} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              itemStyle={{ color: '#1e293b' }}
            />
            <Area type="monotone" dataKey="count" stroke="#ef4444" fillOpacity={1} fill="url(#colorCount)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Charts;
