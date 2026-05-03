import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { 
  Home, Settings, User, Plus, Wifi, WifiOff, 
  ChevronRight, ChevronLeft, Trash2, Moon, Sun, 
  Pin, Bell, BellOff, ArrowLeft, GripVertical, Clock, RefreshCw, Zap, List,
  Search, GitCompare, Timer, SlidersHorizontal, Copy, CheckCircle2
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(false);
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
      if (parsed.isDarkMode !== undefined) setIsDarkMode(parsed.isDarkMode);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('waTrackerConfig', JSON.stringify({ apiConfig, isDarkMode }));
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [apiConfig, isDarkMode]);

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

  // --- PUSHER: REAL-TIME WEBSOCKET LISTENER (DEBOUNCED) ---
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
        // 1. Optimistic UI Update (Instant)
        setTargets(prev => prev.map(t => {
          if (t.number === data.number) {
            return { ...t, isOnline: data.status === 'online', lastSeen: data.status === 'online' ? 'Active Now' : 'Just now', lastActiveMs: Date.now() };
          }
          return t;
        }));

        // 2. Debounced DB Sync (Batch rapidly firing events)
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
    console.log(`Notifications snoozed for ${target.name} for ${hours} hours.`);
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
    <div className={`${isDarkMode ? 'dark' : ''}`}>
      <div className="liquid-bg transform-gpu">
        <div className="blob transform-gpu will-change-transform"></div>
        <div className="blob blob-2 transform-gpu will-change-transform"></div>
        <div className="blob blob-3 transform-gpu will-change-transform"></div>
      </div>

      <div className="flex flex-col h-screen max-w-md mx-auto text-gray-900 dark:text-gray-100 font-sans antialiased overflow-hidden sm:glass-panel sm:rounded-[3rem] sm:h-[850px] sm:my-8 relative transition-colors duration-300">
        <div className="flex-1 overflow-y-auto pb-24 scrollbar-hide z-10 transform-gpu">
          {viewingTarget ? (
            <TargetDetailView 
              target={targets.find(t => t.id === viewingTarget)} onClose={() => setViewingTarget(null)} onRemove={handleRemoveTarget}
              onTogglePin={togglePin} onToggleMute={toggleMute} onSnooze={handleSnooze} mongoFetch={mongoFetch} apiConfig={apiConfig}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardView targets={targets} pingStats={pingStats} isSyncing={isSyncing} onTargetClick={setViewingTarget} reorderPinned={reorderPinned} />
          ) : activeTab === 'compare' ? (
            <CompareView targets={targets} mongoFetch={mongoFetch} apiConfig={apiConfig} />
          ) : (
            <SettingsView apiConfig={apiConfig} setApiConfig={setApiConfig} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} newTarget={newTarget} setNewTarget={setNewTarget} handleAddTarget={handleAddTarget} pingStats={pingStats} />
          )}
        </div>

        <div className="absolute bottom-0 w-full glass-card border-x-0 border-b-0 rounded-b-[3rem] pb-safe pt-3 px-6 flex justify-around items-center z-50 transform-gpu">
          <button onClick={() => {setActiveTab('dashboard'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 transform-gpu ${activeTab === 'dashboard' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500 dark:text-gray-400'}`}>
            <Home size={24} strokeWidth={activeTab === 'dashboard' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Dashboard</span>
          </button>
          <button onClick={() => {setActiveTab('compare'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 transform-gpu ${activeTab === 'compare' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500 dark:text-gray-400'}`}>
            <GitCompare size={24} strokeWidth={activeTab === 'compare' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Compare</span>
          </button>
          <button onClick={() => {setActiveTab('settings'); setViewingTarget(null);}} className={`flex flex-col items-center p-2 mb-2 transition-all duration-300 active:scale-90 transform-gpu ${activeTab === 'settings' && !viewingTarget ? 'text-blue-500 scale-110' : 'text-gray-500 dark:text-gray-400'}`}>
            <Settings size={24} strokeWidth={activeTab === 'settings' && !viewingTarget ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// VIEWS (MEMOIZED FOR PERFORMANCE)
// ==========================================

const DashboardView = memo(function DashboardView({ targets, pingStats, isSyncing, onTargetClick, reorderPinned }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('default');

  // Heavily optimized sorting/filtering cached via useMemo
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
    if(dragItem.current !== undefined && dragOverItem.current !== undefined && searchTerm === '' && sortOption === 'default') {
      reorderPinned(dragItem.current, dragOverItem.current);
    }
    dragItem.current = undefined; dragOverItem.current = undefined;
  };

  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 transform-gpu">
      <div className="flex justify-between items-start mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white drop-shadow-sm">Tracker</h1>
        <div className="flex flex-col items-end">
          <div className="flex space-x-2 mb-1">
            {pingStats.wsStatus === 'Live' && (
              <div className="flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 backdrop-blur-md">
                <Zap size={10} className="fill-current" /> Live
              </div>
            )}
            <div className={`flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full backdrop-blur-md transition-colors ${pingStats.dbStatus === 'Connected' ? 'bg-green-500/20 text-green-700 dark:text-green-400' : pingStats.dbStatus === 'Error' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
              <RefreshCw size={10} className={`${isSyncing ? 'animate-spin' : ''} mr-1`} /> {pingStats.dbStatus}
            </div>
          </div>
          <div className="flex items-center justify-end space-x-1 text-xs text-gray-600 dark:text-gray-400 font-mono">
            {pingStats.latency > 0 && <span>{pingStats.latency}ms DB</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2 mb-6 transform-gpu">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-3.5 text-gray-500 dark:text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search targets..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full glass-card rounded-2xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder-gray-500 shadow-sm"
          />
        </div>
        <div className="relative shrink-0">
          <select 
             value={sortOption} 
             onChange={e => setSortOption(e.target.value)}
             className="glass-card rounded-2xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none text-gray-900 dark:text-gray-100 font-medium cursor-pointer shadow-sm"
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
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-widest mb-3 flex items-center drop-shadow-sm"><Pin size={14} className="mr-1" /> Pinned</h3>
          <div className="space-y-3">
            {pinnedTargets.map((target, index) => (
              <div key={target.id} draggable={searchTerm === '' && sortOption === 'default'} onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} className="relative group">
                <TargetCard target={target} onClick={() => onTargetClick(target.id)} isPinnedItem={searchTerm === '' && sortOption === 'default'} />
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-widest mb-3 drop-shadow-sm">All Targets</h3>
      <div className="space-y-3">
        {otherTargets.map((target) => <TargetCard key={target.id} target={target} onClick={() => onTargetClick(target.id)} />)}
        {targets.length === 0 && (
          <div className="text-center p-8 glass-card rounded-3xl border-dashed">
            <User className="mx-auto text-gray-500 mb-2" size={32} />
            <p className="text-gray-600 dark:text-gray-400 font-medium">No targets tracked yet.</p>
          </div>
        )}
      </div>
    </div>
  );
});

const TargetDetailView = memo(function TargetDetailView({ target, onClose, onRemove, onTogglePin, onToggleMute, onSnooze, mongoFetch, apiConfig }) {
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [dayOffset, setDayOffset] = useState(0); 
  const [isCopied, setIsCopied] = useState(false);

  const [localStats, setLocalStats] = useState({ totalTime: '0m', lastSeen: 'N/A', todayTimeline: Array(24).fill(0), sessionLogs: [] });
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);

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
    <div className="min-h-full animate-in slide-in-from-right-8 duration-300 relative z-10 transform-gpu">
      <div className="glass-card !rounded-none !border-t-0 !border-x-0 pt-12 pb-6 px-6 sticky top-0 z-20">
        <button onClick={onClose} className="flex items-center text-blue-600 dark:text-blue-400 font-medium mb-4 active:scale-95 transition-transform"><ArrowLeft size={20} className="mr-1" /> Back</button>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${target.isOnline ? 'border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)]' : 'border-gray-300 dark:border-gray-600'} bg-white/50 dark:bg-black/50 backdrop-blur-md relative transition-all duration-500 transform-gpu`}>
              <span className="text-2xl font-bold text-gray-500 dark:text-gray-300">{target.name.charAt(0).toUpperCase()}</span>
              {target.isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30 transform-gpu"></span>}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight drop-shadow-sm">{target.name}</h1>
              <div className="flex items-center space-x-2 mt-1">
                <p className="text-gray-600 dark:text-gray-400 font-mono text-sm">+{target.number}</p>
                <button onClick={copyToClipboard} className="text-gray-400 hover:text-blue-500 transition-colors active:scale-90 transform-gpu">
                  {isCopied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
          <div className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider backdrop-blur-md shadow-sm transition-colors ${target.isOnline ? 'bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/30' : 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20'}`}>
            {target.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />} <span>{target.isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="p-6 pb-24 space-y-6 relative">
        {isLoadingAnalytics && <div className="absolute inset-0 glass-card !bg-white/30 dark:!bg-black/30 z-20 flex items-center justify-center !rounded-3xl m-6"><RefreshCw className="animate-spin text-blue-500 transform-gpu" size={32} /></div>}

        <div className="grid grid-cols-4 gap-3 relative z-10">
          <button onClick={() => onTogglePin(target.id)} className={`flex flex-col items-center justify-center p-3 rounded-2xl transition-all active:scale-95 transform-gpu ${target.isPinned ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30 border border-blue-400' : 'glass-card text-blue-600 dark:text-blue-400 hover:bg-blue-500/10'}`}>
            <Pin size={20} className={target.isPinned ? 'fill-current' : ''} /> <span className="text-[10px] font-semibold mt-1">Pin</span>
          </button>
          <button onClick={() => onToggleMute(target.id)} className={`flex flex-col items-center justify-center p-3 rounded-2xl transition-all active:scale-95 transform-gpu ${target.isMuted ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30 border border-orange-400' : 'glass-card text-orange-600 dark:text-orange-400 hover:bg-orange-500/10'}`}>
            {target.isMuted ? <BellOff size={20} /> : <Bell size={20} />} <span className="text-[10px] font-semibold mt-1">{target.isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button onClick={() => setShowSnoozeMenu(!showSnoozeMenu)} className={`flex flex-col items-center justify-center p-3 rounded-2xl glass-card text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-all active:scale-95 transform-gpu relative`}>
            <Timer size={20} /> <span className="text-[10px] font-semibold mt-1">Snooze</span>
            {showSnoozeMenu && (
              <div className="absolute top-full left-0 mt-2 glass-card rounded-xl w-32 py-1 z-50 text-left overflow-hidden border border-white/40 dark:border-white/10 shadow-xl">
                <div onClick={() => { onSnooze(target.id, 1); setShowSnoozeMenu(false); }} className="px-4 py-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors">1 Hour</div>
                <div className="border-t border-gray-200/20 dark:border-gray-700/50"></div>
                <div onClick={() => { onSnooze(target.id, 8); setShowSnoozeMenu(false); }} className="px-4 py-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors">8 Hours</div>
              </div>
            )}
          </button>
          <button onClick={() => {if(window.confirm('Remove target?')) onRemove(target.id);}} className="flex flex-col items-center justify-center p-3 rounded-2xl glass-card text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-all active:scale-95 transform-gpu">
            <Trash2 size={20} /> <span className="text-[10px] font-semibold mt-1">Remove</span>
          </button>
        </div>

        <div className="glass-card rounded-3xl p-5 overflow-hidden relative">
          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center space-x-2">
              <button onClick={() => setDayOffset(d => d + 1)} className="p-1.5 bg-black/5 dark:bg-white/10 rounded-xl hover:text-blue-500 transition-colors active:scale-90 transform-gpu"><ChevronLeft size={18} /></button>
              <h2 className="text-sm font-bold w-32 text-center select-none uppercase tracking-wider">{getDayLabel()}</h2>
              <button onClick={() => setDayOffset(d => Math.max(0, d - 1))} disabled={dayOffset === 0} className="p-1.5 bg-black/5 dark:bg-white/10 rounded-xl hover:text-blue-500 disabled:opacity-30 transition-colors active:scale-90 transform-gpu"><ChevronRight size={18} /></button>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Total</p>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400 drop-shadow-sm">{localStats.totalTime}</p>
            </div>
          </div>
          <div className="mt-6 w-full h-24 relative -mx-1 transform-gpu">
            <svg viewBox={`0 0 230 ${chartHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible drop-shadow-md">
              <defs>
                <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
              </defs>
              <line x1="0" y1="0" x2="230" y2="0" stroke="currentColor" strokeDasharray="4" className="text-gray-300 dark:text-gray-700/50" strokeWidth="1" />
              <line x1="0" y1={chartHeight/2} x2="230" y2={chartHeight/2} stroke="currentColor" strokeDasharray="4" className="text-gray-300 dark:text-gray-700/50" strokeWidth="1" />
              <line x1="0" y1={chartHeight} x2="230" y2={chartHeight} stroke="currentColor" className="text-gray-400 dark:text-gray-600/50" strokeWidth="1" />
              <path d={areaD} fill="url(#colorActivity)" />
              <path d={pathD} fill="none" stroke="#3B82F6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex justify-between text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-2 px-1"><span>12A</span><span>6A</span><span>12P</span><span>6P</span><span>11P</span></div>
          </div>
        </div>

        <div className="glass-card rounded-3xl p-5 relative mt-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="bg-purple-500/20 p-2 rounded-xl text-purple-600 dark:text-purple-400 backdrop-blur-sm border border-purple-500/20">
              <List size={20} />
            </div>
            <h2 className="text-lg font-bold">Session Logs</h2>
            <span className="ml-auto text-xs font-bold text-gray-600 dark:text-gray-300 bg-black/5 dark:bg-white/10 px-2 py-1 rounded-md shadow-inner">{localStats.sessionLogs.length} SESSIONS</span>
          </div>
          
          <div className="space-y-3 mt-4 max-h-64 overflow-y-auto pr-2 scrollbar-hide transform-gpu">
            {localStats.sessionLogs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6 italic">No sessions recorded.</p>
            ) : (
              localStats.sessionLogs.map((log, i) => (
                <div key={log.id || i} className="flex justify-between items-center p-3 rounded-2xl bg-white/40 dark:bg-black/20 border border-white/30 dark:border-white/5 hover:bg-white/60 dark:hover:bg-black/40 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${log.isLive ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-400 dark:bg-gray-600'}`}></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">
                        {log.start} <span className="text-gray-400 font-normal mx-1">→</span> 
                        {log.end === 'Active Now' ? <span className="text-green-600 dark:text-green-400">Active Now</span> : log.end}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1.5 rounded-xl backdrop-blur-sm border ${log.isLive ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'}`}>
                    {formatDurationMs(log.duration)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
});

const TargetCard = memo(function TargetCard({ target, onClick, isPinnedItem }) {
  return (
    <div onClick={onClick} className="glass-card rounded-[24px] p-4 flex items-center active:scale-[0.98] transition-transform duration-200 cursor-pointer group hover:bg-white/70 dark:hover:bg-gray-800/60 transform-gpu will-change-transform">
      {isPinnedItem && <div className="cursor-grab active:cursor-grabbing mr-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 p-1"><GripVertical size={18} /></div>}
      <div className="relative mr-4">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${target.isOnline ? 'border-green-400 shadow-[0_0_10px_rgba(74,222,128,0.4)]' : 'border-gray-300 dark:border-gray-600'} bg-white/60 dark:bg-black/50 backdrop-blur-sm relative transition-all`}>
          <span className="text-lg font-bold text-gray-500 dark:text-gray-400 group-hover:text-blue-500 transition-colors">{target.name.charAt(0).toUpperCase()}</span>
          {target.isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-30 transform-gpu"></span>}
        </div>
        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white dark:border-gray-900 flex items-center justify-center relative shadow-sm ${target.isOnline ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'}`}>
          {target.isOnline ? <Wifi size={10} color="white" className="relative z-10" /> : <WifiOff size={10} color="white" />}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center"><h3 className="font-bold text-lg truncate pr-2 drop-shadow-sm">{target.name}</h3>{target.isMuted && <BellOff size={12} className="text-gray-400" />}</div>
        <p className="text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">{target.isOnline ? <span className="text-green-600 dark:text-green-400 font-bold tracking-wider text-xs uppercase">Online Now</span> : <span>Seen: {target.lastSeen}</span>}</p>
      </div>
      <div className="text-right flex flex-col items-end pl-2">
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 font-bold text-sm px-3 py-1 rounded-xl mb-1 shadow-sm backdrop-blur-sm">{target.totalTime}</div>
        <ChevronRight size={20} className="text-gray-400 group-hover:text-blue-500 transition-colors transform-gpu" />
      </div>
    </div>
  );
});

const CompareView = memo(function CompareView({ targets, mongoFetch, apiConfig }) {
  // (Compare View logic remains exactly the same as the previous iteration)
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
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col relative z-10 transform-gpu">
      <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-6 drop-shadow-sm">Compare</h1>

      <div className="glass-card rounded-3xl p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between space-x-4">
           <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black flex-shrink-0 shadow-sm">A</div>
           <select className="flex-1 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/30 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none text-gray-900 dark:text-white cursor-pointer" value={targetA} onChange={e => setTargetA(e.target.value)}>
             {targets.map(t => <option key={`A_${t.id}`} value={t.number}>{t.name}</option>)}
           </select>
        </div>
        <div className="flex items-center justify-between space-x-4">
           <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-400 flex items-center justify-center font-black flex-shrink-0 shadow-sm">B</div>
           <select className="flex-1 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/30 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none text-gray-900 dark:text-white cursor-pointer" value={targetB} onChange={e => setTargetB(e.target.value)}>
             {targets.map(t => <option key={`B_${t.id}`} value={t.number}>{t.name}</option>)}
           </select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 glass-card rounded-2xl p-2">
        <button onClick={() => setDayOffset(d => d + 1)} className="p-2.5 bg-black/5 dark:bg-white/10 rounded-xl hover:text-blue-500 transition-colors active:scale-90 transform-gpu"><ChevronLeft size={18} /></button>
        <h2 className="text-sm font-bold w-32 text-center select-none uppercase tracking-wider">{getDayLabel()}</h2>
        <button onClick={() => setDayOffset(d => Math.max(0, d - 1))} disabled={dayOffset === 0} className="p-2.5 bg-black/5 dark:bg-white/10 rounded-xl hover:text-blue-500 disabled:opacity-30 transition-colors active:scale-90 transform-gpu"><ChevronRight size={18} /></button>
      </div>

      <div className="glass-card rounded-3xl p-5 flex-1 relative overflow-hidden flex flex-col">
        {isLoading && <div className="absolute inset-0 bg-white/40 dark:bg-black/40 z-20 flex items-center justify-center backdrop-blur-md"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>}
        
        <div className="text-center mb-6 pt-2">
           <p className="text-xs font-bold text-gray-500 tracking-widest uppercase mb-1 drop-shadow-sm">Total Intersection</p>
           <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 drop-shadow-sm">{overlapStats.totalOverlapStr}</p>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide transform-gpu">
            {overlapStats.overlaps.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6 italic">No overlapping sessions detected.</p>
            ) : (
              overlapStats.overlaps.map((log, i) => (
                <div key={i} className="flex justify-between items-center p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-sm hover:bg-indigo-500/20 transition-colors">
                  <div className="flex items-center space-x-3">
                    <GitCompare size={16} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-sm font-semibold">
                      {log.start} <span className="text-gray-400 font-normal mx-1">→</span> {log.end}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 shadow-sm">
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

const SettingsView = memo(function SettingsView({ apiConfig, setApiConfig, isDarkMode, setIsDarkMode, newTarget, setNewTarget, handleAddTarget, pingStats }) {
  return (
    <div className="p-6 pt-12 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10 transform-gpu">
      <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-6 drop-shadow-sm">Settings</h1>
      
      <div className="mb-6">
        <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase tracking-widest mb-2 ml-4 drop-shadow-sm">Appearance</h3>
        <div className="glass-card rounded-3xl p-1.5 flex">
          <button onClick={() => setIsDarkMode(false)} className={`flex-1 flex justify-center items-center py-3 rounded-2xl transition-all font-semibold text-sm transform-gpu ${!isDarkMode ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-white shadow-md border border-white/50 dark:border-white/20 scale-[1.02]' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}><Sun size={18} className="mr-2" /> Light</button>
          <button onClick={() => setIsDarkMode(true)} className={`flex-1 flex justify-center items-center py-3 rounded-2xl transition-all font-semibold text-sm transform-gpu ${isDarkMode ? 'bg-black/40 text-white shadow-md border border-white/10 scale-[1.02]' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}><Moon size={18} className="mr-2" /> Dark</button>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase tracking-widest mb-2 ml-4 drop-shadow-sm">Quick Add</h3>
        <div className="glass-card rounded-3xl p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input type="text" placeholder="Name" value={newTarget.name} onChange={(e) => setNewTarget({...newTarget, name: e.target.value})} className="flex-1 min-w-0 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/30 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder-gray-500" />
            <input type="tel" placeholder="Number" value={newTarget.number} onChange={(e) => setNewTarget({...newTarget, number: e.target.value})} className="flex-1 min-w-0 bg-white/40 dark:bg-black/40 backdrop-blur-md border border-white/30 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder-gray-500" />
            <button onClick={handleAddTarget} disabled={!newTarget.number} className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-xl disabled:opacity-50 transition-all shadow-[0_4px_15px_rgba(37,99,235,0.4)] active:scale-95 transform-gpu shrink-0 flex items-center justify-center"><Plus size={20} /></button>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase tracking-widest mb-2 ml-4 drop-shadow-sm">Advanced Configuration</h3>
        <div className="glass-card rounded-3xl overflow-hidden divide-y divide-gray-300/30 dark:divide-gray-700/50">
          <div className="p-4 bg-black/5 dark:bg-white/5 backdrop-blur-sm"><p className="text-xs font-bold uppercase tracking-wider mb-1">1. Vercel Database Proxy</p></div>
          <div className="p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Proxy URL</label><input type="text" placeholder="https://my-proxy.vercel.app/api/proxy" value={apiConfig.url} onChange={(e) => setApiConfig({...apiConfig, url: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400/70 outline-none" /></div>
          <div className="p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Secret Key</label><input type="password" placeholder="••••••••••••••••••••••••••••••" value={apiConfig.key} onChange={(e) => setApiConfig({...apiConfig, key: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400/70 outline-none" /></div>
          
          <div className="p-4 bg-blue-500/10 backdrop-blur-sm border-t border-blue-500/20"><p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1">2. Pusher WebSockets (Live Data)</p></div>
          <div className="p-4 hover:bg-blue-500/5 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pusher App Key</label><input type="text" placeholder="e.g. 1a2b3c4d5e..." value={apiConfig.pusherKey} onChange={(e) => setApiConfig({...apiConfig, pusherKey: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400/70 outline-none" /></div>
          <div className="p-4 hover:bg-blue-500/5 transition-colors"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pusher Cluster</label><input type="text" placeholder="e.g. ap2" value={apiConfig.pusherCluster} onChange={(e) => setApiConfig({...apiConfig, pusherCluster: e.target.value})} className="w-full mt-1 bg-transparent border-none p-0 focus:ring-0 text-sm font-medium placeholder-gray-400/70 outline-none" /></div>
        </div>
      </div>
    </div>
  );
});