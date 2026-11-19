import {appRoot} from '@prisma/composer';
import {envSecret,publicUrl,rawPostgres} from '@prisma/composer-prisma-cloud';
import web from './src/server/compute-service.ts';
import {z} from 'zod';
import {defaultAssistantModel,defaultTranscriptionModel} from './src/server/settings.ts';

export default appRoot('babylog',{input:z.object({OPENROUTER_MODEL:z.string().default(defaultAssistantModel),OPENROUTER_STT_MODEL:z.string().default(defaultTranscriptionModel)})},({provision,input})=>{
 const diary=provision(rawPostgres({name:'diary'}));
 const app=provision(web,{
  deps:{diary},
  input:{username:envSecret('AUTH_USERNAME'),password:envSecret('AUTH_PASSWORD'),
   openrouterKey:envSecret('OPENROUTER_API_KEY'),model:input.OPENROUTER_MODEL,sttModel:input.OPENROUTER_STT_MODEL,
   publicOrigin:'https://babylog.vanderwalt.de',timeZone:'Europe/Berlin'}
 });
 provision(publicUrl({id:'url',url:publicUrl.prismaBuild(),target:app.http}));
});
