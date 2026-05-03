import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { 
  Home, Settings, User, Plus, Wifi, WifiOff, 
  ChevronRight, ChevronLeft, Trash2, Moon, Sun, 
  Pin, Bell, BellOff, ArrowLeft, GripVertical, Clock, RefreshCw, Zap, List,
  Search, GitCompare, Timer, SlidersHorizontal, Copy, CheckCircle2, Eye, EyeOff
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState('light-classic'); // light-classic, light-system, dark-classic, dark-amoled
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [viewingTarget, setViewingTarget] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [apiConfig, setApiConfig] = useState({ url: '', key: '', pusherKey: '', pusherCluster: '' });
  const [targets, setTargets] = useState([]);
  const [newTarget, setNewTarget] = useState({ name: '', number: '' });
  const [pingStats, setPingStats] = useState({ latency: 0, uptime: 'N/A', dbStatus: 'Offline', wsStatus: 'Disconnected' });

  // Prevent stale closures in our debounce function
  const fetchLiveStateRef = useRef();

  // --- LOCAL STORAGE PERSISTENCE ---
  useEffect(() => {
    const savedConfig = localStorage.getItem('waTrackerConfig');
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      if (parsed.apiConfig) setApiConfig(parsed.apiConfig);
      if (parsed.theme) setTheme(parsed.theme);
      if (parsed.isPrivacyMode !== undefined) setIsPrivacyMode(parsed.isPrivacyMode);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('waTrackerConfig', JSON.stringify({ apiConfig, theme, isPrivacyMode }));
    
    // Apply Theme Classes to Root
    const root = document.documentElement;
    root.classList.remove('theme-light-classic', 'theme-light-system', 'theme-dark-classic', 'theme-dark-amoled', 'dark');
    root.classList.add(`theme-${theme}`);
    if (theme.startsWith('dark')) root.classList.add('dark');

    // Apply Privacy Mode Class
    if (isPrivacyMode) root.classList.add('privacy-active');
    else root.classList.remove('privacy-active');
  }, [apiConfig, theme, isPrivacyMode]);

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

  // --- DASHBOARD SYNC ENGINE ---
  const fetchLiveState = useCallback(async () => {
    if (!apiConfig.url || !apiConfig.key) return;
    setIsSyncing(true);
    
    const configRes = await mongoFetch('findOne', 'system_config', { _id: 'main_config' });
    const contactsRes = await mongoFetch('findOne', 'system_config', { _id: 'contacts_map' });
    const configDoc = configRes?.document || { targets: [], muted: [] };
    const contactsDoc = contactsRes?.document?.contacts || {};

    const sessionsRes = await mongoFetch('find', 'pending_sessions', {}, {}, 100);
    const activeSessions = sessionsRes?.documents || [];
    const onlineIds = activeSessions.map(s => s._id);

    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
    
    const statsPromises = configDoc.targets.map(async (num) => {
      try {
        const res = await mongoFetch('find', num, { date: todayStr }, { timestamp: -1 }, 5000);
        const records = res?.documents || [];
        let todayMs = records.reduce((acc, r) => acc + (r.durationMs || 0), 0);
        let recentOffline = "Never";
        let recentOfflineMs = 0;
        
        if (records.length > 0) {
           recentOffline = records[0].offlineTime || "Unknown";
           recentOfflineMs = records[0].timestamp + (records[0].durationMs || 0);
        } else {
           const lastRecRes = await mongoFetch('find', num, {}, { timestamp: -1 }, 1);
           if (lastRecRes?.documents?.length > 0) {
             const lr = lastRecRes.documents[0];
             recentOffline = `${lr.date.slice(0,5)} ${lr.offlineTime || ''}`;
             recentOfflineMs = lr.timestamp + (lr.durationMs || 0);
           }
        }
        return { num, todayMs, recentOffline, recentOfflineMs };
      } catch (e) {
        return { num, todayMs: 0, recentOffline: "Error", recentOfflineMs: 0 };
      }
    });

    const statsArray = await Promise.all(statsPromises);
    const statsMap = {};
    statsArray.forEach(s => { statsMap[s.num] = s; });

    setTargets(prevTargets => {
      return configDoc.targets.map((num) => {
        const existing = prevTargets.find(t => t.number === num);
        const isOnline = onlineIds.includes(num);
        
        let todayMs = statsMap[num]?.todayMs || 0;
        let lastOffline = statsMap[num]?.recentOffline || "Never";
        let lastActiveMs = statsMap[num]?.recentOfflineMs || 0;

        if (isOnline) {
          const pendingSession = activeSessions.find(s => s._id === num);
          if (pendingSession) {
             todayMs += (Date.now() - pendingSession.onlineStartTime);
             lastActiveMs = Date.now();
          }
        }

        const h = Math.floor(todayMs / 3600000);
        const m = Math.floor((todayMs % 3600000) / 60000);
        const totalTimeStr = todayMs > 0 ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '0m';

        return {
          id: num, number: num, name: contactsDoc[num] || num, isOnline, totalTime: totalTimeStr,
          lastSeen: isOnline ? 'Active Now' : lastOffline,
          lastActiveMs,
          isPinned: existing ? existing.isPinned : false, pinOrder: existing ? existing.pinOrder : 99,
          isMuted: configDoc.muted.includes(num),
        };
      });
    });

    setIsSyncing(false);
  }, [apiConfig.url, apiConfig.key, mongoFetch]);

  fetchLiveStateRef.current = fetchLiveState;

  // --- PUSHER: REAL-TIME WEBSOCKET LISTENER ---
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
            return { ...t, isOnline: data.status === 'online', lastSeen: data.status === 'online' ? 'Active Now' : 'Just now', lastActiveMs: Date.now() };
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
    fetchLiveState();
    const interval = setInterval(fetchLiveState, 60000);
    return () => clearInterval(interval);
  }, [apiConfig.url, apiConfig.key, fetchLiveState]);

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
    setViewingTarget(null);
  }, [mongoFetch]);

  const togglePin = useCallback((id) => setTargets(prev => prev.map(t => t.id === id ? { ...t, isPinned: !t.isPinned, pinOrder: !t.isPinned ? prev.filter(x=>x.isPinned).length : 99 } : t)), []);

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

  return (
    <div className="flex flex-col h-[100dvh] max-w-md mx-auto font-sans antialiased overflow-hidden sm:glass-panel sm:rounded-[3rem] sm:h-[850px] sm:my-8 relative">
        <div className="flex-1 overflow-y-auto pb-32 scrollbar-hide z-10">
          {viewingTarget ? (
            <TargetDetailView 
              target={targets.find(t => t.id === viewingTarget)} onClose={() => setViewingTarget(null)} onRemove={handleRemoveTarget}
              onTogglePin={togglePin} onToggleMute={toggleMute} onSnooze={handleSnooze} mongoFetch={mongoFetch} apiConfig={apiConfig}
              isPrivacyMode={isPrivacyMode}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardView 
                targets={targets} pingStats={pingStats} isSyncing={isSyncing} onTargetClick={setViewingTarget} reorderPinned={reorderPinned} 
                isPrivacyMode={isPrivacyMode} setIsPrivacyMode={setIsPrivacyMode}
            />
          ) : activeTab === 'compare' ? (
            <CompareView targets={targets} mongoFetch={mongoFetch} apiConfig={apiConfig} isPrivacyMode={isPrivacyMode} />
          ) : (
            <SettingsView 
                apiConfig={apiConfig} setApiConfig={setApiConfig} theme={theme} setTheme={setTheme} 
                newTarget={newTarget} setNewTarget={setNewTarget} handleAddTarget={handleAddTarget} pingStats={pingStats} 
            />
          )}
        </div>

        <div className="absolute bottom-0 w-full glass-card border-x-0 border-b-0 rounded-b-[3rem] pb-safe pt-3 px-6 flex justify-around items-center z-50">
          <button onClick={() => {setActiveTab('dashboard'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 ${activeTab === 'dashboard' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500'}`}>
            <Home size={24} strokeWidth={activeTab === 'dashboard' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Dashboard</span>
          </button>
          <button onClick={() => {setActiveTab('compare'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 ${activeTab === 'compare' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500'}`}>
            <GitCompare size={24} strokeWidth={activeTab === 'compare' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Compare</span>
          </button>
          <button onClick={() => {setActiveTab('settings'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 ${activeTab === 'settings' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500'}`}>
            <Settings size={24} strokeWidth={activeTab === 'settings' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Settings</span>
          </button>
        </div>
      </div>
  );
}

// ==========================================
// VIEWS (MEMOIZED)
// ==========================================

const DashboardView = memo(function DashboardView({ targets, pingStats, isSyncing, onTargetClick, reorderPinned, isPrivacyMode, setIsPrivacyMode }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState(() => localStorage.getItem('waTrackerSort') || 'default');

  useEffect(() => { localStorage.setItem('waTrackerSort', sortOption); }, [sortOption]);

  const { pinnedTargets, otherTargets } = useMemo(() => {
    const filtered = targets.filter(t => 
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      t.number.includes(searchTerm)
    );
    const pinned = filtered.filter(t => t.isPinned).sort((a,b) => a.pinOrder - b.pinOrder);
    const others = filtered.filter(t => !t.isPinned);
    switch(sortOption) {
        case 'az': others.sort((a,b) => a.name.localeCompare(b.name)); break;
        case 'za': others.sort((a,b) => b.name.localeCompare(a.name)); break;
        case 'newest': others.sort((a,b) => b.lastActiveMs - a.lastActiveMs); break;
        case 'oldest': others.sort((a,b) => a.lastActiveMs - b.lastActiveMs); break;
        default: others.sort((a, b) => (a.isOnline === b.isOnline ? a.name.localeCompare(b.name) : a.isOnline ? -1 : 1));
    }
    return { pinnedTargets: pinned, otherTargets: others };
  }, [targets, searchTerm, sortOption]);

  const dragItem = useRef(); const dragOverItem = useRef();
  const handleDragStart = (e, index) => { dragItem.current = index; };
  const handleDragEnter = (e, index) => { dragOverItem.current = index; };
  const handleDragEnd = () => {
    if(dragItem.current !== undefined && dragOverItem.current !== undefined && searchTerm === '') reorderPinned(dragItem.current, dragOverItem.current);
    dragItem.current = undefined; dragOverItem.current = undefined;
  };

  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-start mb-4">
        <div>
            <h1 className="text-4xl font-extrabold tracking-tight">Tracker</h1>
            <button onClick={() => setIsPrivacyMode(!isPrivacyMode)} className="mt-2 flex items-center text-xs font-bold text-gray-500 uppercase tracking-widest active:scale-95 transition-transform">
                {isPrivacyMode ? <EyeOff size={14} className="mr-1 text-blue-500" /> : <Eye size={14} className="mr-1" />}
                {isPrivacyMode ? "Privacy On" : "Privacy Off"}
            </button>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex space-x-2 mb-1">
            {pingStats.wsStatus === 'Live' && (
              <div className="flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                <Zap size={10} className="fill-current" /> Live
              </div>
            )}
            <div className={`flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${pingStats.dbStatus === 'Connected' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
              <RefreshCw size={10} className={`${isSyncing ? 'animate-spin' : ''} mr-1`} /> {pingStats.dbStatus}
            </div>
          </div>
          <div className="text-xs text-gray-500 font-mono">{pingStats.latency > 0 && <span>{pingStats.latency}ms</span>}</div>
        </div>
      </div>

      <div className="flex items-center space-x-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-3.5 text-gray-500" size={18} />
          <input type="text" placeholder="Search targets..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full glass-card pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
        </div>
        <div className="relative shrink-0">
          <select value={sortOption} onChange={e => setSortOption(e.target.value)} className="glass-card pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none font-medium">
             <option value="default">Default</option>
             <option value="az">A-Z</option>
             <option value="za">Z-A</option>
             <option value="newest">Recent</option>
          </select>
          <SlidersHorizontal size={16} className="absolute left-3.5 top-3.5 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {pinnedTargets.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center"><Pin size={14} className="mr-1" /> Pinned</h3>
          <div className="space-y-3">
            {pinnedTargets.map((target, index) => (
              <div key={target.id} draggable={searchTerm === ''} onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()}>
                <TargetCard target={target} onClick={() => onTargetClick(target.id)} isPinnedItem={searchTerm === ''} isPrivacyMode={isPrivacyMode} />
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">All Targets</h3>
      <div className="space-y-3">
        {otherTargets.map((target) => <TargetCard key={target.id} target={target} onClick={() => onTargetClick(target.id)} isPrivacyMode={isPrivacyMode} />)}
      </div>
    </div>
  );
});

const TargetDetailView = memo(function TargetDetailView({ target, onClose, onRemove, onTogglePin, onToggleMute, onSnooze, mongoFetch, apiConfig, isPrivacyMode }) {
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [dayOffset, setDayOffset] = useState(0); 
  const [isCopied, setIsCopied] = useState(false);
  const [localStats, setLocalStats] = useState({ totalTime: '0m', lastSeen: 'N/A', todayTimeline: Array(24).fill(0), sessionLogs: [] });
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);

  const formatDurationMs = (ms) => {
    if (!ms) return "0s";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const maskNumber = (num) => {
    if(!isPrivacyMode) return num;
    return num.length > 6 ? `${num.slice(0, 5)}***${num.slice(-2)}` : '**********';
  };

  useEffect(() => {
    if (!apiConfig.url || !apiConfig.key) return;
    const fetchAnalytics = async () => {
      setIsLoadingAnalytics(true);
      try {
        const targetDate = new Date(); targetDate.setDate(targetDate.getDate() - dayOffset);
        const targetDateStr = `${String(targetDate.getDate()).padStart(2, '0')}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${targetDate.getFullYear()}`;
        const lineRes = await mongoFetch('find', target.number, { date: targetDateStr }, { timestamp: -1 }, 5000);
        const lineRecords = lineRes?.documents || [];
        const pendingRes = await mongoFetch('findOne', 'pending_sessions', { _id: target.number });
        let currentLiveStart = pendingRes?.document?.onlineStartTime || null;
        let targetDayMs = 0; let recentOffline = dayOffset === 0 && target.isOnline ? "Active Now" : "No Activity";
        const timeline24h = Array(24).fill(0);
        const logs = lineRecords.map(r => ({ id: r.timestamp, start: r.onlineTime, end: r.offlineTime || '...', duration: r.durationMs }));
        lineRecords.forEach(r => {
           targetDayMs += (r.durationMs || 0);
           if (recentOffline === "No Activity") recentOffline = r.offlineTime;
           const hour = parseInt(r.onlineTime.split(':')[0], 10);
           if (!isNaN(hour) && hour >= 0 && hour < 24) timeline24h[hour] += (r.durationMs || 0) / 60000;
        });
        if (dayOffset === 0 && target.isOnline && currentLiveStart) {
          const liveMs = Date.now() - currentLiveStart; targetDayMs += liveMs;
          timeline24h[new Date().getHours()] += liveMs / 60000;
          recentOffline = "Active Now";
          const d = new Date(currentLiveStart);
          logs.unshift({ id: 'live', start: `${d.getHours()}:${d.getMinutes()}`, end: 'Active Now', duration: liveMs, isLive: true });
        }
        const h = Math.floor(targetDayMs / 3600000); const m = Math.floor((targetDayMs % 3600000) / 60000);
        setLocalStats({ totalTime: h > 0 ? `${h}h ${m}m` : `${m}m`, lastSeen: recentOffline, todayTimeline: timeline24h.map(Math.floor), sessionLogs: logs });
      } catch (e) {}
      setIsLoadingAnalytics(false);
    };
    fetchAnalytics();
  }, [target.number, apiConfig, dayOffset, target.isOnline, mongoFetch]);

  const maxActivity = 60; const chartHeight = 80;
  let pathD = `M 0,${chartHeight - (Math.min(localStats.todayTimeline[0], maxActivity) / maxActivity) * chartHeight}`;
  localStats.todayTimeline.forEach((val, i) => {
    if (i === 0) return;
    const x = (i / 23) * 230; const y = chartHeight - (Math.min(val, maxActivity) / maxActivity) * chartHeight;
    pathD += ` L ${x},${y}`; 
  });

  return (
    <div className="min-h-full animate-in slide-in-from-right-8 duration-300 relative z-10">
      <div className="glass-panel pt-12 pb-6 px-6 sticky top-0 z-20 border-b shadow-sm">
        <button onClick={onClose} className="flex items-center text-blue-600 font-medium mb-4"><ArrowLeft size={20} className="mr-1" /> Back</button>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${target.isOnline ? 'border-green-500 shadow-sm' : 'border-gray-300'}`}>
              <span className="text-2xl font-bold text-gray-500">{target.name.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <h1 className={`text-2xl font-bold leading-tight privacy-mask`}>{target.name}</h1>
              <div className="flex items-center space-x-2 mt-1">
                <p className="text-gray-500 font-mono text-sm">+{maskNumber(target.number)}</p>
                {!isPrivacyMode && <button onClick={() => {navigator.clipboard.writeText(target.number); setIsCopied(true); setTimeout(()=>setIsCopied(false), 2000)}} className="text-gray-400">{isCopied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}</button>}
              </div>
            </div>
          </div>
          <div className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase ${target.isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
            {target.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />} <span>{target.isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="p-6 pb-24 space-y-6">
        <div className="grid grid-cols-4 gap-3">
          <button onClick={() => onTogglePin(target.id)} className={`flex flex-col items-center p-3 rounded-2xl ${target.isPinned ? 'bg-blue-600 text-white' : 'glass-card text-blue-600'}`}><Pin size={20} /><span className="text-[10px] mt-1">Pin</span></button>
          <button onClick={() => onToggleMute(target.id)} className={`flex flex-col items-center p-3 rounded-2xl ${target.isMuted ? 'bg-orange-500 text-white' : 'glass-card text-orange-600'}`}>{target.isMuted ? <BellOff size={20} /> : <Bell size={20} />}<span className="text-[10px] mt-1">Mute</span></button>
          <button onClick={() => setShowSnoozeMenu(!showSnoozeMenu)} className="flex flex-col items-center p-3 rounded-2xl glass-card text-purple-600 relative"><Timer size={20} /><span className="text-[10px] mt-1">Snooze</span>
            {showSnoozeMenu && <div className="absolute top-full left-0 mt-2 bg-white border rounded-xl w-32 py-1 z-50 shadow-lg text-black"><div onClick={()=>onSnooze(target.id, 1)} className="px-4 py-2 hover:bg-gray-100">1 Hour</div><div onClick={()=>onSnooze(target.id, 8)} className="px-4 py-2 hover:bg-gray-100">8 Hours</div></div>}
          </button>
          <button onClick={() => {if(window.confirm('Remove?')) onRemove(target.id)}} className="flex flex-col items-center p-3 rounded-2xl glass-card text-red-600"><Trash2 size={20} /><span className="text-[10px] mt-1">Delete</span></button>
        </div>

        <div className="glass-card p-5">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center space-x-2">
                <button onClick={() => setDayOffset(d => d + 1)} className="p-1 bg-gray-100 rounded-lg"><ChevronLeft size={18} /></button>
                <span className="text-xs font-bold w-20 text-center">{dayOffset === 0 ? "TODAY" : getDayLabel()}</span>
                <button onClick={() => setDayOffset(d => Math.max(0, d-1))} disabled={dayOffset===0} className="p-1 bg-gray-100 rounded-lg"><ChevronRight size={18} /></button>
            </div>
            <div className="text-right"><p className="text-[10px] font-bold text-gray-500 uppercase">Total</p><p className="text-2xl font-black text-blue-600">{localStats.totalTime}</p></div>
          </div>
          <div className="h-24 w-full mt-4">
            <svg viewBox={`0 0 230 ${chartHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
              <path d={`${pathD} L 230,${chartHeight} L 0,${chartHeight} Z`} fill="#3B82F6" fillOpacity="0.1" />
              <path d={pathD} fill="none" stroke="#3B82F6" strokeWidth="3" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});

const TargetCard = memo(function TargetCard({ target, onClick, isPinnedItem, isPrivacyMode }) {
  const maskNumber = (num) => {
    if(!isPrivacyMode) return num;
    return num.length > 6 ? `${num.slice(0, 4)}***${num.slice(-2)}` : '**********';
  };
  return (
    <div onClick={onClick} className="glass-card p-4 flex items-center active:scale-[0.98] transition-transform cursor-pointer group">
      {isPinnedItem && <div className="mr-2 text-gray-300"><GripVertical size={18} /></div>}
      <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 mr-4 ${target.isOnline ? 'border-green-500' : 'border-gray-200'}`}>
        <span className="text-lg font-bold text-gray-400">{target.name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={`font-bold truncate privacy-mask`}>{target.name}</h3>
        <p className="text-xs text-gray-500 truncate mt-0.5">{target.isOnline ? <span className="text-green-600 font-bold">Online</span> : <span>Seen: {target.lastSeen}</span>}</p>
        {isPrivacyMode && <p className="text-[10px] text-gray-400 font-mono mt-0.5">+{maskNumber(target.number)}</p>}
      </div>
      <div className="text-right">
        <div className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">{target.totalTime}</div>
      </div>
    </div>
  );
});

const CompareView = memo(function CompareView({ targets, mongoFetch, apiConfig, isPrivacyMode }) {
  const [targetA, setTargetA] = useState(targets[0]?.number || '');
  const [targetB, setTargetB] = useState(targets[1]?.number || '');
  const [dayOffset, setDayOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [overlapStats, setOverlapStats] = useState({ totalOverlapStr: '0m', overlaps: [] });

  useEffect(() => {
    if (!apiConfig.url || !apiConfig.key || !targetA || !targetB) return;
    const fetchComparison = async () => {
      setIsLoading(true);
      try {
        const d = new Date(); d.setDate(d.getDate() - dayOffset);
        const dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        const [resA, resB] = await Promise.all([
          mongoFetch('find', targetA, { date: dateStr }, { timestamp: -1 }, 5000),
          mongoFetch('find', targetB, { date: dateStr }, { timestamp: -1 }, 5000)
        ]);
        const logsA = (resA?.documents || []).map(r => ({ s: r.timestamp, e: r.timestamp + (r.durationMs || 0) }));
        const logsB = (resB?.documents || []).map(r => ({ s: r.timestamp, e: r.timestamp + (r.durationMs || 0) }));
        let total = 0; let found = [];
        logsA.forEach(a => {
           logsB.forEach(b => {
               const s = Math.max(a.s, b.s); const e = Math.min(a.e, b.e);
               if (s < e) { 
                   total += (e - s); 
                   const ds = new Date(s); const de = new Date(e);
                   found.push({ start: `${ds.getHours()}:${ds.getMinutes()}`, end: `${de.getHours()}:${de.getMinutes()}`, dur: e - s });
               }
           });
        });
        const m = Math.floor(total / 60000);
        setOverlapStats({ totalOverlapStr: `${m}m`, overlaps: found });
      } catch (e) { }
      setIsLoading(false);
    };
    fetchComparison();
  }, [targetA, targetB, dayOffset, apiConfig, mongoFetch]);

  return (
    <div className="p-6 pt-12 animate-in fade-in h-[100dvh] flex flex-col">
      <h1 className="text-4xl font-extrabold mb-6">Compare</h1>
      <div className="glass-card p-4 mb-4 space-y-3">
        <select className="w-full bg-transparent text-sm font-bold border-none" value={targetA} onChange={e=>setTargetA(e.target.value)}>
            {targets.map(t=><option key={t.id} value={t.number}>{isPrivacyMode ? 'Target A' : t.name}</option>)}
        </select>
        <select className="w-full bg-transparent text-sm font-bold border-none" value={targetB} onChange={e=>setTargetB(e.target.value)}>
            {targets.map(t=><option key={t.id} value={t.number}>{isPrivacyMode ? 'Target B' : t.name}</option>)}
        </select>
      </div>
      <div className="glass-card flex-1 p-5 overflow-y-auto">
        {isLoading ? <RefreshCw className="animate-spin mx-auto mt-10 text-blue-500" /> : (
            <>
            <p className="text-center text-3xl font-black text-blue-600 mb-4">{overlapStats.totalOverlapStr}</p>
            <div className="space-y-2">
                {overlapStats.overlaps.map((o,i)=>(
                    <div key={i} className="flex justify-between text-xs font-bold bg-blue-50 p-2 rounded-lg">
                        <span>{o.start} - {o.end}</span><span>{Math.floor(o.dur/60000)}m</span>
                    </div>
                ))}
            </div>
            </>
        )}
      </div>
    </div>
  );
});

const SettingsView = memo(function SettingsView({ apiConfig, setApiConfig, theme, setTheme, newTarget, setNewTarget, handleAddTarget, pingStats }) {
  const themes = [
    { id: 'light-classic', name: 'Classic', color: 'bg-white', text: 'text-gray-900' },
    { id: 'light-system', name: 'System', color: 'bg-indigo-50', text: 'text-indigo-900' },
    { id: 'dark-classic', name: 'Standard', color: 'bg-gray-800', text: 'text-white' },
    { id: 'dark-amoled', name: 'AMOLED', color: 'bg-black', text: 'text-white' }
  ];

  return (
    <div className="p-6 pt-12 animate-in fade-in space-y-8">
      <h1 className="text-4xl font-extrabold mb-6">Settings</h1>
      
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 ml-2">App Theme</h3>
        <div className="grid grid-cols-2 gap-3">
          {themes.map(t => (
            <button key={t.id} onClick={() => setTheme(t.id)} className={`p-4 rounded-2xl border-2 transition-all text-sm font-bold ${theme === t.id ? 'border-blue-500 scale-105' : 'border-transparent glass-card'} ${t.color} ${t.text}`}>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Quick Add</h3>
        <div className="flex gap-2">
            <input type="text" placeholder="Name" className="flex-1 bg-gray-100 rounded-xl px-3 py-2 text-sm" value={newTarget.name} onChange={e=>setNewTarget({...newTarget, name: e.target.value})} />
            <input type="tel" placeholder="Number" className="flex-1 bg-gray-100 rounded-xl px-3 py-2 text-sm" value={newTarget.number} onChange={e=>setNewTarget({...newTarget, number: e.target.value})} />
            <button onClick={handleAddTarget} className="bg-blue-600 text-white p-2 rounded-xl"><Plus size={20}/></button>
        </div>
      </div>

      <div className="glass-card overflow-hidden divide-y divide-gray-100">
        <div className="p-4"><label className="text-[10px] font-bold text-gray-400 uppercase">Proxy URL</label><input type="text" value={apiConfig.url} onChange={e=>setApiConfig({...apiConfig, url: e.target.value})} className="w-full bg-transparent text-sm font-medium outline-none mt-1" /></div>
        <div className="p-4"><label className="text-[10px] font-bold text-gray-400 uppercase">Secret Key</label><input type="password" value={apiConfig.key} onChange={e=>setApiConfig({...apiConfig, key: e.target.value})} className="w-full bg-transparent text-sm font-medium outline-none mt-1" /></div>
      </div>
    </div>
  );
});