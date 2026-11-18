import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const {values}=parseArgs({options:{
  'database-id':{type:'string'},
  'database-name':{type:'string',default:'duoq-library'},
  'worker-name':{type:'string',default:'duoq-library'},
  help:{type:'boolean'}
}});
if(values.help){
  console.log('npm run cloudflare:prepare -- --database-id <D1 UUID> [--database-name duoq-library] [--worker-name duoq-library]');
  process.exit(0);
}
const databaseId=values['database-id'];
if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(databaseId??'')||databaseId==='00000000-0000-4000-8000-000000000000'){
  throw Error('Pass the real D1 database UUID from your own Cloudflare account with --database-id.');
}
for(const key of ['database-name','worker-name']){
  if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values[key]))throw Error(`Invalid --${key}. Use 1–63 lowercase letters, digits, underscores or hyphens.`);
}
const server=path.join(root,'dist/server');
let generated;
try{generated=JSON.parse(await fs.readFile(path.join(server,'wrangler.json'),'utf8'));}
catch{throw Error('Build the backend with npm run build before preparing a Cloudflare deployment.');}
const directory=path.join(root,'.cloudflare');
const relative=file=>path.relative(directory,file).replaceAll('\\','/');
const config={...generated,
  name:values['worker-name'],
  main:relative(path.resolve(server,generated.main)),
  assets:{...generated.assets,directory:relative(path.resolve(server,generated.assets.directory))},
  d1_databases:[{binding:'DB',database_name:values['database-name'],database_id:databaseId,migrations_dir:relative(path.join(root,'drizzle'))}]
};
delete config.topLevelName;
delete config.dev;
delete config.build;
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(path.join(directory,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
console.log('Prepared .cloudflare/wrangler.json for your account. No database was changed and no Worker was deployed.');
