// background.js - v8.3 (Supports Jignesh's NBLM flash cards and uses basic notetype if this card doesnt exist.)


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendToAnki") {

    // Helper: Send commands to AnkiConnect
    const invokeAnki = (action, params) => {
      return fetch('http://127.0.0.1:8765', {
        method: 'POST',
        body: JSON.stringify({ action, version: 6, params })
      }).then(res => res.json());
    };

    (async () => {
      try {
        let targetDeck = "";

        // --- QUIZ LOGIC (Standard) ---
        if (request.type === "quiz") {
          targetDeck = `NotebookLM::${request.deckTitle || "Default"}`;
          const noteType = "NotebookLM Markdown";

          const notes = request.batchData.map(card => ({
            "deckName": targetDeck,
            "modelName": noteType,
            "fields": {
              "Question": card.question, "Hint": card.hint, "ArchDiagram": "",
              "Option1": card.option1, "Rationale1": card.rationale1, "Flag1": card.flag1,
              "Option2": card.option2, "Rationale2": card.rationale2, "Flag2": card.flag2,
              "Option3": card.option3, "Rationale3": card.rationale3, "Flag3": card.flag3,
              "Option4": card.option4, "Rationale4": card.rationale4, "Flag4": card.flag4
            },
            "tags": ["notebooklm_quiz"]
          }));

          // Send Quiz
          await invokeAnki('createDeck', { deck: targetDeck });
          const result = await invokeAnki('addNotes', { notes });
          handleResponse(result, notes, noteType, sendResponse);
        }

        // --- FLASHCARD LOGIC (With Fallback) ---
        else if (request.type === "flashcard") {
          targetDeck = `Notebooklm Flashcards::${request.deckTitle || "Default"}`;
          await invokeAnki('createDeck', { deck: targetDeck });

          // Helper to build note objects for a given model
          const buildNotes = (model) => request.batchData.map(card => ({
            "deckName": targetDeck,
            "modelName": model,
            "fields": { "Front": card.front, "Back": card.back },
            "tags": ["notebooklm_flashcard"]
          }));

          // ATTEMPT 1: Try Primary Model (JigneshFlash)
          const primaryModel = "JigneshFlash";
          let currentNotes = buildNotes(primaryModel);
          let result = await invokeAnki('addNotes', { notes: currentNotes });

          // CHECK: Did it fail because the model is missing?
          if (result.error && result.error.toString().toLowerCase().includes("model was not found")) {
            console.log(`Primary model '${primaryModel}' missing. Falling back to 'Basic'.`);

            // ATTEMPT 2: Fallback Model (Basic)
            const fallbackModel = "Basic";
            currentNotes = buildNotes(fallbackModel);
            result = await invokeAnki('addNotes', { notes: currentNotes });

            // Process result of fallback
            handleResponse(result, currentNotes, fallbackModel, sendResponse);
          } else {
            // Process result of primary attempt
            handleResponse(result, currentNotes, primaryModel, sendResponse);
          }
        }

      } catch (error) {
        sendResponse({ success: false, error: "Connection Failed: " + error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }
});

// Helper to format the final response for the UI
function handleResponse(data, notes, noteType, sendResponse) {
  if (data.error) {
    sendResponse({ success: false, error: data.error });
  } else {
    // Count successful adds (ignoring nulls which are duplicates)
    const successCount = (data.result || []).filter(id => id !== null).length;

    if (successCount === 0 && notes.length > 0) {
      sendResponse({ success: false, error: `0 Cards Added. Check if Note Type '${noteType}' exists.` });
    } else {
      sendResponse({ success: true, count: successCount });
    }
  }
}