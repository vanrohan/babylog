import {config,defaultAssistantModel,defaultTranscriptionModel} from '../../src/server/settings.ts';

Object.assign(config,{
 openrouterApiKey:process.env.OPENROUTER_API_KEY?.trim()??'',
 model:process.env.OPENROUTER_MODEL?.trim()||defaultAssistantModel,
 sttModel:process.env.OPENROUTER_STT_MODEL?.trim()??defaultTranscriptionModel,
 sttUrl:process.env.STT_URL?.trim()??'',
 ttsUrl:process.env.TTS_URL?.trim()??'',
 ttsVoice:process.env.TTS_VOICE??'Emily.wav'
});

export {config};
