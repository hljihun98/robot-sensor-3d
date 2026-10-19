import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { parse } from 'csv-parse/sync';
import { randomUUID,createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname,join,resolve } from 'node:path';
import { writeFile,readFile,unlink } from 'node:fs/promises';
import { openDatabase,slots,now,today } from './db.js';
import { installAuth,requireRole } from './auth.js';
import { fail,text,date,payload } from './validation.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createApp({dataDir=process.env.DATA_DIR||join(root,'data'),initialPassword=process.env.INITIAL_ADMIN_PASSWORD,secure=process.env.COOKIE_SECURE==='true'}={}) {
 const app=express(),store=openDatabase(dataDir,initialPassword),{db,get,all,run,tx,audit}=store;
 app.disable('x-powered-by');
 if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
 const mapHash=createHash('sha256').update('{"imports":{"three":"/vendor/three.js","three/addons/":"/vendor/addons/"}}').digest('base64');
 app.use(helmet({contentSecurityPolicy:{directives:{'default-src':["'self'"],'script-src':["'self'",`'sha256-${mapHash}'`], 'style-src':["'self'","'unsafe-inline'"], 'img-src':["'self'",'data:','blob:'],'connect-src':["'self'",'blob:'],'worker-src':["'self'",'blob:'],'upgrade-insecure-requests':secure?[]:null}},hsts:secure?undefined:false}));
 app.use(express.json({limit:'1mb'}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 installAuth(app,store,{secure});
 const admin=requireRole('ADMIN','SYSADMIN'),sys=requireRole('SYSADMIN');
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:5,fields:20,fieldSize:1024*1024}}).array('photos',5);
 const single=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}}).single('file');
 const sensor=id=>{const s=get('SELECT s.*,m.label,m.file FROM sensors s JOIN models m ON m.id=s.model WHERE s.id=?',Number(id));if(!s)fail('센서를 찾을 수 없습니다.',404);return s;};
 const robot=no=>{const r=get('SELECT * FROM robots WHERE no=?',Number(no));if(!r)fail('호기를 찾을 수 없습니다.',404);return r;};
 const report=id=>{const r=get('SELECT r.*,u.name reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id WHERE r.id=?',Number(id));if(!r)fail('신고를 찾을 수 없습니다.',404);return {...r,payload:JSON.parse(r.payload),photos:JSON.parse(r.photos)};};
 const damage=id=>{const d=get('SELECT * FROM damages WHERE id=?',id);if(!d)fail('파손을 찾을 수 없습니다.',404);return {id:d.id,sensor_id:d.sensor_id,...JSON.parse(d.snapshot)};};
 const editable=r=>{if(!['SUBMITTED','IN_REVIEW'].includes(r.status))fail('현재 상태에서는 처리할 수 없습니다.',409);};
 const photoRefs=r=>all('SELECT photos FROM reports WHERE reporter_id=?',r.user.id).some(x=>JSON.parse(x.photos).some(p=>p.id===r.params.id));
 async function savePhotos(files=[]) {
   const result=[];
   try { for(const f of files){
     const img=sharp(f.buffer,{limitInputPixels:40000000}),meta=await img.metadata();
     if(!['jpeg','png','webp'].includes(meta.format))fail('사진은 JPEG, PNG, WebP만 가능합니다.');
     const id=randomUUID(),ext={jpeg:'jpg',png:'png',webp:'webp'}[meta.format];
     const p={id,name:f.originalname.slice(0,120),ext,url:`/files/photos/${id}/view`,thumb:`/files/photos/${id}/thumb`,original:`/files/photos/${id}/original`};result.push(p);
     await writeFile(join(dataDir,'photos',`${id}.${ext}`),f.buffer);
     await img.clone().rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toFile(join(dataDir,'photos',`${id}-view.jpg`));
     await img.clone().rotate().resize(300,220,{fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toFile(join(dataDir,'photos',`${id}-thumb.jpg`));
   }return result;}catch(e){await removePhotos(result);throw e;}
 }
 async function removePhotos(photos){await Promise.all(photos.flatMap(p=>[`${p.id}.${p.ext}`,`${p.id}-view.jpg`,`${p.id}-thumb.jpg`]).map(n=>unlink(join(dataDir,'photos',n)).catch(()=>{})));}
 function event(id,kind,actor,before,after,note='',photos=[]){run('INSERT INTO damage_events(damage_id,kind,at,actor_id,before_json,after_json,note,photos) VALUES(?,?,?,?,?,?,?,?)',id,kind,now(),actor,before?JSON.stringify(before):null,JSON.stringify(after),note,JSON.stringify(photos));run('UPDATE damages SET snapshot=? WHERE id=?',JSON.stringify(after),id);audit(actor,kind,id,{note});}
 function confirm(sensor_id,p,photos,actor,reporterName){
   const id=`D-${today().slice(0,4)}-${randomUUID().slice(0,8).toUpperCase()}`;
   const inspection=get("SELECT at FROM inspections WHERE sensor_id=? AND result='NO_NEW' AND date(at,'+9 hours')<=? ORDER BY at DESC LIMIT 1",sensor_id,p.found_at);
   const snapshot={...p,status:'ACTIVE',severity:null,confirmed_at:now(),confirmed_by:get('SELECT name FROM users WHERE id=?',actor).name,reporter_name:reporterName,occurred_from:inspection?.at||null,closed_at:null,photos};
   run('INSERT INTO damages VALUES(?,?,?)',id,sensor_id,JSON.stringify(snapshot));event(id,'CONFIRMED',actor,null,snapshot,p.note,photos);return id;
 }
 function damagesAt(sensorId,at,status='ACTIVE'){
   return all('SELECT * FROM damages WHERE sensor_id=?',sensorId).map(d=>{
     let s=JSON.parse(d.snapshot);
     if(at){const ev=all('SELECT * FROM damage_events WHERE damage_id=? ORDER BY id',d.id);s=JSON.parse(ev[0].after_json);for(const e of ev.slice(1))if(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(e.at))<=at)s=JSON.parse(e.after_json);}
     return {id:d.id,sensor_id:d.sensor_id,...s};
   }).filter(d=>(!at||d.found_at<=at)&&(status==='ALL'||d.status===status));
 }
 app.get('/api/summary',(req,res)=>res.json({active:get("SELECT count(*) n FROM robots WHERE status='ACTIVE'").n,disposed:get("SELECT count(*) n FROM robots WHERE status='DISPOSED'").n,damages:all('SELECT snapshot FROM damages').filter(d=>JSON.parse(d.snapshot).status==='ACTIVE').length,pending:req.user.role==='FIELD'?get("SELECT count(*) n FROM reports WHERE reporter_id=? AND status IN ('SUBMITTED','IN_REVIEW','NEED_INFO')",req.user.id).n:get("SELECT count(*) n FROM reports WHERE status IN ('SUBMITTED','IN_REVIEW')").n}));
 app.get('/api/robots',(req,res)=>{
   const rows=all('SELECT * FROM robots ORDER BY no').filter(r=>(!req.query.q||String(r.no).includes(String(req.query.q)))&&(req.query.status==='ALL'||r.status===(req.query.status||'ACTIVE')));
   res.json(rows.map(r=>({...r,damage_count:get("SELECT count(*) n FROM damages d JOIN mounts m ON m.sensor_id=d.sensor_id WHERE m.robot_no=? AND m.unmounted_at IS NULL AND json_extract(d.snapshot,'$.status')='ACTIVE'",r.no).n,verified:get('SELECT count(*) n FROM sensors s JOIN mounts m ON s.id=m.sensor_id WHERE m.robot_no=? AND m.unmounted_at IS NULL AND s.verified=1',r.no).n})));
 });
 app.get('/api/robots/:no',(req,res)=>{const r=robot(req.params.no);res.json({...r,sensors:all('SELECT s.*,m.slot,m.position,mo.label,mo.file FROM mounts m JOIN sensors s ON s.id=m.sensor_id JOIN models mo ON mo.id=s.model WHERE m.robot_no=? AND m.unmounted_at IS NULL ORDER BY m.slot',r.no).map(s=>({...s,damage_count:damagesAt(s.id,null).length,pending:get("SELECT count(*) n FROM reports WHERE sensor_id=? AND status IN ('SUBMITTED','IN_REVIEW','NEED_INFO') AND (?<>'FIELD' OR reporter_id=?)",s.id,req.user.role,req.user.id).n,last_changed:get('SELECT max(e.at) at FROM damage_events e JOIN damages d ON e.damage_id=d.id WHERE d.sensor_id=?',s.id).at}))});});
 app.get('/api/robots/:no/qr',async(req,res)=>{robot(req.params.no);const base=process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`;res.type('png').send(await QRCode.toBuffer(`${base}/robot/${req.params.no}`,{width:360,margin:2}));});
 app.get('/api/sensors',(req,res)=>res.json(all("SELECT * FROM sensors WHERE status='SPARE' ORDER BY id")));
 app.get('/api/admin/disposed-sensors/:no',admin,(req,res)=>{robot(req.params.no);res.json(all('SELECT DISTINCT s.*,m.slot FROM mounts m JOIN sensors s ON s.id=m.sensor_id WHERE m.robot_no=? AND m.unmounted_at IS NOT NULL ORDER BY m.id DESC',Number(req.params.no)));});
 app.get('/api/sensors/:id',(req,res)=>res.json({...sensor(req.params.id),mounts:all('SELECT * FROM mounts WHERE sensor_id=? ORDER BY id DESC',Number(req.params.id))}));
 app.get('/api/sensors/:id/damages',(req,res)=>{const s=sensor(req.params.id),at=req.query.at?date(req.query.at):null;res.json(damagesAt(s.id,at,req.query.status||'ACTIVE'));});
 app.get('/api/sensors/:id/history',(req,res)=>{const s=sensor(req.params.id);res.json([...all('SELECT e.id,e.damage_id,e.kind,e.at,e.note,u.name actor FROM damage_events e JOIN damages d ON d.id=e.damage_id JOIN users u ON u.id=e.actor_id WHERE d.sensor_id=?',s.id),...all("SELECT i.id,'INSPECTED' kind,i.at,i.note,u.name actor FROM inspections i JOIN users u ON u.id=i.actor_id WHERE sensor_id=?",s.id),...all("SELECT id,'MOUNTED' kind,mounted_at at,'호기 '||robot_no||' · '||slot note,'장착 기록' actor FROM mounts WHERE sensor_id=?",s.id),...all("SELECT id,'UNMOUNTED' kind,unmounted_at at,'호기 '||robot_no||' · '||slot note,'탈착 기록' actor FROM mounts WHERE sensor_id=? AND unmounted_at IS NOT NULL",s.id)].sort((a,b)=>b.at.localeCompare(a.at)));});
 app.post('/api/sensors/:id/inspections',(req,res)=>{const s=sensor(req.params.id);if(s.status==='DISPOSED')fail('폐기 센서는 점검할 수 없습니다.');const note=text(req.body.note||'',1000);tx(()=>{run("INSERT INTO inspections(sensor_id,at,actor_id,result,note) VALUES(?,?,?,'NO_NEW',?)",s.id,now(),req.user.id,note);audit(req.user.id,'INSPECTED',s.id,{note});});res.json({ok:true});});
 app.get('/api/damages/:id',(req,res)=>{const d=damage(req.params.id);res.json({...d,events:all('SELECT e.*,u.name actor FROM damage_events e JOIN users u ON u.id=e.actor_id WHERE damage_id=? ORDER BY e.id DESC',d.id).map(e=>({...e,before:e.before_json?JSON.parse(e.before_json):null,after:JSON.parse(e.after_json),photos:JSON.parse(e.photos)}))});});
 app.get('/api/reports',(req,res)=>{const mine=req.user.role==='FIELD'||req.query.mine==='1';let rows=all('SELECT r.*,u.name reporter_name,s.serial,s.model,m.slot FROM reports r JOIN users u ON u.id=r.reporter_id JOIN sensors s ON s.id=r.sensor_id LEFT JOIN mounts m ON m.sensor_id=s.id AND m.unmounted_at IS NULL ORDER BY r.created_at');if(mine)rows=rows.filter(r=>r.reporter_id===req.user.id);if(req.query.status&&req.query.status!=='ALL')rows=rows.filter(r=>r.status===req.query.status);res.json(rows.map(r=>({...r,payload:JSON.parse(r.payload),photos:JSON.parse(r.photos)})));});
 app.post('/api/reports',upload,async(req,res)=>{
   const s=sensor(req.body.sensor_id);if(s.status==='DISPOSED')fail('폐기 센서에는 신고할 수 없습니다.');const p=payload(req.body.payload,today());
   if((req.files?.length||0)<2)fail('전체 사진과 근접 사진을 최소 2장 첨부하세요.');
   const photos=await savePhotos(req.files);try{const id=tx(()=>{const mount=get('SELECT robot_no FROM mounts WHERE sensor_id=? AND unmounted_at IS NULL',s.id);const id=Number(run('INSERT INTO reports(sensor_id,robot_no,reporter_id,payload,photos,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',s.id,mount?.robot_no||null,req.user.id,JSON.stringify(p),JSON.stringify(photos),now(),now()).lastInsertRowid);audit(req.user.id,'REPORT_SUBMITTED',id);return id;});res.status(201).json({id});}catch(e){await removePhotos(photos);throw e;}
 });
 app.post('/api/reports/:id/reply',upload,async(req,res)=>{
   const r=report(req.params.id);if(r.reporter_id!==req.user.id)fail('본인의 신고만 보완할 수 있습니다.',403);if(r.status!=='NEED_INFO')fail('보완요청 상태가 아닙니다.',409);
   const note=text(req.body.note,2000,true),photos=await savePhotos(req.files);
   try{tx(()=>{const fresh=report(r.id);if(fresh.status!=='NEED_INFO')fail('신고 상태가 변경되었습니다.',409);run("UPDATE reports SET status='IN_REVIEW',payload=?,photos=?,updated_at=? WHERE id=?",JSON.stringify({...r.payload,note:r.payload.note+'\n[보완] '+note}),JSON.stringify([...r.photos,...photos]),now(),r.id);audit(req.user.id,'REPORT_REPLIED',r.id,{note});});res.json({ok:true});}catch(e){await removePhotos(photos);throw e;}
 });
 app.post('/api/reports/:id/review',admin,(req,res)=>{tx(()=>{const r=report(req.params.id);editable(r);run("UPDATE reports SET status='IN_REVIEW',reviewer_id=?,updated_at=? WHERE id=?",req.user.id,now(),r.id);audit(req.user.id,'REPORT_REVIEWED',r.id);});res.json({ok:true});});
 for(const [route,status] of [['request-info','NEED_INFO'],['reject','REJECTED']])app.post(`/api/reports/:id/${route}`,admin,(req,res)=>{const reason=text(req.body.reason,1000,true);tx(()=>{const r=report(req.params.id);editable(r);run('UPDATE reports SET status=?,reason=?,reviewer_id=?,updated_at=? WHERE id=?',status,reason,req.user.id,now(),r.id);audit(req.user.id,status,r.id,{reason});});res.json({ok:true});});
 app.post('/api/reports/:id/approve',admin,(req,res)=>{
   const id=tx(()=>{const r=report(req.params.id);editable(r);if(sensor(r.sensor_id).status==='DISPOSED')fail('폐기 센서의 신고는 승인할 수 없습니다.');
     const p=payload(req.body.payload||r.payload,today());let id;
     if(req.body.merge_id){const d=damage(String(req.body.merge_id));if(d.sensor_id!==r.sensor_id||d.status!=='ACTIVE')fail('같은 센서의 현존 파손에만 합칠 수 있습니다.');const {id:_,sensor_id:__,...before}=d;const after={...before,...(req.body.change?p:{}),photos:[...before.photos,...r.photos]};event(d.id,req.body.change?'CHANGED':'MERGED',req.user.id,before,after,text(req.body.reason||'신고 병합',1000),r.photos);id=d.id;}
     else id=confirm(r.sensor_id,p,r.photos,req.user.id,r.reporter_name);
     run("UPDATE reports SET status='APPROVED',reviewer_id=?,updated_at=?,damage_id=?,payload=? WHERE id=?",req.user.id,now(),id,JSON.stringify(p),r.id);audit(req.user.id,'REPORT_APPROVED',r.id,{damage_id:id});return id;
   });res.json({id});
 });
 app.post('/api/damages',admin,upload,async(req,res)=>{const s=sensor(req.body.sensor_id);if(s.status==='DISPOSED')fail('폐기 센서에는 등록할 수 없습니다.');const p=payload(req.body.payload,today());if((req.files?.length||0)<2)fail('전체 사진과 근접 사진이 필요합니다.');const photos=await savePhotos(req.files);try{const id=tx(()=>confirm(s.id,p,photos,req.user.id,req.user.name));res.status(201).json({id});}catch(e){await removePhotos(photos);throw e;}});
 app.patch('/api/damages/:id',admin,upload,async(req,res)=>{
   const d=damage(req.params.id),note=text(req.body.reason,1000,true),action=req.body.action;
   if(!['REPAIRED','CLOSED','CORRECTED','CHANGED'].includes(action))fail('올바른 변경 유형을 선택하세요.');
   if(d.status!=='ACTIVE')fail('종료된 파손은 변경할 수 없습니다.',409);
   if(['REPAIRED','CHANGED'].includes(action)&&!req.files?.length)fail('수리 또는 변화 확인 사진이 필요합니다.');
   const corrected=['CORRECTED','CHANGED'].includes(action)?payload(req.body.payload,today()):null;
   const photos=await savePhotos(req.files);try{tx(()=>{const fresh=damage(d.id);if(JSON.stringify(fresh)!==JSON.stringify(d))fail('다른 사용자가 수정했습니다. 다시 열어주세요.',409);const{id:_,sensor_id:__,...before}=d;const after={...before,...corrected,photos:[...before.photos,...photos]};if(['REPAIRED','CLOSED'].includes(action)){after.status=action;after.closed_at=now();}event(d.id,action,req.user.id,before,after,note,photos);});res.json({ok:true});}catch(e){await removePhotos(photos);throw e;}
 });
 app.get('/files/photos/:id/:variant',(req,res)=>{
   const {id,variant}=req.params;if(!/^[a-f0-9-]{36}$/.test(id)||!['view','thumb','original'].includes(variant))fail('사진을 찾을 수 없습니다.',404);
   const published=all('SELECT photos FROM damage_events').flatMap(e=>JSON.parse(e.photos)).find(p=>p.id===id);
   const allowed=published||(req.user.role!=='FIELD'||photoRefs(req)?all('SELECT photos FROM reports').flatMap(e=>JSON.parse(e.photos)).find(p=>p.id===id):null);
   if(!allowed)fail('사진을 열 수 없습니다.',404);res.set('Cache-Control','private, no-store');res.sendFile(join(dataDir,'photos',variant==='original'?`${id}.${allowed.ext}`:`${id}-${variant}.jpg`));
 });
 app.post('/api/robots',admin,(req,res)=>{const no=Number(req.body.no),shape=req.body.shape||(no<=16?'CYLINDER':'DOME');if(!Number.isInteger(no)||no<1||no>99999||!['CYLINDER','DOME'].includes(shape))fail('호기번호와 형상을 확인하세요.');const site=text(req.body.site||'미지정',100,true);tx(()=>{if(get('SELECT no FROM robots WHERE no=?',no))fail('이미 등록된 번호입니다.',409);run('INSERT INTO robots(no,site,shape) VALUES(?,?,?)',no,site,shape);audit(req.user.id,'ROBOT_CREATED',no,{site,shape});});res.status(201).json({no});});
 app.patch('/api/robots/:no',admin,(req,res)=>{const r=robot(req.params.no),site=text(req.body.site||r.site,100,true),shape=req.body.shape||r.shape;if(!['CYLINDER','DOME'].includes(shape))fail('형상을 확인하세요.');tx(()=>{run('UPDATE robots SET site=?,shape=? WHERE no=?',site,shape,r.no);for(const m of all("SELECT sensor_id FROM mounts WHERE robot_no=? AND unmounted_at IS NULL AND slot LIKE 'LIDAR_%'",r.no)){const count=get('SELECT count(*) n FROM damages WHERE sensor_id=?',m.sensor_id).n;if(shape!==r.shape&&count)fail('파손 이력이 있는 센서는 형상을 바꿀 수 없습니다. 실물 교체로 처리하세요.');run('UPDATE sensors SET model=? WHERE id=?',shape,m.sensor_id);}audit(req.user.id,'ROBOT_UPDATED',r.no,{before:r,site,shape});});res.json({ok:true});});
 app.post('/api/robots/:no/dispose',admin,(req,res)=>{
   const r=robot(req.params.no);if(r.status!=='ACTIVE')fail('이미 폐기된 호기입니다.',409);const reason=text(req.body.reason,1000,true),disposed=date(req.body.date);if(disposed>today())fail('미래 폐기일은 지정할 수 없습니다.');
   tx(()=>{for(const m of all('SELECT * FROM mounts WHERE robot_no=? AND unmounted_at IS NULL',r.no)){const disposition=req.body.sensors?.[m.sensor_id];if(!['SPARE','DISPOSED'].includes(disposition))fail('모든 센서의 회수 또는 폐기 처리를 선택하세요.');run('UPDATE mounts SET unmounted_at=? WHERE id=?',now(),m.id);run('UPDATE sensors SET status=? WHERE id=?',disposition,m.sensor_id);if(disposition==='DISPOSED')for(const d of damagesAt(m.sensor_id,null)){const{id:_,sensor_id:__,...before}=d;event(d.id,'CLOSED',req.user.id,before,{...before,status:'CLOSED',closed_at:now()},'호기 폐기: '+reason);}audit(req.user.id,'SENSOR_'+disposition,m.sensor_id,{robot:r.no});}run("UPDATE robots SET status='DISPOSED',disposed_at=?,reason=? WHERE no=?",disposed,reason,r.no);audit(req.user.id,'ROBOT_DISPOSED',r.no,{reason,disposed});});res.json({ok:true});
 });
 app.post('/api/robots/:no/mounts',admin,(req,res)=>{
   const r=robot(req.params.no),slot=req.body.slot,position=text(req.body.position||'미확인',100);if(r.status!=='ACTIVE'||!slots.includes(slot))fail('운영 호기와 슬롯을 확인하세요.');
   tx(()=>{let s;if(req.body.sensor_id){s=sensor(req.body.sensor_id);if(s.status!=='SPARE')fail('예비 센서만 장착할 수 있습니다.');}else{const serial=text(req.body.serial,100,true),model=slot.startsWith('CAM')?'CAMERA':r.shape;if(get('SELECT id FROM sensors WHERE serial=?',serial))fail('이미 등록된 시리얼입니다. 예비 센서에서 선택하세요.');const id=Number(run("INSERT INTO sensors(serial,verified,model,status) VALUES(?,1,?,'SPARE')",serial,model).lastInsertRowid);s=sensor(id);}if((slot.startsWith('CAM')?'CAMERA':r.shape)!==s.model)fail('슬롯과 센서 모델이 맞지 않습니다.');const old=get('SELECT * FROM mounts WHERE robot_no=? AND slot=? AND unmounted_at IS NULL',r.no,slot);if(old){if(!['SPARE','DISPOSED'].includes(req.body.old_status))fail('기존 센서의 회수/폐기를 선택하세요.');run('UPDATE mounts SET unmounted_at=? WHERE id=?',now(),old.id);run('UPDATE sensors SET status=? WHERE id=?',req.body.old_status,old.sensor_id);if(req.body.old_status==='DISPOSED')for(const d of damagesAt(old.sensor_id,null)){const{id:_,sensor_id:__,...before}=d;event(d.id,'CLOSED',req.user.id,before,{...before,status:'CLOSED',closed_at:now()},'센서 교체 후 폐기');}audit(req.user.id,'SENSOR_UNMOUNTED',old.sensor_id,{robot:r.no,slot});}run("UPDATE sensors SET status='MOUNTED' WHERE id=?",s.id);run('INSERT INTO mounts(robot_no,sensor_id,slot,position,mounted_at) VALUES(?,?,?,?,?)',r.no,s.id,slot,position,now());audit(req.user.id,'SENSOR_MOUNTED',s.id,{robot:r.no,slot,position});});res.json({ok:true});
 });
 app.patch('/api/sensors/:id',admin,(req,res)=>{const s=sensor(req.params.id),serial=text(req.body.serial,100,true),position=text(req.body.position||'미확인',100);tx(()=>{if(s.verified&&serial!==s.serial)fail('확정된 실물 시리얼 변경은 센서 교체로 처리하세요.');if(get('SELECT id FROM sensors WHERE serial=? AND id<>?',serial,s.id))fail('중복 시리얼입니다.');run('UPDATE sensors SET serial=?,verified=1 WHERE id=?',serial,s.id);run('UPDATE mounts SET position=? WHERE sensor_id=? AND unmounted_at IS NULL',position,s.id);audit(req.user.id,'SENSOR_IDENTIFIED',s.id,{before:s.serial,serial,position});});res.json({ok:true});});
 app.post('/api/robots/import-csv',admin,single,(req,res)=>{
   if(!req.file)fail('CSV 파일을 선택하세요.');let rows;try{rows=parse(req.file.buffer.toString('utf8'),{columns:true,bom:true,skip_empty_lines:true,trim:true});}catch{fail('CSV 형식이 올바르지 않습니다.');}if(!rows.length||rows.length>1000)fail('1~1000행을 업로드하세요.');
   tx(()=>{const seen=new Set();for(const row of rows){const no=Number(row.robot_no);robot(no);if(!slots.includes(row.slot)||seen.has(`${no}/${row.slot}`))fail('슬롯이 잘못되었거나 중복 행입니다.');seen.add(`${no}/${row.slot}`);const m=get('SELECT * FROM mounts WHERE robot_no=? AND slot=? AND unmounted_at IS NULL',no,row.slot);if(!m)fail(`${no}호기 ${row.slot}: 현재 센서가 없습니다.`);const s=sensor(m.sensor_id),serial=text(row.serial,100,true);if(s.verified&&s.serial!==serial)fail(`${no}호기: 확정 센서는 교체 기능으로 변경하세요.`);if(get('SELECT id FROM sensors WHERE serial=? AND id<>?',serial,s.id))fail('중복 시리얼: '+serial);run('UPDATE sensors SET serial=?,verified=1 WHERE id=?',serial,s.id);run('UPDATE mounts SET position=? WHERE id=?',text(row.position||'미확인',100),m.id);}audit(req.user.id,'CSV_IMPORTED','sensors',{count:rows.length});});res.json({count:rows.length});
 });
 app.get('/api/users',sys,(req,res)=>res.json(all('SELECT id,username,name,department,role,active,must_change FROM users ORDER BY id')));
 app.post('/api/users',sys,(req,res)=>{const username=text(req.body.username,60,true),name=text(req.body.name,80,true),department=text(req.body.department||'',100),role=req.body.role,password=req.body.password;if(!/^[a-zA-Z0-9._-]{3,60}$/.test(username)||!['FIELD','ADMIN','SYSADMIN'].includes(role)||typeof password!=='string'||password.length<12||Buffer.byteLength(password)>72)fail('계정 ID, 권한, 12자 이상 임시 비밀번호를 확인하세요.');tx(()=>{if(get('SELECT id FROM users WHERE username=?',username))fail('이미 존재하는 ID입니다.');const id=run('INSERT INTO users(username,name,department,role,password_hash) VALUES(?,?,?,?,?)',username,name,department,role,bcrypt.hashSync(password,12)).lastInsertRowid;audit(req.user.id,'USER_CREATED',id,{username,name,role});});res.status(201).json({ok:true});});
 app.patch('/api/users/:id',sys,(req,res)=>{const u=get('SELECT * FROM users WHERE id=?',Number(req.params.id));if(!u)fail('계정이 없습니다.',404);const role=req.body.role??u.role,active=req.body.active===undefined?u.active:Number(req.body.active);if(!['FIELD','ADMIN','SYSADMIN'].includes(role)||![0,1].includes(active))fail('권한을 확인하세요.');if(u.id===req.user.id&&(role!=='SYSADMIN'||!active))fail('본인의 시스템 관리자 권한은 해제할 수 없습니다.');tx(()=>{run('UPDATE users SET role=?,active=? WHERE id=?',role,active,u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);audit(req.user.id,'USER_UPDATED',u.id,{role,active});});res.json({ok:true});});
 app.get('/api/audit',sys,(req,res)=>res.json(all('SELECT a.*,u.name actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 500')));
 app.get('/api/models',(req,res)=>res.json(all('SELECT * FROM models')));
 app.post('/api/models/:id',sys,single,async(req,res)=>{const id=req.params.id;if(!get('SELECT id FROM models WHERE id=?',id))fail('모델이 없습니다.');if(!req.file||req.file.buffer.toString('utf8',0,4)!=='glTF'||req.file.buffer.readUInt32LE(4)!==2)fail('2MB 이하 GLB 2.0 파일을 선택하세요.');const b=req.file.buffer;if(b.length<20||b.readUInt32LE(8)!==b.length)fail('GLB 길이가 올바르지 않습니다.');let manifest;try{manifest=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)).trim());}catch{fail('GLB 데이터를 읽을 수 없습니다.');}if([...manifest.buffers||[],...manifest.images||[]].some(x=>x.uri&&!x.uri.startsWith('data:')))fail('외부 파일 참조 없는 GLB를 사용하세요.');if(!manifest.nodes?.some(n=>n.name))fail('부위별 메시 이름이 필요합니다.');const name=`${id}-${randomUUID()}.glb`;await writeFile(join(dataDir,'models',name),b);tx(()=>{run('UPDATE models SET file=?,revision=revision+1 WHERE id=?',name,id);audit(req.user.id,'MODEL_UPDATED',id,{name});});res.json({ok:true});});
 app.get('/files/models/:name',(req,res)=>{const m=get('SELECT file FROM models WHERE file=?',req.params.name);if(!m)fail('모델을 찾을 수 없습니다.',404);res.sendFile(join(dataDir,'models',m.file));});
 app.delete('/api/robots/:no',sys,(req,res)=>{const r=robot(req.params.no),reason=text(req.body.reason,1000,true);tx(()=>{if(get('SELECT id FROM mounts WHERE robot_no=? LIMIT 1',r.no)||get('SELECT id FROM reports WHERE robot_no=? LIMIT 1',r.no))fail('이력이 있는 호기는 영구 삭제할 수 없습니다. 폐기로 처리하세요.');run('DELETE FROM robots WHERE no=?',r.no);audit(req.user.id,'ROBOT_DELETED',r.no,{reason});});res.json({ok:true});});
 app.use('/api',(req,res)=>res.status(404).json({error:'API를 찾을 수 없습니다.'}));
 app.get('/vendor/three.js',(req,res)=>res.sendFile(join(root,'node_modules/three/build/three.module.js')));
 app.get('/vendor/three.core.js',(req,res)=>res.sendFile(join(root,'node_modules/three/build/three.core.js')));
 app.use('/vendor/addons',express.static(join(root,'node_modules/three/examples/jsm')));
 app.use(express.static(join(root,'public')));
 app.get('/{*path}',(req,res)=>res.sendFile(join(root,'public/index.html')));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.status|| (err instanceof multer.MulterError?400:500);if(status===500)console.error(err);res.status(status).json({error:status===500?'서버 처리에 실패했습니다. 다시 시도하세요.':err.message});});
 return {app,store,dataDir};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {app,dataDir}=createApp();const port=Number(process.env.PORT||3210),host=process.env.HOST||'127.0.0.1';app.listen(port,host,()=>{console.log(`Robot Sensor Platform: http://${host}:${port}\n초기 계정 안내: ${join(dataDir,'initial-account.txt')}`);});
}
