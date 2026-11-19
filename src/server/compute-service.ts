import {compute,rawPostgres} from '@prisma/composer-prisma-cloud';
import node from '@prisma/composer/node';
import {rawHttpContract} from '@prisma/composer/http';
import {secretString} from '@prisma/composer/zod';
import {z} from 'zod';

export default compute({
 name:'web',
 deps:{diary:rawPostgres()},
 input:z.object({
  username:secretString().optional(),password:secretString().optional(),
  openrouterKey:secretString().optional(),model:z.string(),sttModel:z.string(),publicOrigin:z.url(),timeZone:z.string()
 }),
 build:node({module:import.meta.url,dir:'../../.prisma-build',entry:'server.js'}),
 expose:{http:rawHttpContract}
});
