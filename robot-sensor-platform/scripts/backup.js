import {DatabaseSync} from 'node:sqlite';
import {mkdir,cp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const data=resolve(process.env.DATA_DIR||join(root,'data'));
const dest=resolve(process.env.BACKUP_DIR||join(root,'backups'));
const name='sensorlog-'+new Date().toISOString().replace(/[:.]/g,'-'),target=join(dest,name);
await mkdir(target,{recursive:true});
const db=new DatabaseSync(join(data,'app.db'));
try{db.exec(`VACUUM INTO '${join(target,'app.db').replaceAll("'","''")}'`);}finally{db.close();}
await cp(join(data,'photos'),join(target,'photos'),{recursive:true});
await cp(join(data,'models'),join(target,'models'),{recursive:true});
await writeFile(join(target,'backup.json'),JSON.stringify({type:'sensorlog-backup',created_at:new Date().toISOString(),version:1},null,2));
const names=(await readdir(dest,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^sensorlog-\d{4}-\d{2}-\d{2}T/.test(d.name)).map(d=>d.name).sort().reverse();
for(const old of names.slice(7)){
 const path=resolve(dest,old);
 if(!path.startsWith(dest+sep))throw new Error('Backup path escaped intended directory');
 const marker=JSON.parse(await readFile(join(path,'backup.json'),'utf8').catch(()=>'{}'));
 if(marker.type==='sensorlog-backup')await rm(path,{recursive:true});
}
console.log('백업 완료:',target,'(최근 7회 보관)');
