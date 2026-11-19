export const defaultAssistantModel='deepseek/deepseek-v4.1-flash-1017';
export const defaultTranscriptionModel='qwen/qwen3-asr-0.6b';

export const config={
 host:'127.0.0.1',port:3005,
 timeZone:'Europe/Berlin',
 publicOrigin:'',clientDirectory:'dist',
 authUsername:'',authPassword:'',
 model:defaultAssistantModel,openrouterApiKey:'',
 llmBaseUrl:'https://openrouter.ai/api/v1',
 sttUrl:'',sttModel:'',sttLanguage:'en',speechDebugDir:'./data/speech-debug',
 ttsUrl:'',ttsVoice:'Emily.wav'
};

export const assistantAvailable=()=>Boolean(config.openrouterApiKey.trim());

export const transcriptionAvailable=()=>assistantAvailable()&&Boolean(config.sttUrl||config.sttModel);
