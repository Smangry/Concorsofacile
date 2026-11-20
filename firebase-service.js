/**
 * GOOGLE FIREBASE AUTH & FIRESTORE SYNC SERVICE - UniSS 2026
 * 
 * Modulo 100% autonomo (Zero dipendenze esterne, Zero CDN pesanti).
 * Comunica direttamente con le API REST ufficiali di Google Firebase:
 * - Google Identity Toolkit API (Autenticazione Email & Password)
 * - Cloud Firestore REST API (Sincronizzazione progressi di studio)
 * 
 * Supporta architettura Offline-First:
 * - Funziona offline senza bloccare l'interfaccia.
 * - Sincronizzazione automatica bidirezionale intelligente (merge) appena online.
 */

window.FirebaseSync = (function () {
  'use strict';

  const STORAGE_KEYS = {
    CUSTOM_CONFIG: 'uniss_firebase_custom_config',
    AUTH_USER: 'uniss_firebase_user',
    LAST_SYNC: 'uniss_firebase_last_sync'
  };

  let autoSyncTimer = null;
  let isSyncing = false;

  // =========================================================================
  // GESTIONE CONFIGURAZIONE
  // =========================================================================
  function getConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_CONFIG);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.apiKey && parsed.projectId) {
          return parsed;
        }
      }
    } catch (e) {}

    const cfg = window.FIREBASE_CONFIG || {};
    return {
      apiKey: (cfg.apiKey || '').trim(),
      projectId: (cfg.projectId || '').trim(),
      authDomain: (cfg.authDomain || '').trim()
    };
  }

  function isConfigured() {
    const cfg = getConfig();
    return !!(cfg.apiKey && cfg.projectId);
  }

  function saveConfig(apiKey, projectId) {
    const cleanApiKey = (apiKey || '').trim();
    const cleanProjectId = (projectId || '').trim();
    if (!cleanApiKey || !cleanProjectId) {
      throw new Error('API Key e Project ID sono entrambi obbligatori.');
    }
    const cfg = { apiKey: cleanApiKey, projectId: cleanProjectId };
    localStorage.setItem(STORAGE_KEYS.CUSTOM_CONFIG, JSON.stringify(cfg));
    return cfg;
  }

  function removeCustomConfig() {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_CONFIG);
  }

  // =========================================================================
  // GESTIONE SESSIONE UTENTE
  // =========================================================================
  function getUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTH_USER);
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.getPref === 'function') {
      try {
        const val = window.AndroidNative.getPref(STORAGE_KEYS.AUTH_USER, '');
        if (val && val !== '') return JSON.parse(val);
      } catch (e) {}
    }
    return null;
  }

  function saveUser(user) {
    const str = JSON.stringify(user);
    try {
      localStorage.setItem(STORAGE_KEYS.AUTH_USER, str);
    } catch (e) {}
    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.savePref === 'function') {
      try {
        window.AndroidNative.savePref(STORAGE_KEYS.AUTH_USER, str);
      } catch (e) {}
    }
  }

  function clearUser() {
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
    } catch (e) {}
    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.savePref === 'function') {
      try {
        window.AndroidNative.savePref(STORAGE_KEYS.AUTH_USER, '');
      } catch (e) {}
    }
  }

  function getLastSyncTime() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
      if (raw) return parseInt(raw, 10);
    } catch (e) {}

    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.getPref === 'function') {
      try {
        const val = window.AndroidNative.getPref(STORAGE_KEYS.LAST_SYNC, '');
        if (val && val !== '') return parseInt(val, 10);
      } catch (e) {}
    }
    return null;
  }

  function setLastSyncTime(ts) {
    const str = String(ts);
    try {
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, str);
    } catch (e) {}
    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.savePref === 'function') {
      try {
        window.AndroidNative.savePref(STORAGE_KEYS.LAST_SYNC, str);
      } catch (e) {}
    }
  }

  // =========================================================================
  // TRADUZIONE ERRORI FIREBASE IN ITALIANO
  // =========================================================================
  function translateError(errorMsg) {
    if (!errorMsg) return 'Errore sconosciuto di connessione.';
    const str = String(errorMsg);

    if (str.includes('EMAIL_EXISTS')) return 'Questa email è già registrata: seleziona la scheda "Accedi" per effettuare il login.';
    if (str.includes('OPERATION_NOT_ALLOWED')) return 'Autenticazione Email/Password non abilitata nella Console Firebase.';
    if (str.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) return 'Troppi tentativi consecutivi. Riprova tra qualche minuto.';
    if (str.includes('EMAIL_NOT_FOUND')) return 'Nessun account trovato con questa email. Clicca su "Crea Account" in alto per registrarti.';
    if (str.includes('INVALID_PASSWORD') || str.includes('INVALID_LOGIN_CREDENTIALS')) return 'Email o password non corretti. Se non hai ancora creato un account, seleziona "Crea Account" in alto.';
    if (str.includes('USER_DISABLED')) return 'Questo account utente è stato disabilitato.';
    if (str.includes('WEAK_PASSWORD')) return 'La password deve contenere almeno 6 caratteri.';
    if (str.includes('INVALID_EMAIL')) return 'Inserisci un indirizzo email valido.';
    if (str.includes('MISSING_PASSWORD')) return 'Inserisci la password.';
    if (str.includes('404') || str.includes('not found') || str.includes('NOT_FOUND')) {
      return 'Database Cloud Firestore non ancora creato nella Console Firebase. Vai su Firebase Console -> Firestore Database e clicca su "Crea database".';
    }
    if (str.includes('PERMISSION_DENIED') || str.includes('403') || str.includes('Missing or insufficient permissions')) {
      return 'Permessi di scrittura bloccati su Firestore. Vai su Firebase Console -> Firestore Database -> Regole e consenti la lettura/scrittura per utenti autenticati.';
    }
    if (str.includes('Failed to fetch') || str.includes('NetworkError') || str.includes('network')) {
      return 'Nessuna connessione a internet. Riprova non appena sei online.';
    }
    return str;
  }

  // =========================================================================
  // REFRESH TOKEN (Google SecureToken API)
  // =========================================================================
  async function refreshTokenIfNeeded() {
    const user = getUser();
    if (!user || !user.refreshToken) return null;

    // Se mancano più di 5 minuti alla scadenza, il token è ancora valido
    const now = Date.now();
    if (user.expiresAt && now < user.expiresAt - 300000) {
      return user.idToken;
    }

    const cfg = getConfig();
    if (!cfg.apiKey) return null;

    try {
      const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(user.refreshToken)}`
      });

      if (!res.ok) {
        // Se il token è stato revocato o non valido
        if (res.status === 400) {
          clearUser();
          return null;
        }
        return user.idToken; // fallback
      }

      const data = await res.json();
      user.idToken = data.id_token;
      user.refreshToken = data.refresh_token;
      user.expiresAt = Date.now() + (parseInt(data.expires_in, 10) * 1000);
      saveUser(user);
      return user.idToken;
    } catch (e) {
      console.warn('Impossibile rinnovare token (offline?):', e);
      return user.idToken;
    }
  }

  // =========================================================================
  // AUTENTICAZIONE (Google Identity Toolkit API)
  // =========================================================================
  async function register(email, password) {
    const cfg = getConfig();
    if (!cfg.apiKey) {
      throw new Error('Progetto Firebase non configurato. Inserisci la tua API Key.');
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error('Inserisci sia l\'email sia la password.');
    }
    if (password.length < 6) {
      throw new Error('La password deve contenere almeno 6 caratteri.');
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        password: password,
        returnSecureToken: true
      })
    });

    const data = await res.json();
    if (!res.ok) {
      const err = data.error?.message || 'Errore durante la registrazione.';
      throw new Error(translateError(err));
    }

    const userData = {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + (parseInt(data.expiresIn, 10) * 1000)
    };

    saveUser(userData);

    // Carica immediatamente i progressi locali correnti sul nuovo account cloud!
    let syncError = null;
    try {
      await sync(false);
    } catch (syncErr) {
      console.warn('Primo caricamento dati cloud post-registrazione:', syncErr);
      syncError = syncErr.message;
    }

    userData.syncError = syncError;
    return userData;
  }

  async function login(email, password) {
    const cfg = getConfig();
    if (!cfg.apiKey) {
      throw new Error('Progetto Firebase non configurato. Inserisci la tua API Key.');
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error('Inserisci sia l\'email sia la password.');
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        password: password,
        returnSecureToken: true
      })
    });

    const data = await res.json();
    if (!res.ok) {
      const err = data.error?.message || 'Errore durante l\'accesso.';
      throw new Error(translateError(err));
    }

    const userData = {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + (parseInt(data.expiresIn, 10) * 1000)
    };

    saveUser(userData);

    // Esegui la sincronizzazione bidirezionale per scaricare i progressi dal cloud
    let syncError = null;
    try {
      await sync(false);
    } catch (syncErr) {
      console.warn('Sincronizzazione post-login:', syncErr);
      syncError = syncErr.message;
    }

    userData.syncError = syncError;
    return userData;
  }

  function logout() {
    clearUser();
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC);
  }

  // =========================================================================
  // SINCRONIZZAZIONE FIRESTORE REST API (Documento utente)
  // =========================================================================
  async function uploadProgressToFirestore(payload) {
    const cfg = getConfig();
    const user = getUser();
    if (!user || !cfg.projectId) return false;

    const token = await refreshTokenIfNeeded();
    if (!token) throw new Error('Sessione scaduta. Effettua nuovamente l\'accesso.');

    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}?updateMask.fieldPaths=progressJson&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=email`;

    const body = {
      fields: {
        progressJson: { stringValue: JSON.stringify(payload) },
        updatedAt: { integerValue: String(Date.now()) },
        email: { stringValue: user.email || '' }
      }
    };

    const res = await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error?.message || `Errore HTTP ${res.status}`;
      throw new Error(`Salvataggio Firestore fallito: ${translateError(msg)}`);
    }

    return true;
  }

  async function downloadProgressFromFirestore() {
    const cfg = getConfig();
    const user = getUser();
    if (!user || !cfg.projectId) return null;

    const token = await refreshTokenIfNeeded();
    if (!token) return null;

    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.uid)}`;

    const res = await fetch(docUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 404) {
      // Documento non ancora esistente nel cloud
      return null;
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error?.message || `Errore HTTP ${res.status}`;
      throw new Error(`Lettura Firestore fallita: ${translateError(msg)}`);
    }

    const data = await res.json();
    const jsonStr = data.fields?.progressJson?.stringValue;
    if (jsonStr) {
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        console.error('Errore parsing progressJson da Firestore:', e);
      }
    }
    return null;
  }

  // =========================================================================
  // INTELLIGENT MERGE (Unione sicura senza perdita di dati)
  // =========================================================================
  function mergeProgress(localData, cloudData) {
    if (!cloudData) return localData;
    if (!localData) return cloudData;

    // 1. Merge risposte ai quesiti di allenamento
    const mergedAnswers = { ...(cloudData.userAnswers || {}) };
    const localAnswers = localData.userAnswers || {};

    Object.keys(localAnswers).forEach(qId => {
      const lAns = localAnswers[qId];
      const cAns = mergedAnswers[qId];
      if (!cAns) {
        mergedAnswers[qId] = lAns;
      } else {
        // Se presente in entrambi, mantieni quello con timestamp più recente
        const lTime = lAns.timestamp || 0;
        const cTime = cAns.timestamp || 0;
        if (lTime >= cTime) {
          mergedAnswers[qId] = lAns;
        }
      }
    });

    // 2. Merge preferiti (Unione dei due insiemi)
    const cloudBm = Array.isArray(cloudData.bookmarks) ? cloudData.bookmarks : [];
    const localBm = Array.isArray(localData.bookmarks) ? localData.bookmarks : [];
    const mergedBookmarks = Array.from(new Set([...cloudBm, ...localBm]));

    // 3. Merge cronologia simulazioni d'esame
    const cloudHist = Array.isArray(cloudData.history) ? cloudData.history : [];
    const localHist = Array.isArray(localData.history) ? localData.history : [];
    const historyMap = new Map();
    cloudHist.forEach(h => { if (h && h.id) historyMap.set(h.id, h); });
    localHist.forEach(h => { if (h && h.id) historyMap.set(h.id, h); });
    const mergedHistory = Array.from(historyMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 4. Sessione attiva (quella più recente)
    let mergedSession = localData.lastSession;
    if (cloudData.lastSession) {
      const lTime = localData.lastSession?.timestamp || 0;
      const cTime = cloudData.lastSession?.timestamp || 0;
      if (cTime > lTime) {
        mergedSession = cloudData.lastSession;
      }
    }

    // 5. Nome Candidato
    const mergedCandidateName = cloudData.candidateName || localData.candidateName || '';

    // 6. Streak & Giorni di Studio
    const cloudStreak = cloudData.streakData || { dates: {}, currentStreak: 0 };
    const localStreak = localData.streakData || { dates: {}, currentStreak: 0 };
    const mergedStreakDates = { ...(cloudStreak.dates || {}) };
    Object.keys(localStreak.dates || {}).forEach(k => {
      const loc = localStreak.dates[k];
      const cld = mergedStreakDates[k];
      if (!cld) {
        mergedStreakDates[k] = loc;
      } else {
        mergedStreakDates[k] = {
          seconds: Math.max(loc.seconds || 0, cld.seconds || 0),
          completed: !!(loc.completed || cld.completed)
        };
      }
    });
    const mergedStreakData = {
      dates: mergedStreakDates,
      currentStreak: Math.max(cloudStreak.currentStreak || 0, localStreak.currentStreak || 0),
      lastActiveDate: cloudStreak.lastActiveDate || localStreak.lastActiveDate || ''
    };

    // 7. Risposte "Al primo colpo"
    const mergedFirstTry = { ...(cloudData.firstTryRecords || {}), ...(localData.firstTryRecords || {}) };

    return {
      userAnswers: mergedAnswers,
      bookmarks: mergedBookmarks,
      history: mergedHistory,
      lastSession: mergedSession,
      candidateName: mergedCandidateName,
      streakData: mergedStreakData,
      firstTryRecords: mergedFirstTry,
      updatedAt: Date.now()
    };
  }

  // =========================================================================
  // SINCRONIZZAZIONE GLOBALE BIDIREZIONALE
  // =========================================================================
  async function sync(isBackground = false) {
    if (isSyncing) return { success: false, reason: 'sync_already_in_progress' };
    const user = getUser();
    if (!user) return { success: false, reason: 'not_logged_in' };
    if (!isConfigured()) return { success: false, reason: 'not_configured' };

    isSyncing = true;
    try {
      // 1. Raccoglie lo stato locale attuale (con fallback multilivello su Storage e localStorage)
      let currentAnswers = {};
      if (window.AppState && window.AppState.training && window.AppState.training.userAnswers) {
        currentAnswers = window.AppState.training.userAnswers;
      } else if (window.Storage && typeof window.Storage.getItem === 'function') {
        try {
          const raw = window.Storage.getItem('uniss_training_answers_2026');
          if (raw) currentAnswers = JSON.parse(raw);
        } catch (e) {}
      } else {
        try {
          const raw = localStorage.getItem('uniss_training_answers_2026');
          if (raw) currentAnswers = JSON.parse(raw);
        } catch (e) {}
      }

      let currentBookmarks = [];
      if (window.AppState && window.AppState.training && window.AppState.training.bookmarks) {
        currentBookmarks = Array.from(window.AppState.training.bookmarks);
      } else if (window.Storage && typeof window.Storage.getItem === 'function') {
        try {
          const raw = window.Storage.getItem('uniss_bookmarks_2026');
          if (raw) currentBookmarks = JSON.parse(raw);
        } catch (e) {}
      }

      let currentHistory = [];
      if (window.AppState && window.AppState.history) {
        currentHistory = window.AppState.history;
      } else if (window.Storage && typeof window.Storage.getItem === 'function') {
        try {
          const raw = window.Storage.getItem('uniss_exam_history_2026');
          if (raw) currentHistory = JSON.parse(raw);
        } catch (e) {}
      }

      const localData = {
        userAnswers: currentAnswers,
        bookmarks: currentBookmarks,
        history: currentHistory,
        lastSession: (window.Storage && typeof window.Storage.getTrainingSession === 'function') 
          ? window.Storage.getTrainingSession() 
          : null,
        candidateName: (window.AppState && window.AppState.candidateName) || (window.Storage && window.Storage.getItem('uniss_candidate_name_2026')) || '',
        streakData: (window.AppState && window.AppState.streakData) || null,
        firstTryRecords: (window.AppState && window.AppState.firstTryRecords) || null,
        updatedAt: Date.now()
      };

      // 2. Scarica i progressi salvati sul cloud Firestore
      const cloudData = await downloadProgressFromFirestore();

      // 3. Esegue il merge intelligente
      const merged = mergeProgress(localData, cloudData);

      // 4. Salva lo stato unito in locale
      if (window.AppState) {
        if (window.AppState.training) {
          window.AppState.training.userAnswers = merged.userAnswers;
          window.AppState.training.bookmarks = new Set(merged.bookmarks);
        }
        window.AppState.history = merged.history;
        if (merged.candidateName) window.AppState.candidateName = merged.candidateName;
        if (merged.streakData) window.AppState.streakData = merged.streakData;
        if (merged.firstTryRecords) window.AppState.firstTryRecords = merged.firstTryRecords;
      }

      // Salva in storage locale e native SharedPreferences
      if (window.Storage) {
        window.Storage.setItem(window.Storage.KEYS.TRAINING_ANSWERS, JSON.stringify(merged.userAnswers));
        window.Storage.setItem(window.Storage.KEYS.BOOKMARKS, JSON.stringify(merged.bookmarks));
        window.Storage.setItem(window.Storage.KEYS.EXAM_HISTORY, JSON.stringify(merged.history));
        if (merged.lastSession) {
          window.Storage.setItem(window.Storage.KEYS.LAST_SESSION, JSON.stringify(merged.lastSession));
        }
        if (merged.candidateName) {
          window.Storage.setItem(window.Storage.KEYS.CANDIDATE_NAME, merged.candidateName);
        }
        if (merged.streakData) {
          window.Storage.setItem(window.Storage.KEYS.STREAK_DATA, JSON.stringify(merged.streakData));
        }
        if (merged.firstTryRecords) {
          window.Storage.setItem(window.Storage.KEYS.FIRST_TRY, JSON.stringify(merged.firstTryRecords));
        }
      } else {
        try {
          localStorage.setItem('uniss_training_answers_2026', JSON.stringify(merged.userAnswers));
          localStorage.setItem('uniss_bookmarks_2026', JSON.stringify(merged.bookmarks));
          localStorage.setItem('uniss_exam_history_2026', JSON.stringify(merged.history));
        } catch (e) {}
      }

      // 5. Invia lo stato unito a Firestore
      await uploadProgressToFirestore(merged);

      const now = Date.now();
      setLastSyncTime(now);

      // 6. Notifica l'app dell'avvenuta sincronizzazione
      if (typeof window.onFirebaseSyncCompleted === 'function') {
        window.onFirebaseSyncCompleted(merged, isBackground);
      }

      return {
        success: true,
        answersCount: Object.keys(merged.userAnswers).length,
        bookmarksCount: merged.bookmarks.length,
        historyCount: merged.history.length,
        syncTime: now
      };
    } catch (err) {
      if (!isBackground) {
        console.error('Errore durante la sincronizzazione:', err);
        throw err;
      }
      return { success: false, error: err.message };
    } finally {
      isSyncing = false;
    }
  }

  // =========================================================================
  // AUTO-SYNC DEBOUNCED (Invia le modifiche a riposo dopo 2.5s)
  // =========================================================================
  function scheduleAutoSync() {
    const user = getUser();
    if (!user || !isConfigured()) return;

    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      sync(true).catch(e => console.warn('Auto-sync silenzioso non riuscito (offline):', e));
    }, 2500);
  }

  // =========================================================================
  // RESET COMPLETO PROGRESSI CLOUD
  // =========================================================================
  async function resetProgress() {
    const user = getUser();
    if (!user || !isConfigured()) return;
    const payload = {
      userAnswers: {},
      bookmarks: (window.AppState && window.AppState.training && window.AppState.training.bookmarks) 
        ? Array.from(window.AppState.training.bookmarks) 
        : [],
      history: (window.AppState && window.AppState.history) ? window.AppState.history : [],
      lastSession: null,
      updatedAt: Date.now()
    };
    try {
      await uploadProgressToFirestore(payload);
      setLastSyncTime(Date.now());
    } catch (e) {
      console.warn('Errore reset progressi cloud:', e);
    }
  }

  // API PUBBLICA
  return {
    getConfig,
    isConfigured,
    saveConfig,
    removeCustomConfig,
    getUser,
    getLastSyncTime,
    register,
    login,
    logout,
    sync,
    resetProgress,
    scheduleAutoSync
  };
})();
