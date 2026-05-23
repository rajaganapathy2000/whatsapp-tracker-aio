import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { 
  Home, Settings, User, Plus, Wifi, WifiOff, 
  ChevronRight, ChevronLeft, Trash2, Moon, Sun, 
  Pin, Bell, BellOff, ArrowLeft, GripVertical, Clock, RefreshCw, Zap, List,
  Search, GitCompare, Timer, SlidersHorizontal, Copy, CheckCircle2, Eye, EyeOff, Palette,
  Battery, BatteryCharging, Power, QrCode, Coffee, Briefcase, Lock, Delete, Star
} from 'lucide-react';

// --- LIVE STOPWATCH COMPONENT (Optimized length so it doesn't truncate) ---
const LiveTimer = memo(function LiveTimer({ startTimeMs }) {
    const [now, setNow] = useState(Date.now());
    
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    if (!startTimeMs) return null;

    const MathFloor = Math.floor;
    const elapsed = Math.max(0, now - startTimeMs);
    const h = MathFloor(elapsed / 3600000);
    const m = MathFloor((elapsed % 3600000) / 60000);
    const s = MathFloor((elapsed % 60000) / 1000);

    let timeStr = '';
    if (h > 0) timeStr = `${h} hrs ${m} mins ${s} secs`;
    else if (m > 0) timeStr = `${m} min ${s} sec`;
    else timeStr = `${s} sec`;

    return <span className="ml-1 tracking-wider lowercase font-mono opacity-90 inline-block">({timeStr})</span>;
});

// --- DRAGGABLE CHAT HEAD BUBBLE COMPONENT ---
const DraggableBubble = memo(function DraggableBubble({ target, initialY }) {
    const [pos, setPos] = useState({ x: window.innerWidth - 70, y: initialY });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    const handleTouchStart = (e) => {
        setIsDragging(true);
        dragStart.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y };
    };
    
    const handleTouchMove = (e) => {
        if (!isDragging) return;
        e.preventDefault(); // Prevents screen scrolling while dragging bubble
        setPos({ x: e.touches[0].clientX - dragStart.current.x, y: e.touches[0].clientY - dragStart.current.y });
    };

    const handleTouchEnd = () => setIsDragging(false);

    const handleMouseDown = (e) => {
        setIsDragging(true);
        dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    };
    const handleMouseMove = (e) => {
        if (!isDragging) return;
        setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    };
    const handleMouseUp = () => setIsDragging(false);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleTouchEnd);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        }
    }, [isDragging]);

    return (
        <div 
            style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            className="fixed z-[999] w-14 h-14 rounded-full glass-card border border-gray-200 dark:border-gray-700 shadow-xl flex items-center justify-center cursor-grab active:cursor-grabbing backdrop-blur-md bg-white/60 dark:bg-gray-900/60 transition-transform active:scale-95"
        >
            <img src={`https://api.dicebear.com/7.x/shapes/svg?seed=${target.number}`} alt="avatar" className="w-12 h-12 rounded-full opacity-80" />
            <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 shadow-sm ${target.isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
        </div>
    );
});


