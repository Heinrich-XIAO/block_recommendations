// Content Censor Extension
const BLOCKED_KEYWORDS = ['sex', 'porn', 'anal', 'xxx', 'nsfw', 'erotic', 'hardcore', 'adult'];
const BLOCKED_KEYWORD_SET = new Set(BLOCKED_KEYWORDS);
const OPENROUTER_API_KEY = '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';
const OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const YOUTUBE_TIME_LIMIT = 24 * 60 * 60 * 1000; // 2 hours in milliseconds
const TIME_UPDATE_INTERVAL = 1000; // Update every second
const KHAN_ACADEMY_VIDEO_DELAY = 5 * 1000;
const KHAN_ACADEMY_PROGRESS_UPDATE_INTERVAL = 2500;
const KHAN_ACADEMY_WATCH_SPEED_MULTIPLIER = 24;
const KHAN_ACADEMY_APP = 'khanacademy';
const KHAN_ACADEMY_LANG = 'en';
const KHAN_ACADEMY_COUNTRY_CODE = 'CA';
const KHAN_ACADEMY_FKEY = '1';
const KHAN_ACADEMY_REQUEST_PARAM_RETRY_MS = 500;
const KHAN_ACADEMY_REQUEST_PARAM_MAX_ATTEMPTS = 20;
const KHAN_ACADEMY_INPUT_AUTOFOCUS_INTERVAL = 1000;
const KHAN_ACADEMY_ANSWER_KEYS = new Set(['a', 'b', 'c', 'd']);
const KHAN_ACADEMY_HIDDEN_BANNER_TEXT = "We've updated our Terms of Service and Privacy Policy. Please review them now.";
let youtubeTimer = null;
let youtubeChannelBlockObserver = null;
let youtubeChannelPageBlocked = false;
const YOUTUBE_CHANNEL_BLOCK_STYLE_ID = 'youtube-channel-block-style';
let khanAcademyTimer = null;
let khanAcademyTimerUrl = null;
let khanAcademyProgressInterval = null;
let khanAcademyInputAutofocusInterval = null;
let khanAcademyLocationObserver = null;
let khanAcademyObservedUrl = null;
let khanAcademyNetworkTracingInstalled = false;
let khanAcademyAnswerHotkeysInstalled = false;
let khanAcademyBannerObserver = null;
const KHAN_ACADEMY_PAGE_TRACE_BRIDGE_ID = 'ka-tracker-page-trace-bridge';
let khanAcademySession = null;

function logKhanAcademy(message, details) {
  if (details === undefined) {
    console.log(`[KA tracker] ${message}`);
    return;
  }

  console.log(`[KA tracker] ${message}`, details);
}

function isKhanAcademyApiUrl(url) {
  return typeof url === 'string'
    && url.includes('khanacademy.org/api/');
}

function tryParseJson(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function getKhanAcademyNetworkLogDetails(url, method, body) {
  const details = { method, url };
  const parsedBody = tryParseJson(body);

  if (parsedBody?.operationName) {
    details.operationName = parsedBody.operationName;
  }

  if (parsedBody?.variables) {
    details.variables = parsedBody.variables;
  }

  if (typeof parsedBody?.query === 'string') {
    details.queryPreview = parsedBody.query.slice(0, 160);
  }

  return details;
}

function installKhanAcademyPageContextNetworkTracing() {
  if (!isKhanAcademy() || document.getElementById(KHAN_ACADEMY_PAGE_TRACE_BRIDGE_ID)) {
    return;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== KHAN_ACADEMY_PAGE_TRACE_BRIDGE_ID) {
      return;
    }

    if (event.data.type === 'request') {
      logKhanAcademy('page request', event.data.details);
      return;
    }

    if (event.data.type === 'response') {
      logKhanAcademy('page response', event.data.details);
      return;
    }

    if (event.data.type === 'error') {
      logKhanAcademy('page request failed', event.data.details);
    }
  });

  const script = document.createElement('script');
  script.id = KHAN_ACADEMY_PAGE_TRACE_BRIDGE_ID;
  script.src = chrome.runtime.getURL('page-trace.js');

  (document.documentElement || document.head || document.body).appendChild(script);
  logKhanAcademy('Installed page-context network tracing bridge');
}

function installKhanAcademyNetworkTracing() {
  if (!isKhanAcademy() || khanAcademyNetworkTracingInstalled) {
    return;
  }

  khanAcademyNetworkTracingInstalled = true;
  logKhanAcademy('Installing network tracing');
  installKhanAcademyPageContextNetworkTracing();

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = init?.method || (typeof input !== 'string' ? input?.method : null) || 'GET';
    const body = init?.body || (typeof input !== 'string' ? input?.body : null) || null;

    if (isKhanAcademyApiUrl(url)) {
      logKhanAcademy('fetch request', getKhanAcademyNetworkLogDetails(url, method, body));
    }

    try {
      const response = await originalFetch(...args);

      if (isKhanAcademyApiUrl(url)) {
        logKhanAcademy('fetch response', {
          method,
          url,
          status: response.status
        });
      }

      return response;
    } catch (error) {
      if (isKhanAcademyApiUrl(url)) {
        logKhanAcademy('fetch failed', {
          method,
          url,
          error: String(error)
        });
      }
      throw error;
    }
  };

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (originalSendBeacon) {
    navigator.sendBeacon = (url, data) => {
      if (isKhanAcademyApiUrl(url)) {
        logKhanAcademy('sendBeacon request', {
          url,
          bodyPreview: typeof data === 'string' ? data.slice(0, 200) : String(data)
        });
      }

      return originalSendBeacon(url, data);
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__kaTrackerMethod = method;
    this.__kaTrackerUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__kaTrackerUrl || '';
    const method = this.__kaTrackerMethod || 'GET';

    if (isKhanAcademyApiUrl(url)) {
      logKhanAcademy('xhr request', getKhanAcademyNetworkLogDetails(url, method, body));
      this.addEventListener('loadend', () => {
        logKhanAcademy('xhr response', {
          method,
          url,
          status: this.status
        });
      }, { once: true });
    }

    return originalSend.call(this, body);
  };
}

