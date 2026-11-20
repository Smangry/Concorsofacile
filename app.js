/**
 * SIMULATORE CONCORSO UniSS 2026 - APPLICATION LOGIC
 * Università degli Studi di Sassari - 15 Collaboratori Amministrativi
 * 
 * Gestione Allenamento con filtri e spiegazioni immediate.
 * Gestione Simulazione d'Esame con estrazione da distribuzione_materie,
 * timer reale, calcolo del voto su 30 (soglia 21/30) e spiegazione immediata ad ogni errore.
 */

(function () {
  'use strict';

  // =========================================================================
  // AUDIO SYNTHESIZER (Web Audio API - 100% Offline, Zero dipendenze esterne)
  // =========================================================================
  const SoundFx = {
    audioCtx: null,
    enabled: true,

    init() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      } catch (e) {
        console.warn('Web Audio API non supportata:', e);
      }
    },

    ensureContext() {
      if (!this.audioCtx) this.init();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    },

    playCorrect() {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    },

    playWrong() {
      if (!this.enabled) return;
      this.ensureContext();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.linearRampToValueAtTime(160, now + 0.2);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    }
  };

  // =========================================================================
  // HAPTIC FEEDBACK (Micro-vibrazione aptica per Android APK e Browser Mobile)
  // =========================================================================
  const Haptic = {
    enabled: true,

    vibrate(ms) {
      if (!this.enabled) return;
      try {
        if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.vibrate === 'function') {
          window.AndroidNative.vibrate(ms);
        } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(ms);
        }
      } catch (e) {}
    },

    vibratePattern(pattern) {
      if (!this.enabled) return;
      try {
        if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.vibratePattern === 'function') {
          window.AndroidNative.vibratePattern(pattern);
        } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(pattern);
        }
      } catch (e) {}
    },

    tap() {
      this.vibrate(15);
    },

    success() {
      this.vibratePattern([20, 40, 20]);
    },

    error() {
      this.vibrate(55);
    }
  };

  // =========================================================================
  // STATO GLOBALE DELL'APPLICAZIONE
  // =========================================================================
  const AppState = {
    appVersion: '8.0.0',
    allQuestions: [],
    categories: [],
    topicsByCategory: {},
    distribution: {
      "Statuto dell'Università degli Studi di Sassari": 7,
      "Regolamento dell'Università degli Studi di Sassari": 6,
      "Legislazione universitaria": 3,
      "Quiz situazionali": 7,
      "Logica": 7
    },
    passingScore: 21,
    totalExamQuestions: 30,

    simulationModes: {
      preselettiva: {
        nome: "Simulazione Prova Preselettiva (27 Nov 2026)",
        numero_domande: 30,
        soglia_superamento: 21,
        distribuzione_materie: {
          "Statuto dell'Università degli Studi di Sassari": 7,
          "Regolamento dell'Università degli Studi di Sassari": 6,
          "Legislazione universitaria": 3,
          "Quiz situazionali": 7,
          "Logica": 7
        }
      },
      prova_tecnica_completa: {
        nome: "Simulazione Prova Scritta / Tecnico-Professionale (Tutte le materie)",
        numero_domande: 30,
        soglia_superamento: 21,
        distribuzione_materie: {
          "Diritto amministrativo": 7,
          "Privacy, trasparenza e anticorruzione": 5,
          "Lavoro pubblico e reclutamento": 5,
          "Statuto dell'Università degli Studi di Sassari": 4,
          "Regolamento dell'Università degli Studi di Sassari": 3,
          "Lingua inglese": 3,
          "Informatica": 3
        }
      }
    },
    currentSimulationMode: 'preselettiva',

    // Impostazioni modalità studio
    settings: {
      autoExplain: true, // Spiegazione immediata automatica al clic
      shuffleQuestions: true, // Default: ordine domande casuale
      shuffleOptions: true,   // Default: ordine risposte A, B, C, D casuale
      hapticEnabled: true     // Feedback aptico (vibrazione)
    },

    // Profilo & Personalizzazione Candidato
    candidateName: '',

    // Gamification & Statistiche Nerd
    firstTryRecords: {}, // { [questionId]: { isCorrect: boolean, timestamp: number } }
    streakData: {
      dates: {}, // { 'YYYY-MM-DD': { seconds: 0, completed: false } }
      currentStreak: 0,
      lastActiveDate: ''
    },
    dailyStudySeconds: 0,

    // Stato Allenamento
    training: {
      filteredList: [],
      currentIndex: 0,
      filterMateria: 'ALL',
      filterArgomento: 'ALL',
      filterSearch: '',
      filterStatus: 'ALL', // 'ALL', 'WRONG', 'BOOKMARKED', 'UNANSWERED'
      viewMode: 'card', // 'card' o 'list'
      userAnswers: {}, // { questionId: { selectedOption, isCorrect } }
      retrySessionAnswers: {}, // Risposte date durante la sessione attiva di "Ripassa Errori"
      bookmarks: new Set()
    },

    // Stato Esame
    exam: {
      isActive: false,
      isFinished: false,
      questions: [],
      userAnswers: [], // Array di { questionId, selectedOption, isCorrect, timestamp }
      currentIndex: 0,
      totalSeconds: 45 * 60,
      remainingSeconds: 45 * 60,
      timerInterval: null,
      startTime: null,
      endTime: null
    },

    // Storico
    history: []
  };
  window.AppState = AppState;

  // =========================================================================
  // PERSISTENZA LOCALSTORAGE
  // =========================================================================
  const Storage = {
    KEYS: {
      BOOKMARKS: 'uniss_bookmarks_2026',
      TRAINING_ANSWERS: 'uniss_training_answers_2026',
      EXAM_HISTORY: 'uniss_exam_history_2026',
      THEME: 'uniss_theme_pref',
      SOUND: 'uniss_sound_pref',
      CUSTOM_BANCA_DATI: 'uniss_custom_banca_dati_2026',
      LAST_SESSION: 'uniss_last_session_2026',
      SHUFFLE_QUESTIONS: 'uniss_shuffle_questions_pref',
      SHUFFLE_OPTIONS: 'uniss_shuffle_options_pref',
      CANDIDATE_NAME: 'uniss_candidate_name_2026',
      STREAK_DATA: 'uniss_streak_data_2026',
      FIRST_TRY: 'uniss_first_try_2026',
      HAPTIC: 'uniss_haptic_pref'
    },

    getNative(key) {
      if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.getPref === 'function') {
        try {
          const val = window.AndroidNative.getPref(key, '');
          if (val && val !== '') return val;
        } catch (e) {}
      }
      return null;
    },

    setNative(key, val) {
      if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.savePref === 'function') {
        try {
          window.AndroidNative.savePref(key, typeof val === 'string' ? val : JSON.stringify(val));
        } catch (e) {}
      }
    },

    getItem(key) {
      const nativeVal = this.getNative(key);
      if (nativeVal !== null) return nativeVal;
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },

    setItem(key, value) {
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      try {
        localStorage.setItem(key, strVal);
      } catch (e) {}
      this.setNative(key, strVal);
    },

    load() {
      try {
        const b = this.getItem(this.KEYS.BOOKMARKS);
        if (b) AppState.training.bookmarks = new Set(JSON.parse(b));

        const a = this.getItem(this.KEYS.TRAINING_ANSWERS);
        if (a) AppState.training.userAnswers = JSON.parse(a);

        const h = this.getItem(this.KEYS.EXAM_HISTORY);
        if (h) AppState.history = JSON.parse(h);

        const s = this.getItem(this.KEYS.SOUND);
        if (s !== null) SoundFx.enabled = (s === 'true');

        const t = this.getItem(this.KEYS.THEME) || 'light';
        document.documentElement.setAttribute('data-theme', t);
        updateThemeToggleIcon(t);

        const sq = this.getItem(this.KEYS.SHUFFLE_QUESTIONS);
        if (sq !== null) AppState.settings.shuffleQuestions = (sq === 'true');

        const so = this.getItem(this.KEYS.SHUFFLE_OPTIONS);
        if (so !== null) AppState.settings.shuffleOptions = (so === 'true');

        const cName = this.getItem(this.KEYS.CANDIDATE_NAME);
        if (cName) AppState.candidateName = cName;

        const streakRaw = this.getItem(this.KEYS.STREAK_DATA);
        if (streakRaw) {
          try { AppState.streakData = JSON.parse(streakRaw); } catch (e) {}
        }

        const ftRaw = this.getItem(this.KEYS.FIRST_TRY);
        if (ftRaw) {
          try { AppState.firstTryRecords = JSON.parse(ftRaw); } catch (e) {}
        }

        const hap = this.getItem(this.KEYS.HAPTIC);
        if (hap !== null) {
          Haptic.enabled = (hap === 'true');
          AppState.settings.hapticEnabled = Haptic.enabled;
        }
      } catch (e) {
        console.warn('Errore lettura dati salvati:', e);
      }
    },

    saveCandidateName(name) {
      AppState.candidateName = name || '';
      this.setItem(this.KEYS.CANDIDATE_NAME, AppState.candidateName);
    },

    saveStreakData() {
      try {
        this.setItem(this.KEYS.STREAK_DATA, JSON.stringify(AppState.streakData));
      } catch (e) {}
    },

    saveFirstTryRecords() {
      try {
        this.setItem(this.KEYS.FIRST_TRY, JSON.stringify(AppState.firstTryRecords));
      } catch (e) {}
    },

    saveHaptic(enabled) {
      Haptic.enabled = !!enabled;
      AppState.settings.hapticEnabled = !!enabled;
      this.setItem(this.KEYS.HAPTIC, enabled ? 'true' : 'false');
    },

    saveBookmarks() {
      try {
        this.setItem(this.KEYS.BOOKMARKS, JSON.stringify(Array.from(AppState.training.bookmarks)));
        if (window.FirebaseSync && typeof window.FirebaseSync.scheduleAutoSync === 'function') {
          window.FirebaseSync.scheduleAutoSync();
        }
      } catch (e) {}
    },

    saveTrainingAnswers() {
      try {
        this.setItem(this.KEYS.TRAINING_ANSWERS, JSON.stringify(AppState.training.userAnswers));
        if (window.FirebaseSync && typeof window.FirebaseSync.scheduleAutoSync === 'function') {
          window.FirebaseSync.scheduleAutoSync();
        }
      } catch (e) {}
    },

    saveExamHistory() {
      try {
        this.setItem(this.KEYS.EXAM_HISTORY, JSON.stringify(AppState.history));
        if (window.FirebaseSync && typeof window.FirebaseSync.scheduleAutoSync === 'function') {
          window.FirebaseSync.scheduleAutoSync();
        }
      } catch (e) {}
    },

    saveTheme(theme) {
      try {
        this.setItem(this.KEYS.THEME, theme);
      } catch (e) {}
    },

    saveSound(enabled) {
      try {
        this.setItem(this.KEYS.SOUND, enabled ? 'true' : 'false');
      } catch (e) {}
    },

    saveCustomBancaDati(data) {
      try {
        this.setItem(this.KEYS.CUSTOM_BANCA_DATI, JSON.stringify(data));
      } catch (e) {
        console.warn('Errore salvataggio banca dati custom:', e);
      }
    },

    saveTrainingSession() {
      try {
        const session = {
          filterMateria: AppState.training.filterMateria || 'ALL',
          filterArgomento: AppState.training.filterArgomento || 'ALL',
          filterStatus: AppState.training.filterStatus || 'ALL',
          currentIndex: AppState.training.currentIndex || 0,
          timestamp: Date.now()
        };
        this.setItem(this.KEYS.LAST_SESSION, JSON.stringify(session));
      } catch (e) {}
    },

    getTrainingSession() {
      try {
        const raw = this.getItem(this.KEYS.LAST_SESSION);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    getCustomBancaDati() {
      try {
        const raw = localStorage.getItem(this.KEYS.CUSTOM_BANCA_DATI);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    removeCustomBancaDati() {
      try {
        localStorage.removeItem(this.KEYS.CUSTOM_BANCA_DATI);
      } catch (e) {}
    }
  };
  window.Storage = Storage;

  // =========================================================================
  // GAMIFICATION STREAK ENGINE (Regola 30 min / giorno di Quiz)
  // =========================================================================
  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function calculateConsecutiveStreak() {
    if (!AppState.streakData) {
      AppState.streakData = { dates: {}, currentStreak: 0, lastActiveDate: '' };
    }
    if (!AppState.streakData.dates) {
      AppState.streakData.dates = {};
    }

    const today = getTodayDateString();
    let checkDate = new Date();

    const todayRecord = AppState.streakData.dates[today];
    const isTodayDone = todayRecord && todayRecord.completed;

    let streak = 0;
    if (isTodayDone) {
      streak = 1;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // Se oggi non è ancora completato, controlliamo da ieri per preservare la serie
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const y = checkDate.getFullYear();
      const m = String(checkDate.getMonth() + 1).padStart(2, '0');
      const d = String(checkDate.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${d}`;

      const rec = AppState.streakData.dates[dateKey];
      if (rec && rec.completed) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    AppState.streakData.currentStreak = streak;
    return streak;
  }

  function updateDailyStudyStreak(secondsDelta = 1) {
    const today = getTodayDateString();
    if (!AppState.streakData) {
      AppState.streakData = { dates: {}, currentStreak: 0, lastActiveDate: '' };
    }
    if (!AppState.streakData.dates) {
      AppState.streakData.dates = {};
    }
    if (!AppState.streakData.dates[today]) {
      AppState.streakData.dates[today] = { seconds: 0, completed: false };
    }

    AppState.streakData.dates[today].seconds += secondsDelta;
    if (AppState.streakData.dates[today].seconds >= 1800) { // 30 minuti = 1800 secondi
      AppState.streakData.dates[today].completed = true;
    }

    calculateConsecutiveStreak();
  }

  let studySessionTimer = null;
  let activeSessionSeconds = 0;

  function startStudySessionTicker() {
    if (studySessionTimer) return;
    studySessionTimer = setInterval(() => {
      const activeSection = document.querySelector('.section-view.active');
      const isStudying = activeSection && (activeSection.id === 'training-view' || activeSection.id === 'exam-view');
      if (isStudying) {
        activeSessionSeconds++;
        updateDailyStudyStreak(1);

        const timerEl = document.getElementById('count-live-timer');
        if (timerEl && activeSection.id === 'training-view') {
          timerEl.textContent = formatTime(activeSessionSeconds);
        }

        if (activeSessionSeconds % 30 === 0) {
          Storage.saveStreakData();
        }
      }
    }, 1000);
  }

  // =========================================================================
  // HELPER E UTILITY
  // =========================================================================
  function getBadgeClass(materia) {
    if (materia.includes('Statuto')) return 'badge-statuto';
    if (materia.includes('Regolamento')) return 'badge-regolamento';
    if (materia.includes('Legislazione')) return 'badge-legislazione';
    if (materia.includes('situazionali')) return 'badge-situazionali';
    if (materia.includes('Logica')) return 'badge-logica';
    if (materia.includes('amministrativo')) return 'badge-amministrativo';
    if (materia.includes('Privacy')) return 'badge-privacy';
    if (materia.includes('Lavoro')) return 'badge-lavoro';
    if (materia.includes('inglese')) return 'badge-inglese';
    if (materia.includes('Informatica')) return 'badge-informatica';
    return 'badge-id';
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDisplayOptions(q) {
    if (!q || !q.opzioni) return [];

    // Se esiste già una mappatura generata coerente con l'impostazione corrente, riusala
    if (q._displayOptions && q._displayOptionsMode === AppState.settings.shuffleOptions) {
      return q._displayOptions;
    }

    const origLetters = ['A', 'B', 'C', 'D'];
    const list = [];
    origLetters.forEach(l => {
      const text = q.opzioni[l];
      if (text) {
        list.push({
          origLetter: l,
          text: text,
          isCorrect: (l === q.risposta_corretta)
        });
      }
    });

    // Mescola le opzioni se l'impostazione è attiva (esclusi ID 122 e 150 con riferimenti posizionali)
    if (AppState.settings.shuffleOptions && q.id !== 122 && q.id !== 150) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }

    const result = list.map((item, idx) => ({
      displayLetter: origLetters[idx],
      text: item.text,
      isCorrect: item.isCorrect,
      origLetter: item.origLetter
    }));

    q._displayOptions = result;
    q._displayOptionsMode = AppState.settings.shuffleOptions;
    return result;
  }

  function showToast(message, icon = 'ℹ️') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2600);
  }

  function updateThemeToggleIcon(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // =========================================================================
  // INIZIALIZZAZIONE BANCA DATI
  // =========================================================================
  function initDatabase() {
    const integrated = (typeof window !== 'undefined' && window.BANCA_DATI) 
      ? window.BANCA_DATI 
      : (typeof BANCA_DATI !== 'undefined' ? BANCA_DATI : null);
    const customData = Storage.getCustomBancaDati();

    // 1. Se l'utente ha scaricato un aggiornamento online o ha una banca dati personalizzata valida
    if (customData && Array.isArray(customData.quesiti) && customData.quesiti.length > 0) {
      const isOnline = !!customData.isOnlineUpdate;
      const customLen = customData.quesiti.length;
      const integratedLen = (integrated && Array.isArray(integrated.quesiti)) ? integrated.quesiti.length : 0;
      
      // Carica se è un aggiornamento OTA scaricato online oppure se ha almeno tanti quesiti quanti la versione integrata
      if (isOnline || customLen >= integratedLen) {
        console.log('[Storage] Caricata banca dati aggiornata:', customLen, 'quesiti', isOnline ? '(OTA Online)' : '(Custom)');
        loadData(customData, customData.sourceLabel || ('Aggiornamento Online (v' + (customData.versione || 'Cloud') + ')'));
        return;
      }
    }

    // 2. Altrimenti usa la banca dati integrata (v6.1 Completa con 949 quesiti)
    if (integrated && integrated.quesiti && Array.isArray(integrated.quesiti) && integrated.quesiti.length > 0) {
      console.log('[Init] Caricata banca dati integrata v' + (integrated.versione || '6.1') + ' (' + integrated.quesiti.length + ' quesiti)');
      loadData(integrated, 'Integrata (v' + (integrated.versione || '6.1') + ' Completa)');
      return;
    } else {
      // Fallback asincrono se caricato via web server
      fetch('banca_dati_concorso_uniss_2026.json')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.quesiti) && data.quesiti.length > 0) {
            loadData(data, 'Scaricata via JSON');
          } else {
            throw new Error('Dati quesiti vuoti o non validi');
          }
        })
        .catch(err => {
          console.error('Impossibile caricare il JSON della banca dati:', err);
          showToast('Errore nel caricamento della banca dati', '❌');
        });
    }
  }

  function loadData(data, sourceLabel = 'Integrata (v6.0 Completa)') {
    AppState.allQuestions = data.quesiti || [];
    AppState.currentDataSource = sourceLabel;
    AppState.dataVersion = data.versione || '5.0';

    // Aggiorna indicatori nella UI
    const modalCount = document.getElementById('modal-loaded-questions-count');
    if (modalCount) {
      const matCount = data.materie ? Object.keys(data.materie).length : 10;
      modalCount.textContent = `${AppState.allQuestions.length} quesiti (${matCount} materie)`;
    }
    const modalSource = document.getElementById('modal-data-source');
    if (modalSource) {
      modalSource.textContent = sourceLabel;
    }

    const repoNavTab = document.getElementById('tab-repo');
    if (repoNavTab) {
      repoNavTab.innerHTML = `<span>📚 Banca Dati (${AppState.allQuestions.length})</span>`;
    }
    const deskRepoLabel = document.getElementById('desk-repo-nav-label');
    if (deskRepoLabel) {
      deskRepoLabel.textContent = `📖 Banca Dati (${AppState.allQuestions.length})`;
    }

    if (data.modalita_simulazione) {
      AppState.simulationModes = data.modalita_simulazione;
    }
    const activeMode = (AppState.simulationModes && AppState.simulationModes[AppState.currentSimulationMode]) 
      || (AppState.simulationModes && AppState.simulationModes.preselettiva);

    if (activeMode) {
      AppState.distribution = activeMode.distribuzione_materie;
      AppState.passingScore = activeMode.soglia_superamento || 21;
      AppState.totalExamQuestions = activeMode.numero_domande || 30;
    } else if (data.struttura_simulazione_consigliata) {
      if (data.struttura_simulazione_consigliata.distribuzione_materie) {
        AppState.distribution = data.struttura_simulazione_consigliata.distribuzione_materie;
      }
      if (data.struttura_simulazione_consigliata.soglia_superamento) {
        AppState.passingScore = data.struttura_simulazione_consigliata.soglia_superamento;
      }
      if (data.struttura_simulazione_consigliata.numero_domande_simulazione) {
        AppState.totalExamQuestions = data.struttura_simulazione_consigliata.numero_domande_simulazione;
      }
    }

    // Organizza categorie e argomenti
    const topicsMap = {};
    AppState.allQuestions.forEach(q => {
      if (!topicsMap[q.materia]) {
        topicsMap[q.materia] = new Set();
      }
      if (q.argomento) {
        topicsMap[q.materia].add(q.argomento);
      }
    });

    AppState.categories = Object.keys(topicsMap);
    AppState.topicsByCategory = {};
    for (const [mat, set] of Object.entries(topicsMap)) {
      AppState.topicsByCategory[mat] = Array.from(set).sort();
    }

    // Inizializza filtri e viste
    populateMateriaFilters();
    populateArgomentiFilter();
    applyTrainingFilters();
    renderExamDistribution();
    renderRepository();
    renderStatisticsView();
    updateTrainingStatsMini();
    renderHomeDashboard();
  }

  // =========================================================================
  // LOGICA HOME DASHBOARD & MENÙ MATERIE/ARGOMENTI
  // =========================================================================
  const SUBJECTS_META = {
    "Statuto dell'Università degli Studi di Sassari": {
      moduleNum: 1,
      macro: 'ATENEO',
      icon: '🏛️',
      desc: 'Principi generali, Rettore, Senato Accademico, CDA, Direttore Generale, Dipartimenti e Codice Etico.'
    },
    "Regolamento dell'Università degli Studi di Sassari": {
      moduleNum: 2,
      macro: 'ATENEO',
      icon: '📜',
      desc: 'Amministrazione, Finanza e Contabilità, bilancio, gestione liquidità e Codice di Comportamento.'
    },
    'Legislazione universitaria': {
      moduleNum: 3,
      macro: 'DIRITTO',
      icon: '🎓',
      desc: 'Legge 240/2010 (Gelmini), autonomia universitaria, didattica, ricerca e contabilità universitaria.'
    },
    'Quiz situazionali': {
      moduleNum: 4,
      macro: 'ATTITUDINALI',
      icon: '💡',
      desc: 'Problem solving amministrativo, collaborazione in team, gestione conflitti, etica e trasparenza.'
    },
    'Logica': {
      moduleNum: 5,
      macro: 'ATTITUDINALI',
      icon: '🧩',
      desc: 'Sillogismi, serie numeriche e alfabetiche, condizione necessaria/sufficiente e logica verbale.'
    },
    'Diritto amministrativo': {
      moduleNum: 6,
      macro: 'DIRITTO',
      icon: '⚖️',
      desc: 'Procedimento (L. 241/90), accesso agli atti, Codice Appalti (D.Lgs. 36/2023) e D.P.R. 445/2000.'
    },
    'Privacy, trasparenza e anticorruzione': {
      moduleNum: 7,
      macro: 'DIRITTO',
      icon: '🔒',
      desc: 'GDPR privacy, trasparenza (D.Lgs. 33/2013), anticorruzione (L. 190/2012) e Whistleblowing.'
    },
    'Lavoro pubblico e reclutamento': {
      moduleNum: 8,
      macro: 'DIRITTO',
      icon: '💼',
      desc: 'Testo Unico Pubblico Impiego (D.Lgs. 165/2001), CCNL Istruzione e Ricerca e concorsi pubblici.'
    },
    'Lingua inglese': {
      moduleNum: 9,
      macro: 'DIGITALE',
      icon: '🇬🇧',
      desc: 'Terminologia accademica e amministrativa, comprensione comunicazioni istituzionali e grammatica.'
    },
    'Informatica': {
      moduleNum: 10,
      macro: 'DIGITALE',
      icon: '💻',
      desc: 'Codice Amministrazione Digitale (CAD), firme elettroniche, sicurezza informatica e suite Office.'
    }
  };

  const MACRO_SUBJECTS = {
    'ATENEO': {
      title: 'UniSS & Regolamento',
      icon: '🏛️',
      subjects: [
        "Statuto dell'Università degli Studi di Sassari",
        "Regolamento dell'Università degli Studi di Sassari",
        "Legislazione universitaria"
      ]
    },
    'ATTITUDINALI': {
      title: 'Logica & Situazionali',
      icon: '🧠',
      subjects: [
        "Quiz situazionali",
        "Logica"
      ]
    },
    'DIRITTO': {
      title: 'Diritto & Normativa',
      icon: '⚖️',
      subjects: [
        "Diritto amministrativo",
        "Privacy, trasparenza e anticorruzione",
        "Lavoro pubblico e reclutamento"
      ]
    },
    'DIGITALE': {
      title: 'Informatica & Inglese',
      icon: '💻',
      subjects: [
        "Lingua inglese",
        "Informatica"
      ]
    }
  };

  function updateActiveSubjectHeader(materia, argomento = 'ALL') {
    const label = document.getElementById('training-current-subject-label');
    if (!label) return;
    if (materia === 'ALL' && argomento === 'ALL') {
      label.textContent = `Tutte le Materie (${AppState.allQuestions.length})`;
    } else if (materia.startsWith('MACRO_')) {
      const macroKey = materia.replace('MACRO_', '');
      const macroInfo = MACRO_SUBJECTS[macroKey];
      const count = AppState.training.filteredList.length;
      label.textContent = `${macroInfo ? macroInfo.icon + ' ' + macroInfo.title : 'Ambito'} (${count})`;
    } else if (argomento === 'ALL') {
      const count = AppState.allQuestions.filter(q => q.materia === materia).length;
      label.textContent = `${materia} (${count})`;
    } else {
      const count = AppState.allQuestions.filter(q => q.materia === materia && q.argomento === argomento).length;
      label.textContent = `${materia} › ${argomento} (${count})`;
    }
  }

  function startTrainingOnTopic(materia, argomento = 'ALL') {
    AppState.training.filterMateria = materia;
    AppState.training.filterArgomento = argomento;
    AppState.training.filterStatus = 'ALL';
    AppState.training.filterSearch = '';

    const selMateria = document.getElementById('filter-materia');
    if (selMateria) selMateria.value = materia;

    populateArgomentiFilter();

    const selArg = document.getElementById('filter-argomento');
    if (selArg) selArg.value = argomento;

    // Reset pillole di stato
    document.querySelectorAll('.training-status-pill').forEach(p => p.classList.remove('active'));
    const allPill = document.querySelector('.training-status-pill[data-status="ALL"]');
    if (allPill) allPill.classList.add('active');

    hideModuleCompletionCard();
    // applyTrainingFilters(false) troverà automaticamente il primo quesito non risposto!
    applyTrainingFilters(false);
    updateActiveSubjectHeader(materia, argomento);
    Storage.saveTrainingSession();
    switchTab('training-view');

    const totalCount = AppState.training.filteredList.length;
    const curQ = AppState.training.currentIndex + 1;
    if (AppState.training.currentIndex > 0) {
      showToast(`Ripresa da quesito ${curQ} di ${totalCount} (${materia === 'ALL' ? 'Tutte le Materie' : materia})`, '🎯');
    } else {
      showToast(`Caricati ${totalCount} quesiti di: ${materia === 'ALL' ? 'Tutte le Materie' : materia}`, '📚');
    }
  }

  function startTrainingOnMacro(macroKey) {
    const macroInfo = MACRO_SUBJECTS[macroKey];
    if (!macroInfo) {
      startTrainingOnTopic('ALL', 'ALL');
      return;
    }
    const subjectsSet = new Set(macroInfo.subjects);
    const macroQuestions = AppState.allQuestions.filter(q => subjectsSet.has(q.materia));

    AppState.training.filterMateria = 'MACRO_' + macroKey;
    AppState.training.filterArgomento = 'ALL';
    AppState.training.filterStatus = 'ALL';
    AppState.training.filterSearch = '';
    AppState.training.filteredList = AppState.settings.shuffleQuestions 
      ? shuffleArray(macroQuestions) 
      : [...macroQuestions];

    // Posiziona automaticamente al primo quesito non ancora svolto
    const firstUnanswered = macroQuestions.findIndex(q => !AppState.training.userAnswers[q.id]);
    AppState.training.currentIndex = (firstUnanswered !== -1) ? firstUnanswered : 0;

    const label = document.getElementById('training-current-subject-label');
    if (label) {
      label.textContent = `${macroInfo.icon} ${macroInfo.title} (${macroQuestions.length})`;
    }

    hideModuleCompletionCard();
    Storage.saveTrainingSession();
    updateModuleProgressBar();
    updateStatusPillCounts();
    switchTab('training-view');
    renderTrainingCard();

    const curQ = AppState.training.currentIndex + 1;
    if (AppState.training.currentIndex > 0) {
      showToast(`Ripresa da quesito ${curQ} di ${macroQuestions.length} (${macroInfo.title})`, '🎯');
    } else {
      showToast(`Caricati ${macroQuestions.length} quesiti per: ${macroInfo.title}`, '🚀');
    }
  }

  // =========================================================================
  // GESTIONE PROGRESSO IN TEMPO REALE E FINE MODULO (RIEPILOGO)
  // =========================================================================
  function updateModuleProgressBar() {
    const list = AppState.training.filteredList;
    const idx = AppState.training.currentIndex;

    const fill = document.getElementById('module-progress-fill');
    const counter = document.getElementById('module-progress-counter');
    const liveScore = document.getElementById('module-progress-live-score');
    const btnNext = document.getElementById('btn-card-next');

    if (!fill || list.length === 0) return;

    const currentNum = Math.min(idx + 1, list.length);
    const rawPct = (currentNum / list.length) * 100;
    const pct = Math.round(rawPct);
    const displayPct = (pct === 0 && currentNum > 0) ? rawPct.toFixed(1) : pct;
    const visualPct = currentNum > 0 ? Math.max(1, rawPct) : 0;

    fill.style.width = `${visualPct.toFixed(1)}%`;
    if (counter) {
      counter.textContent = `Quesito ${currentNum} di ${list.length} (${displayPct}%)`;
    }

    // Calcola risposte esatte ed errate date finora nei quesiti di questo gruppo
    let correctInGroup = 0;
    let wrongInGroup = 0;
    list.forEach(q => {
      const ans = AppState.training.userAnswers[q.id];
      if (ans) {
        if (ans.isCorrect) correctInGroup++;
        else wrongInGroup++;
      }
    });

    if (liveScore) {
      liveScore.innerHTML = `
        <span style="color:var(--md-success); font-weight:800;">${correctInGroup} esatte</span> &bull; 
        <span style="color:var(--md-error); font-weight:800;">${wrongInGroup} errate</span>
      `;
    }

    // Se siamo all'ultima domanda, il tasto successivo diventa "Fine Modulo"
    if (btnNext) {
      if (idx >= list.length - 1) {
        btnNext.innerHTML = '<span>🏁 Fine Modulo</span>';
        btnNext.disabled = false;
        btnNext.classList.add('btn-gold');
      } else {
        btnNext.innerHTML = '<span>Prossima domanda →</span>';
        btnNext.disabled = false;
        btnNext.classList.remove('btn-gold');
      }
    }
  }

  function showModuleCompletionCard() {
    const cardContainer = document.getElementById('single-card-view');
    const actionNav = document.getElementById('training-action-bar');
    const completionCard = document.getElementById('module-completion-card');
    const list = AppState.training.filteredList;

    if (!completionCard) return;

    if (cardContainer) cardContainer.style.display = 'none';
    if (actionNav) actionNav.style.display = 'none';
    completionCard.style.display = 'block';

    const mainWrap = document.querySelector('.main-wrapper');
    if (mainWrap) mainWrap.scrollTop = 0;

    // Titolo del modulo completato
    const titleEl = document.getElementById('completion-module-title');
    if (titleEl) {
      const mat = AppState.training.filterMateria;
      const arg = AppState.training.filterArgomento;
      if (mat === 'ALL') titleEl.textContent = 'Tutte le Materie (949 Quesiti)';
      else if (arg === 'ALL') titleEl.textContent = mat;
      else titleEl.textContent = `${mat} › ${arg}`;
    }

    // Calcolo KPI del modulo
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    const wrongQuestions = [];

    list.forEach(q => {
      const ans = AppState.training.userAnswers[q.id];
      if (!ans) {
        unansweredCount++;
      } else if (ans.isCorrect) {
        correctCount++;
      } else {
        wrongCount++;
        wrongQuestions.push({ q, ans });
      }
    });

    const totalQuestions = list.length;
    const scorePct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    document.getElementById('completion-score-pct').textContent = `${scorePct}%`;
    document.getElementById('completion-kpi-correct').textContent = correctCount;
    document.getElementById('completion-kpi-wrong').textContent = wrongCount;
    document.getElementById('completion-kpi-total').textContent = totalQuestions;

    const pill = document.getElementById('completion-status-pill');
    const msg = document.getElementById('completion-feedback-msg');

    if (scorePct >= 80) {
      pill.textContent = '🌟 LIVELLO ECCELLENTE';
      pill.style.background = 'var(--md-success-container)';
      pill.style.color = 'var(--md-on-success-container)';
      msg.textContent = 'Hai un\'ottima preparazione su questo modulo. Continua così!';
    } else if (scorePct >= 70) {
      pill.textContent = '✅ PROVA SUPERATA (IDONEO)';
      pill.style.background = 'var(--md-success-container)';
      pill.style.color = 'var(--md-on-success-container)';
      msg.textContent = 'Punteggio superiore alla soglia di idoneità (21/30). Puoi perfezionare gli errori.';
    } else if (scorePct >= 50) {
      pill.textContent = '⚠️ PREPARAZIONE MEDIA';
      pill.style.background = 'var(--md-tertiary-container)';
      pill.style.color = 'var(--md-on-tertiary-container)';
      msg.textContent = 'Hai buone basi, ma ti consigliamo di ripassare i quesiti errati prima dell\'esame.';
    } else {
      pill.textContent = '❌ DA RIPASSARE';
      pill.style.background = 'var(--md-error-container)';
      pill.style.color = 'var(--md-on-error-container)';
      msg.textContent = 'Modulo non superato. Ripassa le spiegazioni e riprova il test per memorizzare.';
    }

    // Gestione sezione errori
    const errSec = document.getElementById('completion-errors-section');
    const errList = document.getElementById('completion-errors-list');
    const errCount = document.getElementById('completion-errors-count');
    const btnRetryWrong = document.getElementById('btn-completion-retry-wrong');
    const btnRetryCount = document.getElementById('btn-retry-wrong-count');

    if (wrongQuestions.length > 0) {
      if (errSec) errSec.style.display = 'block';
      if (errCount) errCount.textContent = wrongQuestions.length;
      if (btnRetryWrong) btnRetryWrong.style.display = 'block';
      if (btnRetryCount) btnRetryCount.textContent = wrongQuestions.length;

      if (errList) {
        errList.innerHTML = '';
        wrongQuestions.forEach(({ q, ans }) => {
          const item = document.createElement('div');
          item.className = 'review-card review-incorrect';

          const displayOpts = getDisplayOptions(q);
          const corrOpt = displayOpts.find(o => o.isCorrect);
          const corrLetter = corrOpt ? corrOpt.displayLetter : q.risposta_corretta;
          const corrText = corrOpt ? corrOpt.text : (q.opzioni[q.risposta_corretta] || '');

          const userLetter = ans.selectedDisplayLetter || ans.selectedOption;
          const userOpt = displayOpts.find(o => o.displayLetter === userLetter) || displayOpts.find(o => o.origLetter === ans.selectedOption);
          const userText = userOpt ? userOpt.text : (q.opzioni[ans.selectedOption] || '');

          item.innerHTML = `
            <div style="font-weight:700; margin-bottom:4px;">#${q.id} - ${escapeHtml(q.materia)}</div>
            <p style="font-size:0.85rem; margin-bottom:6px;">${escapeHtml(q.domanda)}</p>
            <div style="font-size:0.78rem; color:var(--md-error); margin-bottom:2px;">❌ Tua risposta: (${userLetter}) ${escapeHtml(userText)}</div>
            <div style="font-size:0.78rem; color:var(--md-success); font-weight:700; margin-bottom:6px;">✔️ Risposta esatta: (${corrLetter}) ${escapeHtml(corrText)}</div>
            <div class="feedback-explanation-body" style="font-size:0.78rem; padding:8px; margin-top:4px;">${q.spiegazione}</div>
          `;
          errList.appendChild(item);
        });
      }
    } else {
      if (errSec) errSec.style.display = 'none';
      if (btnRetryWrong) btnRetryWrong.style.display = 'none';
    }
  }

  function hideModuleCompletionCard() {
    const cardContainer = document.getElementById('single-card-view');
    const actionNav = document.getElementById('training-action-bar');
    const completionCard = document.getElementById('module-completion-card');

    if (completionCard) completionCard.style.display = 'none';
    if (cardContainer) cardContainer.style.display = 'block';
    if (actionNav) actionNav.style.display = 'flex';
  }

  function renderHomeDashboard() {
    const container = document.getElementById('home-subjects-container');
    if (!container) return;

    // 1. Saluto Personalizzato Candidato
    const greetingEl = document.getElementById('hero-candidate-greeting');
    if (greetingEl) {
      const name = AppState.candidateName ? AppState.candidateName.trim() : '';
      greetingEl.textContent = name ? `Ciao ${name}! 👋` : 'Ciao! 👋';
    }

    // 2. Statistiche complessive di avanzamento
    const totalQ = AppState.allQuestions.length;
    let answeredTotal = 0;
    let correctTotal = 0;
    let wrongTotal = 0;

    Object.values(AppState.training.userAnswers).forEach(ans => {
      answeredTotal++;
      if (ans.isCorrect) correctTotal++;
      else wrongTotal++;
    });

    const bookmarkedTotal = (AppState.training && AppState.training.bookmarks) ? AppState.training.bookmarks.size : 0;
    const rawOverallPct = totalQ > 0 ? (answeredTotal / totalQ) * 100 : 0;
    const overallPct = Math.round(rawOverallPct);
    const displayOverallPct = (overallPct === 0 && answeredTotal > 0) ? rawOverallPct.toFixed(1) : overallPct;
    const visualOverallPct = answeredTotal > 0 ? Math.max(1, rawOverallPct) : 0;
    const accuracy = answeredTotal > 0 ? Math.round((correctTotal / answeredTotal) * 100) : 0;

    // Calcolo Percentuale Corrette "Al primo colpo"
    const totalFirstTry = Object.keys(AppState.firstTryRecords || {}).length;
    const correctFirstTry = Object.values(AppState.firstTryRecords || {}).filter(r => r.isCorrect).length;
    const firstTryPct = totalFirstTry > 0 ? Math.round((correctFirstTry / totalFirstTry) * 100) : 0;

    // Calcolo Tempo Totale di Studio
    let totalSecondsStudied = 0;
    if (AppState.streakData && AppState.streakData.dates) {
      Object.values(AppState.streakData.dates).forEach(d => {
        totalSecondsStudied += (d.seconds || 0);
      });
    }
    const studyHours = Math.floor(totalSecondsStudied / 3600);
    const studyMinutes = Math.floor((totalSecondsStudied % 3600) / 60);

    // Aggiornamento 3 Card Metriche Chiave Moderne
    const kpiCompleted = document.getElementById('home-kpi-completed');
    const kpiFirstTry = document.getElementById('home-kpi-first-try');
    const kpiStudyTime = document.getElementById('home-kpi-study-time');
    if (kpiCompleted) kpiCompleted.textContent = answeredTotal;
    if (kpiFirstTry) kpiFirstTry.textContent = `${firstTryPct}%`;
    if (kpiStudyTime) kpiStudyTime.textContent = `${studyHours}h ${String(studyMinutes).padStart(2, '0')}m`;

    // Aggiornamento contatori per le card pastello di Allenamento
    const wrongCountEl = document.getElementById('home-wrong-count');
    const starCountEl = document.getElementById('home-star-count');
    if (wrongCountEl) wrongCountEl.textContent = wrongTotal;
    if (starCountEl) starCountEl.textContent = bookmarkedTotal;

    // 3. Widget Gamification Streak (Regola 30 min di studio)
    const today = getTodayDateString();
    const todayRecord = (AppState.streakData && AppState.streakData.dates && AppState.streakData.dates[today]) || { seconds: 0, completed: false };
    const todayMinutes = Math.min(30, Math.floor(todayRecord.seconds / 60));
    
    const ratioEl = document.getElementById('streak-daily-ratio');
    if (ratioEl) ratioEl.textContent = `${todayMinutes}/30`;

    const circleFill = document.getElementById('streak-svg-fill');
    if (circleFill) {
      const totalCircumference = 201.06;
      const progressFraction = Math.min(1, todayRecord.seconds / 1800);
      const offset = totalCircumference - (progressFraction * totalCircumference);
      circleFill.style.strokeDashoffset = offset;
    }

    const streakCount = calculateConsecutiveStreak();
    const flameBadge = document.getElementById('streak-flame-badge');
    if (flameBadge) {
      flameBadge.textContent = `🔥 ${streakCount} ${streakCount === 1 ? 'giorno' : 'giorni'}`;
    }

    const subDesc = document.getElementById('streak-daily-subdesc');
    if (subDesc) {
      if (todayRecord.completed) {
        subDesc.innerHTML = '🎉 <strong>Obiettivo di oggi raggiunto (30 min)!</strong> Serie convalidata.';
      } else {
        const rem = 30 - todayMinutes;
        subDesc.textContent = `Ancora ${rem} ${rem === 1 ? 'minuto' : 'minuti'} di quiz oggi per convalidare la serie.`;
      }
    }

    // Pillole dei 7 giorni della settimana corrente (L M M G V S D)
    const weekPillsContainer = document.getElementById('streak-week-pills');
    if (weekPillsContainer) {
      weekPillsContainer.innerHTML = '';
      const dayNames = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
      const curr = new Date();
      const dayOfWeek = (curr.getDay() + 6) % 7; // Lunedì = 0, Domenica = 6
      const monday = new Date(curr);
      monday.setDate(curr.getDate() - dayOfWeek);

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');
        const dateKey = `${yStr}-${mStr}-${dStr}`;

        const isDayToday = (dateKey === today);
        const isCompleted = AppState.streakData && AppState.streakData.dates && AppState.streakData.dates[dateKey] && AppState.streakData.dates[dateKey].completed;

        const pill = document.createElement('div');
        pill.className = `streak-week-day-pill${isCompleted ? ' completed' : ''}${isDayToday ? ' today' : ''}`;
        pill.innerHTML = `
          <span class="day-letter">${dayNames[i]}</span>
          <span class="day-dot">${isCompleted ? '✓' : (isDayToday ? '•' : '○')}</span>
        `;
        weekPillsContainer.appendChild(pill);
      }
    }

    // 4. Big Cobalt Blue Card: "Riprendi da dove eri rimasto" (Illustrazione Facciata Palazzo UniSS)
    const savedSession = Storage.getTrainingSession();
    const resumeCard = document.getElementById('home-resume-card');
    const resumeTitle = document.getElementById('home-resume-title');
    const resumeSub = document.getElementById('home-resume-sub');
    const resumePct = document.getElementById('home-resume-pct');
    const resumeBar = document.getElementById('home-resume-bar');
    const btnResume = document.getElementById('btn-home-resume');

    if (resumeCard) {
      resumeCard.style.display = 'block';

      let targetMateria = 'Statuto dell\'Università degli Studi di Sassari';
      let targetIndex = 0;
      let targetArg = 'ALL';

      if (savedSession && savedSession.filterMateria) {
        targetMateria = savedSession.filterMateria;
        targetIndex = savedSession.currentIndex || 0;
        targetArg = savedSession.filterArgomento || 'ALL';
      }

      const qForResume = (targetMateria === 'ALL')
        ? AppState.allQuestions
        : AppState.allQuestions.filter(q => q.materia === targetMateria);
      const totalForResume = qForResume.length || 1;
      const currentQNum = Math.min(targetIndex + 1, totalForResume);
      const pctForResume = Math.round((currentQNum / totalForResume) * 100);

      if (resumeTitle) {
        let cleanTitle = targetMateria.replace("dell'Università degli Studi di Sassari", 'UniSS');
        if (cleanTitle === 'ALL') cleanTitle = 'TUTTI I QUIZ';
        resumeTitle.textContent = cleanTitle.toUpperCase();
      }
      if (resumeSub) {
        resumeSub.textContent = `Domanda ${currentQNum} di ${totalForResume}`;
      }
      if (resumePct) {
        resumePct.textContent = `${pctForResume}%`;
      }
      if (resumeBar) {
        resumeBar.style.width = `${pctForResume}%`;
      }
      if (btnResume) {
        btnResume.onclick = () => {
          AppState.training.filterMateria = targetMateria;
          AppState.training.filterArgomento = targetArg;
          AppState.training.filterStatus = 'ALL';
          applyTrainingFilters();
          AppState.training.currentIndex = Math.min(targetIndex, AppState.training.filteredList.length - 1);
          updateActiveSubjectHeader(targetMateria, targetArg);
          hideModuleCompletionCard();
          switchTab('training-view');
          renderTrainingCard();
          showToast(`Ripresa sessione: Domanda ${AppState.training.currentIndex + 1}`, '🚀');
        };
      }
    }

    // 5. Materie del Concorso: Generazione righe eleganti (Fedele a Mockup 1)
    const SUBJECT_STYLES = [
      { badge: 'badge-icon-blue', icon: '🏛️' },
      { badge: 'badge-icon-yellow', icon: '📜' },
      { badge: 'badge-icon-coral', icon: '🎓' },
      { badge: 'badge-icon-purple', icon: '💡' },
      { badge: 'badge-icon-green', icon: '🧠' },
      { badge: 'badge-icon-coral', icon: '⚖️' },
      { badge: 'badge-icon-purple', icon: '🛡️' },
      { badge: 'badge-icon-blue', icon: '👥' },
      { badge: 'badge-icon-yellow', icon: '🇬🇧' },
      { badge: 'badge-icon-green', icon: '💻' }
    ];

    container.innerHTML = '';

    AppState.categories.forEach((materia, idx) => {
      const qInMat = AppState.allQuestions.filter(q => q.materia === materia);
      const totalCount = qInMat.length;

      let answeredInMat = 0;
      let correctInMat = 0;
      qInMat.forEach(q => {
        const a = AppState.training.userAnswers[q.id];
        if (a) {
          answeredInMat++;
          if (a.isCorrect) correctInMat++;
        }
      });

      const rawPct = totalCount > 0 ? (answeredInMat / totalCount) * 100 : 0;
      const pctAnswered = Math.round(rawPct);
      const styleConfig = SUBJECT_STYLES[idx % SUBJECT_STYLES.length];
      const meta = SUBJECTS_META[materia] || { icon: styleConfig.icon };

      const row = document.createElement('div');
      row.className = 'modern-subject-row';
      row.dataset.materia = materia;
      row.innerHTML = `
        <div class="subject-icon-badge ${styleConfig.badge}">${meta.icon || styleConfig.icon}</div>
        <div class="subject-info-col">
          <div class="subject-title-line">
            <span class="subject-row-name">${materia}</span>
            <span class="subject-row-pct">${pctAnswered}%</span>
          </div>
          <div class="subject-progress-track">
            <div class="subject-progress-fill" style="width: ${pctAnswered}%;"></div>
          </div>
        </div>
        <span class="subject-row-chevron">›</span>
      `;

      row.addEventListener('click', () => {
        startTrainingOnTopic(materia, 'ALL');
      });

      container.appendChild(row);
    });
  }

  function populateMateriaFilters() {
    const selFilter = document.getElementById('filter-materia');
    const selRepo = document.getElementById('repo-filter-materia');

    if (selFilter) {
      const prevVal = selFilter.value;
      selFilter.innerHTML = `<option value="ALL">Tutte le materie (${AppState.allQuestions.length} quesiti)</option>`;
      AppState.categories.forEach(cat => {
        const count = AppState.allQuestions.filter(q => q.materia === cat).length;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat} (${count} quesiti)`;
        selFilter.appendChild(opt);
      });
      if (prevVal && AppState.categories.includes(prevVal)) {
        selFilter.value = prevVal;
      }
    }

    if (selRepo) {
      const prevValRepo = selRepo.value;
      selRepo.innerHTML = `<option value="ALL">Tutte le materie (${AppState.allQuestions.length})</option>`;
      AppState.categories.forEach(cat => {
        const count = AppState.allQuestions.filter(q => q.materia === cat).length;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat} (${count})`;
        selRepo.appendChild(opt);
      });
      if (prevValRepo && AppState.categories.includes(prevValRepo)) {
        selRepo.value = prevValRepo;
      }
    }
  }

  function renderExamDistribution() {
    const listEl = document.getElementById('exam-distrib-list');
    const titleEl = document.getElementById('exam-distrib-title');
    if (!listEl) return;

    const currentMode = AppState.simulationModes[AppState.currentSimulationMode];
    if (titleEl && currentMode) {
      titleEl.textContent = `Distribuzione Quesiti: ${currentMode.nome} (${currentMode.numero_domande || 30} Domande)`;
    }

    listEl.innerHTML = '';
    for (const [materia, count] of Object.entries(AppState.distribution)) {
      const item = document.createElement('div');
      item.className = 'distrib-item';
      item.innerHTML = `
        <span>${materia}</span>
        <span class="count-badge">${count} quesiti</span>
      `;
      listEl.appendChild(item);
    }
  }

  // =========================================================================
  // LOGICA MODALITÀ 1: ALLENAMENTO (TRAINING)
  // =========================================================================
  function populateArgomentiFilter() {
    const sel = document.getElementById('filter-argomento');
    if (!sel) return;

    const currentMateria = AppState.training.filterMateria;
    sel.innerHTML = '<option value="ALL">Tutti gli argomenti</option>';

    let availableTopics = [];
    if (currentMateria === 'ALL') {
      const allSet = new Set();
      Object.values(AppState.topicsByCategory).forEach(list => list.forEach(t => allSet.add(t)));
      availableTopics = Array.from(allSet).sort();
    } else {
      availableTopics = AppState.topicsByCategory[currentMateria] || [];
    }

    availableTopics.forEach(topic => {
      const opt = document.createElement('option');
      opt.value = topic;
      // Conta quesiti per questo argomento
      const count = AppState.allQuestions.filter(q => 
        (currentMateria === 'ALL' || q.materia === currentMateria) && q.argomento === topic
      ).length;
      opt.textContent = `${topic} (${count})`;
      sel.appendChild(opt);
    });

    sel.value = AppState.training.filterArgomento;
  }

  function applyTrainingFilters(preserveIndex = false) {
    const materia = AppState.training.filterMateria;
    const argomento = AppState.training.filterArgomento;
    const search = AppState.training.filterSearch.trim().toLowerCase();
    const status = AppState.training.filterStatus;

    let filtered = AppState.allQuestions.filter(q => {
      // Filtro Materia o Macro
      if (materia.startsWith('MACRO_')) {
        const macroKey = materia.replace('MACRO_', '');
        const macroInfo = MACRO_SUBJECTS[macroKey];
        if (macroInfo && !macroInfo.subjects.includes(q.materia)) return false;
      } else if (materia !== 'ALL' && q.materia !== materia) {
        return false;
      }

      // Filtro Argomento
      if (argomento !== 'ALL' && q.argomento !== argomento) return false;

      // Filtro Ricerca
      if (search) {
        const inDomanda = q.domanda.toLowerCase().includes(search);
        const inSpiegazione = q.spiegazione.toLowerCase().includes(search);
        const inOpzioni = Object.values(q.opzioni).some(opt => opt.toLowerCase().includes(search));
        if (!inDomanda && !inSpiegazione && !inOpzioni) return false;
      }

      // Filtro Stato (ALL, WRONG, BOOKMARKED, UNANSWERED)
      const userAns = AppState.training.userAnswers[q.id];
      if (status === 'WRONG') {
        if (!userAns || userAns.isCorrect) return false;
      } else if (status === 'BOOKMARKED') {
        if (!AppState.training.bookmarks.has(q.id)) return false;
      } else if (status === 'UNANSWERED') {
        if (userAns) return false;
      }

      return true;
    });

    if (AppState.settings.shuffleQuestions) {
      filtered = shuffleArray(filtered);
    }
    AppState.training.filteredList = filtered;
    if (preserveIndex) {
      if (AppState.training.currentIndex >= filtered.length) {
        AppState.training.currentIndex = 0;
      }
    } else {
      // Posiziona automaticamente al primo quesito non ancora svolto tra quelli filtrati
      if (status === 'WRONG') {
        const firstUnansweredRetry = filtered.findIndex(q => !AppState.training.retrySessionAnswers || !AppState.training.retrySessionAnswers[q.id]);
        AppState.training.currentIndex = (firstUnansweredRetry !== -1) ? firstUnansweredRetry : 0;
      } else {
        const firstUnansweredIndex = filtered.findIndex(q => !AppState.training.userAnswers[q.id]);
        AppState.training.currentIndex = (firstUnansweredIndex !== -1) ? firstUnansweredIndex : 0;
      }
    }

    // Aggiorna contatori laterali
    updateStatusPillCounts();
    updateFilterSummaryLabel();

    // Renderizza vista corrente
    if (AppState.training.viewMode === 'card') {
      renderTrainingCard();
    } else {
      renderTrainingList();
    }
  }

  function updateStatusPillCounts() {
    const materia = AppState.training.filterMateria;
    const argomento = AppState.training.filterArgomento;
    const search = AppState.training.filterSearch.trim().toLowerCase();

    // Base filtrata solo per materia/argomento/testo
    const baseList = AppState.allQuestions.filter(q => {
      if (materia.startsWith('MACRO_')) {
        const macroKey = materia.replace('MACRO_', '');
        const macroInfo = MACRO_SUBJECTS[macroKey];
        if (macroInfo && !macroInfo.subjects.includes(q.materia)) return false;
      } else if (materia !== 'ALL' && q.materia !== materia) {
        return false;
      }
      if (argomento !== 'ALL' && q.argomento !== argomento) return false;
      if (search) {
        const inDomanda = q.domanda.toLowerCase().includes(search);
        const inSpiegazione = q.spiegazione.toLowerCase().includes(search);
        if (!inDomanda && !inSpiegazione) return false;
      }
      return true;
    });

    let countAll = baseList.length;
    let countWrong = 0;
    let countBookmarked = 0;
    let countUnanswered = 0;

    baseList.forEach(q => {
      const ans = AppState.training.userAnswers[q.id];
      if (ans && !ans.isCorrect) countWrong++;
      if (AppState.training.bookmarks.has(q.id)) countBookmarked++;
      if (!ans) countUnanswered++;
    });

    const elAll = document.getElementById('count-all');
    const elWrong = document.getElementById('count-wrong');
    const elBm = document.getElementById('count-bookmarked');
    const elUn = document.getElementById('count-unanswered');

    if (elAll) elAll.textContent = countAll;
    if (elWrong) elWrong.textContent = countWrong;
    if (elBm) elBm.textContent = countBookmarked;
    if (elUn) elUn.textContent = countUnanswered;
  }

  function updateFilterSummaryLabel() {
    const el = document.getElementById('filter-summary-text');
    if (!el) return;
    const total = AppState.training.filteredList.length;
    el.innerHTML = `Visualizzati: <strong>${total} quesiti</strong>`;
  }

  function updateTrainingStatsMini() {
    let correct = 0;
    let wrong = 0;
    const totalAnswered = Object.keys(AppState.training.userAnswers).length;

    Object.values(AppState.training.userAnswers).forEach(ans => {
      if (ans.isCorrect) correct++;
      else wrong++;
    });

    const accuracy = totalAnswered > 0 ? Math.round((correct / totalAnswered) * 100) : 0;

    const elCorr = document.getElementById('stat-correct');
    const elWr = document.getElementById('stat-wrong');
    const elAcc = document.getElementById('stat-accuracy');
    const elProg = document.getElementById('stat-progress');

    if (elCorr) elCorr.textContent = correct;
    if (elWr) elWr.textContent = wrong;
    if (elAcc) elAcc.textContent = `${accuracy}%`;
    if (elProg) elProg.textContent = `${totalAnswered}/${AppState.allQuestions.length}`;

    // Aggiorna anche i contatori nella Home
    renderHomeDashboard();
  }

  // Stato contestuale per il foglio feedback istantaneo
  let currentFeedbackContext = { isExam: false, question: null };

  function showInstantFeedback(question, selectedOptOrLetter, isCorrect, isExam = false) {
    currentFeedbackContext = { isExam, question };

    const sheet = document.getElementById('instant-feedback-sheet');
    const card = document.getElementById('feedback-sheet-card');
    const title = document.getElementById('feedback-sheet-title');
    const subtitle = document.getElementById('feedback-sheet-subtitle');
    const icon = document.getElementById('feedback-sheet-icon');
    const correctBox = document.getElementById('feedback-correct-answer-box');
    const correctText = document.getElementById('feedback-correct-answer-text');
    const expText = document.getElementById('feedback-sheet-text');

    if (!sheet) return;

    // Recupera la corretta mappatura visuale delle opzioni a video
    const displayOpts = getDisplayOptions(question);
    const corrOpt = displayOpts.find(o => o.isCorrect);
    const correctDisplayLetter = corrOpt ? corrOpt.displayLetter : question.risposta_corretta;
    const correctTextStr = corrOpt ? corrOpt.text : (question.opzioni[question.risposta_corretta] || '');

    // Determina la lettera e il testo selezionati a video dall'utente
    let selDisplayLetter = '';
    let selTextStr = '';

    if (typeof selectedOptOrLetter === 'object' && selectedOptOrLetter !== null) {
      selDisplayLetter = selectedOptOrLetter.displayLetter || selectedOptOrLetter.origLetter;
      selTextStr = selectedOptOrLetter.text || '';
    } else if (typeof selectedOptOrLetter === 'string') {
      const matchOpt = displayOpts.find(o => o.displayLetter === selectedOptOrLetter) ||
                       displayOpts.find(o => o.origLetter === selectedOptOrLetter);
      if (matchOpt) {
        selDisplayLetter = matchOpt.displayLetter;
        selTextStr = matchOpt.text;
      } else {
        selDisplayLetter = selectedOptOrLetter;
        selTextStr = question.opzioni[selectedOptOrLetter] || '';
      }
    }

    const isReviewingWrong = (AppState.training && AppState.training.filterStatus === 'WRONG');

    if (isCorrect) {
      if (card) {
        card.className = 'modal-card feedback-sheet-card is-correct-sheet';
      }
      if (title) {
        title.innerHTML = isReviewingWrong ? 'ERRORE CORRETTO! BRAVO! 🎉' : 'ESATTO! RISPOSTA CORRETTA';
        title.style.color = 'var(--md-success)';
      }
      if (subtitle) {
        subtitle.innerHTML = isReviewingWrong
          ? `✨ Hai risolto l'errore selezionando l'opzione <strong>(${selDisplayLetter})</strong> (+1 punto recuperato)!`
          : `✨ Ottimo lavoro! Hai selezionato l'opzione <strong>(${selDisplayLetter})</strong> (+1 punto).`;
        subtitle.style.color = 'var(--md-success)';
      }
      if (icon) icon.textContent = '✅';
      if (correctBox) correctBox.style.display = 'none';
    } else {
      if (card) {
        card.className = 'modal-card feedback-sheet-card is-wrong-sheet';
      }
      if (title) {
        title.innerHTML = 'RISPOSTA ERRATA!';
        title.style.color = 'var(--md-error)';
      }
      if (subtitle) {
        const textSnippet = selTextStr ? ` — <em>"${escapeHtml(selTextStr)}"</em>` : '';
        subtitle.innerHTML = `Hai selezionato l'opzione <strong>(${selDisplayLetter})</strong>${textSnippet}: analizza l'errore per memorizzare:`;
        subtitle.style.color = 'var(--md-error)';
      }
      if (icon) icon.textContent = '❌';
      if (correctBox) {
        correctBox.style.display = 'block';
        if (correctText) {
          correctText.textContent = `(${correctDisplayLetter}) ${correctTextStr}`;
        }
      }
    }

    if (expText) {
      expText.innerHTML = question.spiegazione || 'Nessuna spiegazione disponibile per questo quesito.';
    }

    sheet.style.display = 'flex';
  }

  // Renderizza la scheda singola di allenamento (Fedele al Mockup 2)
  function renderTrainingCard(resetScroll = true) {
    if (resetScroll) {
      const mainWrap = document.querySelector('.main-wrapper');
      if (mainWrap) mainWrap.scrollTop = 0;
    }

    const container = document.getElementById('single-card-view');
    const listContainer = document.getElementById('list-view-container');
    if (container) container.style.display = 'block';
    if (listContainer) listContainer.style.display = 'none';

    const list = AppState.training.filteredList;
    const idx = AppState.training.currentIndex;

    if (list.length === 0) {
      document.getElementById('card-q-text').textContent = 'Nessun quesito corrisponde ai filtri selezionati. Prova a modificare i filtri o la ricerca.';
      document.getElementById('card-options-container').innerHTML = '';
      const expBox = document.getElementById('card-explanation-box');
      if (expBox) expBox.style.display = 'none';
      const hintBox = document.getElementById('card-select-hint-box');
      if (hintBox) hintBox.style.display = 'none';
      return;
    }

    const q = list[idx];
    if (!q) return;

    // Badges & metadata
    const elId = document.getElementById('card-q-id');
    const elMateria = document.getElementById('card-q-materia');
    const elArg = document.getElementById('card-q-argomento');
    const elBm = document.getElementById('btn-bookmark-current');

    if (elId) elId.textContent = `Quesito #${q.id}`;
    if (elMateria) {
      elMateria.textContent = q.materia;
      elMateria.className = `subject-pill-purple`;
    }
    const isReviewingWrong = (AppState.training.filterStatus === 'WRONG');
    let effectiveAnswer = AppState.training.userAnswers[q.id];
    if (isReviewingWrong) {
      effectiveAnswer = (AppState.training.retrySessionAnswers && AppState.training.retrySessionAnswers[q.id]) || null;
    }
    const isAnswered = !!effectiveAnswer;

    if (elArg) {
      if (isReviewingWrong && !isAnswered) {
        elArg.innerHTML = `${q.argomento || 'Generale'} <span style="background:rgba(239,68,68,0.15); color:var(--md-error); padding:2px 8px; border-radius:12px; font-weight:800; font-size:0.75rem; margin-left:6px;">🎯 Riprova errore</span>`;
      } else {
        elArg.textContent = q.argomento || 'Generale';
      }
    }

    if (elBm) {
      const isBm = AppState.training.bookmarks.has(q.id);
      elBm.classList.toggle('active', isBm);
      elBm.title = isBm ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    }

    // Aggiornamento Subheader Tracker Strip (Mockup 2)
    const liveNum = document.getElementById('count-live-num');
    const liveTotal = document.getElementById('count-live-total');
    const liveFill = document.getElementById('count-live-fill');
    const livePct = document.getElementById('count-live-pct');
    const liveCorr = document.getElementById('count-live-correct');
    const liveWrong = document.getElementById('count-live-wrong');

    const currNum = idx + 1;
    const totNum = list.length;
    const pctProg = Math.round((currNum / totNum) * 100);

    if (liveNum) liveNum.textContent = currNum;
    if (liveTotal) liveTotal.textContent = totNum;
    if (liveFill) liveFill.style.width = `${pctProg}%`;
    if (livePct) livePct.textContent = `${pctProg}%`;

    let sessionCorrect = 0;
    let sessionWrong = 0;
    list.forEach(item => {
      const ans = isReviewingWrong 
        ? (AppState.training.retrySessionAnswers && AppState.training.retrySessionAnswers[item.id])
        : AppState.training.userAnswers[item.id];
      if (ans) {
        if (ans.isCorrect) sessionCorrect++;
        else sessionWrong++;
      }
    });

    if (liveCorr) liveCorr.textContent = sessionCorrect;
    if (liveWrong) liveWrong.textContent = sessionWrong;

    // Testo Domanda
    document.getElementById('card-q-text').textContent = q.domanda;

    // Opzioni di Risposta Moderne (Mockup 2: A, B, C, D in pillola morbida)
    const optContainer = document.getElementById('card-options-container');
    optContainer.innerHTML = '';

    const displayOptions = getDisplayOptions(q);

    displayOptions.forEach((opt, optIdx) => {
      const letter = opt.displayLetter;
      const optText = opt.text;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modern-option-button';
      btn.dataset.letter = letter;

      let tagHtml = '';

      if (isAnswered) {
        btn.disabled = true;
        if (opt.isCorrect) {
          btn.classList.add('is-correct');
          tagHtml = '<span class="modern-opt-tag">✔️ Risposta corretta</span>';
        } else if (letter === effectiveAnswer.selectedDisplayLetter || opt.origLetter === effectiveAnswer.selectedOption) {
          btn.classList.add('is-incorrect');
          tagHtml = '<span class="modern-opt-tag">❌ La tua risposta</span>';
        } else {
          btn.classList.add('is-dimmed');
        }
      }

      btn.innerHTML = `
        <div class="modern-opt-letter">${letter}</div>
        <div class="modern-opt-text">${escapeHtml(optText)}</div>
        ${tagHtml}
      `;

      if (!isAnswered) {
        btn.addEventListener('click', () => {
          Haptic.tap();
          handleTrainingAnswer(q, opt);
        });
      }

      optContainer.appendChild(btn);
    });

    // Box Promemoria prima della risposta
    const hintBox = document.getElementById('card-select-hint-box');
    if (hintBox) {
      hintBox.style.display = isAnswered ? 'none' : 'flex';
    }

    // Box Spiegazione Inline Integrata (Fedele a Mockup 2: Sotto le opzioni, non invasiva)
    const expBox = document.getElementById('card-explanation-box');
    const badgeIcon = document.getElementById('feedback-badge-icon');
    const titleEl = document.getElementById('feedback-sheet-title');
    const selLine = document.getElementById('feedback-sel-line');
    const corrLine = document.getElementById('feedback-corr-line');
    const expText = document.getElementById('card-explanation-text');
    const normText = document.getElementById('card-normative-text');

    if (isAnswered && expBox) {
      expBox.style.display = 'block';
      const isCorr = effectiveAnswer.isCorrect;

      expBox.className = `modern-inline-feedback-card ${isCorr ? 'is-success-box' : 'is-error-box'}`;
      if (badgeIcon) badgeIcon.textContent = isCorr ? '✔️' : '❌';
      if (titleEl) {
        titleEl.textContent = isCorr ? 'Risposta esatta!' : 'Risposta errata!';
        titleEl.style.color = isCorr ? '#15803d' : '#b91c1c';
      }

      const corrOpt = displayOptions.find(o => o.isCorrect);
      const userOpt = displayOptions.find(o => o.displayLetter === effectiveAnswer.selectedDisplayLetter || o.origLetter === effectiveAnswer.selectedOption);

      if (selLine) {
        if (isCorr) {
          selLine.style.display = 'none';
        } else {
          selLine.style.display = 'block';
          selLine.textContent = `Hai selezionato l'opzione ${userOpt ? userOpt.displayLetter : effectiveAnswer.selectedOption}: ${userOpt ? userOpt.text : ''}`;
        }
      }

      if (corrLine) {
        corrLine.textContent = `Risposta corretta: ${corrOpt ? corrOpt.displayLetter : q.risposta_corretta} — ${corrOpt ? corrOpt.text : ''}`;
      }

      if (expText) {
        expText.innerHTML = q.spiegazione || 'Nessuna spiegazione disponibile per questo quesito.';
      }

      if (normText) {
        normText.textContent = q.normativa_riferimento || q.materia;
      }
    } else if (expBox) {
      expBox.style.display = 'none';
    }

    // Paginatore Numerico Dinamico (Mockup 2: ... 16 17 [18] 19 20 ...)
    const pagTrack = document.getElementById('training-pagination-pills');
    if (pagTrack) {
      pagTrack.innerHTML = '';
      const totalPills = list.length;
      const currentNum = idx + 1;

      const windowSize = 2; // mostra 2 prima e 2 dopo
      let start = Math.max(1, currentNum - windowSize);
      let end = Math.min(totalPills, currentNum + windowSize);

      if (currentNum <= 3) end = Math.min(totalPills, 5);
      if (currentNum >= totalPills - 2) start = Math.max(1, totalPills - 4);

      if (start > 1) {
        const ell = document.createElement('span');
        ell.className = 'pag-ellipsis';
        ell.textContent = '...';
        pagTrack.appendChild(ell);
      }

      for (let p = start; p <= end; p++) {
        const pillBtn = document.createElement('button');
        pillBtn.type = 'button';
        pillBtn.className = `pag-pill${p === currentNum ? ' active' : ''}`;

        const qItem = list[p - 1];
        if (qItem && AppState.training.userAnswers[qItem.id]) {
          pillBtn.classList.add('is-answered');
        }

        pillBtn.textContent = p;
        pillBtn.addEventListener('click', () => {
          AppState.training.currentIndex = p - 1;
          renderTrainingCard();
        });
        pagTrack.appendChild(pillBtn);
      }

      if (end < totalPills) {
        const ell = document.createElement('span');
        ell.className = 'pag-ellipsis';
        ell.textContent = '...';
        pagTrack.appendChild(ell);
      }
    }

    // Abilita/Disabilita tasti navigazione
    const prevBtn = document.getElementById('btn-card-prev');
    if (prevBtn) prevBtn.disabled = (idx === 0);

    const nextBtn = document.getElementById('btn-card-next');
    if (nextBtn) {
      if (idx >= list.length - 1) {
        nextBtn.innerHTML = '<span>🏁 Fine Modulo</span>';
        nextBtn.classList.add('btn-gold');
      } else {
        nextBtn.innerHTML = '<span>Prossima domanda →</span>';
        nextBtn.classList.remove('btn-gold');
      }
    }

    // Aggiorna la barra di progresso e lo stato dei bottoni navigazione
    updateModuleProgressBar();
    // Salva sessione attiva per consentire la ripresa automatica
    Storage.saveTrainingSession();
  }

  function handleTrainingAnswer(question, selectedOpt) {
    try {
      const isCorrect = (typeof selectedOpt === 'object') ? selectedOpt.isCorrect : (selectedOpt === question.risposta_corretta);
      const selectedLetter = (typeof selectedOpt === 'object') ? selectedOpt.origLetter : selectedOpt;
      const selectedDisplayLetter = (typeof selectedOpt === 'object') ? selectedOpt.displayLetter : selectedOpt;
      const isReviewingWrong = (AppState.training.filterStatus === 'WRONG');

      if (!AppState.training.retrySessionAnswers) {
        AppState.training.retrySessionAnswers = {};
      }
      if (isReviewingWrong) {
        AppState.training.retrySessionAnswers[question.id] = {
          selectedOption: selectedLetter,
          selectedDisplayLetter: selectedDisplayLetter,
          isCorrect: isCorrect,
          timestamp: Date.now()
        };
      }

      AppState.training.userAnswers[question.id] = {
        selectedOption: selectedLetter,
        selectedDisplayLetter: selectedDisplayLetter,
        isCorrect: isCorrect,
        timestamp: Date.now()
      };

      // Registrazione "Al Primo Colpo"
      if (!AppState.firstTryRecords[question.id]) {
        AppState.firstTryRecords[question.id] = {
          isCorrect: isCorrect,
          timestamp: Date.now()
        };
        Storage.saveFirstTryRecords();
      }

      Storage.saveTrainingAnswers();
      Storage.saveTrainingSession();

      // Audio & Haptic Feedback
      if (isCorrect) {
        Haptic.success();
        try { SoundFx.playCorrect(); } catch (e) {}
      } else {
        Haptic.error();
        try { SoundFx.playWrong(); } catch (e) {}
      }

      // Re-render immediato della card con feedback inline e animazioni
      renderTrainingCard(false);

      // Aggiorna progress bar e conteggi
      updateModuleProgressBar();
      updateTrainingStatsMini();
      updateStatusPillCounts();
    } catch (err) {
      console.error('Errore in handleTrainingAnswer:', err);
    }
  }

  // Renderizza la vista elenco di allenamento
  function renderTrainingList() {
    const cardContainer = document.getElementById('single-card-view');
    const listContainer = document.getElementById('list-view-container');
    if (cardContainer) cardContainer.style.display = 'none';
    if (listContainer) listContainer.style.display = 'block';

    const fullList = document.getElementById('full-questions-list');
    fullList.innerHTML = '';

    const list = AppState.training.filteredList;
    if (list.length === 0) {
      fullList.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted); background:var(--bg-surface); border-radius:var(--radius-lg);">Nessun quesito corrisponde ai filtri selezionati.</div>';
      return;
    }

    list.forEach((q, idx) => {
      const card = document.createElement('article');
      card.className = 'question-card';
      card.id = `q-list-${q.id}`;

      const isReviewingWrong = (AppState.training.filterStatus === 'WRONG');
      let effectiveAnswer = AppState.training.userAnswers[q.id];
      if (isReviewingWrong) {
        effectiveAnswer = (AppState.training.retrySessionAnswers && AppState.training.retrySessionAnswers[q.id]) || null;
      }
      const isAnswered = !!effectiveAnswer;

      const displayOpts = getDisplayOptions(q);
      let optionsHtml = '';

      displayOpts.forEach(opt => {
        const letter = opt.displayLetter;
        const text = opt.text;

        let extraClass = '';
        let badgeHtml = '';

        if (isAnswered) {
          extraClass = 'disabled ';
          if (opt.isCorrect) {
            extraClass += 'correct ';
            badgeHtml = '<span class="option-status-icon" style="color:var(--success-badge)">✔️ Esatta</span>';
          } else if (letter === effectiveAnswer.selectedDisplayLetter || opt.origLetter === effectiveAnswer.selectedOption) {
            extraClass += 'incorrect ';
            badgeHtml = '<span class="option-status-icon" style="color:var(--danger-badge)">❌ Scelta</span>';
          }
        }

        optionsHtml += `
          <div class="option-item ${extraClass}" data-qid="${q.id}" data-letter="${letter}">
            <div class="option-letter">${letter}</div>
            <div class="option-text">${text}</div>
            ${badgeHtml}
          </div>
        `;
      });

      let expHtml = '';
      if (isAnswered) {
        const alertClass = effectiveAnswer.isCorrect ? 'is-success-alert' : 'is-error-alert';
        const badgeClass = effectiveAnswer.isCorrect ? 'succ' : 'err';
        const badgeTxt = effectiveAnswer.isCorrect ? (isReviewingWrong ? 'Errore Corretto!' : 'Esatto!') : 'Risposta Errata';
        const icon = effectiveAnswer.isCorrect ? '✅' : '❌';

        expHtml = `
          <div class="explanation-card ${alertClass}" style="display:block;">
            <div class="explanation-header">
              <div class="explanation-title">
                <span>${icon}</span>
                <span>Spiegazione e Riferimento Normativo</span>
              </div>
              <span class="explanation-badge ${badgeClass}">${badgeTxt}</span>
            </div>
            <div class="explanation-body">${q.spiegazione}</div>
          </div>
        `;
      }

      const isBm = AppState.training.bookmarks.has(q.id);

      card.innerHTML = `
        <div class="question-header">
          <div class="question-meta">
            <span class="badge badge-id">#${idx + 1} (ID ${q.id})</span>
            <span class="badge ${getBadgeClass(q.materia)}">${q.materia}</span>
            <span class="badge" style="background:var(--bg-surface-subtle); color:var(--text-muted); border:1px solid var(--border-subtle);">${q.argomento}</span>
          </div>
          <button class="bookmark-btn ${isBm ? 'active' : ''}" data-bm-id="${q.id}" title="Preferito">⭐</button>
        </div>
        <h3 class="question-text" style="font-size:1.05rem; margin-bottom:1rem;">${q.domanda}</h3>
        <div class="options-list">${optionsHtml}</div>
        ${expHtml}
      `;

      // Event listeners per opzioni
      if (!isAnswered) {
        card.querySelectorAll('.option-item').forEach(optEl => {
          optEl.addEventListener('click', () => {
            const letter = optEl.dataset.letter;
            const chosenOpt = displayOpts.find(o => o.displayLetter === letter) || letter;
            handleTrainingAnswer(q, chosenOpt);
            renderTrainingList();
          });
        });
      }

      // Segnalibro
      const bmBtn = card.querySelector(`[data-bm-id="${q.id}"]`);
      if (bmBtn) {
        bmBtn.addEventListener('click', () => {
          toggleBookmark(q.id);
          renderTrainingList();
        });
      }

      fullList.appendChild(card);
    });
  }

  function toggleBookmark(questionId) {
    if (AppState.training.bookmarks.has(questionId)) {
      AppState.training.bookmarks.delete(questionId);
      showToast('Rimosso dai preferiti', '⭐');
    } else {
      AppState.training.bookmarks.add(questionId);
      showToast('Aggiunto a "Da ripassare"', '⭐');
    }
    Storage.saveBookmarks();
    updateStatusPillCounts();
    if (AppState.training.viewMode === 'card') {
      renderTrainingCard();
    }
  }

  // =========================================================================
  // LOGICA MODALITÀ 2: SIMULAZIONE D'ESAME (30 QUESITI SECONDO DISTRIBUZIONE)
  // =========================================================================

  /**
   * Genera 30 quesiti secondo la ripartizione prescritta nel JSON:
   * - 8 Statuto UniSS
   * - 7 Regolamento UniSS
   * - 4 Legislazione universitaria
   * - 5 Quiz situazionali
   * - 6 Logica
   * Totale = 30
   */
  function generateExamQuestions() {
    const selected = [];
    const dist = AppState.distribution;

    for (const [materia, countNeeded] of Object.entries(dist)) {
      const pool = AppState.allQuestions.filter(q => q.materia === materia);
      const shuffled = shuffleArray(pool);
      const chosen = shuffled.slice(0, countNeeded);
      selected.push(...chosen);
    }

    // Mescola le 30 domande per simulare la prova d'esame reale
    return shuffleArray(selected);
  }

  function startExam() {
    const timerMins = parseInt(document.getElementById('exam-timer-select').value, 10);
    const questions = generateExamQuestions();

    if (questions.length !== AppState.totalExamQuestions) {
      console.warn(`Attesi ${AppState.totalExamQuestions} quesiti, estratti ${questions.length}`);
    }

    AppState.exam = {
      isActive: true,
      isFinished: false,
      questions: questions,
      userAnswers: new Array(questions.length).fill(null),
      currentIndex: 0,
      totalSeconds: timerMins * 60,
      remainingSeconds: timerMins * 60,
      timerInterval: null,
      startTime: Date.now(),
      endTime: null
    };

    // UI Switches
    document.getElementById('exam-intro-screen').style.display = 'none';
    document.getElementById('exam-active-screen').style.display = 'block';
    document.getElementById('exam-results-screen').style.display = 'none';

    // Avvia Timer
    startExamTimer();

    // Renderizza griglia navigazione e prima domanda
    renderExamNavigatorGrid();
    renderExamQuestion(0);
    updateExamStickyBar();

    showToast('Simulazione iniziata! In bocca al lupo!', '🚀');
  }

  function startExamTimer() {
    if (AppState.exam.totalSeconds === 0) {
      // Senza timer
      document.getElementById('timer-text').textContent = 'Illimitato';
      return;
    }

    clearInterval(AppState.exam.timerInterval);
    updateTimerDisplay();

    AppState.exam.timerInterval = setInterval(() => {
      AppState.exam.remainingSeconds--;
      updateTimerDisplay();

      if (AppState.exam.remainingSeconds <= 0) {
        clearInterval(AppState.exam.timerInterval);
        showToast('Tempo scaduto! Consegna automatica della prova.', '⏱️');
        finishExam();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const textEl = document.getElementById('timer-text');
    const boxEl = document.getElementById('exam-timer-display');
    if (!textEl || !boxEl) return;

    if (AppState.exam.totalSeconds === 0) {
      textEl.textContent = 'Illimitato';
      return;
    }

    const rem = AppState.exam.remainingSeconds;
    textEl.textContent = formatTime(rem);

    boxEl.classList.remove('warning', 'danger');
    if (rem <= 180) { // Meno di 3 minuti
      boxEl.classList.add('danger');
    } else if (rem <= 600) { // Meno di 10 minuti
      boxEl.classList.add('warning');
    }
  }

  function renderExamNavigatorGrid() {
    const grid = document.getElementById('exam-nav-grid');
    if (!grid) return;
    grid.innerHTML = '';

    AppState.exam.questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = 'nav-number-btn';
      btn.textContent = idx + 1;
      btn.dataset.idx = idx;

      // Classi di stato
      const ans = AppState.exam.userAnswers[idx];
      if (ans) {
        if (ans.isCorrect) btn.classList.add('answered-correct');
        else btn.classList.add('answered-incorrect');
      }

      if (idx === AppState.exam.currentIndex) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        renderExamQuestion(idx);
      });

      grid.appendChild(btn);
    });

    updateExamStickyBar();
  }

  function updateExamStickyBar() {
    const total = AppState.exam.questions.length;
    const current = AppState.exam.currentIndex + 1;

    let correctCount = 0;
    let wrongCount = 0;
    let answeredCount = 0;

    AppState.exam.userAnswers.forEach(ans => {
      if (ans) {
        answeredCount++;
        if (ans.isCorrect) correctCount++;
        else wrongCount++;
      }
    });

    const elIdx = document.getElementById('exam-current-idx-text');
    const elCorr = document.getElementById('exam-live-correct');
    const elWr = document.getElementById('exam-live-wrong');
    const elNavSum = document.getElementById('exam-nav-answered-summary');

    if (elIdx) elIdx.textContent = `${current} / ${total}`;
    if (elCorr) elCorr.textContent = correctCount;
    if (elWr) elWr.textContent = wrongCount;
    if (elNavSum) elNavSum.textContent = `${answeredCount} / ${total} risposte`;
  }

  function renderExamQuestion(index, resetScroll = true) {
    if (index < 0 || index >= AppState.exam.questions.length) return;
    AppState.exam.currentIndex = index;

    // Resetta scroll in cima solo su cambio effettivo di domanda
    if (resetScroll) {
      const mainWrap = document.querySelector('.main-wrapper');
      if (mainWrap) mainWrap.scrollTop = 0;
    }
    const gridSheet = document.getElementById('exam-grid-sheet');
    if (gridSheet) gridSheet.style.display = 'none';

    const q = AppState.exam.questions[index];
    const savedAns = AppState.exam.userAnswers[index];
    const isAnswered = !!savedAns;

    // Badges & meta
    document.getElementById('exam-q-number').textContent = `Domanda ${index + 1} di ${AppState.exam.questions.length}`;
    const elMateria = document.getElementById('exam-q-materia');
    elMateria.textContent = q.materia;
    elMateria.className = `badge ${getBadgeClass(q.materia)}`;
    document.getElementById('exam-q-argomento').textContent = q.argomento;

    // Testo Domanda
    document.getElementById('exam-q-text').textContent = q.domanda;

    // Opzioni
    const optContainer = document.getElementById('exam-options-container');
    optContainer.innerHTML = '';

    const displayOptions = getDisplayOptions(q);

    displayOptions.forEach((opt, optIdx) => {
      const letter = opt.displayLetter;
      const optText = opt.text;
      const keyHint = optIdx + 1;

      const btn = document.createElement('div');
      btn.className = 'option-item';
      btn.dataset.letter = letter;

      let iconHtml = '';

      if (isAnswered) {
        btn.classList.add('disabled');
        if (opt.isCorrect) {
          btn.classList.add('correct');
          iconHtml = '<span class="option-status-icon" style="color:var(--success-badge)">✔️ Esatta</span>';
        } else if (letter === savedAns.selectedDisplayLetter || opt.origLetter === savedAns.selectedOption) {
          btn.classList.add('incorrect');
          iconHtml = '<span class="option-status-icon" style="color:var(--danger-badge)">❌ Tua Risposta Errata</span>';
        }
      }

      btn.innerHTML = `
        <div class="option-letter">${letter}</div>
        <div class="option-text">${optText}</div>
        <span class="desktop-kbd-hint" title="Premi tasto ${keyHint} o ${letter}">[${keyHint}]</span>
        ${iconHtml}
      `;

      if (!isAnswered) {
        btn.addEventListener('click', () => handleExamAnswer(index, q, opt));
      }

      optContainer.appendChild(btn);
    });

    // Box spiegazione:
    // "e visualizzazione immediata della spiegazione ogni volta che sbaglio una risposta."
    const expBox = document.getElementById('exam-explanation-box');
    const expTitle = document.getElementById('exam-explanation-title');
    const expBadge = document.getElementById('exam-explanation-status-badge');
    const expText = document.getElementById('exam-explanation-text');

    if (isAnswered) {
      expBox.style.display = 'block';
      expText.innerHTML = q.spiegazione;

      if (!savedAns.isCorrect) {
        // Errore: Massima evidenza come richiesto esplicitamente!
        expBox.className = 'explanation-card is-error-alert';
        expTitle.innerHTML = '<span>❌</span> <span>RISPOSTA ERRATA — Spiegazione Immediata:</span>';
        expBadge.className = 'explanation-badge err';
        expBadge.textContent = '0 / 1 Punti';
      } else {
        // Corretta: Feedback positivo con spiegazione consultabile
        expBox.className = 'explanation-card is-success-alert';
        expTitle.innerHTML = '<span>✅</span> <span>RISPOSTA ESATTA (+1 Punto) — Riferimento:</span>';
        expBadge.className = 'explanation-badge succ';
        expBadge.textContent = '1 / 1 Punti';
      }
    } else {
      expBox.style.display = 'none';
    }

    // Footer
    document.getElementById('exam-bottom-counter').textContent = `Quesito ${index + 1} di ${AppState.exam.questions.length}`;
    document.getElementById('btn-exam-prev').disabled = (index === 0);
    document.getElementById('btn-exam-next').disabled = (index === AppState.exam.questions.length - 1);

    // Evidenzia numero attivo nella griglia
    document.querySelectorAll('.nav-number-btn').forEach((btn, idx) => {
      btn.classList.toggle('active', idx === index);
    });
  }

  /**
   * Gestione risposta cliccata durante l'esame:
   * Se sbagliata -> rivela SUBITO la spiegazione dettagliata e il riferimento normativo!
   */
  function handleExamAnswer(index, question, selectedOpt) {
    const isCorrect = (typeof selectedOpt === 'object') ? selectedOpt.isCorrect : (selectedOpt === question.risposta_corretta);
    const selectedLetter = (typeof selectedOpt === 'object') ? selectedOpt.origLetter : selectedOpt;
    const selectedDisplayLetter = (typeof selectedOpt === 'object') ? selectedOpt.displayLetter : selectedOpt;

    AppState.exam.userAnswers[index] = {
      questionId: question.id,
      selectedOption: selectedLetter,
      selectedDisplayLetter: selectedDisplayLetter,
      isCorrect: isCorrect,
      timestamp: Date.now()
    };

    if (isCorrect) {
      SoundFx.playCorrect();
      showToast('Risposta Corretta! (+1 pt)', '✅');
    } else {
      SoundFx.playWrong();
      showToast('Risposta Errata! Leggi la spiegazione sotto.', '⚠️');
    }

    // Aggiorna navigatore e ri-renderizza domanda per mostrare spiegazione immediata
    renderExamNavigatorGrid();
    renderExamQuestion(index, false);

    // Mostra spiegazione istantanea nel foglio a scorrimento
    if (AppState.settings.autoExplain) {
      showInstantFeedback(question, selectedOpt, isCorrect, true);
    }
  }

  function finishExam() {
    clearInterval(AppState.exam.timerInterval);
    AppState.exam.isActive = false;
    AppState.exam.isFinished = true;
    AppState.exam.endTime = Date.now();

    // Calcolo Punteggio e Risultati
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const subjectStats = {};
    Object.keys(AppState.distribution).forEach(mat => {
      subjectStats[mat] = { correct: 0, total: AppState.distribution[mat] };
    });

    AppState.exam.questions.forEach((q, idx) => {
      const ans = AppState.exam.userAnswers[idx];
      if (!ans) {
        unansweredCount++;
      } else if (ans.isCorrect) {
        correctCount++;
        if (subjectStats[q.materia]) subjectStats[q.materia].correct++;
      } else {
        wrongCount++;
      }
    });

    const finalScore = correctCount; // 1 punto a domanda = voto su 30
    const isPassed = (finalScore >= AppState.passingScore);

    const timeSpentSec = Math.round((AppState.exam.endTime - AppState.exam.startTime) / 1000);

    // Salva nello storico
    const attemptRecord = {
      id: Date.now(),
      date: new Date().toLocaleString('it-IT'),
      score: finalScore,
      isPassed: isPassed,
      correctCount: correctCount,
      wrongCount: wrongCount,
      unansweredCount: unansweredCount,
      durationSeconds: timeSpentSec,
      subjectBreakdown: subjectStats
    };

    AppState.history.unshift(attemptRecord);
    Storage.saveExamHistory();

    // Renderizza Schermata Risultati
    renderExamResults(attemptRecord);

    // Cambia schermata
    document.getElementById('exam-active-screen').style.display = 'none';
    document.getElementById('exam-results-screen').style.display = 'block';

    if (isPassed) {
      SoundFx.playCorrect();
      showToast(`PROVA SUPERATA con ${finalScore}/30! Complimenti!`, '🎉');
    } else {
      SoundFx.playWrong();
      showToast(`Prova non superata (${finalScore}/30). Continua ad allenarti!`, '📚');
    }
  }

  function renderExamResults(record) {
    const heroCard = document.getElementById('results-hero');
    const pill = document.getElementById('outcome-pill');
    const scoreVal = document.getElementById('final-score-val');

    if (record.isPassed) {
      heroCard.className = 'results-hero-card passed';
      pill.className = 'outcome-badge-pill passed';
      pill.innerHTML = '<span>🎉</span> <span>PROVA SUPERATA — CANDIDATO IDONEO</span>';
      scoreVal.className = 'score-number passed';
    } else {
      heroCard.className = 'results-hero-card failed';
      pill.className = 'outcome-badge-pill failed';
      pill.innerHTML = '<span>⚠️</span> <span>PROVA NON SUPERATA — NON IDONEO</span>';
      scoreVal.className = 'score-number failed';
    }

    scoreVal.textContent = record.score;

    document.getElementById('kpi-correct').textContent = record.correctCount;
    document.getElementById('kpi-wrong').textContent = record.wrongCount;
    document.getElementById('kpi-unanswered').textContent = record.unansweredCount;
    document.getElementById('kpi-time-spent').textContent = formatTime(record.durationSeconds);

    // Ripartizione per Materia
    const breakdownContainer = document.getElementById('subject-breakdown-container');
    breakdownContainer.innerHTML = '';

    Object.entries(record.subjectBreakdown).forEach(([mat, data]) => {
      const pct = Math.round((data.correct / data.total) * 100);
      let color = 'var(--uniss-blue-500)';
      if (pct >= 70) color = 'var(--success-badge)';
      else if (pct < 50) color = 'var(--danger-badge)';

      const row = document.createElement('div');
      row.className = 'subject-bar-row';
      row.innerHTML = `
        <div class="subject-bar-labels">
          <span>${mat}</span>
          <span><strong>${data.correct} / ${data.total}</strong> (${pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
      `;
      breakdownContainer.appendChild(row);
    });

    // Revisione dei 30 quesiti
    renderReviewQuestions('ALL');
  }

  function renderReviewQuestions(filterMode = 'ALL') {
    const listContainer = document.getElementById('review-cards-list');
    listContainer.innerHTML = '';

    // Aggiorna pulsanti tab filtro
    document.querySelectorAll('.review-filter-tabs button').forEach(btn => btn.classList.remove('active'));
    if (filterMode === 'ALL') document.getElementById('btn-review-all').classList.add('active');
    if (filterMode === 'WRONG') document.getElementById('btn-review-wrong').classList.add('active');
    if (filterMode === 'CORRECT') document.getElementById('btn-review-correct').classList.add('active');

    AppState.exam.questions.forEach((q, idx) => {
      const ans = AppState.exam.userAnswers[idx];
      const isCorrect = ans && ans.isCorrect;
      const isWrong = ans && !ans.isCorrect;
      const isUnanswered = !ans;

      if (filterMode === 'WRONG' && !isWrong && !isUnanswered) return;
      if (filterMode === 'CORRECT' && !isCorrect) return;

      const card = document.createElement('div');
      card.className = `review-card ${isCorrect ? 'review-correct' : 'review-incorrect'}`;

      let statusBadge = '';
      if (isCorrect) {
        statusBadge = '<span class="badge" style="background:var(--success-bg); color:var(--success-badge); font-weight:700;">✔️ Risposta Corretta (+1 pt)</span>';
      } else if (isWrong) {
        statusBadge = '<span class="badge" style="background:var(--danger-bg); color:var(--danger-badge); font-weight:700;">❌ Risposta Errata (0 pt)</span>';
      } else {
        statusBadge = '<span class="badge" style="background:var(--bg-surface-subtle); color:var(--text-muted);">⚪ Non Risposta (0 pt)</span>';
      }

      const displayOpts = getDisplayOptions(q);
      const corrOpt = displayOpts.find(o => o.isCorrect);
      const corrLetter = corrOpt ? corrOpt.displayLetter : q.risposta_corretta;
      const corrText = corrOpt ? corrOpt.text : (q.opzioni[q.risposta_corretta] || '');

      let userAnsHtml = 'Nessuna risposta data';
      if (ans) {
        const userLetter = ans.selectedDisplayLetter || ans.selectedOption;
        const userOpt = displayOpts.find(o => o.displayLetter === userLetter) || displayOpts.find(o => o.origLetter === ans.selectedOption);
        const userText = userOpt ? userOpt.text : (q.opzioni[ans.selectedOption] || '');
        userAnsHtml = `(${userLetter}) ${escapeHtml(userText)}`;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <span class="badge badge-id">Domanda #${idx + 1}</span>
            <span class="badge ${getBadgeClass(q.materia)}">${q.materia}</span>
            <span class="badge" style="background:var(--bg-surface-subtle); color:var(--text-muted);">${q.argomento}</span>
          </div>
          <div>${statusBadge}</div>
        </div>

        <p style="font-weight:600; font-size:1rem; margin-bottom:0.75rem;">${escapeHtml(q.domanda)}</p>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:0.75rem; font-size:0.875rem;">
          <div style="padding:0.5rem 0.75rem; border-radius:var(--radius-sm); background:${isCorrect ? 'var(--success-bg)' : (ans ? 'var(--danger-bg)' : 'var(--bg-surface-subtle)')};">
            <strong>Tua risposta:</strong> ${userAnsHtml}
          </div>
          <div style="padding:0.5rem 0.75rem; border-radius:var(--radius-sm); background:var(--success-bg);">
            <strong style="color:var(--success-badge);">Risposta corretta:</strong> (${corrLetter}) ${escapeHtml(corrText)}
          </div>
        </div>

        <div class="explanation-card" style="display:block; margin-top:0.5rem; padding:0.75rem 1rem;">
          <div style="font-weight:700; font-size:0.85rem; margin-bottom:0.25rem;">📖 Spiegazione:</div>
          <div style="font-size:0.875rem; line-height:1.5;">${q.spiegazione}</div>
        </div>
      `;

      listContainer.appendChild(card);
    });
  }

  // =========================================================================
  // LOGICA MODALITÀ 3: BANCA DATI INTEGRALE (REPOSITORY 112 QUESITI)
  // =========================================================================
  function renderRepository() {
    const container = document.getElementById('repo-cards-container');
    if (!container) return;

    const filterMateria = document.getElementById('repo-filter-materia').value;
    const search = document.getElementById('repo-search-input').value.trim().toLowerCase();

    const filtered = AppState.allQuestions.filter(q => {
      if (filterMateria !== 'ALL' && q.materia !== filterMateria) return false;
      if (search) {
        const inDomanda = q.domanda.toLowerCase().includes(search);
        const inSpiegazione = q.spiegazione.toLowerCase().includes(search);
        const inOpzioni = Object.values(q.opzioni).some(opt => opt.toLowerCase().includes(search));
        if (!inDomanda && !inSpiegazione && !inOpzioni) return false;
      }
      return true;
    });

    document.getElementById('repo-count-label').textContent = `${filtered.length} quesiti visibili`;
    container.innerHTML = '';

    filtered.forEach(q => {
      const card = document.createElement('article');
      card.className = 'question-card repo-item-card';

      const letters = ['A', 'B', 'C', 'D'];
      let optsHtml = '';
      letters.forEach(l => {
        const isRight = (l === q.risposta_corretta);
        optsHtml += `
          <div style="padding:0.4rem 0.6rem; border-radius:var(--radius-sm); margin-bottom:4px; font-size:0.875rem; display:flex; gap:0.5rem; background:${isRight ? 'var(--success-bg)' : 'transparent'}; border:${isRight ? '1px solid var(--success-border)' : '1px solid transparent'};">
            <strong style="color:${isRight ? 'var(--success-badge)' : 'inherit'}">${l})</strong>
            <span>${q.opzioni[l]} ${isRight ? '✔️' : ''}</span>
          </div>
        `;
      });

      card.innerHTML = `
        <div class="question-header" style="margin-bottom:0.75rem;">
          <div class="question-meta">
            <span class="badge badge-id">ID #${q.id}</span>
            <span class="badge ${getBadgeClass(q.materia)}">${q.materia}</span>
            <span class="badge" style="background:var(--bg-surface-subtle); color:var(--text-muted);">${q.argomento}</span>
          </div>
        </div>
        <p style="font-weight:700; font-size:1.02rem; margin-bottom:0.75rem;">${q.domanda}</p>
        <div style="margin-bottom:0.75rem;">${optsHtml}</div>
        <details class="repo-details" style="font-size:0.875rem; background:var(--bg-surface-subtle); padding:0.6rem 0.85rem; border-radius:var(--radius-md);">
          <summary style="font-weight:700; cursor:pointer; color:var(--uniss-navy-700);">💡 Mostra Spiegazione e Riferimenti Normativi</summary>
          <div style="margin-top:0.5rem; line-height:1.5;">${q.spiegazione}</div>
        </details>
      `;

      container.appendChild(card);
    });
  }

  // =========================================================================
  // LOGICA MODALITÀ 4: STATISTICHE E STORICO
  // =========================================================================
  function renderStatisticsView() {
    const totalSims = AppState.history.length;
    let passedCount = 0;
    let sumScore = 0;
    let bestScore = 0;

    AppState.history.forEach(h => {
      if (h.isPassed) passedCount++;
      sumScore += h.score;
      if (h.score > bestScore) bestScore = h.score;
    });

    const passRate = totalSims > 0 ? Math.round((passedCount / totalSims) * 100) : 0;
    const avgScore = totalSims > 0 ? (sumScore / totalSims).toFixed(1) : 0;

    const elTot = document.getElementById('stats-total-sims');
    const elRate = document.getElementById('stats-pass-rate');
    const elAvg = document.getElementById('stats-avg-score');
    const elBest = document.getElementById('stats-best-score');

    if (elTot) elTot.textContent = totalSims;
    if (elRate) elRate.textContent = `${passRate}%`;
    if (elAvg) elAvg.textContent = `${avgScore} / 30`;
    if (elBest) elBest.textContent = `${bestScore} / 30`;

    // Tabella Storico
    const tbody = document.getElementById('history-table-body');
    if (tbody) {
      if (totalSims === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; color:var(--text-muted); padding:2rem;">
              Nessuna simulazione ancora registrata. Avvia la tua prima simulazione per tracciare i progressi!
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = '';
        AppState.history.forEach((h, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${h.date}</td>
            <td><strong style="font-size:1.1rem; color:${h.isPassed ? 'var(--success-badge)' : 'var(--danger-badge)'}">${h.score} / 30</strong></td>
            <td><span class="badge" style="background:${h.isPassed ? 'var(--success-bg)' : 'var(--danger-bg)'}; color:${h.isPassed ? 'var(--success-badge)' : 'var(--danger-badge)'}; font-weight:700;">${h.isPassed ? 'IDONEO' : 'NON IDONEO'}</span></td>
            <td>Esatte: ${h.correctCount} | Errate: ${h.wrongCount}</td>
            <td>${formatTime(h.durationSeconds || 0)}</td>
            <td>
              <button class="btn btn-sm btn-secondary" onclick="window.viewHistoricalResult(${h.id})">Dettagli</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    // Padronanza Materie
    const masteryContainer = document.getElementById('stats-mastery-container');
    if (masteryContainer) {
      masteryContainer.innerHTML = '';
      AppState.categories.forEach(materia => {
        const qList = AppState.allQuestions.filter(q => q.materia === materia);
        let correctInTraining = 0;
        let answeredInTraining = 0;

        qList.forEach(q => {
          const ans = AppState.training.userAnswers[q.id];
          if (ans) {
            answeredInTraining++;
            if (ans.isCorrect) correctInTraining++;
          }
        });

        const pct = answeredInTraining > 0 ? Math.round((correctInTraining / answeredInTraining) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'subject-bar-row';
        row.innerHTML = `
          <div class="subject-bar-labels">
            <span>${materia}</span>
            <span>${correctInTraining}/${answeredInTraining} corrette (${pct}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%; background:${pct >= 70 ? 'var(--success-badge)' : 'var(--uniss-blue-500)'};"></div>
          </div>
        `;
        masteryContainer.appendChild(row);
      });
    }
  }

  // Esponi per pulsante tabella storico
  window.viewHistoricalResult = function(attemptId) {
    const record = AppState.history.find(h => h.id === attemptId);
    if (!record) return;

    // Passa alla scheda simulazione e mostra il report
    switchTab('exam-view');
    document.getElementById('exam-intro-screen').style.display = 'none';
    document.getElementById('exam-active-screen').style.display = 'none';
    document.getElementById('exam-results-screen').style.display = 'block';

    renderExamResults(record);
  };

  // =========================================================================
  // GESTIONE EVENTI & SETUP UI
  // =========================================================================
  function switchTab(viewId) {
    document.querySelectorAll('.section-view').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-tab-btn, .desktop-nav-link').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    const targetSec = document.getElementById(viewId);
    if (targetSec) targetSec.classList.add('active');

    if (viewId === 'home-view') renderHomeDashboard();
    if (viewId === 'repo-view') renderRepository();
    if (viewId === 'stats-view') renderStatisticsView();

    const mainWrap = document.querySelector('.main-wrapper');
    if (mainWrap) mainWrap.scrollTop = 0;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function performResetTrainingProgress() {
    if (confirm('Sei sicuro di voler azzerare tutti i progressi e le risposte date? Ripartirai da 0 quesiti su 949.')) {
      AppState.training.userAnswers = {};
      if (AppState.training.retrySessionAnswers) AppState.training.retrySessionAnswers = {};
      Storage.saveTrainingAnswers();
      if (window.FirebaseSync && typeof window.FirebaseSync.resetProgress === 'function') {
        try {
          await window.FirebaseSync.resetProgress();
        } catch (e) {
          console.warn('Reset Firestore sync:', e);
        }
      }
      updateTrainingStatsMini();
      updateStatusPillCounts();
      updateModuleProgressBar();
      renderHomeDashboard();
      renderStatisticsView();
      if (AppState.training.viewMode === 'card') {
        renderTrainingCard();
      } else {
        renderTrainingList();
      }
      showToast('Progressi azzerati con successo (0/949)', '🗑️');
    }
  }

  function setupEventListeners() {
    // Navigazione schede principali (sia Mobile Bottom Nav sia Desktop Top Navbar)
    document.querySelectorAll('.nav-tab-btn, .desktop-nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        // Se c'è un esame attivo, chiedi conferma prima di cambiare scheda
        if (AppState.exam.isActive && btn.dataset.view !== 'exam-view') {
          if (!confirm('Attenzione: una simulazione d\'esame è in corso. Vuoi davvero cambiare sezione?')) {
            return;
          }
        }
        switchTab(btn.dataset.view);
      });
    });

    // Home - Torna al Menu dalla modalità Allenamento o dal logo Header
    const btnBackHome = document.getElementById('btn-back-to-home');
    if (btnBackHome) {
      btnBackHome.addEventListener('click', () => {
        switchTab('home-view');
      });
    }

    const brandLink = document.getElementById('brand-home-link');
    if (brandLink) {
      brandLink.addEventListener('click', () => {
        switchTab('home-view');
      });
    }

    // Home Quick Actions
    const btnQuickAll = document.getElementById('btn-quick-all-quiz');
    if (btnQuickAll) {
      btnQuickAll.addEventListener('click', () => {
        startTrainingOnTopic('ALL', 'ALL');
      });
    }

    const btnQuickExam = document.getElementById('btn-quick-exam');
    if (btnQuickExam) {
      btnQuickExam.addEventListener('click', () => {
        switchTab('exam-view');
      });
    }

    const btnQuickWrong = document.getElementById('btn-quick-wrong');
    if (btnQuickWrong) {
      btnQuickWrong.addEventListener('click', () => {
        let wrongCount = 0;
        Object.values(AppState.training.userAnswers).forEach(a => {
          if (!a.isCorrect) wrongCount++;
        });
        if (wrongCount === 0) {
          showToast('Nessun errore registrato finora! Ottimo lavoro!', '🎉');
          return;
        }
        AppState.training.filterMateria = 'ALL';
        AppState.training.filterArgomento = 'ALL';
        AppState.training.filterStatus = 'WRONG';
        AppState.training.filterSearch = '';
        AppState.training.retrySessionAnswers = {}; // Reset sessione di ripasso errori
        AppState.training.currentIndex = 0;
        applyTrainingFilters(true);
        updateActiveSubjectHeader('ALL', 'ALL');
        switchTab('training-view');
        showToast(`Caricati ${wrongCount} errori da ritentare senza suggerimenti`, '🎯');
      });
    }

    const btnQuickBookmarked = document.getElementById('btn-quick-bookmarked');
    if (btnQuickBookmarked) {
      btnQuickBookmarked.addEventListener('click', () => {
        const bmCount = (AppState.training && AppState.training.bookmarks) ? AppState.training.bookmarks.size : 0;
        if (bmCount === 0) {
          showToast('Non hai ancora aggiunto quesiti ai preferiti ⭐', 'ℹ️');
          return;
        }
        AppState.training.filterMateria = 'ALL';
        AppState.training.filterArgomento = 'ALL';
        AppState.training.filterStatus = 'BOOKMARKED';
        AppState.training.filterSearch = '';
        applyTrainingFilters();
        updateActiveSubjectHeader('ALL', 'ALL');
        switchTab('training-view');
      });
    }

    // Home - Ricerca e filtro in tempo reale materie / argomenti
    const homeSearchInput = document.getElementById('home-search-topics');
    if (homeSearchInput) {
      homeSearchInput.addEventListener('input', (e) => {
        const term = e.target.value.trim().toLowerCase();
        document.querySelectorAll('.subject-card').forEach(card => {
          const matName = (card.dataset.materia || '').toLowerCase();
          const tray = card.querySelector('.subject-topics-tray');
          const trayText = tray ? tray.textContent.toLowerCase() : '';
          const match = !term || matName.includes(term) || trayText.includes(term);
          card.style.display = match ? 'block' : 'none';
          if (term && trayText.includes(term) && tray) {
            tray.style.display = 'block';
          }
        });
      });
    }

    // Theme toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      Storage.saveTheme(next);
      updateThemeToggleIcon(next);
      showToast(`Tema ${next === 'dark' ? 'Scuro' : 'Chiaro'} attivato`, '🎨');
    });

    // Sound toggle
    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
      SoundFx.enabled = !SoundFx.enabled;
      Storage.saveSound(SoundFx.enabled);
      const icon = SoundFx.enabled ? '🔊' : '🔇';
      document.getElementById('btn-sound-toggle').textContent = icon;
      showToast(SoundFx.enabled ? 'Suoni di feedback attivati' : 'Suoni disattivati', icon);
    });

    // Filtri Allenamento
    document.getElementById('filter-materia').addEventListener('change', (e) => {
      AppState.training.filterMateria = e.target.value;
      AppState.training.filterArgomento = 'ALL';
      populateArgomentiFilter();
      applyTrainingFilters();
    });

    document.getElementById('filter-argomento').addEventListener('change', (e) => {
      AppState.training.filterArgomento = e.target.value;
      applyTrainingFilters();
    });

    document.getElementById('filter-search').addEventListener('input', (e) => {
      AppState.training.filterSearch = e.target.value;
      applyTrainingFilters();
    });

    // Status pills (Filtro stato domande in allenamento)
    document.querySelectorAll('.training-status-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.training-status-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        AppState.training.filterStatus = pill.dataset.status;
        if (pill.dataset.status === 'WRONG') {
          AppState.training.retrySessionAnswers = {};
        }
        applyTrainingFilters();
      });
    });

    // M3 Bottom Sheet Filtri
    const btnOpenFilter = document.getElementById('btn-open-filter-sheet');
    if (btnOpenFilter) {
      btnOpenFilter.addEventListener('click', () => {
        const sheet = document.getElementById('filter-sheet');
        if (sheet) sheet.style.display = 'flex';
        const chkQ = document.getElementById('check-filter-shuffle-questions');
        if (chkQ) chkQ.checked = !!AppState.settings.shuffleQuestions;
        const chkOpt = document.getElementById('check-filter-shuffle-options');
        if (chkOpt) chkOpt.checked = !!AppState.settings.shuffleOptions;
      });
    }
    const btnCloseFilter = document.getElementById('btn-close-filter-sheet');
    if (btnCloseFilter) {
      btnCloseFilter.addEventListener('click', () => {
        const sheet = document.getElementById('filter-sheet');
        if (sheet) sheet.style.display = 'none';
      });
    }
    const btnApplyFilter = document.getElementById('btn-apply-filter-sheet');
    if (btnApplyFilter) {
      btnApplyFilter.addEventListener('click', () => {
        const chkQ = document.getElementById('check-filter-shuffle-questions');
        if (chkQ) AppState.settings.shuffleQuestions = chkQ.checked;
        const chkOpt = document.getElementById('check-filter-shuffle-options');
        if (chkOpt) {
          AppState.settings.shuffleOptions = chkOpt.checked;
          AppState.allQuestions.forEach(q => {
            delete q._displayOptions;
            delete q._displayOptionsMode;
          });
        }
        Storage.setItem(Storage.KEYS.SHUFFLE_QUESTIONS, String(AppState.settings.shuffleQuestions));
        Storage.setItem(Storage.KEYS.SHUFFLE_OPTIONS, String(AppState.settings.shuffleOptions));
        updateRandomizationButtonsUI();
        applyTrainingFilters();
        renderTrainingCard();
        const sheet = document.getElementById('filter-sheet');
        if (sheet) sheet.style.display = 'none';
      });
    }

    // M3 Bottom Sheet Griglia Esame
    const btnOpenGrid = document.getElementById('btn-open-grid-sheet');
    if (btnOpenGrid) {
      btnOpenGrid.addEventListener('click', () => {
        const sheet = document.getElementById('exam-grid-sheet');
        if (sheet) sheet.style.display = 'flex';
      });
    }
    const btnCloseGrid = document.getElementById('btn-close-grid-sheet');
    if (btnCloseGrid) {
      btnCloseGrid.addEventListener('click', () => {
        const sheet = document.getElementById('exam-grid-sheet');
        if (sheet) sheet.style.display = 'none';
      });
    }

    // Dismiss bottom sheets & modals when tapping on backdrop overlay or pressing Escape
    const dismissableModals = ['filter-sheet', 'exam-grid-sheet', 'updates-modal', 'account-modal', 'confirm-finish-modal', 'instant-feedback-sheet', 'candidate-profile-modal'];
    dismissableModals.forEach(sheetId => {
      const el = document.getElementById(sheetId);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target === el) {
            el.style.display = 'none';
          }
        });
      }
    });

    // Profilo & Impostazioni Candidato (Modal & Toggles)
    function openProfileSettingsModal() {
      const modal = document.getElementById('candidate-profile-modal');
      if (!modal) return;
      const nameInput = document.getElementById('input-candidate-name');
      if (nameInput) nameInput.value = AppState.candidateName || '';

      const hapticCheck = document.getElementById('toggle-haptic-feedback');
      if (hapticCheck) hapticCheck.checked = !!AppState.settings.hapticEnabled;

      const soundCheck = document.getElementById('toggle-sound-effects');
      if (soundCheck) soundCheck.checked = !!SoundFx.enabled;

      const autoCheck = document.getElementById('toggle-auto-explain');
      if (autoCheck) autoCheck.checked = !!AppState.settings.autoExplain;

      const optCheck = document.getElementById('toggle-shuffle-options');
      if (optCheck) optCheck.checked = !!AppState.settings.shuffleOptions;

      const qCheck = document.getElementById('toggle-shuffle-questions');
      if (qCheck) qCheck.checked = !!AppState.settings.shuffleQuestions;

      modal.style.display = 'flex';
    }

    function closeProfileSettingsModal() {
      const modal = document.getElementById('candidate-profile-modal');
      if (modal) modal.style.display = 'none';
    }

    const btnOpenSettings = document.getElementById('btn-open-settings-modal');
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener('click', openProfileSettingsModal);
    }

    const btnEditName = document.getElementById('btn-edit-candidate-name');
    if (btnEditName) {
      btnEditName.addEventListener('click', openProfileSettingsModal);
    }

    const btnCloseProfile = document.getElementById('btn-close-profile-modal');
    if (btnCloseProfile) {
      btnCloseProfile.addEventListener('click', closeProfileSettingsModal);
    }

    const btnCancelProfile = document.getElementById('btn-cancel-profile-modal');
    if (btnCancelProfile) {
      btnCancelProfile.addEventListener('click', closeProfileSettingsModal);
    }

    const btnSaveProfile = document.getElementById('btn-save-profile-modal');
    if (btnSaveProfile) {
      btnSaveProfile.addEventListener('click', () => {
        const nameInput = document.getElementById('input-candidate-name');
        const newName = nameInput ? nameInput.value.trim() : '';
        Storage.saveCandidateName(newName);

        const hapticCheck = document.getElementById('toggle-haptic-feedback');
        if (hapticCheck) Storage.saveHaptic(hapticCheck.checked);

        const soundCheck = document.getElementById('toggle-sound-effects');
        if (soundCheck) Storage.saveSound(soundCheck.checked);

        const autoCheck = document.getElementById('toggle-auto-explain');
        if (autoCheck) AppState.settings.autoExplain = autoCheck.checked;

        const optCheck = document.getElementById('toggle-shuffle-options');
        if (optCheck) {
          AppState.settings.shuffleOptions = optCheck.checked;
          Storage.setItem(Storage.KEYS.SHUFFLE_OPTIONS, String(optCheck.checked));
          AppState.allQuestions.forEach(q => {
            delete q._displayOptions;
            delete q._displayOptionsMode;
          });
        }

        const qCheck = document.getElementById('toggle-shuffle-questions');
        if (qCheck) {
          AppState.settings.shuffleQuestions = qCheck.checked;
          Storage.setItem(Storage.KEYS.SHUFFLE_QUESTIONS, String(qCheck.checked));
        }

        closeProfileSettingsModal();
        renderHomeDashboard();
        if (AppState.training.viewMode === 'card') {
          renderTrainingCard();
        }
        showToast('Impostazioni e profilo salvati con successo!', '⚙️');
      });
    }

    // Avvia il ticker per tracciare il tempo reale di studio e la serie
    startStudySessionTicker();

    // Tasto Escape per chiudere comodamente su PC qualsiasi modale aperta
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        dismissableModals.forEach(id => {
          const m = document.getElementById(id);
          if (m && m.style.display !== 'none') {
            m.style.display = 'none';
          }
        });
      }
    });

    // Azioni del foglio di feedback istantaneo
    const btnFeedNext = document.getElementById('btn-feedback-next-card');
    if (btnFeedNext) {
      btnFeedNext.addEventListener('click', () => {
        const sheet = document.getElementById('instant-feedback-sheet');
        if (sheet) sheet.style.display = 'none';

        if (currentFeedbackContext.isExam) {
          if (AppState.exam.currentIndex < AppState.exam.questions.length - 1) {
            renderExamQuestion(AppState.exam.currentIndex + 1, true);
          } else {
            showToast('Hai risposto a tutte le domande dell\'esame! Puoi consegnare.', '🏁');
          }
        } else {
          if (AppState.training.currentIndex < AppState.training.filteredList.length - 1) {
            AppState.training.currentIndex++;
            renderTrainingCard(true);
          } else {
            showToast('Hai completato tutti i quesiti di questo gruppo!', '🎉');
            showModuleCompletionCard();
          }
        }
      });
    }

    const btnFeedReview = document.getElementById('btn-feedback-review-card');
    if (btnFeedReview) {
      btnFeedReview.addEventListener('click', () => {
        const sheet = document.getElementById('instant-feedback-sheet');
        if (sheet) sheet.style.display = 'none';
      });
    }

    // Toggle spiegazione immediata al tocco
    const btnToggleExplain = document.getElementById('btn-toggle-instant-explain');
    if (btnToggleExplain) {
      btnToggleExplain.addEventListener('click', () => {
        AppState.settings.autoExplain = !AppState.settings.autoExplain;
        btnToggleExplain.classList.toggle('active', AppState.settings.autoExplain);
        btnToggleExplain.style.borderColor = AppState.settings.autoExplain ? 'var(--md-success)' : 'var(--md-outline-variant)';
        btnToggleExplain.style.background = AppState.settings.autoExplain ? 'var(--md-success-container)' : 'var(--md-surface-container)';
        btnToggleExplain.style.color = AppState.settings.autoExplain ? 'var(--md-on-success-container)' : 'var(--md-on-surface-variant)';
        btnToggleExplain.querySelector('span').textContent = AppState.settings.autoExplain 
          ? '⚡ Spiega al Clic: ON' 
          : '⚡ Spiega al Clic: OFF';
        showToast(`Spiegazione immediata: ${AppState.settings.autoExplain ? 'Attivata' : 'Disattivata'}`, '💡');
      });
    }

    // Home featured card: Modalità studio guidato immediato
    const btnQuickInstant = document.getElementById('btn-quick-instant-mode');
    if (btnQuickInstant) {
      btnQuickInstant.addEventListener('click', () => {
        AppState.settings.autoExplain = true;
        const btnToggleExp = document.getElementById('btn-toggle-instant-explain');
        if (btnToggleExp) {
          btnToggleExp.classList.add('active');
          btnToggleExp.querySelector('span').textContent = '⚡ Spiega al Clic: ON';
        }
        startTrainingOnTopic('ALL', 'ALL');
        showToast('Modalità Spiegazione Immediata attiva: tocca un\'opzione per vedere subito l\'esito!', '⚡');
      });
    }

    // Reset filtri
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
      AppState.training.filterMateria = 'ALL';
      AppState.training.filterArgomento = 'ALL';
      AppState.training.filterSearch = '';
      AppState.training.filterStatus = 'ALL';

      document.getElementById('filter-materia').value = 'ALL';
      document.getElementById('filter-search').value = '';
      document.querySelectorAll('.training-status-pill').forEach(p => p.classList.remove('active'));
      const allPill = document.querySelector('.training-status-pill[data-status="ALL"]');
      if (allPill) allPill.classList.add('active');

      populateArgomentiFilter();
      applyTrainingFilters();
      showToast('Filtri ripristinati', '🔄');
    });

    // View mode toggle
    document.getElementById('btn-view-card').addEventListener('click', () => {
      AppState.training.viewMode = 'card';
      document.getElementById('btn-view-card').classList.add('active');
      document.getElementById('btn-view-list').classList.remove('active');
      renderTrainingCard();
    });

    document.getElementById('btn-view-list').addEventListener('click', () => {
      AppState.training.viewMode = 'list';
      document.getElementById('btn-view-list').classList.add('active');
      document.getElementById('btn-view-card').classList.remove('active');
      renderTrainingList();
    });

    // Aggiornamento visuale toggle randomizzazione
    function updateRandomizationButtonsUI() {
      const btnQ = document.getElementById('btn-toggle-shuffle-questions');
      const lblQ = document.getElementById('btn-shuffle-questions-label');
      const chkQ = document.getElementById('check-filter-shuffle-questions');

      const isQ = !!AppState.settings.shuffleQuestions;
      if (btnQ) btnQ.classList.toggle('active', isQ);
      if (lblQ) lblQ.textContent = isQ ? '🔀 Domande: Casuali' : '🔢 Domande: Ordine ID';
      if (chkQ) chkQ.checked = isQ;

      const btnOpt = document.getElementById('btn-toggle-shuffle-options');
      const lblOpt = document.getElementById('btn-shuffle-options-label');
      const chkOpt = document.getElementById('check-filter-shuffle-options');

      const isOpt = !!AppState.settings.shuffleOptions;
      if (btnOpt) btnOpt.classList.toggle('active', isOpt);
      if (lblOpt) lblOpt.textContent = isOpt ? '🎲 Risposte: Casuali' : '📝 Risposte: Predefinite';
      if (chkOpt) chkOpt.checked = isOpt;
    }

    // Toggle Randomizzazione Domande
    const btnShuffleQ = document.getElementById('btn-toggle-shuffle-questions');
    if (btnShuffleQ) {
      btnShuffleQ.addEventListener('click', () => {
        AppState.settings.shuffleQuestions = !AppState.settings.shuffleQuestions;
        Storage.setItem(Storage.KEYS.SHUFFLE_QUESTIONS, String(AppState.settings.shuffleQuestions));
        updateRandomizationButtonsUI();

        if (AppState.settings.shuffleQuestions) {
          AppState.training.filteredList = shuffleArray(AppState.training.filteredList);
          showToast('Ordine domande casuale attivato! 🔀', '🔀');
        } else {
          AppState.training.filteredList.sort((a, b) => a.id - b.id);
          showToast('Ordine sequenziale per ID (1, 2, 3...) ripristinato 🔢', '🔢');
        }
        AppState.training.currentIndex = 0;
        renderTrainingCard();
      });
    }

    // Toggle Randomizzazione Risposte (A, B, C, D)
    const btnShuffleOpt = document.getElementById('btn-toggle-shuffle-options');
    if (btnShuffleOpt) {
      btnShuffleOpt.addEventListener('click', () => {
        AppState.settings.shuffleOptions = !AppState.settings.shuffleOptions;
        Storage.setItem(Storage.KEYS.SHUFFLE_OPTIONS, String(AppState.settings.shuffleOptions));
        // Reset mappature cache sui quesiti
        AppState.allQuestions.forEach(q => {
          delete q._displayOptions;
          delete q._displayOptionsMode;
        });
        updateRandomizationButtonsUI();

        if (AppState.settings.shuffleOptions) {
          showToast('Opzioni di risposta casuali attivate! 🎲', '🎲');
        } else {
          showToast('Opzioni di risposta in ordine predefinito 📝', '📝');
        }
        renderTrainingCard();
      });
    }

    // Checkbox sincronizzate nel foglio Filtri
    const chkFilterQ = document.getElementById('check-filter-shuffle-questions');
    if (chkFilterQ) {
      chkFilterQ.addEventListener('change', (e) => {
        AppState.settings.shuffleQuestions = e.target.checked;
        Storage.setItem(Storage.KEYS.SHUFFLE_QUESTIONS, String(AppState.settings.shuffleQuestions));
        updateRandomizationButtonsUI();
      });
    }

    const chkFilterOpt = document.getElementById('check-filter-shuffle-options');
    if (chkFilterOpt) {
      chkFilterOpt.addEventListener('change', (e) => {
        AppState.settings.shuffleOptions = e.target.checked;
        Storage.setItem(Storage.KEYS.SHUFFLE_OPTIONS, String(AppState.settings.shuffleOptions));
        AppState.allQuestions.forEach(q => {
          delete q._displayOptions;
          delete q._displayOptionsMode;
        });
        updateRandomizationButtonsUI();
      });
    }

    // Inizializza stato pulsanti randomizzazione all'avvio
    updateRandomizationButtonsUI();

    // Navigazione scheda singola
    document.getElementById('btn-card-prev').addEventListener('click', () => {
      if (AppState.training.currentIndex > 0) {
        AppState.training.currentIndex--;
        renderTrainingCard();
      }
    });

    document.getElementById('btn-card-next').addEventListener('click', () => {
      if (AppState.training.currentIndex < AppState.training.filteredList.length - 1) {
        AppState.training.currentIndex++;
        renderTrainingCard();
      } else {
        showModuleCompletionCard();
      }
    });

    // Filtro per Macro-Argomenti nella Home
    document.querySelectorAll('.home-macro-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.home-macro-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const chosenMacro = btn.dataset.macro || 'ALL';
        const cards = document.querySelectorAll('.subject-card');
        cards.forEach(c => {
          if (chosenMacro === 'ALL' || c.dataset.macro === chosenMacro) {
            c.style.display = 'block';
          } else {
            c.style.display = 'none';
          }
        });

        // Banner dinamico per avviare quiz sul macro-ambito selezionato
        const launchCont = document.getElementById('home-macro-launch-container');
        const labelLaunch = document.getElementById('label-launch-macro-quiz');
        const btnLaunch = document.getElementById('btn-launch-macro-quiz');
        if (launchCont) {
          if (chosenMacro === 'ALL') {
            launchCont.style.display = 'none';
          } else {
            const macroInfo = MACRO_SUBJECTS[chosenMacro];
            if (macroInfo) {
              const macroQuestions = AppState.allQuestions.filter(q => macroInfo.subjects.includes(q.materia));
              const countInMacro = macroQuestions.length;
              const answeredInMacro = macroQuestions.filter(q => AppState.training.userAnswers[q.id]).length;
              const firstUnansweredInMacro = macroQuestions.findIndex(q => !AppState.training.userAnswers[q.id]);

              if (labelLaunch) {
                if (answeredInMacro > 0 && answeredInMacro < countInMacro) {
                  labelLaunch.textContent = `▶ Continua: ${macroInfo.icon} ${macroInfo.title} (da quesito ${firstUnansweredInMacro + 1} - ${countInMacro - answeredInMacro} rimasti)`;
                } else if (answeredInMacro === countInMacro && countInMacro > 0) {
                  labelLaunch.textContent = `✅ ${macroInfo.icon} ${macroInfo.title} Completato (${countInMacro} quesiti) - Rivedi ▶`;
                } else {
                  labelLaunch.textContent = `🚀 Avvia Quiz su: ${macroInfo.icon} ${macroInfo.title} (${countInMacro} quesiti) ▶`;
                }
              }
              launchCont.style.display = 'block';
              if (btnLaunch) {
                btnLaunch.onclick = () => {
                  startTrainingOnMacro(chosenMacro);
                };
              }
            }
          }
        }
      });
    });

    // Conclusione anticipata modulo o visualizzazione riepilogo
    const btnEndEarly = document.getElementById('btn-end-module-early');
    if (btnEndEarly) {
      btnEndEarly.addEventListener('click', () => {
        showModuleCompletionCard();
      });
    }

    // Toggle visualizzazione elenco errori a fine modulo
    const btnRevErrors = document.getElementById('btn-completion-review-errors-toggle');
    if (btnRevErrors) {
      btnRevErrors.addEventListener('click', () => {
        const errList = document.getElementById('completion-errors-list');
        if (!errList) return;
        const isHidden = errList.style.display === 'none' || errList.style.display === '';
        errList.style.display = isHidden ? 'flex' : 'none';
        btnRevErrors.textContent = isHidden ? 'Nascondi Errori ▴' : 'Mostra Errori ▾';
      });
    }

    // Ripassa solo gli errori del modulo
    const btnRetryWrong = document.getElementById('btn-completion-retry-wrong');
    if (btnRetryWrong) {
      btnRetryWrong.addEventListener('click', () => {
        const wrongList = AppState.training.filteredList.filter(q => {
          const ans = AppState.training.userAnswers[q.id];
          return ans && !ans.isCorrect;
        });
        if (wrongList.length > 0) {
          AppState.training.filteredList = wrongList;
          AppState.training.currentIndex = 0;
          AppState.training.filterStatus = 'WRONG';
          AppState.training.retrySessionAnswers = {}; // Reset sessione di ripasso errori
          hideModuleCompletionCard();
          renderTrainingCard();
          showToast(`Modalità ripasso: caricati ${wrongList.length} errori da ritentare`, '🔄');
        } else {
          showToast('Nessun errore presente in questo modulo!', '✨');
        }
      });
    }

    // Ricomincia modulo da capo
    const btnRestartMod = document.getElementById('btn-completion-restart-module');
    if (btnRestartMod) {
      btnRestartMod.addEventListener('click', () => {
        AppState.training.currentIndex = 0;
        hideModuleCompletionCard();
        renderTrainingCard();
        showToast('Modulo riavviato dal quesito 1', '🔁');
      });
    }

    // Torna alla lista moduli nella Home
    const btnBackMod = document.getElementById('btn-completion-back-modules');
    if (btnBackMod) {
      btnBackMod.addEventListener('click', () => {
        hideModuleCompletionCard();
        switchTab('home-view');
        renderHomeDashboard();
      });
    }

    // Segnalibro corrente
    document.getElementById('btn-bookmark-current').addEventListener('click', () => {
      const q = AppState.training.filteredList[AppState.training.currentIndex];
      if (q) toggleBookmark(q.id);
    });

    // Rivela soluzione in allenamento
    document.getElementById('btn-reveal-solution').addEventListener('click', () => {
      const q = AppState.training.filteredList[AppState.training.currentIndex];
      if (!q) return;

      if (!AppState.training.userAnswers[q.id]) {
        const displayOpts = getDisplayOptions(q);
        const corrOpt = displayOpts.find(o => o.isCorrect);
        const corrDisplayLetter = corrOpt ? corrOpt.displayLetter : q.risposta_corretta;

        // Segna come risposta consultata
        AppState.training.userAnswers[q.id] = {
          selectedOption: q.risposta_corretta,
          selectedDisplayLetter: corrDisplayLetter,
          isCorrect: true,
          revealed: true,
          timestamp: Date.now()
        };
        Storage.saveTrainingAnswers();
        updateTrainingStatsMini();
        updateStatusPillCounts();
      }
      renderTrainingCard();
      showToast('Soluzione rivelata con spiegazione', '💡');
    });

    // Reset progressi allenamento (da filtro e da pagina statistiche)
    const btnResetProg = document.getElementById('btn-reset-training-progress');
    if (btnResetProg) btnResetProg.addEventListener('click', performResetTrainingProgress);

    const btnStatsResetProg = document.getElementById('btn-stats-reset-progress');
    if (btnStatsResetProg) btnStatsResetProg.addEventListener('click', performResetTrainingProgress);

    // ================= ESAME =================
    const modeSelectEl = document.getElementById('exam-mode-select');
    if (modeSelectEl) {
      modeSelectEl.addEventListener('change', (e) => {
        const modeKey = e.target.value;
        if (AppState.simulationModes && AppState.simulationModes[modeKey]) {
          AppState.currentSimulationMode = modeKey;
          const chosen = AppState.simulationModes[modeKey];
          AppState.distribution = chosen.distribuzione_materie;
          AppState.passingScore = chosen.soglia_superamento || 21;
          AppState.totalExamQuestions = chosen.numero_domande || 30;
          renderExamDistribution();
          showToast(`Impostata: ${chosen.nome}`, '📋');
        }
      });
    }

    document.getElementById('btn-start-exam').addEventListener('click', startExam);

    document.getElementById('btn-exam-prev').addEventListener('click', () => {
      if (AppState.exam.currentIndex > 0) {
        renderExamQuestion(AppState.exam.currentIndex - 1);
      }
    });

    document.getElementById('btn-exam-next').addEventListener('click', () => {
      if (AppState.exam.currentIndex < AppState.exam.questions.length - 1) {
        renderExamQuestion(AppState.exam.currentIndex + 1);
      }
    });

    document.getElementById('btn-jump-unanswered').addEventListener('click', () => {
      const firstUnanswered = AppState.exam.userAnswers.findIndex(ans => ans === null);
      if (firstUnanswered !== -1) {
        renderExamQuestion(firstUnanswered);
      } else {
        showToast('Hai risposto a tutte le domande!', '✅');
      }
    });

    // Conferma consegna esame
    document.getElementById('btn-finish-exam-confirm').addEventListener('click', () => {
      const answeredCount = AppState.exam.userAnswers.filter(a => a !== null).length;
      const total = AppState.exam.questions.length;

      document.getElementById('confirm-modal-desc').innerHTML = `
        Hai risposto a <strong>${answeredCount} su ${total} quesiti</strong>.<br>
        ${answeredCount < total ? `<span style="color:var(--danger-badge);">Attenzione: ${total - answeredCount} quesiti rimasti senza risposta verranno conteggiati come non svolti (0 punti).</span>` : 'Hai risposto a tutte le domande.'}
      `;

      document.getElementById('confirm-finish-modal').style.display = 'flex';
    });

    document.getElementById('btn-modal-cancel').addEventListener('click', () => {
      document.getElementById('confirm-finish-modal').style.display = 'none';
    });

    document.getElementById('btn-modal-confirm').addEventListener('click', () => {
      document.getElementById('confirm-finish-modal').style.display = 'none';
      finishExam();
    });

    // Riavvia esame
    document.getElementById('btn-restart-exam').addEventListener('click', () => {
      document.getElementById('exam-results-screen').style.display = 'none';
      document.getElementById('exam-intro-screen').style.display = 'block';
    });

    // Stampa / Salva PDF
    document.getElementById('btn-print-results').addEventListener('click', () => {
      window.print();
    });

    // Filtri revisione esame
    document.getElementById('btn-review-all').addEventListener('click', () => renderReviewQuestions('ALL'));
    document.getElementById('btn-review-wrong').addEventListener('click', () => renderReviewQuestions('WRONG'));
    document.getElementById('btn-review-correct').addEventListener('click', () => renderReviewQuestions('CORRECT'));

    // Banca dati completa
    document.getElementById('repo-search-input').addEventListener('input', renderRepository);
    document.getElementById('repo-filter-materia').addEventListener('change', renderRepository);
    document.getElementById('btn-expand-all-repo').addEventListener('click', () => {
      document.querySelectorAll('.repo-details').forEach(d => d.open = true);
    });
    document.getElementById('btn-collapse-all-repo').addEventListener('click', () => {
      document.querySelectorAll('.repo-details').forEach(d => d.open = false);
    });

    // Cancella storico esami
    document.getElementById('btn-clear-history').addEventListener('click', () => {
      if (confirm('Sei sicuro di voler cancellare la cronologia delle simulazioni svolte?')) {
        AppState.history = [];
        Storage.saveExamHistory();
        renderStatisticsView();
        showToast('Cronologia simulazioni cancellata', '🗑️');
      }
    });

    // Scorciatoie da tastiera (A, B, C, D, 1, 2, 3, 4, Frecce)
    window.addEventListener('keydown', (e) => {
      // Ignora se l'utente sta scrivendo in un input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      const key = e.key.toUpperCase();

      // Risposta a scelta multipla
      if (['A', 'B', 'C', 'D', '1', '2', '3', '4'].includes(key)) {
        let letter = key;
        if (key === '1') letter = 'A';
        if (key === '2') letter = 'B';
        if (key === '3') letter = 'C';
        if (key === '4') letter = 'D';

        // Se in Allenamento (scheda)
        if (document.getElementById('training-view').classList.contains('active') && AppState.training.viewMode === 'card') {
          const q = AppState.training.filteredList[AppState.training.currentIndex];
          if (q && !AppState.training.userAnswers[q.id]) {
            const displayOpts = getDisplayOptions(q);
            const chosen = displayOpts.find(o => o.displayLetter === letter) || letter;
            handleTrainingAnswer(q, chosen);
          }
        }

        // Se in Esame attivo
        if (AppState.exam.isActive) {
          const idx = AppState.exam.currentIndex;
          const q = AppState.exam.questions[idx];
          if (q && !AppState.exam.userAnswers[idx]) {
            const displayOpts = getDisplayOptions(q);
            const chosen = displayOpts.find(o => o.displayLetter === letter) || letter;
            handleExamAnswer(idx, q, chosen);
          }
        }
      }

      // Navigazione frecce (Sinistra = Prev, Destra = Next)
      if (e.key === 'ArrowLeft' || key === 'P') {
        if (document.getElementById('training-view').classList.contains('active') && AppState.training.viewMode === 'card') {
          document.getElementById('btn-card-prev').click();
        } else if (AppState.exam.isActive) {
          document.getElementById('btn-exam-prev').click();
        }
      }

      if (e.key === 'ArrowRight' || key === 'N') {
        if (document.getElementById('training-view').classList.contains('active') && AppState.training.viewMode === 'card') {
          document.getElementById('btn-card-next').click();
        } else if (AppState.exam.isActive) {
          document.getElementById('btn-exam-next').click();
        }
      }
    });
  }

  // =========================================================================
  // GESTORE AGGIORNAMENTI (PWA, OTA, IMPORT JSON LOCALE, ANDROID APK)
  // =========================================================================
  const UpdateManager = {
    deferredInstallPrompt: null,

    init() {
      this.initServiceWorker();
      this.initPwaInstall();
      this.setupUpdateUI();

      // Controllo automatico OTA silenzioso all'avvio dopo 2.5 secondi
      if (navigator.onLine) {
        setTimeout(() => {
          this.checkOnlineUpdate(true).catch(() => {});
        }, 2500);
      }
    },

    initServiceWorker() {
      if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
          console.log('[PWA] ServiceWorker attivo con scope:', reg.scope);

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  const bar = document.getElementById('pwa-update-bar');
                  if (bar) bar.style.display = 'flex';
                }
              });
            }
          });
        }).catch(err => {
          console.log('[PWA] ServiceWorker registration info:', err);
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }
    },

    initPwaInstall() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstallPrompt = e;
        const btn = document.getElementById('btn-pwa-install');
        if (btn) btn.style.display = 'inline-flex';
      });

      window.addEventListener('appinstalled', () => {
        this.deferredInstallPrompt = null;
        const btn = document.getElementById('btn-pwa-install');
        if (btn) btn.style.display = 'none';
        showToast('App installata correttamente sul dispositivo!', '📱');
      });
    },

    promptInstall() {
      if (this.deferredInstallPrompt) {
        this.deferredInstallPrompt.prompt();
        this.deferredInstallPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] Installazione accettata');
          }
          this.deferredInstallPrompt = null;
        });
      } else {
        alert("Per installare l'app su Android:\n1. Apri il menu del browser (3 puntini in alto a destra)\n2. Tocca 'Aggiungi a schermata Home' oppure 'Installa app'.");
      }
    },

    async checkOnlineUpdate(isSilent = false) {
      const statusContainer = document.getElementById('update-check-status');
      if (statusContainer && !isSilent) {
        statusContainer.innerHTML = '<div style="margin-top:0.5rem; color:var(--text-muted); font-size:0.85rem;"><span class="spinner-small"></span> Connessione al repository GitHub per verifiche OTA...</div>';
      }

      // Se siamo nell'app Android nativa e non è una scansione silenziosa, attiva anche il controllo APK nativo
      if (!isSilent && window.AndroidNative && typeof window.AndroidNative.checkUpdate === 'function') {
        window.AndroidNative.checkUpdate();
      }

      try {
        let targetUrl = (window.location.protocol === 'file:' || !window.location.host)
          ? 'https://raw.githubusercontent.com/Smangry/Concorsofacile/main/version.json'
          : 'version.json';
        let res = await fetch(targetUrl + '?_t=' + Date.now()).catch(() => null);
        if (!res || !res.ok) {
          targetUrl = 'https://raw.githubusercontent.com/Smangry/Concorsofacile/main/simulatore-uniss/version.json';
          res = await fetch(targetUrl + '?_t=' + Date.now());
        }
        if (!res.ok) throw new Error('Risposta HTTP non valida: ' + res.status);
        const manifest = await res.json();

        const currentCount = AppState.allQuestions.length;
        const totalInManifest = manifest.totalQuestions || manifest.questionsCount || 0;
        const currentCode = 705; // v7.0.5
        const hasNewVersionCode = manifest.versionCode && manifest.versionCode > currentCode;

        // Riconoscimento avanzato aggiornamento Banca Dati online
        const remoteDbVer = manifest.databaseVersion || manifest.versionName || '';
        const currentDbVer = AppState.dataVersion || '6.0';
        const hasCountChange = (totalInManifest > 0 && totalInManifest !== currentCount);
        const hasNewDbVersion = remoteDbVer && (remoteDbVer !== currentDbVer) && (remoteDbVer !== '6.0');
        const hasNewDate = manifest.updatedAt && AppState.dataDate && (manifest.updatedAt > AppState.dataDate);

        const hasDatabaseUpdate = hasCountChange || hasNewDbVersion || hasNewDate;

        // Se trovato aggiornamento della Banca Dati, mostra banner intelligente sulla Home
        const banner = document.getElementById('home-ota-update-banner');
        if (banner) {
          if (hasDatabaseUpdate) {
            const bannerTitle = document.getElementById('home-ota-banner-title');
            const bannerSub = document.getElementById('home-ota-banner-sub');
            const btnOtaUpdate = document.getElementById('btn-home-ota-update');
            if (bannerTitle) bannerTitle.textContent = `Nuova Banca Dati Disponibile (v${remoteDbVer || 'OTA'})!`;
            if (bannerSub) bannerSub.textContent = `Trovati ${totalInManifest} quesiti aggiornati nel repository online.`;
            if (btnOtaUpdate) {
              btnOtaUpdate.onclick = () => this.applyRemoteUpdate(manifest.dataUrl || 'banca_dati_concorso_uniss_2026.json');
            }
            banner.style.display = 'block';
          } else {
            banner.style.display = 'none';
          }
        }

        if (statusContainer) {
          if (hasDatabaseUpdate || hasNewVersionCode) {
            statusContainer.innerHTML = `
              <div style="background:rgba(16,185,129,0.12); border:1px solid #10b981; color:var(--text-main); border-radius:var(--radius-md); padding:0.85rem; margin-top:0.6rem; font-size:0.85rem;">
                <div style="font-weight:700; color:#10b981; margin-bottom:0.25rem;">✨ Aggiornamento Rilevato Online!</div>
                <div><strong>Quesiti nel Cloud:</strong> ${totalInManifest} (attualmente ne hai ${currentCount})</div>
                ${remoteDbVer ? `<div><strong>Versione Banca Dati:</strong> v${remoteDbVer}</div>` : ''}
                <div style="margin-top:0.25rem; font-size:0.8rem; color:var(--text-muted);"><em>${manifest.changelog || ''}</em></div>
                <div style="display:flex; gap:0.5rem; margin-top:0.75rem; flex-wrap:wrap;">
                  ${hasDatabaseUpdate ? `<button class="btn btn-sm btn-primary" id="btn-do-download-update">📥 Scarica Nuovi Quesiti Subito (OTA)</button>` : ''}
                  ${hasNewVersionCode ? `<a href="${manifest.downloadUrl || '#'}" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none; display:inline-flex; align-items:center;">Scarica APK v${manifest.versionName}</a>` : ''}
                </div>
              </div>
            `;
            const btnDownload = document.getElementById('btn-do-download-update');
            if (btnDownload) {
              btnDownload.onclick = () => this.applyRemoteUpdate(manifest.dataUrl || 'banca_dati_concorso_uniss_2026.json');
            }
          } else {
            statusContainer.innerHTML = `
              <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:var(--radius-md); padding:0.75rem; margin-top:0.6rem; font-size:0.85rem; color:var(--text-main);">
                ✅ <strong>Applicazione e Banca Dati aggiornate!</strong><br>
                <span style="font-size:0.8rem; color:var(--text-muted);">Sei all'ultima versione con tutti i ${currentCount} quesiti di esercitazione attivi.</span>
              </div>
            `;
          }
        }
      } catch (e) {
        if (!isSilent && statusContainer) {
          statusContainer.innerHTML = `
            <div style="background:rgba(239,68,68,0.1); border:1px solid #ef4444; border-radius:var(--radius-md); padding:0.65rem; margin-top:0.6rem; font-size:0.85rem; color:var(--text-main);">
              ⚠️ <strong>Verifica online non disponibile al momento.</strong><br>
              <span style="font-size:0.8rem; color:var(--text-muted);">Controlla la connessione internet. Puoi comunque aggiornare la banca dati caricando il file JSON manualmente.</span>
            </div>
          `;
        }
      }
    },

    async applyRemoteUpdate(url) {
      try {
        showToast('Download dei nuovi quesiti in corso...', '⏳');
        const res = await fetch(url + '?_t=' + Date.now());
        if (!res.ok) throw new Error('Download fallito: ' + res.status);
        const data = await res.json();
        if (!data || !Array.isArray(data.quesiti)) throw new Error('File non valido: mancano i quesiti');

        data.isOnlineUpdate = true;
        data.sourceLabel = 'Aggiornamento Online (v' + (data.versione || 'OTA') + ')';
        data.downloadedAt = Date.now();

        Storage.saveCustomBancaDati(data);
        loadData(data, data.sourceLabel);

        // Aggiorna tutta l'interfaccia a video istantaneamente
        renderHomeDashboard();
        renderStatisticsView();
        populateArgomentiFilter();
        populateRepoFilters();
        renderRepository();
        updateStatusPillCounts();
        updateModuleProgressBar();
        if (AppState.training.viewMode === 'card') {
          renderTrainingCard();
        } else {
          renderTrainingList();
        }

        const banner = document.getElementById('home-ota-update-banner');
        if (banner) banner.style.display = 'none';

        showToast(`Banca dati aggiornata online: ${data.quesiti.length} quesiti attivi!`, '🎉');
        this.closeModal();
      } catch (err) {
        alert('Impossibile completare l\'aggiornamento automatico: ' + err.message);
      }
    },

    importFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.quesiti || !Array.isArray(parsed.quesiti)) {
            alert('Errore: Il file caricato non sembra una banca dati valida di concorso (manca l\'elenco "quesiti").');
            return;
          }
          Storage.saveCustomBancaDati(parsed);
          loadData(parsed, `File Locale (${file.name})`);
          showToast(`Banca dati aggiornata: ${parsed.quesiti.length} quesiti caricati da ${file.name}!`, '🎉');
          this.closeModal();
        } catch (err) {
          alert('Errore nella lettura del file JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    },

    resetDefaults() {
      if (confirm('Vuoi ripristinare la banca dati originaria (949 quesiti di esercitazione)? Eventuali file scaricati online verranno rimossi.')) {
        Storage.removeCustomBancaDati();
        initDatabase();
        renderHomeDashboard();
        renderStatisticsView();
        populateArgomentiFilter();
        populateRepoFilters();
        renderRepository();
        updateStatusPillCounts();
        updateModuleProgressBar();
        if (AppState.training.viewMode === 'card') {
          renderTrainingCard();
        } else {
          renderTrainingList();
        }
        showToast('Banca dati predefinita ripristinata con successo (949 quesiti)', '⏪');
        this.closeModal();
      }
    },

    openModal() {
      const modal = document.getElementById('updates-modal');
      if (modal) modal.style.display = 'flex';
    },

    closeModal() {
      const modal = document.getElementById('updates-modal');
      if (modal) modal.style.display = 'none';
    },

    setupUpdateUI() {
      const btnModal = document.getElementById('btn-updates-modal');
      if (btnModal) btnModal.addEventListener('click', () => this.openModal());

      const btnClose = document.getElementById('btn-close-updates-modal');
      if (btnClose) btnClose.addEventListener('click', () => this.closeModal());

      const btnCloseBottom = document.getElementById('btn-close-modal-bottom');
      if (btnCloseBottom) btnCloseBottom.addEventListener('click', () => this.closeModal());

      const btnCheck = document.getElementById('btn-check-online-update');
      if (btnCheck) btnCheck.addEventListener('click', () => this.checkOnlineUpdate());

      const btnTriggerJson = document.getElementById('btn-trigger-json-upload');
      const inputJson = document.getElementById('input-update-json');
      if (btnTriggerJson && inputJson) {
        btnTriggerJson.addEventListener('click', () => inputJson.click());
        inputJson.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            this.importFile(e.target.files[0]);
          }
        });
      }

      const btnReset = document.getElementById('btn-reset-default-data');
      if (btnReset) btnReset.addEventListener('click', () => this.resetDefaults());

      const btnInstall = document.getElementById('btn-pwa-install');
      if (btnInstall) btnInstall.addEventListener('click', () => this.promptInstall());

      const pwaReload = document.getElementById('btn-pwa-reload');
      if (pwaReload) {
        pwaReload.addEventListener('click', () => {
          if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistration().then(reg => {
              if (reg && reg.waiting) {
                reg.waiting.postMessage({ action: 'skipWaiting' });
              } else {
                window.location.reload();
              }
            });
          } else {
            window.location.reload();
          }
        });
      }

      const pwaDismiss = document.getElementById('btn-pwa-dismiss');
      if (pwaDismiss) {
        pwaDismiss.addEventListener('click', () => {
          const bar = document.getElementById('pwa-update-bar');
          if (bar) bar.style.display = 'none';
        });
      }
    }
  };

  // =========================================================================
  // GESTIONE ACCOUNT & CLOUD SYNC (GOOGLE FIREBASE)
  // =========================================================================
  const AccountManager = {
    currentTab: 'login', // 'login' | 'register'

    init() {
      this.setupUI();
      this.updateState();

      // Callback globale per quando la sincronizzazione Firebase termina (SEMPRE SILENZIOSA)
      window.onFirebaseSyncCompleted = (merged) => {
        this.updateState();
        renderHomeDashboard();
        renderStatisticsView();
        updateStatusPillCounts();
        updateModuleProgressBar();
        if (AppState.training.viewMode === 'card') {
          renderTrainingCard();
        } else {
          renderTrainingList();
        }
      };

      // Se l'utente è già loggato all'avvio, avvia sincronizzazione in background
      if (window.FirebaseSync && window.FirebaseSync.getUser()) {
        window.FirebaseSync.sync(true).catch(e => {
          console.warn('Sync iniziale in background (offline?):', e);
        });
      }
    },

    updateState() {
      const user = window.FirebaseSync ? window.FirebaseSync.getUser() : null;
      const isConfig = window.FirebaseSync ? window.FirebaseSync.isConfigured() : false;

      // 1. Icona e pallino verde nel Top Header
      const dotEl = document.getElementById('header-account-dot');
      if (dotEl) dotEl.style.display = user ? 'block' : 'none';

      // 2. Barra di stato rapida nella Home
      const cloudTitle = document.getElementById('home-cloud-title');
      const cloudSub = document.getElementById('home-cloud-sub');
      const cloudBtn = document.getElementById('btn-home-cloud-action');
      const cloudIcon = document.getElementById('home-cloud-icon');

      if (user) {
        if (cloudTitle) cloudTitle.textContent = `Cloud: ${user.email}`;
        if (cloudSub) {
          const lastSync = window.FirebaseSync.getLastSyncTime();
          const syncText = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In corso';
          cloudSub.textContent = `🟢 Sincronizzato con il tuo account (ore ${syncText})`;
        }
        if (cloudBtn) cloudBtn.textContent = 'Gestisci';
        if (cloudIcon) cloudIcon.textContent = '☁️';
      } else {
        if (cloudTitle) cloudTitle.textContent = 'Sincronizzazione Cloud';
        if (cloudSub) cloudSub.textContent = isConfig 
          ? 'Accedi per salvare i tuoi progressi online su tutti i dispositivi'
          : 'Tocca qui per configurare il tuo account Firebase gratuito';
        if (cloudBtn) cloudBtn.textContent = 'Accedi';
        if (cloudIcon) cloudIcon.textContent = '👤';
      }

      // 3. Viste interne al Modal
      const loggedView = document.getElementById('account-logged-view');
      const authView = document.getElementById('account-auth-view');
      const emailLabel = document.getElementById('account-user-email');
      const avatarInitial = document.getElementById('account-avatar-initial');
      const lastSyncLabel = document.getElementById('account-last-sync-label');

      if (user) {
        if (loggedView) loggedView.style.display = 'block';
        if (authView) authView.style.display = 'none';
        if (emailLabel) emailLabel.textContent = user.email;
        if (avatarInitial) avatarInitial.textContent = (user.email ? user.email[0].toUpperCase() : 'U');
        if (lastSyncLabel) {
          const lastSync = window.FirebaseSync.getLastSyncTime();
          lastSyncLabel.textContent = lastSync ? new Date(lastSync).toLocaleString() : 'Nessuna sincronizzazione';
        }
      } else {
        if (loggedView) loggedView.style.display = 'none';
        if (authView) authView.style.display = 'block';
      }
    },

    openModal() {
      this.updateState();
      const modal = document.getElementById('account-modal');
      if (modal) modal.style.display = 'flex';
      this.hideAlert();
    },

    closeModal() {
      const modal = document.getElementById('account-modal');
      if (modal) modal.style.display = 'none';
    },

    switchAuthTab(tab) {
      this.currentTab = tab;
      const btnLogin = document.getElementById('tab-auth-login');
      const btnRegister = document.getElementById('tab-auth-register');
      const confirmContainer = document.getElementById('auth-confirm-pw-container');
      const submitLabel = document.getElementById('btn-submit-auth-label');

      this.hideAlert();

      if (tab === 'register') {
        if (btnLogin) { btnLogin.classList.remove('active'); btnLogin.classList.add('btn-ghost'); }
        if (btnRegister) { btnRegister.classList.add('active'); btnRegister.classList.remove('btn-ghost'); }
        if (confirmContainer) confirmContainer.style.display = 'block';
        if (submitLabel) submitLabel.textContent = 'Crea Account Gratuito';
      } else {
        if (btnRegister) { btnRegister.classList.remove('active'); btnRegister.classList.add('btn-ghost'); }
        if (btnLogin) { btnLogin.classList.add('active'); btnLogin.classList.remove('btn-ghost'); }
        if (confirmContainer) confirmContainer.style.display = 'none';
        if (submitLabel) submitLabel.textContent = 'Accedi al Cloud';
      }
    },

    showAlert(message, isSuccess = false) {
      const alertBox = document.getElementById('account-auth-alert');
      if (!alertBox) return;
      alertBox.textContent = message;
      alertBox.style.display = 'block';
      alertBox.style.background = isSuccess ? 'var(--md-success-container)' : 'var(--md-error-container)';
      alertBox.style.color = isSuccess ? 'var(--md-on-success-container)' : 'var(--md-on-error-container)';
      alertBox.style.border = isSuccess ? '1px solid var(--md-success)' : '1px solid var(--md-error)';
    },

    hideAlert() {
      const alertBox = document.getElementById('account-auth-alert');
      if (alertBox) alertBox.style.display = 'none';
    },

    async handleAuthSubmit() {
      if (!window.FirebaseSync) return;

      if (!window.FirebaseSync.isConfigured()) {
        this.showAlert('Firebase non è ancora configurato. Apri "Configurazione Firebase" in basso e inserisci API Key e Project ID.');
        const panel = document.getElementById('firebase-setup-panel');
        if (panel) panel.style.display = 'block';
        return;
      }

      const emailInput = document.getElementById('auth-email-input');
      const passwordInput = document.getElementById('auth-password-input');
      const confirmInput = document.getElementById('auth-confirm-password-input');
      const submitBtn = document.getElementById('btn-submit-auth');

      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      const confirmPw = confirmInput ? confirmInput.value : '';

      if (!email || !password) {
        this.showAlert('Inserisci sia l\'indirizzo email sia la password.');
        return;
      }

      if (this.currentTab === 'register' && password !== confirmPw) {
        this.showAlert('Le due password inserite non coincidono.');
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Operazione in corso...';
        }
        this.hideAlert();

        if (this.currentTab === 'register') {
          const u = await window.FirebaseSync.register(email, password);
          if (u && u.syncError) {
            showToast('Account creato, ma Cloud Firestore non attivo: ' + u.syncError, '⚠️');
          } else {
            showToast('Account creato con successo! Progressi uniti al Cloud.', '🎉');
          }
        } else {
          const u = await window.FirebaseSync.login(email, password);
          if (u && u.syncError) {
            showToast('Accesso effettuato, ma Cloud Firestore non attivo: ' + u.syncError, '⚠️');
          } else {
            showToast('Accesso effettuato! Progressi sincronizzati con il Cloud.', '✅');
          }
        }

        this.updateState();
        renderHomeDashboard();
        renderStatisticsView();
        updateStatusPillCounts();
        updateModuleProgressBar();
        if (AppState.training.viewMode === 'card') {
          renderTrainingCard();
        } else {
          renderTrainingList();
        }
      } catch (err) {
        this.showAlert(err.message || 'Errore durante l\'autenticazione.');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = (this.currentTab === 'register') ? 'Crea Account Gratuito' : 'Accedi al Cloud';
        }
      }
    },

    async handleLogout() {
      if (!window.FirebaseSync) return;
      if (confirm('Vuoi davvero disconnettere il tuo account? I progressi rimarranno comunque salvati su questo dispositivo.')) {
        window.FirebaseSync.logout();
        this.updateState();
        showToast('Account disconnesso con successo.', 'ℹ️');
      }
    },

    async handleSyncNow() {
      if (!window.FirebaseSync) return;
      const btnSync = document.getElementById('btn-account-sync-now');
      try {
        if (btnSync) {
          btnSync.disabled = true;
          btnSync.innerHTML = '<span>⏳ Sincronizzazione in corso...</span>';
        }
        const res = await window.FirebaseSync.sync(false);
        if (res.success) {
          this.updateState();
          showToast('Sincronizzazione Cloud completata!', '☁️');
        } else {
          showToast('Errore di sincronizzazione: ' + (res.error || res.reason), '⚠️');
        }
      } catch (err) {
        showToast('Errore di rete: ' + err.message, '❌');
      } finally {
        if (btnSync) {
          btnSync.disabled = false;
          btnSync.innerHTML = '<span>🔄 Sincronizza Ora con il Cloud</span>';
        }
      }
    },

    setupUI() {
      // Apertura / Chiusura Modal
      const btnOpen = document.getElementById('btn-account-modal');
      if (btnOpen) btnOpen.addEventListener('click', () => this.openModal());

      const homeCloudBar = document.getElementById('home-cloud-bar');
      if (homeCloudBar) homeCloudBar.addEventListener('click', () => this.openModal());

      const btnClose = document.getElementById('btn-close-account-modal');
      if (btnClose) btnClose.addEventListener('click', () => this.closeModal());

      const btnCloseBottom = document.getElementById('btn-close-account-modal-bottom');
      if (btnCloseBottom) btnCloseBottom.addEventListener('click', () => this.closeModal());

      // Tab Login / Register
      const tabLogin = document.getElementById('tab-auth-login');
      if (tabLogin) tabLogin.addEventListener('click', () => this.switchAuthTab('login'));

      const tabRegister = document.getElementById('tab-auth-register');
      if (tabRegister) tabRegister.addEventListener('click', () => this.switchAuthTab('register'));

      // Submit Form
      const formAuth = document.getElementById('form-account-auth');
      if (formAuth) formAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAuthSubmit();
      });

      // Azioni Utente Loggato
      const btnLogout = document.getElementById('btn-account-logout');
      if (btnLogout) btnLogout.addEventListener('click', () => this.handleLogout());

      const btnSyncNow = document.getElementById('btn-account-sync-now');
      if (btnSyncNow) btnSyncNow.addEventListener('click', () => this.handleSyncNow());

      const btnResetAll = document.getElementById('btn-account-reset-all');
      if (btnResetAll) btnResetAll.addEventListener('click', () => {
        performResetTrainingProgress().then(() => this.updateState());
      });
    }
  };

  // =========================================================================
  // BOOTSTRAP APP
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    Storage.load();
    setupEventListeners();
    initDatabase();
    UpdateManager.init();
    AccountManager.init();
  });

})();