export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [viewingTarget, setViewingTarget] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [currentTheme, setCurrentTheme] = useState('light-classic');
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  
  // Advanced Device & Stealth States
  const [isWakeLockActive, setIsWakeLockActive] = useState(() => localStorage.getItem('waWakeLock') === 'true');
  const [isBossKeyActive, setIsBossKeyActive] = useState(() => localStorage.getItem('waBossKey') === 'true');
  const [isPanicShakeActive, setIsPanicShakeActive] = useState(() => localStorage.getItem('waPanicShake') === 'true'); // NEW: Shake to Hide state
  const [showQuickActions, setShowQuickActions] = useState(false);
  
  // Custom Restart Modal State
  const [showRestartModal, setShowRestartModal] = useState(false);
  
  // App Lock States
  const [appLockPin, setAppLockPin] = useState(() => localStorage.getItem('waAppLockPin') || '');
  const [isAppLocked, setIsAppLocked] = useState(() => !!localStorage.getItem('waAppLockPin'));
  
  const [apiConfig, setApiConfig] = useState({ url: '', key: '', pusherKey: '', pusherCluster: '' });
  
  // ROBUST LOCAL CACHE: Ensures pins don't disappear on deep app wake
  const [targets, setTargets] = useState(() => {
    try {
      const cachedTargets = localStorage.getItem('waTrackerCachedTargets');
      return cachedTargets ? JSON.parse(cachedTargets) : [];
    } catch(e) { return []; }
  });
  
  // Store Starred/Monitored Targets for Live Bubble and PiP
  const [monitoredTargets, setMonitoredTargets] = useState(() => {
    try {
      const cached = localStorage.getItem('waMonitoredTargets');
      return cached ? JSON.parse(cached) : [];
    } catch(e) { return []; }
  });

  // NEW: Store Targets with Aggressive "Live Alert" Alarms Enabled
  const [alertTargets, setAlertTargets] = useState(() => {
    try {
      const cached = localStorage.getItem('waAlertTargets');
      return cached ? JSON.parse(cached) : [];
    } catch(e) { return []; }
  });
  
  const [newTarget, setNewTarget] = useState({ name: '', number: '' });
  const [pingStats, setPingStats] = useState({ latency: 0, uptime: 'N/A', dbStatus: 'Offline', wsStatus: 'Disconnected' });
  
  const [botHealth, setBotHealth] = useState({ battery: null, isCharging: false, ram: null, storage: null, network: null, botUptime: null, cpuTemp: null });
  const [botStatus, setBotStatus] = useState({ status: 'connected', qrString: null });
  
  // --- ALARM ENGINE STATE ---
  const [isAlarmRinging, setIsAlarmRinging] = useState(false);
  const audioCtxRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const prevTargetsRef = useRef(targets);

  const fetchLiveStateRef = useRef();
  const wakeLockRef = useRef(null);
  const pipWindowRef = useRef(null);

  // --- LOCAL STORAGE PERSISTENCE ---
  useEffect(() => {
    const savedConfig = localStorage.getItem('waTrackerConfig');
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      if (parsed.apiConfig) setApiConfig(parsed.apiConfig);
      if (parsed.isDarkMode !== undefined) setIsDarkMode(parsed.isDarkMode);
      if (parsed.currentTheme) setCurrentTheme(parsed.currentTheme);
      if (parsed.isPrivacyMode !== undefined) setIsPrivacyMode(parsed.isPrivacyMode);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('waTrackerConfig', JSON.stringify({ 
      apiConfig, isDarkMode, currentTheme, isPrivacyMode 
    }));
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (currentTheme.startsWith('dark')) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [apiConfig, isDarkMode, currentTheme, isPrivacyMode]);

  useEffect(() => { localStorage.setItem('waTrackerCachedTargets', JSON.stringify(targets)); }, [targets]);
  useEffect(() => { localStorage.setItem('waMonitoredTargets', JSON.stringify(monitoredTargets)); }, [monitoredTargets]);
  useEffect(() => { localStorage.setItem('waAlertTargets', JSON.stringify(alertTargets)); }, [alertTargets]);
  useEffect(() => { localStorage.setItem('waWakeLock', isWakeLockActive); }, [isWakeLockActive]);
  useEffect(() => { localStorage.setItem('waBossKey', isBossKeyActive); }, [isBossKeyActive]);
  useEffect(() => { localStorage.setItem('waPanicShake', isPanicShakeActive); }, [isPanicShakeActive]);
  useEffect(() => { localStorage.setItem('waAppLockPin', appLockPin); }, [appLockPin]);

  // --- STEALTH & DEVICE APIs ---
  useEffect(() => {
    const requestWakeLock = async () => {
      if (isWakeLockActive && 'wakeLock' in navigator) {
        try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) { }
      }
    };
    const releaseWakeLock = async () => {
      if (wakeLockRef.current !== null) {
        try { await wakeLockRef.current.release(); wakeLockRef.current = null; } catch (err) { }
      }
    };

    if (isWakeLockActive) {
      requestWakeLock();
      const handleVisibilityChange = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        releaseWakeLock();
      };
    } else {
      releaseWakeLock();
    }
  }, [isWakeLockActive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isBossKeyActive && document.visibilityState === 'hidden') {
        document.title = 'Google Drive';
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.href = 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png';
      } else {
        document.title = 'WhatsApp Tracker Pro';
        let link = document.querySelector("link[rel~='icon']");
        if (link) link.href = '/tracker-icon.svg'; 
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isBossKeyActive]);

  // Shake to Hide (Panic Mode) via devicemotion API
  useEffect(() => {
    const handleMotion = (event) => {
        const { x, y, z } = event.accelerationIncludingGravity || {};
        if (!x || !y || !z) return;
        const acceleration = Math.sqrt(x*x + y*y + z*z);
        if (acceleration > 25) {
            window.location.href = 'https://drive.google.com';
        }
    };
    if (isPanicShakeActive) {
        window.addEventListener('devicemotion', handleMotion);
    }
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [isPanicShakeActive]);

  // --- NATIVE AUDIO SYNTHESIZER (No external files needed) ---
  const playBeep = useCallback(() => {
      try {
          if (!audioCtxRef.current) {
              audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') ctx.resume();
          
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch alarm
          
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.5);
      } catch (e) { console.log("Audio play error (Browser restriction):", e); }
  }, []);

  const stopAlarm = useCallback(() => {
      setIsAlarmRinging(false);
      if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
  }, []);

  // --- ALARM TRIGGER ENGINE ---
  useEffect(() => {
      const prev = prevTargetsRef.current;
      let newlyOnline = false;
      targets.forEach(t => {
          if (alertTargets.includes(t.id) && t.isOnline) {
              const pt = prev.find(x => x.id === t.id);
              if (!pt || !pt.isOnline) newlyOnline = true; // Transitioned to online!
          }
      });
      
      if (newlyOnline) {
          setIsAlarmRinging(true);
          if ('wakeLock' in navigator) {
              navigator.wakeLock.request('screen').catch(()=>{}); // Try to wake screen
          }
          playBeep();
          if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
          alarmIntervalRef.current = setInterval(playBeep, 1000); // Ring every second
      }
      prevTargetsRef.current = targets;
  }, [targets, alertTargets, playBeep]);

  // --- AUTO-DISMISS ALARM ON VISIBILITY ---
  useEffect(() => {
      if (isAlarmRinging) {
          const handleVisibility = () => {
              if (document.visibilityState === 'visible') {
                  // User opened phone and saw the notification -> auto dismiss!
                  setTimeout(() => { stopAlarm(); }, 2000);
              }
          };
          document.addEventListener('visibilitychange', handleVisibility);
          return () => document.removeEventListener('visibilitychange', handleVisibility);
      }
  }, [isAlarmRinging, stopAlarm]);

  // --- MEMOIZED PROXY FETCH ENGINE ---
  const mongoFetch = useCallback(async (action, collection, query = {}, sort = {}, limit = null, update = {}) => {
    if (!apiConfig.url || !apiConfig.key) return null;
    const startTime = Date.now();
    try {
      const body = { database: 'WhatsAppTracker', collection, action, filter: query, update };
      if (Object.keys(sort).length > 0) body.sort = sort;
      if (limit) body.limit = limit;

      const res = await fetch(apiConfig.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiConfig.key },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      
      const data = await res.json();
      setPingStats(prev => ({ ...prev, latency: Date.now() - startTime, dbStatus: 'Connected' }));
      return data;
    } catch (e) {
      setPingStats(prev => ({ ...prev, dbStatus: 'Error' }));
      return null;
    }
  }, [apiConfig.url, apiConfig.key]);

  // --- DASHBOARD SYNC ENGINE (0.01s SECRETARY FIX + LOCAL FIRST) ---
  const fetchLiveState = useCallback(async () => {
    if (!apiConfig.url || !apiConfig.key) return;
    setIsSyncing(true);
    
    const instantPromise = mongoFetch('findOne', 'system_config', { _id: 'instant_status' });
    const backgroundPromises = Promise.all([
      mongoFetch('findOne', 'system_config', { _id: 'main_config' }),
      mongoFetch('findOne', 'system_config', { _id: 'contacts_map' }),
      mongoFetch('findOne', 'system_config', { _id: 'bot_health' }),
      mongoFetch('findOne', 'system_config', { _id: 'bot_status' })
    ]);

    const instantRes = await instantPromise;
    const instantData = instantRes?.document?.statuses || {};

    setTargets(prevTargets => {
      if (prevTargets.length > 0) {
        return prevTargets.map(t => {
          const data = instantData[t.number];
          if (!data) return t;

          const h = Math.floor((data.todayMs || 0) / 3600000);
          const m = Math.floor(((data.todayMs || 0) % 3600000) / 60000);
          const totalTimeStr = (data.todayMs > 0) ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '0m';

          return {
            ...t,
            isOnline: data.isOnline || false,
            lastSeen: data.recentOffline || t.lastSeen,
            lastActiveMs: data.recentOfflineMs || t.lastActiveMs,
            totalTime: totalTimeStr
          };
        });
      }
      return prevTargets;
    });

    const [configRes, contactsRes, healthRes, statusRes] = await backgroundPromises;
    
    if (statusRes?.document) {
        setBotStatus({ status: statusRes.document.status, qrString: statusRes.document.qrString });
    }
    
    const configDoc = configRes?.document || { targets: [], muted: [] };
    const contactsDoc = contactsRes?.document?.contacts || {};

    if (healthRes?.document) {
      setBotHealth({
        battery: healthRes.document.battery ?? null,
        isCharging: healthRes.document.isCharging ?? false,
        ram: healthRes.document.ram ?? null,
        storage: healthRes.document.storage ?? null,
        network: healthRes.document.network ?? null,
        botUptime: healthRes.document.botUptime ?? null,
        cpuTemp: healthRes.document.cpuTemp ?? null
      });
    }

    setTargets(prevTargets => {
      return configDoc.targets.map(num => {
        const existing = prevTargets.find(t => t.number === num);
        const data = instantData[num] || {};

        const h = Math.floor((data.todayMs || 0) / 3600000);
        const m = Math.floor(((data.todayMs || 0) % 3600000) / 60000);
        const totalTimeStr = (data.todayMs > 0) ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '0m';

        return {
          id: num, 
          number: num, 
          name: contactsDoc[num] || (existing ? existing.name : num), 
          isOnline: data.isOnline !== undefined ? data.isOnline : (existing ? existing.isOnline : false), 
          totalTime: data.todayMs !== undefined ? totalTimeStr : (existing ? existing.totalTime : '0m'), 
          lastSeen: data.recentOffline || (existing ? existing.lastSeen : 'Never'),
          lastActiveMs: data.recentOfflineMs || (existing ? existing.lastActiveMs : 0),
          isPinned: existing ? existing.isPinned : false, 
          pinOrder: existing ? existing.pinOrder : 99,
          isMuted: configDoc.muted.includes(num),
        };
      });
    });

    setIsSyncing(false);

  }, [apiConfig.url, apiConfig.key, mongoFetch]);

  fetchLiveStateRef.current = fetchLiveState;

  useEffect(() => {
    if (!apiConfig.pusherKey || !apiConfig.pusherCluster) return;

    let pusherInstance = null;
    let syncTimeout = null;

    const initPusher = () => {
      if (!window.Pusher) return;
      
      pusherInstance = new window.Pusher(apiConfig.pusherKey, { cluster: apiConfig.pusherCluster });
      
      pusherInstance.connection.bind('connected', () => setPingStats(p => ({ ...p, wsStatus: 'Live' })));
      pusherInstance.connection.bind('disconnected', () => setPingStats(p => ({ ...p, wsStatus: 'Disconnected' })));

      const channel = pusherInstance.subscribe('whatsapp-tracker');
      channel.bind('status-change', (data) => {
        setTargets(prev => prev.map(t => {
          if (t.number === data.number) {
            // Uses precise timestamp sent directly from the bot for perfect 0ms latency timer anchoring
            return { ...t, isOnline: data.status === 'online', lastSeen: data.status === 'online' ? 'Active Now' : 'Just now', lastActiveMs: data.timestamp || Date.now() };
          }
          return t;
        }));

        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            if (fetchLiveStateRef.current) fetchLiveStateRef.current();
        }, 1500); 
      });
    };

    if (!window.Pusher) {
      const script = document.createElement('script');
      script.src = "https://js.pusher.com/8.2.0/pusher.min.js";
      script.async = true;
      script.onload = initPusher;
      document.body.appendChild(script);
    } else {
      initPusher();
    }

    return () => { 
      if (pusherInstance) pusherInstance.disconnect(); 
      if (syncTimeout) clearTimeout(syncTimeout);
    };
  }, [apiConfig.pusherKey, apiConfig.pusherCluster]);

  useEffect(() => {
    if (!apiConfig.url || !apiConfig.key) return;
    
    // The app will now securely fetch live stats in the background while you are looking at the Lock Screen.
    fetchLiveState();
    
    const interval = setInterval(fetchLiveState, 60000);
    return () => clearInterval(interval);
  }, [apiConfig.url, apiConfig.key, fetchLiveState]);

  // --- NATIVE DOCUMENT PICTURE-IN-PICTURE RENDERER ---
  const renderPiPContent = useCallback(() => {
    if (!pipWindowRef.current) return;
    const container = pipWindowRef.current.document.getElementById('pip-root');
    if (!container) return;
    
    const monitoredList = targets.filter(t => monitoredTargets.includes(t.id));
    
    let html = `<h3 style="margin-top:0;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;font-family:sans-serif;">⭐ Live Monitor</h3>`;
    if (monitoredList.length === 0) {
        html += `<p style="font-size:12px;color:#6b7280;font-family:sans-serif;">No starred targets.</p>`;
    } else {
        monitoredList.forEach(t => {
            const dot = t.isOnline ? '<span style="color:#22c55e;">🟢</span>' : '<span style="color:#ef4444;">🔴</span>';
            const nameColor = isDarkMode ? '#e5e7eb' : '#374151';
            html += `<div style="display:flex;align-items:center;margin-bottom:10px;font-size:14px;font-family:sans-serif;">
                ${dot} <span style="margin-left:8px;font-weight:600;color:${nameColor}">${t.name}</span>
            </div>`;
        });
    }
    container.innerHTML = html;
  }, [targets, monitoredTargets, isDarkMode]);

  useEffect(() => {
      renderPiPContent(); // Always keep PiP updated if active
  }, [targets, monitoredTargets, renderPiPContent]);

  const openPiP = async () => {
    if (!('documentPictureInPicture' in window)) {
        alert('Your Chrome version blocks the native PiP API. You can safely ignore this, as the transparent floating bubbles have spawned on your screen!');
        return;
    }
    try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 280, height: 320 });
        pipWindowRef.current = pipWindow;
        
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.padding = '12px';
        pipWindow.document.body.style.backgroundColor = isDarkMode ? '#111827' : '#f9fafb';
        pipWindow.document.body.style.color = isDarkMode ? '#fff' : '#000';
        
        const container = pipWindow.document.createElement('div');
        container.id = 'pip-root';
        pipWindow.document.body.appendChild(container);
        
        pipWindow.addEventListener('pagehide', () => { pipWindowRef.current = null; });
        
        renderPiPContent();
    } catch (e) {
        console.error('PiP failed', e);
        alert('Failed to launch PiP mode.');
    }
  };

  const handleAddTarget = useCallback(async () => {
    if (!newTarget.number) return;
    const num = newTarget.number.replace(/\D/g, '');
    const newT = { id: num, number: num, name: newTarget.name || num, isOnline: false, totalTime: '0m', lastSeen: 'Never', lastActiveMs: 0, isPinned: false, pinOrder: 99, isMuted: false };
    
    setTargets(prev => {
        const updated = [...prev, newT];
        const numbersOnly = updated.map(t => t.number);
        mongoFetch('updateOne', 'system_config', { _id: 'main_config' }, {}, null, { $set: { targets: numbersOnly } });
        if (newTarget.name) mongoFetch('updateOne', 'system_config', { _id: 'contacts_map' }, {}, null, { $set: { [`contacts.${num}`]: newTarget.name } });
        return updated;
    });
    setNewTarget({ name: '', number: '' });
  }, [newTarget, mongoFetch]);

  const handleRemoveTarget = useCallback(async (id) => {
    setTargets(prev => {
        const updated = prev.filter(t => t.id !== id);
        const numbersOnly = updated.map(t => t.number);
        mongoFetch('updateOne', 'system_config', { _id: 'main_config' }, {}, null, { $set: { targets: numbersOnly } });
        return updated;
    });
    setMonitoredTargets(prev => prev.filter(t => t !== id)); // Clean up monitored list
    setAlertTargets(prev => prev.filter(t => t !== id)); // Clean up alert list
    setViewingTarget(null);
  }, [mongoFetch]);

  const togglePin = useCallback((id) => setTargets(prev => prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned, pinOrder: !t.isPinned ? prev.filter(x=>x.isPinned).length : 99 } : t)), []);
  
  // Toggle Monitor
  const toggleMonitor = useCallback((id) => {
      setMonitoredTargets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  // Toggle Live Alert
  const toggleAlertTarget = useCallback((id) => {
      setAlertTargets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const toggleMute = useCallback(async (id) => {
    setTargets(prev => {
        const updated = prev.map(t => t.id === id ? { ...t, isMuted: !t.isMuted } : t);
        const mutedList = updated.filter(t => t.isMuted).map(t => t.number);
        mongoFetch('updateOne', 'system_config', { _id: 'main_config' }, {}, null, { $set: { muted: mutedList } });
        return updated;
    });
  }, [mongoFetch]);

  const handleSnooze = useCallback(async (id, hours) => {
    const target = targets.find(t => t.id === id);
    if (!target) return;
    const snoozeEndMs = Date.now() + (hours * 3600 * 1000);
    await mongoFetch('updateOne', 'system_config', { _id: 'main_config' }, {}, null, { $set: { [`snooze.${target.number}`]: snoozeEndMs } });
  }, [targets, mongoFetch]);

  const reorderPinned = useCallback((dragIndex, dropIndex) => {
    setTargets(prev => {
        const pinned = prev.filter(t => t.isPinned).sort((a,b) => a.pinOrder - b.pinOrder);
        const unpinned = prev.filter(t => !t.isPinned);
        const [draggedItem] = pinned.splice(dragIndex, 1);
        pinned.splice(dropIndex, 0, draggedItem);
        const reorderedPinned = pinned.map((t, idx) => ({ ...t, pinOrder: idx }));
        return [...reorderedPinned, ...unpinned];
    });
  }, []);

  const submitRestart = async (isUpdate) => {
    await mongoFetch('updateOne', 'system_config', { _id: 'remote_restart' }, {}, null, { $set: { pending: true, update: isUpdate } });
    setShowRestartModal(false);
    alert(isUpdate ? '☁️ Update & Restart command sent! The bot will download the latest code and reboot in ~5 seconds.' : '🔄 Restart command sent! The bot will reboot in ~5 seconds.');
  };

  // APP LOCK SCREEN RENDERER
  if (isAppLocked) {
    return <LockScreenView expectedPin={appLockPin} onUnlock={() => setIsAppLocked(false)} isDarkMode={isDarkMode} />;
  }

  // Calculate live tracked users for the bubble
  const onlineMonitoredCount = targets.filter(t => monitoredTargets.includes(t.id) && t.isOnline).length;
  const totalMonitoredCount = monitoredTargets.length;

  return (
    <div className={`wa-app-container`}>
      {/* RESPONSIVE FLUID CONTAINER: max-w-7xl on desktop */}
      <div className="flex flex-col lg:flex-row h-[100dvh] max-w-md lg:max-w-6xl xl:max-w-7xl mx-auto font-sans antialiased overflow-hidden sm:glass-panel sm:rounded-[3rem] sm:h-[850px] lg:h-[90vh] sm:my-8 lg:my-auto relative transition-colors duration-300">
        
        {/* ================= ALARM MODAL OVERLAY ================= */}
        {isAlarmRinging && (
            <div className="fixed inset-0 z-[9999] bg-red-600/95 dark:bg-red-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
                {/* Flashing effect */}
                <div className="absolute inset-0 bg-white/30 animate-pulse pointer-events-none" style={{ animationDuration: '0.6s' }}></div>
                
                <h1 className="text-4xl md:text-5xl font-black text-white mb-2 animate-bounce drop-shadow-2xl">🚨 TARGET ONLINE!</h1>
                <p className="text-red-100 font-medium mb-8 text-center drop-shadow-md">A monitored target has just connected to WhatsApp.</p>

                <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-[2rem] p-5 shadow-2xl mb-10 z-10 max-h-[50vh] overflow-y-auto border-4 border-red-500/30">
                    <h3 className="text-xs font-black text-red-500 dark:text-red-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800 pb-3 mb-4 flex items-center">
                        <Zap size={14} className="mr-1 animate-pulse" /> Live Alert Roster
                    </h3>
                    
                    <div className="space-y-3">
                        {targets.filter(t => alertTargets.includes(t.id)).map(t => (
                            <div key={t.id} className={`flex flex-col p-3 rounded-2xl border transition-colors ${t.isOnline ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                                <div className="flex justify-between items-center mb-1.5">
                                    <div className="flex items-center space-x-2.5">
                                        <div className={`w-3 h-3 rounded-full shadow-sm ${t.isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                                        <span className="font-bold text-gray-900 dark:text-white truncate max-w-[200px] text-lg">{t.name}</span>
                                    </div>
                                </div>
                                <div className="text-xs">
                                    {t.isOnline ? (
                                        <span className="text-green-600 dark:text-green-400 font-bold flex items-center bg-green-100 dark:bg-green-900/40 w-max px-2 py-1 rounded-lg mt-1">
                                            Online Now <LiveTimer startTimeMs={t.lastActiveMs} />
                                        </span>
                                    ) : (
                                        <div className="text-gray-500 dark:text-gray-400 flex flex-col space-y-0.5 mt-1">
                                            <span className="font-medium">Total Today: {t.totalTime}</span>
                                            <span className="text-[10px]">Last Seen: {t.lastSeen}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <button onClick={stopAlarm} className="bg-white text-red-600 text-xl md:text-2xl font-black px-12 py-5 rounded-full shadow-2xl active:scale-95 transition-transform z-10 hover:bg-red-50 border-2 border-red-100">
                    ACKNOWLEDGE
                </button>
            </div>
        )}
        {/* ======================================================== */}

        {/* NEW DRAGGABLE BUBBLES FOR MONITORED TARGETS */}
        {monitoredTargets.map((id, index) => {
            const target = targets.find(t => t.id === id);
            if (!target) return null;
            return <DraggableBubble key={id} target={target} initialY={100 + (index * 65)} />;
        })}

        {/* Live Floating Bubble */}
        {totalMonitoredCount > 0 && activeTab === 'dashboard' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] glass-card px-4 py-1.5 rounded-full shadow-lg border border-gray-200/50 dark:border-gray-700/50 flex items-center space-x-2 animate-in slide-in-from-top-4">
                <span className="relative flex h-2.5 w-2.5">
                    {onlineMonitoredCount > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${onlineMonitoredCount > 0 ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}`}></span>
                </span>
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                    {onlineMonitoredCount} Online
                </span>
            </div>
        )}

        {/* Restart Options Modal */}
        {showRestartModal && (
          <div className="absolute inset-0 z-[110] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in">
            <div className="glass-panel border-gray-200/20 shadow-2xl p-6 flex flex-col w-full max-w-xs relative rounded-3xl bg-white dark:bg-gray-900 text-center">
              <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">Restart Options</h3>
              <p className="text-sm text-gray-500 mb-6">Would you like to pull the latest code from GitHub before restarting?</p>
              
              <div className="flex flex-col space-y-3">
                <button onClick={() => submitRestart(true)} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md transition-colors flex items-center justify-center space-x-2">
                  <span className="text-lg">☁️</span> <span>Update & Restart</span>
                </button>
                <button onClick={() => submitRestart(false)} className="w-full py-3 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-800 dark:text-white rounded-xl font-bold transition-colors flex items-center justify-center space-x-2">
                  <span className="text-lg">🔄</span> <span>Restart Only</span>
                </button>
                <button onClick={() => setShowRestartModal(false)} className="w-full py-3 text-red-500 font-bold transition-colors mt-2">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {botStatus.status === 'qr_required' && botStatus.qrString && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in">
            <div className="glass-panel border-red-500/30 shadow-2xl shadow-red-900/20 p-8 flex flex-col items-center text-center max-w-sm w-full relative rounded-[3rem]">
              <QrCode size={48} className="text-red-500 mb-4" />
              <h2 className="text-2xl font-bold mb-2">WhatsApp Logged Out</h2>
              <p className="text-gray-400 text-sm mb-6">The Termux backend lost connection. Scan this QR code with your secondary phone to instantly resume tracking.</p>
              <div className="bg-white p-3 rounded-2xl mb-6 shadow-inner">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(botStatus.qrString)}`} alt="Login QR" className="w-48 h-48" />
              </div>
              <p className="text-xs text-gray-500 animate-pulse font-mono tracking-widest uppercase">Waiting for scan...</p>
            </div>
          </div>
        )}

        {/* RESPONSIVE TAB BAR: Bottom on Mobile, Left Sidebar on Desktop */}
        <div className="absolute bottom-0 lg:top-0 lg:left-0 lg:w-24 lg:h-full lg:flex-col w-full glass-card border-x-0 border-b-0 lg:border-r lg:border-b-0 lg:border-t-0 rounded-b-[3rem] lg:rounded-l-[3rem] lg:rounded-r-none pb-safe pt-3 lg:pt-0 px-6 lg:px-0 flex justify-around items-center z-50">
          <button onClick={() => {setActiveTab('dashboard'); setViewingTarget(null); setShowQuickActions(false);}} className={`flex flex-col items-center justify-center p-2 mb-2 lg:mb-8 transition-all duration-300 active:scale-90 lg:w-full lg:h-24 ${activeTab === 'dashboard' && !viewingTarget ? 'text-blue-500 lg:scale-110' : 'text-gray-500 dark:text-gray-400 lg:hover:text-blue-400'}`}>
            <Home size={24} strokeWidth={activeTab === 'dashboard' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] lg:text-[11px] font-medium mt-1 lg:mt-2">Dashboard</span>
          </button>
          <button onClick={() => {setActiveTab('compare'); setViewingTarget(null); setShowQuickActions(false);}} className={`flex flex-col items-center justify-center p-2 mb-2 lg:mb-8 transition-all duration-300 active:scale-90 lg:w-full lg:h-24 ${activeTab === 'compare' && !viewingTarget ? 'text-blue-500 lg:scale-110' : 'text-gray-500 dark:text-gray-400 lg:hover:text-blue-400'}`}>
            <GitCompare size={24} strokeWidth={activeTab === 'compare' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] lg:text-[11px] font-medium mt-1 lg:mt-2">Compare</span>
          </button>
          <button onClick={() => {setActiveTab('settings'); setViewingTarget(null); setShowQuickActions(false);}} className={`flex flex-col items-center justify-center p-2 mb-2 lg:mb-8 transition-all duration-300 active:scale-90 lg:w-full lg:h-24 ${activeTab === 'settings' && !viewingTarget ? 'text-blue-500 lg:scale-110' : 'text-gray-500 dark:text-gray-400 lg:hover:text-blue-400'}`}>
            <Settings size={24} strokeWidth={activeTab === 'settings' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] lg:text-[11px] font-medium mt-1 lg:mt-2">Settings</span>
          </button>
        </div>

        {/* SCROLLABLE MAIN CONTENT AREA (Padded left on desktop for sidebar) */}
        <div className="flex-1 overflow-y-auto pb-32 lg:pb-8 lg:ml-24 scrollbar-hide z-10 w-full">
          {viewingTarget ? (
            <TargetDetailView 
              target={targets.find(t => t.id === viewingTarget)} isPrivacyMode={isPrivacyMode} onClose={() => setViewingTarget(null)} onRemove={handleRemoveTarget}
              onTogglePin={togglePin} onToggleMute={toggleMute} onSnooze={handleSnooze} 
              onToggleMonitor={toggleMonitor} isMonitored={monitoredTargets.includes(viewingTarget)} 
              onToggleAlert={toggleAlertTarget} isAlertEnabled={alertTargets.includes(viewingTarget)} // NEW ALARM PROP
              mongoFetch={mongoFetch} apiConfig={apiConfig}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardView targets={targets} pingStats={pingStats} botHealth={botHealth} isPrivacyMode={isPrivacyMode} setIsPrivacyMode={setIsPrivacyMode} isSyncing={isSyncing} onTargetClick={setViewingTarget} reorderPinned={reorderPinned} onTogglePin={togglePin} onSnooze={handleSnooze} />
          ) : activeTab === 'compare' ? (
            <CompareView targets={targets} mongoFetch={mongoFetch} apiConfig={apiConfig} />
          ) : (
            <SettingsView 
              apiConfig={apiConfig} setApiConfig={setApiConfig} 
              isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} 
              currentTheme={currentTheme} setCurrentTheme={setCurrentTheme}
              newTarget={newTarget} setNewTarget={setNewTarget} handleAddTarget={handleAddTarget} pingStats={pingStats} botHealth={botHealth} mongoFetch={mongoFetch}
              botStatus={botStatus} isSyncing={isSyncing} onRefreshStats={fetchLiveState}
              isWakeLockActive={isWakeLockActive} setIsWakeLockActive={setIsWakeLockActive}
              isBossKeyActive={isBossKeyActive} setIsBossKeyActive={setIsBossKeyActive}
              isPanicShakeActive={isPanicShakeActive} setIsPanicShakeActive={setIsPanicShakeActive}
              onRequestRestart={() => setShowRestartModal(true)} 
              appLockPin={appLockPin} setAppLockPin={setAppLockPin}
            />
          )}
        </div>

        {/* Floating Quick Action Wheel (Adjusted for Desktop) */}
        <div className="absolute bottom-20 lg:bottom-8 right-6 lg:right-8 z-[60] flex flex-col items-end space-y-3">
          {showQuickActions && (
             <div className="flex flex-col items-center space-y-3 mb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
                <button onClick={() => { openPiP(); setShowQuickActions(false); }} className={`p-2.5 rounded-full shadow-lg glass-card bg-white dark:bg-gray-800 flex items-center justify-center hover:scale-105 transition-transform`} title="Mini Tracker PiP">
                    <span className="text-xl leading-none">🔲</span>
                </button>
                <button onClick={() => { setIsWakeLockActive(!isWakeLockActive); setShowQuickActions(false); }} className={`p-2.5 rounded-full shadow-lg ${isWakeLockActive ? 'bg-purple-500 text-white' : 'glass-card bg-white dark:bg-gray-800'} flex items-center justify-center hover:scale-105 transition-transform`} title="Wake Lock">
                    <span className="text-xl leading-none">☕</span>
                </button>
                <button onClick={() => { setIsBossKeyActive(!isBossKeyActive); setShowQuickActions(false); }} className={`p-2.5 rounded-full shadow-lg ${isBossKeyActive ? 'bg-indigo-500 text-white' : 'glass-card bg-white dark:bg-gray-800'} flex items-center justify-center hover:scale-105 transition-transform`} title="Boss Key">
                    <span className="text-xl leading-none">🕵️‍♂️</span>
                </button>
                <button onClick={() => { setShowRestartModal(true); setShowQuickActions(false); }} className="p-2.5 rounded-full shadow-lg glass-card bg-white dark:bg-gray-800 flex items-center justify-center hover:scale-105 transition-transform" title="Restart Bot">
                    <span className="text-xl leading-none">🔄</span>
                </button>
                <button onClick={() => { setActiveTab('settings'); setViewingTarget(null); setShowQuickActions(false); }} className="p-2.5 rounded-full shadow-lg glass-card bg-white dark:bg-gray-800 flex items-center justify-center hover:scale-105 transition-transform" title="Settings">
                    <span className="text-xl leading-none">⚙️</span>
                </button>
             </div>
          )}
          <button onClick={() => setShowQuickActions(!showQuickActions)} className={`p-4 rounded-full shadow-xl text-white transition-transform duration-300 ${showQuickActions ? 'bg-gray-800 rotate-45' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}>
            <Plus size={24} />
          </button>
        </div>

      </div>
    </div>
  );
}

// ==========================================
// VIEWS (MEMOIZED FOR PERFORMANCE)
// ==========================================

const LockScreenView = memo(function LockScreenView({ expectedPin, onUnlock, isDarkMode }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handlePress = (num) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        if (newPin === expectedPin) {
          onUnlock();
        } else {
          setError(true);
          setTimeout(() => { setPin(''); setError(false); }, 500);
        }
      }
    }
  };

  const handleBackspace = () => setPin(pin.slice(0, -1));

  return (
    <div className="flex flex-col h-[100dvh] w-full mx-auto items-center justify-center font-sans relative z-[999] transition-colors duration-300 bg-gray-50 dark:bg-black text-gray-900 dark:text-white">
        <div className="relative z-10 flex flex-col items-center w-full max-w-md px-8">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-6 transition-colors bg-blue-100 dark:bg-gray-900 text-blue-600 dark:text-blue-500">
                <Lock size={28} strokeWidth={2.5} />
            </div>
            <h2 className="text-2xl font-semibold mb-8 tracking-wide">Enter App PIN</h2>
            
            {/* PIN Dots */}
            <div className={`flex space-x-6 mb-16 ${error ? 'animate-bounce' : ''}`}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className={`w-3.5 h-3.5 rounded-full border-[1.5px] transition-all duration-200 ${i < pin.length ? 'bg-gray-900 border-gray-900 dark:bg-white dark:border-white' : 'bg-transparent border-gray-300 dark:border-gray-600'}`} />
                ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-x-8 gap-y-6 mb-8 w-full max-w-[280px]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button key={num} onClick={() => handlePress(num.toString())} className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-light transition-colors mx-auto active:scale-95 bg-white shadow-sm active:bg-gray-100 text-gray-900 border border-gray-100 dark:bg-gray-900 dark:active:bg-gray-800 dark:text-white dark:border-gray-800 dark:shadow-none">
                        {num}
                    </button>
                ))}
                
                {/* Bottom Row: Empty space, Zero, Delete */}
                <div className="w-20 h-20"></div>
                <button onClick={() => handlePress('0')} className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-light transition-colors mx-auto active:scale-95 bg-white shadow-sm active:bg-gray-100 text-gray-900 border border-gray-100 dark:bg-gray-900 dark:active:bg-gray-800 dark:text-white dark:border-gray-800 dark:shadow-none">
                    0
                </button>
                <button onClick={handleBackspace} className="w-20 h-20 rounded-full flex items-center justify-center transition-colors mx-auto active:scale-95 text-gray-500 active:bg-gray-200 dark:text-gray-400 dark:active:bg-gray-900">
                    <Delete size={28} strokeWidth={2} />
                </button>
            </div>
        </div>
    </div>
  );
});

const DashboardView = memo(function DashboardView({ targets, pingStats, botHealth, isPrivacyMode, setIsPrivacyMode, isSyncing, onTargetClick, reorderPinned, onTogglePin, onSnooze }) {
  const [searchTerm, setSearchTerm] = useState('');
  
  const [sortOption, setSortOption] = useState(() => {
    try { return localStorage.getItem('waTrackerSort') || 'default'; }
    catch(e) { return 'default'; }
  });

  useEffect(() => {
    localStorage.setItem('waTrackerSort', sortOption);
  }, [sortOption]);

  const { pinnedTargets, otherTargets } = useMemo(() => {
    const filtered = targets.filter(t => 
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      t.number.includes(searchTerm)
    );

    const pinned = filtered.filter(t => t.isPinned).sort((a,b) => a.pinOrder - b.pinOrder);
    const others = filtered.filter(t => !t.isPinned);

    switch(sortOption) {
        case 'az': 
            others.sort((a,b) => a.name.localeCompare(b.name)); 
            break;
        case 'za': 
            others.sort((a,b) => b.name.localeCompare(a.name)); 
            break;
        case 'newest': 
            others.sort((a,b) => b.lastActiveMs - a.lastActiveMs); 
            break;
        case 'oldest': 
            others.sort((a,b) => a.lastActiveMs - b.lastActiveMs); 
            break;
        default:
            others.sort((a, b) => {
                if (a.isOnline && !b.isOnline) return -1;
                if (!a.isOnline && b.isOnline) return 1;
                return a.name.localeCompare(b.name);
            });
    }
    return { pinnedTargets: pinned, otherTargets: others };
  }, [targets, searchTerm, sortOption]);

  const dragItem = useRef(); const dragOverItem = useRef();
  const handleDragStart = (e, index) => { dragItem.current = index; };
  const handleDragEnter = (e, index) => { dragOverItem.current = index; };
  const handleDragEnd = () => {
    if(dragItem.current !== undefined && dragOverItem.current !== undefined && searchTerm === '') {
      reorderPinned(dragItem.current, dragOverItem.current);
    }
    dragItem.current = undefined; dragOverItem.current = undefined;
  };

  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-x-hidden">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight">Tracker</h1>
          <div onClick={() => setIsPrivacyMode(!isPrivacyMode)} className="flex items-center space-x-1 cursor-pointer mt-1 active:scale-95 transition-transform text-gray-500 dark:text-gray-400 w-max bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
              {isPrivacyMode ? <EyeOff size={12} className="text-blue-500" /> : <Eye size={12} />}
              <span className="text-[10px] font-bold uppercase tracking-wider">{isPrivacyMode ? 'Privacy: ON' : 'Privacy Mode'}</span>
          </div>
        </div>
        
        {/* MINIMALIST HEADER TRAY */}
        <div className="flex flex-col items-end mr-2">
          <div className="flex items-center space-x-2 mb-1">
             <div title={`WebSocket: ${pingStats.wsStatus}`} className={`w-2 h-2 rounded-full ${pingStats.wsStatus === 'Live' ? 'bg-blue-500 animate-pulse' : 'bg-red-500'}`}></div>
             <div title={`Database: ${pingStats.dbStatus}`} className={`w-2 h-2 rounded-full ${pingStats.dbStatus === 'Connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          </div>
          {botHealth && botHealth.battery !== null && (
             <div className="flex items-center space-x-1 text-[10px] font-bold text-gray-500 dark:text-gray-400 font-mono tracking-wide mt-1 text-right">
                <div className="relative inline-flex items-center justify-center mr-0.5">
                    <span className="text-[12px]">{botHealth.battery > 25 ? '🔋' : '🪫'}</span>
                    {botHealth.isCharging && (
                        <span className="absolute text-[8px] drop-shadow-md z-10" style={{ textShadow: '0px 0px 2px rgba(0,0,0,0.8)' }}>⚡</span>
                    )}
                </div>
                <span>{botHealth.battery}% • 🧠{botHealth.ram?.split('/')[0]?.trim() || '?GB'} • 💾{botHealth.storage?.split(' ')[0] || '?GB'}</span>
             </div>
          )}
        </div>
      </div>

      {/* RESPONSIVE SEARCH & SORT ROW */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:space-x-4 mb-6 mt-4 space-y-4 lg:space-y-0">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search targets..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full glass-card pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors placeholder-gray-500"
          />
        </div>
        <div className="relative shrink-0 w-full lg:w-64">
          <select 
             value={sortOption} 
             onChange={e => setSortOption(e.target.value)}
             className="w-full glass-card pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none font-medium cursor-pointer"
          >
             <option value="default">Default Sort</option>
             <option value="az">Name (A ➔ Z)</option>
             <option value="za">Name (Z ➔ A)</option>
             <option value="newest">Newest Seen</option>
             <option value="oldest">Oldest Seen</option>
          </select>
          <SlidersHorizontal size={16} className="absolute left-3.5 top-3.5 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {pinnedTargets.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-3 flex items-center"><Pin size={14} className="mr-1" /> Pinned</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 overflow-x-hidden">
            {pinnedTargets.map((target, index) => (
              <div key={target.id} draggable={searchTerm === ''} onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()}>
                <TargetCard target={target} isPrivacyMode={isPrivacyMode} onClick={() => onTargetClick(target.id)} isPinnedItem={searchTerm === ''} onTogglePin={onTogglePin} onSnooze={onSnooze} />
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-3">All Targets</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 overflow-x-hidden">
        {otherTargets.map((target) => <TargetCard key={target.id} target={target} isPrivacyMode={isPrivacyMode} onClick={() => onTargetClick(target.id)} onTogglePin={onTogglePin} onSnooze={onSnooze} />)}
        {targets.length === 0 && (
          <div className="text-center p-8 glass-card border-dashed">
            <User className="mx-auto text-gray-400 mb-2" size={32} />
            <p className="text-gray-600 dark:text-gray-400 font-medium">No targets tracked yet.</p>
          </div>
        )}
      </div>
    </div>
  );
});

const TargetDetailView = memo(function TargetDetailView({ target, isPrivacyMode, onClose, onRemove, onTogglePin, onToggleMute, onSnooze, onToggleMonitor, isMonitored, onToggleAlert, isAlertEnabled, mongoFetch, apiConfig }) {
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [dayOffset, setDayOffset] = useState(0); 
  const [isCopied, setIsCopied] = useState(false);

  const [localStats, setLocalStats] = useState({ totalTime: '0m', lastSeen: 'N/A', todayTimeline: Array(24).fill(0), sessionLogs: [] });
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);

  const maskNumber = (num) => {
    if(!isPrivacyMode) return num;
    const s = String(num);
    return `${s.slice(0, 5)}***${s.slice(-4)}`;
  };

  const formatDurationMs = (ms) => {
    if (!ms) return "0s";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(`+${target.number}`);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  useEffect(() => {
    if (!apiConfig.url || !apiConfig.key) return;
    
    const fetchAnalytics = async () => {
      setIsLoadingAnalytics(true);
      try {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - dayOffset);
        const targetDateStr = `${String(targetDate.getDate()).padStart(2, '0')}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${targetDate.getFullYear()}`;
        
        const lineRes = await mongoFetch('find', target.number, { date: targetDateStr }, { timestamp: -1 }, 5000);
        const lineRecords = lineRes?.documents || [];

        const pendingRes = await mongoFetch('findOne', 'pending_sessions', { _id: target.number });
        let currentLiveStart = pendingRes?.document?.onlineStartTime || null;

        let targetDayMs = 0;
        let recentOffline = dayOffset === 0 && target.isOnline ? "Active Now" : "No Activity";
        const timeline24h = Array(24).fill(0);
        
        const logs = lineRecords.map(r => ({
           id: r._id || r.timestamp, start: r.onlineTime, end: r.offlineTime || 'Unknown', duration: r.durationMs
        }));

        lineRecords.forEach(r => {
           targetDayMs += (r.durationMs || 0);
           if (recentOffline === "No Activity") recentOffline = r.offlineTime;
           const hour = parseInt(r.onlineTime.split(':')[0], 10);
           if (!isNaN(hour) && hour >= 0 && hour < 24) timeline24h[hour] += (r.durationMs || 0) / 60000;
        });

        if (dayOffset === 0 && target.isOnline && currentLiveStart) {
          const liveMs = Date.now() - currentLiveStart;
          targetDayMs += liveMs;
          timeline24h[new Date().getHours()] += liveMs / 60000;
          recentOffline = "Active Now";

          const d = new Date(currentLiveStart);
          const pad = n => String(n).padStart(2, '0');
          logs.unshift({
              id: 'live_session', start: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
              end: 'Active Now', duration: liveMs, isLive: true
          });
        }

        const h = Math.floor(targetDayMs / 3600000);
        const m = Math.floor((targetDayMs % 3600000) / 60000);

        setLocalStats({
          totalTime: targetDayMs > 0 ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '0m',
          lastSeen: recentOffline, todayTimeline: timeline24h.map(Math.floor), sessionLogs: logs
        });

      } catch (e) {}
      setIsLoadingAnalytics(false);
    };
    fetchAnalytics();
  }, [target.number, apiConfig, dayOffset, target.isOnline, mongoFetch]);

  if (!target) return null;

  const maxActivity = 60; const chartHeight = 80;
  let pathD = `M 0,${chartHeight - (Math.min(localStats.todayTimeline[0], maxActivity) / maxActivity) * chartHeight}`;
  localStats.todayTimeline.forEach((val, i) => {
    if (i === 0) return;
    const x = (i / 23) * 230; 
    const y = chartHeight - (Math.min(val, maxActivity) / maxActivity) * chartHeight;
    pathD += ` L ${x},${y}`; 
  });
  const areaD = `${pathD} L 230,${chartHeight} L 0,${chartHeight} Z`;

  const getDayLabel = () => {
    if (dayOffset === 0) return "Today's Activity";
    if (dayOffset === 1) return "Yesterday's Activity";
    const d = new Date(); d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="min-h-full animate-in slide-in-from-right-8 duration-300 relative z-10">
      <div className="wa-app-container pt-12 pb-6 px-6 sticky top-0 z-20 border-b border-gray-200 dark:border-gray-800 shadow-sm bg-gray-50/90 dark:bg-black/90 backdrop-blur-xl">
        <button onClick={onClose} className="flex items-center text-blue-600 dark:text-blue-400 font-medium mb-4 active:scale-95 transition-transform hover:opacity-80"><ArrowLeft size={20} className="mr-1" /> Back</button>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${target.isOnline ? 'border-green-500 shadow-sm' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-800 relative transition-all duration-500 overflow-hidden`}>
              <img src={`https://api.dicebear.com/7.x/shapes/svg?seed=${target.number}`} alt="avatar" className={`w-full h-full object-cover ${isPrivacyMode ? 'privacy-blur' : ''}`} />
              {target.isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30"></span>}
            </div>
            <div>
              <div className="flex items-center">
                <h1 className={`text-2xl font-bold leading-tight ${isPrivacyMode ? 'privacy-blur' : ''}`}>{target.name}</h1>
                <a href={`https://wa.me/${target.number}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-2 shrink-0 flex items-center justify-center bg-green-500 w-6 h-6 rounded-full hover:bg-green-600 transition-colors shadow-sm">
                  <svg className="w-3.5 h-3.5 fill-white" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.021-.967-.264-.099-.456-.149-.648.149-.192.297-.764.967-.936 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.648-1.56-.888-2.136-.233-.561-.47-.485-.648-.494-.171-.008-.368-.009-.566-.009-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.086 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>
              </div>
              <div className="flex items-center space-x-2 mt-1">
                <p className="text-gray-600 dark:text-gray-400 font-mono text-sm">+{maskNumber(target.number)}</p>
                {!isPrivacyMode && (
                  <button onClick={copyToClipboard} className="text-gray-400 hover:text-blue-50 transition-colors active:scale-90">
                    {isCopied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className={`flex items-center flex-wrap gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${target.isOnline ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50' : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-300 dark:border-gray-700'}`}>
            <div className="flex items-center space-x-1.5">
               {target.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />} 
               <span>{target.isOnline ? 'Online' : 'Offline'}</span>
            </div>
            {target.isOnline && <LiveTimer startTimeMs={target.lastActiveMs} />}
          </div>
        </div>
      </div>

      <div className="p-6 pb-24 relative">
        {isLoadingAnalytics && <div className="absolute inset-0 bg-gray-50/80 dark:bg-gray-950/80 z-20 flex items-center justify-center m-6 rounded-3xl"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>}

        {/* RESPONSIVE BUTTON GRID: Spreads cleanly on Desktop. Now a 3x2 grid (6 buttons) */}
        <div className="grid grid-cols-3 gap-2 lg:gap-4 lg:max-w-3xl relative z-10 mb-6">
          <button onClick={() => onTogglePin(target.id)} className={`flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all active:scale-95 ${target.isPinned ? 'bg-blue-600 text-white shadow-md' : 'glass-card text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700'}`}>
            <Pin size={18} className={target.isPinned ? 'fill-current' : ''} /> <span className="text-[9px] lg:text-[11px] font-semibold mt-1">Pin</span>
          </button>
          
          <button onClick={() => onToggleMonitor(target.id)} className={`flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all active:scale-95 ${isMonitored ? 'bg-yellow-500 text-white shadow-md' : 'glass-card text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-gray-700'}`}>
            <Star size={18} className={isMonitored ? 'fill-current' : ''} /> <span className="text-[9px] lg:text-[11px] font-semibold mt-1">Monitor</span>
          </button>
          
          {/* NEW LIVE ALERT BUTTON */}
          <button onClick={() => onToggleAlert(target.id)} className={`flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all active:scale-95 ${isAlertEnabled ? 'bg-red-500 text-white shadow-md' : 'glass-card text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700'}`}>
            <Zap size={18} className={isAlertEnabled ? 'fill-current animate-pulse' : ''} /> <span className="text-[9px] lg:text-[11px] font-semibold mt-1">Live Alert</span>
          </button>

          <button onClick={() => onToggleMute(target.id)} className={`flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all active:scale-95 ${target.isMuted ? 'bg-orange-500 text-white shadow-md' : 'glass-card text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-gray-700'}`}>
            {target.isMuted ? <BellOff size={18} /> : <Bell size={18} />} <span className="text-[9px] lg:text-[11px] font-semibold mt-1">{target.isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          
          <button onClick={() => setShowSnoozeMenu(!showSnoozeMenu)} className={`flex flex-col items-center justify-center py-3 px-1 rounded-2xl glass-card text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-gray-700 transition-all active:scale-95 relative`}>
            <Timer size={18} /> <span className="text-[9px] lg:text-[11px] font-semibold mt-1">Snooze</span>
            {showSnoozeMenu && (
              <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl w-32 py-1 z-50 text-left shadow-lg">
                <div onClick={() => { onSnooze(target.id, 1); setShowSnoozeMenu(false); }} className="px-4 py-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">1 Hour</div>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
                <div onClick={() => { onSnooze(target.id, 8); setShowSnoozeMenu(false); }} className="px-4 py-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">8 Hours</div>
              </div>
            )}
          </button>
          
          <button onClick={() => {if(window.confirm('Remove target?')) onRemove(target.id);}} className="flex flex-col items-center justify-center py-3 px-1 rounded-2xl glass-card text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 transition-all active:scale-95">
            <Trash2 size={18} /> <span className="text-[9px] lg:text-[11px] font-semibold mt-1">Remove</span>
          </button>
        </div>

        {/* RESPONSIVE SPLIT VIEW: Chart and Logs are side-by-side on Desktop */}
        <div className="lg:flex lg:gap-6 lg:items-stretch">
            {/* Chart */}
            <div className="glass-card p-5 overflow-hidden relative lg:flex-1 lg:mt-0 w-full flex flex-col">
              <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center space-x-2">
                  <button onClick={() => setDayOffset(d => d + 1)} className="p-1.5 bg-gray-100 dark:bg-gray-700 rounded-xl hover:text-blue-500 transition-colors active:scale-90"><ChevronLeft size={18} /></button>
                  <h2 className="text-sm font-bold w-32 text-center select-none uppercase tracking-wider">{getDayLabel()}</h2>
                  <button onClick={() => setDayOffset(d => Math.max(0, d - 1))} disabled={dayOffset === 0} className="p-1.5 bg-gray-100 dark:bg-gray-700 rounded-xl hover:text-blue-500 disabled:opacity-30 transition-colors active:scale-90"><ChevronRight size={18} /></button>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Total</p>
                  <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{localStats.totalTime}</p>
                </div>
              </div>
              <div className="mt-6 w-full h-24 lg:h-48 relative -mx-1 flex-1">
                <svg viewBox={`0 0 230 ${chartHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
                  <defs>
                    <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                  </defs>
                  <line x1="0" y1="0" x2="230" y2="0" stroke="currentColor" strokeDasharray="4" className="text-gray-300 dark:text-gray-700" strokeWidth="1" />
                  <line x1="0" y1={chartHeight/2} x2="230" y2={chartHeight/2} stroke="currentColor" strokeDasharray="4" className="text-gray-300 dark:text-gray-700" strokeWidth="1" />
                  <line x1="0" y1={chartHeight} x2="230" y2={chartHeight} stroke="currentColor" className="text-gray-400 dark:text-gray-600" strokeWidth="1" />
                  <path d={areaD} fill="url(#colorActivity)" />
                  <path d={pathD} fill="none" stroke="#3B82F6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="flex justify-between text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-2 px-1"><span>12A</span><span>6A</span><span>12P</span><span>6P</span><span>11P</span></div>
              </div>
            </div>

            {/* Logs */}
            <div className="glass-card p-5 relative mt-6 lg:mt-0 lg:flex-1 w-full flex flex-col">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-xl text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800/50">
                  <List size={20} />
                </div>
                <h2 className="text-lg font-bold">Session Logs</h2>
                <span className="ml-auto text-xs font-bold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">{localStats.sessionLogs.length} SESSIONS</span>
              </div>
              
              <div className="space-y-3 mt-4 max-h-64 lg:max-h-full lg:flex-1 overflow-y-auto pr-2 scrollbar-hide">
                {localStats.sessionLogs.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6 italic">No sessions recorded.</p>
                ) : (
                  localStats.sessionLogs.map((log, i) => (
                    <div key={log.id || i} className="flex justify-between items-center p-3 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
                      <div className="flex items-center space-x-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${log.isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-600'}`}></div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">
                            {log.start} <span className="text-gray-400 font-normal mx-1">→</span> 
                            {log.end === 'Active Now' ? <span className="text-green-600 dark:text-green-400">Active Now</span> : log.end}
                          </span>
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1.5 rounded-xl border ${log.isLive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800/50' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800/50'}`}>
                        {formatDurationMs(log.duration)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
        </div>

      </div>
    </div>
  );
});

// Advanced Swipe-to-Action Component (Pin Only)
const TargetCard = memo(function TargetCard({ target, isPrivacyMode, onClick, isPinnedItem, onTogglePin, onSnooze }) {
  const [swipeX, setSwipeX] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [isSwiping, setIsSwiping] = useState(false);

  const maskNumber = (num) => {
    if(!isPrivacyMode) return num;
    const s = String(num);
    return `${s.slice(0, 5)}***${s.slice(-4)}`;
  };

  const handleTouchStart = (e) => {
    setTouchStartX(e.touches[0].clientX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e) => {
    if (touchStartX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;
    setSwipeX(Math.max(-120, Math.min(120, diff)));
  };

  const handleTouchEnd = () => {
    if (swipeX > 80 || swipeX < -80) {
      if (onTogglePin) onTogglePin(target.id);
    }
    setTouchStartX(null);
    setIsSwiping(false);
    setSwipeX(0); // Snap back
  };

  return (
    <div className="relative rounded-[24px] overflow-hidden w-full h-full" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="absolute inset-0 flex justify-between items-center px-6 bg-blue-100 dark:bg-blue-900/30 rounded-[24px]">
          <div className="flex flex-col items-center justify-center text-blue-600 dark:text-blue-400">
              <Pin size={24} className={target.isPinned ? "fill-current" : ""} />
              <span className="text-[10px] font-bold uppercase mt-1 tracking-wider">{target.isPinned ? "Unpin" : "Pin"}</span>
          </div>
          <div className="flex flex-col items-center justify-center text-blue-600 dark:text-blue-400">
              <Pin size={24} className={target.isPinned ? "fill-current" : ""} />
              <span className="text-[10px] font-bold uppercase mt-1 tracking-wider">{target.isPinned ? "Unpin" : "Pin"}</span>
          </div>
      </div>

      <div 
        onClick={swipeX === 0 ? onClick : undefined} 
        style={{ transform: `translateX(${swipeX}px)`, transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' }}
        className="relative z-10 glass-card p-4 flex items-center active:scale-[0.98] transition-transform duration-200 cursor-pointer group hover:bg-gray-50 dark:hover:bg-gray-700 w-full h-full"
      >
        {isPinnedItem && <div className="cursor-grab active:cursor-grabbing mr-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 p-1"><GripVertical size={18} /></div>}
        <div className="relative mr-4">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${target.isOnline ? 'border-green-500' : 'border-gray-300 dark:border-gray-600'} bg-gray-100 dark:bg-gray-800 relative transition-colors overflow-hidden`}>
            <img src={`https://api.dicebear.com/7.x/shapes/svg?seed=${target.number}`} alt="avatar" className={`w-full h-full object-cover ${isPrivacyMode ? 'privacy-blur' : ''}`} />
            {target.isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30"></span>}
          </div>
          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center relative shadow-sm ${target.isOnline ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}`}>
            {target.isOnline ? <Wifi size={10} color="white" className="relative z-10" /> : <WifiOff size={10} color="white" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center">
              <h3 className={`font-bold text-lg truncate pr-2 ${isPrivacyMode ? 'privacy-blur' : ''}`}>{target.name}</h3>
              <a href={`https://wa.me/${target.number}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center justify-center bg-green-500 w-5 h-5 rounded-full hover:bg-green-600 transition-colors ml-2 mr-1 shadow-sm">
                  <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.021-.967-.264-.099-.456-.149-.648.149-.192.297-.764.967-.936 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.648-1.56-.888-2.136-.233-.561-.47-.485-.648-.494-.171-.008-.368-.009-.566-.009-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.086 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              </a>
              {target.isMuted && <BellOff size={12} className="text-gray-400" />}
          </div>
          
          <p className={`text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-tight ${target.isOnline ? '' : 'truncate'}`}>
            {target.isOnline ? 
               <span className="text-green-600 dark:text-green-400 font-bold tracking-wider text-xs uppercase block sm:inline">
                 Online Now <LiveTimer startTimeMs={target.lastActiveMs} />
               </span> : 
               <span>Seen: {isPrivacyMode ? 'Masked' : target.lastSeen}</span>
            }
          </p>
          
          {isPrivacyMode && <p className="text-[10px] text-gray-400 font-mono mt-1">+{maskNumber(target.number)}</p>}
        </div>
        <div className="text-right flex flex-col items-end pl-2">
          <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400 font-bold text-sm px-3 py-1 rounded-xl mb-1">{target.totalTime}</div>
          <ChevronRight size={20} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
    </div>
  );
});

const CompareView = memo(function CompareView({ targets, mongoFetch, apiConfig }) {
  const [targetA, setTargetA] = useState(targets[0]?.number || '');
  const [targetB, setTargetB] = useState(targets[1]?.number || '');
  const [dayOffset, setDayOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [overlapStats, setOverlapStats] = useState({ totalOverlapStr: '0m', overlaps: [] });

  const formatDurationMs = (ms) => {
    if (!ms || ms < 0) return "0s";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  useEffect(() => {
    if (!apiConfig.url || !apiConfig.key || !targetA || !targetB) return;
    const fetchComparison = async () => {
      setIsLoading(true);
      try {
        const d = new Date(); d.setDate(d.getDate() - dayOffset);
        const targetDateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        
        const [resA, resB] = await Promise.all([
          mongoFetch('find', targetA, { date: targetDateStr }, { timestamp: -1 }, 5000),
          mongoFetch('find', targetB, { date: targetDateStr }, { timestamp: -1 }, 5000)
        ]);

        const recordsA = resA?.documents || []; const recordsB = resB?.documents || [];
        const mapToMs = (records) => records.map(r => ({ startMs: r.timestamp, endMs: r.timestamp + (r.durationMs || 0), startStr: r.onlineTime, endStr: r.offlineTime }));
        const logsA = mapToMs(recordsA); const logsB = mapToMs(recordsB);

        let totalOverlapMs = 0; let overlapsFound = [];

        logsA.forEach(a => {
           logsB.forEach(b => {
               const overlapStart = Math.max(a.startMs, b.startMs);
               const overlapEnd = Math.min(a.endMs, b.endMs);
               if (overlapStart < overlapEnd) {
                   const duration = overlapEnd - overlapStart;
                   totalOverlapMs += duration;
                   const startD = new Date(overlapStart); const endD = new Date(overlapEnd);
                   const pad = n => String(n).padStart(2, '0');
                   overlapsFound.push({
                       start: `${pad(startD.getHours())}:${pad(startD.getMinutes())}:${pad(startD.getSeconds())}`,
                       end: `${pad(endD.getHours())}:${pad(endD.getMinutes())}:${pad(endD.getSeconds())}`,
                       duration: duration
                   });
               }
           });
        });
        overlapsFound.reverse();
        setOverlapStats({ totalOverlapStr: formatDurationMs(totalOverlapMs), overlaps: overlapsFound });
      } catch (e) { }
      setIsLoading(false);
    };
    fetchComparison();
  }, [targetA, targetB, dayOffset, apiConfig, mongoFetch]);

  const getDayLabel = () => {
    if (dayOffset === 0) return "Today";
    if (dayOffset === 1) return "Yesterday";
    const d = new Date(); d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 h-[100dvh] flex flex-col relative z-10 lg:pb-12">
      <h1 className="text-4xl font-extrabold tracking-tight mb-6">Compare</h1>

      {/* RESPONSIVE SELECTORS: Side-by-Side on Desktop */}
      <div className="glass-card p-4 mb-6 lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0">
        <div className="flex items-center justify-between space-x-4">
           <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 flex items-center justify-center font-black flex-shrink-0">A</div>
           <select className="flex-1 wa-app-container border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer w-full" value={targetA} onChange={e => setTargetA(e.target.value)}>
             {targets.map(t => <option key={`A_${t.id}`} value={t.number}>{t.name}</option>)}
           </select>
        </div>
        <div className="flex items-center justify-between space-x-4">
           <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center font-black flex-shrink-0">B</div>
           <select className="flex-1 wa-app-container border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 appearance-none cursor-pointer w-full" value={targetB} onChange={e => setTargetB(e.target.value)}>
             {targets.map(t => <option key={`B_${t.id}`} value={t.number}>{t.name}</option>)}
           </select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 glass-card p-2 rounded-2xl">
        <button onClick={() => setDayOffset(d => d + 1)} className="p-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl hover:text-blue-500 transition-colors active:scale-90"><ChevronLeft size={18} /></button>
        <h2 className="text-sm font-bold w-32 text-center select-none uppercase tracking-wider">{getDayLabel()}</h2>
        <button onClick={() => setDayOffset(d => Math.max(0, d - 1))} disabled={dayOffset === 0} className="p-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl hover:text-blue-500 disabled:opacity-30 transition-colors active:scale-90"><ChevronRight size={18} /></button>
      </div>

      <div className="glass-card p-5 flex-1 relative overflow-hidden flex flex-col mb-16 lg:mb-0">
        {isLoading && <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 z-20 flex items-center justify-center"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>}
        
        <div className="text-center mb-6 pt-2">
           <p className="text-xs font-bold text-gray-500 tracking-widest uppercase mb-1">Total Intersection</p>
           <p className="text-4xl font-black text-blue-600 dark:text-purple-400">{overlapStats.totalOverlapStr}</p>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
            {overlapStats.overlaps.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6 italic">No overlapping sessions detected.</p>
            ) : (
              overlapStats.overlaps.map((log, i) => (
                <div key={i} className="flex justify-between items-center p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
                  <div className="flex items-center space-x-3">
                    <GitCompare size={16} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-sm font-semibold">
                      {log.start} <span className="text-gray-400 font-normal mx-1">→</span> {log.end}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                    {formatDurationMs(log.duration)}
                  </span>
                </div>
              ))
            )}
        </div>
      </div>
    </div>
  );
});

const SettingsView = memo(function SettingsView({ apiConfig, setApiConfig, isDarkMode, setIsDarkMode, currentTheme, setCurrentTheme, newTarget, setNewTarget, handleAddTarget, pingStats, botHealth, mongoFetch, botStatus, isSyncing, onRefreshStats, isWakeLockActive, setIsWakeLockActive, isBossKeyActive, setIsBossKeyActive, isPanicShakeActive, setIsPanicShakeActive, onRequestRestart, appLockPin, setAppLockPin }) {
  const themes = [
    { id: 'light-classic', name: 'Light Classic', icon: <Sun size={18} />, color: 'bg-white' },
    { id: 'dark-amoled', name: 'Dark AMOLED', icon: <Zap size={18} />, color: 'bg-black' }
  ];

  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10 mb-24 lg:pb-12">
      <h1 className="text-4xl font-extrabold tracking-tight mb-6">Settings</h1>
      
      {/* RESPONSIVE 2-COLUMN GRID FOR SETTINGS ON DESKTOP */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-8">
        
        {/* COLUMN 1 */}
        <div className="space-y-8">
          {/* Bot Connection Status Card */}
          <div>
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-4 ml-4">Bot Connection Status</h3>
            <div className={`glass-card p-4 flex items-center space-x-4 border-l-4 transition-all duration-300 ${botStatus.status === 'connected' ? 'border-l-green-500' : 'border-l-red-500'}`}>
              <div className={`p-3 rounded-full ${botStatus.status === 'connected' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                {botStatus.status === 'connected' ? <CheckCircle2 size={24} /> : <QrCode size={24} />}
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 dark:text-white">
                  {botStatus.status === 'connected' ? 'WhatsApp Connected' : 'WhatsApp Disconnected'}
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  {botStatus.status === 'connected' 
                    ? 'The backend bot is running and working well.' 
                    : 'Bot is waiting for QR login. Check the overlay.'}
                </p>
              </div>
            </div>
          </div>

          {/* SYSTEM DIAGNOSTICS CARD */}
          <div>
            <div className="flex items-center justify-between mb-4 ml-4 pr-4">
                <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">System Diagnostics</h3>
                <button onClick={onRefreshStats} disabled={isSyncing} className={`text-xs font-bold px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 active:scale-95 transition-transform flex items-center space-x-1 ${isSyncing ? 'opacity-50' : ''}`}>
                    <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} /> <span>Refresh</span>
                </button>
            </div>
            <div className="glass-card p-4 space-y-3">
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Uptime</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{botHealth.botUptime || 'N/A'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Network</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{botHealth.network || 'N/A'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">CPU Temp</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{botHealth.cpuTemp || 'N/A'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">RAM Usage</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{botHealth.ram || 'N/A'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Storage</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{botHealth.storage || 'N/A'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Ping Latency</span><span className="text-sm font-mono font-medium text-gray-900 dark:text-white">{pingStats.latency} ms</span></div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-4 ml-4">Workspace Theme</h3>
            <div className="grid grid-cols-2 gap-3">
              {themes.map((t) => (
                <button 
                  key={t.id}
                  onClick={() => setCurrentTheme(t.id)}
                  className={`flex items-center space-x-3 p-3 rounded-2xl border transition-all active:scale-95 ${currentTheme === t.id ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-500/10' : 'border-gray-200 dark:border-gray-700 glass-card'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${t.color}`}>
                    {React.cloneElement(t.icon, { size: 14, className: currentTheme === t.id ? 'text-blue-500' : 'text-gray-400' })}
                  </div>
                  <span className={`text-xs font-bold ${currentTheme === t.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* COLUMN 2 */}
        <div className="space-y-8 mt-8 lg:mt-0">
          <div>
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-2 ml-4">Quick Add</h3>
            <div className="glass-card p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="text" placeholder="Name" value={newTarget.name} onChange={(e) => setNewTarget({...newTarget, name: e.target.value})} className="flex-1 min-w-0 wa-app-container border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors placeholder-gray-500" />
                <input type="tel" placeholder="Number" value={newTarget.number} onChange={(e) => setNewTarget({...newTarget, number: e.target.value})} className="flex-1 min-w-0 wa-app-container border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors placeholder-gray-500" />
                <button onClick={handleAddTarget} disabled={!newTarget.number} className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl disabled:opacity-50 transition-colors shadow-md active:scale-95 shrink-0 flex items-center justify-center"><Plus size={20} /></button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-2 ml-4">Advanced Configuration</h3>
            <div className="glass-card overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
              <div className="p-4 bg-gray-50 dark:bg-gray-900"><p className="text-xs font-bold uppercase tracking-wider mb-1 text-gray-600 dark:text-gray-400">1. Vercel Database Proxy</p></div>
              <div className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Proxy URL</label><input type="text" placeholder="https://my-proxy.vercel.app/api/proxy" value={apiConfig.url} onChange={(e) => setApiConfig({...apiConfig, url: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400 outline-none" /></div>
              <div className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Secret Key</label><input type="password" placeholder="••••••••••••••••••••••••••••••" value={apiConfig.key} onChange={(e) => setApiConfig({...apiConfig, key: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400 outline-none" /></div>
              
              <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/30"><p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1">2. Pusher WebSockets (Live Data)</p></div>
              <div className="p-4 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pusher App Key</label><input type="text" placeholder="e.g. 1a2b3c4d5e..." value={apiConfig.pusherKey} onChange={(e) => setApiConfig({...apiConfig, pusherKey: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400 outline-none" /></div>
              <div className="p-4 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pusher Cluster</label><input type="text" placeholder="e.g. ap2" value={apiConfig.pusherCluster} onChange={(e) => setApiConfig({...apiConfig, pusherCluster: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400 outline-none" /></div>

              <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border-t border-purple-100 dark:border-purple-900/30"><p className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider mb-1">3. Stealth & Device Tools</p></div>
              <div className="p-4 flex items-center justify-between hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <div>
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">Screen Wake Lock (☕)</label>
                  <span className="text-[10px] text-gray-500">Prevent screen from sleeping</span>
                </div>
                <button onClick={() => setIsWakeLockActive(!isWakeLockActive)} className={`w-10 h-5 rounded-full transition-colors relative ${isWakeLockActive ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${isWakeLockActive ? 'translate-x-5' : ''}`}></span>
                </button>
              </div>
              <div className="p-4 flex items-center justify-between hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <div>
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">Boss Key (Incognito)</label>
                  <span className="text-[10px] text-gray-500">Disguise tab when switching away</span>
                </div>
                <button onClick={() => setIsBossKeyActive(!isBossKeyActive)} className={`w-10 h-5 rounded-full transition-colors relative ${isBossKeyActive ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${isBossKeyActive ? 'translate-x-5' : ''}`}></span>
                </button>
              </div>
              <div className="p-4 flex items-center justify-between hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <div>
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block">Shake to Hide (Panic)</label>
                  <span className="text-[10px] text-gray-500">Violently shake phone to open Drive</span>
                </div>
                <button onClick={() => setIsPanicShakeActive(!isPanicShakeActive)} className={`w-10 h-5 rounded-full transition-colors relative ${isPanicShakeActive ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${isPanicShakeActive ? 'translate-x-5' : ''}`}></span>
                </button>
              </div>
              <div className="p-4 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors border-t border-gray-100 dark:border-gray-800">
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider block mb-1">App Lock PIN</label>
                <div className="flex space-x-2">
                    <input type="password" maxLength={4} placeholder="Set 4-Digit PIN" value={appLockPin} onChange={(e) => setAppLockPin(e.target.value.replace(/\D/g, ''))} className="flex-1 bg-transparent border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => setAppLockPin('')} className="px-4 bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl text-xs font-bold active:scale-95 transition-transform">Clear</button>
                </div>
                <span className="text-[10px] text-gray-500 mt-1 block">Locks the dashboard on launch. Leave empty to disable.</span>
              </div>

              <div className="p-4 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors border-t border-gray-200 dark:border-gray-700 mt-2">
                <button onClick={onRequestRestart} className="w-full flex items-center justify-center space-x-2 py-3 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-xl font-bold active:scale-95 transition-all">
                  <Power size={18} />
                  <span>Restart Backend Bot</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
});