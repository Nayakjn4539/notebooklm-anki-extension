// content.js - v8.2 (Clean Data Pass-through)

(function() {
  const CONFIG = {
    ANKI_BTN_ID: "notebooklm-to-anki-btn",
    TXT_BTN_ID: "notebooklm-to-txt-btn",
    ANCHOR_SELECTORS: [
      'button[aria-label="Good content rating"]',
      'button[aria-label="Copy"]',
      'button[aria-label="Download"]'
    ]
  };

  // --- 1. DATA MINER (Runs inside the iframe) ---
  function initDataMiner() {
    const appRoot = document.querySelector('[data-app-data]');
    if (appRoot) {
      console.log("[Anki Bridge] ⛏️ Miner Ready");
      window.top.postMessage({ action: "ANKI_MINER_READY" }, "*");
      
      window.addEventListener("message", (event) => {
        if (event.data.action === "TRIGGER_EXTRACT") {
          const jsonString = appRoot.getAttribute('data-app-data');
          processBatch(jsonString, event.data.notebookTitle, event.data.mode);
        }
      });
    }
  }

  function unescapeHtml(str) {
    if (!str) return "";
    return str.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  }

  function escapeForCsv(str) {
    if (!str) return "";
    let s = str.replace(/"/g, '""'); 
    s = s.replace(/\n/g, "<br>");    
    return `"${s}"`;                 
  }

  function processBatch(jsonString, customNotebookTitle, mode) {
    try {
      const cleanJson = unescapeHtml(jsonString);
      const data = JSON.parse(cleanJson);
      const quizData = data.quiz || (data.mostRecentQuery && data.mostRecentQuery.quiz);
      
      if (!quizData || !Array.isArray(quizData) || quizData.length === 0) {
        window.top.postMessage({ action: "MINER_FAIL", error: "0 Questions Found." }, "*");
        return;
      }

      let finalTitle = customNotebookTitle || data.title || "Unknown Notebook";
      finalTitle = finalTitle.replace(/::/g, " - ").trim();

      const cards = quizData.map(q => {
        return {
          question: q.question,
          hint: q.hint || "",
          option1: q.answerOptions[0]?.text || "",
          flag1: q.answerOptions[0]?.isCorrect ? "True" : "False",
          rationale1: q.answerOptions[0]?.rationale || "", 
          option2: q.answerOptions[1]?.text || "",
          flag2: q.answerOptions[1]?.isCorrect ? "True" : "False",
          rationale2: q.answerOptions[1]?.rationale || "",
          option3: q.answerOptions[2]?.text || "",
          flag3: q.answerOptions[2]?.isCorrect ? "True" : "False",
          rationale3: q.answerOptions[2]?.rationale || "",
          option4: q.answerOptions[3]?.text || "",
          flag4: q.answerOptions[3]?.isCorrect ? "True" : "False",
          rationale4: q.answerOptions[3]?.rationale || "",
        };
      });

      if (mode === 'anki') {
        chrome.runtime.sendMessage({ 
          action: "sendBatchToAnki", 
          batchData: cards, 
          deckTitle: finalTitle 
        }, (res) => {
          if (res && res.success) {
            window.top.postMessage({ action: "MINER_SUCCESS", count: cards.length, deck: finalTitle, mode: 'anki' }, "*");
          } else {
            window.top.postMessage({ action: "MINER_FAIL", error: res ? res.error : "Unknown Error" }, "*");
          }
        });
      } 
      else if (mode === 'txt') {
        // Build TXT Content
        let fileContent = "# separator:Semicolon\n# html:true\n# notetype:NotebookLM Markdown\n# deck:NotebookLM::" + finalTitle + "\n";
        cards.forEach(c => {
          const fields = [
            c.question, c.hint, "", 
            c.option1, c.rationale1, c.flag1, 
            c.option2, c.flag2, c.rationale2, 
            c.option3, c.flag3, c.rationale3, 
            c.option4, c.flag4, c.rationale4
          ];
          fileContent += fields.map(f => escapeForCsv(f)).join(";") + "\n";
        });

        // Send payload to Top Window
        window.top.postMessage({ 
            action: "MINER_PAYLOAD_TXT", 
            content: fileContent, 
            filename: `${finalTitle.replace(/[^a-z0-9]/gi, '_')}.txt`
        }, "*");
      }

    } catch (e) {
      console.error(e);
      window.top.postMessage({ action: "MINER_FAIL", error: "JSON Parse Error: " + e.message }, "*");
    }
  }

  // --- 2. UI INJECTOR (Runs in Main Window) ---
  let isMinerConnected = false;
  
  // NEW: Modern Async Save Function
  async function triggerDownload(filename, content) {
    try {
      // 1. Try the Modern "Save As" Picker (Forces Window)
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Anki Import File',
            accept: {'text/plain': ['.txt']},
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return true; // Success
      }
    } catch (err) {
      if (err.name === 'AbortError') return false; // User clicked "Cancel" in the window
      console.log("SaveFilePicker not supported/allowed. Falling back...", err);
    }

    // 2. Fallback: Classic Download (Might be auto-saved by browser)
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  function initUiInjector() {
    window.addEventListener("message", async (event) => { // Made async
      if (event.data.action === "ANKI_MINER_READY") { 
        isMinerConnected = true; 
        updateButtonState(CONFIG.ANKI_BTN_ID, "ready", "Anki Export");
        updateButtonState(CONFIG.TXT_BTN_ID, "ready", "Extract TXT");
      }
      else if (event.data.action === "MINER_SUCCESS" && event.data.mode === 'anki') { 
        updateButtonState(CONFIG.ANKI_BTN_ID, "success", `Saved ${event.data.count}!`); 
      }
      // TXT Payload Received
      else if (event.data.action === "MINER_PAYLOAD_TXT") {
        const saved = await triggerDownload(event.data.filename, event.data.content);
        if (saved) {
           updateButtonState(CONFIG.TXT_BTN_ID, "success", "Saved!");
        } else {
           // User cancelled the "Save As" window
           updateButtonState(CONFIG.TXT_BTN_ID, "ready", "Extract TXT");
        }
      }
      else if (event.data.action === "MINER_FAIL") { 
        alert("⚠️ Export Failed: " + event.data.error); 
        updateButtonState(CONFIG.ANKI_BTN_ID, "error", "Error");
        updateButtonState(CONFIG.TXT_BTN_ID, "error", "Error");
      }
    });

    const observer = new MutationObserver(() => {
      let anchorBtn = null;
      for (const selector of CONFIG.ANCHOR_SELECTORS) {
        const found = document.querySelector(selector);
        if (found) { anchorBtn = found; break; }
      }

      if (anchorBtn) {
        const container = anchorBtn.closest('div.flex') || anchorBtn.parentElement;
        if (container) { 
          if (!document.getElementById(CONFIG.ANKI_BTN_ID)) {
             const ankiBtn = createButton(CONFIG.ANKI_BTN_ID, "Anki Export", getAnkiIcon(), "anki");
             container.insertBefore(ankiBtn, container.firstChild);
          }
          if (!document.getElementById(CONFIG.TXT_BTN_ID)) {
             const txtBtn = createButton(CONFIG.TXT_BTN_ID, "Extract TXT", getTxtIcon(), "txt");
             container.insertBefore(txtBtn, container.firstChild);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getNotebookTitle() {
    const input = document.querySelector('input[placeholder="Notebook title"]');
    if (input && input.value) return input.value.trim();
    const label = document.querySelector('.title-label');
    if (label && label.textContent) return label.textContent.trim();
    if (document.title && document.title.includes("- NotebookLM")) { return document.title.replace("- NotebookLM", "").trim(); }
    return null;
  }

  function createButton(id, text, svgIcon, mode) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "mdc-button mat-mdc-button mat-mdc-outlined-button mat-unthemed mat-mdc-button-base";
    btn.style.cssText = `border: 1px solid rgb(55, 56, 59); border-radius: 18px; padding: 0 15px; margin-right: 8px; color: #e3e3e3; height: 40px; display: inline-flex; align-items: center; justify-content: center; cursor: not-allowed; opacity: 0.5;`;
    
    btn.innerHTML = `<span class="mat-mdc-button-persistent-ripple mdc-button__ripple"></span><span class="mat-mdc-button-touch-target"></span><span class="mdc-button__label" style="display: flex; align-items: center; gap: 6px;">${svgIcon}<span>${text}</span></span>`;
    btn.disabled = true;
    
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!isMinerConnected) { alert("Wait for page to fully load..."); return; }
      const labelText = btn.querySelector(".mdc-button__label span:last-child");
      if(labelText) labelText.innerText = "Processing...";
      btn.style.borderColor = "#a8c7fa"; btn.style.color = "#a8c7fa";
      
      const deckName = getNotebookTitle();
      let manualName = deckName;
      if (!manualName) { manualName = prompt("Enter Notebook Name:"); if (!manualName) { updateButtonState(id, "ready", text); return; } }

      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => { 
        iframe.contentWindow.postMessage({ action: "TRIGGER_EXTRACT", notebookTitle: manualName, mode: mode }, "*"); 
      });
    };
    return btn;
  }

  function updateButtonState(id, state, textOverride) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const labelText = btn.querySelector(".mdc-button__label span:last-child");
    if (state === "ready") { 
      if(labelText) labelText.innerText = textOverride; 
      btn.style.opacity = "1"; btn.style.cursor = "pointer"; btn.style.borderColor = "rgb(55, 56, 59)"; btn.style.color = "#e3e3e3"; btn.disabled = false; 
    } 
    else if (state === "success") { 
      if(labelText) labelText.innerText = textOverride; 
      btn.style.borderColor = "#6dd58c"; btn.style.color = "#6dd58c"; 
      setTimeout(() => updateButtonState(id, "ready", id.includes("anki") ? "Anki Export" : "Extract TXT"), 3000); 
    }
    else if (state === "error") { 
      if(labelText) labelText.innerText = "Error"; 
      btn.style.borderColor = "#ffb4ab"; btn.style.color = "#ffb4ab"; 
      setTimeout(() => updateButtonState(id, "ready", id.includes("anki") ? "Anki Export" : "Extract TXT"), 3000); 
    }
  }

  function getAnkiIcon() { return `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>`; }
  function getTxtIcon() { return `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 0 24 24" width="18" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`; }

  initDataMiner();
  initUiInjector();
})();