function isExtensionContextValid() {
  try {
    return Boolean(chrome && chrome.runtime && chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

function isYouTube() {
  return window.location.hostname === 'www.youtube.com'
    || window.location.hostname === 'youtube.com'
    || window.location.hostname === 'm.youtube.com';
}

function isKhanAcademy() {
  return window.location.hostname === 'www.khanacademy.org'
    || window.location.hostname === 'khanacademy.org';
}

function isKhanAcademyExercisePage() {
  return isKhanAcademy() && /\/e\//.test(window.location.pathname);
}

function isKhanAcademyVideoPage() {
  return isKhanAcademy() && /\/v\//.test(window.location.pathname);
}

function isEditableElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return element.isContentEditable
    || element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

function getNormalizedElementText(element) {
  if (!(element instanceof HTMLElement)) {
    return '';
  }

  return (element.innerText || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getKhanAcademyAnswerKeyForElement(element) {
  const text = getNormalizedElementText(element);
  if (text) {
    const leadingLetterMatch = text.match(/^([A-D])(?:\b|\s)/i);
    if (leadingLetterMatch) {
      return leadingLetterMatch[1].toLowerCase();
    }
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim() || '';
  const ariaMatch = ariaLabel.match(/\b(?:choice|option)\s*([A-D])\b/i);
  if (ariaMatch) {
    return ariaMatch[1].toLowerCase();
  }

  return null;
}

function isVisibleKhanAcademyAnswerElement(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.visibility !== 'hidden'
    && style.display !== 'none';
}

function getKhanAcademyAnswerChoiceMap() {
  const choiceMap = new Map();
  const candidateSelector = [
    '[role="radio"]',
    'button',
    '[role="button"]',
    'label'
  ].join(', ');

  for (const element of document.querySelectorAll(candidateSelector)) {
    if (!isVisibleKhanAcademyAnswerElement(element)) {
      continue;
    }

    const answerKey = getKhanAcademyAnswerKeyForElement(element);
    if (!answerKey || choiceMap.has(answerKey)) {
      continue;
    }

    choiceMap.set(answerKey, element);
  }

  return choiceMap;
}

function getKhanAcademyPrimaryActionButton() {
  const candidates = [];
  const candidateSelector = [
    'button',
    '[role="button"]',
    'a[role="button"]',
    'a[href]'
  ].join(', ');
  const primaryActionPattern = /^(check|next question|up next|up next:|let'?s go|keep going|continue|submit|show answer)\b/i;
  const preferredPrimaryActionPattern = /^(up next|up next:|let'?s go|next question|check|continue|keep going|show answer|submit)\b/i;
  const fallbackPrimaryActionPattern = /^(start over|start|try again)\b/i;

  for (const element of document.querySelectorAll(candidateSelector)) {
    if (!(element instanceof HTMLElement) || !isVisibleKhanAcademyAnswerElement(element)) {
      continue;
    }

    if (element instanceof HTMLButtonElement && element.disabled) {
      continue;
    }

    if (element.getAttribute('aria-disabled') === 'true') {
      continue;
    }

    if (element instanceof HTMLAnchorElement && !element.href) {
      continue;
    }

    const text = getNormalizedElementText(element);
    if (!text) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const backgroundColor = style.backgroundColor || '';
    const isFilledButton = backgroundColor !== 'rgba(0, 0, 0, 0)'
      && backgroundColor !== 'transparent'
      && !/^rgba?\(255,\s*255,\s*255(?:,\s*1)?\)$/.test(backgroundColor);
    const isInDialog = element.closest('[role="dialog"], [aria-modal="true"]') !== null;
    const isInLowerRight = rect.bottom >= window.innerHeight * 0.6 && rect.right >= window.innerWidth * 0.5;
    const isVideoPrimaryAction = isKhanAcademyVideoPage() && /^(up next:|let'?s go)\b/i.test(text);
    let score = (rect.bottom * window.innerWidth) + rect.right;

    if (primaryActionPattern.test(text)) {
      score += 10_000_000;
    }

    if (preferredPrimaryActionPattern.test(text)) {
      score += 12_000_000;
    }

    if (fallbackPrimaryActionPattern.test(text)) {
      score -= 20_000_000;
    }

    if (isVideoPrimaryAction) {
      score += 15_000_000;
    }

    if (isFilledButton) {
      score += 5_000_000;
    }

    if (isInDialog) {
      score += 2_500_000;
    }

    if (isInLowerRight) {
      score += 1_000_000;
    }

    candidates.push({
      element,
      text,
      score
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.element || null;
}

function getKhanAcademyMainAnswerInput() {
  if (!isKhanAcademyExercisePage()) {
    return null;
  }

  if (getKhanAcademyAnswerChoiceMap().size > 0) {
    return null;
  }

  const candidates = [];
  const candidateSelector = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(', ');

  for (const element of document.querySelectorAll(candidateSelector)) {
    if (!(element instanceof HTMLElement) || !isVisibleKhanAcademyAnswerElement(element)) {
      continue;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly) {
        continue;
      }
    }

    const rect = element.getBoundingClientRect();
    candidates.push({
      element,
      score: rect.top * window.innerWidth + rect.left
    });
  }

  candidates.sort((left, right) => left.score - right.score);
  return candidates[0]?.element || null;
}

function installKhanAcademyAnswerHotkeys() {
  if (!isKhanAcademy() || khanAcademyAnswerHotkeysInstalled) {
    return;
  }

  khanAcademyAnswerHotkeysInstalled = true;
  document.addEventListener('keydown', (event) => {
    if (!isKhanAcademy()) {
      return;
    }

    const pressedKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const isAnswerHotkey = KHAN_ACADEMY_ANSWER_KEYS.has(pressedKey);
    const isPrimaryActionHotkey = pressedKey === 'enter' && (event.ctrlKey || event.metaKey);
    const isMainInputHotkey = pressedKey === 'i' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (!isAnswerHotkey && !isPrimaryActionHotkey && !isMainInputHotkey) {
      return;
    }

    if (event.altKey || event.shiftKey || (isAnswerHotkey && (event.ctrlKey || event.metaKey))) {
      logKhanAcademy('Ignoring answer hotkey with modifier', {
        key: pressedKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey
      });
      return;
    }

    if (isMainInputHotkey) {
      event.preventDefault();
      event.stopPropagation();

      if (isEditableElement(event.target)) {
        logKhanAcademy('Ignoring main input hotkey from editable target', {
          key: pressedKey,
          targetTagName: event.target instanceof HTMLElement ? event.target.tagName : null
        });
        return;
      }

      const targetElement = getKhanAcademyMainAnswerInput();
      if (!targetElement) {
        logKhanAcademy('No main answer input found for hotkey', {
          key: pressedKey,
          multipleChoice: getKhanAcademyAnswerChoiceMap().size > 0
        });
        return;
      }
      logKhanAcademy('Focusing main answer input from hotkey', {
        key: pressedKey,
        targetTagName: targetElement.tagName
      });
      targetElement.focus();
      if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement) {
        targetElement.select();
      }
      return;
    }

    if (isPrimaryActionHotkey) {
      event.preventDefault();
      event.stopPropagation();

      const targetElement = getKhanAcademyPrimaryActionButton();
      if (!targetElement) {
        logKhanAcademy('No primary action button found for hotkey', {
          key: pressedKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey
        });
        return;
      }
      logKhanAcademy('Clicking primary action from hotkey', {
        key: pressedKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        buttonText: getNormalizedElementText(targetElement)
      });
      targetElement.click();
      return;
    }

    if (isEditableElement(event.target)) {
      logKhanAcademy('Ignoring answer hotkey from editable target', {
        key: pressedKey,
        targetTagName: event.target instanceof HTMLElement ? event.target.tagName : null
      });
      return;
    }

    const choiceMap = getKhanAcademyAnswerChoiceMap();
    const targetElement = choiceMap.get(pressedKey);
    if (!targetElement) {
      logKhanAcademy('No answer option found for hotkey', {
        key: pressedKey,
        availableKeys: Array.from(choiceMap.keys())
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    logKhanAcademy('Clicking answer option from hotkey', {
      key: pressedKey,
      optionText: getNormalizedElementText(targetElement)
    });
    targetElement.click();
  }, true);

  logKhanAcademy('Installed answer hotkeys');
}

function hideKhanAcademyPolicyBanner() {
  if (!isKhanAcademy()) {
    return false;
  }

  const statusBanners = document.querySelectorAll('[role="status"]');
  for (const bannerElement of statusBanners) {
    if (!(bannerElement instanceof HTMLElement) || bannerElement.dataset.kaTrackerBannerHidden === 'true') {
      continue;
    }

    const bannerText = getNormalizedElementText(bannerElement);
    if (!bannerText.includes(KHAN_ACADEMY_HIDDEN_BANNER_TEXT)) {
      continue;
    }

    const bannerRect = bannerElement.getBoundingClientRect();
    if (bannerRect.top > 200) {
      continue;
    }

    bannerElement.dataset.kaTrackerBannerHidden = 'true';
    bannerElement.style.display = 'none';
    logKhanAcademy('Hid policy banner', {
      text: KHAN_ACADEMY_HIDDEN_BANNER_TEXT
    });
    return true;
  }

  return false;
}

function installKhanAcademyBannerHider() {
  if (!isKhanAcademy()) {
    return;
  }

  hideKhanAcademyPolicyBanner();
  if (khanAcademyBannerObserver) {
    return;
  }

  khanAcademyBannerObserver = new MutationObserver(() => {
    hideKhanAcademyPolicyBanner();
  });
  khanAcademyBannerObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  logKhanAcademy('Installed policy banner hider');
}

function isYouTubeChannelPage() {
  const initialData = window.ytInitialData;
  if (initialData?.metadata?.channelMetadataRenderer) {
    return true;
  }

  const header = initialData?.header || {};
  if (header.c4TabbedHeaderRenderer || header.pageHeaderRenderer) {
    return true;
  }

  const microformat = initialData?.microformat?.microformatDataRenderer;
  if (microformat?.urlCanonical?.includes('/@') && microformat?.title) {
    return true;
  }

  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
  if (ogType === 'profile') {
    return true;
  }

  const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of schemaScripts) {
    const text = script.textContent || '';
    if (text.includes('"@type":"ProfilePage"') || text.includes('"@type": "ProfilePage"')) {
      return true;
    }
  }

  const browseElement = document.querySelector('ytd-browse[page-subtype="channel"]');
  if (browseElement) {
    return true;
  }

  return Boolean(
    document.querySelector(
      'ytd-c4-tabbed-header-renderer, ytd-page-header-renderer, ytd-reel-shelf-renderer[channel-id]'
    )
  );
}

function blockYouTubeChannelPage() {
  if (youtubeChannelPageBlocked) {
    return;
  }

  youtubeChannelPageBlocked = true;
  stopYouTubeTimer();

  if (!document.head || !document.documentElement) {
    return;
  }

  let styleElement = document.getElementById(YOUTUBE_CHANNEL_BLOCK_STYLE_ID);
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = YOUTUBE_CHANNEL_BLOCK_STYLE_ID;
    document.head.appendChild(styleElement);
  }

  styleElement.textContent = `
    html, body {
      margin: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background: #ffffff !important;
      overflow: hidden !important;
    }

    body > * {
      display: none !important;
    }
  `;

  if (document.body) {
    document.body.replaceChildren();
  }
}

function scheduleYouTubeChannelBlockCheck(delay = 0) {
  window.setTimeout(() => {
    if (!isYouTube()) {
      youtubeChannelPageBlocked = false;
      return;
    }

    if (isYouTubeChannelPage()) {
      blockYouTubeChannelPage();
    }
  }, delay);
}

function ensureYouTubeChannelBlockObserver() {
  if (!isYouTube() || youtubeChannelBlockObserver) {
    return;
  }

  youtubeChannelBlockObserver = new MutationObserver(() => {
    if (!youtubeChannelPageBlocked) {
      scheduleYouTubeChannelBlockCheck(50);
    }
  });

  youtubeChannelBlockObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

async function getYouTubeUsageToday() {
  try {
    if (!isExtensionContextValid()) {
      return 0;
    }

    const today = new Date().toDateString();
    const data = await chrome.storage.local.get({ youtubeUsage: {} });
    return data.youtubeUsage[today] || 0;
  } catch (error) {
    return 0;
  }
}

async function saveYouTubeUsage(usageTime) {
  try {
    if (!isExtensionContextValid()) {
      return;
    }

    const today = new Date().toDateString();
    const data = await chrome.storage.local.get({ youtubeUsage: {} });
    data.youtubeUsage[today] = usageTime;
    await chrome.storage.local.set({ youtubeUsage: data.youtubeUsage });
  } catch (error) {
    return;
  }
}

async function checkYouTubeTimeLimit() {
  const usageToday = await getYouTubeUsageToday();
  if (usageToday >= YOUTUBE_TIME_LIMIT) {
    stopYouTubeTimer();
    showPopup('You have reached your 2.5-hour daily YouTube limit.');
    return true;
  }
  return false;
}

function updateTimerDisplay() {
  let timerElement = document.getElementById('yt-timer');
  
  if (!timerElement) {
    timerElement = document.createElement('div');
    timerElement.id = 'yt-timer';
    timerElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: #4ade80;
      padding: 15px 25px;
      border-radius: 10px;
       font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
      font-size: 32px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(timerElement);
  }
  
  getYouTubeUsageToday().then(usageToday => {
    const remaining = YOUTUBE_TIME_LIMIT - usageToday;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });
}

function startYouTubeTimer() {
  if (youtubeTimer) return;
  
  youtubeTimer = setInterval(() => {
    if (!isExtensionContextValid()) {
      stopYouTubeTimer();
      return;
    }

    void (async () => {
      try {
        const usageToday = await getYouTubeUsageToday();
        await saveYouTubeUsage(usageToday + TIME_UPDATE_INTERVAL);
        updateTimerDisplay();
        await checkYouTubeTimeLimit();
      } catch (error) {
        return;
      }
    })();
  }, TIME_UPDATE_INTERVAL);
  
  updateTimerDisplay();
}

function stopYouTubeTimer() {
  if (youtubeTimer) {
    clearInterval(youtubeTimer);
    youtubeTimer = null;
  }
  
  const timerElement = document.getElementById('yt-timer');
  if (timerElement) {
    timerElement.remove();
  }
}

function stopKhanAcademyTimer() {
  if (khanAcademyTimer) {
    clearTimeout(khanAcademyTimer);
    khanAcademyTimer = null;
    logKhanAcademy('Cleared pending timer');
  }
  khanAcademyTimerUrl = null;
}

function stopKhanAcademyProgressInterval() {
  if (khanAcademyProgressInterval) {
    clearInterval(khanAcademyProgressInterval);
    khanAcademyProgressInterval = null;
    logKhanAcademy('Cleared progress interval');
  }
}

function stopKhanAcademyInputAutofocusInterval() {
  if (khanAcademyInputAutofocusInterval) {
    clearInterval(khanAcademyInputAutofocusInterval);
    khanAcademyInputAutofocusInterval = null;
    logKhanAcademy('Cleared input autofocus interval');
  }
}

function startKhanAcademyInputAutofocusInterval() {
  if (khanAcademyInputAutofocusInterval || !isKhanAcademy()) {
    return;
  }

  khanAcademyInputAutofocusInterval = window.setInterval(() => {
    if (!isKhanAcademyExercisePage() || document.visibilityState !== 'visible') {
      return;
    }

    const targetElement = getKhanAcademyMainAnswerInput();
    if (!targetElement || document.activeElement === targetElement) {
      return;
    }

    if (isEditableElement(document.activeElement)) {
      return;
    }

    targetElement.focus();
    logKhanAcademy('Auto-focused main answer input', {
      targetTagName: targetElement.tagName
    });
  }, KHAN_ACADEMY_INPUT_AUTOFOCUS_INTERVAL);

  logKhanAcademy('Started input autofocus interval', {
    intervalMs: KHAN_ACADEMY_INPUT_AUTOFOCUS_INTERVAL
  });
}

function pauseKhanAcademySession() {
  if (!khanAcademySession?.visibleSinceMs) {
    return;
  }

  khanAcademySession.accumulatedVisibleMs += Date.now() - khanAcademySession.visibleSinceMs;
  khanAcademySession.visibleSinceMs = null;
  logKhanAcademy('Paused watch session', {
    url: khanAcademySession.url,
    accumulatedVisibleMs: khanAcademySession.accumulatedVisibleMs
  });
}

function resumeKhanAcademySession() {
  if (!khanAcademySession || khanAcademySession.completed || khanAcademySession.visibleSinceMs || document.visibilityState !== 'visible') {
    return;
  }

  khanAcademySession.visibleSinceMs = Date.now();
  logKhanAcademy('Resumed watch session', { url: khanAcademySession.url });
}

function resetKhanAcademySession() {
  if (khanAcademySession) {
    logKhanAcademy('Resetting watch session', {
      previousUrl: khanAcademySession.url
    });
  }

  pauseKhanAcademySession();
  stopKhanAcademyTimer();
  stopKhanAcademyProgressInterval();
  khanAcademySession = null;
}

function getKhanAcademyWatchedSeconds(session) {
  if (!session) {
    return 0;
  }

  const activeVisibleMs = session.visibleSinceMs ? Date.now() - session.visibleSinceMs : 0;
  const totalVisibleMs = (session.accumulatedVisibleMs + activeVisibleMs) * KHAN_ACADEMY_WATCH_SPEED_MULTIPLIER;
  return Math.min(
    session.ids.durationSeconds,
    Math.max(0, Math.floor(totalVisibleMs / 1000))
  );
}

function getKhanAcademyPath() {
  return window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildKhanAcademyHeaders(contentType = false) {
  const headers = {
    Accept: '*/*',
    'X-KA-FKEY': KHAN_ACADEMY_FKEY
  };

  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function getKhanAcademyContentForPathRequestParams() {
  const currentPath = getKhanAcademyPath();
  const resourceEntries = performance.getEntriesByType('resource');

  for (const entry of resourceEntries) {
    if (!entry?.name?.includes('/api/internal/graphql/ContentForPath')) {
      continue;
    }

    try {
      const url = new URL(entry.name);
      const variables = JSON.parse(url.searchParams.get('variables') || '{}');
      if (variables.path !== currentPath) {
        continue;
      }

      const hash = url.searchParams.get('hash');
      if (!hash) {
        continue;
      }

      return {
        fastlyCacheable: url.searchParams.get('fastly_cacheable') || 'persist_until_publish',
        hash,
        pcv: url.searchParams.get('pcv')
      };
    } catch (error) {
      continue;
    }
  }

  return null;
}

function waitForKhanAcademyContentForPathRequestParams() {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tryResolve = () => {
      const requestParams = getKhanAcademyContentForPathRequestParams();
      if (requestParams?.hash) {
        logKhanAcademy('Found ContentForPath request params', {
          hash: requestParams.hash,
          pcv: requestParams.pcv || null,
          attempts: attempts + 1
        });
        resolve(requestParams);
        return;
      }

      attempts += 1;
      if (attempts >= KHAN_ACADEMY_REQUEST_PARAM_MAX_ATTEMPTS) {
        reject(new Error('Unable to locate ContentForPath request parameters'));
        return;
      }

      window.setTimeout(tryResolve, KHAN_ACADEMY_REQUEST_PARAM_RETRY_MS);
    };

    tryResolve();
  });
}

async function fetchKhanAcademyContentForPath() {
  const path = getKhanAcademyPath();
  if (!path) {
    logKhanAcademy('No path found for ContentForPath request');
    return null;
  }

  logKhanAcademy('Waiting for ContentForPath request params');
  const requestParams = await waitForKhanAcademyContentForPathRequestParams();

  logKhanAcademy('Fetching ContentForPath metadata', {
    path,
    hash: requestParams.hash,
    pcv: requestParams.pcv || null
  });

  const url = new URL('https://www.khanacademy.org/api/internal/graphql/ContentForPath');
  url.searchParams.set('fastly_cacheable', requestParams.fastlyCacheable);
  if (requestParams.pcv) {
    url.searchParams.set('pcv', requestParams.pcv);
  }
  url.searchParams.set('hash', requestParams.hash);
  url.searchParams.set('variables', JSON.stringify({
    path,
    countryCode: KHAN_ACADEMY_COUNTRY_CODE
  }));
  url.searchParams.set('lang', KHAN_ACADEMY_LANG);
  url.searchParams.set('app', KHAN_ACADEMY_APP);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: buildKhanAcademyHeaders()
  });

  if (!response.ok) {
    throw new Error(`ContentForPath failed with status ${response.status}`);
  }

  return response.json();
}

function extractKhanAcademyIds(contentData) {
  const listedPathData = contentData?.data?.contentRoute?.listedPathData;
  const content = listedPathData?.content;
  const lesson = listedPathData?.lesson;
  const course = listedPathData?.course;

  if (!content || !lesson || !course) {
    logKhanAcademy('Missing content, lesson, or course data in ContentForPath response');
    return null;
  }

  const contentKind = (content.contentKind || '').toLowerCase();
  if (contentKind !== 'video') {
    logKhanAcademy('Current Khan Academy page is not a video lesson', {
      contentKind: content.contentKind || null
    });
    return null;
  }

  const lessonId = lesson.id;
  if (!lessonId) {
    return null;
  }

  const currentPath = window.location.pathname.replace(/\/+$/, '');
  const unit = (course.unitChildren || []).find((unitChild) => {
    const allChildren = unitChild?.allOrderedChildren || [];
    return allChildren.some((child) => {
      const childPath = child?.relativeUrl?.replace(/\/+$/, '');
      const canonicalPath = child?.canonicalUrl?.replace(/\/+$/, '');
      return child?.id === lessonId
        || child?.slug === lesson.slug
        || childPath === currentPath
        || canonicalPath === currentPath;
    });
  });

  const unitId = unit?.id;
  if (!unitId) {
    logKhanAcademy('Failed to resolve unitId for video lesson', {
      lessonId,
      lessonSlug: lesson.slug || null
    });
    return null;
  }

  logKhanAcademy('Resolved lesson and unit ids', {
    lessonId,
    unitId,
    contentId: content.id,
    durationSeconds: content.duration,
    masteryEnabled: Boolean(course.masteryEnabled)
  });

  return {
    lessonId,
    unitId,
    contentId: content.id,
    durationSeconds: content.duration,
    masteryEnabled: Boolean(course.masteryEnabled)
  };
}

function interpretKhanAcademyUserProgressResponse(responseData, expectedContentId) {
  const user = responseData?.data?.user;
  const progresses = user?.contentItemProgresses || [];
  const matchingProgress = progresses.find((item) => item?.content?.id === expectedContentId) || null;

  if (!matchingProgress) {
    return {
      ok: false,
      reason: 'missing-target-progress',
      targetStatus: null,
      targetContentId: expectedContentId,
      progressSummary: progresses.map((item) => ({
        id: item?.content?.id || null,
        kind: item?.content?.contentKind || null,
        status: item?.completionStatus || null
      }))
    };
  }

  return {
    ok: matchingProgress.completionStatus === 'COMPLETE',
    reason: matchingProgress.completionStatus === 'COMPLETE' ? 'complete' : 'not-complete',
    targetStatus: matchingProgress.completionStatus || null,
    targetContentId: expectedContentId,
    progressSummary: progresses.map((item) => ({
      id: item?.content?.id || null,
      kind: item?.content?.contentKind || null,
      status: item?.completionStatus || null
    }))
  };
}

async function fetchKhanAcademyUserProgress({ lessonId, unitId, contentId, masteryEnabled }) {
  const url = new URL('https://www.khanacademy.org/api/internal/graphql/userProgressForLesson');
  url.searchParams.set('lang', KHAN_ACADEMY_LANG);
  url.searchParams.set('app', KHAN_ACADEMY_APP);

  logKhanAcademy('Posting userProgressForLesson', {
    lessonId,
    unitId,
    contentId,
    masteryEnabled
  });

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: buildKhanAcademyHeaders(true),
    body: JSON.stringify({
      operationName: 'userProgressForLesson',
      query: `query userProgressForLesson($lessonId: String!, $unitId: String!, $masteryEnabled: Boolean!) {
  user {
    id
    contentItemProgresses(queryBy: {parentTopicId: $lessonId}) {
      ...BasicContentItemProgress
      ... on ExerciseItemProgress @include(if: $masteryEnabled) {
        lastCompletedAttempt {
          id
          lastAttemptDate
          numCorrect
          numAttempted
          __typename
        }
        updatedMasteryLevel
        __typename
      }
      __typename
    }
    latestQuizAttempts(topicId: $unitId) {
      id
      numCorrect
      numAttempted
      isCompleted
      positionKey
      __typename
    }
    latestUnitTestAttempts(unitId: $unitId) {
      id
      numCorrect
      numAttempted
      isCompleted
      topicId
      __typename
    }
    __typename
  }
}

fragment BasicContentItemProgress on ContentItemProgress {
  bestScore {
    numAttempted
    numCorrect
    completedDate
    __typename
  }
  completionStatus
  content {
    id
    contentKind
    contentDescriptor
    progressKey
    __typename
  }
  __typename
}`,
      variables: {
        lessonId,
        unitId,
        masteryEnabled
      }
    })
  });

  if (!response.ok) {
    throw new Error(`userProgressForLesson failed with status ${response.status}`);
  }

  const responseData = await response.json();
  const interpretation = interpretKhanAcademyUserProgressResponse(responseData, contentId);

  logKhanAcademy('userProgressForLesson completed', {
    status: response.status,
    interpretation
  });

  if (!interpretation.ok) {
    console.error('[KA tracker] userProgressForLesson did not mark the current video complete. Broken state detected.', interpretation);
  }

  return responseData;
}

async function updateKhanAcademyUserVideoProgress({ contentId, durationSeconds, secondsWatched, lastSecondWatched }) {
  const url = new URL('https://www.khanacademy.org/api/internal/graphql/updateUserVideoProgress');
  url.searchParams.set('lang', KHAN_ACADEMY_LANG);
  url.searchParams.set('app', KHAN_ACADEMY_APP);

  const normalizedDuration = Math.max(1, Math.ceil(Number(durationSeconds) || 0));
  const normalizedSecondsWatched = Math.min(
    normalizedDuration,
    Math.max(0, Number(secondsWatched) || 0)
  );
  const normalizedLastSecondWatched = Math.min(
    normalizedDuration,
    Math.max(normalizedSecondsWatched, Number(lastSecondWatched) || 0)
  );
  const timezoneOffsetSeconds = -new Date().getTimezoneOffset() * 60;

  const variables = {
    input: {
      contentId,
      secondsWatched: normalizedSecondsWatched,
      lastSecondWatched: normalizedLastSecondWatched,
      durationSeconds: normalizedDuration,
      captionsLocale: '',
      fallbackPlayer: false,
      localTimezoneOffsetSeconds: timezoneOffsetSeconds
    }
  };

  logKhanAcademy('Posting updateUserVideoProgress', variables);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: buildKhanAcademyHeaders(true),
    body: JSON.stringify({
      operationName: 'updateUserVideoProgress',
      variables,
      query: `mutation updateUserVideoProgress($input: UserVideoProgressInput!) {
  updateUserVideoProgress(videoProgressUpdate: $input) {
    videoItemProgress {
      content {
        id
        progressKey
        ... on Video {
          downloadUrls
          __typename
        }
        __typename
      }
      lastSecondWatched
      secondsWatched
      lastWatched
      points
      started
      completed
      __typename
    }
    actionResults {
      pointsEarned {
        points
        __typename
      }
      tutorialNodeProgress {
        contentId
        progress
        __typename
      }
      userProfile {
        countVideosCompleted
        points
        countBrandNewNotifications
        __typename
      }
      notificationsAdded {
        badges
        avatarParts
        readable
        urgent
        toast
        continueUrl
        __typename
      }
      ... on VideoActionResults {
        currentTask {
          id
          content {
            id
            __typename
          }
          pointBounty
          __typename
        }
        __typename
      }
      __typename
    }
    error {
      code
      debugMessage
      __typename
    }
    __typename
  }
}`
    })
  });

  if (!response.ok) {
    throw new Error(`updateUserVideoProgress failed with status ${response.status}`);
  }

  const responseData = await response.json();
  logKhanAcademy('updateUserVideoProgress completed', {
    status: response.status,
    result: responseData?.data?.updateUserVideoProgress || null
  });

  return responseData;
}

async function syncKhanAcademyWatchProgress(session) {
  if (!session || session.inFlight || session.completed) {
    return;
  }

  if (!isKhanAcademy() || window.location.href !== session.url) {
    logKhanAcademy('Stopping watch sync because URL changed', {
      expectedUrl: session.url,
      currentUrl: window.location.href
    });
    resetKhanAcademySession();
    return;
  }

  const watchedSeconds = getKhanAcademyWatchedSeconds(session);
  if (watchedSeconds <= session.lastReportedSeconds) {
    return;
  }

  try {
    session.inFlight = true;
    logKhanAcademy('Syncing watch progress', {
      url: session.url,
      watchedSeconds,
      lastReportedSeconds: session.lastReportedSeconds,
      durationSeconds: session.ids.durationSeconds
    });

    const updateResponse = await updateKhanAcademyUserVideoProgress({
      ...session.ids,
      secondsWatched: watchedSeconds,
      lastSecondWatched: watchedSeconds
    });

    session.lastReportedSeconds = watchedSeconds;
    const updateResult = updateResponse?.data?.updateUserVideoProgress;
    if (updateResult?.error) {
      console.error('[KA tracker] updateUserVideoProgress returned an error', updateResult.error);
      return;
    }

    if (watchedSeconds >= session.ids.durationSeconds) {
      await fetchKhanAcademyUserProgress(session.ids);
      session.completed = true;
      logKhanAcademy('Marked watch session complete', { url: session.url });
      resetKhanAcademySession();
    }
  } catch (error) {
    console.error('Khan Academy progress fetch failed:', error);
  } finally {
    if (session) {
      session.inFlight = false;
    }
  }
}

function startKhanAcademyProgressInterval() {
  stopKhanAcademyProgressInterval();
  khanAcademyProgressInterval = window.setInterval(() => {
    void syncKhanAcademyWatchProgress(khanAcademySession);
  }, KHAN_ACADEMY_PROGRESS_UPDATE_INTERVAL);
  logKhanAcademy('Started progress interval', {
    intervalMs: KHAN_ACADEMY_PROGRESS_UPDATE_INTERVAL
  });
}

async function startKhanAcademyWatchSession(expectedUrl) {
  if (!isKhanAcademy() || window.location.href !== expectedUrl) {
    logKhanAcademy('Skipping watch session start because URL changed', {
      expectedUrl,
      currentUrl: window.location.href
    });
    return;
  }

  logKhanAcademy('Timer fired for current video page', { url: expectedUrl });
  const contentData = await fetchKhanAcademyContentForPath();
  const ids = extractKhanAcademyIds(contentData);
  if (!ids) {
    logKhanAcademy('No lesson/unit ids available when timer fired');
    return;
  }

  khanAcademySession = {
    url: expectedUrl,
    ids,
    accumulatedVisibleMs: 0,
    visibleSinceMs: document.visibilityState === 'visible' ? Date.now() : null,
    lastReportedSeconds: 0,
    inFlight: false,
    completed: false
  };

  logKhanAcademy('Started watch session', {
    url: expectedUrl,
    durationSeconds: ids.durationSeconds,
    speedMultiplier: KHAN_ACADEMY_WATCH_SPEED_MULTIPLIER
  });

  startKhanAcademyProgressInterval();
  void syncKhanAcademyWatchProgress(khanAcademySession);
}

async function scheduleKhanAcademyVideoLessonTimer() {
  resetKhanAcademySession();
  if (!isKhanAcademy()) {
    khanAcademyObservedUrl = null;
    logKhanAcademy('Not on Khan Academy, skipping timer setup');
    return;
  }

  const currentUrl = window.location.href;
  if (khanAcademyObservedUrl === currentUrl) {
    logKhanAcademy('URL already observed, not scheduling duplicate timer', { url: currentUrl });
    return;
  }

  khanAcademyObservedUrl = currentUrl;
  logKhanAcademy('Evaluating current Khan Academy route', { url: currentUrl });

  try {
    const contentData = await fetchKhanAcademyContentForPath();
    const ids = extractKhanAcademyIds(contentData);
    if (!ids) {
      logKhanAcademy('Route does not need a timer');
      return;
    }

    khanAcademyTimerUrl = currentUrl;
    logKhanAcademy('Scheduling delayed progress fetch', {
      url: currentUrl,
      delayMs: KHAN_ACADEMY_VIDEO_DELAY
    });
    khanAcademyTimer = window.setTimeout(() => {
      void startKhanAcademyWatchSession(currentUrl);
    }, KHAN_ACADEMY_VIDEO_DELAY);
  } catch (error) {
    console.error('Khan Academy lesson metadata fetch failed:', error);
  }
}

function ensureKhanAcademyLocationObserver() {
  if (khanAcademyLocationObserver) {
    return;
  }

  khanAcademyLocationObserver = window.setInterval(() => {
    if (window.location.href === khanAcademyObservedUrl) {
      return;
    }

    logKhanAcademy('Detected Khan Academy SPA route change', {
      previousUrl: khanAcademyObservedUrl,
      nextUrl: window.location.href
    });
    void scheduleKhanAcademyVideoLessonTimer();
  }, 1000);
}

async function initYouTubeTracking() {
  if (!isExtensionContextValid()) {
    return;
  }

  if (isYouTube()) {
    youtubeChannelPageBlocked = false;
    ensureYouTubeChannelBlockObserver();
    scheduleYouTubeChannelBlockCheck();
    scheduleYouTubeChannelBlockCheck(250);
    scheduleYouTubeChannelBlockCheck(1000);

    if (isYouTubeChannelPage()) {
      blockYouTubeChannelPage();
      return;
    }
    if (await checkYouTubeTimeLimit()) {
      return;
    }
    startYouTubeTimer();
  } else {
    stopYouTubeTimer();
  }
}

async function initKhanAcademyTracking() {
  if (!isKhanAcademy()) {
    stopKhanAcademyInputAutofocusInterval();
    resetKhanAcademySession();
    logKhanAcademy('Initialization skipped because current site is not Khan Academy');
    return;
  }

  installKhanAcademyNetworkTracing();
  installKhanAcademyAnswerHotkeys();
  installKhanAcademyBannerHider();
  startKhanAcademyInputAutofocusInterval();
  logKhanAcademy('Initializing Khan Academy tracking', { url: window.location.href });
  ensureKhanAcademyLocationObserver();
  await scheduleKhanAcademyVideoLessonTimer();
}

document.addEventListener('visibilitychange', () => {
  void (async () => {
    try {
      if (!isExtensionContextValid()) {
        return;
      }

      if (isYouTube()) {
        if (document.visibilityState === 'visible') {
          if (!await checkYouTubeTimeLimit()) {
            startYouTubeTimer();
          }
        } else {
          stopYouTubeTimer();
        }
      }

      if (isKhanAcademy()) {
        if (document.visibilityState === 'visible') {
          resumeKhanAcademySession();
          void syncKhanAcademyWatchProgress(khanAcademySession);
        } else {
          pauseKhanAcademySession();
        }
      }
    } catch (error) {
      return;
    }
  })();
});

window.addEventListener('beforeunload', () => {
  if (!isExtensionContextValid()) {
    return;
  }

  stopYouTubeTimer();
  stopKhanAcademyInputAutofocusInterval();
  resetKhanAcademySession();
});

document.addEventListener('yt-navigate-finish', () => {
  youtubeChannelPageBlocked = false;
  void initYouTubeTracking();
});

function countKeywords(text) {
  return findBlockedKeywordMatches(text).length;
}

function findBlockedKeywordMatches(text) {
  const matches = [];

  BLOCKED_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(`(?<=\\s)${keyword}(?=\\s)`, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        keyword,
        index: match.index,
        end: match.index + keyword.length
      });
    }
  });

  return matches.sort((a, b) => a.index - b.index);
}

function getMainContent() {
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '.main-content',
    '.post-content',
    '.article-content'
  ];
  
  for (const selector of mainSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.innerText || element.textContent || '';
    }
  }
  
  return '';
}

