/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Languages, 
  Mic, 
  MicOff, 
  Send, 
  Volume2, 
  RotateCcw, 
  History, 
  Settings2,
  Globe,
  MessageSquare,
  AlertCircle,
  Loader2,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Constants ---
const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
];

const TONES = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'formal', label: 'Formal' },
  { id: 'casual', label: 'Casual' },
  { id: 'professional', label: 'Professional' },
];

interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  timestamp: number;
}

export default function App() {
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [targetLang, setTargetLang] = useState('auto');
  const [detectedTargetLangCode, setDetectedTargetLangCode] = useState('en-US');
  const [tone, setTone] = useState('neutral');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isDetectingLang, setIsDetectingLang] = useState(false);
  const [history, setHistory] = useState<TranslationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [speakingRate, setSpeakingRate] = useState(1.0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const aiRef = useRef<GoogleGenAI | null>(null);

  // Initialize Gemini and Voices
  useEffect(() => {
    if (!aiRef.current) {
      aiRef.current = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY || '' 
      });
    }

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      
      // Deduplicate voices by URI and Name to prevent React key warnings
      // and redundant options in the dropdown.
      const uniqueVoices = availableVoices.filter((voice, index, self) =>
        index === self.findIndex((v) => (
          v.voiceURI === voice.voiceURI && v.name === voice.name
        ))
      );

      setVoices(uniqueVoices);
      // Set a default voice if none selected
      if (uniqueVoices.length > 0 && !selectedVoiceURI) {
        setSelectedVoiceURI(uniqueVoices[0].voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoiceURI]);

  // --- Handlers ---

  const handleTranslate = async (textOverride?: string, audioData?: { data: string, mimeType: string }) => {
    const textToTranslate = textOverride || sourceText;
    if (!textToTranslate && !audioData) return;

    setIsTranslating(true);
    setError(null);

    try {
      if (!aiRef.current) throw new Error("AI client not initialized");

      const isAutoTarget = targetLang === 'auto';
      const targetLangName = isAutoTarget ? 'the most appropriate language' : (SUPPORTED_LANGUAGES.find(l => l.code === targetLang)?.name || targetLang);
      
      const jsonInstructions = "Return ONLY a valid JSON object with exactly three keys: 'detectedSourceLanguage' (name of the original language), 'translatedText' (the translation), and 'targetLanguageCode' (the BCP 47 language code for the translation, e.g., 'es-ES' or 'en-US'). Do not include markdown formatting or extra text.";

      const autoTargetLogic = "If the source content is English, translate it to Spanish. If it is NOT English, translate it to English.";

      const contents = audioData 
        ? {
            parts: [
              { inlineData: audioData },
              { text: isAutoTarget 
                ? `${autoTargetLogic} Maintain a ${tone} tone. ${jsonInstructions}`
                : `Translate the speech in this audio to ${targetLangName} with a ${tone} tone. ${jsonInstructions}`
              }
            ]
          }
        : isAutoTarget
          ? `${autoTargetLogic} Maintain a ${tone} tone. ${jsonInstructions}\n\nContent: ${textToTranslate}`
          : `Translate the following to ${targetLangName} with a ${tone} tone. ${jsonInstructions}\n\nContent: ${textToTranslate}`;

      const response = await aiRef.current.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents,
      });

      const responseText = response.text || '';
      let parsed;
      try {
        // Handle potential markdown code blocks in response
        const cleanJson = responseText.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(cleanJson);
      } catch (e) {
        console.error("Failed to parse Gemini JSON:", responseText);
        parsed = { translatedText: responseText, detectedSourceLanguage: 'Unknown' };
      }

      setTranslatedText(parsed.translatedText);
      if (parsed.targetLanguageCode) {
        setDetectedTargetLangCode(parsed.targetLanguageCode);
      }

      // Add to history
      const finalTargetName = isAutoTarget 
        ? (SUPPORTED_LANGUAGES.find(l => parsed.targetLanguageCode?.startsWith(l.code))?.name || 'Auto')
        : targetLangName;

      const newResult: TranslationResult = {
        sourceText: textToTranslate || '[Speech Input]',
        translatedText: parsed.translatedText,
        sourceLanguage: parsed.detectedSourceLanguage,
        targetLanguage: finalTargetName,
        timestamp: Date.now(),
      };
      setHistory(prev => [newResult, ...prev].slice(0, 10));

    } catch (err) {
      console.error(err);
      setError("Failed to translate. Please check your connection or try again.");
    } finally {
      setIsTranslating(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          if (isDetectingLang) {
            handleDetectTargetLanguage(base64data);
          } else {
            handleTranslate('', { data: base64data, mimeType: 'audio/webm' });
          }
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Mode reset happens in onstop or start
    }
  };

  const handleDetectTargetLanguage = async (base64Audio: string) => {
    setIsTranslating(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error("AI client not initialized");

      const response = await aiRef.current.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Audio, mimeType: 'audio/webm' } },
            { text: `Identify the language name spoken in this audio. Return ONLY the standard English name of the language (e.g., 'Spanish', 'French', 'Chinese'). If not clear, return 'English'.` }
          ]
        },
      });

      const spokenLang = response.text?.trim() || 'English';
      const foundLang = SUPPORTED_LANGUAGES.find(l => 
        l.name.toLowerCase() === spokenLang.toLowerCase() || 
        spokenLang.toLowerCase().includes(l.name.toLowerCase())
      );

      if (foundLang) {
        setTargetLang(foundLang.code);
      } else {
        setError(`Could not accurately detect "${spokenLang}" in our supported list.`);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to detect language from speech.");
    } finally {
      setIsTranslating(false);
      setIsDetectingLang(false);
    }
  };

  const startTargetLangRecording = () => {
    setIsDetectingLang(true);
    startRecording();
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    if (!translatedText) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(translatedText);
    
    // Attempt to match language
    // Map common codes to broader BCP 47 if needed
    const langMap: Record<string, string> = {
      'zh': 'zh-CN',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'ar': 'ar-SA',
      'hi': 'hi-IN',
      'th': 'th-TH',
      'vi': 'vi-VN'
    };
    
    utterance.lang = targetLang === 'auto' ? detectedTargetLangCode : (langMap[targetLang] || targetLang);
    
    // Apply selected voice if available
    const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.rate = speakingRate;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const clear = () => {
    setSourceText('');
    setTranslatedText('');
    setError(null);
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#F8F9FA] font-sans text-[#1A1A1A]">
      {/* Sidebar - Streamlit Style */}
      <aside className="w-full md:w-80 bg-white border-r border-gray-200 p-6 flex flex-col gap-8 shadow-sm">
        <header className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Globe className="text-white w-6 h-6" />
          </div>
          <h1 className="font-bold text-xl tracking-tight">Gemini Translate Pro</h1>
        </header>

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            <Settings2 className="w-4 h-4" />
            Configuration
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Target Language</label>
            <div className="flex gap-2">
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
              <button
                onClick={isRecording && isDetectingLang ? stopRecording : startTargetLangRecording}
                title="Speak to set target language"
                className={`w-11 h-11 flex items-center justify-center rounded-lg transition-all ${
                  isRecording && isDetectingLang 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {isRecording && isDetectingLang ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Tone of Voice</label>
            <div className="grid grid-cols-2 gap-2">
              {TONES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTone(t.id)}
                  className={`p-2 text-xs font-medium rounded-md border transition-all ${
                    tone === t.id 
                    ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm' 
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Text-to-Speech Voice</label>
            <select 
              value={selectedVoiceURI}
              onChange={(e) => setSelectedVoiceURI(e.target.value)}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer"
            >
              {voices.map((voice, idx) => (
                <option key={`${voice.voiceURI}-${idx}`} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Speaking Rate</label>
              <span className="text-xs font-mono text-blue-600 font-bold">{speakingRate.toFixed(1)}x</span>
            </div>
            <input 
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speakingRate}
              onChange={(e) => setSpeakingRate(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </section>

        <section className="flex flex-col gap-4 mt-auto">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
            <History className="w-4 h-4" />
            Recent
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto max-h-[300px] pr-2">
            {history.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No recent translations</p>
            ) : (
              history.map((item, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={item.timestamp} 
                  className="p-3 bg-gray-50 rounded-lg text-xs"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-bold text-blue-600">{item.sourceLanguage}</span>
                    <Send className="w-2.5 h-2.5 text-gray-400" />
                    <span className="font-bold text-gray-700">{item.targetLanguage}</span>
                  </div>
                  <p className="text-gray-600 truncate italic">"{item.translatedText}"</p>
                  <p className="text-gray-400 mt-1.5 text-[10px]">{new Date(item.timestamp).toLocaleTimeString()}</p>
                </motion.div>
              ))
            )}
          </div>
        </section>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto flex flex-col gap-8">
          
          {/* Header Area */}
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-bold tracking-tight">Translation Hub</h2>
            <p className="text-gray-500">Transcribe speech or type text to translate instantly with Gemini AI.</p>
          </div>

          {/* Input Section */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                <MessageSquare className="w-4 h-4" />
                Source Content
              </div>
              <button 
                onClick={clear}
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                id="reset-btn"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>
            
            <textarea
              value={sourceText}
              id="source-textarea"
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Enter text here or use the microphone to translate speech..."
              className="w-full h-40 p-4 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-blue-100 outline-none text-lg resize-none transition-all placeholder:text-gray-300"
            />

            <div className="flex items-center gap-3">
              <button
                disabled={isTranslating}
                onClick={() => handleTranslate()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                id="translate-btn"
              >
                {isTranslating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Translate Text
              </button>
              
              <button
                onClick={isRecording ? stopRecording : startRecording}
                id="record-btn"
                className={`w-14 h-14 rounded-xl flex items-center justify-center transition-all ${
                  isRecording 
                  ? 'bg-red-50 text-red-500 animate-pulse border-red-100 border' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
            </div>
          </section>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Output Section */}
          <AnimatePresence mode="wait">
            {(translatedText || isTranslating) && (
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    <Languages className="w-4 h-4" />
                    Translation Output
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={copyToClipboard}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={handleSpeak}
                      className={`p-2 rounded-lg transition-colors ${isSpeaking ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`} 
                      title="Listen"
                    >
                      <Volume2 className={`w-4 h-4 ${isSpeaking ? 'animate-pulse' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="min-h-[100px] flex items-center">
                  {isTranslating ? (
                    <div className="flex flex-col gap-2 w-full">
                      <div className="h-4 bg-gray-100 rounded-full w-3/4 animate-pulse" />
                      <div className="h-4 bg-gray-100 rounded-full w-1/2 animate-pulse" />
                    </div>
                  ) : (
                    <p className="text-xl leading-relaxed text-gray-800 whitespace-pre-wrap">
                      {translatedText}
                    </p>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Footer Branding */}
          <footer className="mt-12 pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-400 italic">
            <p>Powered by Gemini 3 Flash & Google AI Studio</p>
            <div className="flex items-center gap-4 not-italic">
              <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /> System Active</span>
              <span className="flex items-center gap-1.5 opacity-50 cursor-not-allowed"><div className="w-2 h-2 rounded-full bg-gray-300" /> Premium Features</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
