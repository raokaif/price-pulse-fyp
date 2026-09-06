import React, { useEffect, useState } from 'react';
import api from '../api';

export default function About(){
  const [info, setInfo] = useState(null);
  useEffect(()=>{ api.get('/about').then(r=>setInfo(r.data)).catch(()=>setInfo(null)); },[]);
  return (
    <div className="container">
      <div className="hero">
        <h1>About PricePulse (React)</h1>
        <p></p>
      </div>
      <div className="card" style={{padding:20}}>
        {info ? (
          <div>
            <h3 style={{marginBottom:8}}>{info.name || 'PricePulse API'}</h3>
            <div style={{color:'#555', marginBottom:12}}>Version: {info.version || 'unknown'}</div>
            <div style={{fontSize:13, color:'#666'}}>This site uses a separate JSON API for scraping and authentication. The API above is reachable at the configured backend URL.</div>
          </div>
        ) : (
          <div style={{color:'#777'}}>No additional info</div>
        )}
      </div>
    </div>
  );
}