function analyzePageContent() {
  const mainText = getMainContent();
  const allText = document.body.innerText || document.body.textContent || '';
  
  const mainCount = countKeywords(mainText);
  const totalCount = countKeywords(allText);
  
  const mainDensity = mainText.length > 0 ? mainCount / (mainText.length / 1000) : 0;
  const totalDensity = totalCount / (allText.length / 1000);
  
  return {
    mainText,
    allText,
    mainCount,
    totalCount,
    mainDensity,
    totalDensity
  };
}

function getKeywordContext(text, windowSize = 10) {
  const words = [];
  const wordRegex = /\b[\w']+\b/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    words.push({ word: match[0], index: match.index });
  }

  const keywordMatches = findBlockedKeywordMatches(text);
  if (keywordMatches.length === 0) {
    return '';
  }

  const firstMatch = keywordMatches[0];
  const keywordIndex = words.findIndex(entry => entry.index === firstMatch.index);

  if (keywordIndex === -1) {
    return '';
  }

  const start = Math.max(0, keywordIndex - windowSize);
  const end = Math.min(words.length, keywordIndex + windowSize + 1);
  return words.slice(start, end).map(entry => entry.word).join(' ');
}

async function isSexualContent(text) {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'REPLACE_ME') {
    return true;
  }

  try {
    const systemPrompt = 'You are a strict content safety filter. If the text contains adult sexual content or anything that can aid in masturbation (including product listings, instructions, advice, erotica, explicit terms, or sexual services), respond with exactly "BLOCK". If the text is about recovery, quitting, or help for reducing sexual/porn use, respond with exactly "ALLOW" even if sexual terms appear. Otherwise respond with exactly "ALLOW". No extra words.';
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `URL: ${window.location.href}\n\nTEXT:\n${text}` }
        ],
        temperature: 0,
        max_tokens: 5
      })
    });

    if (!response.ok) {
      return true;
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim().toUpperCase();
    return reply !== 'ALLOW';
  } catch (error) {
    return true;
  }
}

