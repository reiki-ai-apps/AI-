// 音声で探す(Web Speech API)。対応ブラウザ(スマホのChrome/Safari)でだけボタンを表示する。
export function attachVoiceSearch(input, button, onResult) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { button.hidden = true; return false; }
  const rec = new SR(); rec.lang = "ja-JP"; rec.interimResults = false; rec.maxAlternatives = 1;
  let listening = false;
  rec.onresult = e => { const t = e.results[0][0].transcript.replace(/[。、\s]/g, ""); input.value = t; onResult(t); };
  rec.onend = () => { listening = false; button.classList.remove("listening"); button.setAttribute("aria-pressed", "false"); };
  rec.onerror = () => { listening = false; button.classList.remove("listening"); };
  button.addEventListener("click", () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); listening = true; button.classList.add("listening"); button.setAttribute("aria-pressed", "true"); } catch { /* 連続クリック時 */ }
  });
  return true;
}
