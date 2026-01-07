// content.js - v8.3 (export csv button,add flash cards to anki,UI Polish,Duplicate Reporting)

(function () {
  const CONFIG = {
    BTN_QUIZ_ANKI: "btn-quiz-anki",
    BTN_QUIZ_TXT: "btn-quiz-txt",
    BTN_CARD_ANKI: "btn-card-anki",
    BTN_CARD_CSV: "btn-card-csv",
    ANCHOR_SELECTORS: ['button[aria-label="Good content rating"]', 'button[aria-label="Copy"]', 'button[aria-label="Download"]']
  };

  // --- 1. CSS ---
  function injectStyles() {
    if (document.getElementById('anki-extension-styles')) return;
    const style = document.createElement('style');
    style.id = 'anki-extension-styles';
    style.textContent = `.anki-extension-btn { border: 1px solid rgb(55,56,59) !important; border-radius: 18px !important; padding: 0 16px !important; margin-right: 8px !important; color: #e3e3e3 !important; height: 40px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; font-size: 14px !important; font-weight: 500 !important; background-color: transparent !important; transition: all 0.2s ease-in-out !important; } .anki-extension-btn:hover { background-color: rgba(168, 199, 250, 0.1) !important; border-color: #a8c7fa !important; color: #a8c7fa !important; } .anki-extension-btn.loading { opacity: 0.7; cursor: wait !important; pointer-events: none; border-color: #a8c7fa !important; color: #a8c7fa !important; } .anki-btn-icon { display: flex; align-items: center; gap: 8px; }`;
    document.head.appendChild(style);
  }

  // --- 2. DATA MINER ---
  function initDataMiner() {
    const appRoot = document.querySelector('[data-app-data]');
    if (appRoot) {
      window.addEventListener("message", (event) => {
        if (event.data.action === "PROBE_CONTENT") {
          try {
            const json = JSON.parse(unescapeHtml(appRoot.getAttribute('data-app-data')));
            if (json.quiz || (json.mostRecentQuery && json.mostRecentQuery.quiz)) window.top.postMessage({ action: "REPORT_TYPE", type: "QUIZ" }, "*");
            if (json.flashcards && Array.isArray(json.flashcards) && json.flashcards.length > 0) window.top.postMessage({ action: "REPORT_TYPE", type: "FLASHCARDS" }, "*");
          } catch (e) { }
        }
        if (event.data.action === "EXTRACT_REQUEST") {
          const jsonString = appRoot.getAttribute('data-app-data');
          const data = JSON.parse(unescapeHtml(jsonString));
          let title = event.data.title || data.title || "NotebookLM Export";
          title = title.replace(/::/g, " - ").trim();
          window.top.postMessage({ action: "DATA_EXTRACTED", data: data, mode: event.data.mode, finalTitle: title }, "*");
        }
      });
    }
  }

  // --- 3. UI HUB ---
  function initUiInjector() {
    injectStyles();
    window.addEventListener("message", (event) => {
      if (event.data.action === "REPORT_TYPE") renderButtons(event.data.type);
      if (event.data.action === "DATA_EXTRACTED") handleExtractedData(event.data.data, event.data.mode, event.data.finalTitle);
    });
    setInterval(() => {
      const anchor = document.querySelector(CONFIG.ANCHOR_SELECTORS[0]);
      if (anchor) {
        const container = anchor.closest('div.flex') || anchor.parentElement;
        if (container && !container.querySelector('.anki-extension-btn')) document.querySelectorAll('iframe').forEach(f => f.contentWindow.postMessage({ action: "PROBE_CONTENT" }, "*"));
      }
    }, 2000);
  }

  // --- 4. LOGIC ---
  function handleExtractedData(data, mode, finalTitle) {
    try {
      if (mode.includes('quiz')) {
        const quizData = data.quiz || (data.mostRecentQuery && data.mostRecentQuery.quiz);
        if (!quizData) throw new Error("No Quiz Found");
        const cards = quizData.map(q => ({
          question: q.question, hint: q.hint || "",
          option1: q.answerOptions[0]?.text || "", flag1: q.answerOptions[0]?.isCorrect ? "True" : "False", rationale1: q.answerOptions[0]?.rationale || "",
          option2: q.answerOptions[1]?.text || "", flag2: q.answerOptions[1]?.isCorrect ? "True" : "False", rationale2: q.answerOptions[1]?.rationale || "",
          option3: q.answerOptions[2]?.text || "", flag3: q.answerOptions[2]?.isCorrect ? "True" : "False", rationale3: q.answerOptions[2]?.rationale || "",
          option4: q.answerOptions[3]?.text || "", flag4: q.answerOptions[3]?.isCorrect ? "True" : "False", rationale4: q.answerOptions[3]?.rationale || ""
        }));
        if (mode === 'quiz_anki') sendToAnki("quiz", cards, finalTitle);
        else {
          let content = "# separator:Semicolon\n# html:true\n# notetype:NotebookLM Markdown\n# deck:NotebookLM::" + finalTitle + "\n";
          cards.forEach(c => {
            const fields = [c.question, c.hint, "", c.option1, c.rationale1, c.flag1, c.option2, c.flag2, c.rationale2, c.option3, c.flag3, c.rationale3, c.option4, c.flag4, c.rationale4];
            content += fields.map(escapeField).join(";") + "\n";
          });
          downloadFile(`${finalTitle}_Quiz.txt`, content);
        }
      } else if (mode.includes('card')) {
        const flashData = data.flashcards;
        if (!flashData) throw new Error("No Flashcards Found");
        const simpleCards = flashData.map(c => ({ front: c.f, back: c.b }));
        if (mode === 'card_anki') sendToAnki("flashcard", simpleCards, finalTitle);
        else {
          let content = "# separator:Comma\n# html:true\n# notetype:JigneshFlash\n# deck:Notebooklm Flashcards::" + finalTitle + "\n";
          simpleCards.forEach(c => { content += `${escapeField(c.front)},${escapeField(c.back)}\n`; });
          downloadFile(`${finalTitle}_Cards.csv`, content);
        }
      }
    } catch (e) { alert("Error: " + e.message); resetButtons(); }
  }

  function sendToAnki(type, batchData, deckTitle) {
    chrome.runtime.sendMessage({ action: "sendToAnki", type: type, batchData: batchData, deckTitle: deckTitle }, (res) => {
      resetButtons();
      if (chrome.runtime.lastError) { alert("Extension Error: " + chrome.runtime.lastError.message); return; }
      if (res && res.success) alert(`✅ Saved ${res.count} cards!`);
      else alert(`❌ Anki Error: ${res ? res.error : "Unknown"}`);
    });
  }

  function unescapeHtml(str) { return str ? str.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'") : ""; }
  function escapeField(str) { return `"${(str || "").replace(/"/g, '""').replace(/\n/g, "<br>")}"`; }

  async function downloadFile(filename, content) {
    resetButtons();
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: filename, types: [{ accept: { 'text/plain': ['.txt', '.csv'] } }] });
        const w = await h.createWritable(); await w.write(content); await w.close(); return;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content])); a.download = filename; a.click();
  }

  function resetButtons() {
    document.querySelectorAll('.anki-extension-btn').forEach(b => {
      b.classList.remove('loading');
      b.querySelector('span:last-child').innerText = b.dataset.originalText;
    });
  }

  function renderButtons(mode) {
    const anchor = document.querySelector(CONFIG.ANCHOR_SELECTORS[0]); if (!anchor) return;
    const container = anchor.closest('div.flex') || anchor.parentElement;
    container.querySelectorAll('.anki-extension-btn').forEach(b => b.remove());
    if (mode === 'QUIZ') {
      container.insertBefore(createBtn(CONFIG.BTN_QUIZ_TXT, "Quiz TXT", getTxtIcon(), 'quiz_txt'), container.firstChild);
      container.insertBefore(createBtn(CONFIG.BTN_QUIZ_ANKI, "Anki Export", getAnkiIcon(), 'quiz_anki'), container.firstChild);
    } else if (mode === 'FLASHCARDS') {
      container.insertBefore(createBtn(CONFIG.BTN_CARD_CSV, "Export CSV", getCsvIcon(), 'card_csv'), container.firstChild);
      container.insertBefore(createBtn(CONFIG.BTN_CARD_ANKI, "Add Cards to Anki", getAnkiIcon(), 'card_anki'), container.firstChild);
    }
  }

  function createBtn(id, text, icon, mode) {
    const btn = document.createElement("button");
    btn.id = id; btn.className = "anki-extension-btn"; btn.dataset.originalText = text;
    btn.innerHTML = `<span class="anki-btn-icon">${icon}<span>${text}</span></span>`;
    btn.onclick = () => {
      btn.classList.add('loading');
      btn.querySelector('span:last-child').innerText = "Processing...";
      const title = document.querySelector('.title-label')?.textContent.trim();
      document.querySelectorAll('iframe').forEach(f => f.contentWindow.postMessage({ action: "EXTRACT_REQUEST", title: title, mode: mode }, "*"));
      setTimeout(() => resetButtons(), 5000);
    };
    return btn;
  }
  function getAnkiIcon() { return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-1c0-2.33 4.67-3.5 7-3.5s7 1.17 7 3.5v1z"/></svg>`; }
  function getTxtIcon() { return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`; }
  function getCsvIcon() { return `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 18h16v2H4zM4 14h16v2H4zM4 10h16v2H4zM4 6h16v2H4z"/></svg>`; }
  initDataMiner(); initUiInjector();
})();