function showPopup(message) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000000;
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  const popup = document.createElement('div');
  popup.style.cssText = `
    background: #1a1a1a;
    padding: 40px;
    border-radius: 15px;
    text-align: center;
    max-width: 450px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #ffffff;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  `;
  
  popup.innerHTML = `
    <h2 style="color: #ffffff; margin-bottom: 20px; font-size: 24px; font-weight: 600;">Content Blocked</h2>
    <p style="color: #e0e0e0; margin-bottom: 15px; font-size: 16px; line-height: 1.5;">${message}</p>
    <p style="color: #a0a0a0; font-size: 14px;">You will be redirected in 3 seconds...</p>
  `;
  
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    window.location.href = 'chrome-extension://dgiopelblkcgmobjhbfpcdecdenihlcb/pages/UrgeTest_initial.html';
  }, 3000);
}

async function censorPage() {
  if (window.location.hostname.includes('wikipedia.org')) {
    return;
  }

  const analysis = analyzePageContent();
  const hasKeywords = analysis.mainCount > 0 || analysis.totalCount > 0;

  console.log('allText length:', analysis.allText.length);
  const chunkSize = 5000;
  for (let i = 0; i < analysis.allText.length; i += chunkSize) {
    console.log(analysis.allText.slice(i, i + chunkSize));
  }

  if (!hasKeywords) {
    return;
  }

  if (!analysis.allText) {
    return;
  }

  const contextText = getKeywordContext(analysis.allText, 50);

  if (!contextText) {
    return;
  }

  const isSexual = await isSexualContent(contextText);

  if (isSexual) {
    showPopup('This page contains adult content and has been blocked.');
  }
}

// Run when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void (async () => {
      try {
        await initYouTubeTracking();
        await initKhanAcademyTracking();
        await censorPage();
      } catch (error) {
        return;
      }
    })();
  });
} else {
  void (async () => {
    try {
      await initYouTubeTracking();
      await initKhanAcademyTracking();
      await censorPage();
    } catch (error) {
      return;
    }
  })();
}
