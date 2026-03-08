// Content Censor Extension
const BLOCKED_KEYWORDS = ['sex', 'porn', 'anal', 'xxx', 'nsfw', 'erotic', 'hardcore', 'adult'];
const BLOCKED_KEYWORD_SET = new Set(BLOCKED_KEYWORDS);
const OPENROUTER_API_KEY = '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';
const OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const YOUTUBE_TIME_LIMIT = 24 * 60 * 60 * 1000; // 2 hours in milliseconds
const TIME_UPDATE_INTERVAL = 1000; // Update every second
let youtubeTimer = null;
let youtubeChannelBlockObserver = null;
let youtubeChannelPageBlocked = false;
const YOUTUBE_CHANNEL_BLOCK_STYLE_ID = 'youtube-channel-block-style';
const GOOGLE_RESULTS_BLOCK_STYLE_ID = 'google-results-block-style';

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

function isGoogleDomain() {
  return /(^|\.)google\.[a-z.]+$/i.test(window.location.hostname);
}

function ensureGoogleSearchBlockStyles() {
  if (!isGoogleDomain() || !document.head) {
    return;
  }

  let styleElement = document.getElementById(GOOGLE_RESULTS_BLOCK_STYLE_ID);
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = GOOGLE_RESULTS_BLOCK_STYLE_ID;
    document.head.appendChild(styleElement);
  }

  styleElement.textContent = `
    div.ULSxyf div.MjjYud {
      display: none !important;
    }
  `;
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
});

document.addEventListener('yt-navigate-finish', () => {
  youtubeChannelPageBlocked = false;
  void initYouTubeTracking();
});

function countKeywords(text) {
  const lowerText = text.toLowerCase();
  let count = 0;
  
  BLOCKED_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      count += matches.length;
    }
  });
  
  return count;
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

  const keywordIndex = words.findIndex(entry => BLOCKED_KEYWORD_SET.has(entry.word.toLowerCase()));

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
        ensureGoogleSearchBlockStyles();
        await initYouTubeTracking();
        await censorPage();
      } catch (error) {
        return;
      }
    })();
  });
} else {
  void (async () => {
    try {
      ensureGoogleSearchBlockStyles();
      await initYouTubeTracking();
      await censorPage();
    } catch (error) {
      return;
    }
  })();
}
