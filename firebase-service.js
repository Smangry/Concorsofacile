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
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveUser(user) {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
    } catch (e) {}
  }

  function clearUser() {
    localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
  }

  function getLastSyncTime() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
      return raw ? parseInt(raw, 10) : null;
    } catch (e) {
      return null;
    }
  }

  function setLastSyncTime(ts) {
    try {
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, String(ts));
    } catch (e) {}
  }

  // =========================================================================
  // TRADUZIONE ERRORI FIREBASE IN ITALIANO
  // =========================================================================
  function translateError(errorMsg) {
    if (!errorMsg) return 'Errore sconosciuto di connessione.';
    const str = String(errorMsg);

    if (str.includes('EMAIL_EXISTS')) return 'Questa email è già registrata. Effettua l\'accesso.';
    if (str.includes('OPERATION_NOT_ALLOWED')) return 'Autenticazione Email/Password non abilitata nella Console Firebase.';
    if (str.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) return 'Troppi tentativi consecutivi. Riprova tra qualche minuto.';
    if (str.includes('EMAIL_NOT_FOUND')) return 'Nessun account trovato con questa email.';
    if (str.includes('INVALID_PASSWORD') || str.includes('INVALID_LOGIN_CREDENTIALS')) return 'Email o password non corretti.';
    if (str.includes('USER_DISABLED')) return 'Questo account utente è stato disabilitato.';
    if (str.includes('WEAK_PASSWORD')) return 'La password deve contenere almeno 6 caratteri.';
    if (str.includes('INVALID_EMAIL')) return 'Inserisci un indirizzo email valido.';
    if (str.includes('MISSING_PASSWORD')) return 'Inserisci la password.';
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
    try {
      await sync(false);
    } catch (syncErr) {
      console.warn('Primo caricamento dati cloud post-registrazione:', syncErr);
    }

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
    try {
      await sync(false);
    } catch (syncErr) {
      console.warn('Sincronizzazione post-login:', syncErr);
    }

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

    return {
      userAnswers: mergedAnswers,
      bookmarks: mergedBookmarks,
      history: mergedHistory,
      lastSession: mergedSession,
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
      // 1. Raccoglie lo stato locale attuale
      const localData = {
        userAnswers: (window.AppState && window.AppState.training) ? window.AppState.training.userAnswers : {},
        bookmarks: (window.AppState && window.AppState.training && window.AppState.training.bookmarks) 
          ? Array.from(window.AppState.training.bookmarks) 
          : [],
        history: (window.AppState && window.AppState.history) ? window.AppState.history : [],
        lastSession: (window.Storage && typeof window.Storage.getTrainingSession === 'function') 
          ? window.Storage.getTrainingSession() 
          : null,
        updatedAt: Date.now()
      };

      // 2. Scarica i progressi salvati sul cloud Firestore
      const cloudData = await downloadProgressFromFirestore();

      // 3. Esegue il merge intelligente
      const merged = mergeProgress(localData, cloudData);

      // 4. Salva lo stato unito in locale
      if (window.AppState && window.AppState.training) {
        window.AppState.training.userAnswers = merged.userAnswers;
        window.AppState.training.bookmarks = new Set(merged.bookmarks);
        window.AppState.history = merged.history;

        // Salva in storage locale e native SharedPreferences
        if (window.Storage) {
          if (typeof window.Storage.saveTrainingAnswers === 'function') window.Storage.saveTrainingAnswers();
          if (typeof window.Storage.saveBookmarks === 'function') window.Storage.saveBookmarks();
          if (typeof window.Storage.saveExamHistory === 'function') window.Storage.saveExamHistory();
          if (merged.lastSession && typeof window.Storage.setItem === 'function') {
            window.Storage.setItem('uniss_last_session_2026', JSON.stringify(merged.lastSession));
          }
        }
      }

      // 5. Invia lo stato unito a Firestore
      await uploadProgressToFirestore(merged);

      const now = Date.now();
      setLastSyncTime(now);

      // 6. Notifica l'app dell'avvenuta sincronizzazione
      if (typeof window.onFirebaseSyncCompleted === 'function') {
        window.onFirebaseSyncCompleted(merged);
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
    scheduleAutoSync
  };
})();
